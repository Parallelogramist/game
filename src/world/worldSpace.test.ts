import { describe, test, expect } from 'vitest';

import {
  SECTOR_WIDTH,
  SECTOR_HEIGHT,
  sectorOfWorldPoint,
  sectorOriginWorld,
  sectorCenterWorld,
  sectorRectWorld,
  sectorsEqual,
  sectorKey,
  parseSectorKey,
  rectWidth,
  rectHeight,
  rectCenter,
  rectContains,
  inflateRect,
  clampPointToRect,
  rectFromScreen,
} from './worldSpace';

describe('sectorOfWorldPoint', () => {
  test('the origin sector covers the first sector-sized rect', () => {
    expect(sectorOfWorldPoint(0, 0)).toEqual({ col: 0, row: 0 });
    expect(sectorOfWorldPoint(SECTOR_WIDTH - 1, SECTOR_HEIGHT - 1)).toEqual({ col: 0, row: 0 });
  });

  test('a point exactly on a boundary belongs to the higher sector', () => {
    expect(sectorOfWorldPoint(SECTOR_WIDTH, SECTOR_HEIGHT)).toEqual({ col: 1, row: 1 });
  });

  test('negative coordinates floor away from zero rather than truncating toward it', () => {
    expect(sectorOfWorldPoint(-1, -1)).toEqual({ col: -1, row: -1 });
    expect(sectorOfWorldPoint(-SECTOR_WIDTH, -SECTOR_HEIGHT)).toEqual({ col: -1, row: -1 });
    expect(sectorOfWorldPoint(-SECTOR_WIDTH - 1, -SECTOR_HEIGHT - 1)).toEqual({ col: -2, row: -2 });
  });
});

describe('sector rects', () => {
  test('origin, centre and rect agree for a negative sector', () => {
    const sector = { col: -2, row: 3 };
    expect(sectorOriginWorld(sector)).toEqual({ x: -2560, y: 2160 });
    expect(sectorCenterWorld(sector)).toEqual({ x: -1920, y: 2520 });
    expect(sectorRectWorld(sector)).toEqual({ minX: -2560, minY: 2160, maxX: -1280, maxY: 2880 });
  });

  test('a sector rect maps back to its own sector everywhere but its far edges', () => {
    const sector = { col: 4, row: -1 };
    const rect = sectorRectWorld(sector);
    expect(sectorOfWorldPoint(rect.minX, rect.minY)).toEqual(sector);
    expect(sectorOfWorldPoint(rect.maxX - 1, rect.maxY - 1)).toEqual(sector);
    expect(sectorsEqual(sectorOfWorldPoint(rect.maxX, rect.maxY), sector)).toBe(false);
  });
});

describe('sectorKey', () => {
  test('round-trips negative coordinates', () => {
    for (const sector of [{ col: 0, row: 0 }, { col: -3, row: 7 }, { col: 12, row: -9 }]) {
      expect(parseSectorKey(sectorKey(sector))).toEqual(sector);
    }
  });

  test('rejects malformed keys instead of returning a NaN sector', () => {
    for (const bad of ['', '1', '1,2,3', 'a,b', '1.5,2', ' 1,2', '1, 2', 'NaN,0', '1,']) {
      expect(parseSectorKey(bad)).toBeNull();
    }
  });
});

describe('rect helpers', () => {
  const rect = rectFromScreen(1280, 720);

  test('rectFromScreen is the arena rect', () => {
    expect(rect).toEqual({ minX: 0, minY: 0, maxX: 1280, maxY: 720 });
    expect(rectWidth(rect)).toBe(1280);
    expect(rectHeight(rect)).toBe(720);
    expect(rectCenter(rect)).toEqual({ x: 640, y: 360 });
  });

  test('containment is half-open: the min edge is inside, the max edge is not', () => {
    expect(rectContains(rect, 0, 0)).toBe(true);
    expect(rectContains(rect, 1279.9, 719.9)).toBe(true);
    expect(rectContains(rect, 1280, 360)).toBe(false);
    expect(rectContains(rect, 640, 720)).toBe(false);
    expect(rectContains(rect, -0.1, 360)).toBe(false);
  });

  test('inflate grows every side and a negative margin shrinks', () => {
    expect(inflateRect(rect, 50)).toEqual({ minX: -50, minY: -50, maxX: 1330, maxY: 770 });
    expect(inflateRect(rect, -50)).toEqual({ minX: 50, minY: 50, maxX: 1230, maxY: 670 });
  });

  test('clamping pulls an outside point onto the padded rect and leaves an inside one', () => {
    expect(clampPointToRect(-100, 900, rect, 20)).toEqual({ x: 20, y: 700 });
    expect(clampPointToRect(640, 360, rect, 20)).toEqual({ x: 640, y: 360 });
  });

  test('padding wider than the rect collapses that axis to its centre', () => {
    expect(clampPointToRect(0, 0, rect, 700)).toEqual({ x: 640, y: 360 });
  });
});
