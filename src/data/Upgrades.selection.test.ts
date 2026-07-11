import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Upgrades.ts imports WeaponManager from '../weapons' (Phaser-coupled) purely
// for a type, and reads codex discovery state for new-weapon offer weighting.
// Stub both module boundaries so the offer engine loads in the Node test env —
// the documented pattern (vitest.config.ts) for exercising Phaser-coupled code.
vi.mock('../weapons', () => ({ WeaponManager: class {} }));

const codexState = vi.hoisted(() => ({
  entries: new Map<string, { discovered: boolean; timesUsed?: number }>(),
}));
vi.mock('../codex', () => ({
  getCodexManager: () => ({
    getWeaponEntry: (weaponId: string) => codexState.entries.get(weaponId),
  }),
}));

import type { WeaponManager } from '../weapons';
import {
  calculateXPForLevel,
  canLevelUpgrade,
  getBlockingGate,
  getBlockingUpgrades,
  createUpgrades,
  getWeaponUpgrades,
  getRandomCombinedUpgrades,
  BREAK_LEVEL_GATES,
  type Upgrade,
  type CombinedUpgrade,
} from './Upgrades';
import { UPGRADE_RARITIES, type UpgradeRarity } from './UpgradeRarity';

/**
 * Regression lock for the level-up offer engine — the logic that decides what
 * every level-up modal of every run shows. Selection is random, so most cases
 * assert invariants (set membership, exclusions, lengths) across repeated
 * rolls rather than exact picks.
 */

// Mirrors UNLOCKABLE_WEAPONS in Upgrades.ts (the 18 weapons offerable as NEW
// WEAPON cards; the default 'projectile' is not in the unlockable pool).
const UNLOCKABLE_IDS = [
  'katana', 'orbiting_blades', 'aura', 'chain_lightning', 'homing_missile',
  'frost_nova', 'laser_beam', 'meteor', 'flamethrower', 'ricochet',
  'ground_spike', 'drone', 'shuriken', 'boomerang', 'sentry', 'singularity',
  'guardian', 'wake',
];

const OVERFLOW_IDS = [
  'overflow_might', 'overflow_vitality', 'overflow_swiftness',
  'overflow_insight', 'overflow_allure',
];

/** Rolls per invariant case — enough that a broken filter slips through by luck ~never. */
const ROLLS = 30;

interface FakeWeaponSpec {
  id: string;
  level?: number;
  maxLevel?: number;
}

function makeFakeWeapon(spec: FakeWeaponSpec) {
  const { id, level = 1, maxLevel = 8 } = spec;
  return {
    id,
    name: `Fake ${id}`,
    description: `Fake weapon ${id}`,
    icon: id,
    maxLevel,
    getLevel: () => level,
    isMaxLevel: () => level >= maxLevel,
    getUpgradeDescription: () => `upgrade ${id}`,
  };
}

function makeWeaponManager(specs: FakeWeaponSpec[] = [], canAdd = true): WeaponManager {
  const weapons = specs.map(makeFakeWeapon);
  return {
    getAllWeapons: () => weapons,
    canAddWeapon: () => canAdd,
  } as unknown as WeaponManager;
}

/** WeaponManager owning every weapon at max level with no free slots — the
 *  "nothing left to offer" endgame state. */
function makeExhaustedWeaponManager(): WeaponManager {
  const allOwned = ['projectile', ...UNLOCKABLE_IDS].map(
    id => ({ id, level: 8, maxLevel: 8 }),
  );
  return makeWeaponManager(allOwned, false);
}

/** Fresh run upgrade list with selected per-id current levels applied. */
function upgradesWithLevels(levels: Record<string, number>): Upgrade[] {
  const upgrades = createUpgrades();
  for (const upgrade of upgrades) {
    const level = levels[upgrade.id];
    if (level !== undefined) upgrade.currentLevel = level;
  }
  return upgrades;
}

/** Max out every normal (non-overflow) upgrade — the exhausted stat pool. */
function maxAllNormalUpgrades(): Upgrade[] {
  const upgrades = createUpgrades();
  for (const upgrade of upgrades) {
    if (!upgrade.isOverflow) upgrade.currentLevel = upgrade.maxLevel;
  }
  return upgrades;
}

function resultIds(result: CombinedUpgrade[]): string[] {
  return result.map(u => u.id);
}

/** Deterministic PRNG (same algorithm as DailyChallengeManager) so the
 *  luck-bias tests are seeded, not flaky-statistical. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  codexState.entries.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('calculateXPForLevel — the 10 × level^1.5 curve', () => {
  test('matches the locked curve at known points', () => {
    expect(calculateXPForLevel(1)).toBe(10);
    expect(calculateXPForLevel(2)).toBe(28);  // 10 × 2.828… rounded
    expect(calculateXPForLevel(4)).toBe(80);
    expect(calculateXPForLevel(10)).toBe(316); // 10 × 31.62… rounded
  });

  test('is strictly increasing across the realistic level range', () => {
    for (let level = 1; level < 120; level++) {
      expect(calculateXPForLevel(level + 1)).toBeGreaterThan(calculateXPForLevel(level));
    }
  });
});

describe('createUpgrades — pool integrity', () => {
  test('all upgrade ids are unique', () => {
    const ids = createUpgrades().map(u => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every upgrade starts at level 0', () => {
    expect(createUpgrades().every(u => u.currentLevel === 0)).toBe(true);
  });

  test('folds in the five Limit Break overflow upgrades, repeatable and gate-free', () => {
    const overflow = createUpgrades().filter(u => u.isOverflow);
    expect(overflow.map(u => u.id).sort()).toEqual([...OVERFLOW_IDS].sort());
    for (const upgrade of overflow) {
      expect(upgrade.maxLevel).toBe(999);
      expect(upgrade.isStatUpgrade).toBe(false);
    }
  });
});

describe('canLevelUpgrade — break level gates (3/6/9)', () => {
  test('the gates are 3, 6, 9', () => {
    expect(BREAK_LEVEL_GATES).toEqual([3, 6, 9]);
  });

  test('passes at a gate when all owned stat upgrades have reached it', () => {
    const upgrades = upgradesWithLevels({ might: 3, haste: 3, vitality: 4 });
    expect(canLevelUpgrade('might', 3, upgrades)).toBe(true);
  });

  test('blocks at a gate while another owned stat upgrade lags behind', () => {
    const upgrades = upgradesWithLevels({ might: 3, haste: 1 });
    expect(canLevelUpgrade('might', 3, upgrades)).toBe(false);
  });

  test('unowned (level 0) stat upgrades never block a gate', () => {
    const upgrades = upgradesWithLevels({ might: 3 }); // everything else at 0
    expect(canLevelUpgrade('might', 3, upgrades)).toBe(true);
  });

  test('non-gate levels pass even with lagging siblings', () => {
    const upgrades = upgradesWithLevels({ might: 2, haste: 1 });
    expect(canLevelUpgrade('might', 2, upgrades)).toBe(true);
    expect(canLevelUpgrade('might', 4, upgrades)).toBe(true);
  });

  test('enforces the later gates (6 and 9) too', () => {
    const blocked = upgradesWithLevels({ might: 6, haste: 4 });
    expect(canLevelUpgrade('might', 6, blocked)).toBe(false);
    const blockedAt9 = upgradesWithLevels({ might: 9, haste: 7 });
    expect(canLevelUpgrade('might', 9, blockedAt9)).toBe(false);
  });

  test('non-stat upgrades ignore gates entirely', () => {
    const upgrades = upgradesWithLevels({ shieldBarrier: 3, haste: 1 });
    expect(canLevelUpgrade('shieldBarrier', 3, upgrades)).toBe(true);
  });

  test('unknown upgrade ids are not gated', () => {
    expect(canLevelUpgrade('not_an_upgrade', 3, createUpgrades())).toBe(true);
  });
});

describe('getBlockingGate / getBlockingUpgrades', () => {
  test('returns the gate level when blocked, null when clear or off-gate', () => {
    const blocked = upgradesWithLevels({ might: 3, haste: 1 });
    expect(getBlockingGate(3, blocked)).toBe(3);
    const clear = upgradesWithLevels({ might: 3, haste: 3 });
    expect(getBlockingGate(3, clear)).toBeNull();
    expect(getBlockingGate(2, blocked)).toBeNull();
  });

  test('lists exactly the owned stat upgrades below the gate', () => {
    const upgrades = upgradesWithLevels({
      might: 3,        // at the gate — not blocking
      haste: 1,        // owned, below — blocking
      vitality: 2,     // owned, below — blocking
      shieldBarrier: 1, // below, but not a stat upgrade — excluded
    });
    const blocking = getBlockingUpgrades(3, upgrades).map(u => u.id).sort();
    expect(blocking).toEqual(['haste', 'vitality']);
  });
});

describe('getWeaponUpgrades — offer list construction', () => {
  test('owned non-maxed weapons get level-up entries with their real levels', () => {
    const manager = makeWeaponManager([{ id: 'katana', level: 3, maxLevel: 8 }]);
    const levelUps = getWeaponUpgrades(manager).filter(u => u.type === 'level');
    expect(levelUps).toHaveLength(1);
    expect(levelUps[0]).toMatchObject({
      id: 'level_katana',
      weaponId: 'katana',
      currentLevel: 3,
      maxLevel: 8,
    });
    expect(levelUps[0].weight).toBeUndefined();
  });

  test('maxed weapons get no level-up entry', () => {
    const manager = makeWeaponManager([{ id: 'katana', level: 8, maxLevel: 8 }]);
    expect(getWeaponUpgrades(manager).some(u => u.id === 'level_katana')).toBe(false);
  });

  test('every unowned unlockable appears as a new-weapon entry; owned ones do not', () => {
    const manager = makeWeaponManager([{ id: 'katana' }]);
    const adds = getWeaponUpgrades(manager).filter(u => u.type === 'add');
    expect(adds.map(u => u.weaponId).sort()).toEqual(
      UNLOCKABLE_IDS.filter(id => id !== 'katana').sort(),
    );
    expect(adds.every(u => u.id === `add_${u.weaponId}`)).toBe(true);
  });

  test('codex discovery weights new-weapon offers: base 10, +15 discovered, +1 per 5 uses capped at +10', () => {
    codexState.entries.set('aura', { discovered: true });
    codexState.entries.set('meteor', { discovered: true, timesUsed: 25 });
    codexState.entries.set('drone', { discovered: true, timesUsed: 500 });
    const adds = getWeaponUpgrades(makeWeaponManager([]));
    const weightOf = (weaponId: string) => adds.find(u => u.weaponId === weaponId)?.weight;
    expect(weightOf('katana')).toBe(10);  // undiscovered base
    expect(weightOf('aura')).toBe(25);    // discovered, unused
    expect(weightOf('meteor')).toBe(30);  // +5 usage bonus
    expect(weightOf('drone')).toBe(35);   // usage bonus capped at +10
  });
});

describe('getRandomCombinedUpgrades — normal levels', () => {
  test('fills the requested count with unique ids when the pool is ample', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([{ id: 'katana' }]), 3, 2,
      );
      expect(result).toHaveLength(3);
      expect(new Set(resultIds(result)).size).toBe(3);
    }
  });

  test('never offers NEW weapons off-milestone, even with free slots', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([], true), 3, 3,
      );
      expect(result.some(u => u.upgradeType === 'weapon')).toBe(false);
    }
  });

  test('mixes in exactly one weapon level-up alongside stats when both pools are ample', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(),
        makeWeaponManager([{ id: 'katana' }, { id: 'aura' }]),
        3, 2,
      );
      expect(result.filter(u => u.upgradeType === 'weapon')).toHaveLength(1);
      expect(result.filter(u => u.upgradeType === 'stat')).toHaveLength(2);
    }
  });

  test('never offers banished stat or weapon upgrades', () => {
    const banished = new Set(['might', 'level_katana']);
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([{ id: 'katana' }]), 3, 2, banished,
      );
      expect(resultIds(result).some(id => banished.has(id))).toBe(false);
    }
  });

  test('never offers a stat upgrade already at max level', () => {
    const upgrades = upgradesWithLevels({ might: 10 });
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(upgrades, makeWeaponManager(), 3, 2);
      expect(resultIds(result)).not.toContain('might');
    }
  });

  test('never offers a stat upgrade blocked at a break gate', () => {
    // might sits at gate 3 while owned haste lags at 1 — might must be filtered
    const upgrades = upgradesWithLevels({ might: 3, haste: 1 });
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(upgrades, makeWeaponManager(), 3, 2);
      expect(resultIds(result)).not.toContain('might');
    }
  });

  test('never surfaces overflow upgrades while the normal pool can fill the modal', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([{ id: 'katana' }]), 3, 2,
      );
      expect(resultIds(result).some(id => id.startsWith('overflow_'))).toBe(false);
    }
  });
});

describe('getRandomCombinedUpgrades — weapon milestone levels (every 5th)', () => {
  test('offers only weapon upgrades on a milestone', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([{ id: 'katana' }]), 3, 5,
      );
      expect(result.length).toBeGreaterThan(0);
      expect(result.every(u => u.upgradeType === 'weapon')).toBe(true);
    }
  });

  test('offers NEW weapons only while a slot is free', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const withSlot = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([], true), 3, 10,
      );
      expect(withSlot.every(u => u.upgradeType === 'weapon' && u.type === 'add')).toBe(true);

      const noSlot = getRandomCombinedUpgrades(
        createUpgrades(),
        makeWeaponManager([{ id: 'katana' }], false),
        3, 10,
      );
      expect(noSlot.every(u => u.upgradeType === 'weapon' && u.type === 'level')).toBe(true);
    }
  });

  test('respects banished weapon ids on milestones', () => {
    const banished = new Set(['add_katana', 'level_aura']);
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([{ id: 'aura' }]), 13, 5, banished,
      );
      expect(resultIds(result).some(id => banished.has(id))).toBe(false);
    }
  });

  test('caps the result at the requested count with unique ids', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([], true), 4, 5,
      );
      expect(result).toHaveLength(4);
      expect(new Set(resultIds(result)).size).toBe(4);
    }
  });

  test('pads an otherwise-empty milestone with overflow so the level-up is never dead', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeExhaustedWeaponManager(), 3, 5,
      );
      expect(result).toHaveLength(3);
      expect(result.every(u => u.id.startsWith('overflow_'))).toBe(true);
    }
  });

  test('does not pad with overflow while weapon level-ups remain', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(),
        makeWeaponManager([{ id: 'katana', level: 2 }], false),
        3, 5,
      );
      expect(resultIds(result)).toEqual(['level_katana']);
    }
  });
});

describe('getRandomCombinedUpgrades — Limit Break overflow fallback', () => {
  test('a fully exhausted run still gets a full modal of overflow upgrades', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        maxAllNormalUpgrades(), makeExhaustedWeaponManager(), 3, 7,
      );
      expect(result).toHaveLength(3);
      expect(result.every(u => u.id.startsWith('overflow_'))).toBe(true);
      expect(new Set(resultIds(result)).size).toBe(3);
    }
  });

  test('tops up a thin normal pool instead of leaving empty slots', () => {
    // Only might + haste still levelable, no weapons → 2 normal + 2 overflow
    const upgrades = maxAllNormalUpgrades();
    for (const upgrade of upgrades) {
      if (upgrade.id === 'might' || upgrade.id === 'haste') upgrade.currentLevel = 9;
    }
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        upgrades, makeExhaustedWeaponManager(), 4, 7,
      );
      expect(result).toHaveLength(4);
      const ids = resultIds(result);
      expect(ids).toContain('might');
      expect(ids).toContain('haste');
      expect(ids.filter(id => id.startsWith('overflow_'))).toHaveLength(2);
    }
  });

  test('banished overflow upgrades stay banished even as fallback', () => {
    const banished = new Set(['overflow_might', 'overflow_vitality']);
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        maxAllNormalUpgrades(), makeExhaustedWeaponManager(), 5, 7, banished,
      );
      // Only 3 of the 5 overflow upgrades remain — the modal shows what exists
      expect(resultIds(result).sort()).toEqual(
        ['overflow_allure', 'overflow_insight', 'overflow_swiftness'],
      );
    }
  });

  test('never duplicates overflow entries when asked for more than the pool holds', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        maxAllNormalUpgrades(), makeExhaustedWeaponManager(), 8, 7,
      );
      expect(result).toHaveLength(OVERFLOW_IDS.length);
      expect(new Set(resultIds(result)).size).toBe(OVERFLOW_IDS.length);
    }
  });
});

describe('upgrade rarity tiers — pool assignments', () => {
  test('every upgrade declares a valid rarity', () => {
    const validRarities = new Set<string>(UPGRADE_RARITIES);
    for (const upgrade of createUpgrades()) {
      expect(validRarities.has(upgrade.rarity), `${upgrade.id} rarity`).toBe(true);
    }
  });

  test('locks the per-upgrade rarity assignments', () => {
    const expected: Record<string, UpgradeRarity> = {
      might: 'common',
      haste: 'common',
      swiftness: 'common',
      vitality: 'common',
      multishot: 'epic',
      piercing: 'rare',
      reach: 'common',
      magnetism: 'common',
      velocity: 'common',
      shieldBarrier: 'rare',
      overflow_might: 'common',
      overflow_vitality: 'common',
      overflow_swiftness: 'common',
      overflow_insight: 'common',
      overflow_allure: 'common',
    };
    const actual = Object.fromEntries(createUpgrades().map(u => [u.id, u.rarity]));
    expect(actual).toEqual(expected);
  });

  test('overflow fallback upgrades are all common so padding stays unbiased', () => {
    const overflow = createUpgrades().filter(u => u.isOverflow);
    expect(overflow.every(u => u.rarity === 'common')).toBe(true);
  });
});

describe('getRandomCombinedUpgrades — luck-biased rarity roll', () => {
  /** Seeded offer count for one upgrade id across many rolls. */
  function countOffers(targetId: string, luck: number, seed: number, rolls: number): number {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
    let offers = 0;
    for (let roll = 0; roll < rolls; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([]), 3, 2, new Set(), luck,
      );
      if (resultIds(result).includes(targetId)) offers++;
    }
    vi.restoreAllMocks(); // each call needs a fresh seed, not the prior call's sequence
    return offers;
  }

  test('high luck surfaces the epic upgrade noticeably more often', () => {
    const rolls = 600;
    const atLuckZero = countOffers('multishot', 0, 1234, rolls);
    const atLuckMax = countOffers('multishot', 1, 1234, rolls);
    // luck 0 → uniform 3-of-10 ≈ 30%; luck 1 → epic weighs 2.5× a common
    expect(atLuckZero).toBeGreaterThan(rolls * 0.2);
    expect(atLuckZero).toBeLessThan(rolls * 0.4);
    expect(atLuckMax).toBeGreaterThan(atLuckZero * 1.2);
  });

  test('high luck boosts rare upgrades too, less than epic', () => {
    const rolls = 600;
    const rareZero = countOffers('piercing', 0, 99, rolls);
    const rareMax = countOffers('piercing', 1, 99, rolls);
    expect(rareMax).toBeGreaterThan(rareZero);
  });

  test('omitting luck behaves exactly like luck 0 (same seed → same offers)', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(42));
    const implicitRuns: string[][] = [];
    for (let roll = 0; roll < 20; roll++) {
      implicitRuns.push(resultIds(getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([{ id: 'katana' }]), 3, 2,
      )));
    }
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(42));
    const explicitRuns: string[][] = [];
    for (let roll = 0; roll < 20; roll++) {
      explicitRuns.push(resultIds(getRandomCombinedUpgrades(
        createUpgrades(), makeWeaponManager([{ id: 'katana' }]), 3, 2, new Set(), 0,
      )));
    }
    expect(explicitRuns).toEqual(implicitRuns);
  });

  test('luck does not change modal composition: still 1 weapon + 2 stats', () => {
    for (let roll = 0; roll < ROLLS; roll++) {
      const result = getRandomCombinedUpgrades(
        createUpgrades(),
        makeWeaponManager([{ id: 'katana' }, { id: 'aura' }]),
        3, 2, new Set(), 1,
      );
      expect(result.filter(u => u.upgradeType === 'weapon')).toHaveLength(1);
      expect(result.filter(u => u.upgradeType === 'stat')).toHaveLength(2);
    }
  });

  test('max luck never resurfaces banished, maxed, or gate-blocked upgrades', () => {
    const banished = new Set(['piercing']);
    // multishot maxed; might gate-blocked at 3 while haste lags
    const upgrades = upgradesWithLevels({ multishot: 10, might: 3, haste: 1 });
    for (let roll = 0; roll < ROLLS; roll++) {
      const ids = resultIds(getRandomCombinedUpgrades(
        upgrades, makeWeaponManager([]), 3, 2, banished, 1,
      ));
      expect(ids).not.toContain('piercing');
      expect(ids).not.toContain('multishot');
      expect(ids).not.toContain('might');
    }
  });
});
