import { describe, test, expect, beforeEach } from 'vitest';

// In-memory stand-in for the encrypted storage so the integration cases can
// inject a raw (possibly corrupt) payload without touching crypto/localStorage
// (mirrors the other persistence tests).
import { vi } from 'vitest';
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

import { SecureStorage } from '../storage';
import {
  getGameStateManager,
  isStructurallyValidSaveState,
} from './GameStateManager';

// Storage key is stable (changing it would orphan every existing save), so the
// integration cases reference it directly rather than exporting it.
const STORAGE_KEY = 'survivor-game-state';

/**
 * A structurally complete, version-1 save. Each test mutates one field to a
 * corrupt value and asserts the validator rejects only that mutation — proving
 * we reject the broken shape without over-rejecting legitimate saves.
 */
function validSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    timestamp: 1700000000000,
    gameTime: 12.5,
    killCount: 7,
    enemyCount: 4,
    spawnTimer: 0.5,
    spawnInterval: 1.2,
    magnetSpawnTimer: 0,
    treasureSpawnTimer: 0,
    gemMagnetTimer: 0,
    dashCooldownTimer: 0,
    damageCooldown: 0,
    bossSpawned: false,
    minibossSpawnTimes: [],
    playerStats: { level: 3, maxHealth: 100, currentHealth: 80 },
    banishedUpgradeIds: [],
    isAutoBuyEnabled: false,
    worldLevel: 0,
    worldLevelHealthMult: 1,
    worldLevelDamageMult: 1,
    worldLevelSpawnReduction: 0,
    worldLevelXPMult: 1,
    weapons: [],
    upgrades: [],
    entities: [{ tag: 0, transform: { x: 10, y: 20, rotation: 0 } }],
    twinLinks: [],
    ...overrides,
  };
}

describe('isStructurallyValidSaveState', () => {
  test('accepts a structurally complete save', () => {
    expect(isStructurallyValidSaveState(validSave())).toBe(true);
  });

  test('accepts a save whose entity list is empty', () => {
    expect(isStructurallyValidSaveState(validSave({ entities: [] }))).toBe(true);
  });

  test('accepts a save with all optional fields absent (backward compatible)', () => {
    // The baseline omits directorState/eventState/comboState/relicIds/etc.
    // entirely; those are guarded at their restore site and must not be required.
    const save = validSave();
    expect(save.directorState).toBeUndefined();
    expect(save.eventState).toBeUndefined();
    expect(isStructurallyValidSaveState(save)).toBe(true);
  });

  test('rejects null and non-object roots', () => {
    expect(isStructurallyValidSaveState(null)).toBe(false);
    expect(isStructurallyValidSaveState(undefined)).toBe(false);
    expect(isStructurallyValidSaveState(42)).toBe(false);
    expect(isStructurallyValidSaveState('save')).toBe(false);
    expect(isStructurallyValidSaveState([])).toBe(false);
  });

  test('rejects a missing or non-numeric version', () => {
    expect(isStructurallyValidSaveState(validSave({ version: undefined }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ version: '1' }))).toBe(false);
  });

  test('rejects a save from a newer (unsupported) version', () => {
    expect(isStructurallyValidSaveState(validSave({ version: 999 }))).toBe(false);
  });

  test('rejects a non-finite core number (NaN gameTime)', () => {
    expect(isStructurallyValidSaveState(validSave({ gameTime: NaN }))).toBe(false);
  });

  test('rejects a missing timer field', () => {
    expect(isStructurallyValidSaveState(validSave({ spawnInterval: undefined }))).toBe(false);
  });

  test('rejects a non-finite world-level multiplier', () => {
    expect(isStructurallyValidSaveState(validSave({ worldLevelHealthMult: Infinity }))).toBe(false);
  });

  test('rejects a missing or non-object playerStats', () => {
    expect(isStructurallyValidSaveState(validSave({ playerStats: undefined }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ playerStats: null }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ playerStats: 'broken' }))).toBe(false);
  });

  test('rejects playerStats with a non-finite vital stat', () => {
    expect(isStructurallyValidSaveState(validSave({
      playerStats: { level: 3, maxHealth: 100, currentHealth: NaN },
    }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({
      playerStats: { level: NaN, maxHealth: 100, currentHealth: 80 },
    }))).toBe(false);
  });

  test('rejects when a required collection is not an array', () => {
    expect(isStructurallyValidSaveState(validSave({ entities: undefined }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ entities: {} }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ weapons: null }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ upgrades: 'x' }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ twinLinks: 3 }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ minibossSpawnTimes: undefined }))).toBe(false);
    expect(isStructurallyValidSaveState(validSave({ banishedUpgradeIds: undefined }))).toBe(false);
  });

  test('rejects an entity with non-finite transform coordinates', () => {
    expect(isStructurallyValidSaveState(validSave({
      entities: [{ tag: 0, transform: { x: NaN, y: 20, rotation: 0 } }],
    }))).toBe(false);
  });

  test('rejects an entity missing its transform', () => {
    expect(isStructurallyValidSaveState(validSave({
      entities: [{ tag: 0 }],
    }))).toBe(false);
  });

  test('rejects a non-object entity in the list', () => {
    expect(isStructurallyValidSaveState(validSave({
      entities: [null],
    }))).toBe(false);
  });
});

describe('GameStateManager corrupt-save rejection', () => {
  beforeEach(() => {
    getGameStateManager().clearSave();
  });

  test('load() returns null for truncated JSON', () => {
    SecureStorage.setItem(STORAGE_KEY, '{"version":1,"gameTime":10,"entit');
    expect(getGameStateManager().load()).toBeNull();
  });

  test('load() returns null for a version-valid but structurally corrupt save', () => {
    // version passes the old check, but entities is not an array → the restore
    // path would crash. We reject it so the player gets a clean fresh start.
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(validSave({ entities: null })));
    expect(getGameStateManager().load()).toBeNull();
  });

  test('hasSave() is false for a structurally corrupt save', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(validSave({ playerStats: null })));
    expect(getGameStateManager().hasSave()).toBe(false);
  });

  test('load() still returns a structurally valid save (no over-rejection)', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(validSave()));
    const loaded = getGameStateManager().load();
    expect(loaded).not.toBeNull();
    expect(loaded!.gameTime).toBe(12.5);
  });
});
