/**
 * The fallback rung under line of sight and the flow field. Its failure mode is silent: a wrong
 * side still produces plausible motion, just motion that never gets round the wall.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { chaseHeading, setNavigationContext } from './common';
import type { NavigationContext } from './common';

const TILE = 40;
const tileOf = (worldCoord: number): number => Math.floor(worldCoord / TILE);

function routelessContextWhereSolid(
  isSolid: (x: number, y: number) => boolean,
): NavigationContext {
  return {
    hasLineOfSight: () => false,
    flowStep: () => false,
    freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
    isSolidAt: isSolid,
  };
}

afterEach(() => setNavigationContext(null));

describe('chaseHeading fallback when there is no line of sight and no flow route', () => {
  it('turns along the wall instead of pressing into it', () => {
    setNavigationContext(routelessContextWhereSolid(x => tileOf(x) === 3));

    const heading = chaseHeading(100, 100, 500, 100, 1, 0);

    expect(heading.x).toBeCloseTo(0);
    expect(heading.y).toBeCloseTo(1);
  });

  it('turns toward the end of the wall when one side opens up sooner', () => {
    setNavigationContext(
      routelessContextWhereSolid((x, y) => tileOf(x) === 3 && tileOf(y) >= 3),
    );

    const heading = chaseHeading(100, 140, 500, 140, 1, 0);

    expect(heading.x).toBeCloseTo(0);
    expect(heading.y).toBeCloseTo(-1);
  });

  it('keeps the direct vector in a dead end, where no tangent is open', () => {
    setNavigationContext(
      routelessContextWhereSolid((x, y) => tileOf(x) === 3 || tileOf(y) === 1 || tileOf(y) === 3),
    );

    const heading = chaseHeading(100, 100, 500, 100, 1, 0);

    expect(heading.x).toBeCloseTo(1);
    expect(heading.y).toBeCloseTo(0);
  });

  it('leaves the direct vector alone when nothing is ahead', () => {
    setNavigationContext(routelessContextWhereSolid(() => false));

    const heading = chaseHeading(100, 100, 500, 20, 0.9806, -0.1961);

    expect(heading.x).toBeCloseTo(0.9806);
    expect(heading.y).toBeCloseTo(-0.1961);
  });

  it('never probes at all while a flow route exists', () => {
    let probes = 0;
    setNavigationContext({
      hasLineOfSight: () => false,
      flowStep: (_x, _y, out) => { out.x = 140; out.y = 100; return true; },
      freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
      isSolidAt: () => { probes++; return true; },
    });

    const heading = chaseHeading(100, 100, 500, 100, 1, 0);

    expect(probes).toBe(0);
    expect(heading.x).toBeCloseTo(1);
    expect(heading.y).toBeCloseTo(0);
  });
});
