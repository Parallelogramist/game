/**
 * upgradeLocks.ts — pure logic for "locking" level-up cards.
 *
 * Locking is the canonical survivor-like build-crafting tool: the player pins
 * the upgrade card they want, then a reroll only reshuffles the *unlocked*
 * slots. The locked card is carried verbatim into the regenerated offer set.
 *
 * This module is Phaser-free so the merge/cap/toggle rules can be unit-tested.
 * The UpgradeScene draws the lock toggle; GameScene owns the locked-set state
 * and calls {@link mergeLockedIntoOffers} when it regenerates offers on a
 * reroll or banish.
 */

/**
 * Maximum number of cards that may be locked for a hand of `count` cards.
 *
 * Always leaves at least one rerollable slot — locking every card would make a
 * reroll a no-op that silently burns a charge. Clamped to 0 for degenerate
 * counts.
 */
export function lockCapacity(count: number): number {
  return Math.max(0, count - 1);
}

/**
 * Toggle `id` in a locked-id list, respecting the lock `capacity`.
 *
 * - If `id` is already locked, it is unlocked (always allowed, even at cap).
 * - If `id` is not locked, it is added — but only when fewer than `capacity`
 *   cards are currently locked; otherwise the list is returned unchanged.
 *
 * Returns a new array; never mutates the input.
 */
export function toggleLockedId(lockedIds: string[], id: string, capacity: number): string[] {
  if (lockedIds.includes(id)) {
    return lockedIds.filter(existing => existing !== id);
  }
  if (lockedIds.length >= capacity) {
    return lockedIds.slice();
  }
  return [...lockedIds, id];
}

/**
 * Compose the offer set for a reroll/banish refresh while preserving locked
 * cards.
 *
 * Locked upgrades are pinned to the front in their given order (deduped by
 * id), then the remaining slots are filled from the freshly-generated `fresh`
 * pool — skipping any whose id is already present — until `count` is reached.
 * The result may be shorter than `count` when the combined pool is small (every
 * other upgrade maxed/banished), matching the generator's own behavior.
 *
 * Generic over `{ id: string }` so it works for `CombinedUpgrade` without a
 * Phaser dependency.
 */
export function mergeLockedIntoOffers<T extends { id: string }>(
  locked: T[],
  fresh: T[],
  count: number,
): T[] {
  const result: T[] = [];
  const usedIds = new Set<string>();

  const tryPush = (upgrade: T): void => {
    if (result.length >= count) return;
    if (usedIds.has(upgrade.id)) return;
    usedIds.add(upgrade.id);
    result.push(upgrade);
  };

  for (const upgrade of locked) tryPush(upgrade);
  for (const upgrade of fresh) tryPush(upgrade);

  return result;
}
