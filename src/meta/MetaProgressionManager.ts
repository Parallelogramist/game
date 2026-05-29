/**
 * MetaProgressionManager handles persistent progression data across game runs.
 * Manages gold currency and permanent upgrade purchases.
 * Uses SecureStorage for persistence (anti-cheat protection).
 */

import { calculateUpgradeCost, getPermanentUpgradeById, PERMANENT_UPGRADES, calculateAccountLevel } from '../data/PermanentUpgrades';
import { SecureStorage } from '../storage';
import { getAscensionManager } from './AscensionManager';

// SecureStorage keys
const STORAGE_KEY_GOLD = 'survivor-meta-gold';
const STORAGE_KEY_UPGRADES = 'survivor-meta-upgrades';
const STORAGE_KEY_WORLD_LEVEL = 'survivor-meta-world-level';
const STORAGE_KEY_STREAK = 'survivor-meta-streak';
const STORAGE_KEY_RUNS_COMPLETED = 'survivor-meta-runs-completed';
const STORAGE_KEY_ACHIEVEMENT_BONUSES = 'survivor-meta-achievement-bonuses';

/**
 * Cumulative permanent stat bonuses earned from achievements.
 */
interface AchievementBonusState {
  damage: number;         // % bonus to all damage
  health: number;         // Flat HP bonus
  speed: number;          // % speed bonus
  xp: number;             // % XP bonus
  gold: number;           // % gold bonus
  critChance: number;     // Flat crit chance bonus
  cooldown: number;       // % cooldown reduction
  dodge: number;          // % dodge bonus
  attackSpeed: number;    // % attack speed bonus
  allStats: number;       // % bonus to all stats
  startingLevel: number;  // Extra starting levels
}

function createDefaultAchievementBonuses(): AchievementBonusState {
  return {
    damage: 0, health: 0, speed: 0, xp: 0, gold: 0,
    critChance: 0, cooldown: 0, dodge: 0, attackSpeed: 0,
    allStats: 0, startingLevel: 0,
  };
}

// Streak constants
const MAX_STREAK_BONUS = 10; // Cap streak bonus at 10 victories
const STREAK_GOLD_BONUS_PER_LEVEL = 0.05; // +5% gold per streak level

/**
 * Tracks win streak state for gold bonuses.
 */
interface StreakState {
  currentStreak: number;
  bestStreak: number;
}

/**
 * Tracks the level of each permanent upgrade.
 * Uses a flexible Record type to support any upgrade ID.
 */
export type PermanentUpgradeState = Record<string, number>;

/**
 * Default state for new players - all upgrades start at 0.
 */
function createDefaultUpgradeState(): PermanentUpgradeState {
  const state: PermanentUpgradeState = {};
  for (const upgrade of PERMANENT_UPGRADES) {
    state[upgrade.id] = 0;
  }
  return state;
}

export class MetaProgressionManager {
  private goldBalance: number;
  private upgradeState: PermanentUpgradeState;
  private worldLevel: number;
  private streakState: StreakState;
  private runsCompleted: number;
  private achievementBonuses: AchievementBonusState;

  constructor() {
    this.goldBalance = this.loadGold();
    this.upgradeState = this.loadUpgradeState();
    this.worldLevel = this.loadWorldLevel();
    this.streakState = this.loadStreakState();
    this.runsCompleted = this.loadRunsCompleted();
    this.achievementBonuses = this.loadAchievementBonuses();
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  /** Read the level of a permanent upgrade (defaulting to 0). */
  private level(upgradeId: string): number {
    return this.upgradeState[upgradeId] ?? 0;
  }

  /**
   * "Big first level, smaller subsequent levels" bonus pattern.
   * Returns 0 when level is 0, else `firstLevelBonus + (level - 1) * perLevelBonus`.
   */
  private tieredBonus(upgradeId: string, firstLevelBonus: number, perLevelBonus: number): number {
    const upgradeLevel = this.level(upgradeId);
    if (upgradeLevel === 0) return 0;
    return firstLevelBonus + (upgradeLevel - 1) * perLevelBonus;
  }

  /** Gold cost of the `levelIndex`-th purchase of an upgrade (0-indexed). */
  private upgradeLevelCost(baseCost: number, costScaling: number, levelIndex: number): number {
    return Math.floor(baseCost * Math.pow(costScaling, levelIndex));
  }

  /** Sum of costs for levels 0..currentLevel-1 (total spent on an upgrade). */
  private totalSpentOnUpgrade(baseCost: number, costScaling: number, currentLevel: number): number {
    let total = 0;
    for (let levelIndex = 0; levelIndex < currentLevel; levelIndex++) {
      total += this.upgradeLevelCost(baseCost, costScaling, levelIndex);
    }
    return total;
  }

  /** Read and parse a stored integer, clamped to [min, max]. Returns fallback on any failure. */
  private readStoredInt(storageKey: string, fallback: number, min: number, max: number, warning: string): number {
    try {
      const stored = SecureStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return Math.max(min, Math.min(parsed, max));
      }
    } catch {
      console.warn(warning);
    }
    return fallback;
  }

  /** Write a primitive to SecureStorage, swallowing errors with a warning. */
  private writeStored(storageKey: string, value: string, warning: string): void {
    try {
      SecureStorage.setItem(storageKey, value);
    } catch {
      console.warn(warning);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Gold Management
  // ─────────────────────────────────────────────────────────────

  getGold(): number {
    return this.goldBalance;
  }

  addGold(amount: number): void {
    if (amount <= 0 || !Number.isFinite(amount)) return;
    this.goldBalance = Math.min(this.goldBalance + Math.floor(amount), 10_000_000);
    this.saveGold();
  }

  spendGold(amount: number): boolean {
    if (this.goldBalance >= amount) {
      this.goldBalance -= amount;
      this.saveGold();
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // Account Level (sum of all upgrade levels)
  // ─────────────────────────────────────────────────────────────

  getAccountLevel(): number {
    return calculateAccountLevel(this.upgradeState);
  }

  // ─────────────────────────────────────────────────────────────
  // World Level Management (Cross-Run Progression)
  // ─────────────────────────────────────────────────────────────

  /**
   * Returns the current world level (starts at 1).
   * Higher world levels have harder enemies but better rewards.
   */
  getWorldLevel(): number {
    return this.worldLevel;
  }

  /**
   * Advances to the next world level after defeating a boss.
   */
  advanceWorldLevel(): void {
    this.worldLevel++;
    this.saveWorldLevel();
  }

  /**
   * Returns enemy health multiplier for current world level.
   * Each level adds +15% HP.
   */
  getWorldLevelEnemyHealthMultiplier(): number {
    return 1 + (this.worldLevel - 1) * 0.15;
  }

  /**
   * Returns enemy damage multiplier for current world level.
   * Each level adds +10% damage.
   */
  getWorldLevelEnemyDamageMultiplier(): number {
    return 1 + (this.worldLevel - 1) * 0.10;
  }

  /**
   * Returns spawn time reduction for elite enemies (in seconds).
   * Each level makes elites spawn 10 seconds earlier, capped at 120s.
   */
  getWorldLevelSpawnTimeReduction(): number {
    return Math.min((this.worldLevel - 1) * 10, 120);
  }

  /**
   * Returns XP multiplier for current world level.
   * Each level adds +10% XP.
   */
  getWorldLevelXPMultiplier(): number {
    return 1 + (this.worldLevel - 1) * 0.10;
  }

  /**
   * Returns gold multiplier for current world level.
   * Each level adds +15% gold.
   */
  getWorldLevelGoldMultiplier(): number {
    return 1 + (this.worldLevel - 1) * 0.15;
  }

  // ─────────────────────────────────────────────────────────────
  // Streak System (Win Streak Gold Bonus)
  // ─────────────────────────────────────────────────────────────

  /**
   * Returns the current win streak.
   */
  getCurrentStreak(): number {
    return this.streakState.currentStreak;
  }

  /**
   * Returns the best win streak ever achieved.
   */
  getBestStreak(): number {
    return this.streakState.bestStreak;
  }

  /**
   * Returns the gold multiplier from win streak.
   * +5% gold per streak level, capped at +50% (10 streak).
   */
  getStreakGoldMultiplier(): number {
    const effectiveStreak = Math.min(this.streakState.currentStreak, MAX_STREAK_BONUS);
    return 1 + effectiveStreak * STREAK_GOLD_BONUS_PER_LEVEL;
  }

  /**
   * Returns the streak bonus percentage for display (e.g., "15%" for 3 streak).
   */
  getStreakBonusPercent(): number {
    const effectiveStreak = Math.min(this.streakState.currentStreak, MAX_STREAK_BONUS);
    return Math.round(effectiveStreak * STREAK_GOLD_BONUS_PER_LEVEL * 100);
  }

  /**
   * Increment the win streak after a victory.
   * Updates best streak if current exceeds it.
   */
  incrementStreak(): void {
    this.streakState.currentStreak++;
    if (this.streakState.currentStreak > this.streakState.bestStreak) {
      this.streakState.bestStreak = this.streakState.currentStreak;
    }
    this.saveStreakState();
  }

  /**
   * Reset the win streak (called on death before boss).
   */
  breakStreak(): void {
    this.streakState.currentStreak = 0;
    this.saveStreakState();
  }

  /**
   * Check if streak is currently active (> 0).
   */
  hasActiveStreak(): boolean {
    return this.streakState.currentStreak > 0;
  }

  // ─────────────────────────────────────────────────────────────
  // Upgrade Management
  // ─────────────────────────────────────────────────────────────

  getUpgradeLevel(upgradeId: string): number {
    return this.level(upgradeId);
  }

  getUpgradeCost(upgradeId: string): number {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return Infinity;
    return calculateUpgradeCost(upgrade, this.level(upgradeId));
  }

  purchaseUpgrade(upgradeId: string): boolean {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return false;

    const currentLevel = this.level(upgradeId);
    if (currentLevel >= upgrade.maxLevel) return false;
    if (this.getAccountLevel() < upgrade.unlockLevel) return false;

    const cost = calculateUpgradeCost(upgrade, currentLevel);
    if (this.goldBalance < cost) return false;

    this.goldBalance -= cost;
    this.upgradeState[upgradeId] = currentLevel + 1;
    this.saveGold();
    this.saveUpgradeState();
    return true;
  }

  /**
   * Check if an upgrade is unlocked based on account level.
   */
  isUpgradeUnlocked(upgradeId: string): boolean {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return false;
    return this.getAccountLevel() >= upgrade.unlockLevel;
  }

  /**
   * Returns the gold that would be refunded for removing one level of an upgrade.
   * Returns 0 if upgrade has no levels purchased.
   */
  getRefundAmount(upgradeId: string): number {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return 0;
    const currentLevel = this.level(upgradeId);
    if (currentLevel <= 0) return 0;
    return this.upgradeLevelCost(upgrade.baseCost, upgrade.costScaling, currentLevel - 1);
  }

  /**
   * Refund a single level of an upgrade, returning the gold spent on that level.
   * Returns the amount of gold refunded (0 if nothing to refund).
   */
  refundUpgradeLevel(upgradeId: string): number {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return 0;

    const currentLevel = this.level(upgradeId);
    if (currentLevel <= 0) return 0;

    const refundAmount = this.upgradeLevelCost(upgrade.baseCost, upgrade.costScaling, currentLevel - 1);

    this.goldBalance += refundAmount;
    this.upgradeState[upgradeId] = currentLevel - 1;
    this.saveGold();
    this.saveUpgradeState();
    return refundAmount;
  }

  /**
   * Refund all levels of an upgrade, returning the total gold spent.
   * Returns the total amount of gold refunded (0 if nothing to refund).
   */
  refundUpgradeFully(upgradeId: string): number {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return 0;

    const currentLevel = this.level(upgradeId);
    if (currentLevel <= 0) return 0;

    const totalRefund = this.totalSpentOnUpgrade(upgrade.baseCost, upgrade.costScaling, currentLevel);

    this.goldBalance += totalRefund;
    this.upgradeState[upgradeId] = 0;
    this.saveGold();
    this.saveUpgradeState();
    return totalRefund;
  }

  /**
   * Reset all upgrades and refund all gold spent. Used by Ascension system.
   * Returns total gold refunded.
   */
  resetAllUpgradesAndRefund(): number {
    let totalRefund = 0;
    for (const upgrade of PERMANENT_UPGRADES) {
      totalRefund += this.totalSpentOnUpgrade(upgrade.baseCost, upgrade.costScaling, this.level(upgrade.id));
      this.upgradeState[upgrade.id] = 0;
    }
    this.goldBalance += totalRefund;
    this.saveGold();
    this.saveUpgradeState();
    return totalRefund;
  }

  // ─────────────────────────────────────────────────────────────
  // Starting Stat Calculations (applied at game start)
  // ─────────────────────────────────────────────────────────────

  // ═══ OFFENSE ═══

  /**
   * Returns the damage multiplier bonus from permanent upgrades.
   * Level 1 gives +10%, subsequent levels give +5% each.
   */
  getStartingDamageMultiplier(): number {
    return 1 + this.tieredBonus('damageLevel', 0.10, 0.05);
  }

  /**
   * Returns the attack speed multiplier bonus from permanent upgrades.
   * Level 1 gives +15%, subsequent levels give +8% each.
   */
  getStartingAttackSpeedMultiplier(): number {
    return 1 + this.tieredBonus('attackSpeedLevel', 0.15, 0.08);
  }

  /**
   * Returns the starting projectile count bonus.
   * Each level gives +1 projectile.
   */
  getStartingProjectileCount(): number {
    return this.level('projectileCountLevel');
  }

  /**
   * Returns the starting piercing bonus from permanent upgrades.
   * Each level gives +1 piercing.
   */
  getStartingPiercing(): number {
    return this.level('piercingLevel');
  }

  /**
   * Returns the critical hit chance bonus.
   * Each level gives +3% crit chance.
   */
  getStartingCritChance(): number {
    return this.level('critChanceLevel') * 0.03;
  }

  /**
   * Returns the critical hit damage multiplier.
   * Base is 1.5x (150%), each level adds +15%.
   */
  getStartingCritDamage(): number {
    return 1.5 + this.level('critDamageLevel') * 0.15;
  }

  /**
   * Returns the projectile speed multiplier.
   * Each level gives +10%.
   */
  getStartingProjectileSpeed(): number {
    return 1 + this.level('projectileSpeedLevel') * 0.1;
  }

  /**
   * Returns the area multiplier.
   * Each level gives +8%.
   */
  getStartingArea(): number {
    return 1 + this.level('areaLevel') * 0.08;
  }

  /**
   * Returns the duration multiplier.
   * Each level gives +12%.
   */
  getStartingDuration(): number {
    return 1 + this.level('durationLevel') * 0.12;
  }

  /**
   * Returns the cooldown reduction multiplier (lower is better).
   * Each level gives -5%.
   */
  getStartingCooldownMultiplier(): number {
    return Math.max(0.5, 1 - this.level('cooldownLevel') * 0.05);
  }

  // ═══ DEFENSE ═══

  /**
   * Returns the bonus HP from permanent upgrades.
   * Level 1 gives +25 HP, subsequent levels give +10 HP each.
   */
  getStartingBonusHealth(): number {
    return this.tieredBonus('healthLevel', 25, 10);
  }

  /**
   * Returns the armor (flat damage reduction).
   * Level 1 gives 3 armor, subsequent levels give +1 each.
   */
  getStartingArmor(): number {
    return this.tieredBonus('armorLevel', 3, 1);
  }

  /**
   * Returns HP regeneration per second.
   * Level 1 gives +1.5 HP/sec, subsequent levels give +0.5 HP/sec each.
   */
  getStartingRegen(): number {
    return this.tieredBonus('regenLevel', 1.5, 0.5);
  }

  /**
   * Returns dodge chance.
   * Each level gives +5%, max 30%.
   */
  getStartingDodgeChance(): number {
    return Math.min(0.3, this.level('dodgeLevel') * 0.05);
  }

  /**
   * Returns life steal percentage.
   * Each level gives +1%.
   */
  getStartingLifeSteal(): number {
    return this.level('lifeStealLevel') * 0.01;
  }

  /**
   * Returns bonus invincibility frames in seconds.
   * Each level gives +0.1s.
   */
  getStartingIFrameBonus(): number {
    return this.level('iframeLevel') * 0.1;
  }

  /**
   * Returns revival count per run.
   */
  getStartingRevivals(): number {
    return this.level('revivalLevel');
  }

  // ═══ MOVEMENT ═══

  /**
   * Returns the move speed multiplier bonus from permanent upgrades.
   * Level 1 gives +10%, subsequent levels give +5% each.
   */
  getStartingMoveSpeedMultiplier(): number {
    return 1 + this.tieredBonus('moveSpeedLevel', 0.10, 0.05);
  }

  // ═══ RESOURCES ═══

  /**
   * Returns the XP gain multiplier.
   * Level 1 gives +12%, subsequent levels give +5% each.
   */
  getStartingXPMultiplier(): number {
    return 1 + this.tieredBonus('xpGainLevel', 0.12, 0.05);
  }

  /**
   * Returns the pickup range multiplier.
   * Level 1 gives +30%, subsequent levels give +15% each.
   */
  getStartingPickupRangeMultiplier(): number {
    return 1 + this.tieredBonus('pickupRangeLevel', 0.30, 0.15);
  }

  /**
   * Returns the gold gain multiplier.
   * Each level gives +10%.
   */
  getStartingGoldMultiplier(): number {
    return 1 + this.level('goldGainLevel') * 0.1;
  }

  /**
   * Returns the starting level bonus.
   */
  getStartingLevel(): number {
    return 1 + this.level('startingXPLevel');
  }

  // ═══ UTILITY ═══

  /**
   * Returns the number of rerolls per run.
   * Each level gives +2 rerolls.
   */
  getStartingRerolls(): number {
    return this.level('rerollLevel') * 2;
  }

  /**
   * Returns the number of extra upgrade choices.
   * Each level gives +1 choice.
   */
  getStartingExtraChoices(): number {
    return this.level('choiceLevel');
  }

  /**
   * Returns the number of skips per run.
   */
  getStartingSkips(): number {
    return this.level('skipLevel');
  }

  /**
   * Returns the number of banishes per run.
   */
  getStartingBanishes(): number {
    return this.level('banishLevel');
  }

  // ═══ ELEMENTAL ═══

  /**
   * Returns burn chance.
   * Each level gives +5%.
   */
  getStartingBurnChance(): number {
    return this.level('fireLevel') * 0.05;
  }

  /**
   * Returns freeze chance.
   * Each level gives +3%.
   */
  getStartingFreezeChance(): number {
    return this.level('iceLevel') * 0.03;
  }

  /**
   * Returns chain lightning chance.
   * Each level gives +4%.
   */
  getStartingChainLightningChance(): number {
    return this.level('lightningLevel') * 0.04;
  }

  /**
   * Returns poison chance.
   * Each level gives +5%.
   */
  getStartingPoisonChance(): number {
    return this.level('poisonLevel') * 0.05;
  }

  // ═══ OFFENSE (ADVANCED) ═══

  /**
   * Returns knockback multiplier.
   * Each level gives +10%.
   */
  getStartingKnockback(): number {
    return 1 + this.level('knockbackLevel') * 0.1;
  }

  /**
   * Returns execution bonus damage to low HP enemies.
   * Each level gives +10% bonus damage to enemies below 25% HP.
   */
  getStartingExecutionBonus(): number {
    return this.level('executionLevel') * 0.1;
  }

  /**
   * Returns overkill splash percentage.
   * Each level gives 25% overkill splash.
   */
  getStartingOverkillSplash(): number {
    return this.level('overkillLevel') * 0.25;
  }

  /**
   * Returns armor penetration percentage.
   * Each level ignores 10% enemy armor.
   */
  getStartingArmorPen(): number {
    return this.level('armorPenLevel') * 0.1;
  }

  // ═══ DEFENSE (ADVANCED) ═══

  /**
   * Returns thorns reflect percentage.
   * Each level reflects 10% damage.
   */
  getStartingThorns(): number {
    return this.level('thornLevel') * 0.1;
  }

  /**
   * Returns starting shield amount.
   * Each level gives +20 shield.
   */
  getStartingShield(): number {
    return this.level('shieldLevel') * 20;
  }

  /**
   * Returns healing boost multiplier.
   * Each level gives +20% healing received.
   */
  getStartingHealingBoost(): number {
    return 1 + this.level('healingBoostLevel') * 0.2;
  }

  /**
   * Returns emergency heal percentage.
   * Each level heals 15% when below 20% HP.
   */
  getStartingEmergencyHeal(): number {
    return this.level('emergencyHealLevel') * 0.15;
  }

  /**
   * Returns damage cap as percentage of max HP.
   * Each level reduces cap by 15% (1.0 = 100%, 0.85 = 85%, etc.)
   */
  getStartingDamageCap(): number {
    return 1 - this.level('damageCapLevel') * 0.15;
  }

  /**
   * Returns bonus max shield barrier charges from permanent upgrades.
   * Each level gives +1 max shield charge.
   */
  getStartingBarrierCapacity(): number {
    return this.level('barrierCapacityLevel');
  }

  // ═══ MOVEMENT (ADVANCED) ═══

  /**
   * Returns acceleration multiplier.
   * Each level gives +20% acceleration.
   */
  getStartingAcceleration(): number {
    return 1 + this.level('accelerationLevel') * 0.2;
  }

  /**
   * Returns slow resistance.
   * Each level gives 15% slow resistance.
   */
  getStartingSlowResist(): number {
    return this.level('slowResistLevel') * 0.15;
  }

  /**
   * Returns sprint speed bonus when not attacking.
   * Each level gives +8% speed when idle.
   */
  getStartingSprint(): number {
    return this.level('sprintLevel') * 0.08;
  }

  /**
   * Returns combat speed bonus per nearby enemy.
   * Each level gives +5% speed per enemy (max 25%).
   */
  getStartingCombatSpeed(): number {
    return this.level('combatSpeedLevel') * 0.05;
  }

  /**
   * Returns dash cooldown in seconds.
   * Base is 8s, each level reduces by 1s.
   * Returns 0 if no dash ability.
   */
  getStartingDashCooldown(): number {
    const dashLevel = this.level('dashLevel');
    return dashLevel > 0 ? 8 - dashLevel : 0;
  }

  /**
   * Returns phase chance while moving.
   * Each level gives 3% chance to phase through attacks.
   */
  getStartingPhaseChance(): number {
    return this.level('phaseLevel') * 0.03;
  }

  // ═══ RESOURCES (ADVANCED) ═══

  /**
   * Returns gem value multiplier.
   * Each level gives +10% gem value.
   */
  getStartingGemValueBonus(): number {
    return 1 + this.level('gemValueLevel') * 0.1;
  }

  /**
   * Returns drop rate multiplier.
   * Each level gives +5% drop rate.
   */
  getStartingDropRateBonus(): number {
    return 1 + this.level('dropRateLevel') * 0.05;
  }

  /**
   * Returns health drop rate multiplier.
   * Each level gives +20% health drop rate.
   */
  getStartingHealthDropBonus(): number {
    return 1 + this.level('healthDropLevel') * 0.2;
  }

  /**
   * Returns gem magnet interval in seconds.
   * Level 0 = no magnet, each level: 15s, 12s, 9s.
   */
  getStartingGemMagnetInterval(): number {
    const magnetLevel = this.level('gemMagnetLevel');
    return magnetLevel > 0 ? 15 - magnetLevel * 3 : 0;
  }

  /**
   * Returns treasure chest interval in seconds.
   * Level 0 = no chests, each level: 120s, 100s, 80s.
   */
  getStartingTreasureInterval(): number {
    const treasureLevel = this.level('treasureLevel');
    return treasureLevel > 0 ? 120 - treasureLevel * 20 : 0;
  }

  /**
   * Returns chest drone magnetization delay in seconds.
   * Level 0 = disabled (-1), levels 1-3: 5s, 2s, 0s delay.
   */
  getStartingChestDroneDelay(): number {
    const droneLevel = this.level('chestDroneLevel');
    if (droneLevel >= 3) return 0;
    if (droneLevel === 2) return 2;
    if (droneLevel === 1) return 5;
    return -1;
  }

  /**
   * Returns boss gold multiplier.
   * Each level gives +50% gold from bosses.
   */
  getStartingBossGoldBonus(): number {
    return 1 + this.level('bossGoldLevel') * 0.5;
  }

  // ═══ UTILITY (ADVANCED) ═══

  /**
   * Returns luck bonus for rare upgrades.
   * Each level gives +10% rare upgrade chance.
   */
  getStartingLuckBonus(): number {
    return this.level('luckLevel') * 0.1;
  }

  /**
   * Returns number of upgrades to keep between runs.
   */
  getStartingUpgradeKeep(): number {
    return this.level('upgradeKeepLevel');
  }

  /**
   * Returns slow time duration in minutes.
   * First N minutes at 75% speed.
   */
  getStartingSlowTimeMinutes(): number {
    return this.level('slowTimeLevel');
  }

  /**
   * Returns curse level (harder enemies, better rewards).
   * Each level: +15% enemy stats & rewards.
   */
  getStartingCurseLevel(): number {
    return this.level('curseLevel');
  }

  /**
   * Returns blessing count (random buffs at run start).
   */
  getStartingBlessingCount(): number {
    return this.level('blessingLevel');
  }

  /**
   * Returns auto-upgrade tier level (0-4).
   * 0 = not purchased (toggle hidden)
   * 1 = basic weighted selection
   * 2 = +gate planning intelligence
   * 3 = +health-adaptive intelligence
   * 4 = +weapon synergy intelligence
   */
  getAutoUpgradeLevel(): number {
    return this.level('autoUpgrade');
  }

  // ═══ ELEMENTAL (ADVANCED) ═══

  /**
   * Returns burn damage multiplier.
   * Each level gives +25% burn damage.
   */
  getStartingBurnDamageBonus(): number {
    return 1 + this.level('burnDamageLevel') * 0.25;
  }

  /**
   * Returns freeze duration multiplier.
   * Each level gives +20% freeze duration.
   */
  getStartingFreezeDurationBonus(): number {
    return 1 + this.level('freezeDurationLevel') * 0.2;
  }

  /**
   * Returns extra chain lightning targets.
   */
  getStartingChainCount(): number {
    return this.level('chainCountLevel');
  }

  /**
   * Returns extra max poison stacks.
   */
  getStartingPoisonMaxStacks(): number {
    return this.level('poisonStackLevel');
  }

  /**
   * Returns explosion damage on burning enemy death.
   * Each level gives 50% of max HP as explosion damage.
   */
  getStartingExplosionDamage(): number {
    return this.level('explosionLevel') * 0.5;
  }

  /**
   * Returns bonus damage to frozen enemies.
   * Each level gives +30% damage to frozen.
   */
  getStartingShatterBonus(): number {
    return this.level('shatterLevel') * 0.3;
  }

  /**
   * Returns overcharge stun duration in seconds.
   * Each level gives 0.3s stun on lightning chain.
   */
  getStartingOverchargeStun(): number {
    return this.level('overchargeLevel') * 0.3;
  }

  /**
   * Returns pandemic spread count on poison death.
   */
  getStartingPandemicSpread(): number {
    return this.level('pandemicLevel');
  }

  // ═══ MASTERY ═══

  /**
   * Returns projectile weapon damage multiplier.
   * Each level gives +10%.
   */
  getStartingProjectileMastery(): number {
    return 1 + this.level('projectileMasteryLevel') * 0.1;
  }

  /**
   * Returns melee weapon damage multiplier.
   * Each level gives +10%.
   */
  getStartingMeleeMastery(): number {
    return 1 + this.level('meleeMasteryLevel') * 0.1;
  }

  /**
   * Returns aura weapon damage multiplier.
   * Each level gives +10%.
   */
  getStartingAuraMastery(): number {
    return 1 + this.level('auraMasteryLevel') * 0.1;
  }

  /**
   * Returns summon/drone damage multiplier.
   * Each level gives +15%.
   */
  getStartingSummonMastery(): number {
    return 1 + this.level('summonMasteryLevel') * 0.15;
  }

  /**
   * Returns extra weapon slots.
   */
  getStartingWeaponSlots(): number {
    return this.level('weaponSlotLevel');
  }

  /**
   * Returns orbital weapon speed and damage multiplier.
   * Each level gives +15%.
   */
  getStartingOrbitalMastery(): number {
    return 1 + this.level('orbitalMasteryLevel') * 0.15;
  }

  /**
   * Returns explosive area and damage multiplier.
   * Each level gives +10%.
   */
  getStartingExplosiveMastery(): number {
    return 1 + this.level('explosiveMasteryLevel') * 0.1;
  }

  /**
   * Returns beam damage and width multiplier.
   * Each level gives +10%.
   */
  getStartingBeamMastery(): number {
    return 1 + this.level('beamMasteryLevel') * 0.1;
  }

  /**
   * Returns weapon evolution level reduction.
   * Each level reduces evolution requirement by 1.
   */
  getStartingEvolutionBonus(): number {
    return this.level('weaponEvolutionLevel');
  }

  /**
   * Returns weapon synergy bonus per weapon.
   * Each level gives +3% damage per weapon owned.
   */
  getStartingSynergyBonus(): number {
    return this.level('weaponSynergyLevel') * 0.03;
  }

  /**
   * Returns ultimate mastery (all weapons bonus).
   * Each level gives +5% to all weapon stats.
   */
  getStartingUltimateMastery(): number {
    return 1 + this.level('ultimateMasteryLevel') * 0.05;
  }

  // ─────────────────────────────────────────────────────────────
  // Gold Calculation from Run
  // ─────────────────────────────────────────────────────────────

  /**
   * Calculate gold earned from a completed run.
   * Formula:
   *   killGold = kills × 2.5
   *   timeGold = seconds ÷ 10
   *   levelGold = level × 10
   *   base = killGold + timeGold + levelGold
   *   total = base × victoryMultiplier × goldMultiplier × worldLevelMultiplier × streakMultiplier
   */
  calculateRunGold(
    killCount: number,
    gameTimeSeconds: number,
    playerLevel: number,
    hasWon: boolean,
    runGoldMultiplier: number = 1
  ): number {
    const killGold = Math.floor(killCount * 2.5);
    const timeGold = Math.floor(gameTimeSeconds / 10);
    const levelGold = playerLevel * 10;

    // Minimum gold floor to prevent zero-progress runs
    let totalGold = Math.max(killGold + timeGold + levelGold, 50);

    // Victory bonus (defeated boss)
    if (hasWon) {
      totalGold = Math.floor(totalGold * 1.5);
    }

    // Run-level gold multiplier (ship + stage + pacts + run modifiers, carried
    // on PlayerStats.goldMultiplier). Shop/world/streak/etc. are applied below.
    if (runGoldMultiplier !== 1) {
      totalGold = Math.floor(totalGold * runGoldMultiplier);
    }

    // Apply gold gain multiplier from upgrades
    totalGold = Math.floor(totalGold * this.getStartingGoldMultiplier());

    // Apply world level gold multiplier
    totalGold = Math.floor(totalGold * this.getWorldLevelGoldMultiplier());

    // Apply streak gold multiplier (+5% per streak, max +50%)
    totalGold = Math.floor(totalGold * this.getStreakGoldMultiplier());

    // Apply achievement gold bonus
    const achievementGoldBonus = this.achievementBonuses.gold;
    if (achievementGoldBonus > 0) {
      totalGold = Math.floor(totalGold * (1 + achievementGoldBonus / 100));
    }

    // Apply ascension gold multiplier
    const ascensionGoldMult = getAscensionManager().getGoldMultiplier();
    if (ascensionGoldMult > 1) {
      totalGold = Math.floor(totalGold * ascensionGoldMult);
    }

    // Newcomer bonus for first 10 runs (tapering multiplier)
    const newcomerMultiplier = this.getNewcomerMultiplier();
    if (newcomerMultiplier > 1) {
      totalGold = Math.floor(totalGold * newcomerMultiplier);
    }

    // Track completed runs for newcomer bonus
    this.runsCompleted++;
    this.saveRunsCompleted();

    return totalGold;
  }

  /**
   * Returns the newcomer gold multiplier based on completed runs.
   * Tapering bonus: 3x for first run down to 1.25x for runs 6-10, then 1x.
   */
  getNewcomerMultiplier(): number {
    const NEWCOMER_TIERS = [3.0, 2.5, 2.0, 1.75, 1.5];
    const completedRuns = this.runsCompleted;
    if (completedRuns < NEWCOMER_TIERS.length) return NEWCOMER_TIERS[completedRuns];
    if (completedRuns < 10) return 1.25;
    return 1;
  }

  getRunsCompleted(): number {
    return this.runsCompleted;
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence (SecureStorage)
  // ─────────────────────────────────────────────────────────────

  private loadGold(): number {
    return this.readStoredInt(STORAGE_KEY_GOLD, 0, 0, 10_000_000, 'Could not load gold from storage');
  }

  private saveGold(): void {
    this.writeStored(STORAGE_KEY_GOLD, String(this.goldBalance), 'Could not save gold to storage');
  }

  private loadUpgradeState(): PermanentUpgradeState {
    const defaultState = createDefaultUpgradeState();
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_UPGRADES);
      if (stored) {
        const parsed = JSON.parse(stored) as PermanentUpgradeState;
        // Merge with defaults to handle new upgrades
        const merged = {
          ...defaultState,
          ...parsed,
        };
        // Clamp each upgrade level to valid range
        for (const upgrade of PERMANENT_UPGRADES) {
          if (merged[upgrade.id] !== undefined) {
            merged[upgrade.id] = Math.max(0, Math.min(merged[upgrade.id], upgrade.maxLevel));
          }
        }
        return merged;
      }
    } catch {
      console.warn('Could not load upgrade state from storage');
    }
    return defaultState;
  }

  private saveUpgradeState(): void {
    this.writeStored(STORAGE_KEY_UPGRADES, JSON.stringify(this.upgradeState), 'Could not save upgrade state to storage');
  }

  private loadWorldLevel(): number {
    return this.readStoredInt(STORAGE_KEY_WORLD_LEVEL, 1, 1, 50, 'Could not load world level from storage');
  }

  private saveWorldLevel(): void {
    this.writeStored(STORAGE_KEY_WORLD_LEVEL, String(this.worldLevel), 'Could not save world level to storage');
  }

  private loadStreakState(): StreakState {
    const defaultState: StreakState = { currentStreak: 0, bestStreak: 0 };
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_STREAK);
      if (stored) {
        const parsed = JSON.parse(stored) as StreakState;
        return {
          currentStreak: Math.max(0, Math.min(parsed.currentStreak ?? 0, MAX_STREAK_BONUS)),
          bestStreak: Math.max(0, Math.min(parsed.bestStreak ?? 0, MAX_STREAK_BONUS)),
        };
      }
    } catch {
      console.warn('Could not load streak state from storage');
    }
    return defaultState;
  }

  private saveStreakState(): void {
    this.writeStored(STORAGE_KEY_STREAK, JSON.stringify(this.streakState), 'Could not save streak state to storage');
  }

  private loadRunsCompleted(): number {
    return this.readStoredInt(STORAGE_KEY_RUNS_COMPLETED, 0, 0, Number.MAX_SAFE_INTEGER, 'Could not load runs completed from storage');
  }

  private saveRunsCompleted(): void {
    this.writeStored(STORAGE_KEY_RUNS_COMPLETED, String(this.runsCompleted), 'Could not save runs completed to storage');
  }

  private loadAchievementBonuses(): AchievementBonusState {
    const defaults = createDefaultAchievementBonuses();
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_ACHIEVEMENT_BONUSES);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AchievementBonusState>;
        const merged = { ...defaults, ...parsed };
        const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
        const MAX_PERCENT_BONUS = 100;
        const percentFields: (keyof AchievementBonusState)[] = [
          'damage', 'health', 'speed', 'xp', 'gold',
          'critChance', 'cooldown', 'dodge', 'attackSpeed', 'allStats',
        ];
        for (const field of percentFields) {
          merged[field] = clamp(merged[field], MAX_PERCENT_BONUS);
        }
        merged.startingLevel = clamp(merged.startingLevel, 10);
        return merged;
      }
    } catch {
      console.warn('Could not load achievement bonuses from storage');
    }
    return defaults;
  }

  private saveAchievementBonuses(): void {
    this.writeStored(STORAGE_KEY_ACHIEVEMENT_BONUSES, JSON.stringify(this.achievementBonuses), 'Could not save achievement bonuses to storage');
  }

  /**
   * Add a permanent stat bonus from an achievement reward.
   */
  addAchievementBonus(bonusId: string, value: number): void {
    if (bonusId in this.achievementBonuses) {
      (this.achievementBonuses as unknown as Record<string, number>)[bonusId] += value;
      this.saveAchievementBonuses();
    }
  }

  /**
   * Get all achievement stat bonuses for applying at run start.
   */
  getAchievementBonuses(): AchievementBonusState {
    return { ...this.achievementBonuses };
  }

  /**
   * Reset all progress (for debugging or new game).
   */
  resetProgress(): void {
    this.goldBalance = 0;
    this.upgradeState = createDefaultUpgradeState();
    this.worldLevel = 1;
    this.streakState = { currentStreak: 0, bestStreak: 0 };
    this.saveGold();
    this.saveUpgradeState();
    this.saveWorldLevel();
    this.saveStreakState();
  }

  /**
   * Find the next affordable or nearest-to-affordable upgrade for post-run teaser.
   * Returns the cheapest buyable upgrade, or the one closest to being affordable.
   */
  getNextAffordableUpgrade(): { name: string; cost: number; canAfford: boolean; goldNeeded: number } | null {
    type UpgradeTeaser = { name: string; cost: number; canAfford: boolean; goldNeeded: number };

    const currentGold = this.goldBalance;
    const accountLevel = this.getAccountLevel();
    let bestAffordable: UpgradeTeaser | null = null;
    let closestUnaffordable: UpgradeTeaser | null = null;

    for (const upgrade of PERMANENT_UPGRADES) {
      const currentLevel = this.level(upgrade.id);
      if (currentLevel >= upgrade.maxLevel) continue;
      if (accountLevel < upgrade.unlockLevel) continue;

      const cost = calculateUpgradeCost(upgrade, currentLevel);

      if (currentGold >= cost) {
        if (!bestAffordable || cost < bestAffordable.cost) {
          bestAffordable = { name: upgrade.name, cost, canAfford: true, goldNeeded: 0 };
        }
      } else {
        const goldNeeded = cost - currentGold;
        if (!closestUnaffordable || goldNeeded < closestUnaffordable.goldNeeded) {
          closestUnaffordable = { name: upgrade.name, cost, canAfford: false, goldNeeded };
        }
      }
    }

    return bestAffordable || closestUnaffordable;
  }

}

// ─────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────

let metaProgressionInstance: MetaProgressionManager | null = null;

/**
 * Get the singleton MetaProgressionManager instance.
 */
export function getMetaProgressionManager(): MetaProgressionManager {
  if (!metaProgressionInstance) {
    metaProgressionInstance = new MetaProgressionManager();
  }
  return metaProgressionInstance;
}
