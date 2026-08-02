import weaponRegistrySource from '../../weapons/index.ts?raw';
import { describe, test, expect, vi } from 'vitest';

// Upgrades.ts imports WeaponManager from '../weapons' (Phaser-coupled) purely for a type and
// reads codex discovery state; stub both module boundaries so it loads in the Node test env.
vi.mock('../../weapons', () => ({ WeaponManager: class {} }));
vi.mock('../../codex', () => ({
  getCodexManager: () => ({ getWeaponEntry: () => undefined }),
}));

import { createUpgrades, type CombinedUpgrade, type Upgrade } from '../../data/Upgrades';
import {
  calculateBaseScore,
  calculateGatePlanningBonus,
  calculateWeaponSynergyBonus,
  FAMILY_SYNERGY_STATS,
  WEAPON_SYNERGY_FAMILY,
  type AutoBuyContext,
} from './autoBuyScoring';

function contextFor(pool: Upgrade[], overrides: Partial<AutoBuyContext> = {}): AutoBuyContext {
  return {
    playerLevel: 4,
    autoUpgradeLevel: 4,
    isHealthStruggling: false,
    canAddWeapon: true,
    ownedWeaponIds: [],
    upgrades: pool,
    ...overrides,
  };
}

function statCard(pool: Upgrade[], id: string): CombinedUpgrade {
  const upgrade = pool.find(u => u.id === id);
  if (!upgrade) throw new Error(`no stat upgrade "${id}" in the pool`);
  return { ...upgrade, upgradeType: 'stat' };
}

function weaponLevelCard(currentLevel: number): CombinedUpgrade {
  return {
    id: 'katana',
    type: 'level',
    weaponId: 'katana',
    name: 'Katana',
    description: '',
    icon: 'katana',
    currentLevel,
    maxLevel: 10,
    getDescription: () => '',
    upgradeType: 'weapon',
  };
}

const registryBlockStart = weaponRegistrySource.indexOf('const WeaponRegistry');
const registryBlock = weaponRegistrySource.slice(
  registryBlockStart,
  weaponRegistrySource.indexOf('};', registryBlockStart)
);
const registeredWeaponIds = [...registryBlock.matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);

describe('auto-buy scoring', () => {
  test('a Limit Break overflow stat never outscores a weapon level-up', () => {
    const pool = createUpgrades();
    const overflow = pool.find(u => u.isOverflow);
    expect(overflow).toBeDefined();

    const context = contextFor(pool);
    const overflowScore = calculateBaseScore(
      { ...overflow!, upgradeType: 'stat' },
      context
    );
    expect(overflowScore).toBe(35);

    for (let weaponLevel = 1; weaponLevel <= 10; weaponLevel++) {
      expect(calculateBaseScore(weaponLevelCard(weaponLevel), context)).toBeGreaterThan(
        overflowScore
      );
    }
  });

  test('gate planning holds back a stat at the gate and pushes the ones below it', () => {
    const pool = createUpgrades();
    pool.find(u => u.id === 'might')!.currentLevel = 2;
    pool.find(u => u.id === 'haste')!.currentLevel = 1;
    pool.find(u => u.id === 'swiftness')!.currentLevel = 1;
    const context = contextFor(pool);

    expect(calculateGatePlanningBonus(statCard(pool, 'might'), context)).toBe(-10);
    expect(calculateGatePlanningBonus(statCard(pool, 'haste'), context)).toBe(15);
  });

  test('every weapon in WeaponRegistry declares a tier-4 synergy family', () => {
    expect(registeredWeaponIds.length).toBeGreaterThan(25);

    const unclassified = registeredWeaponIds.filter(id => !(id in WEAPON_SYNERGY_FAMILY));
    expect(unclassified, 'these earn no tier-4 auto-upgrade synergy at all').toEqual([]);

    const stale = Object.keys(WEAPON_SYNERGY_FAMILY).filter(
      id => !registeredWeaponIds.includes(id)
    );
    expect(stale, 'these are not weapons any more').toEqual([]);
  });

  test('every stat a synergy family names is a real stat upgrade', () => {
    const statIds = new Set(
      createUpgrades()
        .filter(u => u.isStatUpgrade)
        .map(u => u.id)
    );
    const unknown = Object.values(FAMILY_SYNERGY_STATS)
      .flat()
      .filter(id => !statIds.has(id));
    expect(unknown, 'these stat ids no longer exist, so their bonus is dead').toEqual([]);
  });

  test('a loadout of weapons added after the original three lists still gets synergy', () => {
    const pool = createUpgrades();
    const context = contextFor(pool, { ownedWeaponIds: ['storm', 'flail', 'sentry'] });

    expect(calculateWeaponSynergyBonus(statCard(pool, 'might'), context)).toBe(30);
  });
});
