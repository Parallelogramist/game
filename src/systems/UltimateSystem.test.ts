import { describe, test, expect, beforeEach } from 'vitest';

import {
  resetUltimateSystem,
  addUltimateChargeFromKill,
  addUltimateChargeFromDamage,
  addUltimateCharge,
  getUltimateCharge,
  getUltimateChargeRatio,
  isUltimateReady,
  tryActivateUltimate,
  setUltimateChargeSuppressed,
  setUltimateChargeRateMultiplier,
  computeUltimateNova,
  getUltimateState,
  restoreUltimateState,
  MAX_ULTIMATE_CHARGE,
  ULTIMATE_CHARGE_PER_KILL,
  ULTIMATE_CHARGE_PER_DAMAGE,
} from './UltimateSystem';

// Module-level state — reset before each test for isolation.
beforeEach(() => {
  resetUltimateSystem();
});

describe('UltimateSystem — charge accumulation', () => {
  test('starts empty, not ready, ratio 0', () => {
    expect(getUltimateCharge()).toBe(0);
    expect(getUltimateChargeRatio()).toBe(0);
    expect(isUltimateReady()).toBe(false);
  });

  test('kills accumulate a fixed charge per kill', () => {
    addUltimateChargeFromKill();
    addUltimateChargeFromKill();
    expect(getUltimateCharge()).toBeCloseTo(ULTIMATE_CHARGE_PER_KILL * 2, 6);
  });

  test('damage dealt accumulates charge scaled by damage', () => {
    addUltimateChargeFromDamage(1000);
    expect(getUltimateCharge()).toBeCloseTo(1000 * ULTIMATE_CHARGE_PER_DAMAGE, 6);
  });

  test('charge clamps at the maximum and never overflows', () => {
    addUltimateCharge(MAX_ULTIMATE_CHARGE * 5);
    expect(getUltimateCharge()).toBe(MAX_ULTIMATE_CHARGE);
    expect(getUltimateChargeRatio()).toBe(1);
  });

  test('ratio reports partial fill between 0 and 1', () => {
    addUltimateCharge(MAX_ULTIMATE_CHARGE / 4);
    expect(getUltimateChargeRatio()).toBeCloseTo(0.25, 6);
  });

  test('ignores non-finite and negative damage', () => {
    addUltimateChargeFromDamage(Number.NaN);
    addUltimateChargeFromDamage(Number.POSITIVE_INFINITY);
    addUltimateChargeFromDamage(-500);
    expect(getUltimateCharge()).toBe(0);
  });
});

describe('UltimateSystem — charge rate multiplier (card bonuses)', () => {
  test('scales kill and damage charge gain', () => {
    setUltimateChargeRateMultiplier(1.1);
    addUltimateChargeFromKill();
    addUltimateChargeFromDamage(1000);
    const expected = (ULTIMATE_CHARGE_PER_KILL + 1000 * ULTIMATE_CHARGE_PER_DAMAGE) * 1.1;
    expect(getUltimateCharge()).toBeCloseTo(expected, 6);
  });

  test('still clamps at the maximum', () => {
    setUltimateChargeRateMultiplier(1.1);
    addUltimateCharge(MAX_ULTIMATE_CHARGE);
    expect(getUltimateCharge()).toBe(MAX_ULTIMATE_CHARGE);
  });

  test('rejects non-finite and non-positive multipliers', () => {
    setUltimateChargeRateMultiplier(Number.NaN);
    setUltimateChargeRateMultiplier(0);
    setUltimateChargeRateMultiplier(-2);
    addUltimateChargeFromKill();
    expect(getUltimateCharge()).toBeCloseTo(ULTIMATE_CHARGE_PER_KILL, 6);
  });

  test('resetUltimateSystem restores the baseline rate', () => {
    setUltimateChargeRateMultiplier(2);
    resetUltimateSystem();
    addUltimateChargeFromKill();
    expect(getUltimateCharge()).toBeCloseTo(ULTIMATE_CHARGE_PER_KILL, 6);
  });
});

describe('UltimateSystem — readiness and activation', () => {
  test('becomes ready when charge reaches the maximum', () => {
    addUltimateCharge(MAX_ULTIMATE_CHARGE);
    expect(isUltimateReady()).toBe(true);
  });

  test('tryActivateUltimate fails and preserves charge when not ready', () => {
    addUltimateCharge(MAX_ULTIMATE_CHARGE - 1);
    expect(tryActivateUltimate()).toBe(false);
    expect(getUltimateCharge()).toBe(MAX_ULTIMATE_CHARGE - 1);
  });

  test('tryActivateUltimate consumes the full charge when ready', () => {
    addUltimateCharge(MAX_ULTIMATE_CHARGE);
    expect(tryActivateUltimate()).toBe(true);
    expect(getUltimateCharge()).toBe(0);
    expect(isUltimateReady()).toBe(false);
  });
});

describe('UltimateSystem — charge suppression (prevents the nova from recharging itself)', () => {
  test('charge gain is ignored while suppressed', () => {
    setUltimateChargeSuppressed(true);
    addUltimateChargeFromKill();
    addUltimateChargeFromDamage(10000);
    addUltimateCharge(50);
    expect(getUltimateCharge()).toBe(0);
  });

  test('charge gain resumes once suppression is lifted', () => {
    setUltimateChargeSuppressed(true);
    addUltimateChargeFromKill();
    setUltimateChargeSuppressed(false);
    addUltimateChargeFromKill();
    expect(getUltimateCharge()).toBeCloseTo(ULTIMATE_CHARGE_PER_KILL, 6);
  });

  test('reset clears the suppression flag', () => {
    setUltimateChargeSuppressed(true);
    resetUltimateSystem();
    addUltimateChargeFromKill();
    expect(getUltimateCharge()).toBeCloseTo(ULTIMATE_CHARGE_PER_KILL, 6);
  });
});

describe('UltimateSystem — nova scaling', () => {
  test('nova damage scales with the player damage multiplier', () => {
    const weak = computeUltimateNova(1, 0);
    const strong = computeUltimateNova(3, 0);
    expect(strong.damage).toBeCloseTo(weak.damage * 3, 6);
  });

  test('nova damage grows with elapsed game time', () => {
    const early = computeUltimateNova(1, 0);
    const late = computeUltimateNova(1, 600);
    expect(late.damage).toBeGreaterThan(early.damage);
  });

  test('nova radius and knockback are constant, positive, finite', () => {
    const nova = computeUltimateNova(2, 120);
    expect(nova.radius).toBeGreaterThan(0);
    expect(nova.knockback).toBeGreaterThan(0);
    expect(Number.isFinite(nova.damage)).toBe(true);
    expect(Number.isFinite(nova.radius)).toBe(true);
    expect(Number.isFinite(nova.knockback)).toBe(true);
  });

  test('non-finite inputs fall back to a finite, positive nova damage', () => {
    const nova = computeUltimateNova(Number.NaN, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(nova.damage)).toBe(true);
    expect(nova.damage).toBeGreaterThan(0);
  });
});

describe('UltimateSystem — save / restore', () => {
  test('state round-trips the live charge', () => {
    addUltimateCharge(42);
    const snapshot = getUltimateState();
    resetUltimateSystem();
    restoreUltimateState(snapshot);
    expect(getUltimateCharge()).toBe(42);
  });

  test('restore coerces corrupt / tampered charge into the valid range', () => {
    restoreUltimateState({ charge: Number.NaN });
    expect(getUltimateCharge()).toBe(0);

    restoreUltimateState({ charge: Number.POSITIVE_INFINITY });
    expect(getUltimateCharge()).toBe(MAX_ULTIMATE_CHARGE);

    restoreUltimateState({ charge: -999 });
    expect(getUltimateCharge()).toBe(0);

    restoreUltimateState({ charge: MAX_ULTIMATE_CHARGE * 10 });
    expect(getUltimateCharge()).toBe(MAX_ULTIMATE_CHARGE);
  });

  test('restore tolerates a missing or malformed snapshot', () => {
    addUltimateCharge(30);
    restoreUltimateState(undefined);
    expect(getUltimateCharge()).toBe(0);

    addUltimateCharge(30);
    // @ts-expect-error — exercising the corruption-hardening path
    restoreUltimateState({});
    expect(getUltimateCharge()).toBe(0);
  });
});
