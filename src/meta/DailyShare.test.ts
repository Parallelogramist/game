import { describe, test, expect } from 'vitest';
import { formatDailyShareText, SHARE_SITE_URL } from './DailyShare';

const baseInput = {
  challengeType: 'daily' as const,
  dateString: '2026-07-16',
  modifierNames: ['Glass Cannon', 'Iron Hide', 'Swarm'],
  grade: 'A',
  survivalSeconds: 754,
  score: 4210,
  wasVictory: false,
};

describe('formatDailyShareText', () => {
  test('a daily loss renders every field on the agreed lines', () => {
    expect(formatDailyShareText(baseInput)).toBe(
      [
        'Pew Pew Survivor — DAILY 2026-07-16',
        'GRADE A · 12:34 · 4,210 pts',
        'Mods: Glass Cannon / Iron Hide / Swarm',
        SHARE_SITE_URL,
      ].join('\n'),
    );
  });

  test('a weekly victory swaps the label and marks the win', () => {
    const text = formatDailyShareText({
      ...baseInput,
      challengeType: 'weekly',
      dateString: '2026-W29',
      grade: 'S',
      wasVictory: true,
    });
    expect(text).toContain('Pew Pew Survivor — WEEKLY 2026-W29');
    expect(text).toContain('GRADE S · 12:34 · 4,210 pts · VICTORY');
  });

  test('the score is grouped en-US regardless of the host locale', () => {
    expect(formatDailyShareText({ ...baseInput, score: 1234567 })).toContain('1,234,567 pts');
  });

  test('an empty modifier list drops the Mods line rather than leaving it bare', () => {
    const text = formatDailyShareText({ ...baseInput, modifierNames: [] });
    expect(text).not.toContain('Mods:');
    expect(text.split('\n')).toHaveLength(3);
  });

  test('survival time pads seconds and carries past an hour', () => {
    expect(formatDailyShareText({ ...baseInput, survivalSeconds: 62 })).toContain('· 1:02 ·');
    expect(formatDailyShareText({ ...baseInput, survivalSeconds: 0 })).toContain('· 0:00 ·');
    expect(formatDailyShareText({ ...baseInput, survivalSeconds: 3661 })).toContain('· 61:01 ·');
  });
});
