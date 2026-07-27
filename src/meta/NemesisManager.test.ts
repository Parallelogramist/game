import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so writes round-trip without
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
  };
});

import { SecureStorage } from '../storage';
import {
  NEMESIS_MAX_GRUDGE, clearNemesis, getNemesis, isNemesisEligible,
  nemesisLabel, nemesisScaling, recordNemesisKill,
} from './NemesisManager';

const STORAGE_KEY = 'survivor-nemesis';

describe('NemesisManager', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('a boss, a spawned-only minion and an unknown id can never be a nemesis', () => {
    expect(isNemesisEligible('horde_king')).toBe(false);
    expect(isNemesisEligible('splitter_mini')).toBe(false);
    expect(isNemesisEligible('twin_a')).toBe(false);
    expect(isNemesisEligible('not_a_real_enemy')).toBe(false);
    expect(isNemesisEligible(null)).toBe(false);
  });

  test('an ordinary killer is recorded at grudge 1', () => {
    expect(recordNemesisKill('tank')).toEqual({ typeId: 'tank', grudge: 1 });
    expect(getNemesis()).toEqual({ typeId: 'tank', grudge: 1 });
  });

  test('the same killer escalates the grudge, a different one resets it', () => {
    recordNemesisKill('tank');
    expect(recordNemesisKill('tank')?.grudge).toBe(2);
    expect(recordNemesisKill('exploder')).toEqual({ typeId: 'exploder', grudge: 1 });
  });

  test('the grudge stops at the cap', () => {
    for (let i = 0; i < NEMESIS_MAX_GRUDGE + 3; i++) recordNemesisKill('tank');
    expect(getNemesis()?.grudge).toBe(NEMESIS_MAX_GRUDGE);
  });

  test('an ineligible killer leaves the standing record untouched', () => {
    recordNemesisKill('tank');
    expect(recordNemesisKill('horde_king')).toEqual({ typeId: 'tank', grudge: 1 });
    expect(recordNemesisKill(null)).toEqual({ typeId: 'tank', grudge: 1 });
    expect(getNemesis()).toEqual({ typeId: 'tank', grudge: 1 });
  });

  test('killing the nemesis drops the grudge entirely', () => {
    recordNemesisKill('tank');
    clearNemesis();
    expect(getNemesis()).toBeNull();
  });

  test('a corrupt, tampered or retired-type payload reads as no nemesis', () => {
    SecureStorage.setItem(STORAGE_KEY, 'not json');
    expect(getNemesis()).toBeNull();
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ typeId: 'tank', grudge: 0 }));
    expect(getNemesis()).toBeNull();
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ typeId: 'horde_king', grudge: 2 }));
    expect(getNemesis()).toBeNull();
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ typeId: 'tank', grudge: 99 }));
    expect(getNemesis()?.grudge).toBe(NEMESIS_MAX_GRUDGE);
  });

  test('scaling clamps to the grudge cap and never scales speed by tier', () => {
    expect(nemesisScaling(99)).toEqual(nemesisScaling(NEMESIS_MAX_GRUDGE));
    expect(nemesisScaling(1).speed).toBe(nemesisScaling(NEMESIS_MAX_GRUDGE).speed);
    expect(nemesisScaling(2).health).toBeGreaterThan(nemesisScaling(1).health);
  });

  test('the label numbers repeat offenders only', () => {
    expect(nemesisLabel('Tank', 1)).toBe('NEMESIS · Tank');
    expect(nemesisLabel('Tank', 3)).toBe('NEMESIS · Tank III');
  });
});
