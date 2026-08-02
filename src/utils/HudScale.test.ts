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
  computePracticeControlLayout,
  PRACTICE_CONTROL_BOTTOM_RESERVE,
  computeMenuCardGrid,
  computeGridFit,
  computeCardGridInBand,
  fitTextWidth,
  computeScrollViewMetrics,
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

describe('computePracticeControlLayout (the practice menu vertical budget)', () => {
  test('START fits the canvas in both orientations', () => {
    // The only two shapes EXPAND produces: the 1280×720 landscape base and the
    // 720×1280 portrait base, both of which resolve their own fit to exactly 1.0.
    // START rendering past the edge is the bug this pins — it was 6 units over in
    // landscape and a whole button-height over in portrait.
    expect(computePracticeControlLayout(720, 1).startBottom).toBeLessThanOrEqual(720);
    expect(computePracticeControlLayout(1280, 1).startBottom).toBeLessThanOrEqual(1280);
  });

  test('the reserve covers the whole stack below the stepper', () => {
    // Scale-independent restatement: add a row without growing the reserve and this
    // fails before it reaches a device.
    const layout = computePracticeControlLayout(720, 1);
    expect(layout.startBottom - layout.stepperY).toBeLessThanOrEqual(
      PRACTICE_CONTROL_BOTTOM_RESERVE,
    );
    expect(layout.shipY).toBeLessThan(layout.stepperY);
    expect(layout.stepperY).toBeLessThan(layout.evolveY);
    expect(layout.evolveY).toBeLessThan(layout.startY);
  });
});

describe('computeMenuCardGrid', () => {
  const pact = {
    count: 8, cardWidth: 218, cardHeight: 230,
    headerBottom: 150, anchorOffset: -10,
  };
  const modifier = {
    count: 6, cardWidth: 220, cardHeight: 210,
    headerBottom: 150, anchorOffset: -10,
  };

  test('desktop is byte-identical to the legacy layout where the grid fits', () => {
    const grid = computeMenuCardGrid({
      ...modifier, canvasWidth: 1280, canvasHeight: 720, menuScale: 1,
    });
    expect(grid).toEqual({
      perRow: 5, rowCount: 2, scale: 1, cardWidth: 220, cardHeight: 210,
      gap: 18, rowSpacing: 234, firstRowY: 233,
    });
  });

  test('a desktop grid taller than its band shrinks instead of overrunning the header', () => {
    const grid = computeMenuCardGrid({
      ...pact, canvasWidth: 1280, canvasHeight: 720, menuScale: 1,
    });
    expect(grid.perRow).toBe(5);
    expect(grid.rowCount).toBe(2);
    expect(grid.scale).toBeCloseTo(0.9669, 4);
    expect(grid.firstRowY - grid.cardHeight / 2).toBeGreaterThanOrEqual(150);
    const gridBottom =
      grid.firstRowY + (grid.rowCount - 1) * grid.rowSpacing + grid.cardHeight / 2;
    expect(gridBottom).toBeLessThanOrEqual(720 - 102);
  });

  test('a sub-1 scale still takes the legacy path', () => {
    const grid = computeMenuCardGrid({
      ...pact, canvasWidth: 1280, canvasHeight: 720, menuScale: 0.8,
    });
    expect(grid.scale).toBe(1);
    expect(grid.perRow).toBe(5);
    expect(grid.firstRowY).toBe(223);
  });

  test('a landscape phone grows the single row to the width it allows', () => {
    const grid = computeMenuCardGrid({
      ...modifier, canvasWidth: 2000, canvasHeight: 720, menuScale: 1.6,
    });
    expect(grid.perRow).toBe(6);
    expect(grid.rowCount).toBe(1);
    expect(grid.scale).toBeCloseTo(1.407, 2);
  });

  test('a portrait phone trades a column for the full density scale', () => {
    const grid = computeMenuCardGrid({
      ...modifier, canvasWidth: 720, canvasHeight: 1280, menuScale: 1.2,
    });
    expect(grid.perRow).toBe(2);
    expect(grid.rowCount).toBe(3);
    expect(grid.scale).toBeCloseTo(1.2, 5);
  });

  test('the grid never starts above the scaled header', () => {
    const grid = computeMenuCardGrid({
      ...pact, canvasWidth: 2000, canvasHeight: 720, menuScale: 1.6,
    });
    expect(grid.firstRowY - grid.cardHeight / 2).toBeGreaterThanOrEqual(150 * 1.6);
  });

  test('fitTextWidth only shrinks, and only when it must', () => {
    const wide = { width: 900, scale: 1, setScale(v: number) { this.scale = v; } };
    fitTextWidth(wide, 720);
    expect(wide.scale).toBeCloseTo(0.8, 5);
    const narrow = { width: 400, scale: 1, setScale(v: number) { this.scale = v; } };
    fitTextWidth(narrow, 720);
    expect(narrow.scale).toBe(1);
  });
});

describe('computeGridFit (the weapon grid at a full codex)', () => {
  const weapon = {
    cardWidth: 150, cardHeight: 180, columnGap: 14, rowGap: 14,
    availableWidth: 1248, availableHeight: 460,
    maxScale: 1, minScale: 0.7,
  };

  test('a grid that already fits keeps its designed column count and full scale', () => {
    const fit = computeGridFit({ ...weapon, count: 14, maxColumns: 7 });
    expect(fit).toEqual({ columns: 7, rows: 2, scale: 1 });
  });

  test('29 weapons trade rows for columns instead of painting off-screen', () => {
    const fit = computeGridFit({ ...weapon, count: 29, maxColumns: 10 });
    expect(fit.columns).toBe(10);
    expect(fit.rows).toBe(3);
    expect(fit.scale).toBeCloseTo(0.7675, 4);
    const gridHeight =
      fit.rows * 180 * fit.scale + (fit.rows - 1) * 14 * fit.scale;
    expect(gridHeight).toBeLessThanOrEqual(460);
  });

  test('the floor wins when even the best column count cannot fit', () => {
    const fit = computeGridFit({ ...weapon, count: 29, maxColumns: 10, availableHeight: 90 });
    expect(fit.scale).toBe(0.7);
  });
});

describe('computeCardGridInBand (the paint and quest-board grids)', () => {
  const paint = {
    count: 24, cardWidth: 180, cardHeight: 150, cardSpacing: 16, maxColumns: 4,
    edgeMargin: 32, topReserve: 92, bottomReserve: 72, anchorOffset: 20,
  };
  const board = {
    cardWidth: 236, cardHeight: 268, cardSpacing: 20, maxColumns: 4,
    edgeMargin: 48, topReserve: 168, bottomReserve: 80, anchorOffset: 48,
  };

  test('24 ship paints fit the band instead of painting above the canvas', () => {
    // Composed: 4 columns x 6 rows = 980 units of grid, centred at startY -110, so the
    // whole first row (SHIP DEFAULT included) sat off the top of a 720-tall canvas.
    const grid = computeCardGridInBand({
      ...paint, canvasWidth: 1280, canvasHeight: 720, menuScale: 1,
    });
    expect(grid.columns).toBe(7);
    expect(grid.rows).toBe(4);
    expect(grid.scale).toBeCloseTo(0.858025, 5);
    expect(grid.firstColumnX).toBeCloseTo(135.4815, 3);
    expect(grid.firstRowY).toBeCloseTo(156.3519, 3);
    const topEdge = grid.firstRowY - (paint.cardHeight * grid.scale) / 2;
    const bottomEdge = grid.firstRowY + (grid.rows - 1) * grid.rowPitch
      + (paint.cardHeight * grid.scale) / 2;
    expect(topEdge).toBeCloseTo(92, 3);
    expect(bottomEdge).toBeCloseTo(648, 3);
  });

  test('the paint grid stays inside the band on a portrait phone', () => {
    const grid = computeCardGridInBand({
      ...paint, canvasWidth: 720, canvasHeight: 1280, menuScale: 1.2,
    });
    expect(grid.columns).toBe(4);
    expect(grid.rows).toBe(6);
    const topEdge = grid.firstRowY - (paint.cardHeight * grid.scale) / 2;
    const bottomEdge = grid.firstRowY + (grid.rows - 1) * grid.rowPitch
      + (paint.cardHeight * grid.scale) / 2;
    expect(topEdge).toBeGreaterThanOrEqual(paint.topReserve * 1.2);
    expect(bottomEdge).toBeLessThanOrEqual(1280 - paint.bottomReserve * 1.2);
  });

  test('a one-row quest board keeps its geometry but clears the counter line', () => {
    const grid = computeCardGridInBand({
      ...board, count: 4, canvasWidth: 1280, canvasHeight: 720, menuScale: 1,
    });
    expect(grid.columns).toBe(4);
    expect(grid.rows).toBe(1);
    expect(grid.scale).toBe(1);
    expect(grid.firstColumnX).toBe(256);
    // The composed anchor is 274, which put the card's top edge at y=140 under a status
    // line drawn at y=150. Clamped to the band top instead.
    expect(grid.firstRowY).toBe(302);
  });

  test('a full quest board fits the band instead of hiding its top row', () => {
    const grid = computeCardGridInBand({
      ...board, count: 9, canvasWidth: 1280, canvasHeight: 720, menuScale: 1,
    });
    expect(grid.columns).toBe(5);
    expect(grid.rows).toBe(2);
    expect(grid.scale).toBeCloseTo(0.848921, 5);
    expect(grid.firstRowY).toBeCloseTo(281.7554, 3);
    const topEdge = grid.firstRowY - (board.cardHeight * grid.scale) / 2;
    const bottomEdge = grid.firstRowY + grid.rowPitch + (board.cardHeight * grid.scale) / 2;
    expect(topEdge).toBeCloseTo(168, 3);
    expect(bottomEdge).toBeCloseTo(640, 3);
  });
});

describe('computeScrollViewMetrics (density-scaled scroll band)', () => {
  test('an unscaled viewport keeps the pre-sweep band exactly', () => {
    const metrics = computeScrollViewMetrics(1280, 720, 1);
    expect(metrics.top).toBe(120);
    expect(metrics.height).toBe(540);
    expect(metrics.contentWidth).toBe(1280);
  });

  test('a landscape phone spends 1.6 on chrome and still leaves a scrollable band', () => {
    const metrics = computeScrollViewMetrics(2000, 720, 1.6);
    expect(metrics.top).toBeCloseTo(192, 6);
    expect(metrics.height).toBeCloseTo(432, 6);
    expect(metrics.contentWidth).toBeCloseTo(1250, 6);
  });

  test('a portrait phone at 1.2 has room for one codex column, not two', () => {
    const metrics = computeScrollViewMetrics(720, 1280, 1.2);
    expect(metrics.top).toBeCloseTo(144, 6);
    expect(metrics.height).toBeCloseTo(1064, 6);
    expect(metrics.contentWidth).toBeCloseTo(600, 6);
    // Two 340-unit codex cards plus their 14-unit gap need 694 of those units.
    expect(metrics.contentWidth).toBeLessThan(340 * 2 + 14);
  });

  test('the band shrinks as the chrome grows, on the same canvas', () => {
    expect(computeScrollViewMetrics(2000, 720, 1).height)
      .toBeGreaterThan(computeScrollViewMetrics(2000, 720, 1.6).height);
  });
});
