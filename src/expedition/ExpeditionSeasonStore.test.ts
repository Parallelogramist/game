import { describe, it, expect } from 'vitest';
import {
  FIRST_EXPEDITION_WORLD_SEED,
  NEXT_WORLD_CHOICE_COUNT,
  bankSeasonAndRoll,
  emptySeasonState,
  rollNextExpeditionSeed,
  rollNextExpeditionSeedChoices,
  sanitizeSeasonState,
} from './ExpeditionSeasonStore';

describe('expedition seasons', () => {
  it('defaults every unreadable payload to the world profiles were already flying', () => {
    // Any other default silently discards the discovery and world-profile state of every
    // profile that has never re-rolled, which is the one catastrophic failure this store
    // can cause.
    const payloads: unknown[] = [
      null, undefined, '', 0, [], {},
      { version: 2, currentSeed: 5, currentIndex: 1, banked: [] },
      { version: 1, currentSeed: 0, currentIndex: 1, banked: [] },
      { version: 1, currentSeed: 5, currentIndex: 0, banked: [] },
    ];
    for (const payload of payloads) {
      expect(sanitizeSeasonState(payload).currentSeed).toBe(FIRST_EXPEDITION_WORLD_SEED);
      expect(sanitizeSeasonState(payload).currentIndex).toBe(1);
    }
  });

  it('rolls a deterministic seed that is never the world being left', () => {
    const seed = rollNextExpeditionSeed(FIRST_EXPEDITION_WORLD_SEED, 1);
    expect(rollNextExpeditionSeed(FIRST_EXPEDITION_WORLD_SEED, 1)).toBe(seed);
    expect(seed).not.toBe(FIRST_EXPEDITION_WORLD_SEED);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThan(0);
    expect(rollNextExpeditionSeed(FIRST_EXPEDITION_WORLD_SEED, 2)).not.toBe(seed);
  });

  it('banks the world being left and moves the profile onto the next one', () => {
    const before = emptySeasonState();
    const after = bankSeasonAndRoll(
      before, { completionPercent: 62, sectorsCharted: 28, secretsFound: 9 },
    );
    expect(after.banked).toEqual([{
      index: 1,
      seed: FIRST_EXPEDITION_WORLD_SEED,
      completionPercent: 62,
      sectorsCharted: 28,
      secretsFound: 9,
    }]);
    expect(after.currentIndex).toBe(2);
    expect(after.currentSeed).not.toBe(before.currentSeed);
    expect(before.banked).toEqual([]);
  });

  it('bounds the banked list and keeps a banked percent inside 0 to 100', () => {
    let state = emptySeasonState();
    for (let index = 0; index < 25; index++) {
      state = bankSeasonAndRoll(
        state, { completionPercent: 140, sectorsCharted: 1, secretsFound: 0 },
      );
    }
    expect(state.banked.length).toBe(20);
    expect(state.banked.every(season => season.completionPercent === 100)).toBe(true);
    expect(state.currentIndex).toBe(26);
  });

  it('offers distinct worlds and leads with the one the chain already dealt', () => {
    const choices = rollNextExpeditionSeedChoices(FIRST_EXPEDITION_WORLD_SEED, 1);
    expect(choices.length).toBe(NEXT_WORLD_CHOICE_COUNT);
    // Index 0 is the contract: a player who always takes the first option must fly the
    // exact chain the store dealt before choosing existed.
    expect(choices[0]).toBe(rollNextExpeditionSeed(FIRST_EXPEDITION_WORLD_SEED, 1));
    expect(new Set(choices).size).toBe(choices.length);
    expect(choices.includes(FIRST_EXPEDITION_WORLD_SEED)).toBe(false);
    expect(choices.every(seed => Number.isInteger(seed) && seed > 0)).toBe(true);
    expect(rollNextExpeditionSeedChoices(FIRST_EXPEDITION_WORLD_SEED, 1)).toEqual(choices);
    expect(rollNextExpeditionSeedChoices(FIRST_EXPEDITION_WORLD_SEED, 2)).not.toEqual(choices);
  });

  it('flies the chosen world, and never the world being left', () => {
    const before = emptySeasonState();
    const record = { completionPercent: 40, sectorsCharted: 20, secretsFound: 4 };
    expect(bankSeasonAndRoll(before, record, 4242).currentSeed).toBe(4242);
    expect(bankSeasonAndRoll(before, record, 4242).banked.length).toBe(1);
    const rolled = rollNextExpeditionSeed(before.currentSeed, before.currentIndex);
    for (const invalid of [0, -1, 1.5, Number.NaN, before.currentSeed]) {
      expect(bankSeasonAndRoll(before, record, invalid).currentSeed).toBe(rolled);
    }
  });
});
