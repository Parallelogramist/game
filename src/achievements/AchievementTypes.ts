/**
 * AchievementTypes.ts
 *
 * Type definitions for the milestone and achievement systems.
 * Milestones are in-run goals, Achievements are persistent cross-run goals.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

export type AchievementCategory = 'combat' | 'survival' | 'progression' | 'challenge';

// ═══════════════════════════════════════════════════════════════════════════
// TRACKING TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TrackingType =
  | 'kills'
  | 'time_survived'
  | 'level'
  | 'damage_dealt'
  | 'crits'
  | 'minibosses_killed'
  | 'bosses_killed'
  | 'upgrades_acquired'
  | 'weapons_acquired'
  | 'hp_remaining'
  | 'victories'
  | 'runs_started'
  | 'world_level'
  | 'perfect_run'      // Special: no damage taken
  | 'speed_run';       // Special: victory under time threshold

// ═══════════════════════════════════════════════════════════════════════════
// REWARD TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type RewardType =
  | 'xp_bonus'         // Add XP directly during run
  | 'reroll_token'     // Add reroll tokens
  | 'temp_buff'        // Temporary stat buff
  | 'gold'             // Permanent gold (for achievements)
  | 'unlock';          // Unlock something (upgrade, etc.)

export interface MilestoneReward {
  type: 'xp_bonus' | 'reroll_token' | 'temp_buff';
  value: number;
  description: string;
  buffType?: 'damage' | 'speed' | 'all_stats';  // For temp_buff
  buffDuration?: number;                         // Duration in ms
}

export interface AchievementReward {
  type: 'gold' | 'unlock';
  value: number;
  description: string;
  unlockId?: string;  // For unlock rewards
}

// ═══════════════════════════════════════════════════════════════════════════
// MILESTONE DEFINITIONS (In-Run)
// ═══════════════════════════════════════════════════════════════════════════

export interface MilestoneDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;

  // Goal tracking
  targetValue: number;
  trackingType: TrackingType;

  // Reward
  reward: MilestoneReward;

  // Tiered milestones (e.g., kill 100 -> 500 -> 1000)
  tier?: number;
  nextTierId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACHIEVEMENT DEFINITIONS (Persistent)
// ═══════════════════════════════════════════════════════════════════════════

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;

  // Goal tracking
  targetValue: number;
  trackingType: TrackingType;

  // Reward
  reward: AchievementReward;

  // Tiered achievements
  tier?: number;
  nextTierId?: string;

  // Special properties
  isSecret?: boolean;           // Hidden until unlocked
  unlockLevel?: number;         // Account level required to see
  prerequisiteIds?: string[];   // Must unlock these first
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS STATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Progress for a single in-run milestone (reset each run).
 */
export interface MilestoneProgress {
  id: string;
  currentValue: number;
  isCompleted: boolean;
  completedAt?: number;  // Game time in seconds when completed
}

/**
 * Progress for a single persistent achievement.
 */
export interface AchievementProgress {
  id: string;
  currentValue: number;
  isUnlocked: boolean;
  unlockedAt?: number;      // Unix timestamp when unlocked
  rewardClaimed: boolean;   // Whether reward was collected
}

/**
 * Stats tracked during a single run.
 */
export interface RunStats {
  kills: number;
  damageDealt: number;
  criticalHits: number;
  minibossesKilled: number;
  bossesKilled: number;
  upgradesAcquired: number;
  weaponsAcquired: number;
  damageTaken: number;
  timesLowHp: number;       // Times dropped below 20% HP
}

/**
 * Run-level milestone tracking (reset each run).
 */
export interface RunMilestoneState {
  milestones: Record<string, MilestoneProgress>;
  runStats: RunStats;
  startTime: number;        // Unix timestamp of run start
}

/**
 * Lifetime statistics tracked across all runs.
 */
export interface LifetimeStats {
  totalKills: number;
  totalDamageDealt: number;
  totalCriticalHits: number;
  totalTimePlayedSeconds: number;
  totalRunsStarted: number;
  totalRunsCompleted: number;
  totalVictories: number;
  totalGoldEarned: number;
  highestLevel: number;
  highestWorldLevel: number;
  longestSurvivalSeconds: number;
  fastestVictorySeconds: number;
  perfectRuns: number;      // Wins without taking damage
  speedRuns: number;        // Wins under 8 minutes
}

/**
 * Persistent achievement state (stored in localStorage).
 */
export interface PersistentAchievementState {
  version: number;
  achievements: Record<string, AchievementProgress>;
  lifetimeStats: LifetimeStats;
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN END DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Data passed when a run ends (victory or defeat).
 */
export interface RunEndData {
  wasVictory: boolean;
  killCount: number;
  levelReached: number;
  survivalTimeSeconds: number;
  worldLevel: number;
  damageDealt: number;
  damageTaken: number;
  goldEarned: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export interface ToastConfig {
  title: string;
  description: string;
  icon: string;
  color: number;          // Phaser tint color
  duration: number;       // Display duration in ms
  playSound?: boolean;    // Whether to play notification sound
}
