import { describe, test, expect } from 'vitest';
import {
  centerViewOn,
  clampMapView,
  edgeAnchor,
  gridBoundsOfCells,
  sectorCellRect,
  snapZoomLevel,
  worldPointToMap,
} from './mapProjection';
import type { GridBounds, MapViewTransform } from './mapProjection';

const ORIGIN_VIEW: MapViewTransform = { originX: 0, originY: 0, scale: 1 };
const PANEL_WIDTH = 640;
const PANEL_HEIGHT = 360;
const BOUNDS: GridBounds = { minGX: 0, minGY: 0, maxGX: 3, maxGY: 2 };

describe('snapZoomLevel', () => {
  test('an exact level snaps to itself', () => {
    expect(snapZoomLevel(1)).toBe(1);
    expect(snapZoomLevel(0.5)).toBe(0.5);
  });

  test('an in-between scale snaps to the nearest level', () => {
    expect(snapZoomLevel(0.6)).toBe(0.5);
    expect(snapZoomLevel(1.6)).toBe(2);
    expect(snapZoomLevel(0.9)).toBe(1);
  });

  test('a non-finite scale falls back to the default level', () => {
    expect(snapZoomLevel(NaN)).toBe(1);
    expect(snapZoomLevel(Infinity)).toBe(1);
  });
});

describe('sectorCellRect', () => {
  test('a cell is the base size at zoom 1, offset by the origin', () => {
    const view: MapViewTransform = { originX: 100, originY: 50, scale: 1 };
    expect(sectorCellRect(0, 0, view)).toEqual({ x: 100, y: 50, width: 64, height: 36 });
    expect(sectorCellRect(2, 1, view)).toEqual({ x: 228, y: 86, width: 64, height: 36 });
  });

  test('zoom scales the cell and its offset together', () => {
    const view: MapViewTransform = { originX: 0, originY: 0, scale: 2 };
    expect(sectorCellRect(1, 1, view)).toEqual({ x: 128, y: 72, width: 128, height: 72 });
  });
});

describe('worldPointToMap', () => {
  test('a sector-centre offset maps to the cell centre', () => {
    expect(worldPointToMap(0, 0, 640, 360, 1280, 720, ORIGIN_VIEW)).toEqual({ x: 32, y: 18 });
  });

  test('a non-finite local offset falls back to the cell centre', () => {
    expect(worldPointToMap(1, 0, NaN, 0, 1280, 720, ORIGIN_VIEW)).toEqual({ x: 96, y: 18 });
  });
});

describe('centerViewOn', () => {
  test('puts the named cell centre at the panel centre', () => {
    const view = centerViewOn(0, 0, 1, PANEL_WIDTH, PANEL_HEIGHT);
    expect(view).toEqual({ originX: 288, originY: 162, scale: 1 });
    const cell = sectorCellRect(0, 0, view);
    expect(cell.x + cell.width / 2).toBe(320);
    expect(cell.y + cell.height / 2).toBe(180);
  });

  test('snaps an illegal zoom before centring', () => {
    expect(centerViewOn(0, 0, 3.3, PANEL_WIDTH, PANEL_HEIGHT).scale).toBe(2);
  });
});

describe('clampMapView', () => {
  test('a view already showing the whole box is left alone', () => {
    const view = centerViewOn(1.5, 1, 1, PANEL_WIDTH, PANEL_HEIGHT);
    const clamped = clampMapView(view, BOUNDS, PANEL_WIDTH, PANEL_HEIGHT);
    expect(clamped.originX).toBeCloseTo(view.originX);
    expect(clamped.originY).toBeCloseTo(view.originY);
  });

  test('panning far left stops with one cell still on screen', () => {
    const clamped = clampMapView(
      { originX: -100000, originY: 0, scale: 1 }, BOUNDS, PANEL_WIDTH, PANEL_HEIGHT,
    );
    expect(clamped.originX + (BOUNDS.maxGX + 1) * 64).toBe(64);
  });

  test('panning far right stops with one cell still on screen', () => {
    const clamped = clampMapView(
      { originX: 100000, originY: 0, scale: 1 }, BOUNDS, PANEL_WIDTH, PANEL_HEIGHT,
    );
    expect(clamped.originX + BOUNDS.minGX * 64).toBe(576);
  });

  test('panning far up stops with one cell still on screen', () => {
    const clamped = clampMapView(
      { originX: 0, originY: -100000, scale: 1 }, BOUNDS, PANEL_WIDTH, PANEL_HEIGHT,
    );
    expect(clamped.originY + (BOUNDS.maxGY + 1) * 36).toBe(36);
  });

  test('panning far down stops with one cell still on screen', () => {
    const clamped = clampMapView(
      { originX: 0, originY: 100000, scale: 1 }, BOUNDS, PANEL_WIDTH, PANEL_HEIGHT,
    );
    expect(clamped.originY + BOUNDS.minGY * 36).toBe(324);
  });

  test('a non-finite origin collapses to a centred default', () => {
    const clamped = clampMapView(
      { originX: NaN, originY: 0, scale: 1 }, BOUNDS, PANEL_WIDTH, PANEL_HEIGHT,
    );
    expect(clamped).toEqual(centerViewOn(1.5, 1, 1, PANEL_WIDTH, PANEL_HEIGHT));
  });
});

describe('edgeAnchor', () => {
  test('an east neighbour anchors on the vertical shared wall', () => {
    expect(edgeAnchor(0, 0, 1, 0, ORIGIN_VIEW)).toEqual({ x: 64, y: 18, horizontalWall: false });
  });

  test('a south neighbour anchors on the horizontal shared wall', () => {
    expect(edgeAnchor(0, 0, 0, 1, ORIGIN_VIEW)).toEqual({ x: 32, y: 36, horizontalWall: true });
  });

  test('cells that share no border have no anchor', () => {
    expect(edgeAnchor(0, 0, 1, 1, ORIGIN_VIEW)).toBeNull();
    expect(edgeAnchor(0, 0, 2, 0, ORIGIN_VIEW)).toBeNull();
  });
});

describe('gridBoundsOfCells', () => {
  test('covers every cell it is given', () => {
    expect(gridBoundsOfCells([
      { gridX: -2, gridY: 1 }, { gridX: 3, gridY: -4 }, { gridX: 0, gridY: 0 },
    ])).toEqual({ minGX: -2, minGY: -4, maxGX: 3, maxGY: 1 });
  });

  test('an empty list has no bounds', () => {
    expect(gridBoundsOfCells([])).toBeNull();
  });
});
