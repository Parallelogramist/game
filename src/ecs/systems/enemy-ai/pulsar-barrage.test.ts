import { describe, it, expect } from 'vitest';
import {
  planSpokeBarrage,
  planCollapseBarrage,
  spokeCountForPhase,
  pulsarStrikeDamage,
  PULSAR_BLAST_RADIUS,
} from './pulsar-barrage';

describe('pulsar spoke barrage', () => {
  it('produces spokeCount x strikesPerArm strikes, capped for pool safety', () => {
    for (const phase of [1, 2, 3]) {
      const strikes = planSpokeBarrage(0, 0, 0, phase);
      expect(strikes).toHaveLength(spokeCountForPhase(phase) * 2);
      expect(strikes.length).toBeLessThanOrEqual(12); // well under the 32 telegraph pool
    }
  });

  it('spaces arms evenly and travels outward along each arm', () => {
    const strikes = planSpokeBarrage(0, 0, 0, 1); // 4 arms x 2 = 8
    // Two strikes per arm: the outer (index 1,3,5,7) lands after the inner.
    for (let arm = 0; arm < 4; arm++) {
      const inner = strikes[arm * 2];
      const outer = strikes[arm * 2 + 1];
      expect(Math.hypot(outer.x, outer.y)).toBeGreaterThan(Math.hypot(inner.x, inner.y));
      expect(outer.impactDelay).toBeGreaterThan(inner.impactDelay);
    }
  });

  it('scales damage with phase', () => {
    expect(pulsarStrikeDamage(1)).toBeLessThan(pulsarStrikeDamage(3));
  });
});

describe('pulsar collapse barrage', () => {
  it('lands outer ring before inner ring and stays pool-safe', () => {
    const strikes = planCollapseBarrage(640, 360, 2, 0);
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.length).toBeLessThanOrEqual(16); // well under the 32 telegraph pool
    const outer = strikes.filter((s) => Math.hypot(s.x - 640, s.y - 360) > 200);
    const inner = strikes.filter((s) => Math.hypot(s.x - 640, s.y - 360) <= 200);
    const maxOuterDelay = Math.max(...outer.map((s) => s.impactDelay));
    const minInnerDelay = Math.min(...inner.map((s) => s.impactDelay));
    expect(maxOuterDelay).toBeLessThan(minInnerDelay); // safe zone collapses inward
  });

  it('omits a gap sector on each ring (escape lane exists)', () => {
    const strikes = planCollapseBarrage(0, 0, 2, 0);
    // Full rings would be 9 + 6 = 15 strikes; the gap removes at least one.
    expect(strikes.length).toBeLessThan(15);
  });

  it('blast radius constant is exported', () => {
    expect(PULSAR_BLAST_RADIUS).toBe(60);
  });
});
