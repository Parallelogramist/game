/**
 * The victory overlay's kicker: the one line drawn above VICTORY!. Pure so the expedition
 * variants can be pinned without a scene, because the overlay draws nothing but what this
 * returns.
 */

export interface VictoryConquest {
  /** The world's season index — the same `W<n>` the CHART tile and the banked rows print. */
  seasonIndex: number;
  /** Whole-percent completion of THIS world at the moment the boss died. */
  completionPercent: number;
  /** False when an earlier run had already conquered this world. */
  firstConquest: boolean;
  /** Lifetime worlds conquered, already including this win. */
  worldsConqueredTotal: number;
}

export interface VictoryKickerInput {
  /** Meta world level this win cleared: the arena-era progression number. */
  clearedWorld: number;
  /** Relic unlocked by a first-ever kill of this run's boss, if any. */
  trophyName?: string;
  /** Present only for an expedition run: the world this win conquered. */
  conquest?: VictoryConquest;
  canvasWidth: number;
}

const CLAUSE_SEPARATOR = '  ·  ';

/** A third clause overruns the kicker on a portrait phone, and the line does not wrap. Same
 *  900 px the recent-run strip already uses to decide this overlay has room to spare. */
export const KICKER_THIRD_CLAUSE_MIN_WIDTH = 900;

export function buildVictoryKicker(input: VictoryKickerInput): string {
  const { clearedWorld, trophyName, conquest, canvasWidth } = input;
  const trophyUpper = trophyName ? trophyName.toUpperCase() : null;

  if (!conquest) {
    return trophyUpper
      ? `WORLD ${clearedWorld} CLEARED${CLAUSE_SEPARATOR}TROPHY UNLOCKED: ${trophyUpper}`
      : `WORLD ${clearedWorld} CLEARED${CLAUSE_SEPARATOR}BOSS DEFEATED`;
  }

  const clauses = [
    conquest.firstConquest
      ? `W${conquest.seasonIndex} CONQUERED`
      : `W${conquest.seasonIndex} CONQUERED AGAIN`,
    `${conquest.completionPercent}% CHARTED`,
  ];
  if (canvasWidth >= KICKER_THIRD_CLAUSE_MIN_WIDTH) {
    if (trophyUpper) {
      clauses.push(`TROPHY: ${trophyUpper}`);
    } else if (conquest.firstConquest && conquest.worldsConqueredTotal >= 1) {
      // A lifetime total of 0 on a first conquest means the profile write failed, so the
      // milestone clause would be a lie rather than a number.
      const total = conquest.worldsConqueredTotal;
      clauses.push(`${total} WORLD${total === 1 ? '' : 'S'} DOWN`);
    }
  }
  return clauses.join(CLAUSE_SEPARATOR);
}
