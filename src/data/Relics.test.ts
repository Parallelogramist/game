import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  luckBiasedRarityWeights,
  pickRandomRelic,
  RELIC_RARITY_DROP_WEIGHTS,
  RELICS,
} from './Relics';

describe('luckBiasedRarityWeights', () => {
  // --- Regression lock: at luck 0 the weights must be byte-identical to the
  // base drop weights, so wiring the previously-dead `luck` stat can never
  // change a run played without any luck.
  test('returns the base rarity weights unchanged at luck 0 (regression lock)', () => {
    expect(luckBiasedRarityWeights(0)).toEqual(RELIC_RARITY_DROP_WEIGHTS);
  });

  test('never changes the common weight regardless of luck', () => {
    expect(luckBiasedRarityWeights(0).common).toBe(RELIC_RARITY_DROP_WEIGHTS.common);
    expect(luckBiasedRarityWeights(0.5).common).toBe(RELIC_RARITY_DROP_WEIGHTS.common);
    expect(luckBiasedRarityWeights(1).common).toBe(RELIC_RARITY_DROP_WEIGHTS.common);
  });

  test('raises rare/epic/legendary weights as luck increases', () => {
    const base = RELIC_RARITY_DROP_WEIGHTS;
    const lucky = luckBiasedRarityWeights(1);
    expect(lucky.rare).toBeGreaterThan(base.rare);
    expect(lucky.epic).toBeGreaterThan(base.epic);
    expect(lucky.legendary).toBeGreaterThan(base.legendary);
  });

  test('boosts higher rarities by a larger factor than lower ones', () => {
    const base = RELIC_RARITY_DROP_WEIGHTS;
    const lucky = luckBiasedRarityWeights(1);
    const rareFactor = lucky.rare / base.rare;
    const epicFactor = lucky.epic / base.epic;
    const legendaryFactor = lucky.legendary / base.legendary;
    expect(legendaryFactor).toBeGreaterThan(epicFactor);
    expect(epicFactor).toBeGreaterThan(rareFactor);
    expect(rareFactor).toBeGreaterThan(1);
  });

  test('strictly increases the legendary drop share as luck rises', () => {
    const legendaryShare = (luck: number) => {
      const w = luckBiasedRarityWeights(luck);
      const total = w.common + w.rare + w.epic + w.legendary;
      return w.legendary / total;
    };
    expect(legendaryShare(0.5)).toBeGreaterThan(legendaryShare(0));
    expect(legendaryShare(1)).toBeGreaterThan(legendaryShare(0.5));
  });

  test('clamps luck above 1 to the luck-1 weights (no runaway boost)', () => {
    expect(luckBiasedRarityWeights(5)).toEqual(luckBiasedRarityWeights(1));
  });

  test('clamps negative luck to the base weights', () => {
    expect(luckBiasedRarityWeights(-3)).toEqual(RELIC_RARITY_DROP_WEIGHTS);
  });

  test('treats a non-finite luck as 0 — base weights, no boost', () => {
    expect(luckBiasedRarityWeights(NaN)).toEqual(RELIC_RARITY_DROP_WEIGHTS);
    expect(luckBiasedRarityWeights(Infinity)).toEqual(RELIC_RARITY_DROP_WEIGHTS);
    expect(luckBiasedRarityWeights(-Infinity)).toEqual(RELIC_RARITY_DROP_WEIGHTS);
  });
});

describe('pickRandomRelic luck biasing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('defaults to luck 0 when the luck argument is omitted (regression lock)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const withDefault = pickRandomRelic([]);
    const withZero = pickRandomRelic([], 0);
    expect(withDefault?.id).toBe(withZero?.id);
  });

  test('never returns an excluded relic, across the whole roll range', () => {
    const excluded = ['relic_steady_eye', 'relic_immortal_core'];
    const spy = vi.spyOn(Math, 'random');
    for (let roll = 0; roll < 1; roll += 0.05) {
      spy.mockReturnValue(roll);
      const picked = pickRandomRelic(excluded, 0.5);
      expect(excluded).not.toContain(picked?.id);
    }
  });

  test('returns null when every relic is excluded', () => {
    const allIds = RELICS.map((relic) => relic.id);
    expect(pickRandomRelic(allIds, 1)).toBeNull();
  });

  test('high luck shifts the same roll from a common to a legendary relic', () => {
    // Narrow the pool to exactly one common (relic_steady_eye, weight 60) and
    // one legendary (relic_immortal_core, weight 1). At Math.random()=0.95 the
    // absolute roll (0.95 * total) lands in the common band at luck 0, but in
    // the luck-widened legendary band at luck 1 — proving luck biases selection
    // toward higher rarity through the real pick path.
    const allButTwo = RELICS
      .filter((relic) => relic.id !== 'relic_steady_eye' && relic.id !== 'relic_immortal_core')
      .map((relic) => relic.id);

    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    expect(pickRandomRelic(allButTwo, 0)?.rarity).toBe('common');
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    expect(pickRandomRelic(allButTwo, 1)?.rarity).toBe('legendary');
  });
});
