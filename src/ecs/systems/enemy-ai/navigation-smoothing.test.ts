/**
 * The damping in chaseHeading fails silently in both directions: too little and enemies twitch
 * at doorway edges, too much and they steer like barges. These pin the windows, not the code.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  chaseHeading, setNavigationContext, setNavFrame, advanceNavClock, resetEnemyNavState,
} from './common';
import type { NavigationContext } from './common';

/** Line of sight is whatever the stub says; the route always steps one tile north. */
function context(hasLineOfSight: () => boolean): NavigationContext {
  return {
    hasLineOfSight,
    flowStep: (x, y, out) => { out.x = x; out.y = y - 40; return true; },
    isSolidAt: () => false,
    freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
  };
}

/** One AI tick for enemy 1 standing at the origin with the player 500px east. */
function tick(deltaSeconds = 0.016): { x: number; y: number } {
  advanceNavClock(deltaSeconds);
  setNavFrame(1, deltaSeconds);
  const heading = chaseHeading(0, 0, 500, 0, 1, 0);
  return { x: heading.x, y: heading.y };
}

afterEach(() => {
  setNavigationContext(null);
  resetEnemyNavState();
});

describe('line of sight hysteresis', () => {
  it('never switches mode for a ray alternating on a doorway edge', () => {
    let clear = true;
    setNavigationContext(context(() => { clear = !clear; return !clear; }));

    for (let i = 0; i < 40; i++) {
      const heading = tick();
      expect(heading.x).toBeCloseTo(1);
      expect(heading.y).toBeCloseTo(0);
    }
  });

  it('follows a line-of-sight loss that holds past the commit window', () => {
    let clear = true;
    setNavigationContext(context(() => clear));
    tick();
    clear = false;

    // 0.016 x 6 = 0.096s of disagreement, still short of the 0.1s window.
    for (let i = 0; i < 6; i++) {
      expect(tick().y).toBe(0);
    }
    expect(tick().y).toBeLessThan(-0.2);
  });
});

describe('heading easing', () => {
  it('eases toward a new route instead of snapping to it', () => {
    let north = true;
    setNavigationContext({
      hasLineOfSight: () => false,
      flowStep: (x, y, out) => { out.x = north ? x : x + 40; out.y = north ? y - 40 : y; return true; },
      isSolidAt: () => false,
      freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
    });

    expect(tick().y).toBeCloseTo(-1);
    north = false;
    const eased = tick();
    expect(eased.x).toBeGreaterThan(0);
    expect(eased.x).toBeLessThan(0.5);
    expect(eased.y).toBeLessThan(-0.5);
  });

  it('snaps for a far enemy, whose LOD tick is already longer than the window', () => {
    let north = true;
    setNavigationContext({
      hasLineOfSight: () => false,
      flowStep: (x, y, out) => { out.x = north ? x : x + 40; out.y = north ? y - 40 : y; return true; },
      isSolidAt: () => false,
      freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
    });

    tick(0.096);
    north = false;
    expect(tick(0.096).x).toBeCloseTo(1);
  });

  it('re-seeds a slot the handler has not steered through for a quarter second', () => {
    let north = true;
    setNavigationContext({
      hasLineOfSight: () => false,
      flowStep: (x, y, out) => { out.x = north ? x : x + 40; out.y = north ? y - 40 : y; return true; },
      isSolidAt: () => false,
      freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
    });

    tick();
    north = false;
    advanceNavClock(0.3);
    expect(tick().x).toBeCloseTo(1);
  });
});
