import { describe, test, expect, vi } from 'vitest';

// HudScale reads GAME_WIDTH/GAME_HEIGHT from GameConfig, which value-imports
// Phaser — and Phaser's device detection dereferences `navigator` at import
// time, which does not exist in the Node test env. Stub the module boundary
// (the documented vitest.config.ts pattern) with the real design constants.
vi.mock('../GameConfig', () => ({ GAME_WIDTH: 1280, GAME_HEIGHT: 720 }));

import {
  computeMenuLayoutScale,
  computeMenuLayoutScalePortrait,
  computeMenuFontScale,
  computeMenuFontScalePortrait,
} from './HudScale';

// Node env: window is undefined, so densityCompensation resolves to 1 and
// the font scales reduce to layoutScale × userMultiplier — which is exactly
// the part worth locking (the density term needs a browser to mean anything).

describe('computeMenuLayoutScale (landscape 1280×720 design fit)', () => {
  test('desktop landscape is unscaled', () => {
    expect(computeMenuLayoutScale(1280, 720)).toBe(1);
    expect(computeMenuLayoutScale(2000, 720)).toBe(1);
  });

  test('portrait viewports shrink against the landscape design (the old behavior)', () => {
    expect(computeMenuLayoutScale(720, 1558)).toBeCloseTo(0.5625, 6);
  });
});

describe('computeMenuLayoutScalePortrait (720×1280 design fit)', () => {
  test('the orientation-aware portrait base renders full size', () => {
    // EXPAND portrait guarantees ≥720×1280, so opting in means 1.0.
    expect(computeMenuLayoutScalePortrait(720, 1280)).toBe(1);
    expect(computeMenuLayoutScalePortrait(720, 1558)).toBe(1);
    expect(computeMenuLayoutScalePortrait(900, 1280)).toBe(1);
  });

  test('sub-base viewports still shrink to fit', () => {
    expect(computeMenuLayoutScalePortrait(360, 1280)).toBeCloseTo(0.5, 6);
    expect(computeMenuLayoutScalePortrait(720, 640)).toBeCloseTo(0.5, 6);
  });
});

describe('font scales honor the user multiplier and clamp', () => {
  test('multiplier scales linearly inside the clamp', () => {
    expect(computeMenuFontScale(1280, 720, 1)).toBe(1);
    expect(computeMenuFontScale(1280, 720, 2)).toBe(2);
    expect(computeMenuFontScalePortrait(720, 1280, 1)).toBe(1);
    expect(computeMenuFontScalePortrait(720, 1280, 2)).toBe(2);
  });

  test('clamps to [0.5, 2.5]', () => {
    expect(computeMenuFontScalePortrait(720, 1280, 99)).toBe(2.5);
    expect(computeMenuFontScalePortrait(720, 1280, 0.01)).toBe(0.5);
  });
});
