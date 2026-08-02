import { describe, test, expect } from 'vitest';
import { generateWorld } from './generateWorld';
import { buildSectorSupply, sectorKeysWithTag, sectorMatchesTag, sectorTagsOf } from './sectorTags';
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

  test('supply counts every non-hidden sector once per tag it answers to', () => {
    const supply = buildSectorSupply(MAP);
    let nonHidden = 0;
    for (const sector of MAP.sectors.values()) if (sector.hidden !== true) nonHidden += 1;
    expect(supply.anyTag).toBe(nonHidden);
    expect(supply.byTag['boss-arena']).toBe(1);
    const biomeTotal = Object.entries(supply.byTag)
      .filter(([tag]) => tag.startsWith('biome:'))
      .reduce((total, [, count]) => total + count, 0);
    expect(biomeTotal).toBe(nonHidden);
  });

  test('supply never counts a hidden sector', () => {
    const hidden = [...MAP.sectors.values()].filter(sector => sector.hidden === true);
    const supply = buildSectorSupply(MAP);
    for (const sector of hidden) {
      const withHidden = supply.byTag[`biome:${sector.biomeId}`] ?? 0;
      const counted = [...MAP.sectors.values()]
        .filter(one => one.hidden !== true && one.biomeId === sector.biomeId).length;
      expect(withHidden).toBe(counted);
    }
  });
});
