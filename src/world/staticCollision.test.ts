import { describe, it, expect } from 'vitest';
import { STAGES } from '../data/Stages';
import { generateWorld } from './generateWorld';
import {
  SECTOR_TILE_COLS, SECTOR_TILE_ROWS, SECTOR_TILE_COUNT, TILE_SIZE,
  TileKind, EdgeKind, WALL_EDGE, tileIndex,
} from './worldTypes';
import type { EdgeDef, EdgeDirection, SectorDef, WorldMap } from './worldTypes';
import {
  MoverKind, createCollisionResult, resolveCircleMove, raycastSolid,
  isSolidAtWorld, findNearestFreeCircleSpot,
} from './staticCollision';

const PLAYER_RADIUS = 16;
const COLLISION_EPSILON = 0.001;

function makeSector(
  sx: number, sy: number,
  paint: (tiles: Uint8Array) => void,
  edges: Partial<Record<EdgeDirection, EdgeDef>> = {},
): SectorDef {
  const tiles = new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open);
  paint(tiles);
  return {
    sx, sy, key: `${sx},${sy}`, biomeId: 'stage_deep_void', danger: 0, tiles,
    edges: {
      north: edges.north ?? WALL_EDGE, east: edges.east ?? WALL_EDGE,
      south: edges.south ?? WALL_EDGE, west: edges.west ?? WALL_EDGE,
    },
    poiSlots: [], isStart: true, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
}

function makeWorld(
  paint: (tiles: Uint8Array) => void,
  edges: Partial<Record<EdgeDirection, EdgeDef>> = {},
): WorldMap {
  const sector = makeSector(0, 0, paint, edges);
  return {
    worldGenVersion: 1, seed: 1, startKey: '0,0',
    sectors: new Map([['0,0', sector]]), abilityOrder: [], bossArenaKey: '0,0',
  };
}

function tileCentre(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

function paintColumn(tiles: Uint8Array, tileX: number, kind: TileKind): void {
  for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) tiles[tileIndex(tileX, tileY)] = kind;
}

function paintRow(tiles: Uint8Array, tileY: number, kind: TileKind): void {
  for (let tileX = 0; tileX < SECTOR_TILE_COLS; tileX++) tiles[tileIndex(tileX, tileY)] = kind;
}

function paintRect(
  tiles: Uint8Array, fromTileX: number, fromTileY: number,
  toTileX: number, toTileY: number, kind: TileKind,
): void {
  for (let tileY = fromTileY; tileY <= toTileY; tileY++) {
    for (let tileX = fromTileX; tileX <= toTileX; tileX++) tiles[tileIndex(tileX, tileY)] = kind;
  }
}

describe('invariant 9 — push-out', () => {
  it('ends a move that would finish inside a solid tile tangent to it', () => {
    const world = makeWorld(tiles => paintColumn(tiles, 10, TileKind.Solid));
    const start = tileCentre(8, 5);
    const out = createCollisionResult();
    resolveCircleMove(
      world, start.x, start.y, start.x + 200, start.y,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.x).toBeCloseTo(10 * TILE_SIZE - PLAYER_RADIUS, 2);
    expect(Math.abs(out.x - (10 * TILE_SIZE - PLAYER_RADIUS))).toBeLessThanOrEqual(COLLISION_EPSILON * 2);
    expect(out.hitX).toBe(true);
    expect(out.hitY).toBe(false);
    expect(isSolidAtWorld(world, out.x + PLAYER_RADIUS - 0.01, out.y, MoverKind.Player)).toBe(false);
  });

  it('never corrects further than the would-be penetration', () => {
    const world = makeWorld(tiles => { tiles[tileIndex(10, 5)] = TileKind.Solid; });
    const start = tileCentre(8, 5);
    const out = createCollisionResult();
    const faceOffsets = Array.from({ length: 9 }, (_, index) => 5 * TILE_SIZE + index * 5);
    for (const startY of faceOffsets) {
      resolveCircleMove(
        world, start.x, startY, start.x + 60, startY,
        PLAYER_RADIUS, MoverKind.Player, out,
      );
      expect(out.x).toBeLessThanOrEqual(10 * TILE_SIZE - PLAYER_RADIUS);
      expect(out.x).toBeGreaterThanOrEqual(start.x);
    }

    const grazingY = 5 * TILE_SIZE - PLAYER_RADIUS / 2;
    const gap = 5 * TILE_SIZE - grazingY;
    const grazingClearance = Math.sqrt(PLAYER_RADIUS * PLAYER_RADIUS - gap * gap);
    resolveCircleMove(
      world, start.x, grazingY, start.x + 60, grazingY,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.x).toBeLessThanOrEqual(10 * TILE_SIZE - grazingClearance);
    expect(out.x).toBeGreaterThanOrEqual(start.x);
    expect(grazingClearance).toBeLessThan(PLAYER_RADIUS);
  });
});

describe('invariant 10 — no tunneling at dash speed', () => {
  // TUNING.player.dashSpeedMultiplier (3.5) x base moveSpeed (150) = 525 px/s is the real
  // ceiling; 2000 clears it by ~4x so passing here over-satisfies the criterion.
  const SWEEP_SPEED = 2000;

  it('never crosses a one-tile wall column at any frame length from 1ms to 100ms', () => {
    const world = makeWorld(tiles => paintColumn(tiles, 10, TileKind.Solid));
    const out = createCollisionResult();
    const fromWest = tileCentre(8, 5);
    const fromEast = tileCentre(12, 5);
    for (let deltaMs = 1; deltaMs <= 100; deltaMs++) {
      const displacement = SWEEP_SPEED * deltaMs / 1000;
      resolveCircleMove(
        world, fromWest.x, fromWest.y, fromWest.x + displacement, fromWest.y,
        PLAYER_RADIUS, MoverKind.Player, out,
      );
      expect(out.x).toBeLessThanOrEqual(10 * TILE_SIZE);
      resolveCircleMove(
        world, fromEast.x, fromEast.y, fromEast.x - displacement, fromEast.y,
        PLAYER_RADIUS, MoverKind.Player, out,
      );
      expect(out.x).toBeGreaterThanOrEqual(11 * TILE_SIZE);
    }
  });

  it('never crosses a one-tile wall row at any frame length from 1ms to 100ms', () => {
    const world = makeWorld(tiles => paintRow(tiles, 9, TileKind.Solid));
    const out = createCollisionResult();
    const fromNorth = tileCentre(5, 7);
    const fromSouth = tileCentre(5, 11);
    for (let deltaMs = 1; deltaMs <= 100; deltaMs++) {
      const displacement = SWEEP_SPEED * deltaMs / 1000;
      resolveCircleMove(
        world, fromNorth.x, fromNorth.y, fromNorth.x, fromNorth.y + displacement,
        PLAYER_RADIUS, MoverKind.Player, out,
      );
      expect(out.y).toBeLessThanOrEqual(9 * TILE_SIZE);
      resolveCircleMove(
        world, fromSouth.x, fromSouth.y, fromSouth.x, fromSouth.y - displacement,
        PLAYER_RADIUS, MoverKind.Player, out,
      );
      expect(out.y).toBeGreaterThanOrEqual(10 * TILE_SIZE);
    }
  });
});

describe('invariant 11 — corner slide', () => {
  it('keeps the tangential component when the x component is blocked', () => {
    const world = makeWorld(tiles => paintColumn(tiles, 10, TileKind.Solid));
    const start = tileCentre(8, 5);
    const out = createCollisionResult();
    resolveCircleMove(
      world, start.x, start.y, start.x + 200, start.y + 30,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.hitX).toBe(true);
    expect(out.hitY).toBe(false);
    expect(out.y).toBeCloseTo(start.y + 30, 9);
  });

  it('keeps the tangential component sliding the other way', () => {
    const world = makeWorld(tiles => paintColumn(tiles, 6, TileKind.Solid));
    const start = tileCentre(8, 5);
    const out = createCollisionResult();
    resolveCircleMove(
      world, start.x, start.y, start.x - 200, start.y - 30,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.hitX).toBe(true);
    expect(out.hitY).toBe(false);
    expect(out.y).toBeCloseTo(start.y - 30, 9);
  });
});

describe('invariant 12 — spawn snap', () => {
  it('frees an embedded mover onto a legal open tile', () => {
    const world = makeWorld(tiles => paintRect(tiles, 4, 4, 6, 6, TileKind.Solid));
    const query = tileCentre(5, 5);
    const out = { x: 0, y: 0 };
    expect(findNearestFreeCircleSpot(world, query.x, query.y, PLAYER_RADIUS, out)).toBe(true);
    for (const cornerX of [out.x - PLAYER_RADIUS, out.x + PLAYER_RADIUS]) {
      for (const cornerY of [out.y - PLAYER_RADIUS, out.y + PLAYER_RADIUS]) {
        expect(isSolidAtWorld(world, cornerX, cornerY, MoverKind.Player)).toBe(false);
      }
    }
  });

  it('returns a spot reachable from the query rather than one across a wall', () => {
    const SNAP_RADIUS = 30;
    const world = makeWorld(tiles => {
      paintRect(tiles, 0, 0, 10, SECTOR_TILE_ROWS - 1, TileKind.Solid);
      paintRect(tiles, 2, 5, 9, 5, TileKind.Open);
      paintRect(tiles, 2, 1, 2, 4, TileKind.Open);
      paintRect(tiles, 1, 1, 3, 3, TileKind.Open);
    });
    const query = tileCentre(9, 5);
    const out = { x: 0, y: 0 };
    expect(findNearestFreeCircleSpot(world, query.x, query.y, SNAP_RADIUS, out)).toBe(true);
    expect(out.x).toBeLessThan(10 * TILE_SIZE);
    expect(isSolidAtWorld(world, out.x, out.y, MoverKind.Player)).toBe(false);
  });

  it('reports failure when the whole sector is solid', () => {
    const world = makeWorld(tiles => tiles.fill(TileKind.Solid));
    const query = tileCentre(5, 5);
    const out = { x: 0, y: 0 };
    expect(findNearestFreeCircleSpot(world, query.x, query.y, PLAYER_RADIUS, out)).toBe(false);
  });
});

describe('membrane directionality', () => {
  const MOUTH_ROW = 7;
  const ONE_WAY_EAST: EdgeDef = {
    kind: EdgeKind.OneWay, apertureStart: 6, apertureEnd: 8, passDirection: 'east',
  };

  function makeMembraneWorld(): WorldMap {
    const paintMouth = (tiles: Uint8Array, tileX: number): void => {
      for (let tileY = 6; tileY <= 8; tileY++) tiles[tileIndex(tileX, tileY)] = TileKind.GateClosed;
    };
    const west = makeSector(0, 0, tiles => paintMouth(tiles, SECTOR_TILE_COLS - 1), { east: ONE_WAY_EAST });
    const east = makeSector(1, 0, tiles => paintMouth(tiles, 0), { west: ONE_WAY_EAST });
    return {
      worldGenVersion: 1, seed: 1, startKey: '0,0',
      sectors: new Map([['0,0', west], ['1,0', east]]),
      abilityOrder: [], bossArenaKey: '0,0',
    };
  }

  const mouthTileX = SECTOR_TILE_COLS - 1;
  const mouthLeftFace = mouthTileX * TILE_SIZE;

  it('lets a player travelling with passDirection through', () => {
    const world = makeMembraneWorld();
    const start = tileCentre(mouthTileX - 1, MOUTH_ROW);
    const out = createCollisionResult();
    resolveCircleMove(
      world, start.x, start.y, start.x + 30, start.y,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.hitX).toBe(false);
    expect(out.x).toBeGreaterThan(mouthLeftFace);
  });

  it('blocks a player travelling against passDirection', () => {
    const world = makeMembraneWorld();
    const start = tileCentre(SECTOR_TILE_COLS + 1, MOUTH_ROW);
    const out = createCollisionResult();
    resolveCircleMove(
      world, start.x, start.y, start.x - 30, start.y,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.hitX).toBe(true);
    const eastFaceOfMouth = (SECTOR_TILE_COLS + 1) * TILE_SIZE + PLAYER_RADIUS;
    expect(Math.abs(out.x - eastFaceOfMouth)).toBeLessThanOrEqual(COLLISION_EPSILON * 2);
  });

  it('blocks an enemy in the pass direction too', () => {
    const world = makeMembraneWorld();
    const start = tileCentre(mouthTileX - 1, MOUTH_ROW);
    const out = createCollisionResult();
    resolveCircleMove(
      world, start.x, start.y, start.x + 30, start.y,
      PLAYER_RADIUS, MoverKind.Enemy, out,
    );
    expect(out.hitX).toBe(true);
  });

  it('passes projectile rays and stops enemy rays at the mouth', () => {
    const world = makeMembraneWorld();
    const from = tileCentre(mouthTileX - 1, MOUTH_ROW);
    const to = tileCentre(SECTOR_TILE_COLS + 1, MOUTH_ROW);
    expect(raycastSolid(world, from.x, from.y, to.x, to.y, MoverKind.Projectile)).toBe(1);
    expect(raycastSolid(world, from.x, from.y, to.x, to.y, MoverKind.Enemy)).toBeLessThan(1);
  });

  it('answers the motionless query as solid for movers and open for projectiles', () => {
    const world = makeMembraneWorld();
    const mouth = tileCentre(mouthTileX, MOUTH_ROW);
    expect(isSolidAtWorld(world, mouth.x, mouth.y, MoverKind.Player)).toBe(true);
    expect(isSolidAtWorld(world, mouth.x, mouth.y, MoverKind.Enemy)).toBe(true);
    expect(isSolidAtWorld(world, mouth.x, mouth.y, MoverKind.Projectile)).toBe(false);
  });
});

describe('void solidity and raycasting', () => {
  it('treats ungenerated space as a wall at the sector boundary', () => {
    const world = makeWorld(() => {});
    const start = tileCentre(SECTOR_TILE_COLS - 2, 5);
    const out = createCollisionResult();
    resolveCircleMove(
      world, start.x, start.y, start.x + 200, start.y,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    const boundary = SECTOR_TILE_COLS * TILE_SIZE - PLAYER_RADIUS;
    expect(Math.abs(out.x - boundary)).toBeLessThanOrEqual(COLLISION_EPSILON * 2);
    expect(out.hitX).toBe(true);
  });

  it('returns 1 for a clear segment', () => {
    const world = makeWorld(() => {});
    const from = tileCentre(2, 5);
    const to = tileCentre(9, 5);
    expect(raycastSolid(world, from.x, from.y, to.x, to.y, MoverKind.Player)).toBe(1);
  });

  it('returns the parameter at which the segment enters the wall', () => {
    const world = makeWorld(tiles => paintColumn(tiles, 10, TileKind.Solid));
    const from = tileCentre(2, 5);
    const to = tileCentre(20, 5);
    const t = raycastSolid(world, from.x, from.y, to.x, to.y, MoverKind.Player);
    expect(from.x + t * (to.x - from.x)).toBeCloseTo(10 * TILE_SIZE, 6);
  });

  it('returns 0 when the segment starts inside a solid tile', () => {
    const world = makeWorld(tiles => paintColumn(tiles, 10, TileKind.Solid));
    const from = tileCentre(10, 5);
    const to = tileCentre(20, 5);
    expect(raycastSolid(world, from.x, from.y, to.x, to.y, MoverKind.Player)).toBe(0);
  });
});

describe('generated worlds', () => {
  const INPUTS = {
    abilityGateOrder: ['blink_drive', 'breach_charges', 'magno_tether',
      'phase_cloak', 'thermal_ward', 'signal_decryptor'],
    availableBiomeIds: STAGES.map(stage => stage.id),
  };

  it('never leaves a player resolved inside a solid tile', () => {
    const out = createCollisionResult();
    for (let seedIndex = 0; seedIndex < 5; seedIndex++) {
      const world = generateWorld(seedIndex * 7919 + 12345, INPUTS);
      for (const sector of world.sectors.values()) {
        let openSeen = 0;
        let sampled = 0;
        for (let index = 0; index < SECTOR_TILE_COUNT && sampled < 12; index++) {
          if (sector.tiles[index] !== TileKind.Open) continue;
          if (openSeen++ % 47 !== 0) continue;
          sampled++;
          const localTileX = index % SECTOR_TILE_COLS;
          const localTileY = (index - localTileX) / SECTOR_TILE_COLS;
          const centre = tileCentre(
            sector.sx * SECTOR_TILE_COLS + localTileX,
            sector.sy * SECTOR_TILE_ROWS + localTileY,
          );
          for (const [moveX, moveY] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) {
            resolveCircleMove(
              world, centre.x, centre.y, centre.x + moveX, centre.y + moveY,
              PLAYER_RADIUS, MoverKind.Player, out,
            );
            const blocksPlayer = isSolidAtWorld(world, out.x, out.y, MoverKind.Player);
            const isOneWayMembrane = blocksPlayer
              && !isSolidAtWorld(world, out.x, out.y, MoverKind.Projectile);
            expect(blocksPlayer && !isOneWayMembrane).toBe(false);
          }
        }
      }
    }
  });
});

describe('a solid tile only blocks motion toward it', () => {
  it('does not fling a mover resting on a jamb corner to the far side of the wall', () => {
    const world = makeWorld(tiles => {
      paintColumn(tiles, 10, TileKind.Solid);
      tiles[tileIndex(10, 5)] = TileKind.Open;
    });
    const out = createCollisionResult();
    const offCentreY = 5 * TILE_SIZE + 30;

    resolveCircleMove(world, 300, offCentreY, 500, offCentreY, PLAYER_RADIUS, MoverKind.Player, out);
    expect(out.hitX).toBe(true);
    const restingX = out.x;

    for (const stepY of [-1, -6, -20]) {
      resolveCircleMove(
        world, restingX, offCentreY, restingX, offCentreY + stepY,
        PLAYER_RADIUS, MoverKind.Player, out,
      );
      expect(out.y).toBeCloseTo(offCentreY + stepY, 6);
      expect(out.hitY).toBe(false);
    }
  });

  it('still pushes an overlapping mover out on the side it came from', () => {
    const world = makeWorld(tiles => paintColumn(tiles, 10, TileKind.Solid));
    const out = createCollisionResult();
    const insideY = tileCentre(8, 5).y;
    const overlappingX = 10 * TILE_SIZE - 5;

    resolveCircleMove(
      world, overlappingX, insideY, overlappingX + 8, insideY,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.hitX).toBe(true);
    expect(out.x).toBeLessThanOrEqual(10 * TILE_SIZE - PLAYER_RADIUS);

    resolveCircleMove(
      world, overlappingX, insideY, overlappingX - 8, insideY,
      PLAYER_RADIUS, MoverKind.Player, out,
    );
    expect(out.x).toBeCloseTo(overlappingX - 8, 6);
  });
});
