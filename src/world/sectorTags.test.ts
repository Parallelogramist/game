import { describe, test, expect } from 'vitest';
import { generateWorld } from './generateWorld';
import { sectorKeysWithTag, sectorMatchesTag, sectorTagsOf } from './sectorTags';
import { STAGES } from '../data/Stages';

const MAP = generateWorld(20260727, {
  abilityGateOrder: [],
  availableBiomeIds: STAGES.map(stage => stage.id),
});

describe('sectorTags', () => {
  test('every tag a sector emits matches that same sector', () => {
    for (const sector of MAP.sectors.values()) {
      for (const tag of sectorTagsOf(sector)) {
        expect(sectorMatchesTag(sector, tag), `${sector.key} ${tag}`).toBe(true);
      }
    }
  });

  test('boss-arena names one sector and a biome tag names only its own region', () => {
    expect(sectorKeysWithTag(MAP, 'boss-arena')).toHaveLength(1);
    const biomeId = MAP.sectors.get(MAP.startKey)!.biomeId;
    const keys = sectorKeysWithTag(MAP, `biome:${biomeId}`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(MAP.sectors.get(key)!.biomeId).toBe(biomeId);
  });
});
