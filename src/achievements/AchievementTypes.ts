/**
 * AchievementTypes.ts
 *
 * Type definitions for the milestone and achievement systems.
 * Milestones are in-run goals, Achievements are persistent cross-run goals.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

export type AchievementCategory = 'combat' | 'survival' | 'progression' | 'challenge' | 'mastery';

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
  | 'speed_run'        // Special: victory under time threshold
  | 'runs_completed'   // Total runs completed (win or loss)
  | 'account_level'    // Sum of all upgrade levels
  | 'win_streak'       // Best win streak achieved
  | 'cards_discovered' // Card-archive collection size (CardCollectionManager)
  | 'ships_fully_modded' // Ships with every HANGAR mod track at cap (ShipModManager)
  | 'gauntlet_wave'    // Best GAUNTLET wave reached (GauntletBestWave owns the record)
  | 'endless_cycle'    // Deepest post-victory ENDLESS cycle (EndlessBestCycle owns the record)
  | 'paragon_kills'    // Paragon (double-affix) elites defeated
  // Per-boss first kills. One tracking type per boss because
  // updateAchievementProgress fans a value to EVERY achievement sharing a
  // tracking type — a single shared 'boss_first_kill' would unlock all five at
  // once on the first boss death. Keyed from an enemy type id by
  // BOSS_KILL_TRACKING in AchievementDefinitions.
  | 'boss_kill_horde_king'
  | 'boss_kill_void_wyrm'
  | 'boss_kill_the_machine'
  | 'boss_kill_the_bastion'
  | 'boss_kill_the_legion'
  | 'boss_kill_the_pulsar'
  | 'boss_kill_the_obelisk'
  | 'boss_kill_the_helix'
  | 'boss_kill_the_tessellator'
  | 'boss_kill_the_tremor'
  | 'boss_kill_the_diviner'
  | 'boss_kill_the_eclipse'
  // Per-ship + per-stage first-victory. One tracking type per id (same reason as
  // the per-boss types above) so a win with one ship/stage never fans an unlock
  // to the others. Keyed from a ship/stage id by SHIP_WIN_TRACKING /
  // STAGE_WIN_TRACKING in AchievementDefinitions.
  | 'ship_win_default'
  | 'ship_win_interceptor'
  | 'ship_win_dreadnought'
  | 'ship_win_scholar'
  | 'ship_win_juggernaut'
  | 'ship_win_void_walker'
  | 'ship_win_boss_hunter'
  | 'ship_win_flawless'
  | 'ship_win_glass_cannon'
  | 'ship_win_elite_slayer'
  | 'ship_win_apex'
  | 'stage_win_deep_void'
  | 'stage_win_inferno'
  | 'stage_win_crystal_caves'
  | 'stage_win_endless_void'
  | 'stage_win_ion_field'
  | 'stage_win_verdant_rot'
  | 'stage_win_molten_vault';

// ═══════════════════════════════════════════════════════════════════════════
// REWARD TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type RewardType =
  | 'xp_bonus'         // Add XP directly during run
  | 'reroll_token'     // Add reroll tokens
  | 'temp_buff'        // Temporary stat buff
  | 'gold'             // Permanent gold (for achievements)
  | 'unlock'           // Unlock something (upgrade, etc.)
  | 'stat_bonus';      // Permanent stat bonus (for achievements)

export interface MilestoneReward {
  type: 'xp_bonus' | 'reroll_token' | 'temp_buff';
  value: number;
  description: string;
  buffType?: 'damage' | 'speed' | 'all_stats';  // For temp_buff
  buffDuration?: number;                         // Duration in ms
}

export interface AchievementReward {
  type: 'gold' | 'unlock' | 'stat_bonus';
  value: number;
  description: string;
  unlockId?: string;      // For unlock rewards
  statBonusId?: string;   // For stat_bonus rewards (maps to a bonus key)
}

/**
 * Multi-reward wrapper — an achievement can grant gold AND a stat bonus.
 */
export interface AchievementRewards {
  gold?: number;
  statBonus?: { id: string; value: number; description: string };
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

  // Reward (primary — usually gold)
  reward: AchievementReward;

  // Optional secondary reward (stat bonus) — applied alongside primary reward
  bonusReward?: AchievementReward;

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
  totalBossesKilled: number;
  totalGoldEarned: number;
  highestLevel: number;
  highestWorldLevel: number;
  longestSurvivalSeconds: number;
  fastestVictorySeconds: number;
  perfectRuns: number;      // Wins without taking damage
  speedRuns: number;        // Wins under 8 minutes
  mostKillsInRun: number;   // Single-run kill record
  highestComboInRun: number; // Single-run combo record
}

/**
 * Persistent achievement state (stored in SecureStorage).
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
  accountLevel?: number;
  bestStreak?: number;
  highestCombo?: number;
  shipId?: string;
  stageId?: string;
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
  playSound?: boolean;    // Deprecated — sound is now handled by the caller via SoundManager
}
