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
import { countReached, floodInterior } from './sectorInterior';
import {
  EDGE_DIRECTIONS, SECTOR_TILE_COLS, SECTOR_TILE_ROWS, TileKind, tileIndex,
} from './worldTypes';
import type { SectorDef, TileCoord, WorldMap } from './worldTypes';

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

/** Rooms whose walls shift per expedition, on the bloom's own reasoning: enough that a returning
 *  player meets one without hunting, few enough that it still reads as a change. */
export const SHIFTED_SECTORS_PER_EXPEDITION = 3;

/** Runs of rock a shifted room opens into floor, then runs of floor it drops rubble across. The
 *  seam pass runs FIRST and that ordering is the design: a pinch that was a room's only route can
 *  legally take rubble once the seam has opened an alternate, so the pair re-routes a room instead
 *  of only decorating it. */
export const BREACH_RUNS_PER_SECTOR = 2;
export const COLLAPSE_RUNS_PER_SECTOR = 3;

/** Same 2-tile run the generator falls back to for a breakable pocket, so a shifted room's new
 *  geometry is shaped like geometry the player has already learned to read. */
const SHIFT_RUN_LENGTH = 2;

const SHIFT_PLACEMENT_ATTEMPTS = 24;

/**
 * The rooms an ambient pass touches, sorted, with no side effect. Separate from the appliers so a
 * caller that only needs the names never mutates a map.
 *
 * The hangar, the boss arena and hidden rooms are never picked: the hangar is the one room a recall
 * guarantees is safe, the arena's floor is scripted by its own seal, and a hidden room's first
 * entry is already its own event.
 */
function pickStirredSectorKeys(
  map: WorldMap, salt: string, expeditionOrdinal: number, count: number,
): string[] {
  // Sorted before the draw: Map iteration order must never reach a result the save has to agree
  // with across a refresh.
  const eligible = [...map.sectors.values()]
    .filter(sector => sector.hidden !== true && !sector.isStart && !sector.isBossArena)
    .map(sector => sector.key)
    .sort();
  const rng = mulberry32(hashStringToSeed(
    `${salt}:${map.seed}:${map.worldGenVersion}:${expeditionOrdinal}`));
  const picked: string[] = [];
  const drawn = Math.min(count, eligible.length);
  for (let index = 0; index < drawn; index++) {
    picked.push(eligible.splice(Math.floor(rng() * eligible.length), 1)[0]);
  }
  return picked.sort();
}

export function resolveBloomedSectorKeys(map: WorldMap, expeditionOrdinal: number): string[] {
  return pickStirredSectorKeys(
    map, 'ambientBloom', expeditionOrdinal, BLOOMED_SECTORS_PER_EXPEDITION);
}

/** Rooms whose walls shift this expedition. Its own draw rather than the bloom's, so twice as much
 *  of the world stirs; a room that lands in both prints both clauses. */
export function resolveShiftedSectorKeys(map: WorldMap, expeditionOrdinal: number): string[] {
  return pickStirredSectorKeys(
    map, 'ambientShift', expeditionOrdinal, SHIFTED_SECTORS_PER_EXPEDITION);
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

/**
 * Opens seams of rock and drops rubble in this expedition's shifted rooms, and returns the rooms
 * that actually changed. A room whose every candidate run was illegal or unprovable is NOT
 * returned, so no surface can promise a shift a room did not take.
 *
 * Rubble is TileKind.Solid and never TileKind.Breakable: a breakable needs a BreakableRect id, and
 * ids have to agree with WorldProfileStore.brokenBreakableIds, a per-profile memory that outlives
 * the expedition ordinal. Solid rubble has no id and is persisted nowhere.
 */
export function applyAmbientShift(map: WorldMap, expeditionOrdinal: number): string[] {
  const shifted: string[] = [];
  for (const key of resolveShiftedSectorKeys(map, expeditionOrdinal)) {
    const sector = map.sectors.get(key);
    if (!sector) continue;
    if (stampShift(sector, map.seed, expeditionOrdinal)) shifted.push(key);
  }
  return shifted;
}

function stampShift(sector: SectorDef, worldSeed: number, ordinal: number): boolean {
  let floodSeed: TileCoord | undefined;
  for (const direction of EDGE_DIRECTIONS) {
    const entry = sector.entryTiles[direction];
    if (entry) { floodSeed = entry; break; }
  }
  if (!floodSeed) return false;

  const blocked = protectedTileIndices(sector);
  const rng = mulberry32(hashStringToSeed(
    `ambientShift:${worldSeed}:${ordinal}:${sector.key}`));
  let changed = false;
  changed = stampRuns(sector, floodSeed, blocked, rng, BREACH_RUNS_PER_SECTOR,
    TileKind.Solid, TileKind.Open) || changed;
  changed = stampRuns(sector, floodSeed, blocked, rng, COLLAPSE_RUNS_PER_SECTOR,
    TileKind.Open, TileKind.Solid) || changed;
  return changed;
}

function stampRuns(
  sector: SectorDef,
  floodSeed: TileCoord,
  blocked: ReadonlySet<number>,
  rng: () => number,
  runs: number,
  fromKind: number,
  toKind: number,
): boolean {
  const delta = toKind === TileKind.Open ? SHIFT_RUN_LENGTH : -SHIFT_RUN_LENGTH;
  let changed = false;
  for (let run = 0; run < runs; run++) {
    // Recomputed per run, never hoisted: a failed attempt is fully reverted, so the tiles this
    // measures are the tiles the next attempt writes over.
    const reachedBefore = floodInterior(sector.tiles, floodSeed);
    for (let attempt = 0; attempt < SHIFT_PLACEMENT_ATTEMPTS; attempt++) {
      const vertical = rng() < 0.5;
      const tileX = 2 + Math.floor(rng() * (SECTOR_TILE_COLS - 4));
      const tileY = 2 + Math.floor(rng() * (SECTOR_TILE_ROWS - 4));
      const indices = shiftRunIndices(sector.tiles, tileX, tileY, vertical, fromKind, blocked);
      if (!indices) continue;
      for (const index of indices) sector.tiles[index] = toKind;
      if (shiftHoldsUp(sector, floodSeed, reachedBefore, delta)) { changed = true; break; }
      for (const index of indices) sector.tiles[index] = fromKind;
    }
  }
  return changed;
}

/**
 * The run's tile indices when every cell is legal, else null. The single-kind rule is what protects
 * every other pass's work without naming any of them: a breakable pocket, a secret shell, a void
 * gap, a shrine fence, a corridor grid band, a closed gate and bloomed ground are none of them the
 * kind this pass reads, so none can be overwritten and none needs its own clause here.
 */
function shiftRunIndices(
  tiles: Uint8Array,
  tileX: number,
  tileY: number,
  vertical: boolean,
  fromKind: number,
  blocked: ReadonlySet<number>,
): number[] | null {
  const indices: number[] = [];
  for (let offset = 0; offset < SHIFT_RUN_LENGTH; offset++) {
    const x = vertical ? tileX : tileX + offset;
    const y = vertical ? tileY + offset : tileY;
    // Two tiles of margin, so a seam can never breach the room's outer wall into the void between
    // sectors and rubble can never land on the border ring.
    if (x < 2 || x > SECTOR_TILE_COLS - 3) return null;
    if (y < 2 || y > SECTOR_TILE_ROWS - 3) return null;
    const index = tileIndex(x, y);
    if (tiles[index] !== fromKind) return null;
    if (blocked.has(index)) return null;
    indices.push(index);
  }
  return indices;
}

/**
 * Whether a run already written to the sector changed reachability by exactly the tiles it wrote
 * and nothing else. The exact count is the proof, on sealHoldsUp's own reasoning: a spot check
 * would pass a seam that also connected a sealed secret pocket, or rubble that also orphaned a
 * corridor, and either is a run the player cannot finish.
 */
function shiftHoldsUp(
  sector: SectorDef,
  floodSeed: TileCoord,
  reachedBefore: Uint8Array,
  expectedDelta: number,
): boolean {
  const reachedAfter = floodInterior(sector.tiles, floodSeed);
  if (countReached(reachedAfter) !== countReached(reachedBefore) + expectedDelta) return false;
  for (const direction of EDGE_DIRECTIONS) {
    const entry = sector.entryTiles[direction];
    if (entry && reachedAfter[tileIndex(entry.tileX, entry.tileY)] !== 1) return false;
  }
  for (const slot of sector.poiSlots) {
    const index = tileIndex(slot.tileX, slot.tileY);
    if (reachedBefore[index] === 1 && reachedAfter[index] !== 1) return false;
  }
  return true;
}
