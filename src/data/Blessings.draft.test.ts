import { describe, test, expect, afterEach, vi } from 'vitest';
import { rollBlessingChoices, BLESSING_DRAFT_EXTRA, BLESSINGS } from './Blessings';
import { mulberry32 } from '../utils/dailySeed';

describe('rollBlessingChoices (FEAT-BLESSING-DRAFT)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('offers pickCount + BLESSING_DRAFT_EXTRA distinct candidates', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const choices = rollBlessingChoices(2);
    expect(choices).toHaveLength(2 + BLESSING_DRAFT_EXTRA);
    expect(new Set(choices.map((blessing) => blessing.id)).size).toBe(2 + BLESSING_DRAFT_EXTRA);
  });

  test('returns [] for zero or negative pickCount (unbought profile)', () => {
    expect(rollBlessingChoices(0)).toEqual([]);
    expect(rollBlessingChoices(-1)).toEqual([]);
  });

  test('every candidate is a real BLESSINGS entry', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const validIds = new Set(BLESSINGS.map((blessing) => blessing.id));
    for (const blessing of rollBlessingChoices(3)) {
      expect(validIds.has(blessing.id)).toBe(true);
    }
  });

  test('caps at the pool size when pickCount + extra exceeds it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const choices = rollBlessingChoices(BLESSINGS.length + 50);
    expect(choices).toHaveLength(BLESSINGS.length);
    expect(new Set(choices.map((blessing) => blessing.id)).size).toBe(BLESSINGS.length);
  });

  test('every blessing is offered at the fair rate (no comparator-shuffle bias)', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(20260727));
    const TRIALS = 20_000;
    const PICKS = 1; // 1 + BLESSING_DRAFT_EXTRA = 4 candidates of 14
    const offers = new Map<string, number>(BLESSINGS.map((blessing) => [blessing.id, 0]));
    for (let trial = 0; trial < TRIALS; trial++) {
      for (const blessing of rollBlessingChoices(PICKS)) {
        offers.set(blessing.id, offers.get(blessing.id)! + 1);
      }
    }
    const fairRate = (PICKS + BLESSING_DRAFT_EXTRA) / BLESSINGS.length;
    for (const [id, count] of offers) {
      const rate = count / TRIALS;
      expect(
        Math.abs(rate - fairRate) / fairRate,
        `${id} offered at ${(rate * 100).toFixed(1)}% vs fair ${(fairRate * 100).toFixed(1)}%`,
      ).toBeLessThan(0.1);
    }
  });
});
