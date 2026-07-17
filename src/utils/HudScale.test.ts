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
  computeRowStackFit,
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

describe('computeRowStackFit', () => {
  test('leaves a stack that already fits untouched', () => {
    // Desktop: hudScale 1 → 10 rows of 30 + 9 gaps of 6 = 354 in a 704-unit budget.
    expect(computeRowStackFit(10, 30, 6, 704)).toBe(1);
  });

  test('shrinks the 10-row practice dock to fit a phone canvas', () => {
    // iPhone landscape: the canvas stays ~720 units tall while hudScale ≈ 2.09,
    // so 10 design-size rows (63 + 13 gaps = 747) overhang a centered 720 stack.
    const fit = computeRowStackFit(10, 63, 13, 686);
    expect(fit).toBeLessThan(1);
    expect(10 * Math.floor(63 * fit) + 9 * Math.floor(13 * fit)).toBeLessThanOrEqual(686);
  });

  test('is inert for degenerate input', () => {
    expect(computeRowStackFit(0, 30, 6, 700)).toBe(1);
    expect(computeRowStackFit(10, 30, 6, 0)).toBe(1);
  });
});
