import { describe, test, expect } from 'vitest';
import { createUpgrades } from './Upgrades';
import { recordRunBuild, selectKeptUpgrades, type RecordedUpgrade } from './KeptUpgrades';

/** A run's upgrade array with the given ids levelled, everything else untouched. */
function buildWithLevels(levels: Record<string, number>) {
  const upgrades = createUpgrades();
  for (const [id, level] of Object.entries(levels)) {
    const upgrade = upgrades.find((candidate) => candidate.id === id);
    if (!upgrade) throw new Error(`no such upgrade: ${id}`);
    upgrade.currentLevel = level;
  }
  return upgrades;
}

describe('recordRunBuild', () => {
  test('banks only owned upgrades, with their levels', () => {
    const banked = recordRunBuild(buildWithLevels({ might: 4, haste: 1 }));
    expect(banked).toEqual([
      { id: 'might', level: 4 },
      { id: 'haste', level: 1 },
    ]);
  });

  // Memory keeps the LOWEST upgrades and overflow entries sit at 1-3 beside a maxed
  // real build, so banking them would make every carryover overflow crumbs for
  // exactly the late-game profiles that can afford Memory.
  test('never banks Limit Break overflow upgrades', () => {
    const upgrades = createUpgrades();
    for (const upgrade of upgrades) upgrade.currentLevel = 1;
    const bankedIds = recordRunBuild(upgrades).map((entry) => entry.id);

    expect(bankedIds.length).toBeGreaterThan(0);
    expect(bankedIds.some((id) => id.startsWith('overflow_'))).toBe(false);
  });

  // isStatUpgrade means "subject to break gates", not "is keepable" — it is false for
  // shieldBarrier, so filtering on it would silently drop a real upgrade.
  test('banks shieldBarrier despite isStatUpgrade being false', () => {
    const banked = recordRunBuild(buildWithLevels({ shieldBarrier: 2 }));
    expect(banked).toEqual([{ id: 'shieldBarrier', level: 2 }]);
  });
});

describe('selectKeptUpgrades', () => {
  const banked: RecordedUpgrade[] = [
    { id: 'might', level: 10 },
    { id: 'haste', level: 2 },
    { id: 'vitality', level: 5 },
    { id: 'swiftness', level: 1 },
  ];

  test('keeps the lowest levels, lowest first', () => {
    expect(selectKeptUpgrades(banked, 2)).toEqual([
      { id: 'swiftness', level: 1 },
      { id: 'haste', level: 2 },
    ]);
  });

  // A profile that never bought Memory must behave exactly as before.
  test('keeps nothing at level 0', () => {
    expect(selectKeptUpgrades(banked, 0)).toEqual([]);
  });

  test('does not mutate the banked build', () => {
    const original = [...banked];
    selectKeptUpgrades(banked, 2);
    expect(banked).toEqual(original);
  });
});
