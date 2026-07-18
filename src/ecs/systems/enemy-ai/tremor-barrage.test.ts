import { describe, it, expect } from 'vitest';
import {
  planTremorBarrage,
  tremorStrikeDamage,
  tremorRingStepForPhase,
  TREMOR_BLAST_RADIUS,
  TREMOR_EPICENTERS,
} from './tremor-barrage';

describe('tremor shockwave barrage', () => {
  it('fires every tile (24) once and stays pool-safe', () => {
    for (const phase of [1, 2, 3]) {
      const epicenters =
        phase >= 2
          ? [TREMOR_EPICENTERS[0], TREMOR_EPICENTERS[2]]
          : [TREMOR_EPICENTERS[0]];
      const strikes = planTremorBarrage(epicenters, phase);
      expect(strikes).toHaveLength(24);
      expect(strikes.length).toBeLessThanOrEqual(32); // the telegraph pool
    }
  });

  it('ripples outward — the epicenter tile lands first, a far tile last', () => {
    const strikes = planTremorBarrage([TREMOR_EPICENTERS[0]], 1); // epicenter (0,0)
    const minDelay = Math.min(...strikes.map((s) => s.impactDelay));
    const maxDelay = Math.max(...strikes.map((s) => s.impactDelay));
    expect(maxDelay).toBeGreaterThan(minDelay);
    // The earliest strike is the top-left tile centre (the epicenter corner).
    const earliest = strikes.reduce((a, b) => (a.impactDelay <= b.impactDelay ? a : b));
    expect(earliest.x).toBeLessThan(1280 / 6); // leftmost column
    expect(earliest.y).toBeLessThan(720 / 4);  // top row
  });

  it('blast radius stays under the min neighbour-centre spacing (fair)', () => {
    // 6×4 tiles → 180px vertical / 213px horizontal centre spacing. A player on a
    // not-currently-detonating tile centre must sit outside a detonating tile's blast.
    expect(TREMOR_BLAST_RADIUS).toBeLessThan(180);
  });

  it('two epicenters converge — nothing is more than half the board from a wave', () => {
    const single = planTremorBarrage([TREMOR_EPICENTERS[0]], 3);
    const dual = planTremorBarrage([TREMOR_EPICENTERS[0], TREMOR_EPICENTERS[2]], 3);
    expect(Math.max(...dual.map((s) => s.impactDelay)))
      .toBeLessThan(Math.max(...single.map((s) => s.impactDelay)));
  });

  it('keeps all strike centres inside the arena', () => {
    for (const s of planTremorBarrage([TREMOR_EPICENTERS[0], TREMOR_EPICENTERS[2]], 3)) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1280);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(720);
    }
  });

  it('scales damage with phase and exports the blast radius', () => {
    expect(tremorStrikeDamage(1)).toBeLessThan(tremorStrikeDamage(3));
    expect(tremorStrikeDamage(1)).toBe(20);
    expect(tremorStrikeDamage(3)).toBe(32);
    expect(tremorRingStepForPhase(1)).toBeGreaterThan(tremorRingStepForPhase(3));
    expect(TREMOR_BLAST_RADIUS).toBe(140);
  });
});
