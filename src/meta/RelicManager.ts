/**
 * RelicManager — per-run relic inventory and stat application.
 *
 * Max 6 equipped per run. Pickup triggers apply() on the player's stats.
 * Not persisted — relics reset each run. Hook into GameScene via getRelicManager(scene).
 */

import { Relic, pickRandomRelic, getRelicById, RelicRarity, rarityAtLeast } from '../data/Relics';
import { PlayerStats } from '../data/Upgrades';

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

export class RelicManager {
  private equippedRelics: Relic[] = [];
  // Consecutive granted relics below RELIC_PITY_FLOOR. Per-run only: reset in
  // reset(), never persisted (restoreFromSave restores ids, not this streak).
  private subFloorStreak: number = 0;

  /** Resets relic inventory + pity streak (call at run start). */
  reset(): void {
    this.equippedRelics = [];
    this.subFloorStreak = 0;
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

  /**
   * Attempts to equip a relic, applying its effect to the given stats.
   * Returns the relic if equipped, or null if duplicate / full.
   */
  equipRelic(relic: Relic, stats: PlayerStats): Relic | null {
    if (this.isFull()) return null;
    if (this.hasRelic(relic.id)) return null;

    this.equippedRelics.push(relic);
    relic.apply(stats);
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
    const rolled = pickRandomRelic(excludeIds, stats.luck, forceFloor ? RELIC_PITY_FLOOR : undefined);
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
      const rolled = pickRandomRelic(excludeIds, stats.luck, forceFloor ? RELIC_PITY_FLOOR : undefined);
      if (!rolled) break;
      choices.push(rolled);
      excludeIds.push(rolled.id);
    }
    return choices;
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
   * Restore relic inventory from a saved state. Does NOT re-apply effects.
   * Used by GameStateManager on mid-run reload to preserve inventory display.
   */
  restoreFromSave(relicIds: string[]): void {
    this.equippedRelics = [];
    for (const relicId of relicIds) {
      const relic = getRelicById(relicId);
      if (relic) this.equippedRelics.push(relic);
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
