import { describe, it, expect } from 'vitest';
import {
  planDivinerBarrage,
  divinerStrikeDamage,
  divinerFuseForPhase,
  divinerGapSlotsForPhase,
  DIVINER_BLAST_RADIUS,
  DIVINER_INNER_RADIUS,
  DIVINER_RING_SLOTS,
} from './diviner-barrage';

const CX = 640;
const CY = 360;

describe('diviner scrying-cage barrage', () => {
  it('fires the bullseye + ring(s) and stays pool-safe', () => {
    const p1 = planDivinerBarrage(CX, CY, 0, 1);
    const p2 = planDivinerBarrage(CX, CY, 0, 2);
    const p3 = planDivinerBarrage(CX, CY, 0, 3);
    expect(p1).toHaveLength(1 + (DIVINER_RING_SLOTS - 4)); // 13
    expect(p2).toHaveLength(1 + 2 * (DIVINER_RING_SLOTS - 3)); // 27
    expect(p3).toHaveLength(1 + 2 * (DIVINER_RING_SLOTS - 3)); // 27
    for (const strikes of [p1, p2, p3]) {
      expect(strikes.length).toBeLessThanOrEqual(32); // the telegraph pool
    }
  });

  it('aims: a strike lands on the sampled player position (the bullseye)', () => {
    const strikes = planDivinerBarrage(CX, CY, 0, 1);
    expect(strikes.some((s) => s.x === CX && s.y === CY)).toBe(true);
  });

  it('leaves a blind-spot gap wide enough to flee through (fair)', () => {
    // Tightest gap is 3 slots (phase 2+). The nearest ring strike to the gap-centre
    // radial line must sit farther than the blast radius, so the corridor is safe.
    const gapSlots = divinerGapSlotsForPhase(2);
    const slotAngle = (Math.PI * 2) / DIVINER_RING_SLOTS;
    const clearance = DIVINER_INNER_RADIUS * Math.sin(((gapSlots + 1) / 2) * slotAngle);
    expect(clearance).toBeGreaterThan(DIVINER_BLAST_RADIUS);
  });

  it('phase 2+ adds a concentric outer ring; phase 1 is a single ring', () => {
    const p1 = planDivinerBarrage(CX, CY, 0, 1);
    const p2 = planDivinerBarrage(CX, CY, 0, 2);
    const maxR1 = Math.max(...p1.map((s) => Math.hypot(s.x - CX, s.y - CY)));
    const maxR2 = Math.max(...p2.map((s) => Math.hypot(s.x - CX, s.y - CY)));
    expect(maxR2).toBeGreaterThan(maxR1);
  });

  it('drops strikes whose centre falls outside the arena (partial ring at a wall)', () => {
    const cornered = planDivinerBarrage(20, 20, 8, 2); // player jammed in a corner
    for (const s of cornered) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1280);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(720);
    }
    // Fewer strikes than a centred barrage — the wall side is dropped.
    expect(cornered.length).toBeLessThan(planDivinerBarrage(CX, CY, 8, 2).length);
  });

  it('scales damage and tightens the fuse with phase', () => {
    expect(divinerStrikeDamage(1)).toBe(21);
    expect(divinerStrikeDamage(3)).toBe(33);
    expect(divinerStrikeDamage(1)).toBeLessThan(divinerStrikeDamage(3));
    expect(divinerFuseForPhase(1)).toBeGreaterThan(divinerFuseForPhase(3));
    expect(DIVINER_BLAST_RADIUS).toBe(88);
  });
});
