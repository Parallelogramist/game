/**
 * Pure stat-derivation for the mid-run build dashboard (FEAT-PAUSE-RUN-STATS).
 *
 * The pause overlay shows DPS/damage rows post-run but, until now, there was no
 * way to inspect a build *while it matters* — "is my Katana or my Drone
 * carrying?" was unanswerable mid-run. This module turns the raw per-weapon run
 * stats (plus the run's elapsed time, kill count, and damage taken) into the
 * numbers that panel displays. It is deliberately Phaser-free so it can be
 * unit-tested headlessly; the panel rendering lives in PauseMenuManager.
 *
 * Every rate guards the divide-by-zero case: the pause menu can open one frame
 * into a run (elapsed time ~ 0, no hits recorded yet), and the dashboard must
 * never render NaN or Infinity.
 */

import { WeaponRunStats } from '../../weapons/WeaponManager';

/** Default number of weapons surfaced in the build breakdown. */
export const DEFAULT_TOP_WEAPONS = 5;

export interface BuildStatsInput {
  /** Per-weapon aggregate stats for the current run. */
  weaponStats: WeaponRunStats[];
  /** Run time elapsed, in seconds. */
  gameTimeSeconds: number;
  /** Total run kill count (may exceed weapon-attributed kills — environmental, etc.). */
  killCount: number;
  /** Total damage the player has taken this run. */
  totalDamageTaken: number;
}

/** A single weapon's contribution, ready to render as a dashboard row. */
export interface WeaponBreakdownRow {
  weaponId: string;
  weaponName: string;
  totalDamage: number;
  /** Fraction of all weapon damage this weapon accounts for (0..1). */
  damageShare: number;
  /** This weapon's damage per second over the elapsed run. */
  dps: number;
  kills: number;
  /** This weapon's crit rate (0..1). */
  critRate: number;
}

/** Everything the build dashboard needs, derived in one pass. */
export interface BuildStatsSummary {
  totalDamage: number;
  /** Headline damage per second across all weapons. */
  dps: number;
  /** Overall crit rate across all weapons (0..1). */
  critRate: number;
  /** Run kills per minute. */
  killsPerMinute: number;
  totalKills: number;
  totalDamageTaken: number;
  /** Top weapons, ordered by total damage descending. */
  topWeapons: WeaponBreakdownRow[];
}

/** Count per elapsed minute. Returns 0 when no time has elapsed (no Infinity). */
export function perMinuteRate(count: number, seconds: number): number {
  if (!(seconds > 0)) return 0;
  return count / (seconds / 60);
}

/** Total per elapsed second. Returns 0 when no time has elapsed (no Infinity). */
export function perSecondRate(total: number, seconds: number): number {
  if (!(seconds > 0)) return 0;
  return total / seconds;
}

/** numerator / denominator, but 0 when the denominator is non-positive (no NaN). */
export function safeRatio(numerator: number, denominator: number): number {
  if (!(denominator > 0)) return 0;
  return numerator / denominator;
}

/**
 * Weapons that have dealt damage, ordered by total damage descending, ties
 * broken by weapon name ascending for a deterministic order, truncated to the
 * top N. Does not mutate the input.
 */
export function orderWeaponsByDamage(
  weaponStats: WeaponRunStats[],
  topN: number = DEFAULT_TOP_WEAPONS,
): WeaponRunStats[] {
  return [...weaponStats]
    .filter((weapon) => weapon.totalDamage > 0)
    .sort(
      (firstWeapon, secondWeapon) =>
        secondWeapon.totalDamage - firstWeapon.totalDamage ||
        firstWeapon.weaponName.localeCompare(secondWeapon.weaponName),
    )
    .slice(0, Math.max(0, topN));
}

/**
 * Derives the full build dashboard summary from the run's raw stats. The
 * headline totals are summed over every weapon so the per-weapon damage shares
 * add up to 1; kills-per-minute uses the run kill count (not the per-weapon
 * sum) because not every kill is weapon-attributed.
 */
export function deriveBuildStats(
  input: BuildStatsInput,
  topN: number = DEFAULT_TOP_WEAPONS,
): BuildStatsSummary {
  const { weaponStats, gameTimeSeconds, killCount, totalDamageTaken } = input;

  let totalDamage = 0;
  let totalHits = 0;
  let totalCrits = 0;
  for (const weapon of weaponStats) {
    totalDamage += Math.max(0, weapon.totalDamage);
    totalHits += Math.max(0, weapon.hits);
    totalCrits += Math.max(0, weapon.crits);
  }

  const topWeapons = orderWeaponsByDamage(weaponStats, topN).map((weapon) => ({
    weaponId: weapon.weaponId,
    weaponName: weapon.weaponName,
    totalDamage: weapon.totalDamage,
    damageShare: safeRatio(weapon.totalDamage, totalDamage),
    dps: perSecondRate(weapon.totalDamage, gameTimeSeconds),
    kills: weapon.kills,
    critRate: safeRatio(weapon.crits, weapon.hits),
  }));

  return {
    totalDamage,
    dps: perSecondRate(totalDamage, gameTimeSeconds),
    critRate: safeRatio(totalCrits, totalHits),
    killsPerMinute: perMinuteRate(killCount, gameTimeSeconds),
    totalKills: killCount,
    totalDamageTaken,
    topWeapons,
  };
}
