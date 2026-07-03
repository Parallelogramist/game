import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so state round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one. Raw setItem lets tests
// inject corrupt/tampered payloads straight into the load path.
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

import { SecureStorage } from '../storage';
import {
  CardCollectionManager,
  getCardCollectionManager,
  resetCardCollectionManagerForTests,
  PITY_THRESHOLD,
  SCAN_COST,
} from './CardCollectionManager';
import { ALL_CARDS, type CardRarity } from '../data/Cards';

const KEY = 'survivor-meta-cards';

function idsOfRarity(rarity: CardRarity): string[] {
  return ALL_CARDS.filter((card) => card.rarity === rarity).map((card) => card.id);
}

const FIRST_COMMON = idsOfRarity('common')[0];
const FIRST_RARE = idsOfRarity('rare')[0];

/** Seed a RAW payload, then construct a fresh manager that loads it. */
function loadFrom(raw: string, rng: () => number = Math.random): CardCollectionManager {
  SecureStorage.setItem(KEY, raw);
  return new CardCollectionManager(rng);
}

beforeEach(() => {
  SecureStorage.removeItem(KEY);
  resetCardCollectionManagerForTests();
});

describe('exported constants', () => {
  test('SCAN_COST and PITY_THRESHOLD match the spec economy', () => {
    expect(SCAN_COST).toBe(500);
    expect(PITY_THRESHOLD).toBe(8);
  });
});

describe('fresh profile', () => {
  test('starts with nothing discovered, no pending reveal, full pity runway', () => {
    const manager = new CardCollectionManager();
    expect(manager.getDiscoveredIds().size).toBe(0);
    expect(manager.consumePendingReveal()).toBeNull();
    expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD);
  });
});

describe('discoverCard', () => {
  test('discovers, persists, and is idempotent', () => {
    const manager = new CardCollectionManager();
    manager.discoverCard(FIRST_COMMON);
    manager.discoverCard(FIRST_COMMON); // idempotent
    expect(manager.isDiscovered(FIRST_COMMON)).toBe(true);
    expect(manager.getDiscoveredIds().size).toBe(1);

    // A fresh instance re-reads the persisted state.
    const reloaded = new CardCollectionManager();
    expect(reloaded.isDiscovered(FIRST_COMMON)).toBe(true);
  });

  test('ignores unknown card ids entirely', () => {
    const manager = new CardCollectionManager();
    manager.discoverCard('card_totally_fake');
    expect(manager.getDiscoveredIds().size).toBe(0);
    expect(new CardCollectionManager().getDiscoveredIds().size).toBe(0);
  });
});

describe('pending reveal round-trip', () => {
  test('queue → persist → consume returns the definition and clears', () => {
    const manager = new CardCollectionManager();
    manager.queuePendingReveal(FIRST_RARE);

    // Survives a reload (cache picked up mid-run, revealed on the end screen).
    const reloaded = new CardCollectionManager();
    const revealed = reloaded.consumePendingReveal();
    expect(revealed?.id).toBe(FIRST_RARE);

    // Consume clears in memory AND in storage.
    expect(reloaded.consumePendingReveal()).toBeNull();
    expect(new CardCollectionManager().consumePendingReveal()).toBeNull();
  });

  test('ignores unknown ids', () => {
    const manager = new CardCollectionManager();
    manager.queuePendingReveal('card_totally_fake');
    expect(manager.consumePendingReveal()).toBeNull();
  });
});

describe('rollCacheDiscovery', () => {
  test('discovers the rolled card and queues it for the end screen', () => {
    // rng 0 → common rarity, first undiscovered common.
    const manager = new CardCollectionManager(() => 0);
    const card = manager.rollCacheDiscovery();
    expect(card?.id).toBe(FIRST_COMMON);
    expect(manager.isDiscovered(FIRST_COMMON)).toBe(true);
    expect(manager.consumePendingReveal()?.id).toBe(FIRST_COMMON);
  });

  test('successive rolls never dupe — they walk through the pool', () => {
    const manager = new CardCollectionManager(() => 0);
    const seen = new Set<string>();
    for (let i = 0; i < ALL_CARDS.length; i++) {
      const card = manager.rollCacheDiscovery();
      expect(card).not.toBeNull();
      expect(seen.has(card!.id)).toBe(false);
      seen.add(card!.id);
    }
    expect(seen.size).toBe(ALL_CARDS.length);
  });

  test('returns null (gold consolation path) when the archive is complete', () => {
    const manager = new CardCollectionManager(() => 0);
    for (const card of ALL_CARDS) manager.discoverCard(card.id);
    expect(manager.rollCacheDiscovery()).toBeNull();
    // A failed roll must not leave a stale pending reveal behind.
    expect(manager.consumePendingReveal()).toBeNull();
  });
});

describe('scan — lottery with pity', () => {
  test('the pity guarantee upgrades the 8th consecutive sub-epic scan', () => {
    // rng 0 → always rolls common; the pity tier roll (0 < epic weight) picks epic.
    const manager = new CardCollectionManager(() => 0);

    for (let i = 1; i < PITY_THRESHOLD; i++) {
      const { card, pityUsed } = manager.scan();
      expect(card?.rarity).toBe('common');
      expect(pityUsed).toBe(false);
      expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD - i);
    }

    // 8th scan: guaranteed epic-or-better.
    const { card, pityUsed } = manager.scan();
    expect(pityUsed).toBe(true);
    expect(card?.rarity).toBe('epic');
    // Counter resets — full runway again.
    expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD);
  });

  test('a natural epic+ resets the pity counter without flagging pityUsed', () => {
    const rolls = [0, 0, 0.95, 0]; // common scan, then a natural epic roll
    let index = 0;
    const manager = new CardCollectionManager(() => rolls[Math.min(index++, rolls.length - 1)]);

    manager.scan(); // common (rolls 0, 0)
    expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD - 1);

    const { card, pityUsed } = manager.scan(); // rolls 0.95 → epic, pick 0
    expect(card?.rarity).toBe('epic');
    expect(pityUsed).toBe(false);
    expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD);
  });

  test('pity prefers the premium tier that still has undiscovered cards', () => {
    const manager = new CardCollectionManager(() => 0);
    for (const id of idsOfRarity('epic')) manager.discoverCard(id);

    for (let i = 1; i < PITY_THRESHOLD; i++) manager.scan(); // commons
    const { card, pityUsed } = manager.scan();
    expect(pityUsed).toBe(true);
    expect(card?.rarity).toBe('legendary');
  });

  test('with all epic+ discovered the guarantee stays armed instead of burning', () => {
    const manager = new CardCollectionManager(() => 0);
    for (const id of [...idsOfRarity('epic'), ...idsOfRarity('legendary')]) {
      manager.discoverCard(id);
    }

    for (let i = 1; i < PITY_THRESHOLD; i++) manager.scan(); // commons
    // Pity fires but can only land a lower-tier fallback — the upgrade is not
    // consumed and the counter stays pinned.
    const { card, pityUsed } = manager.scan();
    expect(card).not.toBeNull();
    expect(['common', 'rare']).toContain(card!.rarity);
    expect(pityUsed).toBe(false);
    expect(manager.getScansUntilPity()).toBe(1);
  });

  test('pity counter survives a reload mid-streak', () => {
    const manager = new CardCollectionManager(() => 0);
    for (let i = 0; i < 5; i++) manager.scan();
    const reloaded = new CardCollectionManager(() => 0);
    expect(reloaded.getScansUntilPity()).toBe(PITY_THRESHOLD - 5);
  });

  test('returns a null card when the archive is complete (scanner disabled guard)', () => {
    const manager = new CardCollectionManager(() => 0);
    for (const card of ALL_CARDS) manager.discoverCard(card.id);
    expect(manager.scan()).toEqual({ card: null, pityUsed: false });
  });
});

describe('getAggregatedBonuses', () => {
  test('reflects the discovered collection', () => {
    const manager = new CardCollectionManager();
    expect(manager.getAggregatedBonuses().damageMult).toBe(1);
    manager.discoverCard('card_void_capacitor'); // +5% damage
    expect(manager.getAggregatedBonuses().damageMult).toBeCloseTo(1.05, 10);
  });
});

describe('corrupt/tampered storage resilience', () => {
  // SecureStorage is the anti-cheat layer, so a corrupt/tampered payload is the
  // threat model (same class as MusicManager.loadEnabledTracks): rebuild from
  // KNOWN card ids, drop junk, clamp counters, tolerate non-objects.

  test('non-JSON and non-object payloads fall back to fresh defaults', () => {
    for (const raw of ['not-json', '42', '"hello"', 'null', '[1,2,3]', 'true']) {
      const manager = loadFrom(raw);
      expect(manager.getDiscoveredIds().size).toBe(0);
      expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD);
      expect(manager.consumePendingReveal()).toBeNull();
    }
  });

  test('unknown / non-string discovered entries are dropped, known ids kept', () => {
    const manager = loadFrom(
      `{"discovered":["${FIRST_COMMON}","card_hacked",42,null,{},"${FIRST_RARE}"],"scansSincePity":0,"pendingReveal":null}`,
    );
    expect(manager.isDiscovered(FIRST_COMMON)).toBe(true);
    expect(manager.isDiscovered(FIRST_RARE)).toBe(true);
    expect(manager.getDiscoveredIds().size).toBe(2);
  });

  test('a non-array discovered field is tolerated as empty', () => {
    for (const field of ['"hello"', '{"a":1}', '42', 'null']) {
      const manager = loadFrom(`{"discovered":${field},"scansSincePity":2}`);
      expect(manager.getDiscoveredIds().size).toBe(0);
      // The rest of the payload still loads.
      expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD - 2);
    }
  });

  test('a negative pity counter clamps to 0', () => {
    const manager = loadFrom('{"discovered":[],"scansSincePity":-9}');
    expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD);
  });

  test('an over-cap pity counter clamps to the guaranteed-next-scan state', () => {
    const manager = loadFrom('{"discovered":[],"scansSincePity":9999}');
    expect(manager.getScansUntilPity()).toBe(1);
  });

  test('a non-finite or non-numeric pity counter falls back to 0', () => {
    for (const field of ['1e999', '"abc"', '{}', 'null']) {
      const manager = loadFrom(`{"discovered":[],"scansSincePity":${field}}`);
      expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD);
    }
  });

  test('a fractional pity counter is floored', () => {
    const manager = loadFrom('{"discovered":[],"scansSincePity":3.9}');
    expect(manager.getScansUntilPity()).toBe(PITY_THRESHOLD - 3);
  });

  test('an unknown pendingReveal id is rejected to null', () => {
    const manager = loadFrom('{"discovered":[],"scansSincePity":0,"pendingReveal":"card_hacked"}');
    expect(manager.consumePendingReveal()).toBeNull();
  });

  test('valid state round-trips unchanged through save + load', () => {
    const manager = new CardCollectionManager();
    manager.discoverCard(FIRST_COMMON);
    manager.discoverCard(FIRST_RARE);
    manager.queuePendingReveal(FIRST_RARE);

    const reloaded = new CardCollectionManager();
    expect(reloaded.isDiscovered(FIRST_COMMON)).toBe(true);
    expect(reloaded.isDiscovered(FIRST_RARE)).toBe(true);
    expect(reloaded.consumePendingReveal()?.id).toBe(FIRST_RARE);
  });
});

describe('singleton access', () => {
  test('getCardCollectionManager returns a stable instance until reset', () => {
    const first = getCardCollectionManager();
    expect(getCardCollectionManager()).toBe(first);

    first.discoverCard(FIRST_COMMON);
    resetCardCollectionManagerForTests();

    const second = getCardCollectionManager();
    expect(second).not.toBe(first);
    // The fresh instance still sees the persisted discovery.
    expect(second.isDiscovered(FIRST_COMMON)).toBe(true);
  });
});
