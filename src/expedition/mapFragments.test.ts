/**
 * The chooser fails silently when it is wrong: a fragment that picks the room you are standing
 * in, or one that charts a hidden sector, still returns a plausible grant and the only symptom
 * is a reward that felt like nothing. These three pin the region split, the cap and the
 * exhausted-world case.
 */

import { describe, expect, it } from 'vitest';
import { SECTOR_TILE_COUNT, TileKind, WALL_EDGE } from '../world/worldTypes';
import type { SectorDef, WorldMap } from '../world/worldTypes';
import { chooseMapFragmentGrant } from './mapFragments';

function makeSector(sx: number, biomeId: string, hidden = false): SectorDef {
  return {
    sx, sy: 0, key: `${sx},0`, biomeId, danger: 0,
    tiles: new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open),
    edges: { north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE },
    poiSlots: [], isStart: sx === 0, isBossArena: false, depth: sx, hidden,
    entryTiles: {}, breakables: [],
  };
}

/** Two sectors of deep void at depths 0-1, then five crystal caves at depths 2-6. */
function makeTwoRegionWorld(): WorldMap {
  const sectors = new Map<string, SectorDef>();
  for (let sx = 0; sx <= 6; sx++) {
    sectors.set(`${sx},0`, makeSector(sx, sx < 2 ? 'stage_deep_void' : 'stage_crystal_caves'));
  }
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0', sectors,
    abilityOrder: [], bossArenaKey: '6,0',
  };
}

describe('chooseMapFragmentGrant', () => {
  it('charts another region than the one the find happened in, capped and shallowest first', () => {
    const grant = chooseMapFragmentGrant({
      map: makeTwoRegionWorld(),
      discoveredSectorKeys: new Set(['0,0']),
      visitedSectorKeys: new Set(['0,0']),
      originSectorKey: '0,0',
      maxSectors: 3,
    });

    expect(grant?.regionId).toBe('region:stage_crystal_caves');
    expect(grant?.regionName).toBe('Crystal Caves');
    expect(grant?.sectorKeys).toEqual(['2,0', '3,0', '4,0']);
  });

  it('leaves an unvisited hidden sector out of the grant', () => {
    const map = makeTwoRegionWorld();
    map.sectors.get('3,0')!.hidden = true;

    const grant = chooseMapFragmentGrant({
      map,
      discoveredSectorKeys: new Set<string>(),
      visitedSectorKeys: new Set<string>(),
      originSectorKey: '0,0',
      maxSectors: 8,
    });

    expect(grant?.sectorKeys).toEqual(['2,0', '4,0', '5,0', '6,0']);
  });

  it('returns null when everything chartable is already on the map', () => {
    const map = makeTwoRegionWorld();
    const everything = new Set([...map.sectors.keys()]);

    expect(chooseMapFragmentGrant({
      map,
      discoveredSectorKeys: everything,
      visitedSectorKeys: everything,
      originSectorKey: '0,0',
      maxSectors: 8,
    })).toBeNull();
  });
});
