import { describe, it, expect } from 'vitest';
import { buildVictoryKicker } from './victoryKicker';

const conquest = {
  seasonIndex: 7,
  completionPercent: 62,
  firstConquest: true,
  worldsConqueredTotal: 3,
};

describe('buildVictoryKicker', () => {
  it('keeps the arena kicker byte-identical when no world was conquered', () => {
    expect(buildVictoryKicker({ clearedWorld: 3, canvasWidth: 1280 }))
      .toBe('WORLD 3 CLEARED  ·  BOSS DEFEATED');
  });

  it('keeps the arena trophy kicker byte-identical, uppercased', () => {
    expect(buildVictoryKicker({ clearedWorld: 3, trophyName: 'Void Crown', canvasWidth: 1280 }))
      .toBe('WORLD 3 CLEARED  ·  TROPHY UNLOCKED: VOID CROWN');
  });

  it('names the world, its completion and the lifetime total on a first conquest', () => {
    expect(buildVictoryKicker({ clearedWorld: 3, conquest, canvasWidth: 1280 }))
      .toBe('W7 CONQUERED  ·  62% CHARTED  ·  3 WORLDS DOWN');
  });

  it('says WORLD rather than WORLDS at a lifetime total of one', () => {
    expect(buildVictoryKicker({
      clearedWorld: 3, conquest: { ...conquest, worldsConqueredTotal: 1 }, canvasWidth: 1280,
    })).toBe('W7 CONQUERED  ·  62% CHARTED  ·  1 WORLD DOWN');
  });

  it('drops the milestone clause when the lifetime total did not move', () => {
    expect(buildVictoryKicker({
      clearedWorld: 3, conquest: { ...conquest, worldsConqueredTotal: 0 }, canvasWidth: 1280,
    })).toBe('W7 CONQUERED  ·  62% CHARTED');
  });

  it('says CONQUERED AGAIN and claims no milestone on a re-conquest', () => {
    expect(buildVictoryKicker({
      clearedWorld: 3, conquest: { ...conquest, firstConquest: false }, canvasWidth: 1280,
    })).toBe('W7 CONQUERED AGAIN  ·  62% CHARTED');
  });

  it('gives the third clause to a trophy over the milestone', () => {
    expect(buildVictoryKicker({
      clearedWorld: 3, conquest, trophyName: 'Void Crown', canvasWidth: 1280,
    })).toBe('W7 CONQUERED  ·  62% CHARTED  ·  TROPHY: VOID CROWN');
  });

  it('drops the third clause entirely below the width threshold', () => {
    expect(buildVictoryKicker({
      clearedWorld: 3, conquest, trophyName: 'Void Crown', canvasWidth: 720,
    })).toBe('W7 CONQUERED  ·  62% CHARTED');
  });
});
