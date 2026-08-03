import { EDGE_DIRECTIONS, SECTOR_TILE_COLS, SECTOR_TILE_ROWS, TILE_SIZE } from './worldTypes';
import type { WorldMap } from './worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH, type WorldPoint } from './worldSpace';

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

/**
 * Where the SANDBOX drops a ship that asked for the boss arena: beside the arena's own
 * doorway, one tile inside the room.
 *
 * Deliberately NOT a relaxation of listWorldRegions' boss-arena refusal above. That refusal
 * also feeds real-run destinations, where arriving spawns the Warden and the seal then blocks
 * recall; here the exit is a page reload, so the two want opposite answers and get separate
 * clauses.
 *
 * The doorway rather than the centre because the throne stands at the centre with a 150 px
 * trip radius: dropping on it would spawn the boss before the player has taken a frame of
 * control, which is the one thing a Warden playtest cannot afford to lose. The pull one tile
 * inward keeps the drop unambiguously inside the arena rather than straddling the aperture
 * into the neighbouring room.
 */
export function bossArenaDropPoint(map: WorldMap): WorldPoint | null {
  const arena = map.sectors.get(map.bossArenaKey);
  if (arena === undefined || !arena.isBossArena) return null;
  for (const direction of EDGE_DIRECTIONS) {
    const entry = arena.entryTiles[direction];
    if (entry === undefined) continue;
    const tileX = Math.min(SECTOR_TILE_COLS - 2, Math.max(1, entry.tileX));
    const tileY = Math.min(SECTOR_TILE_ROWS - 2, Math.max(1, entry.tileY));
    return {
      x: arena.sx * SECTOR_WIDTH + tileX * TILE_SIZE + TILE_SIZE / 2,
      y: arena.sy * SECTOR_HEIGHT + tileY * TILE_SIZE + TILE_SIZE / 2,
    };
  }
  return null;
}
