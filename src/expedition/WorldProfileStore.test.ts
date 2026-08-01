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
  getSectorMarks,
  isWorldConquered,
  loadWorldProfile,
  markWorldConquered,
  recordBrokenBarrier,
  setSectorMark,
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

describe('world profile sector marks', () => {
  test('a mark replaces its sector, clears on null, and survives beside a broken wall', () => {
    recordBrokenBarrier(31, 1, 'edge:0,0:north');
    expect(setSectorMark(31, 1, '2,-1', 'return')).toBe(true);
    expect(setSectorMark(31, 1, '4,0', 'danger')).toBe(true);
    expect(setSectorMark(31, 1, '2,-1', 'question')).toBe(true);
    expect(getSectorMarks(31, 1)).toEqual(new Map([['2,-1', 'question'], ['4,0', 'danger']]));
    expect(setSectorMark(31, 1, '2,-1', null)).toBe(true);
    expect(getSectorMarks(31, 1)).toEqual(new Map([['4,0', 'danger']]));
    expect(loadWorldProfile(31, 1).brokenBreakableIds).toEqual(['edge:0,0:north']);
  });

  test('a payload written before marks shipped keeps its walls, and a bad id is dropped', () => {
    SecureStorage.setItem('survivor-world-profile', JSON.stringify({
      version: 1, worldSeed: 32, worldGenVersion: 1,
      brokenBreakableIds: ['edge:1,1:south'],
      markedSectorIds: ['mark:1,1:sparkle', 'mark:1,1:danger', 7],
    }));
    expect(loadWorldProfile(32, 1).brokenBreakableIds).toEqual(['edge:1,1:south']);
    expect(getSectorMarks(32, 1)).toEqual(new Map([['1,1', 'danger']]));
  });
});
