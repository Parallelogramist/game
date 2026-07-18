import { describe, test, expect } from 'vitest';
import {
  planMortarCluster,
  BOMBARD_MAX_STRIKES,
} from './bombard-barrage';

describe('bombard-barrage planMortarCluster', () => {
  test('never exceeds the telegraph-pool safety cap', () => {
    for (let r = 0; r < 12; r++) {
      const strikes = planMortarCluster(640, 360, (r * Math.PI) / 6);
      expect(strikes.length).toBeLessThanOrEqual(BOMBARD_MAX_STRIKES);
    }
  });

  test('always includes the center strike at the target', () => {
    const strikes = planMortarCluster(200, 150, 0.4);
    expect(strikes[0]).toMatchObject({ x: 200, y: 150 });
  });

  test('every strike has a positive fuse (all telegraphed)', () => {
    const strikes = planMortarCluster(0, 0, 1.1);
    expect(strikes.length).toBeGreaterThan(0);
    for (const s of strikes) expect(s.impactDelay).toBeGreaterThan(0);
  });

  test('is deterministic for equal inputs', () => {
    expect(planMortarCluster(300, 300, 0.7)).toEqual(planMortarCluster(300, 300, 0.7));
  });
});
