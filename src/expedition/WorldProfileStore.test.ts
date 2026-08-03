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
  getFieldAnchor,
  getSectorMarks,
  getSectorNotes,
  isWorldConquered,
  loadWorldProfile,
  markWorldConquered,
  recordBrokenBarrier,
  recordFieldAnchor,
  setSectorMark,
  setSectorNote,
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

describe('world profile sector notes', () => {
  test('a note replaces its sector, clears on null, and rides beside the marks', () => {
    expect(setSectorMark(33, 1, '2,-1', 'danger')).toBe(true);
    expect(setSectorNote(33, 1, '2,-1', '  boss killed me\ntwice  ')).toBe(true);
    expect(setSectorNote(33, 1, '4,0', 'cache behind the rock')).toBe(true);
    expect(getSectorNotes(33, 1)).toEqual(new Map([
      ['2,-1', 'boss killed me twice'], ['4,0', 'cache behind the rock'],
    ]));
    expect(setSectorNote(33, 1, '2,-1', '   ')).toBe(true);
    expect(getSectorNotes(33, 1)).toEqual(new Map([['4,0', 'cache behind the rock']]));
    expect(getSectorMarks(33, 1)).toEqual(new Map([['2,-1', 'danger']]));
  });

  test('clearing a mark clears its note, and a payload written before notes shipped keeps its marks', () => {
    SecureStorage.setItem('survivor-world-profile', JSON.stringify({
      version: 1, worldSeed: 34, worldGenVersion: 1,
      brokenBreakableIds: ['edge:1,1:south'],
      markedSectorIds: ['mark:1,1:danger'],
    }));
    expect(getSectorNotes(34, 1)).toEqual(new Map());
    expect(setSectorNote(34, 1, '1,1', 'tether door here')).toBe(true);
    expect(setSectorMark(34, 1, '1,1', 'question')).toBe(true);
    expect(getSectorNotes(34, 1)).toEqual(new Map([['1,1', 'tether door here']]));
    expect(setSectorMark(34, 1, '1,1', null)).toBe(true);
    expect(getSectorNotes(34, 1)).toEqual(new Map());
    expect(loadWorldProfile(34, 1).brokenBreakableIds).toEqual(['edge:1,1:south']);
  });
});

describe('world profile field anchor', () => {
  test('the last room round-trips and only changes when the room does', () => {
    expect(getFieldAnchor(71, 1)).toBeNull();
    expect(recordFieldAnchor(71, 1, '3,-2')).toBe(true);
    expect(getFieldAnchor(71, 1)).toBe('3,-2');
    expect(recordFieldAnchor(71, 1, '3,-2')).toBe(true);
    expect(recordFieldAnchor(71, 1, '0,4')).toBe(true);
    expect(getFieldAnchor(71, 1)).toBe('0,4');
  });

  test('a payload written before the field shipped reads no anchor and keeps its walls', () => {
    SecureStorage.setItem('survivor-world-profile', JSON.stringify({
      version: 1, worldSeed: 72, worldGenVersion: 1,
      brokenBreakableIds: ['edge:2,2:north'],
    }));
    expect(getFieldAnchor(72, 1)).toBeNull();
    expect(loadWorldProfile(72, 1).brokenBreakableIds).toEqual(['edge:2,2:north']);
  });

  test('a key that is not a sector key is refused rather than stored', () => {
    expect(recordFieldAnchor(73, 1, 'edge:0,0:north')).toBe(false);
    expect(getFieldAnchor(73, 1)).toBeNull();
  });
});
