import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for encrypted storage so leaderboard record/read round-trips
// without touching crypto/localStorage. Same specifier ('../storage/SecureStorage')
// as the production import, so Vitest swaps the real module for this one.
vi.mock('../storage/SecureStorage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
    __store: store,
  };
});

// The challenge generators pull weapon/modifier/ship catalogs purely to make
// deterministic picks. Mock them so the module loads Phaser-free and the picks
// are stable — the property under test (determinism) is independent of the data.
vi.mock('../data/RunModifiers', () => ({
  RUN_MODIFIERS: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }, { id: 'm5' }],
}));
vi.mock('../data/ShipCharacters', () => ({
  SHIP_CHARACTERS: [{ id: 'default' }, { id: 'red' }, { id: 'green' }],
}));
vi.mock('../weapons', () => ({
  getWeaponInfoList: () => [{ id: 'projectile' }, { id: 'katana' }, { id: 'aura' }],
}));

import { SecureStorage } from '../storage/SecureStorage';
import { computeRunScore } from '../utils/PerformanceGrade';
import {
  recordDailyRun,
  getDailyBest,
  getRecentLeaderboardEntries,
  generateDailyChallenge,
  generateWeeklyChallenge,
  type DailyLeaderboardEntry,
} from './DailyChallengeManager';

const STORAGE_KEY = 'dailyLeaderboardV1';
const DATE = '2026-06-05';

type NewRun = Omit<DailyLeaderboardEntry, 'dateString' | 'challengeType' | 'timestamp'>;

function makeRun(overrides: Partial<NewRun> = {}): NewRun {
  return {
    survivalSeconds: 300,
    killCount: 100,
    levelReached: 10,
    wasVictory: false,
    score: 5000,
    ...overrides,
  };
}

describe('DailyChallengeManager — leaderboard scoring', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('records a run and reads back its score', () => {
    recordDailyRun('daily', DATE, makeRun({ score: 7777 }));
    const best = getDailyBest('daily', DATE);
    expect(best).toBeDefined();
    expect(best?.score).toBe(7777);
    expect(best?.killCount).toBe(100);
  });

  test('a higher-score run replaces a lower-score prior even with FEWER kills', () => {
    // Prior: many kills but a low composite score (no victory, short combo).
    recordDailyRun('daily', DATE, makeRun({ killCount: 200, score: 3000 }));
    // New: fewer kills but a clearly better run (victory, high score).
    recordDailyRun('daily', DATE, makeRun({ killCount: 150, score: 9000, wasVictory: true }));

    const best = getDailyBest('daily', DATE);
    expect(best?.score).toBe(9000);
    expect(best?.killCount).toBe(150);
    expect(best?.wasVictory).toBe(true);
  });

  test('a lower-score run does NOT replace a higher-score prior', () => {
    recordDailyRun('daily', DATE, makeRun({ score: 9000, killCount: 50 }));
    recordDailyRun('daily', DATE, makeRun({ score: 4000, killCount: 999 }));
    const best = getDailyBest('daily', DATE);
    expect(best?.score).toBe(9000);
    expect(best?.killCount).toBe(50);
  });

  test('ties on score break by kills', () => {
    recordDailyRun('daily', DATE, makeRun({ score: 5000, killCount: 100 }));
    recordDailyRun('daily', DATE, makeRun({ score: 5000, killCount: 140 }));
    expect(getDailyBest('daily', DATE)?.killCount).toBe(140);
    // A score tie with fewer kills must not overwrite.
    recordDailyRun('daily', DATE, makeRun({ score: 5000, killCount: 90 }));
    expect(getDailyBest('daily', DATE)?.killCount).toBe(140);
  });

  test('daily and weekly leaderboards are keyed separately', () => {
    recordDailyRun('daily', DATE, makeRun({ score: 1000 }));
    recordDailyRun('weekly', '2026-W23', makeRun({ score: 2000 }));
    expect(getDailyBest('daily', DATE)?.score).toBe(1000);
    expect(getDailyBest('weekly', '2026-W23')?.score).toBe(2000);
    // A different daily date has no entry.
    expect(getDailyBest('daily', '2020-01-01')).toBeUndefined();
  });
});

describe('DailyChallengeManager — legacy entry normalization', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('a legacy entry without score is given a derived composite score on read', () => {
    // Simulate a pre-FEAT-DAILY-SCORE stored entry (no `score` field).
    const legacy = {
      dateString: DATE,
      challengeType: 'daily' as const,
      survivalSeconds: 240,
      killCount: 80,
      levelReached: 12,
      wasVictory: true,
      timestamp: 111,
    };
    SecureStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, entries: { [`daily:${DATE}`]: legacy } }),
    );

    const expectedScore = computeRunScore({
      killCount: 80,
      survivalSeconds: 240,
      level: 12,
      damageDealt: 0,
      highestCombo: 0,
      wasVictory: true,
    });
    const best = getDailyBest('daily', DATE);
    expect(best?.score).toBe(expectedScore);
  });

  test('a new scored run is compared fairly against a normalized legacy entry', () => {
    const legacy = {
      dateString: DATE,
      challengeType: 'daily' as const,
      survivalSeconds: 600,
      killCount: 300,
      levelReached: 20,
      wasVictory: true,
      timestamp: 111,
    };
    SecureStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, entries: { [`daily:${DATE}`]: legacy } }),
    );
    const legacyScore = computeRunScore({
      killCount: 300,
      survivalSeconds: 600,
      level: 20,
      damageDealt: 0,
      highestCombo: 0,
      wasVictory: true,
    });

    // A weaker new run must NOT beat the strong legacy entry.
    recordDailyRun('daily', DATE, makeRun({ score: legacyScore - 1, killCount: 1 }));
    expect(getDailyBest('daily', DATE)?.killCount).toBe(300);

    // A stronger new run MUST beat it.
    recordDailyRun('daily', DATE, makeRun({ score: legacyScore + 1, killCount: 2 }));
    expect(getDailyBest('daily', DATE)?.killCount).toBe(2);
  });
});

describe('DailyChallengeManager — robustness & recents', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('corrupt stored JSON yields no best (no throw) and recording still works', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getDailyBest('daily', DATE)).not.toThrow();
    expect(getDailyBest('daily', DATE)).toBeUndefined();
    recordDailyRun('daily', DATE, makeRun({ score: 1234 }));
    expect(getDailyBest('daily', DATE)?.score).toBe(1234);
  });

  test('getRecentLeaderboardEntries returns entries newest-first by timestamp', () => {
    recordDailyRun('daily', '2026-06-01', makeRun({ score: 100 }));
    recordDailyRun('daily', '2026-06-02', makeRun({ score: 200 }));
    recordDailyRun('daily', '2026-06-03', makeRun({ score: 300 }));
    const recents = getRecentLeaderboardEntries(10);
    expect(recents.length).toBe(3);
    // Newest-first: timestamps are monotonic across the three sequential records.
    expect(recents[0].timestamp).toBeGreaterThanOrEqual(recents[1].timestamp);
    expect(recents[1].timestamp).toBeGreaterThanOrEqual(recents[2].timestamp);
  });
});

describe('DailyChallengeManager — deterministic generation', () => {
  test('generateDailyChallenge is deterministic across calls', () => {
    const a = generateDailyChallenge();
    const b = generateDailyChallenge();
    expect(a).toEqual(b);
    expect(a.challengeType).toBe('daily');
    expect(a.modifierIds).toHaveLength(3);
    expect(a.modifierIds).toEqual([...new Set(a.modifierIds)]); // no duplicates
  });

  test('generateWeeklyChallenge picks 4 modifiers and is deterministic', () => {
    const a = generateWeeklyChallenge();
    const b = generateWeeklyChallenge();
    expect(a).toEqual(b);
    expect(a.challengeType).toBe('weekly');
    expect(a.modifierIds).toHaveLength(4);
  });
});
