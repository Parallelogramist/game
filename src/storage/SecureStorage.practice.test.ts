import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const setCache = vi.fn();
const removeFromCache = vi.fn();
const getCached = vi.fn().mockReturnValue('stored');

vi.mock('./StorageEncryption', () => ({
  StorageEncryption: {
    getInstance: () => ({ setCache, removeFromCache, getCached }),
  },
}));

import { SecureStorage } from './SecureStorage';
import { setPracticeSession } from '../utils/practiceSession';

describe('SecureStorage practice isolation', () => {
  beforeEach(() => {
    setCache.mockClear();
    removeFromCache.mockClear();
  });
  afterEach(() => setPracticeSession(false));

  test('writes reach storage in a normal session', () => {
    SecureStorage.setItem('key', 'value');
    expect(setCache).toHaveBeenCalledWith('key', 'value');
  });

  test('writes are dropped during a practice session', () => {
    setPracticeSession(true);
    SecureStorage.setItem('key', 'value');
    expect(setCache).not.toHaveBeenCalled();
  });

  test('removals are dropped during a practice session', () => {
    setPracticeSession(true);
    SecureStorage.removeItem('key');
    expect(removeFromCache).not.toHaveBeenCalled();
  });

  test('reads still work during a practice session — the run must boot', () => {
    setPracticeSession(true);
    expect(SecureStorage.getItem('key')).toBe('stored');
  });
});
