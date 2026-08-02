import { describe, it, expect } from 'vitest';
import { STAGES } from '../data/Stages';
import { generateWorld } from './generateWorld';
import { SECTOR_TILE_COLS, SECTOR_TILE_ROWS, TileKind, tileIndex } from './worldTypes';
import type { WorldGenInputs, WorldMap } from './worldTypes';
import { BLOOMED_SECTORS_PER_EXPEDITION, applyAmbientBloom, resolveBloomedSectorKeys }
  from './ambientStir';

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
});
