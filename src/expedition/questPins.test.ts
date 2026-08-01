import { describe, test, expect } from 'vitest';
import { generateWorld } from '../world/generateWorld';
import { STAGES } from '../data/Stages';
import { buildHazardPins, buildQuestPins, updatedPinSectorKeys } from './questPins';
import { PoiFlags } from './DiscoveryTypes';
import type { QuestMarker } from '../systems/QuestProgress';

const MAP = generateWorld(20260727, {
  abilityGateOrder: [],
  availableBiomeIds: STAGES.map(stage => stage.id),
});
const ARENA_KEY = [...MAP.sectors.values()].find(sector => sector.isBossArena)!.key;
const ARENA_MARKERS: QuestMarker[] = [
  { questId: 'quest_a', label: 'A', icon: 'crown', sectorTag: 'boss-arena' },
];

function pinsFor(markers: QuestMarker[], charted: readonly string[]) {
  const known = new Set(charted);
  return buildQuestPins({
    map: MAP,
    markers,
    sectorFlagsOf: (key) => (known.has(key) ? 1 : 0),
    shipCell: { col: 0, row: 0 },
  });
}

describe('buildQuestPins', () => {
  test('pins the charted sector carrying the tag', () => {
    expect(pinsFor(ARENA_MARKERS, [ARENA_KEY])[0].sectorKey).toBe(ARENA_KEY);
  });

  test('an uncharted destination resolves to null rather than leaking its key', () => {
    expect(pinsFor(ARENA_MARKERS, [])[0].sectorKey).toBeNull();
  });

  test('picks the nearest charted match of a many-sector tag', () => {
    const biomeId = MAP.sectors.get(MAP.startKey)!.biomeId;
    const region = [...MAP.sectors.values()].filter(sector => sector.biomeId === biomeId);
    expect(region.length).toBeGreaterThan(1);
    const pins = pinsFor(
      [{ questId: 'q', label: 'Q', icon: 'crown', sectorTag: `biome:${biomeId}` }],
      region.map(sector => sector.key),
    );
    const chosen = MAP.sectors.get(pins[0].sectorKey!)!;
    const distanceOf = (sx: number, sy: number) => Math.max(Math.abs(sx), Math.abs(sy));
    const nearest = Math.min(...region.map(sector => distanceOf(sector.sx, sector.sy)));
    expect(distanceOf(chosen.sx, chosen.sy)).toBe(nearest);
  });
});

describe('buildHazardPins', () => {
  const NEST_OBJECTIVES = [{ questId: 'quest_nest', label: 'Nest' }];
  const SECTORS = [...MAP.sectors.values()];

  function hazardPinsFor(nestSectorKeys: readonly string[], spent: readonly string[] = []) {
    const nestSlotIds = new Set(
      SECTORS.filter(sector => nestSectorKeys.includes(sector.key))
        .flatMap(sector => sector.poiSlots.map(slot => slot.id)),
    );
    return buildHazardPins({
      map: MAP,
      objectives: NEST_OBJECTIVES,
      sectorFlagsOf: (key) => (nestSectorKeys.includes(key) ? 1 : 0),
      poiFlagsOf: (poiId) => (nestSlotIds.has(poiId) ? PoiFlags.HAZARD_NEST : 0),
      spentNestSectorKeys: new Set(spent),
      shipCell: { col: 0, row: 0 },
    });
  }

  test('pins the nearest remembered hive', () => {
    const withSlots = SECTORS.filter(sector => sector.poiSlots.length > 0);
    expect(withSlots.length).toBeGreaterThan(1);
    const distanceOf = (sx: number, sy: number) => Math.max(Math.abs(sx), Math.abs(sy));
    const sorted = [...withSlots]
      .sort((a, b) => distanceOf(a.sx, a.sy) - distanceOf(b.sx, b.sy));
    const near = sorted[0];
    const far = sorted[sorted.length - 1];
    expect(distanceOf(far.sx, far.sy)).toBeGreaterThan(distanceOf(near.sx, near.sy));
    expect(hazardPinsFor([near.key, far.key])[0].sectorKey).toBe(near.key);
  });

  test('skips a hive already taken this run, and emits no pin when none is left', () => {
    const withSlots = SECTORS.filter(sector => sector.poiSlots.length > 0);
    const distanceOf = (sx: number, sy: number) => Math.max(Math.abs(sx), Math.abs(sy));
    const sorted = [...withSlots]
      .sort((a, b) => distanceOf(a.sx, a.sy) - distanceOf(b.sx, b.sy));
    const near = sorted[0];
    const far = sorted[sorted.length - 1];
    expect(hazardPinsFor([near.key, far.key], [near.key])[0].sectorKey).toBe(far.key);
    expect(hazardPinsFor([near.key], [near.key])).toEqual([]);
    expect(hazardPinsFor([])).toEqual([]);
  });
});

describe('updatedPinSectorKeys', () => {
  test('drops an updated objective with nowhere to point and unions the rest', () => {
    const pins = [
      { questId: 'quest_a', label: 'A', sectorKey: '1,0' },
      { questId: 'quest_b', label: 'B', sectorKey: null },
      { questId: 'quest_c', label: 'C', sectorKey: '1,0' },
      { questId: 'quest_d', label: 'D', sectorKey: '2,0' },
    ];
    const updated = updatedPinSectorKeys(pins, new Set(['quest_b', 'quest_c']));
    expect([...updated]).toEqual(['1,0']);
    expect(updatedPinSectorKeys(pins, new Set())).toEqual(new Set());
  });
});
