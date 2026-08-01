import { describe, test, expect } from 'vitest';
import { generateWorld } from '../world/generateWorld';
import { STAGES } from '../data/Stages';
import { buildQuestPins } from './questPins';
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
