import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the encrypted storage so record/read round-trips without
// touching crypto/localStorage. Same specifier ('../../storage') as the production
// import, so Vitest swaps the real module for this one. vi.mock is hoisted above
// the imports by Vitest — this is the exact idiom the sibling
// RunHistoryManager.test.ts uses (vi imported in the top line).
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
  recordGauntletRun,
  getGauntletRuns,
  clearGauntletRuns,
  rankGauntletEntries,
  MAX_GAUNTLET_ENTRIES,
  type GauntletRunEntry,
} from './GauntletLeaderboard';

const STORAGE_KEY = 'survivor-gauntlet-leaderboard';

function makeRun(overrides: Partial<GauntletRunEntry> = {}): GauntletRunEntry {
  return {
    timestamp: 1000,
    wave: 5,
    kills: 100,
    durationSeconds: 200,
    levelReached: 10,
    worldLevel: 1,
    ...overrides,
  };
}

describe('GauntletLeaderboard', () => {
  beforeEach(() => {
    clearGauntletRuns();
  });

  test('starts empty', () => {
    expect(getGauntletRuns()).toEqual([]);
  });

  test('records a run and reads it back', () => {
    recordGauntletRun(makeRun({ wave: 7 }));
    const board = getGauntletRuns();
    expect(board).toHaveLength(1);
    expect(board[0].wave).toBe(7);
  });

  test('ranks best-first by deepest wave', () => {
    recordGauntletRun(makeRun({ timestamp: 1, wave: 3 }));
    recordGauntletRun(makeRun({ timestamp: 2, wave: 9 }));
    recordGauntletRun(makeRun({ timestamp: 3, wave: 6 }));
    expect(getGauntletRuns().map((r) => r.wave)).toEqual([9, 6, 3]);
  });

  test('breaks a wave tie by kills, then survival', () => {
    recordGauntletRun(makeRun({ timestamp: 1, wave: 5, kills: 50, durationSeconds: 300 }));
    recordGauntletRun(makeRun({ timestamp: 2, wave: 5, kills: 80, durationSeconds: 100 }));
    recordGauntletRun(makeRun({ timestamp: 3, wave: 5, kills: 50, durationSeconds: 400 }));
    // Same wave: highest kills first (80), then among the 50-kill runs the longer survival (400 > 300).
    expect(getGauntletRuns().map((r) => r.durationSeconds)).toEqual([100, 400, 300]);
  });

  test(`caps at ${MAX_GAUNTLET_ENTRIES}, keeping the BEST runs (not the newest)`, () => {
    // Record MAX+5 runs with ascending waves; the lowest 5 waves must be dropped.
    for (let i = 1; i <= MAX_GAUNTLET_ENTRIES + 5; i++) {
      recordGauntletRun(makeRun({ timestamp: i, wave: i }));
    }
    const board = getGauntletRuns();
    expect(board).toHaveLength(MAX_GAUNTLET_ENTRIES);
    expect(board[0].wave).toBe(MAX_GAUNTLET_ENTRIES + 5); // deepest kept
    expect(board[board.length - 1].wave).toBe(6);         // waves 1-5 dropped
  });

  test('rankGauntletEntries is pure (does not mutate its input)', () => {
    const input = [makeRun({ wave: 2 }), makeRun({ wave: 8 })];
    const snapshot = input.map((r) => r.wave);
    rankGauntletEntries(input);
    expect(input.map((r) => r.wave)).toEqual(snapshot);
  });

  test('recordGauntletRun returns the trimmed ranked list', () => {
    recordGauntletRun(makeRun({ timestamp: 1, wave: 4 }));
    const returned = recordGauntletRun(makeRun({ timestamp: 2, wave: 8 }));
    expect(returned.map((r) => r.wave)).toEqual([8, 4]);
  });

  test('persists across a reload (read-through, no cache masking the store)', () => {
    recordGauntletRun(makeRun({ wave: 12 }));
    expect(getGauntletRuns()[0].wave).toBe(12);
    expect(SecureStorage.getItem(STORAGE_KEY)).toContain('12');
  });

  test('corrupt stored JSON yields an empty board instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getGauntletRuns()).not.toThrow();
    expect(getGauntletRuns()).toEqual([]);
  });

  test('a non-array payload yields an empty board', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ bogus: true }));
    expect(getGauntletRuns()).toEqual([]);
  });

  test('drops structurally malformed entries (schema drift / partial write)', () => {
    const good = makeRun({ wave: 11 });
    const bad = { wave: 'lots', kills: 'many' }; // wrong types
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify([good, bad]));
    const board = getGauntletRuns();
    expect(board).toHaveLength(1);
    expect(board[0].wave).toBe(11);
  });

  test('clearGauntletRuns empties the store', () => {
    recordGauntletRun(makeRun());
    clearGauntletRuns();
    expect(getGauntletRuns()).toEqual([]);
    expect(SecureStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
