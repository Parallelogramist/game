import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage (mirrors CodexManager.corruption.test.ts).
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

// Mock the Phaser-coupled weapon barrel + enemy table so the manager loads in a
// pure Node test. The synergy/evolution data modules are pure (no imports), so they
// are NOT mocked — the sanitizers seed from the real WEAPON_SYNERGIES / definitions.
vi.mock('../weapons', () => ({
  getAllWeaponIds: () => ['projectile', 'katana', 'aura'],
}));
vi.mock('../enemies/EnemyTypes', () => ({
  ENEMY_TYPES: { shambler: {}, dasher: {}, tank: {} },
}));

import { SecureStorage } from '../storage';
import { CodexManager } from './CodexManager';
import { WEAPON_SYNERGIES } from '../data/WeaponSynergies';
import { weaponEvolutionDefinitions } from '../data/WeaponEvolutions';

const STORAGE_KEY = 'survivor-codex';

describe('CodexManager — synergy & evolution discovery', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  test('fresh manager seeds all synergies and evolutions as undiscovered', () => {
    const m = new CodexManager();
    expect(m.getTotalSynergyCount()).toBe(WEAPON_SYNERGIES.length);
    expect(m.getDiscoveredSynergyCount()).toBe(0);
    expect(m.getTotalEvolutionCount()).toBe(weaponEvolutionDefinitions.length);
    expect(m.getDiscoveredEvolutionCount()).toBe(0);
    expect(m.isSynergyDiscovered(WEAPON_SYNERGIES[0])).toBe(false);
    expect(m.isEvolutionDiscovered(weaponEvolutionDefinitions[0])).toBe(false);
  });

  test('discoverSynergy marks discovered, is idempotent, and persists across reload', () => {
    const first = new CodexManager();
    expect(first.discoverSynergy(WEAPON_SYNERGIES[0])).toBe(true);
    expect(first.discoverSynergy(WEAPON_SYNERGIES[0])).toBe(false); // idempotent
    expect(first.isSynergyDiscovered(WEAPON_SYNERGIES[0])).toBe(true);
    expect(first.getDiscoveredSynergyCount()).toBe(1);

    const reloaded = new CodexManager();
    expect(reloaded.isSynergyDiscovered(WEAPON_SYNERGIES[0])).toBe(true);
    expect(reloaded.getDiscoveredSynergyCount()).toBe(1);
  });

  test('discoverEvolution marks discovered, is idempotent, and persists across reload', () => {
    const first = new CodexManager();
    expect(first.discoverEvolution(weaponEvolutionDefinitions[0])).toBe(true);
    expect(first.discoverEvolution(weaponEvolutionDefinitions[0])).toBe(false); // idempotent
    expect(first.isEvolutionDiscovered(weaponEvolutionDefinitions[0])).toBe(true);
    expect(first.getDiscoveredEvolutionCount()).toBe(1);

    const reloaded = new CodexManager();
    expect(reloaded.isEvolutionDiscovered(weaponEvolutionDefinitions[0])).toBe(true);
  });

  test('a pre-existing save with no synergy/evolution fields loads without wiping weapons', () => {
    const first = new CodexManager();
    first.discoverWeapon('katana', 'Katana'); // persists the codex payload
    const raw = SecureStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    delete parsed.synergies;
    delete parsed.evolutions;
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));

    const migrated = new CodexManager();
    expect(migrated.isWeaponDiscovered('katana')).toBe(true); // existing data intact
    expect(migrated.getTotalSynergyCount()).toBe(WEAPON_SYNERGIES.length);
    expect(migrated.getDiscoveredSynergyCount()).toBe(0);
    expect(migrated.getTotalEvolutionCount()).toBe(weaponEvolutionDefinitions.length);
    expect(migrated.getDiscoveredEvolutionCount()).toBe(0);
  });
});
