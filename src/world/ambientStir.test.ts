import { describe, it, expect } from 'vitest';
import { STAGES } from '../data/Stages';
import { generateWorld } from './generateWorld';
import {
  EDGE_DIRECTIONS, SECTOR_TILE_COLS, SECTOR_TILE_ROWS, TileKind, tileIndex,
} from './worldTypes';
import type { SectorDef, TileCoord, WorldGenInputs, WorldMap } from './worldTypes';
import {
  BLOOMED_SECTORS_PER_EXPEDITION, applyAmbientBloom, applyAmbientShift,
  resolveBloomedSectorKeys, resolveShiftedSectorKeys,
} from './ambientStir';

const INPUTS: WorldGenInputs = {
  abilityGateOrder: ['blink_drive', 'breach_charges', 'magno_tether',
    'phase_cloak', 'thermal_ward', 'signal_decryptor'],
  availableBiomeIds: STAGES.map(stage => stage.id),
};
const SEEDS = [20260727, 12345, 987654, 4242, 777];

function build(seed: number): WorldMap {
  return generateWorld(seed, INPUTS);
}

function snapshotTiles(map: WorldMap): Map<string, Uint8Array> {
  return new Map([...map.sectors].map(([key, sector]) => [key, Uint8Array.from(sector.tiles)]));
}

function countHazardFloor(tiles: Uint8Array): number {
  let count = 0;
  for (const kind of tiles) if (kind === TileKind.HazardFloor) count += 1;
  return count;
}

function reachableFromEntry(sector: SectorDef): Uint8Array {
  const reached = new Uint8Array(SECTOR_TILE_COLS * SECTOR_TILE_ROWS);
  let seed: TileCoord | undefined;
  for (const direction of EDGE_DIRECTIONS) {
    const entry = sector.entryTiles[direction];
    if (entry) { seed = entry; break; }
  }
  if (!seed) return reached;
  const passable = (index: number): boolean =>
    sector.tiles[index] === TileKind.Open || sector.tiles[index] === TileKind.HazardFloor;
  const start = tileIndex(seed.tileX, seed.tileY);
  if (!passable(start)) return reached;
  reached[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head] % SECTOR_TILE_COLS;
    const y = Math.floor(queue[head] / SECTOR_TILE_COLS);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= SECTOR_TILE_COLS || ny < 0 || ny >= SECTOR_TILE_ROWS) continue;
      const next = tileIndex(nx, ny);
      if (reached[next] || !passable(next)) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return reached;
}

describe('ambientStir', () => {
  it('picks the same rooms for the same expedition and different rooms as the world ages', () => {
    for (const seed of SEEDS) {
      expect(resolveBloomedSectorKeys(build(seed), 3))
        .toEqual(resolveBloomedSectorKeys(build(seed), 3));
      const map = build(seed);
      const lists = Array.from({ length: 8 }, (_, index) =>
        resolveBloomedSectorKeys(map, index + 1).join('|'));
      expect(new Set(lists).size).toBeGreaterThanOrEqual(4);
    }
  });

  it('never blooms the hangar, the boss arena or a hidden room', () => {
    for (const seed of SEEDS) {
      const map = build(seed);
      for (let ordinal = 1; ordinal <= 5; ordinal++) {
        const keys = resolveBloomedSectorKeys(map, ordinal);
        expect(keys).toHaveLength(BLOOMED_SECTORS_PER_EXPEDITION);
        for (const key of keys) {
          const sector = map.sectors.get(key);
          expect(sector).toBeDefined();
          expect(sector?.isStart).toBe(false);
          expect(sector?.isBossArena).toBe(false);
          expect(sector?.hidden).not.toBe(true);
        }
      }
    }
  });

  it('only ever turns Open floor into HazardFloor', () => {
    for (const seed of SEEDS) {
      const map = build(seed);
      const before = snapshotTiles(map);
      applyAmbientBloom(map, 4);
      for (const [key, sector] of map.sectors) {
        const priorTiles = before.get(key) as Uint8Array;
        for (let index = 0; index < sector.tiles.length; index++) {
          if (sector.tiles[index] === priorTiles[index]) continue;
          expect(priorTiles[index]).toBe(TileKind.Open);
          expect(sector.tiles[index]).toBe(TileKind.HazardFloor);
        }
      }
    }
  });

  it('keeps every POI slot and every doorway approach clear', () => {
    for (const seed of SEEDS) {
      const map = build(seed);
      const before = snapshotTiles(map);
      applyAmbientBloom(map, 4);
      for (const [key, sector] of map.sectors) {
        const priorTiles = before.get(key) as Uint8Array;
        const guarded = [
          ...sector.poiSlots.map(slot => ({ tileX: slot.tileX, tileY: slot.tileY })),
          ...Object.values(sector.entryTiles).filter(entry => entry !== undefined),
        ];
        for (const point of guarded) {
          for (let y = Math.max(0, point.tileY - 2);
            y <= Math.min(SECTOR_TILE_ROWS - 1, point.tileY + 2); y++) {
            for (let x = Math.max(0, point.tileX - 2);
              x <= Math.min(SECTOR_TILE_COLS - 1, point.tileX + 2); x++) {
              const index = tileIndex(x, y);
              if (priorTiles[index] === TileKind.HazardFloor) continue;
              expect(sector.tiles[index]).not.toBe(TileKind.HazardFloor);
            }
          }
        }
      }
    }
  });

  it('reports only the rooms that actually grew ground', () => {
    for (const seed of SEEDS) {
      const map = build(seed);
      const before = snapshotTiles(map);
      const picked = resolveBloomedSectorKeys(map, 4);
      const bloomed = applyAmbientBloom(map, 4);
      for (const key of bloomed) {
        expect(picked).toContain(key);
        const sector = map.sectors.get(key);
        expect(countHazardFloor(sector?.tiles as Uint8Array))
          .toBeGreaterThan(countHazardFloor(before.get(key) as Uint8Array));
      }
    }
  });

  it('picks the same rooms to shift for the same expedition and different rooms as it ages', () => {
    for (const seed of SEEDS) {
      expect(resolveShiftedSectorKeys(build(seed), 3))
        .toEqual(resolveShiftedSectorKeys(build(seed), 3));
      const map = build(seed);
      const lists = Array.from({ length: 8 }, (_, index) =>
        resolveShiftedSectorKeys(map, index + 1).join('|'));
      expect(new Set(lists).size).toBeGreaterThanOrEqual(4);
    }
  });

  it('never strands a POI slot, a doorway or a corridor in a room it shifts', () => {
    for (const seed of SEEDS) {
      for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
        const map = build(seed);
        const before = new Map([...map.sectors].map(([key, sector]) =>
          [key, reachableFromEntry(sector)]));
        const openBefore = snapshotTiles(map);
        for (const key of applyAmbientShift(map, ordinal)) {
          const sector = map.sectors.get(key)!;
          const after = reachableFromEntry(sector);
          const wasReached = before.get(key)!;
          const priorTiles = openBefore.get(key)!;
          let opened = 0;
          let filled = 0;
          for (let index = 0; index < sector.tiles.length; index += 1) {
            if (priorTiles[index] === sector.tiles[index]) continue;
            if (sector.tiles[index] === TileKind.Open) opened += 1;
            else filled += 1;
          }
          let reachedBefore = 0;
          let reachedAfter = 0;
          for (let index = 0; index < after.length; index += 1) {
            reachedBefore += wasReached[index];
            reachedAfter += after[index];
          }
          expect(reachedAfter).toBe(reachedBefore + opened - filled);
          for (const direction of EDGE_DIRECTIONS) {
            const entry = sector.entryTiles[direction];
            if (entry) expect(after[tileIndex(entry.tileX, entry.tileY)]).toBe(1);
          }
          for (const slot of sector.poiSlots) {
            const index = tileIndex(slot.tileX, slot.tileY);
            if (wasReached[index] === 1) expect(after[index]).toBe(1);
          }
        }
      }
    }
  });

  it('writes only Solid over Open and Open over Solid, in rooms it picked', () => {
    for (const seed of SEEDS) {
      const map = build(seed);
      const priorTiles = snapshotTiles(map);
      const shifted = new Set(applyAmbientShift(map, 2));
      for (const [key, sector] of map.sectors) {
        const prior = priorTiles.get(key)!;
        for (let index = 0; index < sector.tiles.length; index += 1) {
          if (prior[index] === sector.tiles[index]) continue;
          expect(shifted.has(key)).toBe(true);
          const moved = `${prior[index]}->${sector.tiles[index]}`;
          expect([`${TileKind.Open}->${TileKind.Solid}`,
            `${TileKind.Solid}->${TileKind.Open}`]).toContain(moved);
        }
      }
    }
  });

  it('never shifts the hangar, the boss arena or a hidden room', () => {
    for (const seed of SEEDS) {
      const map = build(seed);
      for (const key of resolveShiftedSectorKeys(map, 5)) {
        const sector = map.sectors.get(key)!;
        expect(sector.isStart).toBe(false);
        expect(sector.isBossArena).toBe(false);
        expect(sector.hidden === true).toBe(false);
      }
    }
  });
});
