/**
 * AchievementManager.ts
 *
 * Singleton manager for tracking milestones (in-run) and achievements (persistent).
 * Uses SecureStorage for persistence following MetaProgressionManager patterns.
 */

import { SecureStorage } from '../storage';
import {
  MilestoneDefinition,
  AchievementDefinition,
  MilestoneProgress,
  AchievementProgress,
  RunMilestoneState,
  RunStats,
  PersistentAchievementState,
  LifetimeStats,
  RunEndData,
  MilestoneReward,
  AchievementReward,
} from './AchievementTypes';
import { MILESTONES, getMilestoneById } from './MilestoneDefinitions';
import { ACHIEVEMENTS, getAchievementById, BOSS_KILL_TRACKING } from './AchievementDefinitions';

// Storage keys
const STORAGE_KEY_ACHIEVEMENTS = 'survivor-achievements';
const ACHIEVEMENT_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT STATE FACTORIES
// ═══════════════════════════════════════════════════════════════════════════

function createDefaultRunStats(): RunStats {
  return {
    kills: 0,
    damageDealt: 0,
    criticalHits: 0,
    minibossesKilled: 0,
    bossesKilled: 0,
    upgradesAcquired: 0,
    weaponsAcquired: 0,
    damageTaken: 0,
    timesLowHp: 0,
  };
}

function createDefaultLifetimeStats(): LifetimeStats {
  return {
    totalKills: 0,
    totalDamageDealt: 0,
    totalCriticalHits: 0,
    totalTimePlayedSeconds: 0,
    totalRunsStarted: 0,
    totalRunsCompleted: 0,
    totalVictories: 0,
    totalBossesKilled: 0,
    totalGoldEarned: 0,
    highestLevel: 0,
    highestWorldLevel: 0,
    longestSurvivalSeconds: 0,
    fastestVictorySeconds: Infinity,
    perfectRuns: 0,
    speedRuns: 0,
    mostKillsInRun: 0,
    highestComboInRun: 0,
  };
}

function createDefaultAchievementProgress(): Record<string, AchievementProgress> {
  const progress: Record<string, AchievementProgress> = {};
  for (const achievement of ACHIEVEMENTS) {
    progress[achievement.id] = {
      id: achievement.id,
      currentValue: 0,
      isUnlocked: false,
      rewardClaimed: false,
    };
  }
  return progress;
}

function createDefaultPersistentState(): PersistentAchievementState {
  return {
    version: ACHIEVEMENT_VERSION,
    achievements: createDefaultAchievementProgress(),
    lifetimeStats: createDefaultLifetimeStats(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD-TIME SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════
//
// SecureStorage is the anti-cheat layer, so a corrupt/tampered persisted payload
// is the threat model. The loader must coerce every field through a finite check
// and rebuild from known keys only — a single NaN/string lifetime stat is
// catastrophic because recordRunEnd does `stats.totalKills += ...`, so a bad
// value poisons the *persisted* total forever (NaN or string-concat), every
// `currentValue >= targetValue` comparison goes false (achievements bricked), and
// the same totals feed HiddenUnlocks predicates + the Achievement UI. Mirrors the
// hardening applied to MetaProgressionManager / AscensionManager.

/** Degrade arrays / null / primitives to `{}` so junk payloads fall back to
 *  defaults instead of leaking string indices or unknown keys via spread. */
function asStoredRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

interface StoredNumberSpec {
  floor: boolean;          // integer counters floor; fractional fields (seconds/damage) don't
  allowInfinity: boolean;  // only fastestVictorySeconds keeps +Infinity as its "none yet" sentinel
}

/** Coerce a stored numeric field: a finite, non-negative number (optionally
 *  +Infinity) survives; anything else (string/object/NaN/-Infinity/negative)
 *  falls back. Floors when the field is an integer counter. */
function boundedStoredNumber(value: unknown, fallback: number, spec: StoredNumberSpec): number {
  if (typeof value !== 'number') return fallback;
  if (spec.allowInfinity && value === Infinity) return value;
  if (!Number.isFinite(value)) return fallback; // NaN, ±Infinity (when not allowed)
  if (value < 0) return fallback;
  return spec.floor ? Math.floor(value) : value;
}

// Per-field rules. A `Record<keyof LifetimeStats, …>` makes the compiler force
// every field to be covered, so this can never silently drift from the type.
const LIFETIME_STAT_SPECS: Record<keyof LifetimeStats, StoredNumberSpec> = {
  totalKills: { floor: true, allowInfinity: false },
  totalDamageDealt: { floor: false, allowInfinity: false },
  totalCriticalHits: { floor: true, allowInfinity: false },
  totalTimePlayedSeconds: { floor: false, allowInfinity: false },
  totalRunsStarted: { floor: true, allowInfinity: false },
  totalRunsCompleted: { floor: true, allowInfinity: false },
  totalVictories: { floor: true, allowInfinity: false },
  totalBossesKilled: { floor: true, allowInfinity: false },
  totalGoldEarned: { floor: true, allowInfinity: false },
  highestLevel: { floor: true, allowInfinity: false },
  highestWorldLevel: { floor: true, allowInfinity: false },
  longestSurvivalSeconds: { floor: false, allowInfinity: false },
  fastestVictorySeconds: { floor: false, allowInfinity: true },
  perfectRuns: { floor: true, allowInfinity: false },
  speedRuns: { floor: true, allowInfinity: false },
  mostKillsInRun: { floor: true, allowInfinity: false },
  highestComboInRun: { floor: true, allowInfinity: false },
};

/** Rebuild lifetime stats from the known fields only, coercing each value.
 *  Unknown injected keys are dropped; missing/garbage fields take their default.
 *  Byte-identical on the real path (valid ints floor-noop, fractions preserved,
 *  Infinity preserved — and JSON.stringify's Infinity→null round-trips back to
 *  the Infinity default). */
function sanitizeLifetimeStats(raw: unknown): LifetimeStats {
  const defaults = createDefaultLifetimeStats();
  const record = asStoredRecord(raw);
  const result = createDefaultLifetimeStats();
  for (const key of Object.keys(defaults) as (keyof LifetimeStats)[]) {
    result[key] = boundedStoredNumber(record[key], defaults[key], LIFETIME_STAT_SPECS[key]);
  }
  return result;
}

const PROGRESS_VALUE_SPEC: StoredNumberSpec = { floor: false, allowInfinity: false };

/** Rebuild achievement progress from the known achievement ids only. Drops junk
 *  ids, coerces currentValue to a finite number, and forces isUnlocked /
 *  rewardClaimed to real booleans so a truthy-but-not-true tamper (e.g. "yes")
 *  can't fake an unlock, inflate completion %, or re-deliver a reward. */
function sanitizeAchievements(raw: unknown): Record<string, AchievementProgress> {
  const record = asStoredRecord(raw);
  const result = createDefaultAchievementProgress();
  for (const achievement of ACHIEVEMENTS) {
    const stored = record[achievement.id];
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) continue;
    const storedEntry = stored as Record<string, unknown>;
    const entry = result[achievement.id];
    entry.currentValue = boundedStoredNumber(storedEntry.currentValue, 0, PROGRESS_VALUE_SPEC);
    entry.isUnlocked = storedEntry.isUnlocked === true;
    entry.rewardClaimed = storedEntry.rewardClaimed === true;
    const unlockedAt = storedEntry.unlockedAt;
    if (typeof unlockedAt === 'number' && Number.isFinite(unlockedAt) && unlockedAt >= 0) {
      entry.unlockedAt = unlockedAt;
    }
  }
  return result;
}

function createFreshRunState(): RunMilestoneState {
  const milestones: Record<string, MilestoneProgress> = {};
  for (const milestone of MILESTONES) {
    milestones[milestone.id] = {
      id: milestone.id,
      currentValue: 0,
      isCompleted: false,
    };
  }
  return {
    milestones,
    runStats: createDefaultRunStats(),
    startTime: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACHIEVEMENT MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class AchievementManager {
  private persistentState: PersistentAchievementState;
  private runState: RunMilestoneState;

  // Callbacks for UI notifications
  private onMilestoneComplete: ((milestone: MilestoneDefinition, reward: MilestoneReward) => void) | null = null;
  private onAchievementUnlock: ((achievement: AchievementDefinition) => void) | null = null;

  constructor() {
    this.persistentState = this.loadPersistentState();
    this.runState = createFreshRunState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RUN LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Reset run state at the start of a new run.
   */
  startNewRun(): void {
    this.runState = createFreshRunState();
    this.persistentState.lifetimeStats.totalRunsStarted++;
    this.savePersistentState();
  }

  /**
   * Record run completion and update lifetime stats.
   */
  recordRunEnd(data: RunEndData): void {
    const stats = this.persistentState.lifetimeStats;

    // Update lifetime stats
    stats.totalKills += this.runState.runStats.kills;
    stats.totalDamageDealt += this.runState.runStats.damageDealt;
    stats.totalCriticalHits += this.runState.runStats.criticalHits;
    stats.totalBossesKilled += this.runState.runStats.bossesKilled;
    stats.totalTimePlayedSeconds += data.survivalTimeSeconds;
    stats.totalRunsCompleted++;
    stats.totalGoldEarned += data.goldEarned;

    if (data.levelReached > stats.highestLevel) {
      stats.highestLevel = data.levelReached;
    }
    if (data.worldLevel > stats.highestWorldLevel) {
      stats.highestWorldLevel = data.worldLevel;
    }
    if (data.survivalTimeSeconds > stats.longestSurvivalSeconds) {
      stats.longestSurvivalSeconds = data.survivalTimeSeconds;
    }
    if (this.runState.runStats.kills > stats.mostKillsInRun) {
      stats.mostKillsInRun = this.runState.runStats.kills;
    }
    if (data.highestCombo !== undefined && data.highestCombo > stats.highestComboInRun) {
      stats.highestComboInRun = data.highestCombo;
    }

    if (data.wasVictory) {
      stats.totalVictories++;

      // Check for speed run (under 8 minutes = 480 seconds)
      if (data.survivalTimeSeconds < 480) {
        stats.speedRuns++;
        if (data.survivalTimeSeconds < stats.fastestVictorySeconds) {
          stats.fastestVictorySeconds = data.survivalTimeSeconds;
        }
        this.checkAchievementProgress('speed_run', 1);
      }

      // Check for perfect run (no damage taken)
      if (data.damageTaken === 0) {
        stats.perfectRuns++;
        this.checkAchievementProgress('perfect_run', 1);
      }
    }

    // Update achievement progress for lifetime tracking
    this.updateAchievementProgress('kills', stats.totalKills);
    this.updateAchievementProgress('time_survived', stats.totalTimePlayedSeconds);
    this.updateAchievementProgress('victories', stats.totalVictories);
    this.updateAchievementProgress('bosses_killed', stats.totalBossesKilled);
    this.updateAchievementProgress('runs_started', stats.totalRunsStarted);
    this.updateAchievementProgress('runs_completed', stats.totalRunsCompleted);
    this.updateAchievementProgress('world_level', data.worldLevel);
    this.updateAchievementProgress('level', data.levelReached);
    if (data.accountLevel !== undefined) {
      this.updateAchievementProgress('account_level', data.accountLevel);
    }
    if (data.bestStreak !== undefined) {
      this.updateAchievementProgress('win_streak', data.bestStreak);
    }

    this.savePersistentState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IN-RUN TRACKING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record an enemy kill.
   */
  recordKill(_xpValue: number = 1): void {
    this.runState.runStats.kills++;
    this.checkMilestoneProgress('kills', this.runState.runStats.kills);
  }

  /**
   * Record a miniboss kill.
   */
  recordMinibossKill(): void {
    this.runState.runStats.minibossesKilled++;
    this.checkMilestoneProgress('minibosses_killed', this.runState.runStats.minibossesKilled);
  }

  /**
   * Record a boss kill.
   */
  recordBossKill(): void {
    this.runState.runStats.bossesKilled++;
    this.checkMilestoneProgress('bosses_killed', this.runState.runStats.bossesKilled);
  }

  /**
   * Record damage dealt.
   */
  recordDamageDealt(amount: number, isCrit: boolean = false): void {
    this.runState.runStats.damageDealt += amount;
    if (isCrit) {
      this.runState.runStats.criticalHits++;
      this.checkMilestoneProgress('crits', this.runState.runStats.criticalHits);
    }
    this.checkMilestoneProgress('damage_dealt', this.runState.runStats.damageDealt);
  }

  /**
   * Record damage taken.
   */
  recordDamageTaken(amount: number, remainingHpPercent: number): void {
    this.runState.runStats.damageTaken += amount;
    if (remainingHpPercent < 0.2) {
      this.runState.runStats.timesLowHp++;
    }
  }

  /**
   * Record time survived (called periodically, e.g., every second).
   */
  recordTimeSurvived(gameTimeSeconds: number): void {
    this.checkMilestoneProgress('time_survived', gameTimeSeconds);
  }

  /**
   * Record player level up.
   */
  recordLevelUp(newLevel: number): void {
    this.checkMilestoneProgress('level', newLevel);
  }

  /**
   * Record an upgrade acquired.
   */
  recordUpgradeAcquired(_upgradeId: string): void {
    this.runState.runStats.upgradesAcquired++;
    this.checkMilestoneProgress('upgrades_acquired', this.runState.runStats.upgradesAcquired);
  }

  /**
   * Record a weapon acquired.
   */
  recordWeaponAcquired(_weaponId: string): void {
    this.runState.runStats.weaponsAcquired++;
    this.checkMilestoneProgress('weapons_acquired', this.runState.runStats.weaponsAcquired);
  }

  /**
   * Card-archive collection size changed (end-screen reveal or Scanner
   * decrypt). `count` is the total discovered count — an absolute value like
   * the lifetime stats, not an increment.
   */
  recordCardsDiscovered(count: number): void {
    this.updateAchievementProgress('cards_discovered', count);
    this.savePersistentState();
  }

  /**
   * Hangar mastery changed (a ship's last mod level was purchased). `count`
   * is the absolute number of fully-modded ships, not an increment.
   */
  recordShipsFullyModded(count: number): void {
    this.updateAchievementProgress('ships_fully_modded', count);
    this.savePersistentState();
  }

  /**
   * Best GAUNTLET wave reached. `bestWave` is the absolute stored record
   * (GauntletBestWave owns it), not the current wave — pushing a *current*
   * wave would walk an in-progress tier's bar backwards after a short run,
   * because updateAchievementProgress assigns rather than maxes.
   */
  recordGauntletWaveReached(bestWave: number): void {
    this.updateAchievementProgress('gauntlet_wave', bestWave);
    this.savePersistentState();
  }

  /** Deepest post-victory ENDLESS cycle. Absolute stored record — see above. */
  recordEndlessCycleReached(bestCycle: number): void {
    this.updateAchievementProgress('endless_cycle', bestCycle);
    this.savePersistentState();
  }

  /**
   * A Paragon (double-affix) elite died. Increments — unlike every other
   * endgame stat there is no external record to mirror, so this is the only
   * counter, and it cannot be retro-credited for kills before this shipped.
   */
  recordParagonKill(): void {
    this.checkAchievementProgress('paragon_kills', 1);
  }

  /**
   * Per-boss lifetime kill count, mirroring the codex's persisted `timesKilled`
   * (the source of truth) as an absolute value — the same shape as
   * recordCardsDiscovered. Enemy ids with no boss achievement no-op before any
   * work, so every kill can safely call this.
   */
  recordBossTypeKills(enemyTypeId: string, timesKilled: number): void {
    const trackingType = BOSS_KILL_TRACKING[enemyTypeId];
    if (!trackingType) return;
    this.updateAchievementProgress(trackingType, timesKilled);
    this.savePersistentState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MILESTONE CHECKING
  // ─────────────────────────────────────────────────────────────────────────

  private checkMilestoneProgress(trackingType: string, currentValue: number): void {
    for (const milestone of MILESTONES) {
      if (milestone.trackingType !== trackingType) continue;

      const progress = this.runState.milestones[milestone.id];
      if (!progress || progress.isCompleted) continue;

      progress.currentValue = currentValue;

      if (currentValue >= milestone.targetValue) {
        this.completeMilestone(milestone.id);
      }
    }
  }

  private completeMilestone(milestoneId: string): void {
    const progress = this.runState.milestones[milestoneId];
    const milestone = getMilestoneById(milestoneId);

    if (!progress || !milestone || progress.isCompleted) return;

    progress.isCompleted = true;
    progress.completedAt = (Date.now() - this.runState.startTime) / 1000;

    // Trigger callback for UI notification
    if (this.onMilestoneComplete) {
      this.onMilestoneComplete(milestone, milestone.reward);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACHIEVEMENT CHECKING
  // ─────────────────────────────────────────────────────────────────────────

  private updateAchievementProgress(trackingType: string, currentValue: number): void {
    for (const achievement of ACHIEVEMENTS) {
      if (achievement.trackingType !== trackingType) continue;

      const progress = this.persistentState.achievements[achievement.id];
      if (!progress || progress.isUnlocked) continue;

      progress.currentValue = currentValue;

      if (currentValue >= achievement.targetValue) {
        this.unlockAchievement(achievement.id);
      }
    }
  }

  private checkAchievementProgress(trackingType: string, increment: number): void {
    for (const achievement of ACHIEVEMENTS) {
      if (achievement.trackingType !== trackingType) continue;

      const progress = this.persistentState.achievements[achievement.id];
      if (!progress || progress.isUnlocked) continue;

      progress.currentValue += increment;

      if (progress.currentValue >= achievement.targetValue) {
        this.unlockAchievement(achievement.id);
      }
    }
    this.savePersistentState();
  }

  private unlockAchievement(achievementId: string): void {
    const progress = this.persistentState.achievements[achievementId];
    const achievement = getAchievementById(achievementId);

    if (!progress || !achievement || progress.isUnlocked) return;

    progress.isUnlocked = true;
    progress.unlockedAt = Date.now();
    // Auto-claim ONLY when a callback is wired to actually deliver the reward
    // (GameScene / CardsScene). An unlock fired with no callback — e.g. from a
    // menu context that didn't wire one — stays unclaimed so AchievementScene's
    // retroactive claim pass delivers the gold instead of silently eating it.
    progress.rewardClaimed = this.onAchievementUnlock !== null;

    // Trigger callback for UI notification and reward delivery
    if (this.onAchievementUnlock) {
      this.onAchievementUnlock(achievement);
    }

    this.savePersistentState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REWARD CLAIMING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Claim the reward for an unlocked achievement.
   * Returns the reward if successful, null if not claimable.
   */
  claimAchievementReward(achievementId: string): AchievementReward | null {
    const progress = this.persistentState.achievements[achievementId];
    const achievement = getAchievementById(achievementId);

    if (!progress || !achievement) return null;
    if (!progress.isUnlocked || progress.rewardClaimed) return null;

    progress.rewardClaimed = true;
    this.savePersistentState();

    return achievement.reward;
  }

  /**
   * Get unclaimed achievement rewards.
   */
  getUnclaimedRewards(): AchievementDefinition[] {
    return ACHIEVEMENTS.filter((a) => {
      const progress = this.persistentState.achievements[a.id];
      return progress && progress.isUnlocked && !progress.rewardClaimed;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUERY METHODS
  // ─────────────────────────────────────────────────────────────────────────

  getMilestoneProgress(milestoneId: string): MilestoneProgress | undefined {
    return this.runState.milestones[milestoneId];
  }

  getAchievementProgress(achievementId: string): AchievementProgress | undefined {
    return this.persistentState.achievements[achievementId];
  }

  getRunStats(): RunStats {
    return { ...this.runState.runStats };
  }

  getLifetimeStats(): LifetimeStats {
    return { ...this.persistentState.lifetimeStats };
  }

  /**
   * Get all completed milestones for the current run.
   */
  getCompletedMilestones(): MilestoneDefinition[] {
    return MILESTONES.filter((m) => this.runState.milestones[m.id]?.isCompleted);
  }

  /**
   * Get all unlocked achievements.
   */
  getUnlockedAchievements(): AchievementDefinition[] {
    return ACHIEVEMENTS.filter((a) => this.persistentState.achievements[a.id]?.isUnlocked);
  }

  /**
   * Get completion percentage for achievements.
   */
  getAchievementCompletionPercent(): number {
    const total = ACHIEVEMENTS.length;
    const unlocked = this.getUnlockedAchievements().length;
    return Math.round((unlocked / total) * 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CALLBACKS
  // ─────────────────────────────────────────────────────────────────────────

  setMilestoneCompleteCallback(
    callback: (milestone: MilestoneDefinition, reward: MilestoneReward) => void
  ): void {
    this.onMilestoneComplete = callback;
  }

  /** Pass null to detach (a scene shutting down must not leave a dead closure wired). */
  setAchievementUnlockCallback(callback: ((achievement: AchievementDefinition) => void) | null): void {
    this.onAchievementUnlock = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────────────────────────

  private loadPersistentState(): PersistentAchievementState {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_ACHIEVEMENTS);
      if (stored) {
        // Sanitize, don't trust: a corrupt/tampered payload must not leak a
        // NaN/string into lifetime totals or a fake unlock. sanitize* rebuild
        // from known keys/fields only, so new achievements added in an update
        // still default in (and dropped/junk ids drop out).
        const parsed = asStoredRecord(JSON.parse(stored));
        return {
          version: ACHIEVEMENT_VERSION,
          achievements: sanitizeAchievements(parsed.achievements),
          lifetimeStats: sanitizeLifetimeStats(parsed.lifetimeStats),
        };
      }
    } catch {
      console.warn('Could not load achievement state from storage');
    }
    return createDefaultPersistentState();
  }

  private savePersistentState(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_ACHIEVEMENTS, JSON.stringify(this.persistentState));
    } catch {
      console.warn('Could not save achievement state to storage');
    }
  }

  /**
   * Reset all achievement progress (for debugging).
   */
  resetProgress(): void {
    this.persistentState = createDefaultPersistentState();
    this.runState = createFreshRunState();
    this.savePersistentState();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

let achievementManagerInstance: AchievementManager | null = null;

/**
 * Get the singleton AchievementManager instance.
 */
export function getAchievementManager(): AchievementManager {
  if (!achievementManagerInstance) {
    achievementManagerInstance = new AchievementManager();
  }
  return achievementManagerInstance;
}
