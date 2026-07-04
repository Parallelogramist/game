import { describe, test, expect } from 'vitest';
import { mergeLockedIntoOffers, lockCapacity, toggleLockedId } from './upgradeLocks';

// Minimal stand-in for a CombinedUpgrade — the merge only cares about `id`.
function offer(id: string): { id: string } {
  return { id };
}

describe('lockCapacity', () => {
  test('always leaves at least one rerollable slot', () => {
    expect(lockCapacity(3)).toBe(2);
    expect(lockCapacity(4)).toBe(3);
    expect(lockCapacity(5)).toBe(4);
  });

  test('clamps to 0 for degenerate counts', () => {
    expect(lockCapacity(1)).toBe(0);
    expect(lockCapacity(0)).toBe(0);
    expect(lockCapacity(-2)).toBe(0);
  });
});

describe('toggleLockedId', () => {
  test('adds an absent id when under capacity', () => {
    expect(toggleLockedId([], 'a', 2)).toEqual(['a']);
    expect(toggleLockedId(['a'], 'b', 2)).toEqual(['a', 'b']);
  });

  test('removes a present id', () => {
    expect(toggleLockedId(['a', 'b'], 'a', 2)).toEqual(['b']);
    expect(toggleLockedId(['a'], 'a', 2)).toEqual([]);
  });

  test('refuses to add past capacity', () => {
    expect(toggleLockedId(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
  });

  test('removal is always allowed even at capacity', () => {
    // At cap (2 of 2) — unlocking one must still work.
    expect(toggleLockedId(['a', 'b'], 'b', 2)).toEqual(['a']);
  });

  test('capacity 0 blocks all additions', () => {
    expect(toggleLockedId([], 'a', 0)).toEqual([]);
  });

  test('does not mutate the input array', () => {
    const input = ['a'];
    const result = toggleLockedId(input, 'b', 2);
    expect(input).toEqual(['a']);
    expect(result).not.toBe(input);
  });
});

describe('mergeLockedIntoOffers', () => {
  test('returns the fresh set unchanged when nothing is locked', () => {
    const fresh = [offer('a'), offer('b'), offer('c')];
    expect(mergeLockedIntoOffers([], fresh, 3).map(u => u.id)).toEqual(['a', 'b', 'c']);
  });

  test('pins locked upgrades to the front, then fills from fresh', () => {
    const locked = [offer('x')];
    const fresh = [offer('a'), offer('b'), offer('c')];
    expect(mergeLockedIntoOffers(locked, fresh, 3).map(u => u.id)).toEqual(['x', 'a', 'b']);
  });

  test('preserves the locked upgrade object identity (the SAME card stays)', () => {
    const x = offer('x');
    const result = mergeLockedIntoOffers([x], [offer('a'), offer('b')], 3);
    expect(result[0]).toBe(x);
  });

  test('does not duplicate a locked id that also appears in the fresh pool', () => {
    const locked = [offer('x')];
    const fresh = [offer('x'), offer('a'), offer('b')];
    // fresh 'x' is skipped as a duplicate of the locked 'x'.
    expect(mergeLockedIntoOffers(locked, fresh, 3).map(u => u.id)).toEqual(['x', 'a', 'b']);
  });

  test('multiple locks all survive, in order', () => {
    const locked = [offer('x'), offer('y')];
    const fresh = [offer('a'), offer('b'), offer('c')];
    expect(mergeLockedIntoOffers(locked, fresh, 3).map(u => u.id)).toEqual(['x', 'y', 'a']);
  });

  test('caps the result at count', () => {
    const locked = [offer('x'), offer('y'), offer('z')];
    const fresh = [offer('a')];
    expect(mergeLockedIntoOffers(locked, fresh, 3).map(u => u.id)).toEqual(['x', 'y', 'z']);
  });

  test('dedupes repeated ids inside the locked list itself', () => {
    const locked = [offer('x'), offer('x')];
    const fresh = [offer('a'), offer('b')];
    expect(mergeLockedIntoOffers(locked, fresh, 3).map(u => u.id)).toEqual(['x', 'a', 'b']);
  });

  test('returns fewer than count when the combined pool is small', () => {
    const locked = [offer('x')];
    const fresh = [offer('a')];
    expect(mergeLockedIntoOffers(locked, fresh, 4).map(u => u.id)).toEqual(['x', 'a']);
  });

  test('count 0 yields an empty set', () => {
    expect(mergeLockedIntoOffers([offer('x')], [offer('a')], 0)).toEqual([]);
  });

  test('does not mutate the input arrays', () => {
    const locked = [offer('x')];
    const fresh = [offer('a'), offer('b')];
    mergeLockedIntoOffers(locked, fresh, 3);
    expect(locked.map(u => u.id)).toEqual(['x']);
    expect(fresh.map(u => u.id)).toEqual(['a', 'b']);
  });
});
