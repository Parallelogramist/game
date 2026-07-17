import { describe, test, expect, vi } from 'vitest';

// Blessings itself is pure (its only Upgrades import is the PlayerStats *type*,
// which is erased at runtime). But we build the baseline from the REAL
// createDefaultPlayerStats() so every apply() is locked against the actual
// shipping defaults. Upgrades.ts imports WeaponManager from '../weapons' (Phaser)
// purely for a type, so stub that module boundary so it loads in the Node test
// env — the documented vitest pattern (cf. RunModifiers.test.ts).
vi.mock('../weapons', () => ({ WeaponManager: class {} }));

import { BLESSINGS, selectBlessings, getBlessingById } from './Blessings';
import { ICON_MAP, isValidFrameName } from '../utils/IconMap';
import { createDefaultPlayerStats, type PlayerStats } from './Upgrades';

/** Fields where a LOWER value is the better outcome for the player. */
const LOWER_IS_BETTER: (keyof PlayerStats)[] = ['cooldownMultiplier'];

describe('BLESSINGS data integrity', () => {
  test('pool is non-empty and ids are unique', () => {
    expect(BLESSINGS.length).toBeGreaterThan(0);
    const ids = BLESSINGS.map((blessing) => blessing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every blessing has a name, a description and a resolving icon key', () => {
    for (const blessing of BLESSINGS) {
      expect(blessing.name.length).toBeGreaterThan(0);
      expect(blessing.description.length).toBeGreaterThan(0);
      expect(blessing.icon in ICON_MAP || isValidFrameName(blessing.icon)).toBe(true);
    }
  });

  test('getBlessingById resolves every pool member and rejects unknowns', () => {
    for (const blessing of BLESSINGS) {
      expect(getBlessingById(blessing.id)).toBe(blessing);
    }
    expect(getBlessingById('no_such_blessing')).toBeUndefined();
  });
});

// The defining contract: a blessing is a gift the player paid gold for, so it may
// never make any stat worse. This is what separates the pool from RunModifiers
// (tradeoffs) and Pacts (curses) — a downside smuggled into a blessing is a bug.
describe('BLESSINGS are pure upside', () => {
  test('no blessing worsens any stat', () => {
    for (const blessing of BLESSINGS) {
      const base = createDefaultPlayerStats();
      const after = createDefaultPlayerStats();
      blessing.apply(after);

      for (const key of Object.keys(base) as (keyof PlayerStats)[]) {
        const before = base[key];
        const result = after[key];
        if (typeof before !== 'number' || typeof result !== 'number') continue;
        if (LOWER_IS_BETTER.includes(key)) {
          expect(result, `${blessing.id} raised ${String(key)}`).toBeLessThanOrEqual(before);
        } else {
          expect(result, `${blessing.id} lowered ${String(key)}`).toBeGreaterThanOrEqual(before);
        }
      }
    }
  });

  test('every blessing actually changes at least one stat', () => {
    for (const blessing of BLESSINGS) {
      const base = createDefaultPlayerStats();
      const after = createDefaultPlayerStats();
      blessing.apply(after);
      const changed = (Object.keys(base) as (keyof PlayerStats)[]).filter(
        (key) => base[key] !== after[key],
      );
      expect(changed.length, `${blessing.id} is inert`).toBeGreaterThan(0);
    }
  });
});

// Invariants that hold for *any* shuffle, so asserting them against the real
// Math.random shuffle is total (not flaky).
describe('selectBlessings', () => {
  test('an unbought profile (count 0) gets no blessings', () => {
    expect(selectBlessings(0)).toEqual([]);
  });

  test('a negative count returns an empty selection (no slice underflow)', () => {
    expect(selectBlessings(-1)).toEqual([]);
    expect(selectBlessings(-3)).toEqual([]);
  });

  test('returns the requested number of distinct pool members', () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const picked = selectBlessings(3);
      expect(picked.length).toBe(3);
      expect(new Set(picked.map((blessing) => blessing.id)).size).toBe(3);
      for (const blessing of picked) {
        expect(BLESSINGS).toContain(blessing);
      }
    }
  });

  test('caps at the pool size when asked for more than exists', () => {
    const picked = selectBlessings(99);
    expect(picked.length).toBe(BLESSINGS.length);
    expect(new Set(picked.map((blessing) => blessing.id)).size).toBe(BLESSINGS.length);
  });

  test('does not mutate or reorder the source pool', () => {
    const idsBefore = BLESSINGS.map((blessing) => blessing.id);
    selectBlessings(3);
    selectBlessings(99);
    expect(BLESSINGS.map((blessing) => blessing.id)).toEqual(idsBefore);
  });
});
