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
});
