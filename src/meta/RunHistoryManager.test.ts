import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the encrypted storage so record/read round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one.
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    // Expose the raw map so tests can inject corrupt data / inspect persistence.
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import {
  recordRun,
  getRecentRuns,
  getRunHistory,
  clearRunHistory,
  MAX_RUN_HISTORY,
  type RunSummary,
} from './RunHistoryManager';

const STORAGE_KEY = 'survivor-run-history';

function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    timestamp: 1000,
    durationSeconds: 300,
    kills: 100,
    level: 10,
    score: 5000,
    grade: 'B',
    victory: false,
    worldLevel: 1,
    ...overrides,
  };
}

describe('RunHistoryManager', () => {
  beforeEach(() => {
    clearRunHistory();
  });

  test('starts empty', () => {
    expect(getRunHistory()).toEqual([]);
    expect(getRecentRuns()).toEqual([]);
  });

  test('records a run and reads it back', () => {
    recordRun(makeRun({ kills: 42 }));
    const history = getRunHistory();
    expect(history).toHaveLength(1);
    expect(history[0].kills).toBe(42);
  });

  test('orders newest-first', () => {
    recordRun(makeRun({ timestamp: 1, kills: 1 }));
    recordRun(makeRun({ timestamp: 2, kills: 2 }));
    recordRun(makeRun({ timestamp: 3, kills: 3 }));
    expect(getRunHistory().map((run) => run.kills)).toEqual([3, 2, 1]);
  });

  test(`caps history at ${MAX_RUN_HISTORY}, dropping the oldest`, () => {
    for (let i = 0; i < MAX_RUN_HISTORY + 5; i++) {
      recordRun(makeRun({ timestamp: i, kills: i }));
    }
    const history = getRunHistory();
    expect(history).toHaveLength(MAX_RUN_HISTORY);
    // Newest-first: first entry is the last recorded, last entry is the oldest kept.
    expect(history[0].kills).toBe(MAX_RUN_HISTORY + 4);
    expect(history[history.length - 1].kills).toBe(5);
  });

  test('getRecentRuns(limit) returns at most limit, newest-first', () => {
    for (let i = 0; i < 6; i++) recordRun(makeRun({ timestamp: i, kills: i }));
    expect(getRecentRuns(3).map((run) => run.kills)).toEqual([5, 4, 3]);
  });

  test('getRecentRuns clamps a limit larger than the history', () => {
    recordRun(makeRun({ kills: 7 }));
    expect(getRecentRuns(50)).toHaveLength(1);
  });

  test('persists across a reload (no in-memory cache masking the store)', () => {
    recordRun(makeRun({ score: 9999 }));
    // A real reload = fresh module read from storage. The read-through getters
    // hit SecureStorage every call, so a second read reflects the persisted value.
    expect(getRunHistory()[0].score).toBe(9999);
    // And the raw store actually holds it.
    expect(SecureStorage.getItem(STORAGE_KEY)).toContain('9999');
  });

  test('recordRun returns the trimmed newest-first list', () => {
    recordRun(makeRun({ timestamp: 1, kills: 1 }));
    const returned = recordRun(makeRun({ timestamp: 2, kills: 2 }));
    expect(returned.map((run) => run.kills)).toEqual([2, 1]);
  });

  test('corrupt stored JSON yields an empty history instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getRunHistory()).not.toThrow();
    expect(getRunHistory()).toEqual([]);
  });

  test('a non-array payload yields an empty history', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ bogus: true }));
    expect(getRunHistory()).toEqual([]);
  });

  test('drops structurally malformed entries (schema drift / partial write)', () => {
    const good = makeRun({ kills: 11 });
    const bad = { kills: 'lots', victory: 'yes' }; // wrong types
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify([good, bad]));
    const history = getRunHistory();
    expect(history).toHaveLength(1);
    expect(history[0].kills).toBe(11);
  });

  test('clearRunHistory empties the store', () => {
    recordRun(makeRun());
    clearRunHistory();
    expect(getRunHistory()).toEqual([]);
    expect(SecureStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
