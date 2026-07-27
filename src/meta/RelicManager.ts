/**
 * RelicManager — per-run relic inventory and stat application.
 *
 * Max 6 equipped per run. Pickup triggers apply() on the player's stats.
 * Not persisted — relics reset each run. Hook into GameScene via getRelicManager(scene).
 */

import { Relic, pickRandomRelic, getRelicById, RelicRarity, rarityAtLeast } from '../data/Relics';
import { PlayerStats } from '../data/Upgrades';
import { shuffleWithRng } from '../utils/dailySeed';

const MAX_RELICS_PER_RUN = 6;

// Relic bad-luck protection ("pity"): after this many consecutive granted
// relics below RELIC_PITY_FLOOR, the next roll is forced to the floor rarity or
// better, so a run's relic power never stalls on an unlucky common/rare streak.
// Epic+ relics are the build-defining ones (~10% base drop odds) and a run
// equips at most MAX_RELICS_PER_RUN, so many runs would otherwise see none.
// First-pass values — feel/balance owned by POLISH-RELIC-PITY (BACKLOG.md
// ## Human gates).
const RELIC_PITY_THRESHOLD = 3;
const RELIC_PITY_FLOOR: RelicRarity = 'epic';

// Reinforce (FEAT-RELIC-REINFORCE): with all MAX_RELICS_PER_RUN slots filled, a
// further relic award raises one equipped relic a rank instead of being discarded.
// A rank re-runs that relic's apply(), so one award is worth exactly one relic
// effect either way. Cap is a first-pass balance knob (POLISH-RELIC-REINFORCE).
export const MAX_RELIC_RANK = 3;
export const RELIC_REINFORCE_CHOICE_COUNT = 3;

const RANK_NUMERALS: readonly string[] = ['', 'I', 'II', 'III'];

/** Roman numeral for a relic rank, clamped into [1, MAX_RELIC_RANK]. */
export function relicRankNumeral(rank: number): string {
  const safe = Number.isFinite(rank)
    ? Math.min(MAX_RELIC_RANK, Math.max(1, Math.floor(rank)))
    : 1;
  return RANK_NUMERALS[safe];
}

export class RelicManager {
  private equippedRelics: Relic[] = [];
  // Consecutive granted relics below RELIC_PITY_FLOOR. Per-run only: reset in
  // reset(), never persisted (restoreFromSave restores ids, not this streak).
  private subFloorStreak: number = 0;
  // Trophy relics the player has earned (FEAT-BOSS-TROPHY), handed in at run
  // start. Held per-run because unlock state is read once from the codex, not
  // per roll.
  private unlockedTrophies: readonly Relic[] = [];
  // Rank per equipped relic id, 1..MAX_RELIC_RANK. Rank 1 is set on equip; a
  // reinforce raises it. Per-run only, persisted alongside relicIds so a mid-run
  // refresh keeps the ranks the saved playerStats already bakes in.
  private relicRanks: Map<string, number> = new Map();

  /** Resets relic inventory + pity streak (call at run start). */
  reset(unlockedTrophies: readonly Relic[] = []): void {
    this.equippedRelics = [];
    this.subFloorStreak = 0;
    this.unlockedTrophies = unlockedTrophies;
    this.relicRanks.clear();
  }

  /** Returns the ordered list of equipped relics. */
  getEquippedRelics(): readonly Relic[] {
    return this.equippedRelics;
  }

  /** Returns true if relic inventory is full. */
  isFull(): boolean {
    return this.equippedRelics.length >= MAX_RELICS_PER_RUN;
  }

  /** True if the player has this relic equipped. */
  hasRelic(relicId: string): boolean {
    return this.equippedRelics.some((relic) => relic.id === relicId);
  }

  /** Rank of an equipped relic (1..MAX_RELIC_RANK); 0 if it is not equipped. */
  getRelicRank(relicId: string): number {
    return this.relicRanks.get(relicId) ?? 0;
  }

  /** Rank map for the save payload, keyed by relic id. */
  getRelicRanks(): Record<string, number> {
    return Object.fromEntries(this.relicRanks);
  }

  /**
   * Attempts to equip a relic, applying its effect to the given stats.
   * Returns the relic if equipped, or null if duplicate / full.
   */
  equipRelic(relic: Relic, stats: PlayerStats): Relic | null {
    if (this.isFull()) return null;
    if (this.hasRelic(relic.id)) return null;

    this.equippedRelics.push(relic);
    relic.apply(stats);
    this.relicRanks.set(relic.id, 1);
    return relic;
  }

  /**
   * Rolls a random relic that the player doesn't already have, applying it.
   * Returns the relic, or null if inventory is full or no relics are available.
   */
  rollAndEquipRandomRelic(stats: PlayerStats): Relic | null {
    if (this.isFull()) return null;
    const excludeIds = this.equippedRelics.map((relic) => relic.id);
    // Pity: once the sub-floor streak reaches the threshold, force this roll to
    // the pity floor (epic) or better.
    const forceFloor = this.subFloorStreak >= RELIC_PITY_THRESHOLD;
    // Luck biases the rarity roll toward higher-quality relics (luck 0 = base odds).
    const rolled = pickRandomRelic(
      excludeIds,
      stats.luck,
      forceFloor ? RELIC_PITY_FLOOR : undefined,
      this.unlockedTrophies,
    );
    if (!rolled) return null;
    const equipped = this.equipRelic(rolled, stats);
    if (equipped) {
      this.subFloorStreak = rarityAtLeast(equipped.rarity, RELIC_PITY_FLOOR)
        ? 0
        : this.subFloorStreak + 1;
    }
    return equipped;
  }

  /**
   * Rolls up to `count` DISTINCT relic choices for an in-run draft (1-of-N pick),
   * respecting equipped relics, luck bias, and the pity floor. When the pity
   * streak is at the threshold the floor is applied to EVERY choice, so whichever
   * the player picks satisfies the guarantee. Does NOT equip or touch the streak
   * — equipDraftedRelic does that when the player picks. Returns fewer than
   * `count` (possibly 0) only if the eligible pool is exhausted.
   */
  rollRelicChoices(stats: PlayerStats, count = 3): Relic[] {
    const choices: Relic[] = [];
    const forceFloor = this.subFloorStreak >= RELIC_PITY_THRESHOLD;
    const excludeIds = this.equippedRelics.map((relic) => relic.id);
    for (let i = 0; i < count; i++) {
      const rolled = pickRandomRelic(
        excludeIds,
        stats.luck,
        forceFloor ? RELIC_PITY_FLOOR : undefined,
        this.unlockedTrophies,
      );
      if (!rolled) break;
      choices.push(rolled);
      excludeIds.push(rolled.id);
    }
    return choices;
  }

  /** True if any equipped relic is still below MAX_RELIC_RANK. */
  hasReinforceCandidates(): boolean {
    return this.equippedRelics.some(
      (relic) => (this.relicRanks.get(relic.id) ?? 0) < MAX_RELIC_RANK,
    );
  }

  /**
   * Up to `count` equipped relics eligible for a reinforce draft, drawn with a
   * uniform shuffle so a full inventory does not offer the same three every time.
   * Returns [] once every equipped relic sits at MAX_RELIC_RANK. Does NOT apply
   * anything: reinforceRelic does that when the player picks.
   */
  reinforceChoices(count = RELIC_REINFORCE_CHOICE_COUNT): Relic[] {
    const eligible = this.equippedRelics.filter(
      (relic) => (this.relicRanks.get(relic.id) ?? 0) < MAX_RELIC_RANK,
    );
    return shuffleWithRng(eligible, Math.random).slice(0, count);
  }

  /**
   * Equips a relic the player drafted, applying its effect and updating the pity
   * streak (reset on an epic+ grant, else incremented) exactly like an auto grant.
   * Returns the relic if equipped, or null if full / duplicate.
   */
  equipDraftedRelic(relic: Relic, stats: PlayerStats): Relic | null {
    const equipped = this.equipRelic(relic, stats);
    if (equipped) {
      this.subFloorStreak = rarityAtLeast(equipped.rarity, RELIC_PITY_FLOOR)
        ? 0
        : this.subFloorStreak + 1;
    }
    return equipped;
  }

  /**
   * Raises an equipped relic one rank, re-running its apply() on the given stats.
   * Returns the new rank, or null if the relic is not equipped or already capped.
   * The pity streak is deliberately untouched: pity governs the rarity of NEW
   * relics, and a reinforce rolls nothing.
   */
  reinforceRelic(relic: Relic, stats: PlayerStats): number | null {
    const currentRank = this.relicRanks.get(relic.id) ?? 0;
    if (currentRank < 1 || currentRank >= MAX_RELIC_RANK) return null;
    relic.apply(stats);
    const nextRank = currentRank + 1;
    this.relicRanks.set(relic.id, nextRank);
    return nextRank;
  }

  /**
   * Restore relic inventory from a saved state. Does NOT re-apply effects.
   * Used by GameStateManager on mid-run reload to preserve inventory display.
   * Ranks are sanitized on read (clamped into [1, MAX_RELIC_RANK]) so a
   * truncated or tampered save degrades to rank 1 rather than granting power.
   */
  restoreFromSave(relicIds: string[], ranks?: Record<string, number>): void {
    this.equippedRelics = [];
    this.relicRanks.clear();
    for (const relicId of relicIds) {
      const relic = getRelicById(relicId);
      if (!relic) continue;
      this.equippedRelics.push(relic);
      const rawRank = ranks?.[relicId];
      const rank = Number.isFinite(rawRank)
        ? Math.min(MAX_RELIC_RANK, Math.max(1, Math.floor(rawRank as number)))
        : 1;
      this.relicRanks.set(relicId, rank);
    }
  }
}

let relicManagerSingleton: RelicManager | null = null;
export function getRelicManager(): RelicManager {
  if (!relicManagerSingleton) {
    relicManagerSingleton = new RelicManager();
  }
  return relicManagerSingleton;
}
