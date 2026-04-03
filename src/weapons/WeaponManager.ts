import { IWorld } from 'bitecs';
import { BaseWeapon, WeaponContext } from './BaseWeapon';
import { checkEvolutionReady, WeaponEvolution } from '../data/WeaponEvolutions';
import { getActiveSynergies, WeaponSynergy } from '../data/WeaponSynergies';
import { EffectsManager } from '../effects/EffectsManager';
import { SoundManager } from '../audio/SoundManager';
import { Transform, Health, Knockback, EnemyType } from '../ecs/components';
import { getSprite } from '../ecs/systems/SpriteSystem';
import { applyBurn, applyFreeze, applyPoison, getFreezeMultiplier } from '../ecs/systems/StatusEffectSystem';
import { getCombatStats } from '../ecs/systems/CollisionSystem';
import { isNearTankAura } from '../ecs/systems/EnemyAISystem';
import { getEnemyIds } from '../ecs/FrameCache';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { VisualQuality } from '../visual/GlowGraphics';
import { getJuiceManager } from '../effects/JuiceManager';

/**
 * WeaponManager handles all player weapons.
 * Updates weapons each frame and provides context for attacks.
 */
export class WeaponManager {
  private weapons: Map<string, BaseWeapon> = new Map();
  private activeSynergies: WeaponSynergy[] = [];
  private scene: Phaser.Scene;
  private world: IWorld;
  private playerId: number;
  private effectsManager: EffectsManager;
  private soundManager: SoundManager;

  // Weapon slot limit system
  private maxWeaponSlots: number = 3;
  private previousSynergyCount: number = 0;

  // Callbacks for game integration
  private onEnemyDamaged: ((enemyId: number, damage: number, isCrit: boolean) => void) | null = null;
  private onEnemyKilled: ((enemyId: number, x: number, y: number) => void) | null = null;
  private onPlayerHealed: ((amount: number) => void) | null = null;

  // Overcharge stun duration (from permanent upgrades)
  private overchargeStunDuration: number = 0;

  // Visual quality tier for weapon rendering
  private visualQuality: VisualQuality = 'high';

  // Light flash sources for dynamic lighting (consumed by GameScene each frame)
  lightFlashes: Array<{ x: number; y: number; radius: number; intensity: number; ttl: number }> = [];

  // PERF: Per-frame effect budget to cap visual overhead during mass combat
  private damageNumberBudget: number = 0;
  private hitSparkBudget: number = 0;
  private tweenBudget: number = 0;
  // PERF: Cache combat stats once per frame instead of per-hit
  private cachedCombatStats: ReturnType<typeof getCombatStats> = null;

  // Pooled context object - created once, updated each frame to avoid allocations
  private ctx: WeaponContext;

  constructor(
    scene: Phaser.Scene,
    world: IWorld,
    playerId: number,
    effectsManager: EffectsManager,
    soundManager: SoundManager
  ) {
    this.scene = scene;
    this.world = world;
    this.playerId = playerId;
    this.effectsManager = effectsManager;
    this.soundManager = soundManager;

    // Initialize pooled context object (methods bound once, values updated each frame)
    this.ctx = {
      world: this.world,
      scene: this.scene,
      playerId: this.playerId,
      playerX: 0,
      playerY: 0,
      gameTime: 0,
      deltaTime: 0,
      effectsManager: this.effectsManager,
      soundManager: this.soundManager,
      getEnemies: getEnemyIds,  // Use FrameCache directly - no allocation!
      damageEnemy: (enemyId, damage, knockback) => this.damageEnemy(enemyId, damage, this.ctx.playerX, this.ctx.playerY, knockback),
      stunEnemy: (enemyId, duration) => this.stunEnemy(enemyId, duration),
      overchargeStunDuration: 0,
      healPlayer: (amount) => this.healPlayer(amount),
      visualQuality: this.visualQuality,
    };
  }

  /**
   * Set callbacks for enemy damage/death/player heal.
   */
  public setCallbacks(
    onDamaged: (enemyId: number, damage: number, isCrit: boolean) => void,
    onKilled: (enemyId: number, x: number, y: number) => void,
    onHealed?: (amount: number) => void
  ): void {
    this.onEnemyDamaged = onDamaged;
    this.onEnemyKilled = onKilled;
    this.onPlayerHealed = onHealed || null;
  }

  /**
   * Add a new weapon to the player's arsenal.
   * Returns true if weapon was added/leveled, false if no slots available.
   */
  public addWeapon(weapon: BaseWeapon): boolean {
    if (this.weapons.has(weapon.id)) {
      // Weapon already exists, level it up instead
      this.weapons.get(weapon.id)!.levelUp();
      return true;
    } else if (this.canAddWeapon()) {
      this.weapons.set(weapon.id, weapon);
      this.recalculateSynergies();
      return true;
    }
    return false; // No slots available
  }

  /**
   * Recalculate weapon synergies based on currently equipped weapons.
   * Applies damage/cooldown multipliers to weapons in synergy pairs.
   */
  private recalculateSynergies(): void {
    const equippedIds = Array.from(this.weapons.keys());
    this.activeSynergies = getActiveSynergies(equippedIds);

    // Build per-weapon synergy multipliers (stack multiplicatively)
    const weaponDamageMult = new Map<string, number>();
    const weaponCooldownMult = new Map<string, number>();

    for (const synergy of this.activeSynergies) {
      for (const weaponId of [synergy.weaponA, synergy.weaponB]) {
        if (this.weapons.has(weaponId)) {
          weaponDamageMult.set(weaponId, (weaponDamageMult.get(weaponId) ?? 1.0) * synergy.damageMultiplier);
          weaponCooldownMult.set(weaponId, (weaponCooldownMult.get(weaponId) ?? 1.0) * synergy.cooldownMultiplier);
        }
      }
    }

    // Apply synergy multipliers to each weapon (combined with existing external multipliers)
    for (const [weaponId, weapon] of this.weapons) {
      const synergyDamage = weaponDamageMult.get(weaponId) ?? 1.0;
      const synergyCooldown = weaponCooldownMult.get(weaponId) ?? 1.0;
      // Only update if there's a synergy bonus to apply
      if (synergyDamage !== 1.0 || synergyCooldown !== 1.0) {
        weapon.applyMultipliers(synergyDamage, synergyCooldown);
      }
    }

    // Play synergy sound when a new synergy is activated
    if (this.activeSynergies.length > this.previousSynergyCount) {
      this.soundManager.playSynergyActivation();
    }
    this.previousSynergyCount = this.activeSynergies.length;
  }

  /**
   * Get the list of currently active weapon synergies.
   */
  public getActiveSynergies(): WeaponSynergy[] {
    return this.activeSynergies;
  }

  /**
   * Check if player has a specific weapon.
   */
  public hasWeapon(weaponId: string): boolean {
    return this.weapons.has(weaponId);
  }

  /**
   * Get a specific weapon.
   */
  public getWeapon(weaponId: string): BaseWeapon | undefined {
    return this.weapons.get(weaponId);
  }

  /**
   * Get all equipped weapons.
   */
  public getAllWeapons(): BaseWeapon[] {
    return Array.from(this.weapons.values());
  }

  /**
   * Get current weapon count.
   */
  public getWeaponCount(): number {
    return this.weapons.size;
  }

  /**
   * Get maximum weapon slots.
   */
  public getMaxWeaponSlots(): number {
    return this.maxWeaponSlots;
  }

  /**
   * Set maximum weapon slots.
   */
  public setMaxWeaponSlots(slots: number): void {
    this.maxWeaponSlots = slots;
  }

  /**
   * Check all weapons for evolution readiness.
   * Returns the first evolution that triggers, or null.
   */
  public checkEvolutions(statUpgrades: { id: string; currentLevel: number }[], evolutionLevelReduction: number = 0): { weapon: BaseWeapon; evolution: WeaponEvolution } | null {
    for (const weapon of this.weapons.values()) {
      if (weapon.isEvolved) continue;
      const evolution = checkEvolutionReady(weapon.id, weapon.getLevel(), statUpgrades, evolutionLevelReduction);
      if (evolution) {
        weapon.evolve(evolution.evolvedName, evolution.statMultipliers);
        return { weapon, evolution };
      }
    }
    return null;
  }

  /**
   * Check if player can add another weapon.
   */
  public canAddWeapon(): boolean {
    return this.weapons.size < this.maxWeaponSlots;
  }

  /**
   * Get remaining weapon slots.
   */
  public getRemainingSlots(): number {
    return this.maxWeaponSlots - this.weapons.size;
  }

  /**
   * Level up a specific weapon.
   */
  public levelUpWeapon(weaponId: string): boolean {
    const weapon = this.weapons.get(weaponId);
    if (weapon && !weapon.isMaxLevel()) {
      const wasMastered = weapon.isMastered();
      weapon.levelUp();
      // Play special sound when weapon reaches mastery (level 10)
      if (!wasMastered && weapon.isMastered()) {
        this.soundManager.playAchievementUnlock();
      }
      return true;
    }
    return false;
  }

  /**
   * Update all weapons. Called every frame.
   * Uses pooled context to avoid per-frame allocations.
   */
  public update(gameTime: number, deltaTime: number): void {
    if (this.playerId === -1) return;

    // PERF: Reset per-frame effect budgets
    this.damageNumberBudget = 15;
    this.hitSparkBudget = 10;
    this.tweenBudget = 8;
    // PERF: Cache combat stats once per frame (avoids Object.freeze copy per hit)
    this.cachedCombatStats = getCombatStats();

    // Update mutable fields in pooled context (no new object allocation!)
    this.ctx.playerX = Transform.x[this.playerId];
    this.ctx.playerY = Transform.y[this.playerId];
    this.ctx.gameTime = gameTime;
    this.ctx.deltaTime = deltaTime;
    this.ctx.overchargeStunDuration = this.overchargeStunDuration;
    this.ctx.visualQuality = this.visualQuality;

    // Update all weapons with the reused context
    for (const weapon of this.weapons.values()) {
      weapon.update(this.ctx);
    }
  }

  /**
   * Deal damage to an enemy with critical hit support.
   */
  private damageEnemy(
    enemyId: number,
    damage: number,
    sourceX: number,
    sourceY: number,
    knockbackStrength: number = 200
  ): void {
    const enemyX = Transform.x[enemyId];
    const enemyY = Transform.y[enemyId];

    // Calculate actual damage with crit check
    let actualDamage = damage;
    let isCrit = false;
    let isPerfectCrit = false;

    // PERF: Use per-frame cached combat stats instead of allocating a frozen copy per hit
    const combatStats = this.cachedCombatStats;
    if (combatStats && combatStats.critChance > 0 && Math.random() < combatStats.critChance) {
      // Crit with 80-100% variance (±20% of crit damage)
      const critVariance = 0.8 + Math.random() * 0.2;
      actualDamage *= combatStats.critDamage * critVariance;
      isCrit = true;
      // Perfect crit: top 1% of damage roll (variance >= 0.99)
      isPerfectCrit = critVariance >= 0.99;
    }

    // Execution bonus: extra damage to enemies below 25% HP
    if (combatStats && combatStats.executionBonus > 0) {
      const enemyHPPercent = Health.current[enemyId] / Health.max[enemyId];
      if (enemyHPPercent < 0.25) {
        actualDamage *= (1 + combatStats.executionBonus);
      }
    }

    // Shatter bonus: extra damage to frozen enemies
    if (combatStats && combatStats.shatterBonus > 0) {
      const freezeMultiplier = getFreezeMultiplier(this.world, enemyId);
      if (freezeMultiplier < 1) {
        actualDamage *= (1 + combatStats.shatterBonus);
      }
    }

    // Tank aura: enemies near a Tank take 25% less damage
    if (isNearTankAura(enemyId)) {
      actualDamage *= 0.75;
    }

    // Store HP before damage for overkill splash calculation
    const hpBeforeDamage = Health.current[enemyId];

    // Apply damage
    Health.current[enemyId] -= actualDamage;

    // Apply elemental status effects based on combat stats
    if (combatStats) {
      if (combatStats.burnChance > 0 && Math.random() < combatStats.burnChance) {
        applyBurn(this.world, enemyId, actualDamage * 0.2, 3000, combatStats.burnDamageMultiplier);
        this.soundManager.playBurnApply();
      }
      if (combatStats.freezeChance > 0 && Math.random() < combatStats.freezeChance) {
        applyFreeze(this.world, enemyId, 0.5, 2000, combatStats.freezeDurationMultiplier);
        this.soundManager.playFreezeApply();
      }
      if (combatStats.poisonChance > 0 && Math.random() < combatStats.poisonChance) {
        applyPoison(this.world, enemyId, 1, 4000, combatStats.poisonMaxStacks);
        this.soundManager.playPoisonApply();
      }
      // Life steal: heal player by percentage of damage dealt
      if (combatStats.lifeStealPercent > 0) {
        this.healPlayer(actualDamage * combatStats.lifeStealPercent);
      }
    }

    // Apply knockback (with multiplier from combat stats)
    if (knockbackStrength > 0) {
      const dx = enemyX - sourceX;
      const dy = enemyY - sourceY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const knockbackMult = combatStats?.knockbackMultiplier ?? 1;
      Knockback.velocityX[enemyId] += (dx / dist) * knockbackStrength * knockbackMult;
      Knockback.velocityY[enemyId] += (dy / dist) * knockbackStrength * knockbackMult;
    }

    // Hit stop for impact weight — brief pause on crits, longer on perfect crits
    if (isPerfectCrit) {
      getJuiceManager().hitStop(40, 0.8);
      getJuiceManager().impactFlash(0.15, 60);
    } else if (isCrit) {
      getJuiceManager().hitStop(20, 0.5);
    }

    // PERF: Visual effects gated behind per-frame budget (gameplay damage always applied above)
    if (this.damageNumberBudget > 0) {
      this.damageNumberBudget--;
      const damageColor = isPerfectCrit ? 0xffd700 : (isCrit ? 0xffff00 : 0xffffff);
      this.effectsManager.showDamageNumber(enemyX, enemyY, Math.round(actualDamage), damageColor, isCrit, isPerfectCrit);
    }

    if (this.hitSparkBudget > 0) {
      this.hitSparkBudget--;
      const sparkAngle = Math.atan2(sourceY - enemyY, sourceX - enemyX);
      this.effectsManager.playHitSparks(enemyX, enemyY, sparkAngle);
    }

    // Light flash (capped at 10 per frame)
    if (this.lightFlashes.length < 10) {
      this.lightFlashes.push({ x: enemyX, y: enemyY, radius: 50, intensity: 0.6, ttl: 80 });
    }

    // Hit sound (SoundManager has built-in 50ms throttling)
    this.soundManager.playHit();

    // Scale punch on hit (budget-gated to prevent tween explosion)
    if (this.tweenBudget > 0) {
      const sprite = getSprite(enemyId);
      if (sprite) {
        this.tweenBudget--;
        const damageRatio = actualDamage / (Health.max[enemyId] || 1);
        const punchScale = damageRatio > 0.2 ? 1.15 : 1.08;
        getJuiceManager().squashStretch(sprite, punchScale, punchScale, 100);
      }
    }

    // Callback for damage tracking
    if (this.onEnemyDamaged) {
      this.onEnemyDamaged(enemyId, actualDamage, isCrit);
    }

    // Check for death
    if (Health.current[enemyId] <= 0) {
      // Hit stop on significant kills for dramatic weight
      const xpValue = EnemyType.xpValue[enemyId] || 0;
      if (xpValue >= 1000) {
        getJuiceManager().hitStop(100, 1.0);   // Boss kill — heavy freeze
      } else if (xpValue >= 30) {
        getJuiceManager().hitStop(60, 0.9);    // Miniboss kill
      }

      if (this.onEnemyKilled) {
        this.onEnemyKilled(enemyId, enemyX, enemyY);
      }

      // Overkill splash: excess damage splashes to nearby enemies
      if (combatStats && combatStats.overkillSplash > 0) {
        const overkillDamage = actualDamage - hpBeforeDamage;
        if (overkillDamage > 0) {
          const splashDamage = overkillDamage * combatStats.overkillSplash;
          const splashRadius = 80;
          const spatialHash = getEnemySpatialHash();
          const splashTargets = spatialHash.query(enemyX, enemyY, splashRadius);

          for (const target of splashTargets) {
            const nearbyId = target.id;
            if (nearbyId === enemyId || Health.current[nearbyId] <= 0) continue;

            Health.current[nearbyId] -= splashDamage;
            if (this.damageNumberBudget > 0) {
              this.damageNumberBudget--;
              this.effectsManager.showDamageNumber(
                Transform.x[nearbyId], Transform.y[nearbyId],
                Math.round(splashDamage), 0xff8800, false, false
              );
            }

            if (Health.current[nearbyId] <= 0 && this.onEnemyKilled) {
              this.onEnemyKilled(nearbyId, Transform.x[nearbyId], Transform.y[nearbyId]);
            }
          }
        }
      }
    }
  }

  /**
   * Apply global stat multipliers and bonuses to all weapons.
   */
  public applyMultipliers(
    damageMultiplier: number,
    cooldownMultiplier: number,
    bonusCount: number = 0,
    bonusPiercing: number = 0
  ): void {
    for (const weapon of this.weapons.values()) {
      weapon.applyMultipliers(damageMultiplier, cooldownMultiplier, bonusCount, bonusPiercing);
    }
  }

  /**
   * Update player reference (if player entity changes).
   */
  public setPlayerId(playerId: number): void {
    this.playerId = playerId;
    this.ctx.playerId = playerId;  // Keep pooled context in sync
  }

  /**
   * Set visual quality tier for weapon rendering.
   */
  public setVisualQuality(quality: VisualQuality): void {
    this.visualQuality = quality;
  }

  /**
   * Set overcharge stun duration (for chain lightning).
   */
  public setOverchargeStunDuration(duration: number): void {
    this.overchargeStunDuration = duration;
  }

  /**
   * Apply stun (freeze with 0 speed) to an enemy.
   */
  private stunEnemy(enemyId: number, duration: number): void {
    // Check if enemy is still alive (prevents crash when entity was removed after dying)
    if (duration > 0 && Health.current[enemyId] > 0) {
      // Apply freeze with 0 multiplier (complete stop) for the specified duration
      applyFreeze(this.world, enemyId, 0, duration, 1.0);
    }
  }

  /**
   * Heal the player (for weapon mastery effects like Consecrated Ground).
   */
  private healPlayer(amount: number): void {
    if (this.onPlayerHealed) {
      this.onPlayerHealed(amount);
    }
  }

  /**
   * Clean up all weapons.
   */
  public destroy(): void {
    for (const weapon of this.weapons.values()) {
      weapon.destroy();
    }
    this.weapons.clear();
  }
}
