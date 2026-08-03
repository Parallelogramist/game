/**
 * The two facts the `7 / 24 secrets` clause rests on. Both fail silently: a denominator counted
 * from a different set prints a fraction that is merely wrong, and an untrusted one prints
 * `9 / 7`, which reads as a bug rather than as the generator version bump it actually is.
 */

import { describe, it, expect } from 'vitest';
import { buildIdUniverse } from './discoveryRules';
import {
  describeSecretsFound, generateExpeditionWorld, previewExpeditionWorld,
} from './expeditionWorld';
import { FIRST_EXPEDITION_WORLD_SEED } from './ExpeditionSeasonStore';

describe('expedition secret denominator', () => {
  it('counts the same secrets the discovery universe does', () => {
    for (const seed of [FIRST_EXPEDITION_WORLD_SEED, 1, 777, 20260801]) {
      const universe = buildIdUniverse(generateExpeditionWorld(seed));
      expect(previewExpeditionWorld(seed).secretSlots).toBe(universe.secretIds.size);
      expect(universe.secretIds.size).toBeGreaterThan(0);
    }
  });

  it('drops a denominator it cannot stand behind', () => {
    expect(describeSecretsFound(7, 24)).toBe('7 / 24 secrets');
    expect(describeSecretsFound(0, 24)).toBe('0 / 24 secrets');
    expect(describeSecretsFound(24, 24)).toBe('24 / 24 secrets');
    expect(describeSecretsFound(9, 7)).toBe('9 secrets');
    expect(describeSecretsFound(3, 0)).toBe('3 secrets');
  });
});
