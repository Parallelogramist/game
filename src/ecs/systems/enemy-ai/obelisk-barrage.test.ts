import { describe, it, expect } from 'vitest';
import {
  planWallBarrage,
  wallRowsForPhase,
  obeliskStrikeDamage,
  OBELISK_BLAST_RADIUS,
} from './obelisk-barrage';

describe('obelisk wall barrage', () => {
  it('omits exactly one safe lane per row and stays pool-safe', () => {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      for (const phase of [1, 2, 3]) {
        const strikes = planWallBarrage(orientation, 0, phase);
        const rows = wallRowsForPhase(phase);
        const spanCount = orientation === 'horizontal' ? 7 : 5;
        // one column omitted per row → (spanCount - 1) strikes per row
        expect(strikes).toHaveLength((spanCount - 1) * rows);
        expect(strikes.length).toBeLessThanOrEqual(24); // well under the 32 telegraph pool
        expect(strikes.length).toBeLessThan(spanCount * rows); // a gap always exists
      }
    }
  });

  it('lands successive rows later — the wall marches', () => {
    const strikes = planWallBarrage('horizontal', 0, 3); // 3 rows
    const minDelay = Math.min(...strikes.map((s) => s.impactDelay));
    const maxDelay = Math.max(...strikes.map((s) => s.impactDelay));
    expect(maxDelay).toBeGreaterThan(minDelay);
  });

  it('shifts the safe lane between rows (forces repositioning)', () => {
    const strikes = planWallBarrage('horizontal', 0, 1); // 2 rows straddling y=360
    const rowYs = [...new Set(strikes.map((s) => s.y))].sort((a, b) => a - b);
    expect(rowYs).toHaveLength(2);
    const laneX = (rowY: number) => {
      const xs = strikes.filter((s) => s.y === rowY).map((s) => s.x).sort((a, b) => a - b);
      // the gap is the largest x-jump between adjacent strikes in the row
      let maxGapMid = xs[0];
      let maxGap = 0;
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] - xs[i - 1] > maxGap) { maxGap = xs[i] - xs[i - 1]; maxGapMid = (xs[i] + xs[i - 1]) / 2; }
      }
      return maxGapMid;
    };
    expect(laneX(rowYs[0])).not.toBeCloseTo(laneX(rowYs[1]), 0);
  });

  it('keeps all strike centres inside the arena', () => {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      for (const s of planWallBarrage(orientation, 2, 3)) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(1280);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(720);
      }
    }
  });

  it('scales damage with phase and exports the blast radius', () => {
    expect(obeliskStrikeDamage(1)).toBeLessThan(obeliskStrikeDamage(3));
    expect(OBELISK_BLAST_RADIUS).toBe(88);
  });
});
