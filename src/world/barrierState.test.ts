/**
 * A barrier's identity is the part that cannot be eyeballed: one edge plug is two mouth
 * bands stamped by two sectors, and reading it as two barriers would halve its toughness
 * and leave it a wall from one side after it broke. These seven pin identity, two sided
 * clearing and per world impact counting.
 */

import { describe, it, expect } from 'vitest';
import {
  SECTOR_TILE_COLS, SECTOR_TILE_ROWS, SECTOR_TILE_COUNT, TILE_SIZE,
  EdgeKind, TileKind, WALL_EDGE, edgeIdFor, tileIndex,
} from './worldTypes';
import type { BreakableRect, EdgeDef, EdgeDirection, SectorDef, WorldMap } from './worldTypes';
import {
  ABILITY_DOOR_OPEN_RADIUS,
  BARRIER_IMPACTS_TO_BREAK,
  abilityDoorNearWorld,
  applyBrokenBarriers,
  applyOwnedAbilityGates,
  barrierIdAtWorld,
  clearBarrier,
  openAbilityGate,
  reportPlayerImpact,
  setBarrierEventSink,
} from './barrierState';

const APERTURE_START = 8;
const APERTURE_END = 11;
const POCKET: BreakableRect = { id: 'breakable:0,0:0', tileX: 5, tileY: 5, tileW: 2, tileH: 2 };

function makeSector(
  sx: number, sy: number,
  edges: Partial<Record<EdgeDirection, EdgeDef>>,
  breakables: BreakableRect[],
): SectorDef {
  return {
    sx, sy, key: `${sx},${sy}`, biomeId: 'stage_deep_void', danger: 0,
    tiles: new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open),
    edges: {
      north: edges.north ?? WALL_EDGE, east: edges.east ?? WALL_EDGE,
      south: edges.south ?? WALL_EDGE, west: edges.west ?? WALL_EDGE,
    },
    poiSlots: [], isStart: sx === 0 && sy === 0, isBossArena: false, depth: 0,
    entryTiles: {}, breakables,
  };
}

function makeWorld(): WorldMap {
  const sharedEdge: EdgeDef = {
    kind: EdgeKind.Breakable, apertureStart: APERTURE_START, apertureEnd: APERTURE_END,
  };
  const near = makeSector(0, 0, { east: sharedEdge }, [{ ...POCKET }]);
  const far = makeSector(1, 0, { west: sharedEdge }, []);
  for (let tileY = APERTURE_START; tileY <= APERTURE_END; tileY++) {
    near.tiles[tileIndex(SECTOR_TILE_COLS - 1, tileY)] = TileKind.Breakable;
    far.tiles[tileIndex(0, tileY)] = TileKind.Breakable;
  }
  for (let offsetY = 0; offsetY < POCKET.tileH; offsetY++) {
    for (let offsetX = 0; offsetX < POCKET.tileW; offsetX++) {
      near.tiles[tileIndex(POCKET.tileX + offsetX, POCKET.tileY + offsetY)] = TileKind.Breakable;
    }
  }
  near.tiles[tileIndex(3, 3)] = TileKind.Solid;
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', near], ['1,0', far]]),
    abilityOrder: [], bossArenaKey: '0,0',
  };
}

function tileCentre(sx: number, tileX: number, tileY: number): { x: number; y: number } {
  return {
    x: (sx * SECTOR_TILE_COLS + tileX) * TILE_SIZE + TILE_SIZE / 2,
    y: tileY * TILE_SIZE + TILE_SIZE / 2,
  };
}

function tileAt(world: WorldMap, key: string, tileX: number, tileY: number): number {
  return world.sectors.get(key)!.tiles[tileIndex(tileX, tileY)];
}

function pocketTiles(world: WorldMap): number[] {
  const kinds: number[] = [];
  for (let offsetY = 0; offsetY < POCKET.tileH; offsetY++) {
    for (let offsetX = 0; offsetX < POCKET.tileW; offsetX++) {
      kinds.push(tileAt(world, '0,0', POCKET.tileX + offsetX, POCKET.tileY + offsetY));
    }
  }
  return kinds;
}

function mouthTiles(world: WorldMap): number[] {
  const kinds: number[] = [];
  for (let tileY = APERTURE_START; tileY <= APERTURE_END; tileY++) {
    kinds.push(tileAt(world, '0,0', SECTOR_TILE_COLS - 1, tileY));
    kinds.push(tileAt(world, '1,0', 0, tileY));
  }
  return kinds;
}

describe('barrierState', () => {
  it('names an interior pocket by its BreakableRect id from any of its tiles', () => {
    const world = makeWorld();
    for (let offsetY = 0; offsetY < POCKET.tileH; offsetY++) {
      for (let offsetX = 0; offsetX < POCKET.tileW; offsetX++) {
        const { x, y } = tileCentre(0, POCKET.tileX + offsetX, POCKET.tileY + offsetY);
        expect(barrierIdAtWorld(world, x, y)).toBe('breakable:0,0:0');
      }
    }
  });

  it('names an edge plug identically from both sectors that stamped it', () => {
    const world = makeWorld();
    const nearMouth = tileCentre(0, SECTOR_TILE_COLS - 1, APERTURE_START);
    const farMouth = tileCentre(1, 0, APERTURE_START);
    const nearId = barrierIdAtWorld(world, nearMouth.x, nearMouth.y);
    const farId = barrierIdAtWorld(world, farMouth.x, farMouth.y);
    expect(nearId).toBe(edgeIdFor(0, 0, 'east'));
    expect(farId).toBe(nearId);
  });

  it('answers null off any breakable tile', () => {
    const world = makeWorld();
    const solid = tileCentre(0, 3, 3);
    const open = tileCentre(0, 10, 2);
    const nowhere = tileCentre(9, 4, 4);
    expect(barrierIdAtWorld(world, solid.x, solid.y)).toBeNull();
    expect(barrierIdAtWorld(world, open.x, open.y)).toBeNull();
    expect(barrierIdAtWorld(world, nowhere.x, nowhere.y)).toBeNull();
  });

  it('clears both mouth bands of an edge plug once', () => {
    const world = makeWorld();
    const edgeId = edgeIdFor(0, 0, 'east');
    expect(clearBarrier(world, edgeId)).toBe(true);
    expect(mouthTiles(world)).toEqual(new Array(8).fill(TileKind.Open));
    expect(clearBarrier(world, edgeId)).toBe(false);
  });

  it('breaks a pocket on the last of BARRIER_IMPACTS_TO_BREAK impacts', () => {
    const world = makeWorld();
    const chipped: string[] = [];
    const broken: string[] = [];
    setBarrierEventSink({
      onBarrierChipped: (_x, _y, barrierId) => { chipped.push(barrierId); },
      onBarrierBroken: (_x, _y, barrierId) => { broken.push(barrierId); },
    });
    const { x, y } = tileCentre(0, POCKET.tileX, POCKET.tileY);
    for (let impact = 0; impact < BARRIER_IMPACTS_TO_BREAK - 1; impact++) {
      reportPlayerImpact(world, x, y);
      expect(pocketTiles(world)).toEqual(new Array(4).fill(TileKind.Breakable));
    }
    reportPlayerImpact(world, x, y);
    expect(pocketTiles(world)).toEqual(new Array(4).fill(TileKind.Open));
    expect(chipped).toHaveLength(BARRIER_IMPACTS_TO_BREAK - 1);
    expect(broken).toEqual(['breakable:0,0:0']);
    setBarrierEventSink(null);
  });

  it('counts impacts per world, so a fresh run starts a barrier at zero', () => {
    const first = makeWorld();
    const second = makeWorld();
    const { x, y } = tileCentre(0, POCKET.tileX, POCKET.tileY);
    for (let impact = 0; impact < BARRIER_IMPACTS_TO_BREAK - 1; impact++) {
      reportPlayerImpact(first, x, y);
    }
    reportPlayerImpact(second, x, y);
    expect(pocketTiles(second)).toEqual(new Array(4).fill(TileKind.Breakable));
  });

  it('replays only the remembered ids it can resolve', () => {
    const world = makeWorld();
    const applied = applyBrokenBarriers(world, [
      'breakable:0,0:0', 'edge:0,0:east', 'breakable:9,9:0', 'not-an-id', 'edge:0,0:up',
    ]);
    expect(applied).toBe(2);
    expect(pocketTiles(world)).toEqual(new Array(4).fill(TileKind.Open));
    expect(mouthTiles(world)).toEqual(new Array(8).fill(TileKind.Open));
  });
});

const GATE_START = 8;
const GATE_END = 11;
const GATE_ABILITY = 'ability_blink_drive';

/**
 * Sector 0,0 has an east AbilityDoor to 1,0 and a south OneWay membrane to 0,1. Both stamp
 * GateClosed mouth tiles, which is the trap these tests exist to pin.
 */
function makeGateWorld(): WorldMap {
  const door: EdgeDef = {
    kind: EdgeKind.AbilityDoor, apertureStart: GATE_START, apertureEnd: GATE_END,
    requiredId: GATE_ABILITY,
  };
  const membrane: EdgeDef = {
    kind: EdgeKind.OneWay, apertureStart: GATE_START, apertureEnd: GATE_END,
    passDirection: 'south',
  };
  const near = makeSector(0, 0, { east: door, south: membrane }, []);
  const far = makeSector(1, 0, { west: door }, []);
  const below = makeSector(0, 1, { north: membrane }, []);
  for (let tileY = GATE_START; tileY <= GATE_END; tileY++) {
    near.tiles[tileIndex(SECTOR_TILE_COLS - 1, tileY)] = TileKind.GateClosed;
    far.tiles[tileIndex(0, tileY)] = TileKind.GateClosed;
  }
  for (let tileX = GATE_START; tileX <= GATE_END; tileX++) {
    near.tiles[tileIndex(tileX, SECTOR_TILE_ROWS - 1)] = TileKind.GateClosed;
    below.tiles[tileIndex(tileX, 0)] = TileKind.GateClosed;
  }
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', near], ['1,0', far], ['0,1', below]]),
    abilityOrder: [GATE_ABILITY], bossArenaKey: '0,0',
  };
}

function gateMouthTiles(world: WorldMap): number[] {
  const kinds: number[] = [];
  for (let tileY = GATE_START; tileY <= GATE_END; tileY++) {
    kinds.push(tileAt(world, '0,0', SECTOR_TILE_COLS - 1, tileY));
    kinds.push(tileAt(world, '1,0', 0, tileY));
  }
  return kinds;
}

function membraneMouthTiles(world: WorldMap): number[] {
  const kinds: number[] = [];
  for (let tileX = GATE_START; tileX <= GATE_END; tileX++) {
    kinds.push(tileAt(world, '0,0', tileX, SECTOR_TILE_ROWS - 1));
    kinds.push(tileAt(world, '0,1', tileX, 0));
  }
  return kinds;
}

describe('ability gates', () => {
  it('opens both mouth bands of an ability door once', () => {
    const world = makeGateWorld();
    expect(openAbilityGate(world, edgeIdFor(0, 0, 'east'))).toBe(true);
    expect(gateMouthTiles(world)).toEqual(new Array(8).fill(TileKind.Open));
  });

  it('is idempotent: a second open reports nothing to do', () => {
    const world = makeGateWorld();
    const edgeId = edgeIdFor(0, 0, 'east');
    expect(openAbilityGate(world, edgeId)).toBe(true);
    expect(openAbilityGate(world, edgeId)).toBe(false);
  });

  it('never dissolves a one-way membrane, which stamps GateClosed tiles too', () => {
    const world = makeGateWorld();
    expect(openAbilityGate(world, edgeIdFor(0, 0, 'south'))).toBe(false);
    expect(membraneMouthTiles(world)).toEqual(new Array(8).fill(TileKind.GateClosed));
  });

  it('answers false for a malformed, foreign or breakable edge id', () => {
    const world = makeGateWorld();
    expect(openAbilityGate(world, 'not-an-id')).toBe(false);
    expect(openAbilityGate(world, 'edge:9,9:east')).toBe(false);
    expect(openAbilityGate(world, 'breakable:0,0:0')).toBe(false);
  });

  it('finds a closed door from inside its radius and names what it wants', () => {
    const world = makeGateWorld();
    const bandCentreY = ((GATE_START + GATE_END + 1) / 2) * TILE_SIZE;
    const insideX = SECTOR_TILE_COLS * TILE_SIZE - TILE_SIZE - 40;
    const found = abilityDoorNearWorld(world, insideX, bandCentreY, ABILITY_DOOR_OPEN_RADIUS);
    expect(found).not.toBeNull();
    expect(found!.edgeId).toBe(edgeIdFor(0, 0, 'east'));
    expect(found!.requiredId).toBe(GATE_ABILITY);
    expect(found!.y).toBeCloseTo(bandCentreY);
  });

  it('answers null from beyond the radius', () => {
    const world = makeGateWorld();
    const bandCentreY = ((GATE_START + GATE_END + 1) / 2) * TILE_SIZE;
    const farX = SECTOR_TILE_COLS * TILE_SIZE - TILE_SIZE - 120;
    expect(abilityDoorNearWorld(world, farX, bandCentreY, ABILITY_DOOR_OPEN_RADIUS)).toBeNull();
  });

  it('answers null once the door is open, so a claim fires its moment once', () => {
    const world = makeGateWorld();
    const bandCentreY = ((GATE_START + GATE_END + 1) / 2) * TILE_SIZE;
    const insideX = SECTOR_TILE_COLS * TILE_SIZE - TILE_SIZE - 40;
    openAbilityGate(world, edgeIdFor(0, 0, 'east'));
    expect(abilityDoorNearWorld(world, insideX, bandCentreY, ABILITY_DOOR_OPEN_RADIUS))
      .toBeNull();
  });

  it('replays only the doors whose ability the profile owns', () => {
    const unowned = makeGateWorld();
    expect(applyOwnedAbilityGates(unowned, ['ability_phase_cloak'])).toBe(0);
    expect(gateMouthTiles(unowned)).toEqual(new Array(8).fill(TileKind.GateClosed));

    const owned = makeGateWorld();
    expect(applyOwnedAbilityGates(owned, [GATE_ABILITY])).toBe(1);
    expect(gateMouthTiles(owned)).toEqual(new Array(8).fill(TileKind.Open));
    expect(membraneMouthTiles(owned)).toEqual(new Array(8).fill(TileKind.GateClosed));
  });
});
