import { describe, test, expect } from 'vitest';
import {
  planStalkerVolley,
  STALKER_MAX_STRIKES,
} from './stalker-barrage';

describe('stalker-barrage planStalkerVolley', () => {
  test('never exceeds the telegraph-pool safety cap', () => {
    expect(planStalkerVolley(640, 360, 1, 0).length).toBeLessThanOrEqual(STALKER_MAX_STRIKES);
    expect(planStalkerVolley(640, 360, 0, 0).length).toBeLessThanOrEqual(STALKER_MAX_STRIKES);
  });

  test('moving: strikes march ahead along the heading from the player', () => {
    const strikes = planStalkerVolley(100, 100, 1, 0); // heading +x
    expect(strikes[0]).toMatchObject({ x: 100, y: 100 }); // first strike on the player
    expect(strikes[strikes.length - 1].x).toBeGreaterThan(strikes[0].x); // later strikes lead
    for (const s of strikes) expect(s.y).toBeCloseTo(100);
  });

  test('stationary: strikes bracket the player in a finite ring (no NaN)', () => {
    const strikes = planStalkerVolley(300, 300, 0, 0);
    for (const s of strikes) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
    expect(strikes.some((s) => s.x !== 300 || s.y !== 300)).toBe(true);
  });

  test('every strike has a positive fuse (all telegraphed)', () => {
    const strikes = planStalkerVolley(0, 0, 0.6, 0.8);
    expect(strikes.length).toBeGreaterThan(0);
    for (const s of strikes) expect(s.impactDelay).toBeGreaterThan(0);
  });

  test('is deterministic for equal inputs', () => {
    expect(planStalkerVolley(300, 300, 1, 0)).toEqual(planStalkerVolley(300, 300, 1, 0));
  });
});
