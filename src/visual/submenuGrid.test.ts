import { describe, it, expect } from 'vitest';
import { computeSubmenuGrid } from './submenuGrid';

const base = { hudScale: 1, reservedHeight: 160 };

describe('computeSubmenuGrid', () => {
  it('stacks a portrait viewport into a single column', () => {
    const grid = computeSubmenuGrid({
      ...base, entryCount: 5, viewportWidth: 720, viewportHeight: 1280,
    });
    expect(grid.columns).toBe(1);
    expect(grid.rows).toBe(5);
  });

  it('packs a landscape viewport into at most three columns', () => {
    const grid = computeSubmenuGrid({
      ...base, entryCount: 5, viewportWidth: 1280, viewportHeight: 720,
    });
    expect(grid.columns).toBe(3);
    expect(grid.rows).toBe(2);
  });

  it('never opens more columns than it has entries', () => {
    const grid = computeSubmenuGrid({
      ...base, entryCount: 2, viewportWidth: 1280, viewportHeight: 720,
    });
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(1);
  });

  it('grows the row height with density so a phone row stays finger-sized', () => {
    const grid = computeSubmenuGrid({
      entryCount: 5, viewportWidth: 720, viewportHeight: 1280,
      hudScale: 2, reservedHeight: 200,
    });
    expect(grid.rowHeight).toBe(128);
  });

  it('shrinks rows to fit a viewport with little vertical room', () => {
    const grid = computeSubmenuGrid({
      entryCount: 5, viewportWidth: 720, viewportHeight: 1280,
      hudScale: 1, reservedHeight: 1000,
    });
    expect(grid.rowHeight).toBeLessThan(64);
    expect(grid.gridHeight).toBe(256);
  });

  it('keeps the grid inside the viewport width', () => {
    for (const entryCount of [1, 3, 5, 9]) {
      const grid = computeSubmenuGrid({
        ...base, entryCount, viewportWidth: 720, viewportHeight: 1280,
      });
      expect(grid.gridWidth).toBeLessThanOrEqual(720 - 48);
    }
  });
});
