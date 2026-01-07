import { IWorld } from 'bitecs';
import { BaseWeapon, WeaponContext } from './BaseWeapon';
import { EffectsManager } from '../effects/EffectsManager';
import { SoundManager } from '../audio/SoundManager';
import { Transform, Health, Knockback } from '../ecs/components';
import { getSprite } from '../ecs/systems/SpriteSystem';
import { applyFreeze } from '../ecs/systems/StatusEffectSystem';
import { getCombatStats } from '../ecs/systems/CollisionSystem';
import { getEnemyIds } from '../ecs/FrameCache';

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
  private onEnemyDamaged: ((enemyId: number, damage: number) => void) | null = null;
  private onEnemyKilled: ((enemyId: number, x: number, y: number) => void) | null = null;
  private onPlayerHealed: ((amount: number) => void) | null = null;

  // Overcharge stun duration (from permanent upgrades)
  private overchargeStunDuration: number = 0;

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
    };
  }

  /**
   * Set callbacks for enemy damage/death/player heal.
   */
  public setCallbacks(
    onDamaged: (enemyId: number, damage: number) => void,
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
      weapon.levelUp();
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

    // Apply damage
    Health.current[enemyId] -= actualDamage;

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

    // Flash enemy red
    const sprite = getSprite(enemyId);
    if (sprite && sprite instanceof Phaser.GameObjects.Rectangle) {
      const originalColor = sprite.fillColor;
      sprite.setFillStyle(0xffffff);
      this.scene.time.delayedCall(50, () => {
        if (sprite.active) sprite.setFillStyle(originalColor);
      });
    }

    // Callback
    if (this.onEnemyDamaged) {
      this.onEnemyDamaged(enemyId, actualDamage);
    }

    // Check for death
    if (Health.current[enemyId] <= 0) {
      if (this.onEnemyKilled) {
        this.onEnemyKilled(enemyId, enemyX, enemyY);
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
