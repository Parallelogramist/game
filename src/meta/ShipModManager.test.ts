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
  ShipModManager,
  getShipModManager,
  resetShipModManagerForTests,
} from './ShipModManager';
import { SHIP_MOD_TRACKS, getShipModTracks } from '../data/ShipMods';
import { SHIP_CHARACTERS } from '../data/ShipCharacters';

const KEY = 'survivor-meta-ship-mods';

// Real catalog anchors so the tests track the table instead of hardcoding it.
const SHIP = 'ship_default';
const TRACKS = SHIP_MOD_TRACKS[SHIP];
const TRACK = TRACKS[0].id;
const OTHER_TRACK = TRACKS[1].id;

/** Seed a RAW payload, then construct a fresh manager that loads it. */
function loadFrom(raw: string): ShipModManager {
  SecureStorage.setItem(KEY, raw);
  return new ShipModManager();
}

beforeEach(() => {
  SecureStorage.removeItem(KEY);
  resetShipModManagerForTests();
});

describe('fresh profile', () => {
  test('every ship starts with all tracks at level 0', () => {
    const manager = new ShipModManager();
    for (const ship of SHIP_CHARACTERS) {
      for (const track of getShipModTracks(ship.id)) {
        expect(manager.getLevel(ship.id, track.id), `${ship.id}.${track.id}`).toBe(0);
      }
      expect(manager.getTotalLevels(ship.id)).toBe(0);
      expect(manager.getMaxTotalLevels(ship.id)).toBe(9); // 3 tracks × 3 levels
    }
  });

  test('unknown ids read as level 0 / zero totals, never throw', () => {
    const manager = new ShipModManager();
    expect(manager.getLevel('ship_nope', 'hull')).toBe(0);
    expect(manager.getLevel(SHIP, 'fake_track')).toBe(0);
    expect(manager.getTotalLevels('ship_nope')).toBe(0);
    expect(manager.getMaxTotalLevels('ship_nope')).toBe(0);
  });
});

describe('purchase', () => {
  test('walks a track to its cap, then refuses (false, no state change)', () => {
    const manager = new ShipModManager();
    const maxLevel = TRACKS[0].maxLevel;

    for (let level = 1; level <= maxLevel; level++) {
      expect(manager.purchase(SHIP, TRACK)).toBe(true);
      expect(manager.getLevel(SHIP, TRACK)).toBe(level);
    }

    // At cap: refused, level untouched.
    expect(manager.purchase(SHIP, TRACK)).toBe(false);
    expect(manager.getLevel(SHIP, TRACK)).toBe(maxLevel);
  });

  test('tracks progress independently — one track capping does not block another', () => {
    const manager = new ShipModManager();
    for (let i = 0; i < TRACKS[0].maxLevel; i++) manager.purchase(SHIP, TRACK);
    expect(manager.purchase(SHIP, OTHER_TRACK)).toBe(true);
    expect(manager.getLevel(SHIP, OTHER_TRACK)).toBe(1);
    expect(manager.getTotalLevels(SHIP)).toBe(TRACKS[0].maxLevel + 1);
  });

  test('ships progress independently — same archetype id, separate levels', () => {
    // hull appears on both ship_default and ship_juggernaut.
    const manager = new ShipModManager();
    expect(manager.purchase('ship_default', 'hull')).toBe(true);
    expect(manager.getLevel('ship_default', 'hull')).toBe(1);
    expect(manager.getLevel('ship_juggernaut', 'hull')).toBe(0);
  });

  test('refuses unknown ship ids and unknown track ids without persisting', () => {
    const manager = new ShipModManager();
    expect(manager.purchase('ship_nope', 'hull')).toBe(false);
    expect(manager.purchase(SHIP, 'fake_track')).toBe(false);
    // A track valid on another ship is still unknown for THIS ship.
    expect(manager.purchase(SHIP, 'boss')).toBe(false);
    // Nothing landed in storage (purchase persists only on success).
    expect(SecureStorage.getItem(KEY)).toBeNull();
  });
});

describe('persistence round-trip', () => {
  test('purchased levels survive a reload', () => {
    const manager = new ShipModManager();
    manager.purchase(SHIP, TRACK);
    manager.purchase(SHIP, TRACK);
    manager.purchase('ship_juggernaut', 'armor');

    const reloaded = new ShipModManager();
    expect(reloaded.getLevel(SHIP, TRACK)).toBe(2);
    expect(reloaded.getLevel('ship_juggernaut', 'armor')).toBe(1);
    expect(reloaded.getTotalLevels(SHIP)).toBe(2);
  });

  test('persists the spec payload shape: { [shipId]: { [trackId]: level } }', () => {
    const manager = new ShipModManager();
    manager.purchase(SHIP, TRACK);
    manager.purchase(SHIP, TRACK);
    expect(JSON.parse(SecureStorage.getItem(KEY)!)).toEqual({ [SHIP]: { [TRACK]: 2 } });
  });
});

describe('corrupt/tampered storage resilience', () => {
  // SecureStorage is the anti-cheat layer, so a corrupt/tampered payload is
  // the threat model (same class as CardCollectionManager.load): rebuild from
  // KNOWN ship/track ids, clamp levels to sane integers, tolerate non-objects.

  test('non-JSON and non-object payloads fall back to fresh defaults', () => {
    for (const raw of ['not-json', '42', '"hello"', 'null', '[1,2,3]', 'true']) {
      const manager = loadFrom(raw);
      expect(manager.getTotalLevels(SHIP)).toBe(0);
      expect(manager.getLevel(SHIP, TRACK)).toBe(0);
    }
  });

  test('unknown ship ids are dropped, known ships kept', () => {
    const manager = loadFrom(
      `{"ship_hacked":{"hull":3},"${SHIP}":{"${TRACK}":2}}`,
    );
    expect(manager.getLevel(SHIP, TRACK)).toBe(2);
    expect(manager.getLevel('ship_hacked', 'hull')).toBe(0);
    expect(manager.getTotalLevels('ship_hacked')).toBe(0);
  });

  test('unknown track ids are dropped, known tracks kept', () => {
    // 'boss' is a real archetype but not one of ship_default's tracks.
    const manager = loadFrom(
      `{"${SHIP}":{"track_hacked":3,"boss":3,"${TRACK}":1}}`,
    );
    expect(manager.getLevel(SHIP, TRACK)).toBe(1);
    expect(manager.getLevel(SHIP, 'track_hacked')).toBe(0);
    expect(manager.getLevel(SHIP, 'boss')).toBe(0);
    expect(manager.getTotalLevels(SHIP)).toBe(1);
  });

  test('a non-object ship block is tolerated as empty, others still load', () => {
    for (const block of ['"hello"', '42', 'null', '[1,2]', 'true']) {
      const manager = loadFrom(
        `{"${SHIP}":${block},"ship_juggernaut":{"armor":1}}`,
      );
      expect(manager.getTotalLevels(SHIP)).toBe(0);
      expect(manager.getLevel('ship_juggernaut', 'armor')).toBe(1);
    }
  });

  test('negative levels clamp to 0', () => {
    const manager = loadFrom(`{"${SHIP}":{"${TRACK}":-7}}`);
    expect(manager.getLevel(SHIP, TRACK)).toBe(0);
  });

  test('huge levels clamp to maxLevel — tampering cannot exceed the cap', () => {
    const manager = loadFrom(`{"${SHIP}":{"${TRACK}":9999}}`);
    expect(manager.getLevel(SHIP, TRACK)).toBe(TRACKS[0].maxLevel);
    // And the cap still holds: no further purchase.
    expect(manager.purchase(SHIP, TRACK)).toBe(false);
  });

  test('fractional levels are floored', () => {
    const manager = loadFrom(`{"${SHIP}":{"${TRACK}":1.9}}`);
    expect(manager.getLevel(SHIP, TRACK)).toBe(1);
  });

  test('non-numeric and non-finite levels fall back to 0', () => {
    for (const level of ['1e999', '"abc"', '{}', 'null', '[]', 'true']) {
      const manager = loadFrom(`{"${SHIP}":{"${TRACK}":${level}}}`);
      expect(manager.getLevel(SHIP, TRACK), `level ${level}`).toBe(0);
    }
  });

  test('a clamped level round-trips CLEAN on the next save (self-healing)', () => {
    const manager = loadFrom(`{"${SHIP}":{"${TRACK}":9999,"track_hacked":5}}`);
    manager.purchase(SHIP, OTHER_TRACK); // any successful purchase re-saves
    const reloaded = new ShipModManager();
    expect(reloaded.getLevel(SHIP, TRACK)).toBe(TRACKS[0].maxLevel);
    expect(JSON.parse(SecureStorage.getItem(KEY)!)[SHIP]['track_hacked']).toBeUndefined();
  });
});

describe('getAggregatedBonuses', () => {
  test('no purchases yields the exact identity block', () => {
    const manager = new ShipModManager();
    const bonuses = manager.getAggregatedBonuses(SHIP);
    expect(bonuses.maxHealthMult).toBe(1);
    expect(bonuses.damageMult).toBe(1);
    expect(bonuses.cooldownMult).toBe(1);
    expect(bonuses.armorAdd).toBe(0);
    expect(bonuses.critChanceAdd).toBe(0);
  });

  test('reflects purchases: mults compound, adds scale linearly', () => {
    // ship_juggernaut: hull ×1.04/level, armor +1/level, regen +0.2/level.
    const manager = new ShipModManager();
    manager.purchase('ship_juggernaut', 'hull');
    manager.purchase('ship_juggernaut', 'hull');
    manager.purchase('ship_juggernaut', 'armor');
    manager.purchase('ship_juggernaut', 'regen');
    manager.purchase('ship_juggernaut', 'regen');
    manager.purchase('ship_juggernaut', 'regen');

    const bonuses = manager.getAggregatedBonuses('ship_juggernaut');
    expect(bonuses.maxHealthMult).toBeCloseTo(1.04 ** 2, 10);
    expect(bonuses.armorAdd).toBe(1);
    expect(bonuses.regenAdd).toBeCloseTo(0.6, 10);
    // Purchases on one ship never bleed into another's block.
    expect(manager.getAggregatedBonuses(SHIP).maxHealthMult).toBe(1);
  });

  test('bonuses survive a reload (run-start block reads persisted state)', () => {
    const manager = new ShipModManager();
    manager.purchase(SHIP, TRACK);
    const reloaded = new ShipModManager();
    expect(reloaded.getAggregatedBonuses(SHIP)).toEqual(manager.getAggregatedBonuses(SHIP));
  });
});

describe('singleton access', () => {
  test('getShipModManager returns a stable instance until reset', () => {
    const first = getShipModManager();
    expect(getShipModManager()).toBe(first);

    first.purchase(SHIP, TRACK);
    resetShipModManagerForTests();

    const second = getShipModManager();
    expect(second).not.toBe(first);
    // The fresh instance still sees the persisted purchase.
    expect(second.getLevel(SHIP, TRACK)).toBe(1);
  });
});

describe('getFullyModdedShipCount', () => {
  test('counts only ships with every track at cap', () => {
    const manager = getShipModManager();
    expect(manager.getFullyModdedShipCount()).toBe(0);

    // Max every track of one ship.
    for (const track of getShipModTracks(SHIP)) {
      for (let i = 0; i < track.maxLevel; i++) manager.purchase(SHIP, track.id);
    }
    expect(manager.getFullyModdedShipCount()).toBe(1);

    // A partially modded second ship does not count.
    const other = SHIP_CHARACTERS.find((ship) => ship.id !== SHIP)!.id;
    const otherTrack = getShipModTracks(other)[0];
    manager.purchase(other, otherTrack.id);
    expect(manager.getFullyModdedShipCount()).toBe(1);
  });
});

describe('fleet-mastery achievement lockstep', () => {
  test('ship_mods_fleet targets exactly the current roster size', async () => {
    // A new ship added to the roster must bump the Fleet Admiral target, or
    // the achievement unlocks one ship early.
    const { ACHIEVEMENTS } = await import('../achievements/AchievementDefinitions');
    const fleet = ACHIEVEMENTS.find((achievement) => achievement.id === 'ship_mods_fleet');
    expect(fleet).toBeDefined();
    expect(fleet!.targetValue).toBe(SHIP_CHARACTERS.length);
  });
});
