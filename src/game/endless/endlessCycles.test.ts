import { describe, expect, it } from 'vitest';
import { parseBestCycle, serializeBestCycle } from './endlessCycles';

describe('endless best-cycle payload', () => {
  it('round-trips a stored best', () => {
    expect(parseBestCycle(serializeBestCycle(7))).toBe(7);
  });

  it('reads absent or empty storage as no best', () => {
    expect(parseBestCycle(null)).toBe(0);
    expect(parseBestCycle('')).toBe(0);
  });

  it('reads corrupted or wrong-shaped payloads as no best', () => {
    expect(parseBestCycle('not json')).toBe(0);
    expect(parseBestCycle('{"bestCycle":"4"}')).toBe(0);
    expect(parseBestCycle('{"bestCycle":-1}')).toBe(0);
    expect(parseBestCycle('[3]')).toBe(0);
    expect(parseBestCycle('null')).toBe(0);
    expect(parseBestCycle('{}')).toBe(0);
  });

  it('floors fractional values on both sides', () => {
    expect(serializeBestCycle(3.9)).toBe('{"bestCycle":3}');
    expect(parseBestCycle('{"bestCycle":5.9}')).toBe(5);
  });

  it('serializes non-finite input as no best', () => {
    expect(serializeBestCycle(Number.NaN)).toBe('{"bestCycle":0}');
    expect(serializeBestCycle(Number.POSITIVE_INFINITY)).toBe('{"bestCycle":0}');
  });
});
