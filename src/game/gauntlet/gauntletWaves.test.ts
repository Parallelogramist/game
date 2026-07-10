import { describe, expect, it } from 'vitest';
import {
  GAUNTLET_MAX_BOSSES_PER_WAVE,
  GAUNTLET_MAX_MINIBOSSES_PER_WAVE,
  gauntletWaveComposition,
  gauntletWaveGoldReward,
  gauntletWaveSpawnPlan,
  parseBestWave,
  serializeBestWave,
} from './gauntletWaves';

describe('gauntletWaveComposition', () => {
  it('matches the designed escalation table', () => {
    const expected: [number, number, number][] = [
      // [wave, minibosses, bosses]
      [1, 1, 0],
      [2, 2, 0],
      [3, 0, 1],
      [4, 1, 1],
      [5, 2, 1],
      [6, 0, 2],
      [7, 1, 2],
      [8, 2, 2],
      [9, 0, 3],
      [10, 1, 3],
      [11, 2, 3],
      [12, 3, 3], // boss overflow converts to minibosses past the boss cap
      [13, 4, 3],
      [14, 5, 3],
      [15, 6, 3],
    ];
    for (const [wave, minibossCount, bossCount] of expected) {
      expect(gauntletWaveComposition(wave), `wave ${wave}`).toEqual({ minibossCount, bossCount });
    }
  });

  it('caps both counts for arbitrarily deep waves', () => {
    for (let wave = 1; wave <= 200; wave++) {
      const { minibossCount, bossCount } = gauntletWaveComposition(wave);
      expect(bossCount).toBeLessThanOrEqual(GAUNTLET_MAX_BOSSES_PER_WAVE);
      expect(minibossCount).toBeLessThanOrEqual(GAUNTLET_MAX_MINIBOSSES_PER_WAVE);
      expect(Number.isInteger(minibossCount)).toBe(true);
      expect(Number.isInteger(bossCount)).toBe(true);
      expect(minibossCount + bossCount).toBeGreaterThan(0);
    }
  });

  it('clamps invalid wave numbers to wave 1', () => {
    expect(gauntletWaveComposition(0)).toEqual(gauntletWaveComposition(1));
    expect(gauntletWaveComposition(-5)).toEqual(gauntletWaveComposition(1));
    expect(gauntletWaveComposition(2.9)).toEqual(gauntletWaveComposition(2));
  });
});

describe('gauntletWaveSpawnPlan', () => {
  it('emits one entry per composition slot with non-negative staggered delays', () => {
    for (const wave of [1, 3, 8, 15, 40]) {
      const composition = gauntletWaveComposition(wave);
      const plan = gauntletWaveSpawnPlan(wave);
      expect(plan.filter((entry) => entry.kind === 'miniboss')).toHaveLength(composition.minibossCount);
      expect(plan.filter((entry) => entry.kind === 'boss')).toHaveLength(composition.bossCount);
      for (const entry of plan) {
        expect(entry.delaySeconds).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(entry.delaySeconds)).toBe(true);
      }
    }
  });

  it('staggers same-kind spawns strictly apart so entrances never overlap', () => {
    const plan = gauntletWaveSpawnPlan(15);
    for (const kind of ['miniboss', 'boss'] as const) {
      const delays = plan.filter((entry) => entry.kind === kind).map((entry) => entry.delaySeconds);
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]);
      }
    }
  });
});

describe('gauntletWaveGoldReward', () => {
  it('is positive and strictly increasing', () => {
    let previous = 0;
    for (let wave = 1; wave <= 50; wave++) {
      const reward = gauntletWaveGoldReward(wave);
      expect(reward).toBeGreaterThan(previous);
      previous = reward;
    }
  });
});

describe('best-wave persistence parsing', () => {
  it('round-trips a valid value', () => {
    expect(parseBestWave(serializeBestWave(17))).toBe(17);
  });

  it('floors floats and clamps negatives on serialize', () => {
    expect(parseBestWave(serializeBestWave(3.9))).toBe(3);
    expect(parseBestWave(serializeBestWave(-2))).toBe(0);
    expect(parseBestWave(serializeBestWave(Number.NaN))).toBe(0);
  });

  it('returns 0 for missing or corrupted payloads', () => {
    expect(parseBestWave(null)).toBe(0);
    expect(parseBestWave('')).toBe(0);
    expect(parseBestWave('not json')).toBe(0);
    expect(parseBestWave('[]')).toBe(0);
    expect(parseBestWave('{"bestWave":"12"}')).toBe(0);
    expect(parseBestWave('{"bestWave":-4}')).toBe(0);
    expect(parseBestWave('{"bestWave":null}')).toBe(0);
    expect(parseBestWave('{"other":5}')).toBe(0);
  });
});
