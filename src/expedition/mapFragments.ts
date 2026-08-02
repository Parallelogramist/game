/**
 * What a recovered map fragment charts. Worldgen owns where the regions are (a biomeId IS a
 * region: assignDangerAndBiomes assigns one per depth band, so a region is contiguous by
 * construction and already has a player-facing name); this owns which slice of which one a
 * given find is worth.
 *
 * Pure and Phaser-free, the secretHints shape: the caller passes the world and what the
 * profile already knows, and gets back a grant or null.
 */

import { getStageById } from '../data/Stages';
import type { WorldMap } from '../world/worldTypes';

/**
 * A fragment charts a slice, never a whole region. Measured against the live seed 20260727:
 * the world's 48 sectors fall into 5 regions of 5, 16, 18, 8 and 1, so an uncapped reveal
 * would hand over 37% of the map for one cache.
 */
export const MAP_FRAGMENT_MAX_SECTORS = 8;

export interface MapFragmentGrant {
  /** The region's StageDefinition id, unprefixed: the key a profile-wide record uses. */
  stageId: string;
  regionId: string;
  /** Player-facing region name, for the toast. */
  regionName: string;
  /** Sectors to chart, shallowest first. Never longer than the requested cap. */
  sectorKeys: string[];
}

export interface MapFragmentInput {
  map: WorldMap;
  discoveredSectorKeys: ReadonlySet<string>;
  visitedSectorKeys: ReadonlySet<string>;
  /** Where the find happened, so the fragment charts somewhere the player is not standing. */
  originSectorKey: string;
  maxSectors: number;
}

interface RegionCandidate {
  stageId: string;
  regionId: string;
  regionName: string;
  minDepth: number;
  uncharted: { key: string; depth: number }[];
}

/**
 * Prefers a region the player is not standing in (their own neighbourhood is what sector entry
 * and the decryptor sweep already chart), then the region with the most left to chart, so a
 * fragment is never a near-no-op. Returns null only when everything chartable is already known,
 * which the caller pays as a chest instead.
 */
export function chooseMapFragmentGrant(input: MapFragmentInput): MapFragmentGrant | null {
  const { map, discoveredSectorKeys, visitedSectorKeys, originSectorKey } = input;
  const maxSectors = Math.max(1, Math.floor(input.maxSectors));
  const candidatesByRegion = new Map<string, RegionCandidate>();

  for (const sector of map.sectors.values()) {
    // A hidden sector is not chartable until the ship has been inside it: outlining one would
    // hand back exactly what the breakable wall conceals (the guard every reveal path carries).
    if (sector.hidden === true && !visitedSectorKeys.has(sector.key)) continue;
    const regionId = `region:${sector.biomeId}`;
    let candidate = candidatesByRegion.get(regionId);
    if (!candidate) {
      candidate = {
        stageId: sector.biomeId,
        regionId,
        regionName: getStageById(sector.biomeId)?.name ?? 'uncharted space',
        minDepth: sector.depth,
        uncharted: [],
      };
      candidatesByRegion.set(regionId, candidate);
    }
    candidate.minDepth = Math.min(candidate.minDepth, sector.depth);
    if (!discoveredSectorKeys.has(sector.key)) {
      candidate.uncharted.push({ key: sector.key, depth: sector.depth });
    }
  }

  const originBiomeId = map.sectors.get(originSectorKey)?.biomeId;
  const originRegionId = originBiomeId === undefined ? null : `region:${originBiomeId}`;
  const withWork = [...candidatesByRegion.values()].filter(one => one.uncharted.length > 0);
  const awayFromOrigin = withWork.filter(one => one.regionId !== originRegionId);
  const pool = awayFromOrigin.length > 0 ? awayFromOrigin : withWork;
  if (pool.length === 0) return null;

  pool.sort((left, right) =>
    right.uncharted.length - left.uncharted.length
    || left.minDepth - right.minDepth
    || (left.regionId < right.regionId ? -1 : 1));

  const chosen = pool[0];
  chosen.uncharted.sort((left, right) =>
    left.depth - right.depth || (left.key < right.key ? -1 : 1));
  return {
    stageId: chosen.stageId,
    regionId: chosen.regionId,
    regionName: chosen.regionName,
    sectorKeys: chosen.uncharted.slice(0, maxSectors).map(entry => entry.key),
  };
}
