import { describe, test, expect } from 'vitest';
import { SHIP_CHARACTERS, getShipById, getDefaultShip } from './ShipCharacters';
import { HIDDEN_UNLOCKS } from '../meta/HiddenUnlocks';

// The canonical weapon roster — mirrors WeaponRegistry in src/weapons/index.ts
// (same explicit checkpoint as WeaponEvolutions.test.ts: the registry module is
// Phaser-coupled, so the id list is locked here instead of imported). Adding a
// weapon means updating this list consciously.
const REGISTRY_WEAPON_IDS = [
  'projectile', 'katana', 'orbiting_blades', 'aura', 'chain_lightning',
  'homing_missile', 'frost_nova', 'laser_beam', 'meteor', 'flamethrower',
  'ricochet', 'ground_spike', 'drone', 'shuriken',
];

// WeaponSelectScene.getAvailableShips() only understands 'hidden:<conditionId>'.
// The interface doc also mentions 'account:<level>' but no consumer parses it —
// an account: gate would silently ship always-unlocked. Lock hidden-only until
// account gating is actually implemented.
const HIDDEN_GATE_PATTERN = /^hidden:([a-z0-9_]+)$/;

describe('SHIP_CHARACTERS — table integrity', () => {
  test('ship ids are unique and non-empty', () => {
    const ids = SHIP_CHARACTERS.map((ship) => ship.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  test('every ship has a player-facing name and description', () => {
    for (const ship of SHIP_CHARACTERS) {
      expect(ship.name.trim().length, ship.id).toBeGreaterThan(0);
      expect(ship.description.trim().length, ship.id).toBeGreaterThan(0);
    }
  });

  test('every starting weapon resolves in the weapon registry', () => {
    for (const ship of SHIP_CHARACTERS) {
      expect(
        REGISTRY_WEAPON_IDS.includes(ship.startingWeaponId),
        `${ship.id} starting weapon "${ship.startingWeaponId}"`
      ).toBe(true);
    }
  });

  test('all core stat multipliers are finite and positive', () => {
    for (const ship of SHIP_CHARACTERS) {
      for (const [field, value] of [
        ['healthMultiplier', ship.healthMultiplier],
        ['moveSpeedMultiplier', ship.moveSpeedMultiplier],
        ['damageMultiplier', ship.damageMultiplier],
        ['cooldownMultiplier', ship.cooldownMultiplier],
        ['xpMultiplier', ship.xpMultiplier],
        ['goldMultiplier', ship.goldMultiplier],
      ] as const) {
        expect(Number.isFinite(value), `${ship.id}.${field}`).toBe(true);
        expect(value, `${ship.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  test('optional signature bonuses are sane when present', () => {
    for (const ship of SHIP_CHARACTERS) {
      const checks: [string, number | undefined, (value: number) => boolean][] = [
        // A boss multiplier below 1 would be a boss *penalty* — the field is a bonus.
        ['bossDamageMultiplier', ship.bossDamageMultiplier, (v) => Number.isFinite(v) && v > 1],
        ['critChanceBonus', ship.critChanceBonus, (v) => v > 0 && v < 1],
        ['regenPerSecondBonus', ship.regenPerSecondBonus, (v) => Number.isFinite(v) && v > 0],
        ['armorBonus', ship.armorBonus, (v) => Number.isInteger(v) && v > 0],
        ['lifeStealBonus', ship.lifeStealBonus, (v) => v > 0 && v < 1],
        ['startingRerollBonus', ship.startingRerollBonus, (v) => Number.isInteger(v) && v > 0],
        ['startingSkipBonus', ship.startingSkipBonus, (v) => Number.isInteger(v) && v > 0],
      ];
      for (const [field, value, isValid] of checks) {
        if (value === undefined) continue;
        expect(isValid(value), `${ship.id}.${field} = ${value}`).toBe(true);
      }
    }
  });
});

describe('SHIP_CHARACTERS — unlock gates', () => {
  test('every gate uses the hidden: syntax the unlock filter actually parses', () => {
    for (const ship of SHIP_CHARACTERS) {
      if (!ship.unlockRequirement) continue;
      expect(
        HIDDEN_GATE_PATTERN.test(ship.unlockRequirement),
        `${ship.id} gate "${ship.unlockRequirement}"`
      ).toBe(true);
    }
  });

  test('every hidden: gate points at a real ship unlock condition for this ship', () => {
    for (const ship of SHIP_CHARACTERS) {
      const match = ship.unlockRequirement?.match(HIDDEN_GATE_PATTERN);
      if (!match) continue;
      const condition = HIDDEN_UNLOCKS.find((definition) => definition.id === match[1]);
      expect(condition, `${ship.id} gate condition "${match[1]}"`).toBeDefined();
      expect(condition!.target, `${ship.id} gate condition target`).toBe('ship');
      expect(condition!.unlockId, `${ship.id} gate condition unlockId`).toBe(ship.id);
    }
  });

  test('every ship-targeting hidden unlock gates a real ship (bidirectional)', () => {
    for (const condition of HIDDEN_UNLOCKS) {
      if (condition.target !== 'ship') continue;
      const ship = getShipById(condition.unlockId);
      expect(ship, `condition ${condition.id} → ship ${condition.unlockId}`).toBeDefined();
      expect(ship!.unlockRequirement).toBe(`hidden:${condition.id}`);
    }
  });

  test('at least one ship is ungated (daily challenge picks from ungated ships)', () => {
    // DailyChallengeManager filters !unlockRequirement — an all-gated roster
    // would leave the daily seed with an empty pool.
    expect(SHIP_CHARACTERS.some((ship) => !ship.unlockRequirement)).toBe(true);
  });
});

describe('ship helpers', () => {
  test('getShipById round-trips every defined ship', () => {
    for (const ship of SHIP_CHARACTERS) {
      expect(getShipById(ship.id)).toBe(ship);
    }
  });

  test('getShipById returns undefined for an unknown id', () => {
    expect(getShipById('ship_does_not_exist')).toBeUndefined();
  });

  test('the default ship is the first entry, id ship_default, ungated, and neutral', () => {
    // WeaponSelectScene and DailyChallengeManager hardcode 'ship_default' as
    // the fallback — the id is load-bearing.
    const defaultShip = getDefaultShip();
    expect(defaultShip).toBe(SHIP_CHARACTERS[0]);
    expect(defaultShip.id).toBe('ship_default');
    expect(defaultShip.unlockRequirement).toBeUndefined();
    expect(defaultShip.healthMultiplier).toBe(1.0);
    expect(defaultShip.moveSpeedMultiplier).toBe(1.0);
    expect(defaultShip.damageMultiplier).toBe(1.0);
    expect(defaultShip.cooldownMultiplier).toBe(1.0);
    expect(defaultShip.xpMultiplier).toBe(1.0);
    expect(defaultShip.goldMultiplier).toBe(1.0);
  });
});
