/**
 * RelicManager — per-run relic inventory and stat application.
 *
 * Max 6 equipped per run. Pickup triggers apply() on the player's stats.
 * Not persisted — relics reset each run. Hook into GameScene via getRelicManager(scene).
 */

import { Relic, pickRandomRelic, getRelicById } from '../data/Relics';
import { PlayerStats } from '../data/Upgrades';

const MAX_RELICS_PER_RUN = 6;

export class RelicManager {
  private equippedRelics: Relic[] = [];

  /** Resets relic inventory (call at run start). */
  reset(): void {
    this.equippedRelics = [];
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
    const rolled = pickRandomRelic(excludeIds);
    if (!rolled) return null;
    return this.equipRelic(rolled, stats);
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
