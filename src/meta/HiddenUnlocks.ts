/**
 * HiddenUnlocks — secret-condition unlock chains for weapons, ships, and cosmetics.
 *
 * Each unlock has:
 *   - A stable id (persisted in SecureStorage)
 *   - A condition predicate evaluated after each run
 *   - A hint shown to the player ("Reach 100 combo") that's only revealed after
 *     the unlock is earned (or via an achievement milestone).
 *
 * Tested after each run via HiddenUnlockManager.evaluatePostRun(), which may
 * fire toast notifications via a registered callback.
 */

import { SecureStorage } from '../storage/SecureStorage';
import { LifetimeStats } from '../achievements/AchievementTypes';

const STORAGE_KEY_HIDDEN_UNLOCKS = 'hiddenUnlocksV1';

export type HiddenUnlockTarget =
  | 'weapon'      // Unlocks a weapon in WeaponSelectScene
  | 'ship'        // Unlocks a ship/character
  | 'cosmetic'    // Unlocks a visual variant
  | 'stage';      // Unlocks a biome/stage

export interface HiddenUnlockCondition {
  id: string;
  target: HiddenUnlockTarget;
  unlockId: string;          // The weapon/ship/etc. this gates
  displayName: string;       // Shown in toast on unlock
  hintText: string;          // Shown after unlock to explain how it was earned
  /**
   * Predicate evaluates to true if the run that just ended satisfies the unlock.
   * Evaluated with: (1) the run's end-of-run context, (2) lifetime stats.
   */
  predicate: (context: UnlockEvaluationContext) => boolean;
  /**
   * Optional numeric progress function. When present, this condition is eligible
   * for the "closest to unlock" post-run panel. Return { current, target } with
   * current capped to target. Boolean-only unlocks omit this (e.g. "defeat X
   * without dying") — they don't have a clean progress metric.
   */
  getProgress?: (context: UnlockEvaluationContext) => { current: number; target: number };
}

/** Shape returned by HiddenUnlockManager.getTopProgress. */
export interface UnlockProgressEntry {
  condition: HiddenUnlockCondition;
  current: number;
  target: number;
  ratio: number;
}

export interface UnlockEvaluationContext {
  run: {
    wasVictory: boolean;
    killCount: number;
    levelReached: number;
    survivalTimeSeconds: number;
    highestCombo: number;
    damageTaken: number;
    damageDealt: number;
    weaponIdsUsed: string[];
    worldLevel: number;
    noDamageTaken: boolean;
    /** Consecutive-win streak as of this run's end (0 on a loss). */
    winStreak: number;
  };
  lifetime: LifetimeStats;
}

// ---------------------------------------------------------------------------
// Unlock definitions (20+ hidden conditions)
// ---------------------------------------------------------------------------

export const HIDDEN_UNLOCKS: HiddenUnlockCondition[] = [
  // ═══ First-run onboarding hook (always earnable, keeps new players) ═══
  {
    id: 'unlock_first_survivor',
    target: 'cosmetic',
    unlockId: 'cosmetic_survivor_trim',
    displayName: 'Initiate Trim',
    hintText: 'Complete your first run',
    predicate: ({ lifetime }) => lifetime.totalRunsCompleted >= 1,
    getProgress: ({ lifetime }) => ({ current: Math.min(1, lifetime.totalRunsCompleted), target: 1 }),
  },
  {
    id: 'unlock_first_level_5',
    target: 'cosmetic',
    unlockId: 'cosmetic_rookie_badge',
    displayName: 'Rookie Badge',
    hintText: 'Reach level 5 in any run',
    predicate: ({ run }) => run.levelReached >= 5,
    getProgress: ({ run }) => ({ current: Math.min(5, run.levelReached), target: 5 }),
  },
  // ═══ Weapon unlocks ═══
  {
    id: 'unlock_combo_king',
    target: 'cosmetic',
    unlockId: 'cosmetic_inferno_trail',
    displayName: 'Inferno Trail',
    hintText: 'Reach 100 combo in a single run',
    predicate: ({ run }) => run.highestCombo >= 100,
    getProgress: ({ run }) => ({ current: Math.min(100, run.highestCombo), target: 100 }),
  },
  {
    id: 'unlock_speed_runner',
    target: 'cosmetic',
    unlockId: 'cosmetic_speed_glow',
    displayName: 'Speedrun Glow',
    hintText: 'Win a run in under 8 minutes',
    predicate: ({ run }) => run.wasVictory && run.survivalTimeSeconds < 480,
  },
  {
    id: 'unlock_pacifist',
    target: 'ship',
    unlockId: 'ship_scholar',
    displayName: 'Scholar Ship',
    hintText: 'Reach level 10 without using any weapon upgrades',
    // Approximation: reached level 10+ but used <= 1 unique weapon
    predicate: ({ run }) => run.levelReached >= 10 && run.weaponIdsUsed.length <= 1,
  },
  {
    id: 'unlock_ironclad',
    target: 'ship',
    unlockId: 'ship_juggernaut',
    displayName: 'Juggernaut Ship',
    hintText: 'Survive 5 minutes without taking damage',
    predicate: ({ run }) => run.survivalTimeSeconds >= 300 && run.noDamageTaken,
  },
  {
    id: 'unlock_annihilator',
    target: 'cosmetic',
    unlockId: 'cosmetic_gold_hull',
    displayName: 'Golden Hull',
    hintText: 'Kill 1,500 enemies in a single run',
    predicate: ({ run }) => run.killCount >= 1500,
    getProgress: ({ run }) => ({ current: Math.min(1500, run.killCount), target: 1500 }),
  },
  {
    id: 'unlock_void_walker',
    target: 'ship',
    unlockId: 'ship_void_walker',
    displayName: 'Void Walker Ship',
    hintText: 'Defeat Void Wyrm without dying',
    predicate: ({ run }) => run.wasVictory && run.worldLevel >= 2,
  },
  {
    id: 'unlock_marathon',
    target: 'cosmetic',
    unlockId: 'cosmetic_starforge',
    displayName: 'Starforge Badge',
    hintText: 'Survive 20 minutes in a single run',
    predicate: ({ run }) => run.survivalTimeSeconds >= 1200,
    getProgress: ({ run }) => ({ current: Math.min(1200, run.survivalTimeSeconds), target: 1200 }),
  },
  {
    id: 'unlock_critical_master',
    target: 'cosmetic',
    unlockId: 'cosmetic_crit_aura',
    displayName: 'Crit Aura',
    hintText: 'Accumulate 10,000 critical hits',
    predicate: ({ lifetime }) => lifetime.totalCriticalHits >= 10000,
    getProgress: ({ lifetime }) => ({ current: Math.min(10000, lifetime.totalCriticalHits), target: 10000 }),
  },
  {
    id: 'unlock_boss_hunter',
    target: 'ship',
    unlockId: 'ship_boss_hunter',
    displayName: 'Boss Hunter Ship',
    hintText: 'Defeat 25 bosses across all runs',
    predicate: ({ lifetime }) => lifetime.totalBossesKilled >= 25,
    getProgress: ({ lifetime }) => ({ current: Math.min(25, lifetime.totalBossesKilled), target: 25 }),
  },
  {
    id: 'unlock_veteran',
    target: 'cosmetic',
    unlockId: 'cosmetic_veteran_trim',
    displayName: 'Veteran Trim',
    hintText: 'Complete 50 runs',
    predicate: ({ lifetime }) => lifetime.totalRunsCompleted >= 50,
    getProgress: ({ lifetime }) => ({ current: Math.min(50, lifetime.totalRunsCompleted), target: 50 }),
  },
  {
    id: 'unlock_damage_dealer',
    target: 'cosmetic',
    unlockId: 'cosmetic_damage_dealer',
    displayName: 'Damage Dealer Badge',
    hintText: 'Deal 1,000,000 total damage',
    predicate: ({ lifetime }) => lifetime.totalDamageDealt >= 1_000_000,
    getProgress: ({ lifetime }) => ({ current: Math.min(1_000_000, lifetime.totalDamageDealt), target: 1_000_000 }),
  },
  {
    id: 'unlock_streaker',
    target: 'cosmetic',
    unlockId: 'cosmetic_streak_flame',
    displayName: 'Streak Flame',
    hintText: 'Win 5 runs in a row',
    // A genuine 5-win streak — the consecutive-win counter as of this victory, not
    // total lifetime wins. (The previous `totalVictories % 5` check unlocked on the
    // 5th win *ever*, regardless of losses in between, contradicting the hint.)
    predicate: ({ run }) => run.wasVictory && run.winStreak >= 5,
  },
  {
    id: 'unlock_maximalist',
    target: 'cosmetic',
    unlockId: 'cosmetic_max_gear',
    displayName: 'Maximalist Plate',
    hintText: 'Equip 5+ different weapons in one run',
    predicate: ({ run }) => run.weaponIdsUsed.length >= 5,
    getProgress: ({ run }) => ({ current: Math.min(5, run.weaponIdsUsed.length), target: 5 }),
  },
  {
    id: 'unlock_glass_cannon',
    target: 'ship',
    unlockId: 'ship_glass_cannon',
    displayName: 'Glass Cannon Ship',
    hintText: 'Deal 100,000 damage in a single run',
    predicate: ({ run }) => run.damageDealt >= 100_000,
    getProgress: ({ run }) => ({ current: Math.min(100_000, run.damageDealt), target: 100_000 }),
  },
  {
    id: 'unlock_level_master',
    target: 'cosmetic',
    unlockId: 'cosmetic_level_crown',
    displayName: 'Level Crown',
    hintText: 'Reach level 30 in a single run',
    predicate: ({ run }) => run.levelReached >= 30,
    getProgress: ({ run }) => ({ current: Math.min(30, run.levelReached), target: 30 }),
  },
  {
    id: 'unlock_flawless',
    target: 'ship',
    unlockId: 'ship_flawless',
    displayName: 'Flawless Ship',
    hintText: 'Win a run without taking any damage',
    predicate: ({ run }) => run.wasVictory && run.noDamageTaken,
  },
  {
    id: 'unlock_long_run',
    target: 'stage',
    unlockId: 'stage_endless_void',
    displayName: 'Endless Void Stage',
    hintText: 'Survive 30 minutes in a single run',
    predicate: ({ run }) => run.survivalTimeSeconds >= 1800,
    getProgress: ({ run }) => ({ current: Math.min(1800, run.survivalTimeSeconds), target: 1800 }),
  },
  {
    id: 'unlock_cluster_bomber',
    target: 'cosmetic',
    unlockId: 'cosmetic_cluster_badge',
    displayName: 'Cluster Badge',
    hintText: 'Reach 500 combo in a single run',
    predicate: ({ run }) => run.highestCombo >= 500,
    getProgress: ({ run }) => ({ current: Math.min(500, run.highestCombo), target: 500 }),
  },
  {
    id: 'unlock_elite_slayer',
    target: 'ship',
    unlockId: 'ship_elite_slayer',
    displayName: 'Elite Slayer Ship',
    hintText: 'Kill 10,000 enemies across all runs',
    predicate: ({ lifetime }) => lifetime.totalKills >= 10_000,
    getProgress: ({ lifetime }) => ({ current: Math.min(10_000, lifetime.totalKills), target: 10_000 }),
  },
  {
    id: 'unlock_world_traveler',
    target: 'stage',
    unlockId: 'stage_crystal_caves',
    displayName: 'Crystal Caves Stage',
    hintText: 'Reach world level 3',
    predicate: ({ lifetime }) => lifetime.highestWorldLevel >= 3,
    getProgress: ({ lifetime }) => ({ current: Math.min(3, lifetime.highestWorldLevel), target: 3 }),
  },
  {
    id: 'unlock_apex',
    target: 'ship',
    unlockId: 'ship_apex',
    displayName: 'Apex Ship',
    hintText: 'Complete a world level 5 victory',
    predicate: ({ run, lifetime }) => run.wasVictory && lifetime.highestWorldLevel >= 5,
  },
];

// ---------------------------------------------------------------------------
// HiddenUnlockManager singleton
// ---------------------------------------------------------------------------

interface HiddenUnlockState {
  version: number;
  unlocked: Record<string, { unlockedAt: number }>;
}

const HIDDEN_UNLOCKS_VERSION = 1;

export class HiddenUnlockManager {
  private state: HiddenUnlockState;
  private onNewUnlockCallback: ((condition: HiddenUnlockCondition) => void) | null = null;

  constructor() {
    this.state = this.loadState();
  }

  /** Register a handler fired whenever a new hidden unlock is earned. */
  setOnNewUnlock(callback: (condition: HiddenUnlockCondition) => void): void {
    this.onNewUnlockCallback = callback;
  }

  /** Returns true if the given unlock id has been earned. */
  isUnlocked(unlockId: string): boolean {
    // Check if any condition with this unlockId has been satisfied
    for (const conditionId in this.state.unlocked) {
      const condition = HIDDEN_UNLOCKS.find((definition) => definition.id === conditionId);
      if (condition && condition.unlockId === unlockId) return true;
    }
    return false;
  }

  /** Returns the IDs of all satisfied hidden unlock conditions. */
  getUnlockedConditionIds(): string[] {
    return Object.keys(this.state.unlocked);
  }

  /** Returns all unlocked target ids (weapons/ships/cosmetics/stages). */
  getUnlockedTargetIds(): string[] {
    const targetIds: string[] = [];
    for (const conditionId in this.state.unlocked) {
      const condition = HIDDEN_UNLOCKS.find((definition) => definition.id === conditionId);
      if (condition) targetIds.push(condition.unlockId);
    }
    return targetIds;
  }

  /**
   * Evaluate all hidden unlocks after a run. Persists newly-earned unlocks and
   * fires the callback for each one. Returns the list of newly unlocked conditions.
   */
  evaluatePostRun(context: UnlockEvaluationContext): HiddenUnlockCondition[] {
    const newlyUnlocked: HiddenUnlockCondition[] = [];
    for (const condition of HIDDEN_UNLOCKS) {
      if (this.state.unlocked[condition.id]) continue; // Already earned
      try {
        if (condition.predicate(context)) {
          this.state.unlocked[condition.id] = { unlockedAt: Date.now() };
          newlyUnlocked.push(condition);
          if (this.onNewUnlockCallback) this.onNewUnlockCallback(condition);
        }
      } catch (err) {
        console.warn(`HiddenUnlocks: predicate threw for ${condition.id}`, err);
      }
    }
    if (newlyUnlocked.length > 0) {
      this.saveState();
    }
    return newlyUnlocked;
  }

  /** For debugging / ascension: wipe all hidden unlock progress. */
  resetAll(): void {
    this.state = createDefaultState();
    this.saveState();
  }

  /**
   * Returns the top N locked unlocks the player is closest to earning, sorted
   * by progress ratio descending. Skips already-unlocked conditions and any
   * condition without a getProgress function (boolean-only unlocks aren't
   * trackable). Used by the post-run panel to motivate the next run.
   */
  getTopProgress(context: UnlockEvaluationContext, limit: number = 3): UnlockProgressEntry[] {
    const trackedEntries: UnlockProgressEntry[] = [];
    for (const condition of HIDDEN_UNLOCKS) {
      if (this.state.unlocked[condition.id]) continue;
      if (!condition.getProgress) continue;
      try {
        const progressValues = condition.getProgress(context);
        if (progressValues.target <= 0) continue;
        const ratio = Math.max(0, Math.min(1, progressValues.current / progressValues.target));
        // Skip zero-progress entries — showing "0/1000 kills" doesn't motivate.
        if (ratio <= 0) continue;
        trackedEntries.push({
          condition,
          current: progressValues.current,
          target: progressValues.target,
          ratio,
        });
      } catch (err) {
        console.warn(`HiddenUnlocks: getProgress threw for ${condition.id}`, err);
      }
    }
    trackedEntries.sort((a, b) => b.ratio - a.ratio);
    return trackedEntries.slice(0, limit);
  }

  private loadState(): HiddenUnlockState {
    const defaults = createDefaultState();
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_HIDDEN_UNLOCKS);
      if (stored) {
        const parsed = JSON.parse(stored) as HiddenUnlockState;
        return {
          version: HIDDEN_UNLOCKS_VERSION,
          unlocked: { ...defaults.unlocked, ...parsed.unlocked },
        };
      }
    } catch {
      console.warn('HiddenUnlocks: could not load state');
    }
    return defaults;
  }

  private saveState(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_HIDDEN_UNLOCKS, JSON.stringify(this.state));
    } catch {
      console.warn('HiddenUnlocks: could not save state');
    }
  }
}

function createDefaultState(): HiddenUnlockState {
  return {
    version: HIDDEN_UNLOCKS_VERSION,
    unlocked: {},
  };
}

let hiddenUnlockManagerSingleton: HiddenUnlockManager | null = null;

export function getHiddenUnlockManager(): HiddenUnlockManager {
  if (!hiddenUnlockManagerSingleton) {
    hiddenUnlockManagerSingleton = new HiddenUnlockManager();
  }
  return hiddenUnlockManagerSingleton;
}
