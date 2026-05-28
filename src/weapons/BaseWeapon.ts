import { IWorld } from 'bitecs';
import { EffectsManager } from '../effects/EffectsManager';
import { SoundManager } from '../audio/SoundManager';
import { VisualQuality } from '../visual/GlowGraphics';
import { TUNING } from '../data/GameTuning';
import { getJuiceManager } from '../effects/JuiceManager';

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
  visualQuality: VisualQuality;
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

  // Evolution state
  private _evolved: boolean = false;
  private _evolvedName: string = '';

  // External multipliers from meta progression and upgrades
  protected externalDamageMultiplier: number = 1.0;
  protected externalCooldownMultiplier: number = 1.0;
  protected externalBonusCount: number = 0;
  protected externalBonusPiercing: number = 0;

  // External range/speed/mastery multipliers from player stats. Range is a
  // universal "reach/area" stat applied to every weapon; speed only applies to
  // weapons whose `speed` stat is projectile velocity (see scalesProjectileSpeed).
  protected externalRangeMultiplier: number = 1.0;
  protected externalSpeedMultiplier: number = 1.0;
  protected externalMasteryDamageMultiplier: number = 1.0;

  // Synergy multipliers from equipped weapon pairs. Stored separately from the
  // global externals above so the two stack rather than clobber each other.
  protected synergyDamageMultiplier: number = 1.0;
  protected synergyCooldownMultiplier: number = 1.0;

  // Whether this weapon's `speed` stat represents projectile velocity. Weapons
  // where `speed` means something else (slow factor, rotation, query radius)
  // leave this false so the global projectile-speed multiplier skips them.
  protected scalesProjectileSpeed: boolean = false;

  // Visual elements managed by the weapon
  protected sprites: Phaser.GameObjects.GameObject[] = [];

  // Wind-up visual fraction (0 = disabled, e.g. 0.15 = wind-up starts at last 15% of cooldown)
  protected windUpFraction: number = 0;
  private windUpTriggered: boolean = false;

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
    const elapsed = ctx.gameTime - this.lastFired;
    const cooldown = this.stats.cooldown;

    // Trigger wind-up visual near end of cooldown
    if (this.windUpFraction > 0 && !this.windUpTriggered && elapsed >= cooldown * (1 - this.windUpFraction)) {
      this.windUpTriggered = true;
      const windUpDuration = cooldown * this.windUpFraction * 1000; // convert to ms
      const windUpTarget = this.getWindUpTarget(ctx);
      getJuiceManager().windUp({
        weaponId: this.id,
        x: ctx.playerX,
        y: ctx.playerY,
        targetX: windUpTarget?.x,
        targetY: windUpTarget?.y,
        duration: windUpDuration,
      });
    }

    if (elapsed >= cooldown) {
      this.attack(ctx);
      this.lastFired = ctx.gameTime;
      this.windUpTriggered = false;
    }

    // Update any persistent effects (orbiting blades, auras, etc.)
    this.updateEffects(ctx);
  }

  /**
   * Override to provide a target position for directional wind-up effects.
   * Returns null for non-directional weapons.
   */
  protected getWindUpTarget(_ctx: WeaponContext): { x: number; y: number } | null {
    return null;
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
      this.refreshStats();
    }
  }

  /**
   * Recalculate stats based on current level and external multipliers.
   * Override for custom scaling.
   */
  protected recalculateStats(): void {
    const { levelDamageBonus, levelSizeBonus, levelCooldownReduction } = TUNING.weapons;
    const levelMultiplier = 1 + (this.level - 1) * levelDamageBonus;

    // Apply BOTH level multiplier AND external multiplier from meta progression
    this.stats.damage = this.baseStats.damage * levelMultiplier * this.externalDamageMultiplier;
    this.stats.size = this.baseStats.size * (1 + (this.level - 1) * levelSizeBonus);
    // Apply cooldown reduction from both level and external multiplier
    this.stats.cooldown = (this.baseStats.cooldown * Math.pow(levelCooldownReduction, this.level - 1)) / this.externalCooldownMultiplier;
    // Apply count bonuses from both level and external sources
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    // Apply piercing bonuses from both level and external sources
    this.stats.piercing = this.baseStats.piercing + Math.floor((this.level - 1) / 2) + this.externalBonusPiercing;
    // Reset range/speed to base so post-recalc external scaling is idempotent
    // rather than compounding. Subclasses that override recalculateStats set
    // their own absolute range/speed values after calling super().
    this.stats.range = this.baseStats.range;
    this.stats.speed = this.baseStats.speed;
  }

  /**
   * Recalculate stats, then layer external (player-global) and synergy scaling
   * on top. This is the single entry point used by levelUp / evolve /
   * applyMultipliers / setSynergyMultipliers so that scaling always survives a
   * subclass's recalculateStats() override.
   */
  private refreshStats(): void {
    this.recalculateStats();
    this.applyExternalScaling();
  }

  /**
   * Apply external multipliers on top of freshly recalculated stats.
   * recalculateStats() resets the affected fields each call, so this is
   * idempotent no matter how often it runs.
   */
  protected applyExternalScaling(): void {
    // Per-weapon-type mastery and synergy stack on top of damage (the global
    // damage multiplier is already folded into recalculateStats()).
    this.stats.damage *= this.externalMasteryDamageMultiplier * this.synergyDamageMultiplier;
    // Synergy cooldown is a direct multiplier on cooldown (e.g. 0.85 = "attack
    // 15% faster", matching the WeaponSynergies descriptions). Note this is the
    // opposite convention to the player's attackSpeed multiplier, which divides.
    this.stats.cooldown *= this.synergyCooldownMultiplier;
    // Range is a universal reach/area stat — applies to every weapon.
    this.stats.range *= this.externalRangeMultiplier;
    // Projectile speed only applies where `speed` means velocity.
    if (this.scalesProjectileSpeed) {
      this.stats.speed *= this.externalSpeedMultiplier;
    }
  }

  /**
   * Apply external stat multipliers and bonuses (from upgrades, etc.)
   * Stores the multipliers and recalculates all stats to incorporate them.
   */
  public applyMultipliers(
    damageMultiplier: number,
    cooldownMultiplier: number,
    bonusCount: number = 0,
    bonusPiercing: number = 0,
    rangeMultiplier: number = 1.0,
    speedMultiplier: number = 1.0,
    masteryDamageMultiplier: number = 1.0
  ): void {
    // Store external multipliers
    this.externalDamageMultiplier = damageMultiplier;
    this.externalCooldownMultiplier = cooldownMultiplier;
    this.externalBonusCount = bonusCount;
    this.externalBonusPiercing = bonusPiercing;
    this.externalRangeMultiplier = rangeMultiplier;
    this.externalSpeedMultiplier = speedMultiplier;
    this.externalMasteryDamageMultiplier = masteryDamageMultiplier;
    // Recalculate all stats with both level and external multipliers
    this.refreshStats();
  }

  /**
   * Set synergy multipliers (from equipped weapon pairs). Kept separate from
   * the global externals in applyMultipliers so the two stack instead of
   * overwriting one another.
   */
  public setSynergyMultipliers(damageMultiplier: number, cooldownMultiplier: number): void {
    this.synergyDamageMultiplier = damageMultiplier;
    this.synergyCooldownMultiplier = cooldownMultiplier;
    this.refreshStats();
  }

  /**
   * Evolve this weapon, applying permanent stat multipliers to base stats.
   */
  public evolve(evolvedName: string, statMultipliers: {
    damage?: number; cooldown?: number; range?: number;
    count?: number; piercing?: number; size?: number; speed?: number;
  }): void {
    this._evolved = true;
    this._evolvedName = evolvedName;

    // Apply multipliers to base stats permanently
    if (statMultipliers.damage) this.baseStats.damage *= statMultipliers.damage;
    if (statMultipliers.cooldown) this.baseStats.cooldown *= statMultipliers.cooldown;
    if (statMultipliers.range) this.baseStats.range *= statMultipliers.range;
    if (statMultipliers.size) this.baseStats.size *= statMultipliers.size;
    if (statMultipliers.speed) this.baseStats.speed *= statMultipliers.speed;
    // Additive bonuses for count and piercing
    if (statMultipliers.count) this.baseStats.count += statMultipliers.count;
    if (statMultipliers.piercing) this.baseStats.piercing += statMultipliers.piercing;

    this.refreshStats();
  }

  /** Whether this weapon has evolved. */
  public get isEvolved(): boolean { return this._evolved; }

  /** The evolved weapon name, or original name if not evolved. */
  public get displayName(): string { return this._evolved ? this._evolvedName : this.name; }

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

    // Standard scaling per level
    const nextLevel = this.level + 1;
    const damagePerLevel = TUNING.weapons.levelDamageBonus * 100;
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
