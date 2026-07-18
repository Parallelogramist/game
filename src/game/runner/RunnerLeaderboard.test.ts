import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the encrypted storage so record/read round-trips without
// touching crypto/localStorage. Same specifier ('../../storage') as the production
// import, so Vitest swaps the real module for this one. vi.mock is hoisted above
// the imports by Vitest — this is the exact idiom the sibling
// GauntletLeaderboard.test.ts uses (vi imported in the top line).
vi.mock('../../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
});

import { SecureStorage } from '../../storage';
import {
  recordRunnerRun,
  getRunnerRuns,
  clearRunnerRuns,
  rankRunnerEntries,
  MAX_RUNNER_ENTRIES,
  type RunnerRunEntry,
} from './RunnerLeaderboard';

const STORAGE_KEY = 'survivor-runner-leaderboard';

function makeRun(overrides: Partial<RunnerRunEntry> = {}): RunnerRunEntry {
  return {
    timestamp: 1000,
    score: 500,
    distanceMeters: 300,
    kills: 20,
    ...overrides,
  };
}

describe('RunnerLeaderboard', () => {
  beforeEach(() => {
    clearRunnerRuns();
  });

  test('starts empty', () => {
    expect(getRunnerRuns()).toEqual([]);
  });

  test('records a run and reads it back', () => {
    recordRunnerRun(makeRun({ score: 700 }));
    const board = getRunnerRuns();
    expect(board).toHaveLength(1);
    expect(board[0].score).toBe(700);
  });

  test('ranks best-first by highest score', () => {
    recordRunnerRun(makeRun({ timestamp: 1, score: 300 }));
    recordRunnerRun(makeRun({ timestamp: 2, score: 900 }));
    recordRunnerRun(makeRun({ timestamp: 3, score: 600 }));
    expect(getRunnerRuns().map((r) => r.score)).toEqual([900, 600, 300]);
  });

  test('breaks a score tie by distance, then kills', () => {
    recordRunnerRun(makeRun({ timestamp: 1, score: 500, distanceMeters: 200, kills: 50 }));
    recordRunnerRun(makeRun({ timestamp: 2, score: 500, distanceMeters: 300, kills: 10 }));
    recordRunnerRun(makeRun({ timestamp: 3, score: 500, distanceMeters: 200, kills: 90 }));
    // Same score: highest distance first (300), then among the 200m runs the higher kills (90 > 50).
    expect(getRunnerRuns().map((r) => r.kills)).toEqual([10, 90, 50]);
  });

  test(`caps at ${MAX_RUNNER_ENTRIES}, keeping the BEST runs (not the newest)`, () => {
    // Record MAX+5 runs with ascending scores; the lowest 5 scores must be dropped.
    for (let i = 1; i <= MAX_RUNNER_ENTRIES + 5; i++) {
      recordRunnerRun(makeRun({ timestamp: i, score: i }));
    }
    const board = getRunnerRuns();
    expect(board).toHaveLength(MAX_RUNNER_ENTRIES);
    expect(board[0].score).toBe(MAX_RUNNER_ENTRIES + 5); // highest kept
    expect(board[board.length - 1].score).toBe(6);        // scores 1-5 dropped
  });

  test('rankRunnerEntries is pure (does not mutate its input)', () => {
    const input = [makeRun({ score: 200 }), makeRun({ score: 800 })];
    const snapshot = input.map((r) => r.score);
    rankRunnerEntries(input);
    expect(input.map((r) => r.score)).toEqual(snapshot);
  });

  test('recordRunnerRun returns the trimmed ranked list', () => {
    recordRunnerRun(makeRun({ timestamp: 1, score: 400 }));
    const returned = recordRunnerRun(makeRun({ timestamp: 2, score: 800 }));
    expect(returned.map((r) => r.score)).toEqual([800, 400]);
  });

  test('persists across a reload (read-through, no cache masking the store)', () => {
    recordRunnerRun(makeRun({ score: 1200 }));
    expect(getRunnerRuns()[0].score).toBe(1200);
    expect(SecureStorage.getItem(STORAGE_KEY)).toContain('1200');
  });

  test('corrupt stored JSON yields an empty board instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getRunnerRuns()).not.toThrow();
    expect(getRunnerRuns()).toEqual([]);
  });

  test('a non-array payload yields an empty board', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ bogus: true }));
    expect(getRunnerRuns()).toEqual([]);
  });

  test('drops structurally malformed entries (schema drift / partial write)', () => {
    const good = makeRun({ score: 1100 });
    const bad = { score: 'lots', kills: 'many' }; // wrong types
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify([good, bad]));
    const board = getRunnerRuns();
    expect(board).toHaveLength(1);
    expect(board[0].score).toBe(1100);
  });

  test('clearRunnerRuns empties the store', () => {
    recordRunnerRun(makeRun());
    clearRunnerRuns();
    expect(getRunnerRuns()).toEqual([]);
    expect(SecureStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
