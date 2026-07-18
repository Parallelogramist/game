import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the encrypted storage so record/read round-trips without
// touching crypto/localStorage. Same specifier ('../../storage') as the production
// import, so Vitest swaps the real module for this one. vi.mock is hoisted above the
// imports by Vitest — this is the exact idiom the sibling GauntletLeaderboard.test.ts
// uses (vi imported in the top line).
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
  recordEndlessRun,
  getEndlessRuns,
  clearEndlessRuns,
  rankEndlessEntries,
  MAX_ENDLESS_ENTRIES,
  type EndlessRunEntry,
} from './EndlessLeaderboard';

const STORAGE_KEY = 'survivor-endless-leaderboard';

function makeRun(overrides: Partial<EndlessRunEntry> = {}): EndlessRunEntry {
  return {
    timestamp: 1000,
    cycle: 5,
    kills: 100,
    durationSeconds: 200,
    levelReached: 10,
    worldLevel: 1,
    ...overrides,
  };
}

describe('EndlessLeaderboard', () => {
  beforeEach(() => {
    clearEndlessRuns();
  });

  test('starts empty', () => {
    expect(getEndlessRuns()).toEqual([]);
  });

  test('records a run and reads it back', () => {
    recordEndlessRun(makeRun({ cycle: 7 }));
    const board = getEndlessRuns();
    expect(board).toHaveLength(1);
    expect(board[0].cycle).toBe(7);
  });

  test('ranks best-first by deepest cycle', () => {
    recordEndlessRun(makeRun({ timestamp: 1, cycle: 3 }));
    recordEndlessRun(makeRun({ timestamp: 2, cycle: 9 }));
    recordEndlessRun(makeRun({ timestamp: 3, cycle: 6 }));
    expect(getEndlessRuns().map((r) => r.cycle)).toEqual([9, 6, 3]);
  });

  test('breaks a cycle tie by kills, then survival', () => {
    recordEndlessRun(makeRun({ timestamp: 1, cycle: 5, kills: 50, durationSeconds: 300 }));
    recordEndlessRun(makeRun({ timestamp: 2, cycle: 5, kills: 80, durationSeconds: 100 }));
    recordEndlessRun(makeRun({ timestamp: 3, cycle: 5, kills: 50, durationSeconds: 400 }));
    // Same cycle: highest kills first (80), then among the 50-kill runs the longer survival (400 > 300).
    expect(getEndlessRuns().map((r) => r.durationSeconds)).toEqual([100, 400, 300]);
  });

  test(`caps at ${MAX_ENDLESS_ENTRIES}, keeping the BEST runs (not the newest)`, () => {
    // Record MAX+5 runs with ascending cycles; the lowest 5 cycles must be dropped.
    for (let i = 1; i <= MAX_ENDLESS_ENTRIES + 5; i++) {
      recordEndlessRun(makeRun({ timestamp: i, cycle: i }));
    }
    const board = getEndlessRuns();
    expect(board).toHaveLength(MAX_ENDLESS_ENTRIES);
    expect(board[0].cycle).toBe(MAX_ENDLESS_ENTRIES + 5); // deepest kept
    expect(board[board.length - 1].cycle).toBe(6);        // cycles 1-5 dropped
  });

  test('rankEndlessEntries is pure (does not mutate its input)', () => {
    const input = [makeRun({ cycle: 2 }), makeRun({ cycle: 8 })];
    const snapshot = input.map((r) => r.cycle);
    rankEndlessEntries(input);
    expect(input.map((r) => r.cycle)).toEqual(snapshot);
  });

  test('recordEndlessRun returns the trimmed ranked list', () => {
    recordEndlessRun(makeRun({ timestamp: 1, cycle: 4 }));
    const returned = recordEndlessRun(makeRun({ timestamp: 2, cycle: 8 }));
    expect(returned.map((r) => r.cycle)).toEqual([8, 4]);
  });

  test('persists across a reload (read-through, no cache masking the store)', () => {
    recordEndlessRun(makeRun({ cycle: 12 }));
    expect(getEndlessRuns()[0].cycle).toBe(12);
    expect(SecureStorage.getItem(STORAGE_KEY)).toContain('12');
  });

  test('corrupt stored JSON yields an empty board instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getEndlessRuns()).not.toThrow();
    expect(getEndlessRuns()).toEqual([]);
  });

  test('a non-array payload yields an empty board', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ bogus: true }));
    expect(getEndlessRuns()).toEqual([]);
  });

  test('drops structurally malformed entries (schema drift / partial write)', () => {
    const good = makeRun({ cycle: 11 });
    const bad = { cycle: 'lots', kills: 'many' }; // wrong types
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify([good, bad]));
    const board = getEndlessRuns();
    expect(board).toHaveLength(1);
    expect(board[0].cycle).toBe(11);
  });

  test('clearEndlessRuns empties the store', () => {
    recordEndlessRun(makeRun());
    clearEndlessRuns();
    expect(getEndlessRuns()).toEqual([]);
    expect(SecureStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
