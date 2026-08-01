import { describe, test, expect } from 'vitest';
import { rollPoiContents } from './poiRoll';
import { PoiKind } from './worldTypes';
import type { PoiSlot } from './worldTypes';
import { POI_CONTENTS, POI_DEPTH_BANDS } from '../data/PoiCatalog';

function slots(kind: PoiKind, count: number, prefix = 's'): PoiSlot[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `poi:${prefix}:${index}`, kind, tileX: 4 + index, tileY: 4,
  }));
}

const BASE = {
  worldSeed: 20260727, runSalt: 7, depth: 0,
  oncePerRunAvailable: true, nemesisAvailable: false,
};

describe('rollPoiContents', () => {
  test('is deterministic for the same seed, salt and slots', () => {
    const input = { ...BASE, slots: slots(PoiKind.Treasure, 12) };
    expect(rollPoiContents(input)).toEqual(rollPoiContents(input));
  });

  test('re-rolls contents when the run salt changes', () => {
    const treasure = slots(PoiKind.Treasure, 24);
    const first = rollPoiContents({ ...BASE, slots: treasure });
    const second = rollPoiContents({ ...BASE, runSalt: 8, slots: treasure });
    expect(first.map(entry => entry.contentId))
      .not.toEqual(second.map(entry => entry.contentId));
  });

  test('fills only the slot kinds the catalog covers', () => {
    const untouched = [
      ...slots(PoiKind.AbilityPowerUp, 3, 'a'),
      ...slots(PoiKind.QuestGiver, 3, 'q'),
      ...slots(PoiKind.Secret, 3, 'x'),
    ];
    expect(rollPoiContents({ ...BASE, slots: untouched })).toEqual([]);

    const filled = rollPoiContents({
      ...BASE, depth: 6,
      slots: [...slots(PoiKind.Treasure, 6), ...slots(PoiKind.Shrine, 6, 'h')],
    });
    expect(filled).toHaveLength(12);
    for (const entry of filled) {
      const definition = POI_CONTENTS.find(content => content.id === entry.contentId);
      expect(definition?.slotKind).toBe(entry.slot.kind);
    }
  });

  test('never returns more than one once-per-run content', () => {
    const deep = { ...BASE, depth: 6, slots: slots(PoiKind.Treasure, 60) };
    const markets = rollPoiContents(deep)
      .filter(entry => entry.contentId === 'poi_black_market');
    expect(markets.length).toBeLessThanOrEqual(1);

    const spent = rollPoiContents({ ...deep, oncePerRunAvailable: false });
    expect(spent.some(entry => entry.contentId === 'poi_black_market')).toBe(false);
  });

  test('a nemesis lair needs a live nemesis and never doubles up', () => {
    const deep = { ...BASE, depth: 6, slots: slots(PoiKind.Treasure, 60) };
    const salts = [1, 2, 3, 4, 5, 6, 7, 8];
    const lairsPerSalt = (nemesisAvailable: boolean) => salts.map(runSalt =>
      rollPoiContents({ ...deep, runSalt, nemesisAvailable })
        .filter(entry => entry.contentId === 'poi_nemesis_lair').length);

    expect(lairsPerSalt(false)).toEqual(salts.map(() => 0));
    // Max 1, not "some salt has 1": it must be placeable AND never twice in one roll.
    expect(Math.max(...lairsPerSalt(true))).toBe(1);
  });

  test('the depth bands gate the market to the deep world', () => {
    const shallow = rollPoiContents({ ...BASE, depth: 0, slots: slots(PoiKind.Treasure, 60) });
    expect(shallow.some(entry => entry.contentId === 'poi_black_market')).toBe(false);

    const deep = rollPoiContents({ ...BASE, depth: 6, slots: slots(PoiKind.Treasure, 60) });
    expect(deep.some(entry => entry.contentId === 'poi_black_market')).toBe(true);
  });

  test('the catalog itself is well formed', () => {
    const ids = POI_CONTENTS.map(content => content.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(POI_CONTENTS.every(content => content.weight > 0)).toBe(true);
    const depths = POI_DEPTH_BANDS.map(band => band.minDepth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });
});
