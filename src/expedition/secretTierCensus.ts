import { buildRegionVaults } from '../world/secretCapstones';
import { buildSecretPuzzle } from '../world/secretPuzzles';
import { PoiKind } from '../world/worldTypes';
import type { WorldMap } from '../world/worldTypes';
import type { SecretTier } from '../world/secretRewards';

/**
 * What a world's once-per-world finds are worth to a quest, and how many of them this profile
 * has already spent here.
 *
 * A contract dies with its world, so "already spent" is the whole reason this exists: a find
 * banked before the contract activated is work the player really did in the world the contract
 * belongs to, and nothing else can ever feed that step again.
 */

export const SECRET_TIERS: readonly SecretTier[] =
  ['cache', 'hiddenSector', 'puzzle', 'capstone'];

export function emptyTierCounts(): Record<SecretTier, number> {
  return { cache: 0, hiddenSector: 0, puzzle: 0, capstone: 0 };
}

/**
 * Every secret id the world can ever report a find for, mapped to the tier that find reports.
 *
 * Precedence is capstone, then puzzle, then cache, and it matches the producers rather than
 * being chosen here: `buildRegionVaults` picks its vault out of the region's RING-FREE slots, so
 * capstone and puzzle can never collide, and everything else is a plain cache. A hidden sector is
 * keyed by its SectorDef.key, because that is the id `GameScene` reports it under
 * (`GameScene.ts:6808` rolls the reward with `secretId: sector.key`).
 */
export function buildSecretTierCensus(map: WorldMap): Map<string, SecretTier> {
  const vaults = buildRegionVaults(map);
  const census = new Map<string, SecretTier>();
  for (const sector of map.sectors.values()) {
    if (sector.hidden === true) census.set(sector.key, 'hiddenSector');
    for (const slot of sector.poiSlots) {
      if (slot.kind !== PoiKind.Secret) continue;
      if (vaults.has(slot.id)) {
        census.set(slot.id, 'capstone');
        continue;
      }
      const ringed = buildSecretPuzzle({
        worldSeed: map.seed, secretId: slot.id, depth: sector.depth,
      }) !== null;
      census.set(slot.id, ringed ? 'puzzle' : 'cache');
    }
  }
  return census;
}

/**
 * How many finds of each tier this profile has already banked in this world.
 *
 * Two predicates rather than one, because the two kinds persist in different stores: a cache,
 * ring or vault is `SecretFlags.FOUND` in `DiscoveryState.secrets`, while a hidden sector is
 * `SectorFlags.VISITED` on its own key and is NOT in `universe.secretIds` at all
 * (`discoveryRules.ts:75` adds `PoiKind.Secret` slots only). `DiscoveryManager.getCompletionPercent`
 * already reads a hidden sector's found-state exactly this way.
 */
export function countSpentSecretsByTier(
  census: ReadonlyMap<string, SecretTier>,
  isSecretFound: (secretId: string) => boolean,
  isHiddenSectorFound: (sectorKey: string) => boolean,
): Record<SecretTier, number> {
  const counts = emptyTierCounts();
  for (const [id, tier] of census) {
    const found = tier === 'hiddenSector' ? isHiddenSectorFound(id) : isSecretFound(id);
    if (found) counts[tier] += 1;
  }
  return counts;
}
