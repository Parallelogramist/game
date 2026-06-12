import { describe, test, expect } from 'vitest';
import { computeNextNavIndex, resolveHorizontalNav } from './menuNavigation';

describe('computeNextNavIndex — vertical lists (columns = 1)', () => {
  test('moves down one item', () => {
    expect(computeNextNavIndex(0, 0, 1, 5, 1, true)).toBe(1);
  });

  test('moves up one item', () => {
    expect(computeNextNavIndex(3, 0, -1, 5, 1, true)).toBe(2);
  });

  test('wraps from last to first when wrap enabled', () => {
    expect(computeNextNavIndex(4, 0, 1, 5, 1, true)).toBe(0);
  });

  test('wraps from first to last when wrap enabled', () => {
    expect(computeNextNavIndex(0, 0, -1, 5, 1, true)).toBe(4);
  });

  test('clamps at bottom when wrap disabled', () => {
    expect(computeNextNavIndex(4, 0, 1, 5, 1, false)).toBe(4);
  });

  test('clamps at top when wrap disabled', () => {
    expect(computeNextNavIndex(0, 0, -1, 5, 1, false)).toBe(0);
  });

  test('horizontal input is a no-op in a single-column list', () => {
    expect(computeNextNavIndex(2, 1, 0, 5, 1, true)).toBe(2);
    expect(computeNextNavIndex(2, -1, 0, 5, 1, true)).toBe(2);
    expect(computeNextNavIndex(2, 1, 0, 5, 1, false)).toBe(2);
  });
});

describe('computeNextNavIndex — grids', () => {
  // 3-column grid with 7 items:
  //   0 1 2
  //   3 4 5
  //   6
  test('moves right within a row', () => {
    expect(computeNextNavIndex(0, 1, 0, 7, 3, true)).toBe(1);
  });

  test('moves left within a row', () => {
    expect(computeNextNavIndex(4, -1, 0, 7, 3, true)).toBe(3);
  });

  test('wraps right edge back to column 0 of the same row', () => {
    expect(computeNextNavIndex(2, 1, 0, 7, 3, true)).toBe(0);
  });

  test('wraps left edge to the last column of the same row', () => {
    expect(computeNextNavIndex(3, -1, 0, 7, 3, true)).toBe(5);
  });

  test('moves down preserving the column', () => {
    expect(computeNextNavIndex(1, 0, 1, 7, 3, true)).toBe(4);
  });

  test('clamps to the last item when the target cell is past the end', () => {
    // Down from index 4 (row 1, col 1) targets row 2 col 1 = index 7 → clamp to 6.
    expect(computeNextNavIndex(4, 0, 1, 7, 3, true)).toBe(6);
  });

  test('right from a partial last row clamps to the last item', () => {
    // Right from index 6 (row 2, col 0) targets col 1 = index 7 → clamp to 6.
    expect(computeNextNavIndex(6, 1, 0, 7, 3, true)).toBe(6);
  });

  test('wraps vertically from the last row to the first', () => {
    expect(computeNextNavIndex(6, 0, 1, 7, 3, true)).toBe(0);
  });

  test('wraps vertically from the first row to the last (with end clamp)', () => {
    // Up from index 1 (row 0, col 1) targets row 2 col 1 = index 7 → clamp to 6.
    expect(computeNextNavIndex(1, 0, -1, 7, 3, true)).toBe(6);
  });

  test('no-wrap grid clamps both axes', () => {
    expect(computeNextNavIndex(2, 1, 0, 7, 3, false)).toBe(2);
    expect(computeNextNavIndex(0, -1, 0, 7, 3, false)).toBe(0);
    expect(computeNextNavIndex(6, 0, 1, 7, 3, false)).toBe(6);
    expect(computeNextNavIndex(0, 0, -1, 7, 3, false)).toBe(0);
  });

  test('full rectangular grid round-trips down then up', () => {
    // 2-column, 6-item grid.
    const down = computeNextNavIndex(1, 0, 1, 6, 2, true);
    expect(down).toBe(3);
    expect(computeNextNavIndex(down, 0, -1, 6, 2, true)).toBe(1);
  });
});

describe('computeNextNavIndex — degenerate inputs', () => {
  test('empty list returns the current index unchanged', () => {
    expect(computeNextNavIndex(0, 0, 1, 0, 1, true)).toBe(0);
  });

  test('single item always stays at 0', () => {
    expect(computeNextNavIndex(0, 0, 1, 1, 1, true)).toBe(0);
    expect(computeNextNavIndex(0, 0, -1, 1, 1, true)).toBe(0);
    expect(computeNextNavIndex(0, 1, 0, 1, 3, true)).toBe(0);
  });
});

describe('resolveHorizontalNav', () => {
  test('multi-column layouts always use grid navigation', () => {
    expect(resolveHorizontalNav(2, false)).toBe('grid');
    expect(resolveHorizontalNav(7, true)).toBe('grid');
  });

  test('single-column item with a horizontal handler routes to the item', () => {
    expect(resolveHorizontalNav(1, true)).toBe('item');
  });

  test('single-column item without a handler ignores horizontal input', () => {
    expect(resolveHorizontalNav(1, false)).toBe('none');
  });
});
