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
import { getBestScore, recordScore } from './BestScoreManager';

const STORAGE_KEY = 'survivor-best-scores';

describe('BestScoreManager', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  // ── Corruption / tamper resilience (the bug this fixes) ──
  // Ordered first so they run against a clean module state for an unambiguous
  // demonstration that the un-hardened load() crashes on a non-object payload.

  test('a "null" payload reads as 0 instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, 'null');
    expect(() => getBestScore(1)).not.toThrow();
    expect(getBestScore(1)).toBe(0);
  });

  test('recording over a "null" payload does not throw and stores the score', () => {
    SecureStorage.setItem(STORAGE_KEY, 'null');
    expect(() => recordScore(1, 5000)).not.toThrow();
    expect(getBestScore(1)).toBe(5000);
  });

  test('corrupt (non-JSON) storage yields 0 instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getBestScore(1)).not.toThrow();
    expect(getBestScore(1)).toBe(0);
  });

  test('a non-object payload (array) yields 0 and does not corrupt writes', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(getBestScore(1)).toBe(0);
    expect(() => recordScore(1, 5000)).not.toThrow();
    expect(getBestScore(1)).toBe(5000);
  });

  test('a primitive payload (number) yields 0 and records cleanly afterward', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(9999));
    expect(getBestScore(1)).toBe(0);
    expect(() => recordScore(1, 100)).not.toThrow();
    expect(getBestScore(1)).toBe(100);
  });

  test('drops non-numeric / negative / non-finite entries (schema drift / tamper)', () => {
    SecureStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ '1': 'lots', '2': -5, '3': 7000, '4': null }),
    );
    expect(getBestScore(1)).toBe(0); // string dropped
    expect(getBestScore(2)).toBe(0); // negative dropped
    expect(getBestScore(3)).toBe(7000); // valid value kept
    expect(getBestScore(4)).toBe(0); // null dropped
  });

  test('a NaN score is sanitized — never stored or echoed as NaN', () => {
    const result = recordScore(1, NaN);
    expect(Number.isNaN(result.best)).toBe(false);
    expect(result.best).toBe(0);
    expect(getBestScore(1)).toBe(0);
  });

  test('an Infinity score is sanitized to a finite value', () => {
    const result = recordScore(1, Infinity);
    expect(Number.isFinite(result.best)).toBe(true);
    expect(getBestScore(1)).toBe(0);
  });

  // ── Core behaviour ──

  test('returns 0 when no score has been recorded', () => {
    expect(getBestScore(1)).toBe(0);
  });

  test('records a score and reads it back as the best', () => {
    recordScore(1, 5000);
    expect(getBestScore(1)).toBe(5000);
  });

  test('only overwrites when the new score is strictly higher', () => {
    recordScore(1, 5000);

    const lower = recordScore(1, 3000);
    expect(lower.isNewBest).toBe(false);
    expect(lower.best).toBe(5000);
    expect(getBestScore(1)).toBe(5000);

    const higher = recordScore(1, 7000);
    expect(higher.isNewBest).toBe(true);
    expect(higher.best).toBe(7000);
    expect(getBestScore(1)).toBe(7000);
  });

  test('an equal score is not a new best', () => {
    recordScore(1, 5000);
    expect(recordScore(1, 5000).isNewBest).toBe(false);
  });

  test('the first recorded score is always a new best', () => {
    const result = recordScore(3, 1234);
    expect(result.isNewBest).toBe(true);
    expect(result.score).toBe(1234);
    expect(result.best).toBe(1234);
  });

  test('tracks best scores per world level independently', () => {
    recordScore(1, 5000);
    recordScore(2, 8000);
    expect(getBestScore(1)).toBe(5000);
    expect(getBestScore(2)).toBe(8000);
    // Recording a new WL1 best must not disturb the WL2 record.
    recordScore(1, 6000);
    expect(getBestScore(2)).toBe(8000);
  });

  test('persists to the underlying store (survives a fresh read)', () => {
    recordScore(1, 4242);
    expect(SecureStorage.getItem(STORAGE_KEY)).toContain('4242');
    expect(getBestScore(1)).toBe(4242);
  });
});
