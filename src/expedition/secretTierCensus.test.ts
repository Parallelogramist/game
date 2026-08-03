import { describe, test, expect } from 'vitest';

import { buildRegionVaults } from '../world/secretCapstones';
import { buildSecretPuzzle } from '../world/secretPuzzles';
import { PoiKind } from '../world/worldTypes';
import type { SecretTier } from '../world/secretRewards';
import { EXPEDITION_HIDDEN_SECTOR_COUNT, generateExpeditionWorld } from './expeditionWorld';
import { FIRST_EXPEDITION_WORLD_SEED } from './ExpeditionSeasonStore';
import { buildSecretTierCensus, countSpentSecretsByTier } from './secretTierCensus';

const SEEDS = [FIRST_EXPEDITION_WORLD_SEED, 1, 777, 20260801, 20260727];

function idsOfTier(census: ReadonlyMap<string, SecretTier>, tier: SecretTier): string[] {
  return [...census].filter(([, entry]) => entry === tier).map(([id]) => id);
}

describe('secretTierCensus', () => {
  test('every world censuses its hidden sectors, its rings and its vaults', () => {
    for (const seed of SEEDS) {
      const map = generateExpeditionWorld(seed);
      const census = buildSecretTierCensus(map);
      const sectors = [...map.sectors.values()];
      const hiddenKeys = sectors.filter((sector) => sector.hidden === true).map((s) => s.key);
      const secretSlots = sectors.flatMap((sector) =>
        sector.poiSlots.filter((slot) => slot.kind === PoiKind.Secret));

      for (const key of hiddenKeys) expect(census.get(key), `${seed} ${key}`).toBe('hiddenSector');
      expect(idsOfTier(census, 'hiddenSector').length, `seed ${seed}`)
        .toBe(EXPEDITION_HIDDEN_SECTOR_COUNT);

      const vaults = buildRegionVaults(map);
      for (const id of idsOfTier(census, 'capstone')) {
        expect(vaults.has(id), `${seed} ${id}`).toBe(true);
      }

      expect(census.size, `seed ${seed}`).toBe(hiddenKeys.length + secretSlots.length);
    }
  });

  test('a capstone is never also counted as a ring', () => {
    for (const seed of SEEDS) {
      const map = generateExpeditionWorld(seed);
      const census = buildSecretTierCensus(map);
      const depthById = new Map<string, number>();
      for (const sector of map.sectors.values()) {
        for (const slot of sector.poiSlots) depthById.set(slot.id, sector.depth);
      }
      const capstones = idsOfTier(census, 'capstone');
      expect(capstones.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const secretId of capstones) {
        expect(buildSecretPuzzle({
          worldSeed: map.seed, secretId, depth: depthById.get(secretId) ?? 0,
        }), `${seed} ${secretId}`).toBeNull();
      }
    }
  });

  test('spent counts read the two stores the two kinds actually live in', () => {
    const map = generateExpeditionWorld(FIRST_EXPEDITION_WORLD_SEED);
    const census = buildSecretTierCensus(map);
    const hiddenKeys = idsOfTier(census, 'hiddenSector');
    const spentSecretIds = new Set([
      idsOfTier(census, 'cache')[0],
      idsOfTier(census, 'puzzle')[0],
      // Every hidden key too: a hidden sector is not in the secret store, so counting one here
      // would mean the census read it through the wrong predicate.
      ...hiddenKeys,
    ]);

    expect(countSpentSecretsByTier(
      census,
      (secretId) => spentSecretIds.has(secretId),
      (sectorKey) => sectorKey === hiddenKeys[0],
    )).toEqual({ cache: 1, hiddenSector: 1, puzzle: 1, capstone: 0 });
  });
});
