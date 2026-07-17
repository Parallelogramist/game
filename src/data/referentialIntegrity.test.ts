import { describe, test, expect, vi } from 'vitest';

// Upgrades.ts imports WeaponManager from '../weapons' (Phaser-coupled) purely
// for a type, and reads codex discovery state for new-weapon offer weighting.
// Stub both module boundaries so the catalogs load in the Node test env — the
// documented pattern (vitest.config.ts) for exercising Phaser-coupled code.
vi.mock('../weapons', () => ({ WeaponManager: class {} }));
vi.mock('../codex', () => ({
  getCodexManager: () => ({ getWeaponEntry: () => undefined }),
}));

import { ICON_MAP, isValidFrameName } from '../utils/IconMap';
import { RELICS } from './Relics';
import { SHIP_MOD_TRACKS } from './ShipMods';
import { ALL_BOOST_CARDS } from './BoostCards';
import { ALL_CARDS } from './Cards';
import { PERMANENT_UPGRADES, UPGRADE_CATEGORIES } from './PermanentUpgrades';
import { createUpgrades, UNLOCKABLE_WEAPONS } from './Upgrades';
import { createLimitBreakUpgrades } from './LimitBreakUpgrades';
import { ACHIEVEMENTS, BOSS_KILL_TRACKING } from '../achievements/AchievementDefinitions';
import { MILESTONES } from '../achievements/MilestoneDefinitions';
import { ENEMY_TYPES } from '../enemies/EnemyTypes';

/**
 * Referential-integrity sweep: every cross-reference key in the data catalogs
 * must resolve. Dangling references don't fail at build time — they fall back
 * (or crash) at the moment a player happens to touch the item. The Thorned
 * Mail relic shipped pointing at icon key 'thorn' (map has 'thorns') and only
 * surfaced in a field crash report's warning log; this sweep makes that class
 * of drift a red build instead.
 */

type IconRef = { source: string; id: string; icon: string };

function collectIconRefs(): IconRef[] {
  const refs: IconRef[] = [];
  const push = (source: string, items: readonly { id: string; icon: string }[]) => {
    for (const item of items) refs.push({ source, id: item.id, icon: item.icon });
  };

  push('Relics', RELICS);
  push('BoostCards', ALL_BOOST_CARDS);
  push('Cards', ALL_CARDS);
  push('PermanentUpgrades', PERMANENT_UPGRADES);
  push('UpgradeCategories', UPGRADE_CATEGORIES);
  push('Upgrades', createUpgrades());
  push('LimitBreakUpgrades', createLimitBreakUpgrades());
  push('UnlockableWeapons', UNLOCKABLE_WEAPONS);
  push('Achievements', ACHIEVEMENTS);
  push('Milestones', MILESTONES);

  for (const [shipId, tracks] of Object.entries(SHIP_MOD_TRACKS)) {
    push(`ShipMods:${shipId}`, tracks);
  }

  return refs;
}

describe('data catalog referential integrity', () => {
  test('every icon key in every catalog resolves without fallback', () => {
    const refs = collectIconRefs();
    // Sanity: the sweep actually covers the catalogs — a refactor that empties
    // this list must fail loudly, not silently pass.
    expect(refs.length).toBeGreaterThan(100);

    const dangling = refs.filter(
      ({ icon }) => !(icon in ICON_MAP) && !isValidFrameName(icon),
    );

    expect(
      dangling,
      `Dangling icon keys (add to ICON_MAP or fix the reference): ${dangling
        .map((r) => `${r.source}/${r.id} → "${r.icon}"`)
        .join(', ')}`,
    ).toEqual([]);
  });

  test('every ship mod track id is unique within its ship', () => {
    for (const [shipId, tracks] of Object.entries(SHIP_MOD_TRACKS)) {
      const ids = tracks.map((t) => t.id);
      expect(new Set(ids).size, `duplicate track ids on ${shipId}`).toBe(ids.length);
    }
  });

  test('every boss-kill tracking key is a real enemy type with exactly one achievement', () => {
    for (const [enemyTypeId, trackingType] of Object.entries(BOSS_KILL_TRACKING)) {
      expect(ENEMY_TYPES[enemyTypeId], `unknown enemy type id "${enemyTypeId}"`).toBeDefined();
      const matches = ACHIEVEMENTS.filter((a) => a.trackingType === trackingType);
      expect(matches.map((a) => a.id), `"${trackingType}" must map to exactly 1 achievement`).toHaveLength(1);
    }
  });

  test('achievement ids are unique and every nextTierId resolves', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size, 'duplicate achievement ids').toBe(ids.length);

    const dangling = ACHIEVEMENTS.filter((a) => a.nextTierId && !ids.includes(a.nextTierId));
    expect(
      dangling.map((a) => `${a.id} → "${a.nextTierId}"`),
      'nextTierId points at no achievement',
    ).toEqual([]);
  });
});
