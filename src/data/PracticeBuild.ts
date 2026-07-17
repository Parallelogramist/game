/**
 * PRACTICE build rungs. Practice hands out a max-level weapon but never spends a
 * level-up, so without this the player fights bosses on a level-0-passives
 * chassis and every absolute time-to-kill reading is wrong.
 *
 * A rung is a flat level applied to every stat upgrade. Flat is the only shape a
 * real run can reach: BREAK_LEVEL_GATES bars a stat from passing 3/6/9 unless
 * every owned stat is already there (see canLevelUpgrade), so an even spread is
 * gate-legal by construction and a lopsided one is unreachable.
 */
export interface PracticeBuildRung {
  /** Level applied to every stat upgrade. */
  depth: number;
  label: string;
}

/** Rungs the BUILD button steps through, weakest first. Depths sit on the break gates. */
export const PRACTICE_BUILD_LADDER: readonly PracticeBuildRung[] = [
  { depth: 0, label: 'OFF' },
  { depth: 3, label: '10-MIN' },
  { depth: 6, label: 'DEEP' },
  { depth: 10, label: 'MAX' },
];

/**
 * Player level a rung corresponds to: each stat level costs one level-up pick and
 * a run starts at level 1. Drives the XP curve, so a boss kill grants ~1 level
 * instead of the dozens a level-1 threshold (10 XP) would cascade.
 */
export function practiceBuildPlayerLevel(depth: number, statUpgradeCount: number): number {
  return 1 + depth * statUpgradeCount;
}
