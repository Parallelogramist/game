/**
 * The manager's one job with a silent failure mode is deciding whether a stored payload
 * belongs to the world being played: get the (worldSeed, worldGenVersion) binding wrong and
 * a profile inherits another world's map, which looks like a working map. These five pin the
 * round trip, both halves of that binding, the revision a renderer will cache against, and
 * the counts the map header will read.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  EdgeKind, PoiKind, SECTOR_TILE_COUNT, TileKind, WALL_EDGE,
} from '../world/worldTypes';
import type { EdgeDef, EdgeDirection, PoiSlot, SectorDef, WorldMap } from '../world/worldTypes';
import { SectorFlags } from './DiscoveryTypes';
import { DiscoveryManager } from './DiscoveryManager';

vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

const OPEN_EDGE: EdgeDef = { kind: EdgeKind.Open, apertureStart: 10, apertureEnd: 13 };

function makeSector(
  sx: number, sy: number,
  edges: Partial<Record<EdgeDirection, EdgeDef>>,
  poiSlots: PoiSlot[] = [],
): SectorDef {
  return {
    sx, sy, key: `${sx},${sy}`, biomeId: 'stage_deep_void', danger: 0,
    tiles: new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open),
    edges: {
      north: edges.north ?? WALL_EDGE, east: edges.east ?? WALL_EDGE,
      south: edges.south ?? WALL_EDGE, west: edges.west ?? WALL_EDGE,
    },
    poiSlots, isStart: sx === 0 && sy === 0, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
}

function makeWorld(seed: number, worldGenVersion = 1): WorldMap {
  const origin = makeSector(0, 0, { east: OPEN_EDGE }, [
    { id: 'poi:0,0:0', kind: PoiKind.Treasure, tileX: 5, tileY: 5 },
    { id: 'poi:0,0:1', kind: PoiKind.Secret, tileX: 9, tileY: 9 },
  ]);
  const east = makeSector(1, 0, { west: OPEN_EDGE });
  const south = makeSector(0, 1, {});
  return {
    worldGenVersion, seed, startKey: '0,0',
    sectors: new Map([['0,0', origin], ['1,0', east], ['0,1', south]]),
    abilityOrder: [], bossArenaKey: '1,0',
  };
}

describe('DiscoveryManager', () => {
  it('persists an entered sector so a fresh manager reads it back', () => {
    const world = makeWorld(101);
    const writer = new DiscoveryManager();
    writer.bindWorld(world);
    writer.markSectorEntered('0,0');

    const reader = new DiscoveryManager();
    reader.bindWorld(makeWorld(101));

    expect(reader.getSectorFlags('0,0') & SectorFlags.VISITED).toBe(SectorFlags.VISITED);
    expect(reader.getSectorFlags('1,0')).toBe(SectorFlags.DISCOVERED);
  });

  it('starts empty for a different world seed', () => {
    const writer = new DiscoveryManager();
    writer.bindWorld(makeWorld(201));
    writer.markSectorEntered('0,0');

    const reader = new DiscoveryManager();
    reader.bindWorld(makeWorld(202));

    expect(reader.getSectorFlags('0,0')).toBe(0);
  });

  it('starts empty for a different generator version', () => {
    const writer = new DiscoveryManager();
    writer.bindWorld(makeWorld(301, 1));
    writer.markSectorEntered('0,0');

    const reader = new DiscoveryManager();
    reader.bindWorld(makeWorld(301, 2));

    expect(reader.getSectorFlags('0,0')).toBe(0);
  });

  it('bumps the revision on a real change and not on a repeat', () => {
    const manager = new DiscoveryManager();
    manager.bindWorld(makeWorld(401));
    const bound = manager.getRevision();

    manager.markSectorEntered('0,0');
    const afterFirst = manager.getRevision();
    manager.markSectorEntered('0,0');

    expect(afterFirst).toBe(bound + 1);
    expect(manager.getRevision()).toBe(afterFirst);
  });

  it('counts visited sectors and reports completion percent', () => {
    const manager = new DiscoveryManager();
    manager.bindWorld(makeWorld(501));

    manager.markSectorEntered('0,0');

    expect(manager.getVisitedSectorCount()).toBe(1);
    expect(manager.getDiscoveredSectorCount()).toBe(2);
    expect(manager.getCompletionPercent()).toBe(25);

    manager.markSecretFound('poi:0,0:1');
    expect(manager.getFoundSecretCount()).toBe(1);
    expect(manager.getCompletionPercent()).toBe(50);
  });
});
