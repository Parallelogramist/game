import { describe, expect, test } from 'vitest';
import { STAGES } from '../data/Stages';
import { generateWorld } from './generateWorld';
import { buildSecretPuzzle } from './secretPuzzles';
import { MIN_REGION_SECRETS_FOR_VAULT, buildRegionVaults } from './secretCapstones';
import { PoiKind } from './worldTypes';
import type { WorldMap } from './worldTypes';

const MAP = generateWorld(20260727, {
  abilityGateOrder: [],
  availableBiomeIds: STAGES.map(stage => stage.id),
});

describe('region vaults', () => {
  test('names at most one vault per region and never one of its own prerequisites', () => {
    const vaults = buildRegionVaults(MAP);
    expect(vaults.size).toBeGreaterThan(0);
    const regions = new Set<string>();
    for (const [secretId, vault] of vaults) {
      expect(secretId).toBe(vault.secretId);
      expect(regions.has(vault.biomeId)).toBe(false);
      regions.add(vault.biomeId);
      expect(vault.prerequisiteSecretIds).not.toContain(vault.secretId);
      expect(vault.prerequisiteSecretIds.length)
        .toBeGreaterThanOrEqual(MIN_REGION_SECRETS_FOR_VAULT - 1);
    }
  });

  test('a vault is ring-free, never hidden, and the deepest such slot in its region', () => {
    for (const vault of buildRegionVaults(MAP).values()) {
      const owner = sectorHoldingSecret(MAP, vault.secretId);
      expect(owner.hidden === true).toBe(false);
      expect(owner.biomeId).toBe(vault.biomeId);
      expect(buildSecretPuzzle({
        worldSeed: MAP.seed, secretId: vault.secretId, depth: owner.depth,
      })).toBeNull();
      for (const secretId of vault.prerequisiteSecretIds) {
        const other = sectorHoldingSecret(MAP, secretId);
        expect(other.biomeId).toBe(vault.biomeId);
        const ringed = buildSecretPuzzle({
          worldSeed: MAP.seed, secretId, depth: other.depth,
        }) !== null;
        if (!ringed) expect(other.depth).toBeLessThanOrEqual(owner.depth);
      }
    }
  });

  test('the prerequisite set is exactly the rest of that region, hidden rooms excluded', () => {
    const vaults = buildRegionVaults(MAP);
    for (const vault of vaults.values()) {
      const expected = new Set<string>();
      for (const sector of MAP.sectors.values()) {
        if (sector.hidden === true || sector.biomeId !== vault.biomeId) continue;
        for (const slot of sector.poiSlots) {
          if (slot.kind === PoiKind.Secret && slot.id !== vault.secretId) expected.add(slot.id);
        }
      }
      expect(new Set(vault.prerequisiteSecretIds)).toEqual(expected);
    }
  });
});

function sectorHoldingSecret(map: WorldMap, secretId: string) {
  for (const sector of map.sectors.values()) {
    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret && slot.id === secretId) return sector;
    }
  }
  throw new Error(`no sector holds ${secretId}`);
}
