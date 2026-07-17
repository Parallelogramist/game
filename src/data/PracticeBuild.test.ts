import { describe, test, expect, vi } from 'vitest';

vi.mock('../weapons', () => ({ WeaponManager: class {} }));
vi.mock('../codex', () => ({
  getCodexManager: () => ({ getWeaponEntry: () => undefined }),
}));

import { createUpgrades, BREAK_LEVEL_GATES } from './Upgrades';
import { PRACTICE_BUILD_LADDER, practiceBuildPlayerLevel } from './PracticeBuild';

describe('practice build ladder', () => {
  test('every rung is a level a real run could reach on every stat upgrade', () => {
    const statUpgrades = createUpgrades().filter((upgrade) => upgrade.isStatUpgrade);
    expect(statUpgrades.length).toBeGreaterThan(0);
    for (const rung of PRACTICE_BUILD_LADDER) {
      for (const upgrade of statUpgrades) {
        // A flat depth is gate-legal only while no stat caps out below it.
        expect(rung.depth).toBeLessThanOrEqual(upgrade.maxLevel);
      }
    }
  });

  test('the 10-MIN rung lands on a break gate and on a realistic player level', () => {
    const statCount = createUpgrades().filter((upgrade) => upgrade.isStatUpgrade).length;
    const tenMinute = PRACTICE_BUILD_LADDER.find((rung) => rung.label === '10-MIN');
    expect(tenMinute).toBeDefined();
    expect(BREAK_LEVEL_GATES).toContain(tenMinute!.depth);
    // 9 stats x 3 picks + 1 = 28, just under the game's own level_30_run rung.
    expect(practiceBuildPlayerLevel(tenMinute!.depth, statCount)).toBe(28);
  });
});
