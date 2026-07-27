/**
 * worldSpace — the pure coordinate vocabulary for the expedition world.
 *
 * One continuous world plane, partitioned logically into fixed 1280x720 sectors.
 * World space is the only space anything simulates in; sector coordinates are a
 * label over it (generation, discovery, locks) and never a simulation space.
 *
 * Phaser-free on purpose: every world module under src/world/ must stay unit
 * testable without a live scene, and must never reach for a camera to do its own
 * world-to-screen maths. Callers pass a WorldRect instead.
 */

export const SECTOR_WIDTH = 1280;
export const SECTOR_HEIGHT = 720;

/**
 * Hard cap on world extents (2^18 px). f32 holds integers exactly to 2^24, so
 * this preserves 1/32 px sub-pixel precision everywhere in the world plane.
 */
export const WORLD_EXTENT_LIMIT = 262144;

export interface SectorCoord { col: number; row: number }

export interface WorldPoint { x: number; y: number }

/** Half-open axis-aligned rect in world units: [minX, maxX) x [minY, maxY). */
export interface WorldRect { minX: number; minY: number; maxX: number; maxY: number }

const SECTOR_KEY_PATTERN = /^(-?\d+),(-?\d+)$/;

export function sectorOfWorldPoint(worldX: number, worldY: number): SectorCoord {
  return {
    col: Math.floor(worldX / SECTOR_WIDTH),
    row: Math.floor(worldY / SECTOR_HEIGHT),
  };
}

export function sectorOriginWorld(sector: SectorCoord): WorldPoint {
  return { x: sector.col * SECTOR_WIDTH, y: sector.row * SECTOR_HEIGHT };
}

export function sectorCenterWorld(sector: SectorCoord): WorldPoint {
  return {
    x: sector.col * SECTOR_WIDTH + SECTOR_WIDTH / 2,
    y: sector.row * SECTOR_HEIGHT + SECTOR_HEIGHT / 2,
  };
}

export function sectorRectWorld(sector: SectorCoord): WorldRect {
  return {
    minX: sector.col * SECTOR_WIDTH,
    minY: sector.row * SECTOR_HEIGHT,
    maxX: (sector.col + 1) * SECTOR_WIDTH,
    maxY: (sector.row + 1) * SECTOR_HEIGHT,
  };
}

export function sectorsEqual(a: SectorCoord, b: SectorCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Canonical string key, e.g. "3,-1". Save files and Maps key on this. */
export function sectorKey(sector: SectorCoord): string {
  return `${sector.col},${sector.row}`;
}

export function parseSectorKey(key: string): SectorCoord | null {
  const match = SECTOR_KEY_PATTERN.exec(key);
  if (!match) return null;
  return { col: Number(match[1]), row: Number(match[2]) };
}

export function rectWidth(rect: WorldRect): number {
  return rect.maxX - rect.minX;
}

export function rectHeight(rect: WorldRect): number {
  return rect.maxY - rect.minY;
}

export function rectCenter(rect: WorldRect): WorldPoint {
  return { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
}

/** Half-open: a point on minX/minY is inside, a point on maxX/maxY is not. */
export function rectContains(rect: WorldRect, x: number, y: number): boolean {
  return x >= rect.minX && x < rect.maxX && y >= rect.minY && y < rect.maxY;
}

/** Inflate by margin on every side (negative shrinks). */
export function inflateRect(rect: WorldRect, margin: number): WorldRect {
  return {
    minX: rect.minX - margin,
    minY: rect.minY - margin,
    maxX: rect.maxX + margin,
    maxY: rect.maxY + margin,
  };
}

export function clampPointToRect(
  x: number, y: number, rect: WorldRect, padding: number
): WorldPoint {
  return {
    x: clampAxis(x, rect.minX + padding, rect.maxX - padding),
    y: clampAxis(y, rect.minY + padding, rect.maxY - padding),
  };
}

/** The arena/screen rect: (0, 0, width, height). */
export function rectFromScreen(width: number, height: number): WorldRect {
  return { minX: 0, minY: 0, maxX: width, maxY: height };
}

function clampAxis(value: number, lo: number, hi: number): number {
  // Padding wider than the rect would invert the range; collapse to its middle.
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, value));
}
