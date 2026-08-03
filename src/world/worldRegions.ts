import type { WorldMap } from './worldTypes';

/**
 * One biome region of a generated world. `assignDangerAndBiomes` gives one stage per depth
 * band, so a biomeId IS a region and is contiguous by construction (the same fact
 * `secretCapstones` and `mapFragments` already lean on).
 */
export interface WorldRegion {
  biomeId: string;
  /** Shallowest sector of the region: where something entering the region from the hangar
   *  side arrives. */
  entrySectorKey: string;
  entryDepth: number;
  /** Non-hidden, non-boss sectors counted, so a caller can tell a real region from a stub. */
  sectorCount: number;
}

/**
 * Every region of the world, shallowest first, each with the room to enter it at.
 *
 * Two exclusions, both correctness rather than taste. The BOSS ARENA is refused for the
 * reason the field anchor and a planned sortie refuse it: arriving spawns the Warden and the
 * seal then blocks recall. A HIDDEN sector is refused because it is off the chart until a
 * breakable wall is broken, so entering one hands over exactly what it conceals.
 *
 * Ordering is a pure function of the world: depth first, then biomeId, so two regions that
 * start at the same depth cannot swap on Map insertion order.
 */
export function listWorldRegions(map: WorldMap): WorldRegion[] {
  const byBiome = new Map<string, WorldRegion>();
  for (const sector of map.sectors.values()) {
    if (sector.hidden === true) continue;
    if (sector.isBossArena) continue;
    const region = byBiome.get(sector.biomeId);
    if (region === undefined) {
      byBiome.set(sector.biomeId, {
        biomeId: sector.biomeId,
        entrySectorKey: sector.key,
        entryDepth: sector.depth,
        sectorCount: 1,
      });
      continue;
    }
    region.sectorCount += 1;
    if (sector.depth < region.entryDepth
      || (sector.depth === region.entryDepth && sector.key < region.entrySectorKey)) {
      region.entrySectorKey = sector.key;
      region.entryDepth = sector.depth;
    }
  }
  return [...byBiome.values()].sort((left, right) =>
    left.entryDepth - right.entryDepth
    || (left.biomeId < right.biomeId ? -1 : left.biomeId > right.biomeId ? 1 : 0));
}
