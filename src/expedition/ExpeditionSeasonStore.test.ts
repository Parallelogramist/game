import { describe, it, expect } from 'vitest';
import {
  FIRST_EXPEDITION_WORLD_SEED,
  NEXT_WORLD_CHOICE_COUNT,
  bankSeasonAndSwitch,
  emptySeasonState,
  rollNextExpeditionSeed,
  rollNextExpeditionSeedChoices,
  sanitizeSeasonState,
  withLiveWorldProgress,
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
    const after = bankSeasonAndSwitch(
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
      state = bankSeasonAndSwitch(
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
    expect(bankSeasonAndSwitch(before, record, 4242).currentSeed).toBe(4242);
    expect(bankSeasonAndSwitch(before, record, 4242).banked.length).toBe(1);
    const rolled = rollNextExpeditionSeed(before.currentSeed, before.currentIndex);
    for (const invalid of [0, -1, 1.5, Number.NaN, before.currentSeed]) {
      expect(bankSeasonAndSwitch(before, record, invalid).currentSeed).toBe(rolled);
    }
  });

  it('returns to a banked world with the ordinal it had, and never reuses an ordinal', () => {
    const record = { completionPercent: 50, sectorsCharted: 20, secretsFound: 5 };
    const first = emptySeasonState();
    const second = bankSeasonAndSwitch(first, record);          // W1 banked, now on W2
    const third = bankSeasonAndSwitch(second, record);          // W2 banked, now on W3
    expect(third.currentIndex).toBe(3);

    const back = bankSeasonAndSwitch(third, record, first.currentSeed);
    expect(back.currentSeed).toBe(first.currentSeed);
    expect(back.currentIndex).toBe(1);
    // The live world is never a banked row, and the world it was returned from now is.
    expect(back.banked.map(season => season.seed)).not.toContain(first.currentSeed);
    expect(back.banked.map(season => season.seed)).toContain(third.currentSeed);

    // A fresh world after a return must not collide with W2 or W3.
    const onward = bankSeasonAndSwitch(back, record, 4242);
    expect(onward.currentIndex).toBe(4);
  });

  it('keeps the live-world snapshot only for the world actually being flown', () => {
    // The one failure this cache can cause is the PREVIOUS world's percent under the CURRENT
    // world's tile, which is a wrong number on the main menu with no crash and no type error.
    const state = emptySeasonState();
    const wrongWorld = withLiveWorldProgress(state, {
      seed: FIRST_EXPEDITION_WORLD_SEED + 1,
      worldGenVersion: 4,
      completionPercent: 61,
      sectorsCharted: 30,
      secretsFound: 7,
    });
    expect(wrongWorld).toBe(state);
    expect(wrongWorld.liveProgress).toBeNull();

    const liveWorld = withLiveWorldProgress(state, {
      seed: FIRST_EXPEDITION_WORLD_SEED,
      worldGenVersion: 4,
      completionPercent: 142.6,
      sectorsCharted: 30.9,
      secretsFound: -3,
    });
    expect(liveWorld.liveProgress).toEqual({
      seed: FIRST_EXPEDITION_WORLD_SEED,
      worldGenVersion: 4,
      completionPercent: 100,
      sectorsCharted: 30,
      secretsFound: 0,
    });
  });

  it('drops the snapshot when the profile trades the world it describes', () => {
    const charted = withLiveWorldProgress(emptySeasonState(), {
      seed: FIRST_EXPEDITION_WORLD_SEED,
      worldGenVersion: 4,
      completionPercent: 61,
      sectorsCharted: 30,
      secretsFound: 7,
    });
    expect(charted.liveProgress).not.toBeNull();
    const traded = bankSeasonAndSwitch(charted, {
      completionPercent: 61, sectorsCharted: 30, secretsFound: 7,
    });
    expect(traded.liveProgress).toBeNull();
  });

  it('reads a half-shaped stored snapshot as no snapshot', () => {
    const base = { version: 1, currentSeed: 5, currentIndex: 1, banked: [] };
    const payloads: unknown[] = [
      { ...base },
      { ...base, liveProgress: null },
      { ...base, liveProgress: {} },
      { ...base, liveProgress: { seed: 5, worldGenVersion: 4, completionPercent: 12 } },
      { ...base, liveProgress: { seed: 0, worldGenVersion: 4, completionPercent: 12, sectorsCharted: 3, secretsFound: 1 } },
    ];
    for (const payload of payloads) {
      expect(sanitizeSeasonState(payload).liveProgress).toBeNull();
    }
    expect(sanitizeSeasonState({
      ...base,
      liveProgress: { seed: 5, worldGenVersion: 4, completionPercent: 12, sectorsCharted: 3, secretsFound: 1 },
    }).liveProgress).toEqual({
      seed: 5, worldGenVersion: 4, completionPercent: 12, sectorsCharted: 3, secretsFound: 1,
    });
  });
});
