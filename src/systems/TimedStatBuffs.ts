/**
 * Pure logic for temporary, timed multiplicative buffs on a named PlayerStats
 * numeric field — e.g. Power Surge's "2× damage for 8s", Elite Surge's
 * "2× XP for 10s", Golden Tide's "3× gem value for 10s".
 *
 * Each buff records the stat it scales, the multiplier it applied, and the
 * absolute run `gameTime` at which it should revert. Because expiry is keyed to
 * the run's serialized `gameTime` clock — not a Phaser `delayedCall` that dies
 * on page reload — these buffs survive refresh-recovery: the save stores the
 * buff list verbatim and `gameTime` is restored to the same value, so each buff
 * reverts at exactly the moment it would have without the reload.
 *
 * This generalises the original damage-only list (see BUG-EVENT-BUFF-REVERT):
 * Elite Surge (XP) and Golden Tide (gem value) used a `delayedCall` revert that
 * dies on reload while the save baked the already-multiplied stat, leaving the
 * boon permanent on a mid-event refresh — the same class of bug the power-shrine
 * (`eb16e16`) and Power Surge (`d7ab577`) fixes already closed for damage.
 */

/** PlayerStats numeric fields a timed buff may scale (the multipliers plus base `moveSpeed`). */
export type TimedStatField = 'damageMultiplier' | 'xpMultiplier' | 'gemValueMultiplier' | 'moveSpeed';

export interface TimedStatBuff {
  /** Which PlayerStats field this buff scales (and divides back out on expiry). */
  stat: TimedStatField;
  /** Multiplier this buff applied to its stat; divided back out on expiry. */
  magnitude: number;
  /** Absolute run `gameTime` (seconds) at which the buff reverts. */
  expiresAt: number;
}

/**
 * Serialised form of a timed buff. `stat` is optional so saves written before
 * the system was generalised (damage-only, no `stat` field) still load —
 * `normalizeTimedStatBuffs` defaults the missing field to `damageMultiplier`.
 */
export interface SerializedTimedStatBuff {
  stat?: TimedStatField;
  magnitude: number;
  expiresAt: number;
}

/**
 * Partition timed buffs against the current `gameTime`, grouping the revert
 * divisor per stat field.
 *
 * Pure: callers apply the revert themselves by dividing each PlayerStats field
 * by its divisor and replacing their buff list with `active`.
 *
 * @returns `active` — buffs that have not yet expired; `revertByStat` — for each
 *   stat with at least one expired buff, the product of those buffs' magnitudes
 *   (stats with nothing expired are absent from the map).
 */
export function expireTimedStatBuffs(
  buffs: TimedStatBuff[],
  gameTime: number,
): { active: TimedStatBuff[]; revertByStat: Partial<Record<TimedStatField, number>> } {
  const active: TimedStatBuff[] = [];
  const revertByStat: Partial<Record<TimedStatField, number>> = {};
  for (const buff of buffs) {
    if (gameTime >= buff.expiresAt) {
      revertByStat[buff.stat] = (revertByStat[buff.stat] ?? 1) * buff.magnitude;
    } else {
      active.push(buff);
    }
  }
  return { active, revertByStat };
}

/**
 * Normalises a serialised buff list into the in-memory form, defaulting a
 * missing `stat` to `damageMultiplier` — the only buff kind that existed before
 * the system was generalised, so legacy saves keep reverting correctly.
 * Undefined input (absent on the save) yields an empty list.
 */
export function normalizeTimedStatBuffs(
  raw: SerializedTimedStatBuff[] | undefined,
): TimedStatBuff[] {
  if (!raw) return [];
  return raw.map((entry) => ({
    stat: entry.stat ?? 'damageMultiplier',
    magnitude: entry.magnitude,
    expiresAt: entry.expiresAt,
  }));
}

/**
 * Applies a field boost to a buff list, refreshing instead of stacking.
 *
 * Pure: returns a new list. `applied` tells the caller whether it must also
 * multiply the PlayerStats field — a refresh must NOT multiply again, or the
 * stat would compound while only one revert is ever queued.
 */
export function applyFieldBoost(
  buffs: TimedStatBuff[],
  stat: TimedStatField,
  magnitude: number,
  durationSeconds: number,
  gameTime: number,
): { buffs: TimedStatBuff[]; applied: boolean } {
  const expiresAt = gameTime + durationSeconds;
  // Matched on stat AND magnitude: a boost must refresh only its own kind, never a
  // shrine / event / ultimate buff that happens to scale the same stat.
  const existingIndex = buffs.findIndex((buff) => buff.stat === stat && buff.magnitude === magnitude);
  if (existingIndex === -1) {
    return { buffs: [...buffs, { stat, magnitude, expiresAt }], applied: true };
  }
  const refreshed = buffs.slice();
  refreshed[existingIndex] = { ...refreshed[existingIndex], expiresAt };
  return { buffs: refreshed, applied: false };
}
