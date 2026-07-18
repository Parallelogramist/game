import { describe, test, expect, beforeEach, vi } from 'vitest';

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
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import { getShipRecord, recordShipRun } from './ShipRecords';

const STORAGE_KEY = 'survivor-ship-records';

describe('ShipRecords', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  // ── Corruption / tamper resilience (the real regression risk this store guards) ──

  test('a "null" payload reads as zeros instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, 'null');
    expect(() => getShipRecord('ship_default')).not.toThrow();
    expect(getShipRecord('ship_default')).toEqual({ runs: 0, victories: 0, bestScore: 0 });
  });

  test('corrupt (non-JSON) storage yields zeros instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getShipRecord('ship_default')).not.toThrow();
    expect(getShipRecord('ship_default')).toEqual({ runs: 0, victories: 0, bestScore: 0 });
  });

  test('a non-object payload (array) yields zeros and does not corrupt writes', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(getShipRecord('ship_default').runs).toBe(0);
    expect(() => recordShipRun('ship_default', true, 5000)).not.toThrow();
    expect(getShipRecord('ship_default')).toEqual({ runs: 1, victories: 1, bestScore: 5000 });
  });

  test('drops malformed / negative / non-finite fields (schema drift / tamper)', () => {
    SecureStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ship_a: { runs: 'lots', victories: -5, bestScore: 7000 },
        ship_b: 'garbage',
        ship_c: { runs: 3, victories: 2, bestScore: Infinity },
      }),
    );
    expect(getShipRecord('ship_a')).toEqual({ runs: 0, victories: 0, bestScore: 7000 });
    expect(getShipRecord('ship_b')).toEqual({ runs: 0, victories: 0, bestScore: 0 });
    expect(getShipRecord('ship_c')).toEqual({ runs: 3, victories: 2, bestScore: 0 });
  });

  test('a NaN / Infinity score is sanitized — never stored as NaN', () => {
    recordShipRun('ship_default', false, NaN);
    expect(getShipRecord('ship_default').bestScore).toBe(0);
    recordShipRun('ship_default', false, Infinity);
    expect(getShipRecord('ship_default').bestScore).toBe(0);
  });

  // ── Core behaviour ──

  test('returns zeros when no run has been recorded', () => {
    expect(getShipRecord('ship_default')).toEqual({ runs: 0, victories: 0, bestScore: 0 });
  });

  test('a blank ship id is a no-op', () => {
    recordShipRun('', true, 5000);
    expect(SecureStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('accumulates runs and victories and keeps the best score', () => {
    recordShipRun('ship_default', false, 3000);
    recordShipRun('ship_default', true, 8000);
    recordShipRun('ship_default', false, 5000); // lower score does not lower the best
    expect(getShipRecord('ship_default')).toEqual({ runs: 3, victories: 1, bestScore: 8000 });
  });

  test('tracks ships independently', () => {
    recordShipRun('ship_default', true, 5000);
    recordShipRun('ship_interceptor', false, 9000);
    expect(getShipRecord('ship_default')).toEqual({ runs: 1, victories: 1, bestScore: 5000 });
    expect(getShipRecord('ship_interceptor')).toEqual({ runs: 1, victories: 0, bestScore: 9000 });
  });

  test('persists to the underlying store (survives a fresh read)', () => {
    recordShipRun('ship_default', true, 4242);
    expect(SecureStorage.getItem(STORAGE_KEY)).toContain('4242');
    expect(getShipRecord('ship_default').bestScore).toBe(4242);
  });
});
