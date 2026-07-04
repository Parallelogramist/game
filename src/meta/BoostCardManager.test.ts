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
  BoostCardManager,
  getBoostCardManager,
  resetBoostCardManagerForTests,
} from './BoostCardManager';
import { ALL_BOOST_CARDS } from '../data/BoostCards';

const KEY = 'survivor-meta-boosts';

const FIRST_BOOST = ALL_BOOST_CARDS[0].id;
const SECOND_BOOST = ALL_BOOST_CARDS[1].id;

/** Seed a RAW payload, then construct a fresh manager that loads it. */
function loadFrom(raw: string, rng: () => number = Math.random): BoostCardManager {
  SecureStorage.setItem(KEY, raw);
  return new BoostCardManager(rng);
}

beforeEach(() => {
  SecureStorage.removeItem(KEY);
  resetBoostCardManagerForTests();
});

describe('fresh profile', () => {
  test('starts with nothing armed', () => {
    const manager = new BoostCardManager();
    expect(manager.getPending()).toBeNull();
    expect(manager.consumePending()).toBeNull();
  });
});

describe('queueBoost / getPending', () => {
  test('arms a boost, persists it, and peeking has no side effects', () => {
    const manager = new BoostCardManager();
    manager.queueBoost(FIRST_BOOST);
    expect(manager.getPending()?.id).toBe(FIRST_BOOST);
    // Peek again — still armed (no consumption on read).
    expect(manager.getPending()?.id).toBe(FIRST_BOOST);

    // A fresh instance re-reads the persisted state (boost survives a reload
    // AND a save-restore of the current run — restore never touches it).
    const reloaded = new BoostCardManager();
    expect(reloaded.getPending()?.id).toBe(FIRST_BOOST);
  });

  test('ignores unknown boost ids entirely', () => {
    const manager = new BoostCardManager();
    manager.queueBoost('boost_totally_fake');
    expect(manager.getPending()).toBeNull();
    expect(new BoostCardManager().getPending()).toBeNull();
  });
});

describe('consumePending — fresh-run start path', () => {
  test('queue → persist → consume returns the definition and clears', () => {
    const manager = new BoostCardManager();
    manager.queueBoost(FIRST_BOOST);

    const reloaded = new BoostCardManager();
    const consumed = reloaded.consumePending();
    expect(consumed?.id).toBe(FIRST_BOOST);

    // Consume clears in memory AND in storage — one-shot by construction.
    expect(reloaded.consumePending()).toBeNull();
    expect(new BoostCardManager().consumePending()).toBeNull();
  });

  test('after consuming, the flux cache can roll again', () => {
    const manager = new BoostCardManager(() => 0);
    expect(manager.rollFluxCache()).not.toBeNull();
    manager.consumePending();
    expect(manager.rollFluxCache()).not.toBeNull();
  });
});

describe('rollFluxCache', () => {
  test('rolls uniformly and queues the boost for the next run', () => {
    // rng 0 → first boost in the catalog.
    const manager = new BoostCardManager(() => 0);
    const boost = manager.rollFluxCache();
    expect(boost?.id).toBe(FIRST_BOOST);
    expect(manager.getPending()?.id).toBe(FIRST_BOOST);
    // Persisted: the armed boost survives a reload.
    expect(new BoostCardManager().getPending()?.id).toBe(FIRST_BOOST);
  });

  test('returns null while a boost is already held — no re-roll, no replace', () => {
    const manager = new BoostCardManager(() => 0);
    const first = manager.rollFluxCache();
    expect(first?.id).toBe(FIRST_BOOST);

    // Second roll refuses outright and leaves the held boost untouched.
    expect(manager.rollFluxCache()).toBeNull();
    expect(manager.getPending()?.id).toBe(FIRST_BOOST);
  });

  test('a boost armed on a previous session still blocks the roll', () => {
    const manager = new BoostCardManager();
    manager.queueBoost(SECOND_BOOST);

    const reloaded = new BoostCardManager(() => 0);
    expect(reloaded.rollFluxCache()).toBeNull();
    expect(reloaded.getPending()?.id).toBe(SECOND_BOOST);
  });
});

describe('corrupt/tampered storage resilience', () => {
  // SecureStorage is the anti-cheat layer, so a corrupt/tampered payload is
  // the threat model (same class as CardCollectionManager): accept only a
  // known boost id, tolerate non-objects, fall back to nothing armed.

  test('non-JSON and non-object payloads fall back to fresh defaults', () => {
    for (const raw of ['not-json', '42', '"hello"', 'null', '[1,2,3]', 'true']) {
      const manager = loadFrom(raw);
      expect(manager.getPending()).toBeNull();
    }
  });

  test('an unknown pending id is rejected to null', () => {
    const manager = loadFrom('{"pending":"boost_hacked"}');
    expect(manager.getPending()).toBeNull();
  });

  test('a permanent-card id smuggled into pending is rejected', () => {
    const manager = loadFrom('{"pending":"card_hull_patch"}');
    expect(manager.getPending()).toBeNull();
  });

  test('non-string pending fields are tolerated as nothing armed', () => {
    for (const field of ['42', 'null', '{}', '[1]', 'true']) {
      const manager = loadFrom(`{"pending":${field}}`);
      expect(manager.getPending()).toBeNull();
    }
  });

  test('a missing pending field is tolerated as nothing armed', () => {
    const manager = loadFrom('{"junk":true}');
    expect(manager.getPending()).toBeNull();
  });

  test('valid state round-trips unchanged through save + load', () => {
    const manager = new BoostCardManager();
    manager.queueBoost(SECOND_BOOST);

    const reloaded = new BoostCardManager();
    expect(reloaded.getPending()?.id).toBe(SECOND_BOOST);
    expect(reloaded.consumePending()?.id).toBe(SECOND_BOOST);

    // The cleared state round-trips too.
    expect(new BoostCardManager().getPending()).toBeNull();
  });
});

describe('singleton access', () => {
  test('getBoostCardManager returns a stable instance until reset', () => {
    const first = getBoostCardManager();
    expect(getBoostCardManager()).toBe(first);

    first.queueBoost(FIRST_BOOST);
    resetBoostCardManagerForTests();

    const second = getBoostCardManager();
    expect(second).not.toBe(first);
    // The fresh instance still sees the persisted armed boost.
    expect(second.getPending()?.id).toBe(FIRST_BOOST);
  });
});
