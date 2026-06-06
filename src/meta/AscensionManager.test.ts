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

import { SecureStorage } from '../storage';
import { AscensionManager } from './AscensionManager';

const STORAGE_KEY = 'survivor-meta-ascension';

/**
 * Seed the store with a RAW string, then construct a fresh manager so it loads
 * that payload. Raw (not JSON.stringify) because the interesting tamper vectors
 * are exactly the values JSON.stringify mangles: it turns NaN/Infinity into
 * `null`, so a literal `1e999` (which JSON.parse reads back as Infinity) or a
 * non-numeric field must be injected by hand to reach the load path.
 */
function loadFrom(raw: string): AscensionManager {
  SecureStorage.setItem(STORAGE_KEY, raw);
  return new AscensionManager();
}

describe('AscensionManager', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  // ── Corruption / tamper resilience (the bug this fixes) ──
  // SecureStorage is the anti-cheat layer, so a corrupt/tampered payload is the
  // threat model. The un-hardened load() did `Math.max(0, Math.min(parsed.level
  // ?? 0, 50))`: `?? 0` only catches null/undefined, so a non-numeric value slips
  // through and `Math.min("abc", 50)` is NaN — and `Math.max(0, NaN)` is NaN.
  // A NaN level then poisons every consumer: getStatMultiplier/getGoldMultiplier
  // → NaN (feeds run gold + the shop/boot/pause UI) and getAscensionThreshold →
  // NaN, which makes `accountLevel >= NaN` false FOREVER — re-ascension bricked.

  test('a non-numeric string level is coerced to 0 — multipliers stay finite, prestige not bricked', () => {
    const manager = loadFrom('{"level":"abc","totalAscensions":"xyz"}');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
    expect(Number.isFinite(manager.getStatMultiplier())).toBe(true);
    expect(manager.getStatMultiplier()).toBe(1);
    expect(Number.isFinite(manager.getGoldMultiplier())).toBe(true);
    expect(manager.getGoldMultiplier()).toBe(1);
    expect(Number.isFinite(manager.getAscensionThreshold())).toBe(true);
    expect(manager.getAscensionThreshold()).toBe(50);
    // The poison case: a NaN threshold makes `accountLevel >= NaN` false forever.
    expect(manager.canAscend(9999)).toBe(true);
  });

  test('an object level value is coerced to 0', () => {
    const manager = loadFrom('{"level":{},"totalAscensions":[]}');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
    expect(Number.isFinite(manager.getStatMultiplier())).toBe(true);
  });

  test('an Infinity level (1e999 overflow) is rejected to 0, not granted as max', () => {
    // JSON.parse reads 1e999 back as Infinity — a real overflow tamper vector.
    const manager = loadFrom('{"level":1e999,"totalAscensions":1e999}');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
    expect(Number.isFinite(manager.getStatMultiplier())).toBe(true);
    expect(manager.getStatMultiplier()).toBe(1);
  });

  test('a negative-Infinity level is rejected to 0', () => {
    const manager = loadFrom('{"level":-1e999,"totalAscensions":-1e999}');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('a null field falls back to the default for that field', () => {
    const manager = loadFrom('{"level":null,"totalAscensions":null}');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('a fractional level is floored to an integer', () => {
    const manager = loadFrom('{"level":3.9,"totalAscensions":3.9}');
    expect(manager.getLevel()).toBe(3);
    expect(manager.getTotalAscensions()).toBe(3);
    expect(manager.getStatMultiplier()).toBeCloseTo(1.3, 10);
  });

  test('a negative level is clamped to 0', () => {
    const manager = loadFrom('{"level":-5,"totalAscensions":-5}');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('a level above the cap is clamped to 50', () => {
    const manager = loadFrom('{"level":999,"totalAscensions":999}');
    expect(manager.getLevel()).toBe(50);
    expect(manager.getTotalAscensions()).toBe(50);
    expect(Number.isFinite(manager.getStatMultiplier())).toBe(true);
  });

  test('a "null" payload loads defaults without throwing', () => {
    expect(() => loadFrom('null')).not.toThrow();
    const manager = loadFrom('null');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('an array payload loads defaults without throwing', () => {
    const manager = loadFrom('[1,2,3]');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('a primitive (number) payload loads defaults without throwing', () => {
    const manager = loadFrom('42');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('non-JSON garbage loads defaults without throwing', () => {
    const manager = loadFrom('{not valid json');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('an empty object loads defaults', () => {
    const manager = loadFrom('{}');
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('a partial payload keeps the valid field and defaults the missing one', () => {
    const manager = loadFrom('{"level":4}');
    expect(manager.getLevel()).toBe(4);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  // ── Core behaviour (characterization of the existing contract) ──

  test('a fresh manager with no storage starts at the default state', () => {
    const manager = new AscensionManager();
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
    expect(manager.getStatMultiplier()).toBe(1);
    expect(manager.getGoldMultiplier()).toBe(1);
    expect(manager.getAscensionThreshold()).toBe(50);
  });

  test('getStatMultiplier is 1 + level * 0.10', () => {
    expect(loadFrom('{"level":3,"totalAscensions":3}').getStatMultiplier()).toBeCloseTo(1.3, 10);
    expect(loadFrom('{"level":10,"totalAscensions":10}').getStatMultiplier()).toBeCloseTo(2.0, 10);
  });

  test('getGoldMultiplier is 1 + level * 0.15', () => {
    expect(loadFrom('{"level":3,"totalAscensions":3}').getGoldMultiplier()).toBeCloseTo(1.45, 10);
    expect(loadFrom('{"level":2,"totalAscensions":2}').getGoldMultiplier()).toBeCloseTo(1.3, 10);
  });

  test('getAscensionThreshold is 50 + level * 15', () => {
    expect(loadFrom('{"level":0,"totalAscensions":0}').getAscensionThreshold()).toBe(50);
    expect(loadFrom('{"level":2,"totalAscensions":2}').getAscensionThreshold()).toBe(80);
  });

  test('canAscend is true at exactly the threshold and false just below', () => {
    const manager = new AscensionManager(); // level 0, threshold 50
    expect(manager.canAscend(49)).toBe(false);
    expect(manager.canAscend(50)).toBe(true);
    expect(manager.canAscend(51)).toBe(true);
  });

  test('getBonusWeaponSlots unlocks at level 2', () => {
    expect(loadFrom('{"level":1,"totalAscensions":1}').getBonusWeaponSlots()).toBe(0);
    expect(loadFrom('{"level":2,"totalAscensions":2}').getBonusWeaponSlots()).toBe(1);
  });

  test('getBonusStartingLevel unlocks at level 3', () => {
    expect(loadFrom('{"level":2,"totalAscensions":2}').getBonusStartingLevel()).toBe(0);
    expect(loadFrom('{"level":3,"totalAscensions":3}').getBonusStartingLevel()).toBe(1);
  });

  test('getXPGemMultiplier doubles at level 4', () => {
    expect(loadFrom('{"level":3,"totalAscensions":3}').getXPGemMultiplier()).toBe(1);
    expect(loadFrom('{"level":4,"totalAscensions":4}').getXPGemMultiplier()).toBe(2);
  });

  // ── Actions ──

  test('performAscension is rejected below the threshold and leaves state untouched', () => {
    const manager = new AscensionManager(); // level 0, threshold 50
    expect(manager.performAscension(49)).toBe(false);
    expect(manager.getLevel()).toBe(0);
    expect(manager.getTotalAscensions()).toBe(0);
  });

  test('performAscension at the threshold increments level + total and persists', () => {
    const manager = new AscensionManager();
    expect(manager.performAscension(50)).toBe(true);
    expect(manager.getLevel()).toBe(1);
    expect(manager.getTotalAscensions()).toBe(1);
    // Persisted: a fresh manager reads the new level back.
    const reloaded = new AscensionManager();
    expect(reloaded.getLevel()).toBe(1);
    expect(reloaded.getTotalAscensions()).toBe(1);
    // The next threshold has grown (50 + 1*15).
    expect(reloaded.getAscensionThreshold()).toBe(65);
  });
});
