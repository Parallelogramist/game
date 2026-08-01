import { describe, test, expect } from 'vitest';
import {
  SECTOR_MARKS, SECTOR_MARK_CYCLE, nextSectorMarkKind, parseSectorMarkId, sectorMarkId,
} from './sectorMarks';

describe('sector marks', () => {
  test('one press per kind, and the press after the last one clears it', () => {
    expect(nextSectorMarkKind(null)).toBe('return');
    expect(nextSectorMarkKind('return')).toBe('danger');
    expect(nextSectorMarkKind('danger')).toBe('question');
    expect(nextSectorMarkKind('question')).toBeNull();
  });

  test('an id round-trips for a negative sector', () => {
    const id = sectorMarkId('-3,-12', 'danger');
    expect(id).toBe('mark:-3,-12:danger');
    expect(parseSectorMarkId(id)).toEqual({ sectorKey: '-3,-12', kind: 'danger' });
  });

  test('a malformed or unknown-kind id is rejected rather than coerced', () => {
    expect(parseSectorMarkId('mark:3,4:sparkle')).toBeNull();
    expect(parseSectorMarkId('mark:3;4:danger')).toBeNull();
    expect(parseSectorMarkId('edge:0,0:north')).toBeNull();
  });

  test('every cycled kind has a glyph, and no two share a shape', () => {
    const shapes = SECTOR_MARK_CYCLE.map(kind => SECTOR_MARKS[kind].shape);
    expect(shapes.filter(Boolean)).toHaveLength(SECTOR_MARK_CYCLE.length);
    expect(new Set(shapes).size).toBe(SECTOR_MARK_CYCLE.length);
  });
});
