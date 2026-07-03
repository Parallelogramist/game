import { describe, test, expect } from 'vitest';
import {
  SHIP_MOD_TRACKS,
  aggregateShipModBonuses,
  getShipModCost,
  getShipModTracks,
  type ShipModEffect,
  type ShipModTrack,
} from './ShipMods';
import { SHIP_CHARACTERS } from './ShipCharacters';

/**
 * Pure mod-track catalog + aggregation logic behind the per-ship hangar meta
 * system. Core contracts: every ship in the roster has exactly 3 tracks, the
 * shared 400/700/1200 cost curve, archetype reuse is consistent (same track
 * id ⇒ same effect on every ship), cost lookup fails safe to Infinity, and
 * the aggregate compounds multipliers (value^level) / scales adds linearly
 * (value·level) over identity defaults so zero purchases is a strict no-op.
 */

const IDENTITY: Required<ShipModEffect> = {
  maxHealthMult: 1,
  moveSpeedMult: 1,
  damageMult: 1,
  cooldownMult: 1,
  goldMult: 1,
  xpMult: 1,
  critChanceAdd: 0,
  armorAdd: 0,
  regenAdd: 0,
  lifeStealAdd: 0,
  bossDamageAdd: 0,
  luckAdd: 0,
};

function allTracks(): ShipModTrack[] {
  return Object.values(SHIP_MOD_TRACKS).flat();
}

describe('SHIP_MOD_TRACKS — table structure', () => {
  test('every ship in the roster has exactly 3 mod tracks', () => {
    for (const ship of SHIP_CHARACTERS) {
      expect(SHIP_MOD_TRACKS[ship.id], `ship ${ship.id}`).toBeDefined();
      expect(SHIP_MOD_TRACKS[ship.id], `ship ${ship.id}`).toHaveLength(3);
    }
  });

  test('no orphaned ship ids in the table (roster ↔ table stay in lockstep)', () => {
    const rosterIds = new Set(SHIP_CHARACTERS.map((ship) => ship.id));
    for (const shipId of Object.keys(SHIP_MOD_TRACKS)) {
      expect(rosterIds.has(shipId), `table ship ${shipId}`).toBe(true);
    }
  });

  test('track ids are unique within each ship (no duplicate archetypes)', () => {
    for (const [shipId, tracks] of Object.entries(SHIP_MOD_TRACKS)) {
      const ids = tracks.map((track) => track.id);
      expect(new Set(ids).size, `ship ${shipId}`).toBe(ids.length);
    }
  });

  test('every track uses the spec economy: 3 levels at 400/700/1200 gold', () => {
    for (const track of allTracks()) {
      expect(track.maxLevel, track.id).toBe(3);
      expect(track.costs, track.id).toEqual([400, 700, 1200]);
    }
  });

  test('costs.length === maxLevel and every cost is a positive finite number', () => {
    for (const track of allTracks()) {
      expect(track.costs.length, track.id).toBe(track.maxLevel);
      for (const cost of track.costs) {
        expect(Number.isFinite(cost), track.id).toBe(true);
        expect(cost, track.id).toBeGreaterThan(0);
      }
    }
  });

  test('every track has a non-empty name and a per-level description', () => {
    for (const track of allTracks()) {
      expect(track.name.length, track.id).toBeGreaterThan(0);
      expect(track.description, track.id).toContain('per level');
    }
  });

  test('every track grants at least one effect field, all finite numbers', () => {
    for (const track of allTracks()) {
      const entries = Object.entries(track.effectPerLevel);
      expect(entries.length, track.id).toBeGreaterThan(0);
      for (const [, value] of entries) {
        expect(typeof value).toBe('number');
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  test('archetype reuse is consistent — same track id ⇒ same effect everywhere', () => {
    const seen = new Map<string, ShipModTrack>();
    for (const track of allTracks()) {
      const first = seen.get(track.id);
      if (!first) {
        seen.set(track.id, track);
        continue;
      }
      expect(track.name, track.id).toBe(first.name);
      expect(track.description, track.id).toBe(first.description);
      expect(track.maxLevel, track.id).toBe(first.maxLevel);
      expect(track.costs, track.id).toEqual(first.costs);
      expect(track.effectPerLevel, track.id).toEqual(first.effectPerLevel);
    }
  });
});

describe('getShipModTracks', () => {
  test('returns the table entry for known ships', () => {
    expect(getShipModTracks('ship_default')).toBe(SHIP_MOD_TRACKS['ship_default']);
  });

  test('returns [] for unknown ship ids so callers never branch', () => {
    expect(getShipModTracks('ship_nope')).toEqual([]);
    expect(getShipModTracks('')).toEqual([]);
  });
});

describe('getShipModCost', () => {
  const track = SHIP_MOD_TRACKS['ship_default'][0];

  test('returns costs[currentLevel] on the way up the track', () => {
    expect(getShipModCost(track, 0)).toBe(400);
    expect(getShipModCost(track, 1)).toBe(700);
    expect(getShipModCost(track, 2)).toBe(1200);
  });

  test('returns Infinity at and past maxLevel (MAXED — nothing to buy)', () => {
    expect(getShipModCost(track, track.maxLevel)).toBe(Infinity);
    expect(getShipModCost(track, track.maxLevel + 5)).toBe(Infinity);
  });

  test('fails safe to Infinity for out-of-domain levels (corrupt input guard)', () => {
    expect(getShipModCost(track, -1)).toBe(Infinity);
    expect(getShipModCost(track, 1.5)).toBe(Infinity);
    expect(getShipModCost(track, NaN)).toBe(Infinity);
  });
});

describe('aggregateShipModBonuses', () => {
  test('no purchases aggregates to the exact identity block', () => {
    expect(aggregateShipModBonuses('ship_default', {})).toEqual(IDENTITY);
  });

  test('an unknown ship id aggregates to the identity block', () => {
    expect(aggregateShipModBonuses('ship_nope', { hull: 3 })).toEqual(IDENTITY);
  });

  test('unknown track ids in the levels record contribute nothing', () => {
    expect(aggregateShipModBonuses('ship_default', { fake_track: 3, boss: 2 })).toEqual(IDENTITY);
  });

  test('multiplier effects COMPOUND per level (value^level)', () => {
    // ship_default hull: +4% max HP per level → 1.04² at level 2, not 1.08.
    const aggregated = aggregateShipModBonuses('ship_default', { hull: 2 });
    expect(aggregated.maxHealthMult).toBeCloseTo(1.04 ** 2, 10);
    expect({ ...aggregated, maxHealthMult: 1 }).toEqual(IDENTITY);
  });

  test('additive effects scale LINEARLY per level (value·level)', () => {
    // ship_scholar armor: +1 armor per level.
    const aggregated = aggregateShipModBonuses('ship_scholar', { armor: 3 });
    expect(aggregated.armorAdd).toBe(3);
    expect({ ...aggregated, armorAdd: 0 }).toEqual(IDENTITY);
  });

  test('multiple tracks stack into one block', () => {
    // ship_interceptor: thrusters ×1.02/level, cooldown ×0.985/level,
    // targeting +0.01/level.
    const aggregated = aggregateShipModBonuses('ship_interceptor', {
      thrusters: 3,
      cooldown: 2,
      targeting: 1,
    });
    expect(aggregated.moveSpeedMult).toBeCloseTo(1.02 ** 3, 10);
    expect(aggregated.cooldownMult).toBeCloseTo(0.985 ** 2, 10);
    expect(aggregated.critChanceAdd).toBeCloseTo(0.01, 10);
  });

  test('levels clamp to [0, maxLevel] — corrupt values cannot over-apply', () => {
    const capped = aggregateShipModBonuses('ship_default', { hull: 999 });
    expect(capped.maxHealthMult).toBeCloseTo(1.04 ** 3, 10);

    expect(aggregateShipModBonuses('ship_default', { hull: -5 })).toEqual(IDENTITY);
    // Non-finite levels are rejected outright (treated as 0), not clamped —
    // Infinity is corruption, not enthusiasm.
    expect(aggregateShipModBonuses('ship_default', { hull: NaN })).toEqual(IDENTITY);
    expect(aggregateShipModBonuses('ship_default', { hull: Infinity })).toEqual(IDENTITY);
  });

  test('fractional levels are floored, never rounded up', () => {
    const aggregated = aggregateShipModBonuses('ship_default', { hull: 2.9 });
    expect(aggregated.maxHealthMult).toBeCloseTo(1.04 ** 2, 10);
  });

  test('a fully modded ship stays "one mid-tier shop level" small (feel guard)', () => {
    for (const [shipId, tracks] of Object.entries(SHIP_MOD_TRACKS)) {
      const maxed: Record<string, number> = {};
      for (const track of tracks) maxed[track.id] = track.maxLevel;
      const aggregated = aggregateShipModBonuses(shipId, maxed);
      for (const [key, value] of Object.entries(aggregated)) {
        expect(Number.isFinite(value), `${shipId}.${key}`).toBe(true);
      }
      // Scope guard from the spec: mods are flavor, not a parallel power system.
      expect(aggregated.maxHealthMult, shipId).toBeLessThan(1.15);
      expect(aggregated.damageMult, shipId).toBeLessThan(1.1);
      expect(aggregated.cooldownMult, shipId).toBeGreaterThan(0.9);
    }
  });

  test('does not mutate the input levels record', () => {
    const levels = { hull: 2 };
    aggregateShipModBonuses('ship_default', levels);
    expect(levels).toEqual({ hull: 2 });
  });
});
