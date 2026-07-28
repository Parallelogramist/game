import { describe, test, expect } from 'vitest';
import { EdgeKind } from '../world/worldTypes';
import { GATE_GLYPHS, gateGlyphFor } from './gateGlyphs';

const ALL_EDGE_KINDS = Object.values(EdgeKind)
  .filter(value => typeof value === 'number') as EdgeKind[];

describe('gateGlyphs', () => {
  test('every EdgeKind has a glyph entry', () => {
    for (const kind of ALL_EDGE_KINDS) {
      const glyph = GATE_GLYPHS[kind];
      expect(glyph).toBeDefined();
      expect(glyph.label.length).toBeGreaterThan(0);
    }
  });

  test('no two border kinds share a shape', () => {
    const shapes = ALL_EDGE_KINDS.map(kind => GATE_GLYPHS[kind].shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  test('an unrecognised kind falls back to the wall glyph', () => {
    expect(gateGlyphFor(99 as EdgeKind)).toEqual(GATE_GLYPHS[EdgeKind.Wall]);
  });
});
