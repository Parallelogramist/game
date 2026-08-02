/**
 * The cascade fails silently when its ordering is wrong: every cell still appears, just in the
 * wrong order or (for a straggler the walk never reaches) never at all. These pin the walk, the
 * disconnected-slice fallback and the timing window.
 */

import { describe, expect, it } from 'vitest';
import { EdgeKind, SECTOR_TILE_COUNT, TileKind, WALL_EDGE } from '../world/worldTypes';
import type { EdgeDef, SectorDef, WorldMap } from '../world/worldTypes';
import {
  MAP_REVEAL_CASCADE_MS, MAP_REVEAL_CELL_FADE_MS,
  planMapOpenReveal, sampleMapOpenReveal,
} from './mapReveal';

const OPEN_EDGE: EdgeDef = { kind: EdgeKind.Open, apertureStart: 0, apertureEnd: 3 };

/** A west-to-east chain of `count` sectors, with `gapAt` breaking the chain into two pieces. */
function makeChainWorld(count: number, gapAt = -1): WorldMap {
  const sectors = new Map<string, SectorDef>();
  for (let sx = 0; sx < count; sx++) {
    const openEast = sx < count - 1 && sx !== gapAt;
    const openWest = sx > 0 && sx - 1 !== gapAt;
    sectors.set(`${sx},0`, {
      sx, sy: 0, key: `${sx},0`, biomeId: 'stage_deep_void', danger: 0,
      tiles: new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open),
      edges: {
        north: WALL_EDGE, south: WALL_EDGE,
        east: openEast ? OPEN_EDGE : WALL_EDGE,
        west: openWest ? OPEN_EDGE : WALL_EDGE,
      },
      poiSlots: [], isStart: sx === 0, isBossArena: false, depth: sx, hidden: false,
      entryTiles: {}, breakables: [],
    });
  }
  return { worldGenVersion: 1, seed: 1, startKey: '0,0', sectors,
    abilityOrder: [], bossArenaKey: `${count - 1},0` };
}

describe('planMapOpenReveal', () => {
  it('hops outward from the first granted sector through open edges only', () => {
    const plan = planMapOpenReveal(makeChainWorld(4), ['0,0', '1,0', '2,0', '3,0'], []);
    expect([...plan.hopBySectorKey]).toEqual([['0,0', 0], ['1,0', 1], ['2,0', 2], ['3,0', 3]]);
    expect(plan.durationMs).toBe(MAP_REVEAL_CASCADE_MS);
  });

  it('lands a sector the walk cannot reach one hop behind everything it did reach', () => {
    const plan = planMapOpenReveal(makeChainWorld(4, 1), ['0,0', '1,0', '2,0', '3,0'], []);
    expect(plan.hopBySectorKey.get('1,0')).toBe(1);
    expect(plan.hopBySectorKey.get('2,0')).toBe(2);
    expect(plan.hopBySectorKey.get('3,0')).toBe(2);
  });

  it('has nothing to play when nothing changed', () => {
    expect(planMapOpenReveal(makeChainWorld(2), [], []).durationMs).toBe(0);
  });
});

describe('sampleMapOpenReveal', () => {
  it('fades each cell over one window and finishes the last exactly at the cascade length', () => {
    const plan = planMapOpenReveal(makeChainWorld(3), ['0,0', '1,0', '2,0'], []);
    expect(sampleMapOpenReveal(plan, 0).cascadeAlphaBySectorKey.get('0,0')).toBe(0);
    expect(sampleMapOpenReveal(plan, MAP_REVEAL_CELL_FADE_MS)
      .cascadeAlphaBySectorKey.get('0,0')).toBe(1);
    expect(sampleMapOpenReveal(plan, MAP_REVEAL_CELL_FADE_MS)
      .cascadeAlphaBySectorKey.get('2,0')).toBe(0);
    expect(sampleMapOpenReveal(plan, MAP_REVEAL_CASCADE_MS)
      .cascadeAlphaBySectorKey.get('2,0')).toBe(1);
  });
});
