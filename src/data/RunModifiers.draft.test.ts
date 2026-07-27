import { describe, test, expect, afterEach, vi } from 'vitest';
import { rollModifierChoices, RUN_MODIFIERS } from './RunModifiers';
import { mulberry32 } from '../utils/dailySeed';

describe('rollModifierChoices (FEAT-MODIFIER-DRAFT)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the requested count of DISTINCT modifiers', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const choices = rollModifierChoices(6);
    expect(choices).toHaveLength(6);
    const ids = choices.map((modifier) => modifier.id);
    expect(new Set(ids).size).toBe(6);
  });

  test('every returned modifier is a real RUN_MODIFIERS entry', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const validIds = new Set(RUN_MODIFIERS.map((modifier) => modifier.id));
    for (const modifier of rollModifierChoices(6)) {
      expect(validIds.has(modifier.id)).toBe(true);
    }
  });

  test('caps at the pool size when count exceeds it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const choices = rollModifierChoices(RUN_MODIFIERS.length + 50);
    expect(choices).toHaveLength(RUN_MODIFIERS.length);
    expect(new Set(choices.map((modifier) => modifier.id)).size).toBe(RUN_MODIFIERS.length);
  });

  test('every modifier is offered at the fair rate (no comparator-shuffle bias)', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(20260727));
    const TRIALS = 20_000;
    const DRAW = 6;
    const offers = new Map<string, number>(RUN_MODIFIERS.map((modifier) => [modifier.id, 0]));
    for (let trial = 0; trial < TRIALS; trial++) {
      for (const modifier of rollModifierChoices(DRAW)) {
        offers.set(modifier.id, offers.get(modifier.id)! + 1);
      }
    }
    const fairRate = DRAW / RUN_MODIFIERS.length;
    for (const [id, count] of offers) {
      const rate = count / TRIALS;
      expect(
        Math.abs(rate - fairRate) / fairRate,
        `${id} offered at ${(rate * 100).toFixed(1)}% vs fair ${(fairRate * 100).toFixed(1)}%`,
      ).toBeLessThan(0.1);
    }
  });
});
