import { describe, test, expect } from 'vitest';
import { resolveChainJumpCount } from './ChainJumpCount';

describe('resolveChainJumpCount', () => {
  // --- Regression lock: with no dedicated chain bonus the result must be
  // byte-identical to the old inline formula (base + floor(level/2) + generic),
  // so wiring the previously-dead `chainLightningCount` stat can never change an
  // existing run that has neither the relic nor the meta upgrade.
  test('matches the old formula exactly when the chain bonus is 0 (regression lock)', () => {
    // base 3, level 1 → floor(0.5) = 0 jumps from level
    expect(resolveChainJumpCount(3, 1, 0, 0)).toBe(3);
    // base 3, level 5 → floor(2.5) = 2
    expect(resolveChainJumpCount(3, 5, 0, 0)).toBe(5);
    // base 3, level 8, +2 generic projectile count → 3 + 4 + 2
    expect(resolveChainJumpCount(3, 8, 2, 0)).toBe(9);
  });

  test('adds the dedicated chain bonus on top of the level + generic baseline', () => {
    // base 3, level 1, no generic, +2 chain (Chain Catalyst relic) → 5
    expect(resolveChainJumpCount(3, 1, 0, 2)).toBe(5);
    // base 3, level 5 (=> +2), +1 generic, +3 chain → 3 + 2 + 1 + 3
    expect(resolveChainJumpCount(3, 5, 1, 3)).toBe(9);
  });

  test('floors the level contribution (odd levels add no extra jump over the prior even)', () => {
    expect(resolveChainJumpCount(0, 2, 0, 0)).toBe(1); // floor(1.0) = 1
    expect(resolveChainJumpCount(0, 3, 0, 0)).toBe(1); // floor(1.5) = 1
    expect(resolveChainJumpCount(0, 4, 0, 0)).toBe(2); // floor(2.0) = 2
  });

  test('stacks the generic and chain bonuses additively', () => {
    expect(resolveChainJumpCount(0, 0, 4, 5)).toBe(9);
  });

  test('floors a fractional chain bonus to a whole jump', () => {
    expect(resolveChainJumpCount(3, 1, 0, 2.9)).toBe(5);
  });

  test('clamps a negative chain bonus to 0 (never reduces jumps below the baseline)', () => {
    expect(resolveChainJumpCount(3, 5, 0, -10)).toBe(5);
  });

  test('treats a non-finite chain bonus as 0 (corrupt/legacy stat is inert)', () => {
    expect(resolveChainJumpCount(3, 5, 0, NaN)).toBe(5);
    expect(resolveChainJumpCount(3, 5, 0, Infinity)).toBe(5);
    expect(resolveChainJumpCount(3, 5, 0, -Infinity)).toBe(5);
  });
});
