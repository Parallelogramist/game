import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';

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
import { isPracticeSession, setPracticeSession } from '../utils/practiceSession';
import { EnemyAffixType } from '../data/Affixes';
import {
  formatFightTime,
  getPracticeBest,
  practiceBestKey,
  savePracticeBestIfFaster,
} from './PracticeBestTimes';

const STORAGE_KEY = 'survivor-practice-bests';

const KEY = practiceBestKey('boss_obelisk', EnemyAffixType.NONE, EnemyAffixType.NONE, 5);

function entry(ms: number) {
  return { ms, shipId: 'ship_default', weaponId: 'katana', weaponLevel: 5, evolved: false };
}

describe('PracticeBestTimes', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
    setPracticeSession(false);
  });

  afterEach(() => {
    setPracticeSession(false);
  });

  test('an unrecorded fight reads as null', () => {
    expect(getPracticeBest(KEY)).toBeNull();
  });

  test('the first clear is stored and round-trips', () => {
    expect(savePracticeBestIfFaster(KEY, entry(9800))).toBe(true);
    expect(getPracticeBest(KEY)).toEqual(entry(9800));
  });

  test('a slower clear is rejected and leaves the record intact', () => {
    savePracticeBestIfFaster(KEY, entry(9800));
    expect(savePracticeBestIfFaster(KEY, entry(12000))).toBe(false);
    expect(getPracticeBest(KEY)?.ms).toBe(9800);
  });

  test('a faster clear replaces the record', () => {
    savePracticeBestIfFaster(KEY, entry(9800));
    expect(savePracticeBestIfFaster(KEY, entry(7400))).toBe(true);
    expect(getPracticeBest(KEY)?.ms).toBe(7400);
  });

  test('corrupt storage reads as no record instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getPracticeBest(KEY)).not.toThrow();
    expect(getPracticeBest(KEY)).toBeNull();
  });

  test('a write lands during an active practice session and restores the block', () => {
    setPracticeSession(true);
    expect(savePracticeBestIfFaster(KEY, entry(8800))).toBe(true);
    expect(getPracticeBest(KEY)?.ms).toBe(8800);
    expect(isPracticeSession()).toBe(true);
  });

  test('the key separates affixes and build depths', () => {
    const base = practiceBestKey('boss_obelisk', EnemyAffixType.NONE, EnemyAffixType.NONE, 5);
    expect(practiceBestKey('boss_obelisk', EnemyAffixType.SWIFT, EnemyAffixType.NONE, 5)).not.toBe(base);
    expect(practiceBestKey('boss_obelisk', EnemyAffixType.NONE, EnemyAffixType.NONE, 8)).not.toBe(base);
  });

  test('formatFightTime renders M:SS.d', () => {
    expect(formatFightTime(0)).toBe('0:00.0');
    expect(formatFightTime(9840)).toBe('0:09.8');
    expect(formatFightTime(65000)).toBe('1:05.0');
  });
});
