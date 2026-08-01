import { describe, test, expect, vi } from 'vitest';

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
  isWorldConquered,
  loadWorldProfile,
  markWorldConquered,
  recordBrokenBarrier,
} from './WorldProfileStore';

describe('world profile conquest', () => {
  test('a world is conquered once, alongside the walls it already remembers', () => {
    recordBrokenBarrier(11, 1, 'edge:0,0:north');
    expect(markWorldConquered(11, 1)).toBe(true);
    expect(markWorldConquered(11, 1)).toBe(false);
    expect(isWorldConquered(11, 1)).toBe(true);
    expect(loadWorldProfile(11, 1).brokenBreakableIds).toEqual(['edge:0,0:north']);
  });

  test('a payload written before the flag shipped reads unconquered and keeps its walls', () => {
    SecureStorage.setItem('survivor-world-profile', JSON.stringify({
      version: 1, worldSeed: 22, worldGenVersion: 1,
      brokenBreakableIds: ['edge:1,1:south'],
    }));
    expect(isWorldConquered(22, 1)).toBe(false);
    expect(loadWorldProfile(22, 1).brokenBreakableIds).toEqual(['edge:1,1:south']);
  });
});
