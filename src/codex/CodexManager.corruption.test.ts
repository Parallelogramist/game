import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so state round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one. The raw map is exposed
// so tests can inject corrupt/tampered payloads and inspect persistence.
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

// Mock the Phaser-coupled weapon barrel + the enemy table so the manager loads
// in a pure Node test with a small, controlled known-id set (the sanitizer
// rebuilds weapons/enemies from exactly these ids — see CodexManager.loadState).
vi.mock('../weapons', () => ({
  getAllWeaponIds: () => ['projectile', 'katana', 'aura'],
}));
vi.mock('../enemies/EnemyTypes', () => ({
  ENEMY_TYPES: { shambler: {}, dasher: {}, tank: {} },
}));

import { SecureStorage } from '../storage';
import { CodexManager } from './CodexManager';

const STORAGE_KEY = 'survivor-codex';
const KNOWN_WEAPONS = ['projectile', 'katana', 'aura'];
const KNOWN_ENEMIES = ['shambler', 'dasher', 'tank'];

/**
 * Seed the store with a RAW string, then construct a fresh manager so it loads
 * that payload. Raw (not JSON.stringify) because the interesting tamper vectors
 * are exactly the values JSON.stringify mangles: it turns NaN/Infinity into
 * `null`, so a literal `1e999` (which JSON.parse reads back as Infinity) or a
 * non-numeric field must be injected by hand to reach the load path.
 */
function loadFrom(raw: string): CodexManager {
  SecureStorage.setItem(STORAGE_KEY, raw);
  return new CodexManager();
}

describe('CodexManager — corruption / tamper resilience', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Characterization: the valid path must stay byte-identical.
  // ───────────────────────────────────────────────────────────────────────
  describe('valid round-trip (characterization)', () => {
    test('discovered weapon/enemy/upgrade + stats persist across reload', () => {
      const first = new CodexManager();
      first.discoverWeapon('katana', 'Katana');
      first.recordWeaponUsage('katana', 12.5, 3);
      first.discoverEnemy('tank', 'Tank');
      first.recordEnemyKill('tank');
      first.discoverUpgrade('swift_boots', 'Swift Boots');
      first.recordRunEnd(250.5, 40, 999.5, 100, true, 3, 17);

      const reloaded = new CodexManager();
      expect(reloaded.isWeaponDiscovered('katana')).toBe(true);
      const katana = reloaded.getWeaponEntry('katana');
      expect(katana?.totalDamageDealt).toBe(12.5); // fractional damage preserved
      expect(katana?.totalKills).toBe(3);
      expect(reloaded.isEnemyDiscovered('tank')).toBe(true);
      expect(reloaded.isUpgradeDiscovered('swift_boots')).toBe(true);

      const stats = reloaded.getStatistics();
      expect(stats.totalRunsPlayed).toBe(1);
      expect(stats.totalKills).toBe(40);
      expect(stats.totalDamageDealt).toBe(999.5); // fractional preserved
      expect(stats.totalVictories).toBe(1);
      expect(stats.fastestVictorySeconds).toBe(250.5); // finite fastest preserved
      expect(stats.highestWorldLevel).toBe(3);
      expect(stats.highestPlayerLevel).toBe(17);
    });

    test('completion percent reflects discovered fraction of weapons + enemies', () => {
      const m = new CodexManager();
      expect(m.getCompletionPercent()).toBe(0);
      // discover all weapons, no enemies → (3/3 + 0/3) / 2 = 50%
      for (const id of KNOWN_WEAPONS) m.discoverWeapon(id, id);
      expect(m.getCompletionPercent()).toBe(50);
      // + all enemies → 100%
      for (const id of KNOWN_ENEMIES) m.discoverEnemy(id, id);
      expect(m.getCompletionPercent()).toBe(100);
    });

    test('fresh manager (empty store) seeds all known ids with defaults', () => {
      const m = new CodexManager();
      expect(m.getTotalWeaponCount()).toBe(3);
      expect(m.getTotalEnemyCount()).toBe(3);
      expect(m.getDiscoveredWeaponCount()).toBe(0);
      expect(m.getStatistics().fastestVictorySeconds).toBe(Infinity);
      expect(m.getStatistics().highestWorldLevel).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Non-object payloads → clean defaults, never throw.
  // ───────────────────────────────────────────────────────────────────────
  describe('non-object / malformed payloads fall back to defaults', () => {
    test.each([
      ['null', 'null'],
      ['array', '[1,2,3]'],
      ['string', '"hello"'],
      ['number', '42'],
      ['bool', 'true'],
      ['not-json', 'not valid json {'],
    ])('payload=%s → defaults, no throw', (_label, raw) => {
      const m = loadFrom(raw);
      expect(m.getTotalWeaponCount()).toBe(3);
      expect(m.getTotalEnemyCount()).toBe(3);
      expect(m.getDiscoveredWeaponCount()).toBe(0);
      expect(m.getDiscoveredEnemyCount()).toBe(0);
      expect(m.getCompletionPercent()).toBe(0);
      expect(m.getStatistics().fastestVictorySeconds).toBe(Infinity);
      expect(m.getStatistics().highestWorldLevel).toBe(1);
    });

    test('sub-trees that are non-objects fall back to seeded defaults', () => {
      const m = loadFrom(
        JSON.stringify({
          version: 1,
          weapons: 'corrupt',
          enemies: 42,
          upgrades: [1, 2],
          statistics: null,
        })
      );
      expect(m.getTotalWeaponCount()).toBe(3);
      expect(m.getTotalEnemyCount()).toBe(3);
      expect(m.getDiscoveredWeaponCount()).toBe(0);
      expect(m.getAllUpgradeEntries()).toEqual([]);
      expect(m.getStatistics().highestPlayerLevel).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Junk weapon/enemy ids dropped — totals stay stable so completion % is sound.
  // ───────────────────────────────────────────────────────────────────────
  describe('rebuild-from-known-ids drops injected junk', () => {
    test('junk weapon/enemy keys are dropped; known entries kept', () => {
      const m = loadFrom(
        JSON.stringify({
          weapons: {
            katana: { id: 'katana', discovered: true, timesUsed: 2, totalDamageDealt: 5, totalKills: 1 },
            __hack: { id: '__hack', discovered: true, timesUsed: 99, totalDamageDealt: 1, totalKills: 1 },
          },
          enemies: {
            tank: { id: 'tank', discovered: true, timesKilled: 4, timesEncountered: 9 },
            __evil: { id: '__evil', discovered: true, timesKilled: 1, timesEncountered: 1 },
          },
        })
      );
      // Totals must equal the known-id counts (junk dropped), not inflated.
      expect(m.getTotalWeaponCount()).toBe(3);
      expect(m.getTotalEnemyCount()).toBe(3);
      expect(m.isWeaponDiscovered('katana')).toBe(true);
      expect(m.getWeaponEntry('__hack')).toBeUndefined();
      expect(m.isEnemyDiscovered('tank')).toBe(true);
      expect(m.getEnemyEntry('__evil')).toBeUndefined();
      // discovered count counts only real, truly-discovered entries.
      expect(m.getDiscoveredWeaponCount()).toBe(1);
      expect(m.getDiscoveredEnemyCount()).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Boolean coercion — a truthy non-boolean must not fake a discovery.
  // ───────────────────────────────────────────────────────────────────────
  describe('discovered flag is coerced to a strict boolean', () => {
    test('truthy non-boolean discovered does not fake an unlock', () => {
      const m = loadFrom(
        JSON.stringify({
          weapons: { katana: { id: 'katana', discovered: 'yes', timesUsed: 0, totalDamageDealt: 0, totalKills: 0 } },
          enemies: { tank: { id: 'tank', discovered: 1, timesKilled: 0, timesEncountered: 0 } },
        })
      );
      expect(m.isWeaponDiscovered('katana')).toBe(false);
      expect(m.isEnemyDiscovered('tank')).toBe(false);
      expect(m.getDiscoveredWeaponCount()).toBe(0);
      expect(m.getCompletionPercent()).toBe(0); // can't exceed real progress
    });

    test('real boolean true survives', () => {
      const m = loadFrom(
        JSON.stringify({
          weapons: { aura: { id: 'aura', discovered: true, timesUsed: 0, totalDamageDealt: 0, totalKills: 0 } },
        })
      );
      expect(m.isWeaponDiscovered('aura')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Numeric coercion on entries + statistics.
  // ───────────────────────────────────────────────────────────────────────
  describe('numeric fields are coerced', () => {
    test('non-numeric / infinite / negative entry stats fall back to 0', () => {
      const m = loadFrom(
        JSON.stringify({
          weapons: {
            katana: { id: 'katana', discovered: true, timesUsed: 'abc', totalDamageDealt: 1e999, totalKills: -5 },
          },
          enemies: {
            tank: { id: 'tank', discovered: true, timesKilled: {}, timesEncountered: -1 },
          },
        })
      );
      const w = m.getWeaponEntry('katana');
      expect(w?.timesUsed).toBe(0); // string → 0
      expect(w?.totalDamageDealt).toBe(0); // Infinity → 0
      expect(w?.totalKills).toBe(0); // negative → 0
      const e = m.getEnemyEntry('tank');
      expect(e?.timesKilled).toBe(0);
      expect(e?.timesEncountered).toBe(0);
    });

    test('fractional counters are floored, fractional damage preserved', () => {
      const m = loadFrom(
        JSON.stringify({
          weapons: {
            katana: { id: 'katana', discovered: true, timesUsed: 3.9, totalDamageDealt: 10.5, totalKills: 2.7 },
          },
        })
      );
      const w = m.getWeaponEntry('katana');
      expect(w?.timesUsed).toBe(3); // count floored
      expect(w?.totalKills).toBe(2); // count floored
      expect(w?.totalDamageDealt).toBe(10.5); // damage preserved
    });

    test('corrupt statistics fall back to per-field defaults', () => {
      const m = loadFrom(
        JSON.stringify({
          statistics: {
            totalRunsPlayed: 'lots',
            totalPlayTimeSeconds: -10,
            totalKills: 1e999,
            totalDamageDealt: {},
            totalGoldEarned: NaN, // serializes to null
            totalVictories: [5],
            fastestVictorySeconds: 'fast',
            highestWorldLevel: -3,
            highestPlayerLevel: 'x',
          },
        })
      );
      const s = m.getStatistics();
      expect(s.totalRunsPlayed).toBe(0);
      expect(s.totalPlayTimeSeconds).toBe(0);
      expect(s.totalKills).toBe(0); // Infinity rejected
      expect(s.totalDamageDealt).toBe(0);
      expect(s.totalGoldEarned).toBe(0);
      expect(s.totalVictories).toBe(0);
      expect(s.fastestVictorySeconds).toBe(Infinity); // sentinel default
      expect(s.highestWorldLevel).toBe(1); // default, not 0
      expect(s.highestPlayerLevel).toBe(1);
    });

    test('fastestVictorySeconds keeps a tampered 1e999 as the Infinity sentinel', () => {
      const m = loadFrom(JSON.stringify({ statistics: { fastestVictorySeconds: 1e999 } }));
      expect(m.getStatistics().fastestVictorySeconds).toBe(Infinity);
    });

    test('valid statistics round-trip unchanged', () => {
      const m = loadFrom(
        JSON.stringify({
          statistics: {
            totalRunsPlayed: 12,
            totalPlayTimeSeconds: 3600.5,
            totalKills: 5000,
            totalDamageDealt: 123456.75,
            totalGoldEarned: 8000,
            totalVictories: 4,
            fastestVictorySeconds: 180.25,
            highestWorldLevel: 7,
            highestPlayerLevel: 42,
          },
        })
      );
      const s = m.getStatistics();
      expect(s.totalRunsPlayed).toBe(12);
      expect(s.totalPlayTimeSeconds).toBe(3600.5);
      expect(s.totalDamageDealt).toBe(123456.75);
      expect(s.fastestVictorySeconds).toBe(180.25);
      expect(s.highestWorldLevel).toBe(7);
      expect(s.highestPlayerLevel).toBe(42);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // The latent real-path bug: JSON.stringify(Infinity) === "null".
  // ───────────────────────────────────────────────────────────────────────
  describe('Infinity→null real-path round-trip (latent bug regression)', () => {
    test('an all-loss history keeps fastestVictorySeconds = Infinity after save+reload', () => {
      const first = new CodexManager();
      first.recordRunEnd(120, 10, 100, 50, false, 1, 5); // a loss → fastest stays Infinity
      // The stored JSON now literally contains "fastestVictorySeconds":null
      const raw = SecureStorage.getItem(STORAGE_KEY) ?? '';
      expect(raw).toContain('"fastestVictorySeconds":null');

      const reloaded = new CodexManager();
      const fastest = reloaded.getStatistics().fastestVictorySeconds;
      expect(fastest).toBe(Infinity);
      // CodexScene shows '--:--' only when (fastest < Infinity) is false.
      expect(fastest < Infinity).toBe(false);
    });

    test('a real victory time survives save+reload', () => {
      const first = new CodexManager();
      first.recordRunEnd(200, 30, 500, 80, true, 2, 12); // victory → fastest=200
      const reloaded = new CodexManager();
      expect(reloaded.getStatistics().fastestVictorySeconds).toBe(200);
      expect(reloaded.getStatistics().totalVictories).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Upgrades use dynamic ids — keep valid object entries, drop scalar junk.
  // ───────────────────────────────────────────────────────────────────────
  describe('upgrade entries (dynamic ids)', () => {
    test('object entries kept + coerced, scalar entries dropped', () => {
      const m = loadFrom(
        JSON.stringify({
          upgrades: {
            good: { id: 'good', discovered: true, timesSelected: 4 },
            naned: { id: 'naned', discovered: 'yes', timesSelected: 'x' },
            scalar: 5, // junk, must be dropped
            arr: [1, 2], // junk, must be dropped
          },
        })
      );
      expect(m.isUpgradeDiscovered('good')).toBe(true);
      expect(m.getUpgradeEntry('good')?.timesSelected).toBe(4);
      // kept (object) but coerced
      expect(m.isUpgradeDiscovered('naned')).toBe(false);
      expect(m.getUpgradeEntry('naned')?.timesSelected).toBe(0);
      // dropped
      expect(m.getUpgradeEntry('scalar')).toBeUndefined();
      expect(m.getUpgradeEntry('arr')).toBeUndefined();
      // only the two object entries survive
      expect(m.getAllUpgradeEntries().length).toBe(2);
      expect(m.getDiscoveredUpgradeCount()).toBe(1);
    });
  });
});
