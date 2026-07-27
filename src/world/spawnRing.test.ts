import { describe, test, expect } from 'vitest';

import { MINIMAP_WORLD_RANGE } from '../visual/minimapProjection';
import { rectContains, rectFromScreen } from './worldSpace';
import {
  LEASH_RADIUS,
  pickEdgeSpawnPoint,
  isBeyondLeash,
  repositionOntoSpawnRing,
} from './spawnRing';

const ARENA = rectFromScreen(1280, 720);
const REGULAR = { spawnOffset: 30, edgeInset: 0 };
const MINIBOSS = { spawnOffset: 50, edgeInset: 100 };

/** Scripted [0, 1) draws: the first picks the edge, the second the point along it. */
const scripted = (values: number[]): (() => number) => {
  let index = 0;
  return () => values[index++];
};

describe('pickEdgeSpawnPoint', () => {
  test('reproduces the legacy regular-enemy switch case by case', () => {
    expect(pickEdgeSpawnPoint(ARENA, REGULAR, scripted([0, 0.5]))).toEqual({ x: -30, y: 360 });
    expect(pickEdgeSpawnPoint(ARENA, REGULAR, scripted([0.25, 0.5]))).toEqual({ x: 1310, y: 360 });
    expect(pickEdgeSpawnPoint(ARENA, REGULAR, scripted([0.5, 0.5]))).toEqual({ x: 640, y: -30 });
    expect(pickEdgeSpawnPoint(ARENA, REGULAR, scripted([0.75, 0.5]))).toEqual({ x: 640, y: 750 });
  });

  test('reproduces the legacy miniboss switch, inset 100 from both corners', () => {
    expect(pickEdgeSpawnPoint(ARENA, MINIBOSS, scripted([0, 0]))).toEqual({ x: -50, y: 100 });
    expect(pickEdgeSpawnPoint(ARENA, MINIBOSS, scripted([0.25, 1]))).toEqual({ x: 1330, y: 620 });
    expect(pickEdgeSpawnPoint(ARENA, MINIBOSS, scripted([0.5, 0]))).toEqual({ x: 100, y: -50 });
    expect(pickEdgeSpawnPoint(ARENA, MINIBOSS, scripted([0.75, 1]))).toEqual({ x: 1180, y: 770 });
  });

  test('a draw of exactly 1 stays on the bottom edge instead of falling off the switch', () => {
    expect(pickEdgeSpawnPoint(ARENA, REGULAR, scripted([1, 0]))).toEqual({ x: 0, y: 750 });
  });

  test('every side spawns outside the view', () => {
    for (const side of [0, 0.25, 0.5, 0.75]) {
      const point = pickEdgeSpawnPoint(ARENA, REGULAR, scripted([side, 0.5]));
      expect(rectContains(ARENA, point.x, point.y)).toBe(false);
    }
  });

  test('offsets are measured from the rect, not from the world origin', () => {
    const shifted = { minX: 1280, minY: 720, maxX: 2560, maxY: 1440 };
    expect(pickEdgeSpawnPoint(shifted, REGULAR, scripted([0, 0]))).toEqual({ x: 1250, y: 720 });
    expect(pickEdgeSpawnPoint(shifted, REGULAR, scripted([0.25, 1]))).toEqual({ x: 2590, y: 1440 });
  });

  test('an inset wider than the edge pins to the inset instead of inverting the span', () => {
    const narrow = rectFromScreen(150, 150);
    expect(pickEdgeSpawnPoint(narrow, MINIBOSS, scripted([0, 0]))).toEqual({ x: -50, y: 100 });
    expect(pickEdgeSpawnPoint(narrow, MINIBOSS, scripted([0, 1]))).toEqual({ x: -50, y: 100 });
  });
});

describe('isBeyondLeash', () => {
  test('exactly on the radius is still leashed; past it is not', () => {
    expect(isBeyondLeash(0, 0, 0, 0, LEASH_RADIUS)).toBe(false);
    expect(isBeyondLeash(LEASH_RADIUS, 0, 0, 0, LEASH_RADIUS)).toBe(false);
    expect(isBeyondLeash(LEASH_RADIUS + 1, 0, 0, 0, LEASH_RADIUS)).toBe(true);
  });

  test('the leash is radial, not axis-aligned', () => {
    expect(isBeyondLeash(1200, 1200, 0, 0, LEASH_RADIUS)).toBe(true);
    expect(isBeyondLeash(1100, 1100, 0, 0, LEASH_RADIUS)).toBe(false);
  });

  test('the leash clears the radar range, so nothing tracked can pop', () => {
    expect(LEASH_RADIUS).toBeGreaterThan(MINIMAP_WORLD_RANGE);
  });
});

describe('repositionOntoSpawnRing', () => {
  test('lands on the same ring a fresh regular spawn would', () => {
    expect(repositionOntoSpawnRing(ARENA, 30, scripted([0.5, 0.5])))
      .toEqual(pickEdgeSpawnPoint(ARENA, REGULAR, scripted([0.5, 0.5])));
  });
});
