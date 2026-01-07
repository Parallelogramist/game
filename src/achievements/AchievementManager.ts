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
import { ACHIEVEMENTS, getAchievementById } from './AchievementDefinitions';

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
    totalGoldEarned: 0,
    highestLevel: 0,
    highestWorldLevel: 0,
    longestSurvivalSeconds: 0,
    fastestVictorySeconds: Infinity,
    perfectRuns: 0,
    speedRuns: 0,
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
    this.updateAchievementProgress('bosses_killed', this.runState.runStats.bossesKilled);
    this.updateAchievementProgress('runs_started', stats.totalRunsStarted);
    this.updateAchievementProgress('world_level', data.worldLevel);
    this.updateAchievementProgress('level', data.levelReached);

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

    // Trigger callback for UI notification
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

  setAchievementUnlockCallback(callback: (achievement: AchievementDefinition) => void): void {
    this.onAchievementUnlock = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────────────────────────

  private loadPersistentState(): PersistentAchievementState {
    const defaultState = createDefaultPersistentState();
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_ACHIEVEMENTS);
      if (stored) {
        const parsed = JSON.parse(stored) as PersistentAchievementState;
        // Merge with defaults to handle new achievements added in updates
        return {
          version: ACHIEVEMENT_VERSION,
          achievements: {
            ...defaultState.achievements,
            ...parsed.achievements,
          },
          lifetimeStats: {
            ...defaultState.lifetimeStats,
            ...parsed.lifetimeStats,
          },
        };
      }
    } catch {
      console.warn('Could not load achievement state from storage');
    }
    return defaultState;
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
