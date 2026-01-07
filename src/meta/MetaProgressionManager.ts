/**
 * MetaProgressionManager handles persistent progression data across game runs.
 * Manages gold currency and permanent upgrade purchases.
 * Uses encrypted localStorage for persistence (anti-cheat protection).
 */

import { calculateUpgradeCost, getPermanentUpgradeById, PERMANENT_UPGRADES, calculateAccountLevel } from '../data/PermanentUpgrades';
import { SecureStorage } from '../storage';

// localStorage keys
const STORAGE_KEY_GOLD = 'survivor-meta-gold';
const STORAGE_KEY_UPGRADES = 'survivor-meta-upgrades';
const STORAGE_KEY_WORLD_LEVEL = 'survivor-meta-world-level';
const STORAGE_KEY_STREAK = 'survivor-meta-streak';

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

  constructor() {
    this.goldBalance = this.loadGold();
    this.upgradeState = this.loadUpgradeState();
    this.worldLevel = this.loadWorldLevel();
    this.streakState = this.loadStreakState();
  }

  // ─────────────────────────────────────────────────────────────
  // Gold Management
  // ─────────────────────────────────────────────────────────────

  getGold(): number {
    return this.goldBalance;
  }

  addGold(amount: number): void {
    this.goldBalance += amount;
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
    return effectiveStreak * STREAK_GOLD_BONUS_PER_LEVEL * 100;
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
    return this.upgradeState[upgradeId] ?? 0;
  }

  getUpgradeCost(upgradeId: string): number {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return Infinity;
    return calculateUpgradeCost(upgrade, this.upgradeState[upgradeId] ?? 0);
  }

  purchaseUpgrade(upgradeId: string): boolean {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return false;

    const currentLevel = this.upgradeState[upgradeId] ?? 0;
    if (currentLevel >= upgrade.maxLevel) return false;

    // Check account level requirement
    const accountLevel = this.getAccountLevel();
    if (accountLevel < upgrade.unlockLevel) return false;

    const cost = calculateUpgradeCost(upgrade, currentLevel);
    if (this.goldBalance < cost) return false;

    // Purchase successful
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
    const currentLevel = this.upgradeState[upgradeId] ?? 0;
    if (currentLevel <= 0) return 0;
    return Math.floor(upgrade.baseCost * Math.pow(upgrade.costScaling, currentLevel - 1));
  }

  /**
   * Refund a single level of an upgrade, returning the gold spent on that level.
   * Returns the amount of gold refunded (0 if nothing to refund).
   */
  refundUpgradeLevel(upgradeId: string): number {
    const upgrade = getPermanentUpgradeById(upgradeId);
    if (!upgrade) return 0;

    const currentLevel = this.upgradeState[upgradeId] ?? 0;
    if (currentLevel <= 0) return 0;

    // Refund = cost of the last purchased level = baseCost × costScaling^(currentLevel-1)
    const refundAmount = Math.floor(upgrade.baseCost * Math.pow(upgrade.costScaling, currentLevel - 1));

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

    const currentLevel = this.upgradeState[upgradeId] ?? 0;
    if (currentLevel <= 0) return 0;

    // Sum all costs: baseCost × costScaling^i for i = 0 to currentLevel-1
    let totalRefund = 0;
    for (let i = 0; i < currentLevel; i++) {
      totalRefund += Math.floor(upgrade.baseCost * Math.pow(upgrade.costScaling, i));
    }

    this.goldBalance += totalRefund;
    this.upgradeState[upgradeId] = 0;
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
   * Each level gives +5% (0.05) damage.
   */
  getStartingDamageMultiplier(): number {
    return 1 + (this.upgradeState['damageLevel'] ?? 0) * 0.05;
  }

  /**
   * Returns the attack speed multiplier bonus from permanent upgrades.
   * Each level gives +8% (0.08) attack speed.
   */
  getStartingAttackSpeedMultiplier(): number {
    return 1 + (this.upgradeState['attackSpeedLevel'] ?? 0) * 0.08;
  }

  /**
   * Returns the starting projectile count bonus.
   * Each level gives +1 projectile.
   */
  getStartingProjectileCount(): number {
    return this.upgradeState['projectileCountLevel'] ?? 0;
  }

  /**
   * Returns the starting piercing bonus from permanent upgrades.
   * Each level gives +1 piercing.
   */
  getStartingPiercing(): number {
    return this.upgradeState['piercingLevel'] ?? 0;
  }

  /**
   * Returns the critical hit chance bonus.
   * Each level gives +3% crit chance.
   */
  getStartingCritChance(): number {
    return (this.upgradeState['critChanceLevel'] ?? 0) * 0.03;
  }

  /**
   * Returns the critical hit damage multiplier.
   * Base is 2.0x (200%), each level adds +15%.
   */
  getStartingCritDamage(): number {
    return 2.0 + (this.upgradeState['critDamageLevel'] ?? 0) * 0.15;
  }

  /**
   * Returns the projectile speed multiplier.
   * Each level gives +10%.
   */
  getStartingProjectileSpeed(): number {
    return 1 + (this.upgradeState['projectileSpeedLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns the area multiplier.
   * Each level gives +8%.
   */
  getStartingArea(): number {
    return 1 + (this.upgradeState['areaLevel'] ?? 0) * 0.08;
  }

  /**
   * Returns the duration multiplier.
   * Each level gives +12%.
   */
  getStartingDuration(): number {
    return 1 + (this.upgradeState['durationLevel'] ?? 0) * 0.12;
  }

  /**
   * Returns the cooldown reduction multiplier (lower is better).
   * Each level gives -5%.
   */
  getStartingCooldownMultiplier(): number {
    return Math.max(0.5, 1 - (this.upgradeState['cooldownLevel'] ?? 0) * 0.05);
  }

  // ═══ DEFENSE ═══

  /**
   * Returns the bonus HP from permanent upgrades.
   * Each level gives +10 HP.
   */
  getStartingBonusHealth(): number {
    return (this.upgradeState['healthLevel'] ?? 0) * 10;
  }

  /**
   * Returns the armor (flat damage reduction).
   * Each level gives +1 armor.
   */
  getStartingArmor(): number {
    return this.upgradeState['armorLevel'] ?? 0;
  }

  /**
   * Returns HP regeneration per second.
   * Each level gives +0.5 HP/sec.
   */
  getStartingRegen(): number {
    return (this.upgradeState['regenLevel'] ?? 0) * 0.5;
  }

  /**
   * Returns dodge chance.
   * Each level gives +5%, max 30%.
   */
  getStartingDodgeChance(): number {
    return Math.min(0.3, (this.upgradeState['dodgeLevel'] ?? 0) * 0.05);
  }

  /**
   * Returns life steal percentage.
   * Each level gives +1%.
   */
  getStartingLifeSteal(): number {
    return (this.upgradeState['lifeStealLevel'] ?? 0) * 0.01;
  }

  /**
   * Returns bonus invincibility frames in seconds.
   * Each level gives +0.1s.
   */
  getStartingIFrameBonus(): number {
    return (this.upgradeState['iframeLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns revival count per run.
   */
  getStartingRevivals(): number {
    return this.upgradeState['revivalLevel'] ?? 0;
  }

  // ═══ MOVEMENT ═══

  /**
   * Returns the move speed multiplier bonus from permanent upgrades.
   * Each level gives +5% (0.05) speed.
   */
  getStartingMoveSpeedMultiplier(): number {
    return 1 + (this.upgradeState['moveSpeedLevel'] ?? 0) * 0.05;
  }

  // ═══ RESOURCES ═══

  /**
   * Returns the XP gain multiplier.
   * Each level gives +5%.
   */
  getStartingXPMultiplier(): number {
    return 1 + (this.upgradeState['xpGainLevel'] ?? 0) * 0.05;
  }

  /**
   * Returns the pickup range multiplier.
   * Each level gives +15%.
   */
  getStartingPickupRangeMultiplier(): number {
    return 1 + (this.upgradeState['pickupRangeLevel'] ?? 0) * 0.15;
  }

  /**
   * Returns the gold gain multiplier.
   * Each level gives +10%.
   */
  getStartingGoldMultiplier(): number {
    return 1 + (this.upgradeState['goldGainLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns the starting level bonus.
   */
  getStartingLevel(): number {
    return 1 + (this.upgradeState['startingXPLevel'] ?? 0);
  }

  // ═══ UTILITY ═══

  /**
   * Returns the number of rerolls per run.
   * Each level gives +2 rerolls.
   */
  getStartingRerolls(): number {
    return (this.upgradeState['rerollLevel'] ?? 0) * 2;
  }

  /**
   * Returns the number of extra upgrade choices.
   * Each level gives +1 choice.
   */
  getStartingExtraChoices(): number {
    return this.upgradeState['choiceLevel'] ?? 0;
  }

  /**
   * Returns the number of skips per run.
   */
  getStartingSkips(): number {
    return this.upgradeState['skipLevel'] ?? 0;
  }

  /**
   * Returns the number of banishes per run.
   */
  getStartingBanishes(): number {
    return this.upgradeState['banishLevel'] ?? 0;
  }

  // ═══ ELEMENTAL ═══

  /**
   * Returns burn chance.
   * Each level gives +5%.
   */
  getStartingBurnChance(): number {
    return (this.upgradeState['fireLevel'] ?? 0) * 0.05;
  }

  /**
   * Returns freeze chance.
   * Each level gives +3%.
   */
  getStartingFreezeChance(): number {
    return (this.upgradeState['iceLevel'] ?? 0) * 0.03;
  }

  /**
   * Returns chain lightning chance.
   * Each level gives +4%.
   */
  getStartingChainLightningChance(): number {
    return (this.upgradeState['lightningLevel'] ?? 0) * 0.04;
  }

  /**
   * Returns poison chance.
   * Each level gives +5%.
   */
  getStartingPoisonChance(): number {
    return (this.upgradeState['poisonLevel'] ?? 0) * 0.05;
  }

  // ═══ OFFENSE (ADVANCED) ═══

  /**
   * Returns knockback multiplier.
   * Each level gives +10%.
   */
  getStartingKnockback(): number {
    return 1 + (this.upgradeState['knockbackLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns execution bonus damage to low HP enemies.
   * Each level gives +10% bonus damage to enemies below 25% HP.
   */
  getStartingExecutionBonus(): number {
    return (this.upgradeState['executionLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns overkill splash percentage.
   * Each level gives 25% overkill splash.
   */
  getStartingOverkillSplash(): number {
    return (this.upgradeState['overkillLevel'] ?? 0) * 0.25;
  }

  /**
   * Returns armor penetration percentage.
   * Each level ignores 10% enemy armor.
   */
  getStartingArmorPen(): number {
    return (this.upgradeState['armorPenLevel'] ?? 0) * 0.1;
  }

  // ═══ DEFENSE (ADVANCED) ═══

  /**
   * Returns thorns reflect percentage.
   * Each level reflects 10% damage.
   */
  getStartingThorns(): number {
    return (this.upgradeState['thornLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns starting shield amount.
   * Each level gives +20 shield.
   */
  getStartingShield(): number {
    return (this.upgradeState['shieldLevel'] ?? 0) * 20;
  }

  /**
   * Returns healing boost multiplier.
   * Each level gives +20% healing received.
   */
  getStartingHealingBoost(): number {
    return 1 + (this.upgradeState['healingBoostLevel'] ?? 0) * 0.2;
  }

  /**
   * Returns emergency heal percentage.
   * Each level heals 15% when below 20% HP.
   */
  getStartingEmergencyHeal(): number {
    return (this.upgradeState['emergencyHealLevel'] ?? 0) * 0.15;
  }

  /**
   * Returns damage cap as percentage of max HP.
   * Each level reduces cap by 15% (1.0 = 100%, 0.85 = 85%, etc.)
   */
  getStartingDamageCap(): number {
    const level = this.upgradeState['damageCapLevel'] ?? 0;
    return level > 0 ? 1 - level * 0.15 : 1.0;
  }

  /**
   * Returns bonus max shield barrier charges from permanent upgrades.
   * Each level gives +1 max shield charge.
   */
  getStartingBarrierCapacity(): number {
    return this.upgradeState['barrierCapacityLevel'] ?? 0;
  }

  // ═══ MOVEMENT (ADVANCED) ═══

  /**
   * Returns acceleration multiplier.
   * Each level gives +20% acceleration.
   */
  getStartingAcceleration(): number {
    return 1 + (this.upgradeState['accelerationLevel'] ?? 0) * 0.2;
  }

  /**
   * Returns slow resistance.
   * Each level gives 15% slow resistance.
   */
  getStartingSlowResist(): number {
    return (this.upgradeState['slowResistLevel'] ?? 0) * 0.15;
  }

  /**
   * Returns sprint speed bonus when not attacking.
   * Each level gives +8% speed when idle.
   */
  getStartingSprint(): number {
    return (this.upgradeState['sprintLevel'] ?? 0) * 0.08;
  }

  /**
   * Returns combat speed bonus per nearby enemy.
   * Each level gives +5% speed per enemy (max 25%).
   */
  getStartingCombatSpeed(): number {
    return (this.upgradeState['combatSpeedLevel'] ?? 0) * 0.05;
  }

  /**
   * Returns dash cooldown in seconds.
   * Base is 8s, each level reduces by 1s.
   * Returns 0 if no dash ability.
   */
  getStartingDashCooldown(): number {
    const level = this.upgradeState['dashLevel'] ?? 0;
    return level > 0 ? 8 - level : 0;
  }

  /**
   * Returns phase chance while moving.
   * Each level gives 3% chance to phase through attacks.
   */
  getStartingPhaseChance(): number {
    return (this.upgradeState['phaseLevel'] ?? 0) * 0.03;
  }

  // ═══ RESOURCES (ADVANCED) ═══

  /**
   * Returns gem value multiplier.
   * Each level gives +10% gem value.
   */
  getStartingGemValueBonus(): number {
    return 1 + (this.upgradeState['gemValueLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns drop rate multiplier.
   * Each level gives +5% drop rate.
   */
  getStartingDropRateBonus(): number {
    return 1 + (this.upgradeState['dropRateLevel'] ?? 0) * 0.05;
  }

  /**
   * Returns health drop rate multiplier.
   * Each level gives +20% health drop rate.
   */
  getStartingHealthDropBonus(): number {
    return 1 + (this.upgradeState['healthDropLevel'] ?? 0) * 0.2;
  }

  /**
   * Returns gem magnet interval in seconds.
   * Level 0 = no magnet, each level: 15s, 12s, 9s.
   */
  getStartingGemMagnetInterval(): number {
    const level = this.upgradeState['gemMagnetLevel'] ?? 0;
    return level > 0 ? 15 - level * 3 : 0;
  }

  /**
   * Returns treasure chest interval in seconds.
   * Level 0 = no chests, each level: 120s, 100s, 80s.
   */
  getStartingTreasureInterval(): number {
    const level = this.upgradeState['treasureLevel'] ?? 0;
    return level > 0 ? 120 - level * 20 : 0;
  }

  /**
   * Returns boss gold multiplier.
   * Each level gives +50% gold from bosses.
   */
  getStartingBossGoldBonus(): number {
    return 1 + (this.upgradeState['bossGoldLevel'] ?? 0) * 0.5;
  }

  // ═══ UTILITY (ADVANCED) ═══

  /**
   * Returns luck bonus for rare upgrades.
   * Each level gives +10% rare upgrade chance.
   */
  getStartingLuckBonus(): number {
    return (this.upgradeState['luckLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns number of upgrades to keep between runs.
   */
  getStartingUpgradeKeep(): number {
    return this.upgradeState['upgradeKeepLevel'] ?? 0;
  }

  /**
   * Returns slow time duration in minutes.
   * First N minutes at 75% speed.
   */
  getStartingSlowTimeMinutes(): number {
    return this.upgradeState['slowTimeLevel'] ?? 0;
  }

  /**
   * Returns curse level (harder enemies, better rewards).
   * Each level: +20% enemy stats, +15% rewards.
   */
  getStartingCurseLevel(): number {
    return this.upgradeState['curseLevel'] ?? 0;
  }

  /**
   * Returns blessing count (random buffs at run start).
   */
  getStartingBlessingCount(): number {
    return this.upgradeState['blessingLevel'] ?? 0;
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
    return this.upgradeState['autoUpgrade'] ?? 0;
  }

  // ═══ ELEMENTAL (ADVANCED) ═══

  /**
   * Returns burn damage multiplier.
   * Each level gives +25% burn damage.
   */
  getStartingBurnDamageBonus(): number {
    return 1 + (this.upgradeState['burnDamageLevel'] ?? 0) * 0.25;
  }

  /**
   * Returns freeze duration multiplier.
   * Each level gives +20% freeze duration.
   */
  getStartingFreezeDurationBonus(): number {
    return 1 + (this.upgradeState['freezeDurationLevel'] ?? 0) * 0.2;
  }

  /**
   * Returns extra chain lightning targets.
   */
  getStartingChainCount(): number {
    return this.upgradeState['chainCountLevel'] ?? 0;
  }

  /**
   * Returns extra max poison stacks.
   */
  getStartingPoisonMaxStacks(): number {
    return this.upgradeState['poisonStackLevel'] ?? 0;
  }

  /**
   * Returns explosion damage on burning enemy death.
   * Each level gives 50% of max HP as explosion damage.
   */
  getStartingExplosionDamage(): number {
    return (this.upgradeState['explosionLevel'] ?? 0) * 0.5;
  }

  /**
   * Returns bonus damage to frozen enemies.
   * Each level gives +30% damage to frozen.
   */
  getStartingShatterBonus(): number {
    return (this.upgradeState['shatterLevel'] ?? 0) * 0.3;
  }

  /**
   * Returns overcharge stun duration in seconds.
   * Each level gives 0.3s stun on lightning chain.
   */
  getStartingOverchargeStun(): number {
    return (this.upgradeState['overchargeLevel'] ?? 0) * 0.3;
  }

  /**
   * Returns pandemic spread count on poison death.
   */
  getStartingPandemicSpread(): number {
    return this.upgradeState['pandemicLevel'] ?? 0;
  }

  // ═══ MASTERY ═══

  /**
   * Returns projectile weapon damage multiplier.
   * Each level gives +10%.
   */
  getStartingProjectileMastery(): number {
    return 1 + (this.upgradeState['projectileMasteryLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns melee weapon damage multiplier.
   * Each level gives +10%.
   */
  getStartingMeleeMastery(): number {
    return 1 + (this.upgradeState['meleeMasteryLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns aura weapon damage multiplier.
   * Each level gives +10%.
   */
  getStartingAuraMastery(): number {
    return 1 + (this.upgradeState['auraMasteryLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns summon/drone damage multiplier.
   * Each level gives +15%.
   */
  getStartingSummonMastery(): number {
    return 1 + (this.upgradeState['summonMasteryLevel'] ?? 0) * 0.15;
  }

  /**
   * Returns extra weapon slots.
   */
  getStartingWeaponSlots(): number {
    return this.upgradeState['weaponSlotLevel'] ?? 0;
  }

  /**
   * Returns orbital weapon speed and damage multiplier.
   * Each level gives +15%.
   */
  getStartingOrbitalMastery(): number {
    return 1 + (this.upgradeState['orbitalMasteryLevel'] ?? 0) * 0.15;
  }

  /**
   * Returns explosive area and damage multiplier.
   * Each level gives +10%.
   */
  getStartingExplosiveMastery(): number {
    return 1 + (this.upgradeState['explosiveMasteryLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns beam damage and width multiplier.
   * Each level gives +10%.
   */
  getStartingBeamMastery(): number {
    return 1 + (this.upgradeState['beamMasteryLevel'] ?? 0) * 0.1;
  }

  /**
   * Returns weapon evolution level reduction.
   * Each level reduces evolution requirement by 1.
   */
  getStartingEvolutionBonus(): number {
    return this.upgradeState['weaponEvolutionLevel'] ?? 0;
  }

  /**
   * Returns weapon synergy bonus per weapon.
   * Each level gives +3% damage per weapon owned.
   */
  getStartingSynergyBonus(): number {
    return (this.upgradeState['weaponSynergyLevel'] ?? 0) * 0.03;
  }

  /**
   * Returns ultimate mastery (all weapons bonus).
   * Each level gives +5% to all weapon stats.
   */
  getStartingUltimateMastery(): number {
    return 1 + (this.upgradeState['ultimateMasteryLevel'] ?? 0) * 0.05;
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
    hasWon: boolean
  ): number {
    // No minimum - earn what you earn, prevents start-quit exploit
    const killGold = Math.floor(killCount * 2.5);
    const timeGold = Math.floor(gameTimeSeconds / 10);
    const levelGold = playerLevel * 10;

    let totalGold = killGold + timeGold + levelGold;

    // Victory bonus (defeated boss)
    if (hasWon) {
      totalGold = Math.floor(totalGold * 1.5);
    }

    // Apply gold gain multiplier from upgrades
    totalGold = Math.floor(totalGold * this.getStartingGoldMultiplier());

    // Apply world level gold multiplier
    totalGold = Math.floor(totalGold * this.getWorldLevelGoldMultiplier());

    // Apply streak gold multiplier (+5% per streak, max +50%)
    totalGold = Math.floor(totalGold * this.getStreakGoldMultiplier());

    return totalGold;
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence (localStorage)
  // ─────────────────────────────────────────────────────────────

  private loadGold(): number {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_GOLD);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) {
          return parsed;
        }
      }
    } catch {
      console.warn('Could not load gold from storage');
    }
    return 0;
  }

  private saveGold(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_GOLD, String(this.goldBalance));
    } catch {
      console.warn('Could not save gold to storage');
    }
  }

  private loadUpgradeState(): PermanentUpgradeState {
    const defaultState = createDefaultUpgradeState();
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_UPGRADES);
      if (stored) {
        const parsed = JSON.parse(stored) as PermanentUpgradeState;
        // Merge with defaults to handle new upgrades
        return {
          ...defaultState,
          ...parsed,
        };
      }
    } catch {
      console.warn('Could not load upgrade state from storage');
    }
    return defaultState;
  }

  private saveUpgradeState(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_UPGRADES, JSON.stringify(this.upgradeState));
    } catch {
      console.warn('Could not save upgrade state to storage');
    }
  }

  private loadWorldLevel(): number {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_WORLD_LEVEL);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= 1) {
          return parsed;
        }
      }
    } catch {
      console.warn('Could not load world level from storage');
    }
    return 1; // Default to world level 1
  }

  private saveWorldLevel(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_WORLD_LEVEL, String(this.worldLevel));
    } catch {
      console.warn('Could not save world level to storage');
    }
  }

  private loadStreakState(): StreakState {
    const defaultState: StreakState = { currentStreak: 0, bestStreak: 0 };
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_STREAK);
      if (stored) {
        const parsed = JSON.parse(stored) as StreakState;
        return {
          currentStreak: parsed.currentStreak ?? 0,
          bestStreak: parsed.bestStreak ?? 0,
        };
      }
    } catch {
      console.warn('Could not load streak state from storage');
    }
    return defaultState;
  }

  private saveStreakState(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_STREAK, JSON.stringify(this.streakState));
    } catch {
      console.warn('Could not save streak state to storage');
    }
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
   * Add gold for debugging.
   */
  debugAddGold(amount: number): void {
    this.addGold(amount);
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
