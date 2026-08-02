/**
 * ambientStir: which rooms of a world have bloomed this expedition, and the ground that says so.
 *
 * README section 6's "ambient world state": a persistent world that is identical every life
 * reads as a museum. A bloom is deliberately the ONLY change this module makes, because
 * TileKind.HazardFloor is non-blocking at every consumer (staticCollision, flowField,
 * securityGrids, voidGaps), so painting it over Open floor cannot alter reachability, strand a
 * POI or soft-lock a run. Geometry that BLOCKS needs a sealHoldsUp-shaped proof and is cut to
 * FEAT-STIR-COLLAPSE.
 *
 * Nothing here is generation: it is a post-generation overlay in the applyBrokenBarriers mould,
 * replayed before the renderer, the collision index or the flow field look at the grid. It moves
 * no sector key, edge id, POI id or breakable rect id, which is why WORLDGEN_VERSION does not move.
 */

import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';
import { SECTOR_TILE_COLS, SECTOR_TILE_ROWS, TileKind, tileIndex } from './worldTypes';
import type { SectorDef, WorldMap } from './worldTypes';

/** Rooms that bloom per expedition. Three is enough that a returning player meets one without
 *  hunting, few enough that a bloom still reads as a change rather than as the weather. */
export const BLOOMED_SECTORS_PER_EXPEDITION = 3;

/** Extra 3x1 hazard runs a bloomed room grows. The generator paints at most 2 in its deepest
 *  band (sectorInterior.stampHazardStrips), so a bloom at least triples the ground a room
 *  already carried. */
export const BLOOM_STRIPS_PER_SECTOR = 4;

/** Chebyshev tiles kept clear of every POI slot and every doorway entry tile. One wider than the
 *  generator's own openNeighbourhood protection, because a bloom lands on ground the player has
 *  already learned: a strip that appears across a doorway they used last life reads as a bug. */
const BLOOM_PROTECT_RADIUS = 2;

/** Same 3x1 run the generator stamps, so the renderer and the radar draw a bloom and a generated
 *  strip identically and no visual can distinguish them. */
const STRIP_WIDTH = 3;

const BLOOM_PLACEMENT_ATTEMPTS = 24;

/**
 * The rooms that bloom, sorted, with no side effect. Separate from applyAmbientBloom so a caller
 * that only needs the names never mutates a map.
 *
 * The hangar, the boss arena and hidden rooms never bloom: the hangar is the one room a recall
 * guarantees is safe, the arena's floor is scripted by its own seal, and a hidden room's first
 * entry is already its own event.
 */
export function resolveBloomedSectorKeys(
  map: WorldMap, expeditionOrdinal: number,
): string[] {
  // Sorted before the draw: Map iteration order must never reach a result the save has to agree
  // with across a refresh.
  const eligible = [...map.sectors.values()]
    .filter(sector => sector.hidden !== true && !sector.isStart && !sector.isBossArena)
    .map(sector => sector.key)
    .sort();
  const rng = mulberry32(hashStringToSeed(
    `ambientBloom:${map.seed}:${map.worldGenVersion}:${expeditionOrdinal}`));
  const picked: string[] = [];
  const count = Math.min(BLOOMED_SECTORS_PER_EXPEDITION, eligible.length);
  for (let index = 0; index < count; index++) {
    picked.push(eligible.splice(Math.floor(rng() * eligible.length), 1)[0]);
  }
  return picked.sort();
}

/**
 * Paints this expedition's blooms into the map's tiles and returns the rooms that actually took
 * one. A room whose every candidate run was illegal is NOT returned, so no surface can promise a
 * bloom a room did not grow.
 */
export function applyAmbientBloom(map: WorldMap, expeditionOrdinal: number): string[] {
  const bloomed: string[] = [];
  for (const key of resolveBloomedSectorKeys(map, expeditionOrdinal)) {
    const sector = map.sectors.get(key);
    if (!sector) continue;
    if (stampBloomStrips(sector, map.seed, expeditionOrdinal) > 0) bloomed.push(key);
  }
  return bloomed;
}

function stampBloomStrips(sector: SectorDef, worldSeed: number, ordinal: number): number {
  const blocked = protectedTileIndices(sector);
  const rng = mulberry32(hashStringToSeed(
    `ambientBloomStrips:${worldSeed}:${ordinal}:${sector.key}`));
  let painted = 0;
  for (let strip = 0; strip < BLOOM_STRIPS_PER_SECTOR; strip++) {
    for (let attempt = 0; attempt < BLOOM_PLACEMENT_ATTEMPTS; attempt++) {
      // The same search box stampHazardStrips uses, so a bloom can never land on the border ring.
      const tileX = 2 + Math.floor(rng() * (SECTOR_TILE_COLS - 6));
      const tileY = 2 + Math.floor(rng() * (SECTOR_TILE_ROWS - 4));
      if (!isBloomRunLegal(sector.tiles, tileX, tileY, blocked)) continue;
      for (let offsetX = 0; offsetX < STRIP_WIDTH; offsetX++) {
        sector.tiles[tileIndex(tileX + offsetX, tileY)] = TileKind.HazardFloor;
      }
      painted += 1;
      break;
    }
  }
  return painted;
}

function protectedTileIndices(sector: SectorDef): Set<number> {
  const blocked = new Set<number>();
  const block = (tileX: number, tileY: number): void => {
    for (let y = tileY - BLOOM_PROTECT_RADIUS; y <= tileY + BLOOM_PROTECT_RADIUS; y++) {
      for (let x = tileX - BLOOM_PROTECT_RADIUS; x <= tileX + BLOOM_PROTECT_RADIUS; x++) {
        if (x < 0 || x >= SECTOR_TILE_COLS || y < 0 || y >= SECTOR_TILE_ROWS) continue;
        blocked.add(tileIndex(x, y));
      }
    }
  };
  for (const slot of sector.poiSlots) block(slot.tileX, slot.tileY);
  for (const entry of Object.values(sector.entryTiles)) {
    if (entry) block(entry.tileX, entry.tileY);
  }
  return blocked;
}

/**
 * The Open-only rule is what protects every other pass's work without naming any of them: a
 * breakable pocket, a secret shell, a void gap, a shrine fence, a corridor grid band and a closed
 * gate are all non-Open, so none can be overwritten and none needs its own clause here.
 */
function isBloomRunLegal(
  tiles: Uint8Array, tileX: number, tileY: number, blocked: ReadonlySet<number>,
): boolean {
  for (let offsetX = 0; offsetX < STRIP_WIDTH; offsetX++) {
    const x = tileX + offsetX;
    if (x >= SECTOR_TILE_COLS) return false;
    const index = tileIndex(x, tileY);
    if (tiles[index] !== TileKind.Open) return false;
    if (blocked.has(index)) return false;
  }
  return true;
}
