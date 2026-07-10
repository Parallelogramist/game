import { describe, test, expect, vi } from 'vitest';

// WeaponEvolutions itself is pure (no Phaser), but the data-integrity cases
// cross-check each recipe's requiredStatId against the real run upgrade list
// from Upgrades.ts, which imports WeaponManager from '../weapons' (Phaser-coupled)
// purely for a type. Stub that module boundary so createUpgrades() loads in the
// Node test env — the documented pattern (vitest.config.ts) for exercising
// Phaser-coupled code by mocking its boundary.
vi.mock('../weapons', () => ({ WeaponManager: class {} }));

import {
  checkEvolutionReady,
  getEvolutionForWeapon,
  weaponEvolutionDefinitions,
} from './WeaponEvolutions';
import { createUpgrades } from './Upgrades';

// The canonical weapon roster — mirrors WeaponRegistry in src/weapons/index.ts.
// Kept here as an explicit checkpoint: adding a weapon to the registry (or an
// evolution recipe) should fail the "one evolution per weapon" test until the
// other side is added too, so no weapon ships silently un-evolvable.
const REGISTRY_WEAPON_IDS = [
  'projectile', 'katana', 'orbiting_blades', 'aura', 'chain_lightning',
  'homing_missile', 'frost_nova', 'laser_beam', 'meteor', 'flamethrower',
  'ricochet', 'ground_spike', 'drone', 'shuriken', 'boomerang', 'sentry',
  'singularity',
];

/** Build the stat-upgrade list checkEvolutionReady expects from a single entry. */
function statAt(id: string, currentLevel: number): { id: string; currentLevel: number }[] {
  return [{ id, currentLevel }];
}

describe('getEvolutionForWeapon', () => {
  test('returns the recipe for a known weapon', () => {
    const evolution = getEvolutionForWeapon('projectile');
    expect(evolution?.evolvedName).toBe('Bullet Storm');
    expect(evolution?.requiredStatId).toBe('multishot');
    expect(evolution?.requiredWeaponLevel).toBe(5);
  });

  test('returns undefined for an unknown weapon id', () => {
    expect(getEvolutionForWeapon('not_a_weapon')).toBeUndefined();
  });
});

describe('checkEvolutionReady — gating', () => {
  const readyStats = statAt('multishot', 5);

  test('returns the evolution when weapon level and stat level both meet requirements', () => {
    const evolution = checkEvolutionReady('projectile', 5, readyStats);
    expect(evolution?.evolvedName).toBe('Bullet Storm');
  });

  test('returns the evolution when both requirements are exceeded', () => {
    expect(checkEvolutionReady('projectile', 8, statAt('multishot', 9))).not.toBeNull();
  });

  test('returns null for an unknown weapon', () => {
    expect(checkEvolutionReady('not_a_weapon', 99, statAt('multishot', 9))).toBeNull();
  });

  test('returns null when the weapon level is below the requirement', () => {
    expect(checkEvolutionReady('projectile', 4, readyStats)).toBeNull();
  });

  test('returns null when the required stat upgrade is absent', () => {
    expect(checkEvolutionReady('projectile', 5, statAt('vitality', 9))).toBeNull();
  });

  test('returns null when the required stat is present but below its required level', () => {
    expect(checkEvolutionReady('projectile', 5, statAt('multishot', 4))).toBeNull();
  });

  test('returns null when there are no stat upgrades at all', () => {
    expect(checkEvolutionReady('projectile', 5, [])).toBeNull();
  });

  test('matches the required stat by id among several unrelated upgrades', () => {
    const stats = [
      { id: 'might', currentLevel: 9 },
      { id: 'multishot', currentLevel: 5 },
      { id: 'haste', currentLevel: 7 },
    ];
    expect(checkEvolutionReady('projectile', 5, stats)).not.toBeNull();
  });
});

describe('checkEvolutionReady — evolutionLevelReduction', () => {
  test('reduction lowers the effective weapon-level gate', () => {
    // weapon level 4 < required 5, but a reduction of 1 makes the effective req 4
    expect(checkEvolutionReady('projectile', 4, statAt('multishot', 5), 1)).not.toBeNull();
  });

  test('reduction does not lower the stat-level gate', () => {
    // weapon gate satisfied via the reduction, but the stat is still one short
    expect(checkEvolutionReady('projectile', 5, statAt('multishot', 4), 4)).toBeNull();
  });

  test('effective weapon-level requirement floors at 1', () => {
    // a huge reduction cannot drop the gate below 1: a level-1 weapon passes the
    // weapon gate, but a level-0 weapon does not
    expect(checkEvolutionReady('projectile', 1, statAt('multishot', 5), 99)).not.toBeNull();
    expect(checkEvolutionReady('projectile', 0, statAt('multishot', 5), 99)).toBeNull();
  });

  test('a reduction of zero behaves as the default (no reduction)', () => {
    expect(checkEvolutionReady('projectile', 4, statAt('multishot', 5), 0)).toBeNull();
    expect(checkEvolutionReady('projectile', 5, statAt('multishot', 5))).not.toBeNull();
  });
});

describe('weaponEvolutionDefinitions — data integrity (every recipe is achievable)', () => {
  test('defines exactly one evolution per registry weapon — no missing, no orphan', () => {
    const evolvedWeaponIds = weaponEvolutionDefinitions.map((evolution) => evolution.weaponId).sort();
    expect(evolvedWeaponIds).toEqual([...REGISTRY_WEAPON_IDS].sort());
  });

  test('every weaponId is unique', () => {
    const weaponIds = weaponEvolutionDefinitions.map((evolution) => evolution.weaponId);
    expect(new Set(weaponIds).size).toBe(weaponIds.length);
  });

  test('every requiredStatId resolves to a real run upgrade reachable to its required level', () => {
    const upgradeMaxLevels = new Map(createUpgrades().map((upgrade) => [upgrade.id, upgrade.maxLevel]));
    for (const evolution of weaponEvolutionDefinitions) {
      const statMaxLevel = upgradeMaxLevels.get(evolution.requiredStatId);
      expect(
        statMaxLevel,
        `evolution "${evolution.evolvedName}" requires unknown stat "${evolution.requiredStatId}"`
      ).toBeDefined();
      expect(evolution.requiredStatLevel).toBeGreaterThanOrEqual(1);
      expect(
        evolution.requiredStatLevel,
        `evolution "${evolution.evolvedName}" needs stat level ${evolution.requiredStatLevel} but "${evolution.requiredStatId}" maxes at ${statMaxLevel}`
      ).toBeLessThanOrEqual(statMaxLevel!);
    }
  });

  test('every requiredWeaponLevel is at least 1', () => {
    for (const evolution of weaponEvolutionDefinitions) {
      expect(evolution.requiredWeaponLevel).toBeGreaterThanOrEqual(1);
    }
  });

  test('every recipe has a non-empty name and description', () => {
    for (const evolution of weaponEvolutionDefinitions) {
      expect(evolution.evolvedName.length).toBeGreaterThan(0);
      expect(evolution.evolvedDescription.length).toBeGreaterThan(0);
    }
  });

  test('every recipe has at least one stat multiplier and all multipliers are finite and positive', () => {
    for (const evolution of weaponEvolutionDefinitions) {
      const multipliers = Object.values(evolution.statMultipliers);
      expect(multipliers.length).toBeGreaterThan(0);
      for (const multiplier of multipliers) {
        expect(Number.isFinite(multiplier)).toBe(true);
        expect(multiplier).toBeGreaterThan(0);
      }
    }
  });
});
