import { describe, test, expect, vi } from 'vitest';

// RunModifiers itself is pure (its only Upgrades import is the PlayerStats *type*,
// which is erased at runtime). But we build the baseline from the REAL
// createDefaultPlayerStats() so every apply() is locked against the actual
// shipping defaults — a wrong field, sign, or factor surfaces as a quiet balance
// bug otherwise. Upgrades.ts imports WeaponManager from '../weapons' (Phaser)
// purely for a type, so stub that module boundary so it loads in the Node test
// env — the documented vitest pattern (cf. WeaponEvolutions.test.ts).
vi.mock('../weapons', () => ({ WeaponManager: class {} }));

import {
  RUN_MODIFIERS,
  selectRunModifiers,
  getModifierById,
  type RunModifier,
} from './RunModifiers';
import { createDefaultPlayerStats, type PlayerStats } from './Upgrades';

const VALID_CATEGORIES = ['offense', 'defense', 'resources', 'chaos'] as const;

/** Keys whose numeric/boolean value differs between two stat snapshots. */
function changedKeys(before: PlayerStats, after: PlayerStats): (keyof PlayerStats)[] {
  return (Object.keys(before) as (keyof PlayerStats)[]).filter((key) => before[key] !== after[key]);
}

/** Apply a modifier id to a fresh baseline; return the pristine + mutated stats. */
function applyById(modifierId: string): { base: PlayerStats; after: PlayerStats; modifier: RunModifier } {
  const modifier = getModifierById(modifierId);
  if (!modifier) throw new Error(`unknown modifier id in test: ${modifierId}`);
  const base = createDefaultPlayerStats();
  const after = createDefaultPlayerStats();
  modifier.apply(after);
  return { base, after, modifier };
}

// ---------------------------------------------------------------------------
// Data integrity — structural locks that survive any future balance retune.
// ---------------------------------------------------------------------------

describe('RUN_MODIFIERS data integrity', () => {
  test('pool is non-empty', () => {
    expect(RUN_MODIFIERS.length).toBeGreaterThan(0);
  });

  test('every modifier id is unique', () => {
    const ids = RUN_MODIFIERS.map((modifier) => modifier.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every modifier has a non-empty id, name, and description', () => {
    for (const modifier of RUN_MODIFIERS) {
      expect(modifier.id.trim().length).toBeGreaterThan(0);
      expect(modifier.name.trim().length).toBeGreaterThan(0);
      expect(modifier.description.trim().length).toBeGreaterThan(0);
    }
  });

  test('every modifier declares a valid category', () => {
    for (const modifier of RUN_MODIFIERS) {
      expect(VALID_CATEGORIES).toContain(modifier.category);
    }
  });

  test('every modifier exposes an apply function', () => {
    for (const modifier of RUN_MODIFIERS) {
      expect(typeof modifier.apply).toBe('function');
    }
  });

  test('all four categories are represented (so same-category avoidance can fill a 2-pick)', () => {
    const categories = new Set(RUN_MODIFIERS.map((modifier) => modifier.category));
    for (const category of VALID_CATEGORIES) {
      expect(categories.has(category)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// getModifierById — exact round-trip + miss behaviour.
// ---------------------------------------------------------------------------

describe('getModifierById', () => {
  test('returns the matching modifier (by reference) for every id', () => {
    for (const modifier of RUN_MODIFIERS) {
      expect(getModifierById(modifier.id)).toBe(modifier);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(getModifierById('does_not_exist')).toBeUndefined();
  });

  test('returns undefined for an empty id', () => {
    expect(getModifierById('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// selectRunModifiers — invariants that hold for *any* shuffle, so asserting them
// against the real Math.random shuffle is total (not flaky).
// ---------------------------------------------------------------------------

describe('selectRunModifiers', () => {
  const distinctCategoryCount = new Set(RUN_MODIFIERS.map((modifier) => modifier.category)).size;

  test('default pick returns two distinct-category modifiers from the pool', () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const picked = selectRunModifiers();
      expect(picked.length).toBe(2);
      const categories = picked.map((modifier) => modifier.category);
      expect(new Set(categories).size).toBe(categories.length); // no same-category stacking
      for (const modifier of picked) {
        expect(RUN_MODIFIERS).toContain(modifier); // only real pool members
      }
    }
  });

  test('honours a requested count of 1', () => {
    const picked = selectRunModifiers(1);
    expect(picked.length).toBe(1);
  });

  test('count 0 returns an empty selection', () => {
    expect(selectRunModifiers(0)).toEqual([]);
  });

  test('a negative count returns an empty selection (no underflow)', () => {
    expect(selectRunModifiers(-3)).toEqual([]);
  });

  test('caps at one modifier per category when count exceeds category variety', () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const picked = selectRunModifiers(99);
      expect(picked.length).toBe(distinctCategoryCount);
      const categories = picked.map((modifier) => modifier.category);
      expect(new Set(categories).size).toBe(categories.length);
    }
  });

  test('does not mutate or reorder the source pool', () => {
    const idsBefore = RUN_MODIFIERS.map((modifier) => modifier.id);
    selectRunModifiers();
    selectRunModifiers(4);
    const idsAfter = RUN_MODIFIERS.map((modifier) => modifier.id);
    expect(idsAfter).toEqual(idsBefore);
  });
});

// ---------------------------------------------------------------------------
// apply() — per-modifier lock. Each entry lists ONLY the fields the modifier is
// documented to change, computed from the live baseline. The test asserts both
// directions: every listed field hits its exact value, AND no unlisted field is
// touched (the changedKeys guard catches a stray write). A modifier whose clamp
// is a no-op at baseline (e.g. iron_skin's currentHealth) is intentionally
// absent here, so the guard verifies it really stayed put.
// ---------------------------------------------------------------------------

type EffectSpec = Record<string, (base: PlayerStats) => number>;

const MODIFIER_EFFECTS: Record<string, EffectSpec> = {
  // ── Offense ──
  glass_cannon: {
    damageMultiplier: (base) => base.damageMultiplier * 1.5,
    maxHealth: (base) => Math.round(base.maxHealth * 0.7),
    currentHealth: (base) => Math.min(base.currentHealth, Math.round(base.maxHealth * 0.7)),
  },
  overcharge: {
    attackSpeedMultiplier: (base) => base.attackSpeedMultiplier * 1.3,
    cooldownMultiplier: (base) => base.cooldownMultiplier * 1.2,
  },
  precision_strike: {
    critChance: (base) => base.critChance + 0.25,
    attackSpeedMultiplier: (base) => base.attackSpeedMultiplier * 0.8,
  },
  heavy_hitter: {
    damageMultiplier: (base) => base.damageMultiplier * 1.4,
    projectileSpeedMultiplier: (base) => base.projectileSpeedMultiplier * 0.75,
  },

  // ── Defense ──
  iron_skin: {
    // maxHealth rises above currentHealth, so the currentHealth clamp is a no-op
    // and is deliberately omitted — the changedKeys guard proves it stays put.
    maxHealth: (base) => Math.round(base.maxHealth * 1.4),
    moveSpeed: (base) => base.moveSpeed * 0.8,
  },
  adrenaline: {
    moveSpeed: (base) => base.moveSpeed * 1.2,
    damageMultiplier: (base) => base.damageMultiplier * 1.15,
    maxHealth: (base) => Math.round(base.maxHealth * 0.75),
    currentHealth: (base) => Math.min(base.currentHealth, Math.round(base.maxHealth * 0.75)),
  },
  famine: {
    healingBoost: (base) => base.healingBoost * 0.5,
  },
  resilience: {
    armor: (base) => base.armor + 3,
    regenPerSecond: (base) => base.regenPerSecond + 0.5,
    damageMultiplier: (base) => base.damageMultiplier * 0.9,
  },

  // ── Resources ──
  treasure_hunter: {
    goldMultiplier: (base) => base.goldMultiplier * 2.0,
    damageMultiplier: (base) => base.damageMultiplier * 0.85,
  },
  scholar: {
    xpMultiplier: (base) => base.xpMultiplier * 1.3,
    damageMultiplier: (base) => base.damageMultiplier * 0.85,
  },
  magnetic_field: {
    pickupRange: (base) => base.pickupRange + 80,
    moveSpeed: (base) => base.moveSpeed * 0.9,
  },

  // ── Chaos ──
  elemental_storm: {
    burnDamageMultiplier: (base) => base.burnDamageMultiplier * 2.0,
    freezeDurationMultiplier: (base) => base.freezeDurationMultiplier * 2.0,
    poisonMaxStacks: (base) => base.poisonMaxStacks + 5,
  },
  speed_demon: {
    moveSpeed: (base) => base.moveSpeed * 1.25,
    maxHealth: (base) => Math.round(base.maxHealth * 0.85),
    currentHealth: (base) => Math.min(base.currentHealth, Math.round(base.maxHealth * 0.85)),
  },
  berserker: {
    damageMultiplier: (base) => base.damageMultiplier * 1.35,
    attackSpeedMultiplier: (base) => base.attackSpeedMultiplier * 1.35,
    iframeDuration: () => 0,
  },
  vampiric: {
    lifeStealPercent: (base) => base.lifeStealPercent + 0.05,
    healingBoost: (base) => base.healingBoost * 0.7,
  },
};

describe('RunModifier apply() effects', () => {
  test('every modifier in the pool has an effect spec, and vice versa (coverage lock)', () => {
    const specIds = Object.keys(MODIFIER_EFFECTS).sort();
    const poolIds = RUN_MODIFIERS.map((modifier) => modifier.id).sort();
    expect(specIds).toEqual(poolIds);
  });

  test.each(Object.keys(MODIFIER_EFFECTS))(
    'apply(%s) moves exactly its documented fields by the documented amount',
    (modifierId) => {
      const { base, after } = applyById(modifierId);
      const effects = MODIFIER_EFFECTS[modifierId];

      // 1. Every documented field reaches its computed value.
      for (const [field, compute] of Object.entries(effects)) {
        expect(after[field as keyof PlayerStats]).toBeCloseTo(compute(base), 6);
      }

      // 2. Nothing outside the documented set changed.
      const expectedKeys = Object.keys(effects).sort();
      const actualKeys = changedKeys(base, after).sort();
      expect(actualKeys).toEqual(expectedKeys);
    },
  );

  test.each(Object.keys(MODIFIER_EFFECTS))('apply(%s) returns nothing (mutates in place)', (modifierId) => {
    const modifier = getModifierById(modifierId)!;
    const stats = createDefaultPlayerStats();
    expect(modifier.apply(stats)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-modifier invariants — no modifier may leave the player in a broken state.
// ---------------------------------------------------------------------------

describe('RunModifier invariants (apply over every modifier)', () => {
  test('no modifier produces a non-finite numeric stat', () => {
    for (const modifier of RUN_MODIFIERS) {
      const stats = createDefaultPlayerStats();
      modifier.apply(stats);
      for (const [field, value] of Object.entries(stats)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${modifier.id} left ${field} non-finite`).toBe(true);
        }
      }
    }
  });

  test('no modifier leaves currentHealth above maxHealth or maxHealth non-positive', () => {
    for (const modifier of RUN_MODIFIERS) {
      const stats = createDefaultPlayerStats();
      modifier.apply(stats);
      expect(stats.maxHealth, `${modifier.id} dropped maxHealth to <= 0`).toBeGreaterThan(0);
      expect(stats.currentHealth, `${modifier.id} left currentHealth above maxHealth`).toBeLessThanOrEqual(
        stats.maxHealth,
      );
    }
  });
});
