import { IWorld } from 'bitecs';
import { EffectsManager } from '../effects/EffectsManager';
import { SoundManager } from '../audio/SoundManager';

/**
 * WeaponContext provides weapons access to game systems they need.
 */
export interface WeaponContext {
  world: IWorld;
  scene: Phaser.Scene;
  playerId: number;
  playerX: number;
  playerY: number;
  gameTime: number;
  deltaTime: number;
  effectsManager: EffectsManager;
  soundManager: SoundManager;
  getEnemies: () => readonly number[];
  damageEnemy: (enemyId: number, damage: number, knockback?: number) => void;
  stunEnemy: (enemyId: number, duration: number) => void;  // Apply stun (freeze with 0 speed)
  overchargeStunDuration: number;  // Stun duration from chain lightning (0 = disabled)
  healPlayer: (amount: number) => void;  // Heal the player (for weapon mastery effects)
}

/**
 * WeaponStats define the upgradeable properties of a weapon.
 */
export interface WeaponStats {
  damage: number;
  cooldown: number;
  range: number;
  count: number;      // Projectile count, blade count, etc.
  piercing: number;   // How many enemies it can hit
  size: number;       // Visual/hitbox size multiplier
  speed: number;      // Projectile speed or attack speed
  duration: number;   // Effect duration for auras, etc.
}

/**
 * BaseWeapon is the abstract class all weapons inherit from.
 * Each weapon type implements its own attack pattern.
 */
export abstract class BaseWeapon {
  public readonly id: string;
  public readonly name: string;
  public readonly icon: string;
  public readonly description: string;
  public readonly maxLevel: number;
  public readonly masteryName: string;
  public readonly masteryDescription: string;

  protected level: number = 1;
  protected lastFired: number = 0;
  protected stats: WeaponStats;
  protected baseStats: WeaponStats;

  // External multipliers from meta progression and upgrades
  protected externalDamageMultiplier: number = 1.0;
  protected externalCooldownMultiplier: number = 1.0;
  protected externalBonusCount: number = 0;
  protected externalBonusPiercing: number = 0;

  // Visual elements managed by the weapon
  protected sprites: Phaser.GameObjects.GameObject[] = [];

  constructor(
    id: string,
    name: string,
    icon: string,
    description: string,
    maxLevel: number,
    baseStats: WeaponStats,
    masteryName: string = 'Mastery',
    masteryDescription: string = 'Unlock the weapon\'s true potential'
  ) {
    this.id = id;
    this.name = name;
    this.icon = icon;
    this.description = description;
    this.maxLevel = maxLevel;
    this.masteryName = masteryName;
    this.masteryDescription = masteryDescription;
    this.baseStats = { ...baseStats };
    this.stats = { ...baseStats };
  }

  /**
   * Called every frame to update the weapon.
   * Handles cooldown and triggers attack when ready.
   */
  public update(ctx: WeaponContext): void {
    if (ctx.gameTime - this.lastFired >= this.stats.cooldown) {
      this.attack(ctx);
      this.lastFired = ctx.gameTime;
    }

    // Update any persistent effects (orbiting blades, auras, etc.)
    this.updateEffects(ctx);
  }

  /**
   * Abstract method - each weapon implements its own attack logic.
   */
  protected abstract attack(ctx: WeaponContext): void;

  /**
   * Override for weapons with persistent effects (orbiting, auras).
   * Called every frame regardless of cooldown.
   */
  protected updateEffects(_ctx: WeaponContext): void {
    // Default: no persistent effects
  }

  /**
   * Level up the weapon.
   */
  public levelUp(): void {
    if (this.level < this.maxLevel) {
      this.level++;
      this.recalculateStats();
    }
  }

  /**
   * Recalculate stats based on current level and external multipliers.
   * Override for custom scaling.
   */
  protected recalculateStats(): void {
    const levelMultiplier = 1 + (this.level - 1) * 0.2; // 20% increase per level

    // Apply BOTH level multiplier AND external multiplier from meta progression
    this.stats.damage = this.baseStats.damage * levelMultiplier * this.externalDamageMultiplier;
    this.stats.size = this.baseStats.size * (1 + (this.level - 1) * 0.1); // 10% size per level
    // Apply cooldown reduction from both level and external multiplier
    this.stats.cooldown = (this.baseStats.cooldown * Math.pow(0.9, this.level - 1)) / this.externalCooldownMultiplier;
    // Apply count bonuses from both level and external sources
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    // Apply piercing bonuses from both level and external sources
    this.stats.piercing = this.baseStats.piercing + Math.floor((this.level - 1) / 2) + this.externalBonusPiercing;
  }

  /**
   * Apply external stat multipliers and bonuses (from upgrades, etc.)
   * Stores the multipliers and recalculates all stats to incorporate them.
   */
  public applyMultipliers(
    damageMultiplier: number,
    cooldownMultiplier: number,
    bonusCount: number = 0,
    bonusPiercing: number = 0
  ): void {
    // Store external multipliers
    this.externalDamageMultiplier = damageMultiplier;
    this.externalCooldownMultiplier = cooldownMultiplier;
    this.externalBonusCount = bonusCount;
    this.externalBonusPiercing = bonusPiercing;
    // Recalculate all stats with both level and external multipliers
    this.recalculateStats();
  }

  /**
   * Get description for upgrade screen.
   * Shows the bonus for the next level with per-level increase.
   * At level 9, shows the mastery ability preview.
   */
  public getUpgradeDescription(): string {
    if (this.level >= this.maxLevel) {
      return 'MAX LEVEL';
    }

    // Show mastery preview at level 9 (next level is 10 = mastery)
    if (this.level === 9) {
      return `[MASTERY] ${this.masteryDescription}`;
    }

    // Standard scaling: +20% damage per level, -10% cooldown per level
    const nextLevel = this.level + 1;
    const damagePerLevel = 20;
    const nextDamageBonus = (nextLevel - 1) * damagePerLevel;

    if (this.level === 1) {
      return `+${nextDamageBonus}% damage`;
    }
    return `+${nextDamageBonus}% damage (+${damagePerLevel}%)`;
  }

  /**
   * Get detailed stats for tooltip.
   */
  public getStatsDescription(): string {
    return `DMG: ${Math.round(this.stats.damage)} | CD: ${this.stats.cooldown.toFixed(2)}s`;
  }

  /**
   * Clean up visual elements when weapon is removed.
   */
  public destroy(): void {
    this.sprites.forEach(sprite => sprite.destroy());
    this.sprites = [];
  }

  // Getters
  public getLevel(): number { return this.level; }
  public getStats(): WeaponStats { return { ...this.stats }; }
  public isMaxLevel(): boolean { return this.level >= this.maxLevel; }

  /**
   * Check if weapon has reached mastery (level 10).
   * Used by weapons to enable their unique mastery abilities.
   */
  public isMastered(): boolean { return this.level >= 10; }
}
