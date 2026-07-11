import { describe, test, expect } from 'vitest';
import {
  EndlessMutatorType,
  ENDLESS_MUTATOR_META,
  rollEndlessMutator,
  sanitizeEndlessMutator,
} from './EndlessMutators';

const ROLLABLE = [
  EndlessMutatorType.SWIFT_SWARM,
  EndlessMutatorType.VOLATILE_AIR,
  EndlessMutatorType.GOLD_RUSH,
  EndlessMutatorType.XP_SURGE,
  EndlessMutatorType.IRON_HORDE,
];

describe('EndlessMutators', () => {
  test('every rollable mutator has a display name + description; NONE is neutral', () => {
    for (const type of ROLLABLE) {
      const meta = ENDLESS_MUTATOR_META[type];
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
    const none = ENDLESS_MUTATOR_META[EndlessMutatorType.NONE];
    expect(none.trashSpeedScale).toBe(1);
    expect(none.affixChanceMultiplier).toBe(1);
    expect(none.goldDropScale).toBe(1);
    expect(none.trashXpScale).toBe(1);
    expect(none.trashArmorBonus).toBe(0);
  });

  test('roll never returns NONE and never repeats the previous mutator', () => {
    for (const previous of ROLLABLE) {
      for (let i = 0; i < 200; i++) {
        const rolled = rollEndlessMutator(previous);
        expect(rolled).not.toBe(EndlessMutatorType.NONE);
        expect(rolled).not.toBe(previous);
        expect(ROLLABLE).toContain(rolled);
      }
    }
  });

  test('roll from NONE (first cycle) returns any pool member', () => {
    for (let i = 0; i < 200; i++) {
      const rolled = rollEndlessMutator(EndlessMutatorType.NONE);
      expect(ROLLABLE).toContain(rolled);
    }
  });

  test('sanitize passes valid ids through and rejects tampered values', () => {
    for (const type of ROLLABLE) {
      expect(sanitizeEndlessMutator(type)).toBe(type);
    }
    for (const bad of [0, 99, -1, 1.5, NaN, Infinity, 'SWIFT_SWARM', null, undefined, {}]) {
      expect(sanitizeEndlessMutator(bad)).toBe(EndlessMutatorType.NONE);
    }
  });
});
