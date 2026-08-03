import { describe, test, expect } from 'vitest';
import { generateWorld } from '../world/generateWorld';
import { STAGES } from '../data/Stages';
import { describeSectorCourse, plotSectorCourse } from './sectorRoute';
import type { SectorCourseInputs } from './sectorRoute';
import { EdgeFlags } from './DiscoveryTypes';
import { EdgeKind, SECTOR_TILE_COUNT, WALL_EDGE, WORLDGEN_VERSION } from '../world/worldTypes';
import type { EdgeDef, EdgeDirection, SectorDef, WorldMap } from '../world/worldTypes';

const OPEN_WORLD = generateWorld(20260727, {
  abilityGateOrder: [],
  availableBiomeIds: STAGES.map(stage => stage.id),
});

const GATED_WORLD = generateWorld(20260727, {
  abilityGateOrder: ['ability_blink_drive', 'ability_magno_tether'],
  availableBiomeIds: STAGES.map(stage => stage.id),
});

function courseOn(
  map: WorldMap, fromSectorKey: string, toSectorKey: string,
  overrides: Partial<SectorCourseInputs> = {},
) {
  return plotSectorCourse({
    map,
    fromSectorKey,
    toSectorKey,
    sectorFlagsOf: () => 1,
    edgeFlagsOf: () => EdgeFlags.KNOWN,
    holdsAbility: () => true,
    holdsQuestKey: () => true,
    ...overrides,
  });
}

function twoSectorMap(edge: EdgeDef): WorldMap {
  const makeSector = (sx: number, edges: Partial<Record<EdgeDirection, EdgeDef>>): SectorDef => ({
    sx, sy: 0, key: `${sx},0`, biomeId: STAGES[0].id, danger: 0,
    tiles: new Uint8Array(SECTOR_TILE_COUNT), poiSlots: [],
    edges: { north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE, ...edges },
    isStart: sx === 0, isBossArena: false, depth: sx, entryTiles: {}, breakables: [],
  });
  // The same EdgeDef object on both sides, exactly as WALL_EDGE is shared by reference:
  // passDirection is an ABSOLUTE lattice direction, identical from either room.
  const sectors = new Map<string, SectorDef>([
    ['0,0', makeSector(0, { east: edge })],
    ['1,0', makeSector(1, { west: edge })],
  ]);
  return {
    worldGenVersion: WORLDGEN_VERSION, seed: 1, startKey: '0,0', sectors,
    abilityOrder: [], bossArenaKey: '1,0',
  };
}

describe('plotSectorCourse', () => {
  test('the focused room being the ship room is here, not a zero-hop course', () => {
    expect(courseOn(OPEN_WORLD, OPEN_WORLD.startKey, OPEN_WORLD.startKey))
      .toEqual({ kind: 'here' });
  });

  test('a plotted course is a chain of grid-adjacent rooms from ship to target', () => {
    const course = courseOn(OPEN_WORLD, OPEN_WORLD.startKey, OPEN_WORLD.bossArenaKey);
    expect(course.kind).toBe('plotted');
    if (course.kind !== 'plotted') return;
    expect(course.sectorKeys[0]).toBe(OPEN_WORLD.startKey);
    expect(course.sectorKeys[course.sectorKeys.length - 1]).toBe(OPEN_WORLD.bossArenaKey);
    for (let step = 0; step + 1 < course.sectorKeys.length; step++) {
      const [ax, ay] = course.sectorKeys[step].split(',').map(Number);
      const [bx, by] = course.sectorKeys[step + 1].split(',').map(Number);
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
    }
  });

  test('a room behind a door the profile cannot open is blocked, and names what opens it', () => {
    const blocked = [...GATED_WORLD.sectors.keys()]
      .map(key => courseOn(GATED_WORLD, GATED_WORLD.startKey, key, { holdsAbility: () => false }))
      .find(course => course.kind === 'blocked');
    expect(blocked).toBeDefined();
    if (blocked === undefined || blocked.kind !== 'blocked') return;
    expect(blocked.requirements.length).toBeGreaterThan(0);
    expect(blocked.requirements).not.toContain('an unknown mechanism');
  });

  test('an uncharted world charts no course', () => {
    expect(courseOn(OPEN_WORLD, OPEN_WORLD.startKey, OPEN_WORLD.bossArenaKey,
      { sectorFlagsOf: () => 0 })).toEqual({ kind: 'none' });
  });

  test('an unknown edge is not crossable, so nothing beyond the ship room is reachable', () => {
    expect(courseOn(OPEN_WORLD, OPEN_WORLD.startKey, OPEN_WORLD.bossArenaKey,
      { edgeFlagsOf: () => 0 })).toEqual({ kind: 'none' });
  });

  test('a one-way membrane passes one way and is not merely a gate to relax', () => {
    const map = twoSectorMap({
      kind: EdgeKind.OneWay, apertureStart: 0, apertureEnd: 2, passDirection: 'east',
    });
    const outward = courseOn(map, '0,0', '1,0');
    expect(outward.kind).toBe('plotted');
    if (outward.kind === 'plotted') expect(outward.sectorKeys).toEqual(['0,0', '1,0']);
    expect(courseOn(map, '1,0', '0,0')).toEqual({ kind: 'none' });
  });
});

describe('describeSectorCourse', () => {
  test('one hop is singular, and a blocked course says what shuts it', () => {
    expect(describeSectorCourse({ kind: 'plotted', sectorKeys: ['0,0', '1,0'] }))
      .toBe('Course 1 hop');
    expect(describeSectorCourse({ kind: 'plotted', sectorKeys: ['0,0', '1,0', '2,0'] }))
      .toBe('Course 2 hops');
    expect(describeSectorCourse({
      kind: 'blocked', sectorKeys: ['0,0', '1,0'], requirements: ['Blink Drive'],
    })).toBe('Course 1 hop · blocked by Blink Drive');
    expect(describeSectorCourse({ kind: 'here' })).toBe('You are here');
    expect(describeSectorCourse({ kind: 'none' })).toBe('No charted course');
  });
});
