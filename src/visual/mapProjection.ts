/**
 * mapProjection: pure math for the expedition world-map screen.
 *
 * A deliberate sibling of minimapProjection rather than an extension of it: the radar is
 * player-centred polar math with two stable consumers, and this is sector-grid space to
 * panel space with pan, zoom and clamping. The only concept they share is one multiply.
 *
 * Panel space is the map viewport in scene pixels, origin at its top-left. A view is the
 * panel-space position of grid cell (0,0)'s top-left corner plus a zoom factor, so panning
 * is one add and zooming is one multiply. Phaser-free: SectorMapRenderer owns the drawing.
 */

/** Panel-space placement of the sector grid. originX/originY locate cell (0,0)'s corner. */
export interface MapViewTransform { originX: number; originY: number; scale: number }

/** Inclusive integer bounding box over sector grid coordinates. */
export interface GridBounds { minGX: number; minGY: number; maxGX: number; maxGY: number }

export interface GridCell { gridX: number; gridY: number }

/** 64x36 is 16:9, the sector's own aspect, so the map never lies about room shape. */
export const MAP_BASE_CELL_WIDTH = 64;
export const MAP_BASE_CELL_HEIGHT = 36;

export const MAP_ZOOM_LEVELS = [0.5, 1, 2] as const;
export const MAP_DEFAULT_ZOOM_INDEX = 1;

/** Nearest legal zoom level. A tie or a non-finite input takes the lower/default level. */
export function snapZoomLevel(scale: number): number {
  if (!Number.isFinite(scale)) return MAP_ZOOM_LEVELS[MAP_DEFAULT_ZOOM_INDEX];
  let best: number = MAP_ZOOM_LEVELS[0];
  let bestDistance = Math.abs(scale - best);
  for (const level of MAP_ZOOM_LEVELS) {
    const distance = Math.abs(scale - level);
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

export function sectorCellRect(
  gridX: number, gridY: number, view: MapViewTransform,
): { x: number; y: number; width: number; height: number } {
  const width = MAP_BASE_CELL_WIDTH * view.scale;
  const height = MAP_BASE_CELL_HEIGHT * view.scale;
  return {
    x: view.originX + gridX * width,
    y: view.originY + gridY * height,
    width,
    height,
  };
}

/** A world point, given as its sector cell plus a sector-local offset, in panel space. */
export function worldPointToMap(
  gridX: number, gridY: number,
  localX: number, localY: number,
  sectorWidth: number, sectorHeight: number,
  view: MapViewTransform,
): { x: number; y: number } {
  const cell = sectorCellRect(gridX, gridY, view);
  const usable = Number.isFinite(localX) && Number.isFinite(localY)
    && sectorWidth > 0 && sectorHeight > 0;
  if (!usable) return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
  return {
    x: cell.x + (localX / sectorWidth) * cell.width,
    y: cell.y + (localY / sectorHeight) * cell.height,
  };
}

/** Put one cell's centre at the panel's centre, at the nearest legal zoom. */
export function centerViewOn(
  gridX: number, gridY: number, scale: number,
  panelWidth: number, panelHeight: number,
): MapViewTransform {
  const snapped = snapZoomLevel(scale);
  const cellWidth = MAP_BASE_CELL_WIDTH * snapped;
  const cellHeight = MAP_BASE_CELL_HEIGHT * snapped;
  const safeGridX = Number.isFinite(gridX) ? gridX : 0;
  const safeGridY = Number.isFinite(gridY) ? gridY : 0;
  const safeWidth = Number.isFinite(panelWidth) ? panelWidth : 0;
  const safeHeight = Number.isFinite(panelHeight) ? panelHeight : 0;
  return {
    originX: safeWidth / 2 - (safeGridX + 0.5) * cellWidth,
    originY: safeHeight / 2 - (safeGridY + 0.5) * cellHeight,
    scale: snapped,
  };
}

/**
 * Make a candidate view legal: snap the zoom, then stop the pan before the known world can
 * leave the panel entirely. At least one cell's worth of the box stays on screen on every
 * side, so a player who over-pans always has something to pan back to.
 */
export function clampMapView(
  view: MapViewTransform, discoveredBounds: GridBounds,
  panelWidth: number, panelHeight: number,
): MapViewTransform {
  const scale = snapZoomLevel(view.scale);
  const boundsFinite = Number.isFinite(discoveredBounds.minGX)
    && Number.isFinite(discoveredBounds.minGY)
    && Number.isFinite(discoveredBounds.maxGX)
    && Number.isFinite(discoveredBounds.maxGY);
  const bounds = boundsFinite ? discoveredBounds : { minGX: 0, minGY: 0, maxGX: 0, maxGY: 0 };
  const centeredDefault = (): MapViewTransform => centerViewOn(
    (bounds.minGX + bounds.maxGX) / 2, (bounds.minGY + bounds.maxGY) / 2,
    scale, panelWidth, panelHeight,
  );
  if (!Number.isFinite(view.originX) || !Number.isFinite(view.originY)) return centeredDefault();
  if (!Number.isFinite(panelWidth) || !Number.isFinite(panelHeight)) return centeredDefault();

  const cellWidth = MAP_BASE_CELL_WIDTH * scale;
  const cellHeight = MAP_BASE_CELL_HEIGHT * scale;
  const contentWidth = (bounds.maxGX - bounds.minGX + 1) * cellWidth;
  const contentHeight = (bounds.maxGY - bounds.minGY + 1) * cellHeight;

  const axis = (
    origin: number, minG: number, contentSize: number, cellSize: number, panelSize: number,
  ): number => {
    const left = origin + minG * cellSize;
    const keep = Math.min(contentSize, cellSize);
    const minLeft = keep - contentSize;
    const maxLeft = panelSize - keep;
    const clampedLeft = minLeft > maxLeft
      ? (panelSize - contentSize) / 2
      : Math.min(Math.max(left, minLeft), maxLeft);
    return clampedLeft - minG * cellSize;
  };

  return {
    originX: axis(view.originX, bounds.minGX, contentWidth, cellWidth, panelWidth),
    originY: axis(view.originY, bounds.minGY, contentHeight, cellHeight, panelHeight),
    scale,
  };
}

/**
 * Panel-space midpoint of the wall two orthogonally adjacent cells share, and whether that
 * wall runs horizontally. Null for any other pair: a door needs one shared border.
 */
export function edgeAnchor(
  aGridX: number, aGridY: number, bGridX: number, bGridY: number, view: MapViewTransform,
): { x: number; y: number; horizontalWall: boolean } | null {
  const deltaX = bGridX - aGridX;
  const deltaY = bGridY - aGridY;
  if (Math.abs(deltaX) + Math.abs(deltaY) !== 1) return null;
  const cell = sectorCellRect(aGridX, aGridY, view);
  if (deltaY === 0) {
    return {
      x: deltaX > 0 ? cell.x + cell.width : cell.x,
      y: cell.y + cell.height / 2,
      horizontalWall: false,
    };
  }
  return {
    x: cell.x + cell.width / 2,
    y: deltaY > 0 ? cell.y + cell.height : cell.y,
    horizontalWall: true,
  };
}

/** Inclusive bounding box over a cell list, or null when there is nothing to bound. */
export function gridBoundsOfCells(cells: ReadonlyArray<GridCell>): GridBounds | null {
  let bounds: GridBounds | null = null;
  for (const cell of cells) {
    if (!Number.isFinite(cell.gridX) || !Number.isFinite(cell.gridY)) continue;
    if (!bounds) {
      bounds = { minGX: cell.gridX, minGY: cell.gridY, maxGX: cell.gridX, maxGY: cell.gridY };
      continue;
    }
    if (cell.gridX < bounds.minGX) bounds.minGX = cell.gridX;
    if (cell.gridX > bounds.maxGX) bounds.maxGX = cell.gridX;
    if (cell.gridY < bounds.minGY) bounds.minGY = cell.gridY;
    if (cell.gridY > bounds.maxGY) bounds.maxGY = cell.gridY;
  }
  return bounds;
}
