import { describe, test, expect } from 'vitest';
import { buildSectorDetail, type PoiHazardKind } from './sectorDetail';
import {
  EdgeKind, PoiKind, SECTOR_TILE_COLS, SECTOR_TILE_COUNT, TileKind, WALL_EDGE,
} from '../world/worldTypes';
import type { EdgeDef, GridBandDef, PoiSlot, SectorDef, WorldMap } from '../world/worldTypes';
import { secretShellRingIndices } from '../world/sectorInterior';
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
  hazardSectorKinds: new Map<string, PoiHazardKind>(),
  bloomedSectorKeys: new Set<string>(),
  shiftedSectorKeys: new Set<string>(),
  wardenName: 'The Warden',
};

function makeFencedAltarWorld(): WorldMap {
  const slot: PoiSlot = {
    id: 'poi:0,0:2', kind: PoiKind.Shrine, tileX: 8, tileY: 5, fenced: true,
  };
  const map = makeWorld({}, [slot]);
  const tiles = map.sectors.get('0,0')!.tiles;
  for (const index of secretShellRingIndices(8, 5)) tiles[index] = TileKind.SecurityGrid;
  return map;
}

function makeBandedWorld(bandCount: number): WorldMap {
  const map = makeWorld({}, []);
  const sector = map.sectors.get('0,0')!;
  const bands: GridBandDef[] = [];
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex++) {
    const row = 3 + bandIndex;
    const tileIndices = [SECTOR_TILE_COLS * row + 6, SECTOR_TILE_COLS * row + 7];
    for (const index of tileIndices) sector.tiles[index] = TileKind.SecurityGrid;
    bands.push({ id: `band:0,0:${bandIndex}`, tileIndices });
  }
  sector.gridBands = bands;
  return map;
}

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

  test('a remembered hive replaces the cache line and is never said twice', () => {
    const slot: PoiSlot = { id: 'poi:0,0:1', kind: PoiKind.Treasure, tileX: 4, tileY: 4 };
    const map = makeWorld({}, [slot]);
    const remembered = {
      ...BASE, map,
      poiFlagsOf: () => PoiFlags.SEEN | PoiFlags.HAZARD_NEST,
    };

    expect(buildSectorDetail(remembered)!.rewards).toEqual(['Ambush nest']);
    expect(buildSectorDetail({
      ...remembered,
      hazardSectorKinds: new Map<string, PoiHazardKind>([['0,0', 'nest']]),
    })!.rewards).toEqual(['Ambush nest']);
    expect(buildSectorDetail({
      ...remembered,
      hazardSectorKinds: new Map<string, PoiHazardKind>([['0,0', 'lair']]),
    })!.rewards).toEqual(['Ambush nest', 'Nemesis lair · dormant']);
  });

  test('a fenced altar names the grid to a ship without the cloak', () => {
    expect(buildSectorDetail({ ...BASE, map: makeFencedAltarWorld() })!.rewards)
      .toEqual(['Altar · behind a security grid']);
  });

  test('the same altar reads as open once the cloak is held', () => {
    expect(buildSectorDetail({
      ...BASE, map: makeFencedAltarWorld(), holdsAbility: () => true,
    })!.rewards).toEqual(['Altar · grid open to you']);
  });

  test('a lead onto a sealed cache names the wall that holds it', () => {
    const slot: PoiSlot = {
      id: 'poi:0,0:0', kind: PoiKind.Secret, tileX: 4, tileY: 4, sealed: true,
    };
    expect(buildSectorDetail({
      ...BASE, map: makeWorld({}, [slot]),
      secretFlagsOf: () => SecretFlags.HINTED,
      hintedSectorKeys: new Set(['0,0']),
    })!.rewards).toEqual(['A lead points here · sealed behind cracked rock']);
  });

  test('a lead across a gap names the gap, and says so differently once the tether is held', () => {
    const slot: PoiSlot = {
      id: 'poi:0,0:0', kind: PoiKind.Secret, tileX: 4, tileY: 4, gapped: true,
    };
    const gapped = {
      ...BASE, map: makeWorld({}, [slot]),
      secretFlagsOf: () => SecretFlags.HINTED,
      hintedSectorKeys: new Set(['0,0']),
    };
    expect(buildSectorDetail(gapped)!.rewards)
      .toEqual(['A lead points here · across a void gap']);
    expect(buildSectorDetail({
      ...gapped, holdsAbility: (id: string) => id === 'ability_magno_tether',
    })!.rewards).toEqual(['A lead points here · across a void gap open to you']);
  });

  test('an unknown sector and a cell outside the world both read as nothing', () => {
    const map = makeWorld({}, []);
    expect(buildSectorDetail({ ...BASE, map, sectorFlagsOf: () => 0 })).toBeNull();
    expect(buildSectorDetail({ ...BASE, map, gridX: 9, gridY: 9 })).toBeNull();
  });

  test('a corridor grid is named only in a room the ship has been inside', () => {
    const map = makeBandedWorld(2);
    expect(buildSectorDetail({ ...BASE, map })!.rewards)
      .toEqual(['2 corridor grids · blocking shortcuts']);
    expect(buildSectorDetail({ ...BASE, map, holdsAbility: () => true })!.rewards)
      .toEqual(['2 corridor grids · shortcuts open to you']);
    expect(buildSectorDetail({
      ...BASE, map, sectorFlagsOf: () => SectorFlags.DISCOVERED,
    })!.rewards).toEqual([]);
    expect(buildSectorDetail({ ...BASE, map: makeBandedWorld(1) })!.rewards)
      .toEqual(['Corridor grid · blocking a shortcut']);
  });
});
