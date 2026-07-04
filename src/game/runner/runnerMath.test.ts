import { describe, test, expect } from 'vitest';
import {
  RUNNER_TUNING,
  RUNNER_SPAWN_TABLE,
  scrollSpeedForDistance,
  spawnIntervalForDistance,
  pickSpawnEntry,
  computeScore,
  distanceToMeters,
  parseBestScore,
  serializeBestScore,
} from './runnerMath';

describe('scrollSpeedForDistance', () => {
  test('starts at the base speed', () => {
    expect(scrollSpeedForDistance(0)).toBe(RUNNER_TUNING.BASE_SCROLL_SPEED);
  });

  test('is monotonically non-decreasing', () => {
    let previous = -Infinity;
    for (let d = 0; d <= 50000; d += 500) {
      const speed = scrollSpeedForDistance(d);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
  });

  test('caps at the max speed', () => {
    expect(scrollSpeedForDistance(1e9)).toBe(RUNNER_TUNING.MAX_SCROLL_SPEED);
  });

  test('negative distance is treated as zero', () => {
    expect(scrollSpeedForDistance(-100)).toBe(RUNNER_TUNING.BASE_SCROLL_SPEED);
  });
});

describe('spawnIntervalForDistance', () => {
  test('starts at the base interval', () => {
    expect(spawnIntervalForDistance(0)).toBe(RUNNER_TUNING.BASE_SPAWN_INTERVAL);
  });

  test('is monotonically non-increasing', () => {
    let previous = Infinity;
    for (let d = 0; d <= 50000; d += 500) {
      const interval = spawnIntervalForDistance(d);
      expect(interval).toBeLessThanOrEqual(previous);
      previous = interval;
    }
  });

  test('floors at the minimum interval', () => {
    expect(spawnIntervalForDistance(1e9)).toBe(RUNNER_TUNING.MIN_SPAWN_INTERVAL);
  });
});

describe('pickSpawnEntry', () => {
  test('only the starter type is available at distance 0', () => {
    for (let roll = 0; roll < 1; roll += 0.05) {
      expect(pickSpawnEntry(0, roll).typeId).toBe('basic');
    }
  });

  test('never returns a type that is not yet unlocked', () => {
    for (const probeDistance of [0, 700, 1600, 3300, 5000, 100000]) {
      for (let roll = 0; roll < 1; roll += 0.01) {
        const entry = pickSpawnEntry(probeDistance, roll);
        expect(entry.minDistance).toBeLessThanOrEqual(probeDistance);
      }
    }
  });

  test('every unlocked type is reachable by some roll at high distance', () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < 1; roll += 0.001) {
      seen.add(pickSpawnEntry(1e6, roll).typeId);
    }
    for (const entry of RUNNER_SPAWN_TABLE) {
      expect(seen.has(entry.typeId)).toBe(true);
    }
  });

  test('weighted boundaries: roll 0 picks the first unlocked entry, roll ~1 the last', () => {
    expect(pickSpawnEntry(1e6, 0).typeId).toBe(RUNNER_SPAWN_TABLE[0].typeId);
    expect(pickSpawnEntry(1e6, 0.9999999).typeId).toBe(
      RUNNER_SPAWN_TABLE[RUNNER_SPAWN_TABLE.length - 1].typeId
    );
  });

  test('out-of-range rolls are clamped rather than throwing', () => {
    expect(() => pickSpawnEntry(1e6, -1)).not.toThrow();
    expect(() => pickSpawnEntry(1e6, 2)).not.toThrow();
  });
});

describe('computeScore', () => {
  test('combines distance points and kill points', () => {
    // 1000 units * 0.1 + 4 kills * 25 = 100 + 100
    expect(computeScore(1000, 4)).toBe(200);
  });

  test('zero run scores zero', () => {
    expect(computeScore(0, 0)).toBe(0);
  });

  test('never negative', () => {
    expect(computeScore(-500, -3)).toBe(0);
  });

  test('floors fractional distance points', () => {
    expect(computeScore(19, 0)).toBe(1);
  });
});

describe('distanceToMeters', () => {
  test('converts world units to whole meters', () => {
    expect(distanceToMeters(1234)).toBe(123);
    expect(distanceToMeters(0)).toBe(0);
    expect(distanceToMeters(-50)).toBe(0);
  });
});

describe('parseBestScore (corruption hardening)', () => {
  test('valid payload round-trips', () => {
    expect(parseBestScore(serializeBestScore(4321))).toBe(4321);
  });

  test('null / empty input yields 0', () => {
    expect(parseBestScore(null)).toBe(0);
    expect(parseBestScore('')).toBe(0);
  });

  test('garbage JSON yields 0', () => {
    expect(parseBestScore('not json at all {{')).toBe(0);
    expect(parseBestScore('�corrupt�')).toBe(0);
  });

  test('wrong shapes yield 0', () => {
    expect(parseBestScore('{}')).toBe(0);
    expect(parseBestScore('[]')).toBe(0);
    expect(parseBestScore('"best"')).toBe(0);
    expect(parseBestScore('42')).toBe(0);
    expect(parseBestScore('null')).toBe(0);
    expect(parseBestScore('{"best":"9001"}')).toBe(0);
    expect(parseBestScore('{"best":null}')).toBe(0);
  });

  test('negative / non-finite best yields 0', () => {
    expect(parseBestScore('{"best":-5}')).toBe(0);
    expect(parseBestScore('{"best":1e999}')).toBe(0); // Infinity after JSON.parse
  });

  test('fractional best is floored', () => {
    expect(parseBestScore('{"best":123.9}')).toBe(123);
  });

  test('extra fields are tolerated', () => {
    expect(parseBestScore('{"best":77,"junk":true}')).toBe(77);
  });
});

describe('serializeBestScore', () => {
  test('emits the { best } payload', () => {
    expect(JSON.parse(serializeBestScore(99))).toEqual({ best: 99 });
  });

  test('sanitizes bad input to 0', () => {
    expect(JSON.parse(serializeBestScore(NaN))).toEqual({ best: 0 });
    expect(JSON.parse(serializeBestScore(-12))).toEqual({ best: 0 });
    expect(JSON.parse(serializeBestScore(Infinity))).toEqual({ best: 0 });
  });
});
