import { buildSecretPuzzle } from './secretPuzzles';
import { PoiKind } from './worldTypes';
import type { WorldMap } from './worldTypes';

/** Below this a region has no vault: at two the vault costs one find, which is not a chase,
 *  and at one the region's only cache would be sealed behind itself. */
export const MIN_REGION_SECRETS_FOR_VAULT = 3;

export interface RegionVault {
  /** PoiSlot.id of the cache the region holds back. */
  secretId: string;
  /** SectorDef.biomeId, which IS the region: assignDangerAndBiomes gives one stage per depth
   *  band, so a biome is contiguous by construction and already carries a player-facing name. */
  biomeId: string;
  /** Every other non-hidden Secret slot in the same region, ringed ones included: the vault
   *  asks the player to clear the region, not the easy half of it. */
  prerequisiteSecretIds: readonly string[];
}

interface RegionSecret {
  secretId: string;
  depth: number;
  ringed: boolean;
}

/**
 * One vault per biome region, keyed by the vault's own secret id so a caller holding a slot can
 * ask in O(1).
 *
 * A candidate must be RING-FREE, because secretHints already writes a lead sentence naming a
 * ring's sigil order and a cache carrying both gates would need that surface taught about it;
 * selecting past the ringed ones makes the interaction zero rather than handled. It must be
 * NON-HIDDEN, the same rule buildSectorSupply gives for quest destinations: a hidden sector is
 * off the chart until a wall is broken, so a target only it can satisfy is one the player
 * cannot plan for. Of what is left the DEEPEST wins, ties broken by the greater id, so the
 * choice is a pure function of the generated world.
 */
export function buildRegionVaults(map: WorldMap): Map<string, RegionVault> {
  const byRegion = new Map<string, RegionSecret[]>();
  for (const sector of map.sectors.values()) {
    if (sector.hidden === true) continue;
    for (const slot of sector.poiSlots) {
      if (slot.kind !== PoiKind.Secret) continue;
      const region = byRegion.get(sector.biomeId) ?? [];
      region.push({
        secretId: slot.id,
        depth: sector.depth,
        ringed: buildSecretPuzzle({
          worldSeed: map.seed, secretId: slot.id, depth: sector.depth,
        }) !== null,
      });
      byRegion.set(sector.biomeId, region);
    }
  }

  const vaults = new Map<string, RegionVault>();
  for (const [biomeId, secrets] of byRegion) {
    if (secrets.length < MIN_REGION_SECRETS_FOR_VAULT) continue;
    const candidates = secrets.filter(secret => !secret.ringed);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.depth - a.depth || compareIds(a.secretId, b.secretId));
    const chosen = candidates[0];
    vaults.set(chosen.secretId, {
      secretId: chosen.secretId,
      biomeId,
      prerequisiteSecretIds: secrets
        .filter(secret => secret.secretId !== chosen.secretId)
        .map(secret => secret.secretId),
    });
  }
  return vaults;
}

/** Greater id first, so the tie-break does not depend on Map insertion order. */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}
