import { describe, it, expect } from 'vitest';
import {
  planSpiralBarrage,
  spiralArmsForPhase,
  helixStrikeDamage,
  HELIX_BLAST_RADIUS,
} from './helix-barrage';

describe('helix spiral barrage', () => {
  it('is pool-safe and non-empty for every phase', () => {
    for (const phase of [1, 2, 3]) {
      const strikes = planSpiralBarrage(0, phase);
      const arms = spiralArmsForPhase(phase);
      expect(strikes.length).toBeGreaterThanOrEqual(arms * 3); // inner strikes always fit
      expect(strikes.length).toBeLessThanOrEqual(arms * 9);     // STRIKES_PER_ARM cap
      expect(strikes.length).toBeLessThanOrEqual(32);           // telegraph pool
    }
  });

  it('unfurls outward — later strikes land after earlier ones', () => {
    const strikes = planSpiralBarrage(0.5, 3);
    const minDelay = Math.min(...strikes.map((s) => s.impactDelay));
    const maxDelay = Math.max(...strikes.map((s) => s.impactDelay));
    expect(maxDelay).toBeGreaterThan(minDelay);
  });

  it('curves — the first arm rotates from strike to strike (not a straight spoke)', () => {
    const strikes = planSpiralBarrage(0, 1);
    // arm 0 strikes are the first STRIKES_PER_ARM entries that were kept, in k order;
    // their polar angle from centre must strictly advance.
    const angleOf = (s: { x: number; y: number }) => Math.atan2(s.y - 360, s.x - 640);
    const armGap = angleOf(strikes[1]) - angleOf(strikes[0]);
    expect(Math.abs(armGap)).toBeGreaterThan(0.05);
  });

  it('keeps all strike centres inside the arena', () => {
    for (const phase of [1, 2, 3]) {
      for (const baseAngle of [0, 1, 2, 3]) {
        for (const s of planSpiralBarrage(baseAngle, phase)) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(1280);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(720);
        }
      }
    }
  });

  it('scales damage with phase and exports the blast radius', () => {
    expect(helixStrikeDamage(1)).toBeLessThan(helixStrikeDamage(3));
    expect(HELIX_BLAST_RADIUS).toBe(60);
  });
});
