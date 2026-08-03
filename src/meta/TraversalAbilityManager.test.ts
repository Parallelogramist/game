import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';

// In-memory stand-in for encrypted storage so ownership round-trips without crypto or
// localStorage. Same specifier as the production import, so Vitest swaps the module.
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
import { TRAVERSAL_ABILITIES } from '../data/TraversalAbilities';
import { setPracticeSession } from '../utils/practiceSession';
import {
  claimTraversalAbility,
  getOwnedTraversalAbilities,
  getOwnedTraversalAbilityIds,
  hasTraversalAbility,
  sanitizeOwnedAbilityIds,
  setPracticeAbilityKit,
} from './TraversalAbilityManager';

const STORAGE_KEY = 'survivor-traversal-abilities';

beforeEach(() => {
  SecureStorage.removeItem(STORAGE_KEY);
});

describe('claiming traversal abilities', () => {
  test('a fresh profile owns nothing', () => {
    expect(getOwnedTraversalAbilityIds()).toEqual([]);
    expect(hasTraversalAbility('ability_blink_drive')).toBe(false);
  });

  test('claim is idempotent — a second claim of the same ability is a no-op', () => {
    expect(claimTraversalAbility('ability_blink_drive')).toBe(true);
    expect(claimTraversalAbility('ability_blink_drive')).toBe(false);
    expect(getOwnedTraversalAbilityIds()).toEqual(['ability_blink_drive']);
  });

  test('claim rejects an unknown id without writing', () => {
    expect(claimTraversalAbility('ability_wing_suit')).toBe(false);
    expect(SecureStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('ownership reads back in catalog order however it was claimed', () => {
    claimTraversalAbility('ability_signal_decryptor');
    claimTraversalAbility('ability_blink_drive');
    claimTraversalAbility('ability_phase_cloak');

    expect(getOwnedTraversalAbilityIds()).toEqual([
      'ability_blink_drive',
      'ability_phase_cloak',
      'ability_signal_decryptor',
    ]);
    expect(getOwnedTraversalAbilities().map((ability) => ability.name)).toEqual([
      'Blink Drive',
      'Phase Cloak',
      'Signal Decryptor',
    ]);
  });

  test('ownership survives a reload — the read path never caches', () => {
    claimTraversalAbility('ability_magno_tether');
    const persisted = SecureStorage.getItem(STORAGE_KEY);

    expect(persisted).toBe(JSON.stringify(['ability_magno_tether']));
    expect(hasTraversalAbility('ability_magno_tether')).toBe(true);
    expect(hasTraversalAbility('ability_thermal_ward')).toBe(false);
  });
});

describe('load-time sanitization', () => {
  test.each([
    ['not json at all', 'ability_blink_drive'],
    ['{"owned":["ability_blink_drive"]}', ''],
    ['null', ''],
    ['42', ''],
  ])('a corrupt payload degrades to owning nothing (%s)', (raw) => {
    SecureStorage.setItem(STORAGE_KEY, raw);
    expect(getOwnedTraversalAbilityIds()).toEqual([]);
  });

  test('a tampered array keeps only known ids, deduped and ordered', () => {
    expect(
      sanitizeOwnedAbilityIds([
        'ability_thermal_ward',
        7,
        'ability_wing_suit',
        'ability_blink_drive',
        'ability_thermal_ward',
        null,
      ]),
    ).toEqual(['ability_blink_drive', 'ability_thermal_ward']);
  });

  test('a claim on top of a corrupt payload starts a clean list', () => {
    SecureStorage.setItem(STORAGE_KEY, '["ability_wing_suit","ability_phase_cloak"]');
    expect(claimTraversalAbility('ability_blink_drive')).toBe(true);
    expect(getOwnedTraversalAbilityIds()).toEqual([
      'ability_blink_drive',
      'ability_phase_cloak',
    ]);
  });
});

describe('the practice ability kit', () => {
  afterEach(() => {
    setPracticeAbilityKit('owned');
    setPracticeSession(false);
  });

  test('an override outside a practice session is inert', () => {
    claimTraversalAbility('ability_blink_drive');
    setPracticeAbilityKit('full');

    expect(getOwnedTraversalAbilityIds()).toEqual(['ability_blink_drive']);
  });

  test('FULL hands a practice run every ability and banks none of them', () => {
    setPracticeSession(true);
    setPracticeAbilityKit('full');

    expect(getOwnedTraversalAbilityIds()).toEqual(
      TRAVERSAL_ABILITIES.map((ability) => ability.id),
    );
    expect(SecureStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('NONE hides an ability the profile really owns, and gives it back on exit', () => {
    claimTraversalAbility('ability_magno_tether');
    setPracticeSession(true);
    setPracticeAbilityKit('none');

    expect(getOwnedTraversalAbilityIds()).toEqual([]);

    setPracticeSession(false);
    expect(getOwnedTraversalAbilityIds()).toEqual(['ability_magno_tether']);
  });
});
