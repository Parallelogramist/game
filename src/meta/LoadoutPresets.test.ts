import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for encrypted storage so save/read round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as production, so
// Vitest swaps the real module for this one (LastLoadout imports it too).
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
import {
  loadLoadoutPresets,
  saveLoadoutPreset,
  isLoadoutSaved,
  loadoutsEqual,
  setPendingReplay,
  consumePendingReplay,
  MAX_LOADOUT_PRESETS,
} from './LoadoutPresets';
import type { LastLoadout } from './LastLoadout';

const STORAGE_KEY = 'survivor-loadout-presets';

function makeLoadout(overrides: Partial<LastLoadout> = {}): LastLoadout {
  return {
    startingWeapon: 'projectile',
    shipId: 'ship_default',
    stageId: 'stage_deep_void',
    pactIds: [],
    threatLevel: 0,
    gauntletMode: false,
    ...overrides,
  };
}

beforeEach(() => {
  SecureStorage.removeItem(STORAGE_KEY);
  consumePendingReplay();
});

describe('LoadoutPresets', () => {
  test('save then load round-trips a preset', () => {
    saveLoadoutPreset(makeLoadout({ startingWeapon: 'katana' }));
    const presets = loadLoadoutPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0].startingWeapon).toBe('katana');
  });

  test('saving an identical loadout is a no-op (dedup)', () => {
    saveLoadoutPreset(makeLoadout({ startingWeapon: 'katana' }));
    saveLoadoutPreset(makeLoadout({ startingWeapon: 'katana' }));
    expect(loadLoadoutPresets()).toHaveLength(1);
  });

  test('saving beyond the cap drops the oldest (FIFO)', () => {
    for (let index = 0; index < MAX_LOADOUT_PRESETS + 1; index++) {
      saveLoadoutPreset(makeLoadout({ startingWeapon: `weapon_${index}` }));
    }
    const presets = loadLoadoutPresets();
    expect(presets).toHaveLength(MAX_LOADOUT_PRESETS);
    expect(presets.map((p) => p.startingWeapon)).not.toContain('weapon_0');
    expect(presets[presets.length - 1].startingWeapon).toBe(`weapon_${MAX_LOADOUT_PRESETS}`);
  });

  test('loadoutsEqual ignores pact order', () => {
    const a = makeLoadout({ pactIds: ['x', 'y'] });
    const b = makeLoadout({ pactIds: ['y', 'x'] });
    expect(loadoutsEqual(a, b)).toBe(true);
    expect(isLoadoutSaved(a, [b])).toBe(true);
  });

  test('loadoutsEqual distinguishes different builds', () => {
    expect(loadoutsEqual(makeLoadout({ shipId: 'ship_apex' }), makeLoadout({ shipId: 'ship_default' }))).toBe(false);
  });

  test('load returns [] on corrupt or non-array data and drops invalid entries', () => {
    SecureStorage.setItem(STORAGE_KEY, 'not json');
    expect(loadLoadoutPresets()).toEqual([]);
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(loadLoadoutPresets()).toEqual([]);
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify([{ startingWeapon: '' }, makeLoadout({ startingWeapon: 'katana' })]));
    const presets = loadLoadoutPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0].startingWeapon).toBe('katana');
  });

  test('pending replay handoff returns the value once then clears', () => {
    const loadout = makeLoadout({ startingWeapon: 'katana' });
    setPendingReplay(loadout);
    expect(consumePendingReplay()).toEqual(loadout);
    expect(consumePendingReplay()).toBeNull();
  });
});
