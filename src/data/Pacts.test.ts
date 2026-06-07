import { describe, test, expect, vi } from 'vitest';

// Pacts.ts is pure — its only Upgrades import is the PlayerStats *type* (erased at
// runtime). But we build the baseline from the REAL createDefaultPlayerStats() so
// every apply() is locked against the actual shipping defaults; a wrong field,
// sign, or factor would otherwise ship as a quiet balance bug (a curse that helps,
// a reward that shrinks). Upgrades.ts imports WeaponManager from '../weapons'
// (Phaser) purely for a type, so stub that module boundary so it loads in the Node
// test env — the documented vitest pattern (cf. RunModifiers.test.ts).
vi.mock('../weapons', () => ({ WeaponManager: class {} }));

import { PACTS, MAX_PACTS, getPactById, type Pact } from './Pacts';
import { createDefaultPlayerStats, type PlayerStats } from './Upgrades';

/** Keys whose numeric/boolean value differs between two stat snapshots. */
function changedKeys(before: PlayerStats, after: PlayerStats): (keyof PlayerStats)[] {
  return (Object.keys(before) as (keyof PlayerStats)[]).filter((key) => before[key] !== after[key]);
}

/** Apply a pact id to a fresh baseline; return the pristine + mutated stats. */
function applyById(pactId: string): { base: PlayerStats; after: PlayerStats; pact: Pact } {
  const pact = getPactById(pactId);
  if (!pact) throw new Error(`unknown pact id in test: ${pactId}`);
  const base = createDefaultPlayerStats();
  const after = createDefaultPlayerStats();
  pact.apply(after);
  return { base, after, pact };
}

// ---------------------------------------------------------------------------
// Data integrity — structural locks that survive any future balance retune.
// ---------------------------------------------------------------------------

describe('PACTS data integrity', () => {
  test('pool is non-empty', () => {
    expect(PACTS.length).toBeGreaterThan(0);
  });

  test('every pact id is unique', () => {
    const ids = PACTS.map((pact) => pact.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every pact has a non-empty id, name, description (downside) and reward (upside)', () => {
    for (const pact of PACTS) {
      expect(pact.id.trim().length).toBeGreaterThan(0);
      expect(pact.name.trim().length).toBeGreaterThan(0);
      expect(pact.description.trim().length).toBeGreaterThan(0);
      expect(pact.reward.trim().length).toBeGreaterThan(0);
    }
  });

  test('every pact declares a finite numeric color', () => {
    for (const pact of PACTS) {
      expect(typeof pact.color).toBe('number');
      expect(Number.isFinite(pact.color)).toBe(true);
    }
  });

  test('every pact exposes an apply function', () => {
    for (const pact of PACTS) {
      expect(typeof pact.apply).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// MAX_PACTS — the stacking cap must be a reachable positive integer. PactSelectScene
// caps distinct selections at MAX_PACTS (`selectedIds.size >= MAX_PACTS`), so if the
// pool held fewer pacts than the cap the max would be unreachable — a latent bug.
// ---------------------------------------------------------------------------

describe('MAX_PACTS cap', () => {
  test('is a positive integer', () => {
    expect(Number.isInteger(MAX_PACTS)).toBe(true);
    expect(MAX_PACTS).toBeGreaterThan(0);
  });

  test('is reachable — the pool has at least MAX_PACTS distinct pacts to stack', () => {
    expect(PACTS.length).toBeGreaterThanOrEqual(MAX_PACTS);
  });
});

// ---------------------------------------------------------------------------
// getPactById — exact round-trip + miss behaviour.
// ---------------------------------------------------------------------------

describe('getPactById', () => {
  test('returns the matching pact (by reference) for every id', () => {
    for (const pact of PACTS) {
      expect(getPactById(pact.id)).toBe(pact);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(getPactById('does_not_exist')).toBeUndefined();
  });

  test('returns undefined for an empty id', () => {
    expect(getPactById('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// apply() — per-pact lock. Each entry lists ONLY the fields the pact is documented
// to change, computed from the live baseline. The test asserts both directions:
// every listed field hits its exact value, AND no unlisted field is touched (the
// changedKeys guard catches a stray write).
// ---------------------------------------------------------------------------

type EffectSpec = Record<string, (base: PlayerStats) => number>;

const PACT_EFFECTS: Record<string, EffectSpec> = {
  cursed_horde: {
    curseMultiplier: (base) => base.curseMultiplier + 0.4,
    goldMultiplier: (base) => base.goldMultiplier * 1.15,
    xpMultiplier: (base) => base.xpMultiplier + 0.1,
  },
  glass_cannon: {
    // maxHealth halved (floored, min 1); currentHealth clamped down to the new max.
    maxHealth: (base) => Math.max(1, Math.floor(base.maxHealth * 0.5)),
    currentHealth: (base) => Math.min(base.currentHealth, Math.max(1, Math.floor(base.maxHealth * 0.5))),
    goldMultiplier: (base) => base.goldMultiplier * 1.15,
  },
  famine: {
    healingBoost: (base) => base.healingBoost * 0.4,
    goldMultiplier: (base) => base.goldMultiplier * 1.12,
    xpMultiplier: (base) => base.xpMultiplier + 0.1,
  },
  exposed: {
    iframeDuration: (base) => base.iframeDuration * 0.6,
    goldMultiplier: (base) => base.goldMultiplier * 1.1,
  },
  overwhelming: {
    curseMultiplier: (base) => base.curseMultiplier + 0.7,
    goldMultiplier: (base) => base.goldMultiplier * 1.25,
    xpMultiplier: (base) => base.xpMultiplier + 0.15,
  },
};

describe('Pact apply() effects', () => {
  test('every pact in the pool has an effect spec, and vice versa (coverage lock)', () => {
    const specIds = Object.keys(PACT_EFFECTS).sort();
    const poolIds = PACTS.map((pact) => pact.id).sort();
    expect(specIds).toEqual(poolIds);
  });

  test.each(Object.keys(PACT_EFFECTS))(
    'apply(%s) moves exactly its documented fields by the documented amount',
    (pactId) => {
      const { base, after } = applyById(pactId);
      const effects = PACT_EFFECTS[pactId];

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

  test.each(Object.keys(PACT_EFFECTS))('apply(%s) returns nothing (mutates in place)', (pactId) => {
    const pact = getPactById(pactId)!;
    const stats = createDefaultPlayerStats();
    expect(pact.apply(stats)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Direction lock — a pact is a *curse for reward*: its downside must make the run
// harder (enemies tougher / player frailer) and its reward must never shrink. This
// catches a flipped sign even if the per-pact factor spec above were wrong too.
// ---------------------------------------------------------------------------

describe('Pact direction (downside hurts, reward never shrinks)', () => {
  test('every pact raises the gold reward above the baseline (reward is real)', () => {
    for (const pact of PACTS) {
      const { base, after } = applyById(pact.id);
      // Every shipping pact advertises a gold bonus.
      expect(after.goldMultiplier, `${pact.id} did not raise goldMultiplier`).toBeGreaterThan(base.goldMultiplier);
    }
  });

  test('no pact lowers a reward multiplier (gold/xp never regress)', () => {
    for (const pact of PACTS) {
      const { base, after } = applyById(pact.id);
      expect(after.goldMultiplier, `${pact.id} lowered goldMultiplier`).toBeGreaterThanOrEqual(base.goldMultiplier);
      expect(after.xpMultiplier, `${pact.id} lowered xpMultiplier`).toBeGreaterThanOrEqual(base.xpMultiplier);
    }
  });

  test('curse pacts raise enemy difficulty (curseMultiplier up)', () => {
    for (const id of ['cursed_horde', 'overwhelming']) {
      const { base, after } = applyById(id);
      expect(after.curseMultiplier, `${id} did not raise curseMultiplier`).toBeGreaterThan(base.curseMultiplier);
    }
  });

  test('fragility pacts weaken the player (the documented knob drops)', () => {
    // glass_cannon → maxHealth; famine → healingBoost; exposed → iframeDuration.
    expect(applyById('glass_cannon').after.maxHealth).toBeLessThan(createDefaultPlayerStats().maxHealth);
    expect(applyById('famine').after.healingBoost).toBeLessThan(createDefaultPlayerStats().healingBoost);
    expect(applyById('exposed').after.iframeDuration).toBeLessThan(createDefaultPlayerStats().iframeDuration);
  });
});

// ---------------------------------------------------------------------------
// Stacking — pacts are the one selection that explicitly stacks (up to MAX_PACTS),
// unlike RunModifiers' one-per-category. Lock that additive curses sum and
// multiplicative rewards compound when several apply to the same stats.
// ---------------------------------------------------------------------------

describe('Pact stacking (additive curses sum, multiplicative rewards compound)', () => {
  test('two curse pacts sum their additive curseMultiplier and compound their gold', () => {
    const base = createDefaultPlayerStats();
    const stats = createDefaultPlayerStats();
    getPactById('cursed_horde')!.apply(stats);
    getPactById('overwhelming')!.apply(stats);
    // curseMultiplier is additive: 1.0 + 0.4 + 0.7
    expect(stats.curseMultiplier).toBeCloseTo(base.curseMultiplier + 0.4 + 0.7, 6);
    // goldMultiplier is multiplicative: 1.0 * 1.15 * 1.25
    expect(stats.goldMultiplier).toBeCloseTo(base.goldMultiplier * 1.15 * 1.25, 6);
    // xpMultiplier is additive: 0.8 + 0.1 + 0.15
    expect(stats.xpMultiplier).toBeCloseTo(base.xpMultiplier + 0.1 + 0.15, 6);
  });

  test('stacking the full MAX_PACTS worth of distinct pacts stays finite and valid', () => {
    const stats = createDefaultPlayerStats();
    for (const pact of PACTS.slice(0, MAX_PACTS)) {
      pact.apply(stats);
    }
    for (const [field, value] of Object.entries(stats)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${field} went non-finite after stacking`).toBe(true);
      }
    }
    expect(stats.maxHealth).toBeGreaterThan(0);
    expect(stats.currentHealth).toBeLessThanOrEqual(stats.maxHealth);
  });
});

// ---------------------------------------------------------------------------
// Cross-pact invariants — no single pact may leave the player in a broken state.
// ---------------------------------------------------------------------------

describe('Pact invariants (apply over every pact)', () => {
  test('no pact produces a non-finite numeric stat', () => {
    for (const pact of PACTS) {
      const stats = createDefaultPlayerStats();
      pact.apply(stats);
      for (const [field, value] of Object.entries(stats)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${pact.id} left ${field} non-finite`).toBe(true);
        }
      }
    }
  });

  test('no pact leaves currentHealth above maxHealth or maxHealth non-positive', () => {
    for (const pact of PACTS) {
      const stats = createDefaultPlayerStats();
      pact.apply(stats);
      expect(stats.maxHealth, `${pact.id} dropped maxHealth to <= 0`).toBeGreaterThan(0);
      expect(stats.currentHealth, `${pact.id} left currentHealth above maxHealth`).toBeLessThanOrEqual(
        stats.maxHealth,
      );
    }
  });
});
