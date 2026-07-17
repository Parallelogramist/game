import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so state round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one. The raw map lets tests
// inject corrupt/tampered payloads straight into the load path.
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import { MetaProgressionManager } from './MetaProgressionManager';
import { PERMANENT_UPGRADES } from '../data/PermanentUpgrades';

const KEY_UPGRADES = 'survivor-meta-upgrades';
const KEY_STREAK = 'survivor-meta-streak';
const KEY_ACH = 'survivor-meta-achievement-bonuses';
const KEY_LAST_RUN = 'survivor-meta-last-run-upgrades';

const ALL_KEYS = [
  'survivor-meta-gold',
  KEY_UPGRADES,
  'survivor-meta-world-level',
  KEY_STREAK,
  'survivor-meta-runs-completed',
  KEY_ACH,
  KEY_LAST_RUN,
];

const MAX_STREAK = 10; // MAX_STREAK_BONUS
const damageMax = PERMANENT_UPGRADES.find((u) => u.id === 'damageLevel')!.maxLevel;

/**
 * Seed a RAW string under one key, then construct a fresh manager so it loads
 * that payload through its constructor. Raw (not JSON.stringify) because the
 * interesting tamper vectors are exactly the values JSON.stringify mangles:
 * it turns NaN/Infinity into `null`, so a literal `1e999` (which JSON.parse reads
 * back as Infinity) or a non-numeric field must be injected by hand.
 */
function loadFrom(key: string, raw: string): MetaProgressionManager {
  SecureStorage.setItem(key, raw);
  return new MetaProgressionManager();
}

describe('MetaProgressionManager — corrupt/tampered storage resilience', () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) SecureStorage.removeItem(key);
  });

  // SecureStorage is the anti-cheat layer, so a corrupt/tampered payload is the
  // threat model. The un-hardened loaders used `Math.max(0, Math.min(value, cap))`,
  // which leaks NaN: `Math.min("abc", cap)` is NaN and `Math.max(0, NaN)` stays NaN
  // (same bug class as BUG-ASCENSION-CORRUPT / BUG-COMBO-RESTORE-CORRUPT). A NaN
  // streak poisons the run-gold streak multiplier; a NaN upgrade level poisons the
  // account level and every getStartingXXX() → NaN PlayerStats; a NaN achievement
  // bonus poisons the run-start stat application.

  // ── Streak state ──
  describe('loadStreakState', () => {
    test('non-numeric string fields coerce to 0 — gold multiplier stays finite (=1)', () => {
      const m = loadFrom(KEY_STREAK, '{"currentStreak":"abc","bestStreak":"xyz"}');
      expect(m.getCurrentStreak()).toBe(0);
      expect(m.getBestStreak()).toBe(0);
      expect(Number.isFinite(m.getStreakGoldMultiplier())).toBe(true);
      expect(m.getStreakGoldMultiplier()).toBe(1);
      expect(Number.isFinite(m.getStreakBonusPercent())).toBe(true);
    });

    test('object / array field values coerce to 0', () => {
      const m = loadFrom(KEY_STREAK, '{"currentStreak":{},"bestStreak":[]}');
      expect(m.getCurrentStreak()).toBe(0);
      expect(m.getBestStreak()).toBe(0);
    });

    test('an Infinity streak (1e999 overflow) is rejected to 0, not granted as max', () => {
      const m = loadFrom(KEY_STREAK, '{"currentStreak":1e999,"bestStreak":1e999}');
      expect(m.getCurrentStreak()).toBe(0);
      expect(m.getBestStreak()).toBe(0);
    });

    test('a negative streak clamps to 0', () => {
      const m = loadFrom(KEY_STREAK, '{"currentStreak":-5,"bestStreak":-3}');
      expect(m.getCurrentStreak()).toBe(0);
      expect(m.getBestStreak()).toBe(0);
    });

    test('an over-cap streak clamps to MAX_STREAK_BONUS', () => {
      const m = loadFrom(KEY_STREAK, '{"currentStreak":999,"bestStreak":999}');
      expect(m.getCurrentStreak()).toBe(MAX_STREAK);
      expect(m.getBestStreak()).toBe(MAX_STREAK);
      expect(m.getStreakGoldMultiplier()).toBeCloseTo(1.5, 10); // +5%/level capped at +50%
    });

    test('a fractional streak is floored', () => {
      const m = loadFrom(KEY_STREAK, '{"currentStreak":3.9,"bestStreak":7.1}');
      expect(m.getCurrentStreak()).toBe(3);
      expect(m.getBestStreak()).toBe(7);
    });

    test('non-object payloads fall back to defaults without throwing', () => {
      for (const raw of ['42', '"hello"', 'null', '[1,2,3]', 'not-json']) {
        const m = loadFrom(KEY_STREAK, raw);
        expect(m.getCurrentStreak()).toBe(0);
        expect(m.getBestStreak()).toBe(0);
      }
    });
  });

  // ── Upgrade state ──
  describe('loadUpgradeState', () => {
    test('a non-numeric string level coerces to 0 — account level + start stats stay finite', () => {
      const m = loadFrom(KEY_UPGRADES, '{"damageLevel":"abc","projectileCountLevel":"xyz"}');
      expect(m.getUpgradeLevel('damageLevel')).toBe(0);
      expect(m.getStartingProjectileCount()).toBe(0);
      expect(Number.isFinite(m.getAccountLevel())).toBe(true);
      expect(m.getAccountLevel()).toBe(0);
      expect(Number.isFinite(m.getStartingDamageMultiplier())).toBe(true);
      expect(m.getStartingDamageMultiplier()).toBe(1);
    });

    test('object / array level values coerce to 0', () => {
      const m = loadFrom(KEY_UPGRADES, '{"damageLevel":{},"piercingLevel":[1]}');
      expect(m.getUpgradeLevel('damageLevel')).toBe(0);
      expect(m.getUpgradeLevel('piercingLevel')).toBe(0);
      expect(Number.isFinite(m.getAccountLevel())).toBe(true);
    });

    test('an Infinity level (1e999 overflow) is rejected to 0, not granted as max', () => {
      const m = loadFrom(KEY_UPGRADES, '{"damageLevel":1e999}');
      expect(m.getUpgradeLevel('damageLevel')).toBe(0);
    });

    test('a negative level clamps to 0', () => {
      const m = loadFrom(KEY_UPGRADES, '{"damageLevel":-7}');
      expect(m.getUpgradeLevel('damageLevel')).toBe(0);
    });

    test('an over-max level clamps to the upgrade maxLevel', () => {
      const m = loadFrom(KEY_UPGRADES, `{"damageLevel":${damageMax + 500}}`);
      expect(m.getUpgradeLevel('damageLevel')).toBe(damageMax);
    });

    test('a fractional level is floored', () => {
      const m = loadFrom(KEY_UPGRADES, '{"damageLevel":3.9}');
      expect(m.getUpgradeLevel('damageLevel')).toBe(3);
    });

    test('junk / unknown keys do NOT inflate the account level (only known ids are summed)', () => {
      // calculateAccountLevel sums Object.values(upgradeState); a tampered payload
      // with huge unknown keys would otherwise spuriously unlock everything.
      const m = loadFrom(
        KEY_UPGRADES,
        '{"damageLevel":2,"__hack":999999,"99":888888,"notAnUpgrade":777}',
      );
      expect(m.getUpgradeLevel('damageLevel')).toBe(2);
      expect(m.getAccountLevel()).toBe(2); // only the one valid known id counts
    });

    test('an array payload does not inject indexed junk levels', () => {
      const m = loadFrom(KEY_UPGRADES, '[5,5,5,5,5]');
      expect(m.getAccountLevel()).toBe(0);
      expect(Number.isFinite(m.getAccountLevel())).toBe(true);
    });

    test('non-object payloads fall back to all-default (zero) levels without throwing', () => {
      for (const raw of ['42', '"hello"', 'null', 'not-json']) {
        const m = loadFrom(KEY_UPGRADES, raw);
        expect(m.getAccountLevel()).toBe(0);
        expect(m.getUpgradeLevel('damageLevel')).toBe(0);
      }
    });
  });

  // ── Achievement bonuses ──
  describe('loadAchievementBonuses', () => {
    test('a non-numeric string bonus coerces to its default (0) — bonuses stay finite', () => {
      const m = loadFrom(KEY_ACH, '{"damage":"abc","health":"xyz","allStats":{}}');
      const bonuses = m.getAchievementBonuses();
      expect(bonuses.damage).toBe(0);
      expect(bonuses.health).toBe(0);
      expect(bonuses.allStats).toBe(0);
      for (const value of Object.values(bonuses)) expect(Number.isFinite(value)).toBe(true);
    });

    test('an Infinity bonus is rejected to 0, not granted as the percent cap', () => {
      const m = loadFrom(KEY_ACH, '{"damage":1e999}');
      expect(m.getAchievementBonuses().damage).toBe(0);
    });

    test('a negative bonus clamps to 0; an over-cap bonus clamps to 100', () => {
      const m = loadFrom(KEY_ACH, '{"damage":-50,"health":999}');
      const bonuses = m.getAchievementBonuses();
      expect(bonuses.damage).toBe(0);
      expect(bonuses.health).toBe(100);
    });

    test('startingLevel clamps to its own cap of 10', () => {
      const m = loadFrom(KEY_ACH, '{"startingLevel":99}');
      expect(m.getAchievementBonuses().startingLevel).toBe(10);
    });

    test('non-object payloads fall back to all-zero defaults without throwing', () => {
      for (const raw of ['42', '"hello"', 'null', '[1,2]', 'not-json']) {
        const m = loadFrom(KEY_ACH, raw);
        const bonuses = m.getAchievementBonuses();
        for (const value of Object.values(bonuses)) expect(value).toBe(0);
      }
    });

    test('a fractional percent bonus is preserved (not floored)', () => {
      // Percent bonuses are summed from rewards and may legitimately be fractional;
      // the loader must not change their value on the real path.
      const m = loadFrom(KEY_ACH, '{"damage":7.5}');
      expect(m.getAchievementBonuses().damage).toBe(7.5);
    });
  });

  // ── Characterization: valid saves still load unchanged (byte-identical path) ──
  describe('valid state round-trips unchanged', () => {
    test('a valid streak loads with the correct gold multiplier', () => {
      const m = loadFrom(KEY_STREAK, '{"currentStreak":5,"bestStreak":8}');
      expect(m.getCurrentStreak()).toBe(5);
      expect(m.getBestStreak()).toBe(8);
      expect(m.getStreakGoldMultiplier()).toBeCloseTo(1.25, 10); // 5 × 5%
    });

    test('valid upgrade levels load and sum into the account level', () => {
      const m = loadFrom(KEY_UPGRADES, '{"damageLevel":3,"piercingLevel":2}');
      expect(m.getUpgradeLevel('damageLevel')).toBe(3);
      expect(m.getUpgradeLevel('piercingLevel')).toBe(2);
      expect(m.getAccountLevel()).toBe(5);
    });

    test('a save missing a newer upgrade id defaults that id to 0 (forward-compat merge)', () => {
      const m = loadFrom(KEY_UPGRADES, '{"damageLevel":4}');
      expect(m.getUpgradeLevel('damageLevel')).toBe(4);
      // Every other known upgrade still resolves to its 0 default.
      for (const upgrade of PERMANENT_UPGRADES) {
        if (upgrade.id === 'damageLevel') continue;
        expect(m.getUpgradeLevel(upgrade.id)).toBe(0);
      }
    });

    test('valid achievement bonuses load unchanged', () => {
      const m = loadFrom(KEY_ACH, '{"damage":15,"gold":25,"startingLevel":3}');
      const bonuses = m.getAchievementBonuses();
      expect(bonuses.damage).toBe(15);
      expect(bonuses.gold).toBe(25);
      expect(bonuses.startingLevel).toBe(3);
    });
  });
});

// Memory (`upgradeKeepLevel`) replays upgrade.apply() once per banked level, so a
// tampered level is both a stat cheat and a hot loop — the loader is the first bound
// (the run-start block's Math.min against maxLevel is the second).
describe('MetaProgressionManager — last-run upgrade record', () => {
  beforeEach(() => {
    SecureStorage.removeItem(KEY_LAST_RUN);
  });

  test('round-trips a banked build through storage', () => {
    new MetaProgressionManager().recordRunUpgrades([
      { id: 'might', level: 3 },
      { id: 'haste', level: 1 },
    ]);

    expect(new MetaProgressionManager().getLastRunUpgrades()).toEqual([
      { id: 'might', level: 3 },
      { id: 'haste', level: 1 },
    ]);
  });

  test('empty until a run banks one', () => {
    expect(new MetaProgressionManager().getLastRunUpgrades()).toEqual([]);
  });

  test('a non-array payload loads as empty', () => {
    expect(loadFrom(KEY_LAST_RUN, '{"might":3}').getLastRunUpgrades()).toEqual([]);
    expect(loadFrom(KEY_LAST_RUN, 'not json at all').getLastRunUpgrades()).toEqual([]);
  });

  test('drops junk entries — an infinite level rejects to 0 like every other loader here', () => {
    const tampered = loadFrom(
      KEY_LAST_RUN,
      '[{"id":"might","level":1e999},{"id":"haste","level":"9"},{"level":4},' +
        '{"id":"","level":2},{"id":"vitality","level":0},{"id":"reach","level":2}]',
    ).getLastRunUpgrades();

    // 1e999 parses back as Infinity; boundedStoredNumber rejects non-finite values
    // to the fallback (0), same as the streak/upgrade/achievement loaders above —
    // so 'might' drops rather than clamping to MAX_RECORDED_UPGRADE_LEVEL.
    expect(tampered).toEqual([
      { id: 'reach', level: 2 },
    ]);
  });
});
