import { IWorld } from 'bitecs';
import { BaseWeapon, WeaponContext } from './BaseWeapon';
import { checkEvolutionReady, WeaponEvolution } from '../data/WeaponEvolutions';
import { EffectsManager } from '../effects/EffectsManager';
import { SoundManager } from '../audio/SoundManager';
import { Transform, Health, Knockback } from '../ecs/components';
import { getSprite } from '../ecs/systems/SpriteSystem';
import { applyBurn, applyFreeze, applyPoison, getFreezeMultiplier } from '../ecs/systems/StatusEffectSystem';
import { getCombatStats } from '../ecs/systems/CollisionSystem';
import { getEnemyIds } from '../ecs/FrameCache';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { VisualQuality } from '../visual/GlowGraphics';

/**
 * WeaponManager handles all player weapons.
 * Updates weapons each frame and provides context for attacks.
 */
export class WeaponManager {
  private weapons: Map<string, BaseWeapon> = new Map();
  private scene: Phaser.Scene;
  private world: IWorld;
  private playerId: number;
  private effectsManager: EffectsManager;
  private soundManager: SoundManager;

  // Weapon slot limit system
  private maxWeaponSlots: number = 3;

  // Callbacks for game integration
  private onEnemyDamaged: ((enemyId: number, damage: number, isCrit: boolean) => void) | null = null;
  private onEnemyKilled: ((enemyId: number, x: number, y: number) => void) | null = null;
  private onPlayerHealed: ((amount: number) => void) | null = null;

  // Overcharge stun duration (from permanent upgrades)
  private overchargeStunDuration: number = 0;

  // Visual quality tier for weapon rendering
  private visualQuality: VisualQuality = 'high';

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
      return true;
    }
    return false; // No slots available
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
  public checkEvolutions(statUpgrades: { id: string; currentLevel: number }[]): { weapon: BaseWeapon; evolution: WeaponEvolution } | null {
    for (const weapon of this.weapons.values()) {
      if (weapon.isEvolved) continue;
      const evolution = checkEvolutionReady(weapon.id, weapon.getLevel(), statUpgrades);
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

    const combatStats = getCombatStats();
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

    // Store HP before damage for overkill splash calculation
    const hpBeforeDamage = Health.current[enemyId];

    // Apply damage
    Health.current[enemyId] -= actualDamage;

    // Apply elemental status effects based on combat stats
    if (combatStats) {
      if (combatStats.burnChance > 0 && Math.random() < combatStats.burnChance) {
        applyBurn(this.world, enemyId, actualDamage * 0.2, 3000, combatStats.burnDamageMultiplier);
      }
      if (combatStats.freezeChance > 0 && Math.random() < combatStats.freezeChance) {
        applyFreeze(this.world, enemyId, 0.5, 2000, combatStats.freezeDurationMultiplier);
      }
      if (combatStats.poisonChance > 0 && Math.random() < combatStats.poisonChance) {
        applyPoison(this.world, enemyId, 1, 4000, combatStats.poisonMaxStacks);
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

    // Visual feedback (gold for perfect crit, yellow for crit, white for normal)
    const damageColor = isPerfectCrit ? 0xffd700 : (isCrit ? 0xffff00 : 0xffffff);
    this.effectsManager.showDamageNumber(enemyX, enemyY, Math.round(actualDamage), damageColor, isCrit, isPerfectCrit);

    // Hit sparks (sparks fly back toward source)
    const sparkAngle = Math.atan2(sourceY - enemyY, sourceX - enemyX);
    this.effectsManager.playHitSparks(enemyX, enemyY, sparkAngle);

    // Hit sound (SoundManager has built-in 50ms throttling)
    this.soundManager.playHit();

    // Flash enemy white briefly
    const sprite = getSprite(enemyId);
    if (sprite && sprite instanceof Phaser.GameObjects.Rectangle) {
      const originalColor = sprite.fillColor;
      sprite.setFillStyle(0xffffff);
      this.scene.time.delayedCall(50, () => {
        if (sprite.active) sprite.setFillStyle(originalColor);
      });
    }

    // Callback for damage tracking
    if (this.onEnemyDamaged) {
      this.onEnemyDamaged(enemyId, actualDamage, isCrit);
    }

    // Check for death
    if (Health.current[enemyId] <= 0) {
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
            this.effectsManager.showDamageNumber(
              Transform.x[nearbyId], Transform.y[nearbyId],
              Math.round(splashDamage), 0xff8800, false, false
            );

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
