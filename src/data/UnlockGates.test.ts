import { describe, test, expect } from 'vitest';
import { isUnlockRequirementMet, type UnlockGateContext } from './UnlockGates';

// Single source of truth for unlock-gate parsing (ships + stages in
// WeaponSelectScene). Semantics deliberately mirror the legacy inline filters:
// missing gate → unlocked, unknown prefix → unlocked (data tests in
// ShipCharacters.test.ts / Stages.test.ts are the guard against junk gates
// shipping), malformed numbers coerce to 0 via `Number(...) || 0`.

function makeContext(overrides: Partial<UnlockGateContext> = {}): UnlockGateContext {
  return {
    unlockedConditionIds: [],
    worldLevel: 0,
    accountLevel: 0,
    ...overrides,
  };
}

describe('isUnlockRequirementMet — no gate', () => {
  test('undefined requirement is always unlocked', () => {
    expect(isUnlockRequirementMet(undefined, makeContext())).toBe(true);
  });

  test('empty-string requirement is always unlocked (legacy falsy check)', () => {
    expect(isUnlockRequirementMet('', makeContext())).toBe(true);
  });
});

describe('isUnlockRequirementMet — hidden: gates', () => {
  test('unlocked when the condition id is in the unlocked set', () => {
    const context = makeContext({ unlockedConditionIds: ['unlock_apex', 'unlock_flawless'] });
    expect(isUnlockRequirementMet('hidden:unlock_apex', context)).toBe(true);
  });

  test('locked when the condition id is not in the unlocked set', () => {
    const context = makeContext({ unlockedConditionIds: ['unlock_flawless'] });
    expect(isUnlockRequirementMet('hidden:unlock_apex', context)).toBe(false);
  });

  test('locked when no conditions are unlocked at all', () => {
    expect(isUnlockRequirementMet('hidden:unlock_apex', makeContext())).toBe(false);
  });

  test('requires the exact condition id, not a prefix match', () => {
    const context = makeContext({ unlockedConditionIds: ['unlock_apex_plus'] });
    expect(isUnlockRequirementMet('hidden:unlock_apex', context)).toBe(false);
  });
});

describe('isUnlockRequirementMet — worldLevel: gates', () => {
  test('unlocked exactly at the required level (inclusive >=)', () => {
    expect(isUnlockRequirementMet('worldLevel:3', makeContext({ worldLevel: 3 }))).toBe(true);
  });

  test('unlocked above the required level', () => {
    expect(isUnlockRequirementMet('worldLevel:3', makeContext({ worldLevel: 7 }))).toBe(true);
  });

  test('locked below the required level', () => {
    expect(isUnlockRequirementMet('worldLevel:3', makeContext({ worldLevel: 2 }))).toBe(false);
  });

  test('malformed level coerces to 0 and unlocks (legacy Number(...) || 0)', () => {
    expect(isUnlockRequirementMet('worldLevel:abc', makeContext({ worldLevel: 0 }))).toBe(true);
  });
});

describe('isUnlockRequirementMet — account: gates', () => {
  test('unlocked exactly at the required account level (inclusive >=)', () => {
    expect(isUnlockRequirementMet('account:25', makeContext({ accountLevel: 25 }))).toBe(true);
  });

  test('unlocked above the required account level', () => {
    expect(isUnlockRequirementMet('account:25', makeContext({ accountLevel: 40 }))).toBe(true);
  });

  test('locked below the required account level', () => {
    expect(isUnlockRequirementMet('account:25', makeContext({ accountLevel: 24 }))).toBe(false);
  });

  test('account:0 is always unlocked', () => {
    expect(isUnlockRequirementMet('account:0', makeContext({ accountLevel: 0 }))).toBe(true);
  });

  test('malformed level coerces to 0 and unlocks (legacy Number(...) || 0)', () => {
    expect(isUnlockRequirementMet('account:abc', makeContext({ accountLevel: 0 }))).toBe(true);
  });
});

describe('isUnlockRequirementMet — unknown gate syntax', () => {
  test('unknown prefix is treated as unlocked (legacy filter fallthrough)', () => {
    expect(isUnlockRequirementMet('someFutureGate:whatever', makeContext())).toBe(true);
  });

  test('gates are independent: hidden gate ignores world/account levels', () => {
    const context = makeContext({ worldLevel: 99, accountLevel: 99 });
    expect(isUnlockRequirementMet('hidden:unlock_apex', context)).toBe(false);
  });
});
