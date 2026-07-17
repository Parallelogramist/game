import type { Upgrade } from './Upgrades';

/**
 * Memory (`upgradeKeepLevel`) — carry the lowest upgrades of your last run into
 * the next one. The shop card promises "Keep {level} lowest upgrades": deliberately
 * the *lowest*, so a 500-gold purchase is a head start and not a snowball.
 *
 * Pure by construction (the only import is a type, erased at compile time) so the
 * selection rules are testable without a Phaser scene, matching Blessings.ts.
 */
export interface RecordedUpgrade {
  readonly id: string;
  readonly level: number;
}

/** Upper bound on banked entries — 10 are keepable today; the slack is headroom. */
export const MAX_RECORDED_UPGRADES = 16;

/** Upper bound on a banked level. Every keepable (non-overflow) upgrade caps at 10. */
export const MAX_RECORDED_UPGRADE_LEVEL = 10;

/**
 * The build a finished run is banked with: everything owned except the Limit Break
 * overflow pool.
 *
 * Overflow is excluded because Memory keeps the *lowest* upgrades and overflow
 * entries are repeatable scraps only offered once the normal pool is exhausted — a
 * late-game player (the only kind who can afford Memory) carries them at level 1-3
 * beside a maxed real build, so banking them would make the carryover overflow
 * crumbs every single time. `isStatUpgrade` is NOT the filter to use here: it means
 * "subject to break-level gates" and is false for shieldBarrier, which is keepable.
 */
export function recordRunBuild(upgrades: Upgrade[]): RecordedUpgrade[] {
  return upgrades
    .filter((upgrade) => !upgrade.isOverflow && upgrade.currentLevel > 0)
    .slice(0, MAX_RECORDED_UPGRADES)
    .map((upgrade) => ({ id: upgrade.id, level: upgrade.currentLevel }));
}

/**
 * The `keepCount` lowest-level entries of a banked build.
 *
 * The count guard is load-bearing: a profile that never bought Memory asks for 0 and
 * must get nothing. Ties resolve by banked order (Array.prototype.sort is stable),
 * which is createUpgrades() declaration order — deterministic, never RNG.
 */
export function selectKeptUpgrades(
  recorded: RecordedUpgrade[],
  keepCount: number,
): RecordedUpgrade[] {
  if (keepCount <= 0) return [];
  return [...recorded]
    .sort((first, second) => first.level - second.level)
    .slice(0, keepCount);
}
