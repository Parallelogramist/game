/**
 * Performance grade for the post-run results screen.
 *
 * Converts a run's score into an S–F letter grade. The baseline scales with
 * world level so an "A" run at world level 1 and at world level 5 represent
 * comparable mastery rather than just raw numbers. A victory bumps the grade up
 * one tier. Thresholds are tuned conservatively and easy to adjust.
 */

export interface GradeResult {
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  color: string;
}

const GRADE_ORDER: GradeResult['grade'][] = ['F', 'D', 'C', 'B', 'A', 'S'];
const GRADE_COLORS: Record<GradeResult['grade'], string> = {
  S: '#ffd24a',
  A: '#66ff99',
  B: '#66ccff',
  C: '#bbbbdd',
  D: '#cc9966',
  F: '#ff6666',
};

/**
 * Composite run score. Shared by PerformanceGrade and BestScoreManager so the
 * grade and the persisted best are derived from the same number.
 */
export function computeRunScore(params: {
  killCount: number;
  survivalSeconds: number;
  level: number;
  damageDealt: number;
  highestCombo: number;
  wasVictory: boolean;
}): number {
  return Math.round(
    params.killCount * 10 +
    params.survivalSeconds * 3 +
    params.level * 50 +
    params.damageDealt / 100 +
    params.highestCombo * 5 +
    (params.wasVictory ? 5000 : 0),
  );
}

/** Maps a run score to a letter grade, baseline-scaled by world level. */
export function computePerformanceGrade(score: number, worldLevel: number, wasVictory: boolean): GradeResult {
  const baseline = 4000 * Math.max(1, worldLevel);
  const ratio = score / baseline;

  let index: number;
  if (ratio >= 2.5) index = 5;       // S
  else if (ratio >= 1.6) index = 4;  // A
  else if (ratio >= 1.0) index = 3;  // B
  else if (ratio >= 0.6) index = 2;  // C
  else if (ratio >= 0.3) index = 1;  // D
  else index = 0;                    // F

  // Reaching a win is itself an achievement — bump one tier.
  if (wasVictory) index = Math.min(GRADE_ORDER.length - 1, index + 1);

  const grade = GRADE_ORDER[index];
  return { grade, color: GRADE_COLORS[grade] };
}

/** The S–F color for a grade letter, for surfaces that store only the letter (e.g. run history). */
export function getGradeColor(grade: string): string {
  return GRADE_COLORS[grade as GradeResult['grade']] ?? '#ffffff';
}
