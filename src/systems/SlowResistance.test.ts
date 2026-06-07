import { describe, test, expect } from 'vitest';
import { resolveSlowAfterResistance } from './SlowResistance';

describe('resolveSlowAfterResistance', () => {
  // --- Regression lock: at resistance 0 the output must be byte-identical to the
  // raw slow, so wiring the previously-dead stat can never change an existing run.
  test('returns the raw slow unchanged when resistance is 0 (regression lock)', () => {
    expect(resolveSlowAfterResistance(0.85, 0)).toBe(0.85);
    expect(resolveSlowAfterResistance(0.5, 0)).toBe(0.5);
  });

  test('grants full immunity (multiplier 1.0) at resistance 1.0', () => {
    expect(resolveSlowAfterResistance(0.5, 1.0)).toBe(1.0);
    expect(resolveSlowAfterResistance(0.2, 1.0)).toBe(1.0);
  });

  test('reduces only the slow penalty (the deviation from 1.0) by the resistance fraction', () => {
    // raw 0.5 → penalty 0.5; 40% resistance keeps 60% of the penalty (0.3) → 0.7
    expect(resolveSlowAfterResistance(0.5, 0.4)).toBeCloseTo(0.7, 10);
    // raw 0.8 → penalty 0.2; 25% resistance → penalty 0.15 → 0.85
    expect(resolveSlowAfterResistance(0.8, 0.25)).toBeCloseTo(0.85, 10);
  });

  test('clamps resistance above 1.0 to full immunity (never speeds the player up)', () => {
    expect(resolveSlowAfterResistance(0.5, 1.5)).toBe(1.0);
  });

  test('clamps negative resistance to 0 (raw slow unchanged)', () => {
    expect(resolveSlowAfterResistance(0.7, -0.3)).toBe(0.7);
  });

  test('treats a non-finite resistance as 0 — no resistance applied', () => {
    expect(resolveSlowAfterResistance(0.7, NaN)).toBe(0.7);
    expect(resolveSlowAfterResistance(0.7, Infinity)).toBe(0.7);
    expect(resolveSlowAfterResistance(0.7, -Infinity)).toBe(0.7);
  });

  test('passes a non-slow (raw >= 1.0) through unchanged regardless of resistance', () => {
    expect(resolveSlowAfterResistance(1.0, 0.5)).toBe(1.0);
  });

  test('returns 1.0 (no slow) for a non-finite raw slow multiplier', () => {
    expect(resolveSlowAfterResistance(NaN, 0.5)).toBe(1.0);
    expect(resolveSlowAfterResistance(Infinity, 0.5)).toBe(1.0);
  });

  test('compounds correctly for stacked Warden auras (0.85 per warden)', () => {
    // two wardens → 0.85 * 0.85 = 0.7225; 50% resistance keeps half the 0.2775 penalty
    const twoWardens = 0.85 * 0.85;
    expect(resolveSlowAfterResistance(twoWardens, 0.5)).toBeCloseTo(1 - (1 - twoWardens) * 0.5, 10);
  });

  test('never returns a multiplier outside [0, 1]', () => {
    const result = resolveSlowAfterResistance(0.5, 0.9);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
