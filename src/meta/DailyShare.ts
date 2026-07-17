/**
 * Share text for a finished daily/weekly challenge run.
 *
 * Locale-pinned on purpose: the same run must produce byte-identical text on
 * every device, because players paste these side by side to compare.
 */

export const SHARE_SITE_URL = 'https://game.parallelogramist.com';

const GAME_TITLE = 'Pew Pew Survivor';

export interface DailyShareInput {
  challengeType: 'daily' | 'weekly';
  /** 'YYYY-MM-DD' (daily) or 'YYYY-Www' (weekly) — verbatim from DailyChallengeConfig. */
  dateString: string;
  modifierNames: string[];
  grade: string;
  survivalSeconds: number;
  score: number;
  wasVictory: boolean;
}

function formatSurvivalTime(totalSeconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainderSeconds = wholeSeconds % 60;
  return `${minutes}:${String(remainderSeconds).padStart(2, '0')}`;
}

export function formatDailyShareText(input: DailyShareInput): string {
  const challengeLabel = input.challengeType === 'weekly' ? 'WEEKLY' : 'DAILY';
  const scoreText = Math.max(0, Math.round(input.score)).toLocaleString('en-US');
  const outcomeSuffix = input.wasVictory ? ' · VICTORY' : '';

  const lines = [
    `${GAME_TITLE} — ${challengeLabel} ${input.dateString}`,
    `GRADE ${input.grade} · ${formatSurvivalTime(input.survivalSeconds)} · ${scoreText} pts${outcomeSuffix}`,
  ];
  if (input.modifierNames.length > 0) {
    lines.push(`Mods: ${input.modifierNames.join(' / ')}`);
  }
  lines.push(SHARE_SITE_URL);
  return lines.join('\n');
}
