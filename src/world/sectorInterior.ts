/**
 * sectorInterior — one sector's 32x18 tile grid, and the only place tiles are
 * ever written.
 *
 * Every pass after the connectivity repair is either carve-only or
 * passability-neutral, so a decoration pass can never strand an entry tile or a
 * POI behind geometry that appeared after the grid was proven connected. That
 * ordering is the whole reason this module exists as one function rather than a
 * pipeline a caller composes.
 */

import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';
import type { SeededRng } from '../utils/dailySeed';
import { buildSecretPuzzle } from './secretPuzzles';
import {
  EDGE_DIRECTIONS,
  EdgeKind,
  PoiKind,
  SECTOR_TILE_COLS,
  SECTOR_TILE_COUNT,
  SECTOR_TILE_ROWS,
  TileKind,
  tileIndex,
} from './worldTypes';
import type {
  BreakableRect,
  EdgeDef,
  EdgeDirection,
  PoiSlot,
  TileCoord,
} from './worldTypes';

export type InteriorTemplate =
  | 'openField' | 'pillarGrid' | 'corridorPinch' | 'cavern' | 'arenaRing';

export interface SectorInteriorInput {
  rng: SeededRng;
  sx: number;
  sy: number;
  edges: Record<EdgeDirection, EdgeDef>;
  biomeId: string;
  danger: number;
  isStart: boolean;
  isBossArena: boolean;
  /** Ability ids this sector must host an AbilityPowerUp slot for, in order. */
  grantedAbilityIds: string[];
  /** WorldMap.seed. Only the secret-sealing pass reads it, and only through its own hash, so
   *  it never touches the sector rng stream. */
  worldSeed: number;
  /** SectorDef.depth. Passed through to buildSecretPuzzle's share draw. */
  depth: number;
}

export interface SectorInteriorResult {
  tiles: Uint8Array;
  entryTiles: Partial<Record<EdgeDirection, TileCoord>>;
  poiSlots: PoiSlot[];
  breakables: BreakableRect[];
}

const INTERIOR_MIN_X = 1;
const INTERIOR_MAX_X = SECTOR_TILE_COLS - 2;
const INTERIOR_MIN_Y = 1;
const INTERIOR_MAX_Y = SECTOR_TILE_ROWS - 2;

const POI_MIN_SEPARATION = 3;
const POI_PLACEMENT_ATTEMPTS = 30;
const DECORATION_ATTEMPTS = 20;
const BOSS_MIN_OPEN_TILES = Math.ceil(0.65 * SECTOR_TILE_COUNT);

/** Share of the caches no sigil ring already seals that hide behind a false wall instead.
 *  Measured over 101 worlds the three find-shapes land at 47% walk-in, 29% ring, 23% wall:
 *  a quarter of the selected candidates are rejected by the footprint and flood guards below. */
const SECRET_WALL_SHARE_PERCENT = 45;
const SECRET_SHELL_RADIUS = 2;

const RANDOM_POI_KINDS: readonly PoiKind[] = [
  PoiKind.QuestGiver, PoiKind.Secret, PoiKind.Treasure, PoiKind.Shrine,
];

export function buildSectorInterior(input: SectorInteriorInput): SectorInteriorResult {
  const { rng, sx, sy, edges, isBossArena } = input;
  const tiles = new Uint8Array(SECTOR_TILE_COUNT);

  applyTemplate(tiles, pickTemplate(input), rng);
  stampBorderRing(tiles);
  const apertureTileIndices = stampApertures(tiles, edges);
  const entryTiles = computeEntryTiles(edges);

  const poiSlots = placePoiSlots(input, entryTiles);
  const protectedTileIndices = new Set<number>();
  for (const slot of poiSlots) {
    openNeighbourhood(tiles, slot.tileX, slot.tileY, protectedTileIndices);
  }
  for (const direction of EDGE_DIRECTIONS) {
    const entry = entryTiles[direction];
    if (entry) openNeighbourhood(tiles, entry.tileX, entry.tileY, protectedTileIndices);
  }

  repairInteriorConnectivity(tiles, entryTiles, poiSlots);

  if (isBossArena) openBossFloor(tiles);

  const breakables = isBossArena ? [] : carveBreakablePockets(tiles, rng, sx, sy);
  if (input.danger >= 0.3) {
    stampHazardStrips(tiles, rng, input.danger, protectedTileIndices, apertureTileIndices);
  }
  // LAST, and it draws no rng from `rng`: anything after it that reads tiles would start
  // taking different branches on the same rolls, which moves every existing world.
  if (!isBossArena) {
    sealSecretCaches(tiles, poiSlots, breakables, entryTiles,
      apertureTileIndices, protectedTileIndices, input);
  }

  return { tiles, entryTiles, poiSlots, breakables };
}

function clampedIndex(roll: number, length: number): number {
  // A stubbed rng may legally return 1, which Math.random never does.
  return Math.min(length - 1, Math.floor(roll * length));
}

function pickTemplate(input: SectorInteriorInput): InteriorTemplate {
  if (input.isBossArena) return 'arenaRing';
  if (input.isStart) return 'openField';
  if (input.biomeId === 'stage_crystal_caves' || input.biomeId === 'stage_verdant_rot') {
    return 'cavern';
  }
  if (input.danger < 0.25) return 'openField';
  const pair: InteriorTemplate[] = ['pillarGrid', 'corridorPinch'];
  return pair[clampedIndex(input.rng(), pair.length)];
}

function applyTemplate(tiles: Uint8Array, template: InteriorTemplate, rng: SeededRng): void {
  switch (template) {
    case 'openField': return applyOpenField(tiles, rng);
    case 'pillarGrid': return applyPillarGrid(tiles, rng);
    case 'corridorPinch': return applyCorridorPinch(tiles, rng);
    case 'cavern': return applyCavern(tiles, rng);
    case 'arenaRing': return;
  }
}

function applyOpenField(tiles: Uint8Array, rng: SeededRng): void {
  const blobCount = 2 + Math.floor(rng() * 3);
  for (let blob = 0; blob < blobCount; blob++) {
    const tileX = 2 + Math.floor(rng() * (SECTOR_TILE_COLS - 5));
    const tileY = 2 + Math.floor(rng() * (SECTOR_TILE_ROWS - 5));
    stampRect(tiles, tileX, tileY, 2, 2, TileKind.Solid);
  }
}

function applyPillarGrid(tiles: Uint8Array, rng: SeededRng): void {
  for (let tileY = 3; tileY <= SECTOR_TILE_ROWS - 3; tileY += 4) {
    for (let tileX = 3; tileX <= SECTOR_TILE_COLS - 5; tileX += 4) {
      if (rng() < 0.6) stampRect(tiles, tileX, tileY, 2, 2, TileKind.Solid);
    }
  }
}

function applyCorridorPinch(tiles: Uint8Array, rng: SeededRng): void {
  const columns = [10, 21];
  for (const tileX of columns) {
    stampRect(tiles, tileX, 0, 1, SECTOR_TILE_ROWS, TileKind.Solid);
  }
  for (const tileX of columns) {
    const gapStart = 1 + Math.floor(rng() * (SECTOR_TILE_ROWS - 5));
    stampRect(tiles, tileX, gapStart, 1, 4, TileKind.Open);
  }
}

function applyCavern(tiles: Uint8Array, rng: SeededRng): void {
  for (let index = 0; index < SECTOR_TILE_COUNT; index++) {
    tiles[index] = rng() < 0.42 ? TileKind.Solid : TileKind.Open;
  }
  for (let pass = 0; pass < 2; pass++) {
    const snapshot = Uint8Array.from(tiles);
    for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) {
      for (let tileX = 0; tileX < SECTOR_TILE_COLS; tileX++) {
        tiles[tileIndex(tileX, tileY)] =
          countSolidNeighbours(snapshot, tileX, tileY) >= 5 ? TileKind.Solid : TileKind.Open;
      }
    }
  }
}

function countSolidNeighbours(snapshot: Uint8Array, tileX: number, tileY: number): number {
  let solid = 0;
  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (offsetX === 0 && offsetY === 0) continue;
      const neighbourX = tileX + offsetX;
      const neighbourY = tileY + offsetY;
      const outOfBounds =
        neighbourX < 0 || neighbourX >= SECTOR_TILE_COLS ||
        neighbourY < 0 || neighbourY >= SECTOR_TILE_ROWS;
      if (outOfBounds || snapshot[tileIndex(neighbourX, neighbourY)] === TileKind.Solid) solid++;
    }
  }
  return solid;
}

function stampRect(
  tiles: Uint8Array, tileX: number, tileY: number, tileW: number, tileH: number, kind: TileKind
): void {
  for (let offsetY = 0; offsetY < tileH; offsetY++) {
    for (let offsetX = 0; offsetX < tileW; offsetX++) {
      const x = tileX + offsetX;
      const y = tileY + offsetY;
      if (x < 0 || x >= SECTOR_TILE_COLS || y < 0 || y >= SECTOR_TILE_ROWS) continue;
      tiles[tileIndex(x, y)] = kind;
    }
  }
}

function stampBorderRing(tiles: Uint8Array): void {
  for (let tileX = 0; tileX < SECTOR_TILE_COLS; tileX++) {
    tiles[tileIndex(tileX, 0)] = TileKind.Solid;
    tiles[tileIndex(tileX, SECTOR_TILE_ROWS - 1)] = TileKind.Solid;
  }
  for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) {
    tiles[tileIndex(0, tileY)] = TileKind.Solid;
    tiles[tileIndex(SECTOR_TILE_COLS - 1, tileY)] = TileKind.Solid;
  }
}

/** Sector-local tile of an aperture cell, `depth` tiles in from the border ring. */
export function apertureTileAt(
  direction: EdgeDirection, axisIndex: number, depth: number
): TileCoord {
  switch (direction) {
    case 'north': return { tileX: axisIndex, tileY: depth };
    case 'south': return { tileX: axisIndex, tileY: SECTOR_TILE_ROWS - 1 - depth };
    case 'west': return { tileX: depth, tileY: axisIndex };
    case 'east': return { tileX: SECTOR_TILE_COLS - 1 - depth, tileY: axisIndex };
  }
}

function apertureMouthTile(kind: EdgeKind): TileKind {
  if (kind === EdgeKind.Open) return TileKind.Open;
  if (kind === EdgeKind.Breakable) return TileKind.Breakable;
  return TileKind.GateClosed;
}

function stampApertures(tiles: Uint8Array, edges: Record<EdgeDirection, EdgeDef>): Set<number> {
  const apertureTileIndices = new Set<number>();
  for (const direction of EDGE_DIRECTIONS) {
    const edge = edges[direction];
    if (edge.kind === EdgeKind.Wall) continue;
    for (let axisIndex = edge.apertureStart; axisIndex <= edge.apertureEnd; axisIndex++) {
      for (let depth = 0; depth <= 2; depth++) {
        const { tileX, tileY } = apertureTileAt(direction, axisIndex, depth);
        const index = tileIndex(tileX, tileY);
        tiles[index] = depth === 0 ? apertureMouthTile(edge.kind) : TileKind.Open;
        apertureTileIndices.add(index);
      }
    }
  }
  return apertureTileIndices;
}

function computeEntryTiles(
  edges: Record<EdgeDirection, EdgeDef>
): Partial<Record<EdgeDirection, TileCoord>> {
  const entryTiles: Partial<Record<EdgeDirection, TileCoord>> = {};
  for (const direction of EDGE_DIRECTIONS) {
    const edge = edges[direction];
    if (edge.kind === EdgeKind.Wall) continue;
    const mid = Math.floor((edge.apertureStart + edge.apertureEnd) / 2);
    entryTiles[direction] = apertureTileAt(direction, mid, 2);
  }
  return entryTiles;
}

function placePoiSlots(
  input: SectorInteriorInput, entryTiles: Partial<Record<EdgeDirection, TileCoord>>
): PoiSlot[] {
  const { rng, sx, sy } = input;

  const requests: { kind: PoiKind; grantsAbilityId?: string }[] =
    input.grantedAbilityIds.map(abilityId => ({
      kind: PoiKind.AbilityPowerUp,
      grantsAbilityId: abilityId,
    }));

  const randomCount = 1 + Math.floor(rng() * 3);
  for (let slot = 0; slot < randomCount; slot++) {
    requests.push({ kind: RANDOM_POI_KINDS[clampedIndex(rng(), RANDOM_POI_KINDS.length)] });
  }

  const blocked: TileCoord[] = [];
  for (const direction of EDGE_DIRECTIONS) {
    const entry = entryTiles[direction];
    if (entry) blocked.push(entry);
  }

  const placed: PoiSlot[] = [];
  for (const request of requests) {
    const tile = pickPoiTile(rng, blocked);
    if (!tile) continue;
    blocked.push(tile);
    placed.push({
      id: `poi:${sx},${sy}:${placed.length}`,
      kind: request.kind,
      tileX: tile.tileX,
      tileY: tile.tileY,
      ...(request.grantsAbilityId !== undefined
        ? { grantsAbilityId: request.grantsAbilityId }
        : {}),
    });
  }
  return placed;
}

function pickPoiTile(rng: SeededRng, blocked: TileCoord[]): TileCoord | null {
  for (let attempt = 0; attempt < POI_PLACEMENT_ATTEMPTS; attempt++) {
    const tileX = 2 + Math.floor(rng() * (SECTOR_TILE_COLS - 4));
    const tileY = 2 + Math.floor(rng() * (SECTOR_TILE_ROWS - 4));
    if (isPoiTileLegal(tileX, tileY, blocked)) return { tileX, tileY };
  }
  for (let index = 0; index < SECTOR_TILE_COUNT; index++) {
    const tileX = index % SECTOR_TILE_COLS;
    const tileY = Math.floor(index / SECTOR_TILE_COLS);
    if (isPoiTileLegal(tileX, tileY, blocked)) return { tileX, tileY };
  }
  return null;
}

function isPoiTileLegal(tileX: number, tileY: number, blocked: TileCoord[]): boolean {
  if (tileX < 2 || tileX > SECTOR_TILE_COLS - 3) return false;
  if (tileY < 2 || tileY > SECTOR_TILE_ROWS - 3) return false;
  return blocked.every(other =>
    Math.max(Math.abs(other.tileX - tileX), Math.abs(other.tileY - tileY)) >= POI_MIN_SEPARATION
  );
}

function openNeighbourhood(
  tiles: Uint8Array, tileX: number, tileY: number, touched: Set<number>
): void {
  for (let y = Math.max(INTERIOR_MIN_Y, tileY - 1); y <= Math.min(INTERIOR_MAX_Y, tileY + 1); y++) {
    for (let x = Math.max(INTERIOR_MIN_X, tileX - 1); x <= Math.min(INTERIOR_MAX_X, tileX + 1); x++) {
      const index = tileIndex(x, y);
      tiles[index] = TileKind.Open;
      touched.add(index);
    }
  }
}

function isPassable(kind: number): boolean {
  return kind === TileKind.Open || kind === TileKind.HazardFloor;
}

function floodInterior(tiles: Uint8Array, seed: TileCoord): Uint8Array {
  const reached = new Uint8Array(SECTOR_TILE_COUNT);
  const seedIndex = tileIndex(seed.tileX, seed.tileY);
  if (!isPassable(tiles[seedIndex])) return reached;

  reached[seedIndex] = 1;
  const queue: number[] = [seedIndex];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const tileX = index % SECTOR_TILE_COLS;
    const tileY = Math.floor(index / SECTOR_TILE_COLS);
    const neighbours: TileCoord[] = [
      { tileX, tileY: tileY - 1 },
      { tileX: tileX + 1, tileY },
      { tileX, tileY: tileY + 1 },
      { tileX: tileX - 1, tileY },
    ];
    for (const neighbour of neighbours) {
      if (neighbour.tileX < 0 || neighbour.tileX >= SECTOR_TILE_COLS) continue;
      if (neighbour.tileY < 0 || neighbour.tileY >= SECTOR_TILE_ROWS) continue;
      const neighbourIndex = tileIndex(neighbour.tileX, neighbour.tileY);
      if (reached[neighbourIndex] || !isPassable(tiles[neighbourIndex])) continue;
      reached[neighbourIndex] = 1;
      queue.push(neighbourIndex);
    }
  }
  return reached;
}

function repairInteriorConnectivity(
  tiles: Uint8Array,
  entryTiles: Partial<Record<EdgeDirection, TileCoord>>,
  poiSlots: PoiSlot[]
): void {
  const targets: TileCoord[] = [];
  for (const direction of EDGE_DIRECTIONS) {
    const entry = entryTiles[direction];
    if (entry) targets.push(entry);
  }
  for (const slot of poiSlots) targets.push({ tileX: slot.tileX, tileY: slot.tileY });

  let seed = targets[0];
  if (!seed) {
    seed = { tileX: SECTOR_TILE_COLS >> 1, tileY: SECTOR_TILE_ROWS >> 1 };
    tiles[tileIndex(seed.tileX, seed.tileY)] = TileKind.Open;
    targets.push(seed);
  }

  let reached = floodInterior(tiles, seed);
  for (const target of targets) {
    if (reached[tileIndex(target.tileX, target.tileY)]) continue;
    const anchor = nearestReachedInteriorTile(reached, target);
    if (!anchor) continue;
    carveL(tiles, target, anchor);
    reached = floodInterior(tiles, seed);
  }
}

function nearestReachedInteriorTile(reached: Uint8Array, target: TileCoord): TileCoord | null {
  let best: TileCoord | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let tileY = INTERIOR_MIN_Y; tileY <= INTERIOR_MAX_Y; tileY++) {
    for (let tileX = INTERIOR_MIN_X; tileX <= INTERIOR_MAX_X; tileX++) {
      if (!reached[tileIndex(tileX, tileY)]) continue;
      const distance = Math.abs(tileX - target.tileX) + Math.abs(tileY - target.tileY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { tileX, tileY };
      }
    }
  }
  return best;
}

function carveL(tiles: Uint8Array, from: TileCoord, to: TileCoord): void {
  const stepX = Math.sign(to.tileX - from.tileX);
  for (let tileX = from.tileX; ; tileX += stepX) {
    carveTile(tiles, tileX, from.tileY);
    if (stepX === 0 || tileX === to.tileX) break;
  }
  const stepY = Math.sign(to.tileY - from.tileY);
  for (let tileY = from.tileY; ; tileY += stepY) {
    carveTile(tiles, to.tileX, tileY);
    if (stepY === 0 || tileY === to.tileY) break;
  }
}

function carveTile(tiles: Uint8Array, tileX: number, tileY: number): void {
  if (tileX < INTERIOR_MIN_X || tileX > INTERIOR_MAX_X) return;
  if (tileY < INTERIOR_MIN_Y || tileY > INTERIOR_MAX_Y) return;
  const index = tileIndex(tileX, tileY);
  if (tiles[index] === TileKind.Solid) tiles[index] = TileKind.Open;
}

function openBossFloor(tiles: Uint8Array): void {
  let nonSolid = 0;
  for (let index = 0; index < SECTOR_TILE_COUNT; index++) {
    if (tiles[index] !== TileKind.Solid) nonSolid++;
  }
  for (let index = 0; index < SECTOR_TILE_COUNT && nonSolid < BOSS_MIN_OPEN_TILES; index++) {
    if (tiles[index] !== TileKind.Solid) continue;
    const tileX = index % SECTOR_TILE_COLS;
    const tileY = Math.floor(index / SECTOR_TILE_COLS);
    if (isBorderTile(tileX, tileY)) continue;
    tiles[index] = TileKind.Open;
    nonSolid++;
  }
}

function isBorderTile(tileX: number, tileY: number): boolean {
  return tileX === 0 || tileX === SECTOR_TILE_COLS - 1
    || tileY === 0 || tileY === SECTOR_TILE_ROWS - 1;
}

function carveBreakablePockets(
  tiles: Uint8Array, rng: SeededRng, sx: number, sy: number
): BreakableRect[] {
  const pockets: BreakableRect[] = [];
  const pocketCount = 1 + Math.floor(rng() * 2);
  for (let pocket = 0; pocket < pocketCount; pocket++) {
    if (tryCarvePocket(tiles, rng, sx, sy, pockets, 2, 2)) continue;
    // Open templates rarely hold a 2x2 all-Solid rect, which is why the dev seed
    // yielded 5 pockets across 48 sectors. A 2x1 slab in a pillar or wall face is
    // common, and converting Solid to Breakable can never block a path.
    if (tryCarvePocket(tiles, rng, sx, sy, pockets, 2, 1)) continue;
    tryCarvePocket(tiles, rng, sx, sy, pockets, 1, 2);
  }
  return pockets;
}

function tryCarvePocket(
  tiles: Uint8Array, rng: SeededRng, sx: number, sy: number,
  pockets: BreakableRect[], tileW: number, tileH: number
): boolean {
  for (let attempt = 0; attempt < DECORATION_ATTEMPTS; attempt++) {
    const tileX = 2 + Math.floor(rng() * (SECTOR_TILE_COLS - 3 - tileW));
    const tileY = 2 + Math.floor(rng() * (SECTOR_TILE_ROWS - 3 - tileH));
    if (!isRectAll(tiles, tileX, tileY, tileW, tileH, TileKind.Solid)) continue;
    stampRect(tiles, tileX, tileY, tileW, tileH, TileKind.Breakable);
    pockets.push({
      id: `breakable:${sx},${sy}:${pockets.length}`,
      tileX, tileY, tileW, tileH,
    });
    return true;
  }
  return false;
}

function isRectAll(
  tiles: Uint8Array, tileX: number, tileY: number, tileW: number, tileH: number, kind: TileKind
): boolean {
  for (let offsetY = 0; offsetY < tileH; offsetY++) {
    for (let offsetX = 0; offsetX < tileW; offsetX++) {
      const x = tileX + offsetX;
      const y = tileY + offsetY;
      if (x < 0 || x >= SECTOR_TILE_COLS || y < 0 || y >= SECTOR_TILE_ROWS) return false;
      if (tiles[tileIndex(x, y)] !== kind) return false;
    }
  }
  return true;
}

function stampHazardStrips(
  tiles: Uint8Array,
  rng: SeededRng,
  danger: number,
  protectedTileIndices: Set<number>,
  apertureTileIndices: Set<number>
): void {
  // Deep sectors always carry at least one strip; the shallow band (0.3-0.5) keeps the
  // old coin flip so hazards ramp in rather than appearing everywhere at once.
  const stripCount = danger >= 0.5 ? 1 + Math.floor(rng() * 2) : Math.floor(rng() * 2);
  for (let strip = 0; strip < stripCount; strip++) {
    for (let attempt = 0; attempt < DECORATION_ATTEMPTS; attempt++) {
      const tileX = 2 + Math.floor(rng() * (SECTOR_TILE_COLS - 6));
      const tileY = 2 + Math.floor(rng() * (SECTOR_TILE_ROWS - 4));
      if (!isHazardRunLegal(tiles, tileX, tileY, protectedTileIndices, apertureTileIndices)) {
        continue;
      }
      stampRect(tiles, tileX, tileY, 3, 1, TileKind.HazardFloor);
      break;
    }
  }
}

function isHazardRunLegal(
  tiles: Uint8Array,
  tileX: number,
  tileY: number,
  protectedTileIndices: Set<number>,
  apertureTileIndices: Set<number>
): boolean {
  for (let offsetX = 0; offsetX < 3; offsetX++) {
    const x = tileX + offsetX;
    if (x >= SECTOR_TILE_COLS) return false;
    const index = tileIndex(x, tileY);
    if (tiles[index] !== TileKind.Open) return false;
    if (protectedTileIndices.has(index) || apertureTileIndices.has(index)) return false;
  }
  return true;
}

/** The 16 ring cells two tiles out from a cache, as tile indices. A legal POI tile is always
 *  2..cols-3 by 2..rows-3, so a real slot always yields 16; a hand-built SectorDef may not. */
export function secretShellRingIndices(tileX: number, tileY: number): number[] {
  const indices: number[] = [];
  for (let offsetY = -SECRET_SHELL_RADIUS; offsetY <= SECRET_SHELL_RADIUS; offsetY++) {
    for (let offsetX = -SECRET_SHELL_RADIUS; offsetX <= SECRET_SHELL_RADIUS; offsetX++) {
      if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== SECRET_SHELL_RADIUS) continue;
      const x = tileX + offsetX;
      const y = tileY + offsetY;
      if (x < 0 || x >= SECTOR_TILE_COLS || y < 0 || y >= SECTOR_TILE_ROWS) continue;
      indices.push(tileIndex(x, y));
    }
  }
  return indices;
}

/** The 3x3 pocket a shell encloses, as tile indices. */
function secretPocketIndices(tileX: number, tileY: number): number[] {
  const indices: number[] = [];
  for (let y = tileY - 1; y <= tileY + 1; y++) {
    for (let x = tileX - 1; x <= tileX + 1; x++) {
      if (x < 0 || x >= SECTOR_TILE_COLS || y < 0 || y >= SECTOR_TILE_ROWS) continue;
      indices.push(tileIndex(x, y));
    }
  }
  return indices;
}

/** True while every ring cell still blocks: one broken cell is the way in. Takes precomputed
 *  indices so a caller can read it every frame without allocating. */
export function isSecretShellIntact(
  tiles: Uint8Array, ringIndices: readonly number[]
): boolean {
  return ringIndices.every(index => !isPassable(tiles[index]));
}

/**
 * Rings some of a sector's cache slots with breakable tiles, so the cache has to be broken
 * into rather than drifted past (doc 04 section 5 taxonomy row 1).
 *
 * Deliberately best-effort and silent about it: a slot whose footprint reaches an aperture
 * band or a neighbouring slot's cleared neighbourhood, whose ring a hazard strip crosses, or
 * whose seal would strand anything stays an ordinary walk-in. Sealing 100% of a share is worth
 * less than the guarantee that nothing is ever cut off, and a rejected slot is still a cache.
 *
 * Consumes no rng from the sector stream (see buildSectorInterior) and converts only passable
 * tiles, never Solid: turning rock breakable would open a route the gate-order invariants
 * proved did not exist.
 */
function sealSecretCaches(
  tiles: Uint8Array,
  poiSlots: PoiSlot[],
  breakables: BreakableRect[],
  entryTiles: Partial<Record<EdgeDirection, TileCoord>>,
  apertureTileIndices: Set<number>,
  protectedTileIndices: Set<number>,
  input: SectorInteriorInput,
): void {
  let floodSeed: TileCoord | undefined;
  for (const direction of EDGE_DIRECTIONS) {
    const entry = entryTiles[direction];
    if (entry) { floodSeed = entry; break; }
  }
  if (!floodSeed) return;

  for (const slot of poiSlots) {
    if (slot.kind !== PoiKind.Secret) continue;
    if (buildSecretPuzzle({
      worldSeed: input.worldSeed, secretId: slot.id, depth: input.depth,
    }) !== null) continue;
    const shareRng = mulberry32(hashStringToSeed(`secretWall:${input.worldSeed}:${slot.id}`));
    if (shareRng() * 100 >= SECRET_WALL_SHARE_PERCENT) continue;

    const ringIndices = secretShellRingIndices(slot.tileX, slot.tileY);
    const pocketIndices = secretPocketIndices(slot.tileX, slot.tileY);
    if (ringIndices.length !== 16 || pocketIndices.length !== 9) continue;
    if (ringIndices.some(index => apertureTileIndices.has(index))) continue;
    if (pocketIndices.some(index => apertureTileIndices.has(index))) continue;
    // The ring sits two tiles out, so it never reaches this cache's own cleared neighbourhood,
    // but it can reach a neighbouring slot's or an entry tile's, and those must stay walkable
    // (invariant 6). Same guard isHazardRunLegal uses, for the same reason.
    if (ringIndices.some(index => protectedTileIndices.has(index))) continue;
    // A pocket cell already Breakable means an earlier slot's shell reached into this one.
    if (pocketIndices.some(index => tiles[index] !== TileKind.Open)) continue;
    // A hazard strip crossing the ring is a passable gap the seal cannot close.
    if (ringIndices.some(index => tiles[index] === TileKind.HazardFloor)) continue;
    const openRing = ringIndices.filter(index => tiles[index] === TileKind.Open);
    if (openRing.length === 0) continue;

    const reachedBefore = floodInterior(tiles, floodSeed);
    for (const index of openRing) tiles[index] = TileKind.Breakable;
    if (!sealHoldsUp(tiles, floodSeed, reachedBefore, openRing, pocketIndices,
      poiSlots, entryTiles)) {
      for (const index of openRing) tiles[index] = TileKind.Open;
      continue;
    }

    for (const index of openRing) {
      breakables.push({
        id: `breakable:${input.sx},${input.sy}:${breakables.length}`,
        tileX: index % SECTOR_TILE_COLS,
        tileY: Math.floor(index / SECTOR_TILE_COLS),
        tileW: 1,
        tileH: 1,
      });
    }
    slot.sealed = true;
  }
}

/**
 * Whether a seal already written to `tiles` cut off nothing but its own pocket. The exact
 * count is the proof: everything reachable before must still be reachable, minus exactly the
 * ring and the pocket. A spot check would pass a seal that also orphaned a corridor, and the
 * exactness is what makes a shell identical across the plain, quest-door and hidden-sector
 * variants of one seed, which those variants' tests compare rect by rect.
 */
function sealHoldsUp(
  tiles: Uint8Array,
  floodSeed: TileCoord,
  reachedBefore: Uint8Array,
  openRing: readonly number[],
  pocketIndices: readonly number[],
  poiSlots: readonly PoiSlot[],
  entryTiles: Partial<Record<EdgeDirection, TileCoord>>,
): boolean {
  const reachedAfter = floodInterior(tiles, floodSeed);
  const before = countReached(reachedBefore);
  const after = countReached(reachedAfter);
  if (after !== before - openRing.length - pocketIndices.length) return false;
  if (pocketIndices.some(index => reachedAfter[index] === 1)) return false;
  for (const direction of EDGE_DIRECTIONS) {
    const entry = entryTiles[direction];
    if (entry && reachedAfter[tileIndex(entry.tileX, entry.tileY)] !== 1) return false;
  }
  const pocket = new Set(pocketIndices);
  for (const other of poiSlots) {
    const index = tileIndex(other.tileX, other.tileY);
    if (pocket.has(index)) continue;
    // Compared against `before`, never against 1: a slot sealed earlier in this pass is
    // already unreachable and must not veto the next one.
    if (reachedBefore[index] === 1 && reachedAfter[index] !== 1) return false;
  }
  return true;
}

function countReached(reached: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < SECTOR_TILE_COUNT; index++) total += reached[index];
  return total;
}
