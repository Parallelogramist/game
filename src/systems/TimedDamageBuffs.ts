/**
 * Pure logic for temporary, timed multiplicative damage buffs (e.g. the Power
 * field shrine's "double damage for 8 seconds").
 *
 * Each buff records the multiplier it applied to `PlayerStats.damageMultiplier`
 * and the absolute `gameTime` at which it should be reverted. Because expiry is
 * keyed to the run's serialized `gameTime` clock — not a Phaser `delayedCall`
 * that dies on page reload — these buffs survive refresh-recovery: the save
 * stores the buff list verbatim and `gameTime` is restored to the same value,
 * so the buff reverts at exactly the moment it would have without the reload.
 */
export interface TimedDamageBuff {
  /** Multiplier this buff applied to `damageMultiplier`; divided back out on expiry. */
  magnitude: number;
  /** Absolute run `gameTime` (seconds) at which the buff reverts. */
  expiresAt: number;
}

/**
 * Partition timed buffs against the current `gameTime`.
 *
 * Pure: callers apply the revert themselves by dividing `damageMultiplier` by
 * `revertDivisor` and replacing their buff list with `active`.
 *
 * @returns `active` — buffs that have not yet expired; `revertDivisor` — the
 *   product of all expired buffs' magnitudes (1 when nothing expired).
 */
export function expireTimedDamageBuffs(
  buffs: TimedDamageBuff[],
  gameTime: number,
): { active: TimedDamageBuff[]; revertDivisor: number } {
  let revertDivisor = 1;
  const active: TimedDamageBuff[] = [];
  for (const buff of buffs) {
    if (gameTime >= buff.expiresAt) {
      revertDivisor *= buff.magnitude;
    } else {
      active.push(buff);
    }
  }
  return { active, revertDivisor };
}
