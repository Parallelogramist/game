import { describe, test, expect } from 'vitest';
import { PoiKind } from '../world/worldTypes';
import { POI_GLYPHS, poiGlyphFor } from './poiGlyphs';

const ALL_POI_KINDS = Object.values(PoiKind)
  .filter(value => typeof value === 'number') as PoiKind[];

describe('poiGlyphs', () => {
  test('every PoiKind has a glyph entry', () => {
    for (const kind of ALL_POI_KINDS) {
      const glyph = POI_GLYPHS[kind];
      expect(glyph).toBeDefined();
      expect(glyph.label.length).toBeGreaterThan(0);
    }
  });

  test('no two drawn slot kinds share a shape', () => {
    const shapes = ALL_POI_KINDS
      .map(kind => POI_GLYPHS[kind].shape)
      .filter(shape => shape !== 'none');
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  test('an unrecognised kind falls back to a glyph that draws nothing', () => {
    expect(poiGlyphFor(99 as PoiKind).shape).toBe('none');
  });
});
