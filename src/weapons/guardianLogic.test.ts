import { describe, test, expect } from 'vitest';
import {
  createGuardianState,
  tickGuardian,
  tryTrigger,
  computeRetaliationDamage,
} from './guardianLogic';

const COOLDOWN = 1.5;

describe('createGuardianState', () => {
  test('starts ready to retaliate on the first hit', () => {
    expect(createGuardianState().cooldownRemaining).toBe(0);
  });
});

describe('tryTrigger — internal cooldown gating', () => {
  test('fires when ready and arms the cooldown', () => {
    const result = tryTrigger(createGuardianState(), COOLDOWN);
    expect(result.triggered).toBe(true);
    expect(result.state.cooldownRemaining).toBe(COOLDOWN);
  });

  test('a second hit in the same instant does NOT fire (swarm chain-detonation guard)', () => {
    const first = tryTrigger(createGuardianState(), COOLDOWN);
    const second = tryTrigger(first.state, COOLDOWN);
    expect(second.triggered).toBe(false);
    expect(second.state.cooldownRemaining).toBe(COOLDOWN); // unchanged, not re-armed
  });

  test('fires again only once the cooldown has fully ticked down', () => {
    let state = tryTrigger(createGuardianState(), COOLDOWN).state;
    // Not yet ready partway through the cooldown.
    state = tickGuardian(state, 1.0);
    expect(tryTrigger(state, COOLDOWN).triggered).toBe(false);
    // Ready once the rest of the cooldown has elapsed.
    state = tickGuardian(state, 0.6);
    expect(tryTrigger(state, COOLDOWN).triggered).toBe(true);
  });

  test('negative cooldown is clamped to a ready (0) state, not a negative arm', () => {
    const result = tryTrigger(createGuardianState(), -5);
    expect(result.triggered).toBe(true);
    expect(result.state.cooldownRemaining).toBe(0);
  });
});

describe('tickGuardian', () => {
  test('never drives the cooldown below 0', () => {
    const armed = { cooldownRemaining: 0.2 };
    expect(tickGuardian(armed, 5).cooldownRemaining).toBe(0);
  });

  test('returns the same object once ready (no per-frame allocation)', () => {
    const ready = createGuardianState();
    expect(tickGuardian(ready, 0.016)).toBe(ready);
  });
});

describe('computeRetaliationDamage', () => {
  test('adds a fraction of the provoking hit to base damage', () => {
    // 20 base + 60% of a 30 hit = 20 + 18 = 38.
    expect(computeRetaliationDamage(20, 30, 0.6, 1.5)).toBeCloseTo(38, 5);
  });

  test('caps the bonus at a multiple of base damage (crushing boss hit does not spike)', () => {
    // 20 base, cap 1.5× = +30 max; a 500 hit would add 300 uncapped.
    expect(computeRetaliationDamage(20, 500, 0.6, 1.5)).toBeCloseTo(50, 5);
  });

  test('a zero or negative hit contributes no bonus (never below base)', () => {
    expect(computeRetaliationDamage(20, 0, 0.6, 1.5)).toBe(20);
    expect(computeRetaliationDamage(20, -100, 0.6, 1.5)).toBe(20);
  });
});
