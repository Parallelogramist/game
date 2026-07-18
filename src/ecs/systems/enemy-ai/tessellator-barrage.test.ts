import { describe, it, expect } from 'vitest';
import {
  planCheckerBarrage,
  tessellatorStrikeDamage,
  tessellatorSweepStepForPhase,
  TESSELLATOR_BLAST_RADIUS,
  type SweepAxis,
} from './tessellator-barrage';

const AXES: SweepAxis[] = ['left', 'right', 'up', 'down'];

describe('tessellator checkerboard barrage', () => {
  it('fires exactly half the board (20 of 40) and stays pool-safe', () => {
    for (const parity of [0, 1] as const) {
      for (const axis of AXES) {
        for (const phase of [1, 2, 3]) {
          const strikes = planCheckerBarrage(parity, axis, phase);
          expect(strikes).toHaveLength(20);
          expect(strikes.length).toBeLessThanOrEqual(32); // the telegraph pool
        }
      }
    }
  });

  it('never overlaps the two parities — a safe checkerboard always exists', () => {
    const even = planCheckerBarrage(0, 'left', 1).map((s) => `${s.x},${s.y}`);
    const odd = planCheckerBarrage(1, 'left', 1).map((s) => `${s.x},${s.y}`);
    for (const point of even) expect(odd).not.toContain(point);
    // 40 tiles total across the two parities, none shared.
    expect(new Set([...even, ...odd]).size).toBe(40);
  });

  it('keeps every safe-tile centre clear of all blasts (fair)', () => {
    const danger = planCheckerBarrage(0, 'left', 3);
    const safe = planCheckerBarrage(1, 'left', 3);
    for (const s of safe) {
      for (const d of danger) {
        const dist = Math.hypot(s.x - d.x, s.y - d.y);
        expect(dist).toBeGreaterThan(TESSELLATOR_BLAST_RADIUS);
      }
    }
  });

  it('phase 1 is simultaneous; phase 2+ rolls a sweep wave', () => {
    const p1 = planCheckerBarrage(0, 'left', 1);
    expect(new Set(p1.map((s) => s.impactDelay)).size).toBe(1); // all land together
    expect(tessellatorSweepStepForPhase(1)).toBe(0);
    const p3 = planCheckerBarrage(0, 'left', 3);
    expect(Math.max(...p3.map((s) => s.impactDelay)))
      .toBeGreaterThan(Math.min(...p3.map((s) => s.impactDelay)));
  });

  it('keeps all strike centres inside the arena', () => {
    for (const axis of AXES) {
      for (const s of planCheckerBarrage(1, axis, 3)) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(1280);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(720);
      }
    }
  });

  it('scales damage with phase and exports the blast radius', () => {
    expect(tessellatorStrikeDamage(1)).toBeLessThan(tessellatorStrikeDamage(3));
    expect(tessellatorStrikeDamage(1)).toBe(22);
    expect(tessellatorStrikeDamage(3)).toBe(32);
    expect(TESSELLATOR_BLAST_RADIUS).toBe(108);
  });
});
