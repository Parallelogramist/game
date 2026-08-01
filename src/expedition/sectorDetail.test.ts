import { describe, test, expect } from 'vitest';
import { buildSectorDetail } from './sectorDetail';
import { EdgeKind, PoiKind, SECTOR_TILE_COUNT, WALL_EDGE } from '../world/worldTypes';
import type { EdgeDef, PoiSlot, SectorDef, WorldMap } from '../world/worldTypes';
import { PoiFlags, SecretFlags, SectorFlags } from './DiscoveryTypes';

function makeWorld(
  edges: Partial<Record<'north' | 'east' | 'south' | 'west', EdgeDef>>,
  poiSlots: PoiSlot[],
): WorldMap {
  const sector: SectorDef = {
    sx: 0, sy: 0, key: '0,0', biomeId: 'crystal', danger: 1,
    tiles: new Uint8Array(SECTOR_TILE_COUNT),
    edges: {
      north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE, ...edges,
    },
    poiSlots, isStart: true, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
  return {
    worldGenVersion: 3, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', sector]]), abilityOrder: [], bossArenaKey: '0,0',
  };
}

const BASE = {
  gridX: 0, gridY: 0,
  sectorFlagsOf: () => SectorFlags.DISCOVERED | SectorFlags.VISITED,
  edgeFlagsOf: () => 1,          // EdgeFlags.KNOWN
  poiFlagsOf: () => PoiFlags.SEEN,
  secretFlagsOf: () => 0,
  holdsAbility: () => false,
  holdsQuestKey: () => false,
  objectiveSectorKeys: new Set<string>(),
  hintedSectorKeys: new Set<string>(),
};

describe('buildSectorDetail', () => {
  test('an unfound secret is never named, a found one is', () => {
    const slot: PoiSlot = { id: 'poi:0,0:0', kind: PoiKind.Secret, tileX: 4, tileY: 4 };
    const map = makeWorld({}, [slot]);
    expect(buildSectorDetail({ ...BASE, map })!.rewards).toEqual([]);
    expect(buildSectorDetail({
      ...BASE, map, secretFlagsOf: () => SecretFlags.FOUND,
    })!.rewards).toEqual(['Found secret']);
  });

  test('a POI the profile has not SEEN contributes nothing', () => {
    const slot: PoiSlot = { id: 'poi:0,0:1', kind: PoiKind.Treasure, tileX: 4, tileY: 4 };
    const map = makeWorld({}, [slot]);
    expect(buildSectorDetail({ ...BASE, map, poiFlagsOf: () => 0 })!.rewards).toEqual([]);
    expect(buildSectorDetail({ ...BASE, map })!.rewards).toEqual(['Cache']);
  });

  test('a sealed ability door names the ability and flips once it is held', () => {
    const map = makeWorld({
      north: { kind: EdgeKind.AbilityDoor, apertureStart: 0, apertureEnd: 3,
        requiredId: 'ability_blink_drive' },
    }, []);
    expect(buildSectorDetail({ ...BASE, map })!.doors)
      .toEqual(['N Ability door · requires Blink Drive']);
    expect(buildSectorDetail({ ...BASE, map, holdsAbility: () => true })!.doors)
      .toEqual(['N Ability door · open to you']);
  });

  test('an unresolvable requirement reads as unknown rather than lying', () => {
    const map = makeWorld({
      east: { kind: EdgeKind.AbilityDoor, apertureStart: 0, apertureEnd: 3 },
    }, []);
    expect(buildSectorDetail({ ...BASE, map })!.doors)
      .toEqual(['E Ability door · mechanism unknown']);
  });

  test('an unknown sector and a cell outside the world both read as nothing', () => {
    const map = makeWorld({}, []);
    expect(buildSectorDetail({ ...BASE, map, sectorFlagsOf: () => 0 })).toBeNull();
    expect(buildSectorDetail({ ...BASE, map, gridX: 9, gridY: 9 })).toBeNull();
  });
});
