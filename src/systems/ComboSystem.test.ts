import { describe, test, expect, beforeEach } from 'vitest';

import {
  resetComboSystem,
  recordComboKill,
  updateComboSystem,
  getComboCount,
  getHighestCombo,
  getComboTier,
  getComboXPMultiplier,
  getComboDecayPercent,
  isComboBuffActive,
  getComboState,
  restoreComboState,
  type ComboSnapshot,
} from './ComboSystem';

// ComboSystem is module-level state — reset before each test for isolation.
beforeEach(() => {
  resetComboSystem();
});

describe('ComboSystem — restore corruption / tamper resilience (BUG-COMBO-RESTORE-CORRUPT)', () => {
  // comboState is an *optional* save field, so GameStateManager's structural
  // validator deliberately skips it ("guarded at their own use sites"). The save
  // store is encrypted precisely because it is a tamper/corruption surface, so
  // restoreComboState must coerce every field — otherwise a garbage snapshot
  // poisons the live XP-multiplier pipeline (NaN comboCount → NaN XP gain) and
  // inflates the run score / achievement records that read highestCombo.

  test('a NaN comboCount restores to 0, not NaN', () => {
    restoreComboState({ comboCount: NaN, comboDecayTimer: 0, highestCombo: 0 });
    expect(getComboCount()).toBe(0);
  });

  test('a NaN comboCount never yields a NaN XP multiplier', () => {
    restoreComboState({ comboCount: NaN, comboDecayTimer: 0, highestCombo: 0 });
    const multiplier = getComboXPMultiplier();
    expect(Number.isFinite(multiplier)).toBe(true);
    expect(multiplier).toBe(1.0);
  });

  test('a negative comboCount clamps to 0', () => {
    restoreComboState({ comboCount: -50, comboDecayTimer: 0, highestCombo: 0 });
    expect(getComboCount()).toBe(0);
    expect(getComboTier()).toBe('none');
  });

  test('a missing comboCount (partial snapshot) restores to 0, not NaN', () => {
    restoreComboState({} as unknown as ComboSnapshot);
    expect(getComboCount()).toBe(0);
    expect(Number.isFinite(getComboXPMultiplier())).toBe(true);
  });

  test('a non-numeric (string) comboCount restores to 0', () => {
    restoreComboState({ comboCount: '999' as unknown as number, comboDecayTimer: 0, highestCombo: 0 });
    expect(getComboCount()).toBe(0);
  });

  test('a NaN highestCombo restores to 0 (keeps run score / achievements finite)', () => {
    restoreComboState({ comboCount: 0, comboDecayTimer: 0, highestCombo: NaN });
    expect(getHighestCombo()).toBe(0);
    expect(Number.isFinite(getHighestCombo())).toBe(true);
  });

  test('a negative highestCombo clamps to 0', () => {
    restoreComboState({ comboCount: 0, comboDecayTimer: 0, highestCombo: -100 });
    expect(getHighestCombo()).toBe(0);
  });

  test('highestCombo is raised to the live combo when an inconsistent snapshot reports it lower', () => {
    // recordComboKill maintains highestCombo >= comboCount; a tampered snapshot
    // that violates it must not let the current combo exceed the recorded peak.
    restoreComboState({ comboCount: 40, comboDecayTimer: 1, highestCombo: 5 });
    expect(getHighestCombo()).toBeGreaterThanOrEqual(getComboCount());
    expect(getHighestCombo()).toBe(40);
  });

  test('a NaN comboDecayTimer never produces a NaN decay percent', () => {
    restoreComboState({ comboCount: 30, comboDecayTimer: NaN, highestCombo: 30 });
    expect(Number.isFinite(getComboDecayPercent())).toBe(true);
  });

  test('an absurdly large comboDecayTimer is clamped to the grace delay (no frozen combo)', () => {
    // A tamper that sets a huge grace timer would otherwise keep a combo alive
    // forever. Clamp to the combo's grace delay so it still decays on schedule.
    restoreComboState({ comboCount: 30, comboDecayTimer: 9999, highestCombo: 30 });
    // combo 30 → 'hot' tier, grace delay 2.0s. After 2.1s the grace lapses and
    // the combo drains; an unclamped 9999s timer would leave the combo untouched.
    updateComboSystem(2.1);
    expect(getComboCount()).toBeLessThan(30);
  });
});

describe('ComboSystem — core behaviour lock', () => {
  // Characterization tests: lock the tier/threshold/XP contract that four
  // consumers (HUD, score, achievements, hidden unlocks) depend on, so a future
  // balance tweak can't silently shift it.

  test('tiers cross at the documented boundaries', () => {
    expect(getComboTier()).toBe('none');
    for (let kill = 0; kill < 9; kill++) recordComboKill();
    expect(getComboTier()).toBe('none'); // 9
    recordComboKill();
    expect(getComboTier()).toBe('warm'); // 10
    for (let kill = 10; kill < 25; kill++) recordComboKill();
    expect(getComboTier()).toBe('hot'); // 25
    for (let kill = 25; kill < 50; kill++) recordComboKill();
    expect(getComboTier()).toBe('blazing'); // 50
    for (let kill = 50; kill < 100; kill++) recordComboKill();
    expect(getComboTier()).toBe('inferno'); // 100
  });

  test('the 25/50/100 thresholds each fire exactly once per chain', () => {
    const fired: number[] = [];
    for (let kill = 0; kill < 120; kill++) {
      const result = recordComboKill();
      if (result.triggeredThreshold) fired.push(result.triggeredThreshold.count);
    }
    expect(fired).toEqual([25, 50, 100]);
  });

  test('the 50-kill threshold activates the damage buff', () => {
    for (let kill = 0; kill < 50; kill++) recordComboKill();
    expect(isComboBuffActive()).toBe(true);
  });

  test('the XP multiplier scales with combo and caps at 1.5', () => {
    expect(getComboXPMultiplier()).toBe(1.0);
    for (let kill = 0; kill < 100; kill++) recordComboKill();
    expect(getComboXPMultiplier()).toBeCloseTo(1.2, 5); // 1 + 100 * 0.002
    for (let kill = 100; kill < 1000; kill++) recordComboKill();
    expect(getComboXPMultiplier()).toBe(1.5); // capped
  });

  test('thresholds re-arm after the combo decays back to zero', () => {
    for (let kill = 0; kill < 25; kill++) recordComboKill();
    // Drain the combo fully (grace + heavy decay).
    for (let frame = 0; frame < 20; frame++) updateComboSystem(1.0);
    expect(getComboCount()).toBe(0);
    const fired: number[] = [];
    for (let kill = 0; kill < 25; kill++) {
      const result = recordComboKill();
      if (result.triggeredThreshold) fired.push(result.triggeredThreshold.count);
    }
    expect(fired).toEqual([25]); // fires again in the new chain
  });

  test('a valid snapshot round-trips through save/restore unchanged', () => {
    for (let kill = 0; kill < 37; kill++) recordComboKill();
    const snapshot = getComboState();
    resetComboSystem();
    restoreComboState(snapshot);
    expect(getComboCount()).toBe(snapshot.comboCount);
    expect(getHighestCombo()).toBe(snapshot.highestCombo);
    // A combo of 37 has already passed the 25 threshold → it must not re-fire.
    const result = recordComboKill();
    expect(result.triggeredThreshold).toBeNull();
  });
});
