/**
 * sectorWallSegments: a sector's tile grid reduced to the few lines a radar can draw.
 *
 * The face rule is WorldGeometryRenderer's: a blocking tile emits a face only where its
 * neighbour does not block, so a wall mass reads as one silhouette rather than a grid. The
 * one difference is the sector border. This module sees a single sector, and treating
 * out-of-bounds as open would draw both faces of the one-tile border ring: at radar scale a
 * 40 px tile is 2.5 px, so the two lines would smear into a band. Out-of-bounds therefore
 * counts as blocking and only the ring's inner face is emitted, which is exactly the room
 * outline the radar wants.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS.
 */

import {
  EDGE_DIRECTIONS,
  EdgeKind,
  SECTOR_TILE_COLS,
  SECTOR_TILE_ROWS,
  TILE_SIZE,
  TileKind,
  tileIndex,
} from './worldTypes';
import type { EdgeDirection, SectorDef } from './worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from './worldSpace';

/** One merged run of collinear same-kind tile faces, in sector-local px. */
export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The blocking tile kind that owns the face: Solid, Breakable or GateClosed. */
  kind: TileKind;
}

/** Where a border's aperture sits, and which way is out of the sector. */
export interface SectorDoorAnchor {
  direction: EdgeDirection;
  kind: EdgeKind;
  /** Centre of the aperture, on the border ring's mid-line, in sector-local px. */
  localX: number;
  localY: number;
  /** Unit vector pointing out of the sector through this border. */
  outwardX: number;
  outwardY: number;
}

export interface SectorOutline {
  segments: WallSegment[];
  doors: SectorDoorAnchor[];
}

/** Same predicate as WorldGeometryRenderer.styleOf: Open and HazardFloor do not block. */
export function isOutlineBlocking(tileKind: number): boolean {
  return tileKind === TileKind.Solid
    || tileKind === TileKind.Breakable
    || tileKind === TileKind.GateClosed;
}

interface Run { start: number; end: number }

function pushFace(
  buckets: Map<string, Run[]>, coordinate: number, kind: TileKind, start: number, end: number,
): void {
  const key = `${coordinate}:${kind}`;
  const runs = buckets.get(key);
  if (runs) runs.push({ start, end });
  else buckets.set(key, [{ start, end }]);
}

function mergeRuns(runs: Run[]): Run[] {
  runs.sort((a, b) => a.start - b.start);
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.end === run.start) last.end = run.end;
    else merged.push({ start: run.start, end: run.end });
  }
  return merged;
}

/** Sorted by coordinate then kind so the output order is stable for a given sector. */
function sortedKeys(buckets: Map<string, Run[]>): string[] {
  return [...buckets.keys()].sort((a, b) => {
    const [aCoord, aKind] = a.split(':').map(Number);
    const [bCoord, bKind] = b.split(':').map(Number);
    return aCoord - bCoord || aKind - bKind;
  });
}

function blocksAt(sector: SectorDef, tileX: number, tileY: number): boolean {
  if (tileX < 0 || tileX >= SECTOR_TILE_COLS || tileY < 0 || tileY >= SECTOR_TILE_ROWS) {
    return true;
  }
  return isOutlineBlocking(sector.tiles[tileIndex(tileX, tileY)]);
}

function doorAnchor(sector: SectorDef, direction: EdgeDirection): SectorDoorAnchor | null {
  const edge = sector.edges[direction];
  if (edge.kind === EdgeKind.Wall) return null;
  if (edge.apertureEnd < edge.apertureStart) return null;
  const centre = ((edge.apertureStart + edge.apertureEnd + 1) / 2) * TILE_SIZE;
  const half = TILE_SIZE / 2;
  switch (direction) {
    case 'north':
      return { direction, kind: edge.kind, localX: centre, localY: half, outwardX: 0, outwardY: -1 };
    case 'south':
      return {
        direction, kind: edge.kind, localX: centre, localY: SECTOR_HEIGHT - half,
        outwardX: 0, outwardY: 1,
      };
    case 'west':
      return { direction, kind: edge.kind, localX: half, localY: centre, outwardX: -1, outwardY: 0 };
    case 'east':
      return {
        direction, kind: edge.kind, localX: SECTOR_WIDTH - half, localY: centre,
        outwardX: 1, outwardY: 0,
      };
  }
}

export function sectorWallSegments(sector: SectorDef): SectorOutline {
  const horizontal = new Map<string, Run[]>();
  const vertical = new Map<string, Run[]>();

  for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) {
    for (let tileX = 0; tileX < SECTOR_TILE_COLS; tileX++) {
      const kind = sector.tiles[tileIndex(tileX, tileY)] as TileKind;
      if (!isOutlineBlocking(kind)) continue;
      const left = tileX * TILE_SIZE;
      const top = tileY * TILE_SIZE;
      if (!blocksAt(sector, tileX, tileY - 1)) pushFace(horizontal, top, kind, left, left + TILE_SIZE);
      if (!blocksAt(sector, tileX, tileY + 1)) {
        pushFace(horizontal, top + TILE_SIZE, kind, left, left + TILE_SIZE);
      }
      if (!blocksAt(sector, tileX - 1, tileY)) pushFace(vertical, left, kind, top, top + TILE_SIZE);
      if (!blocksAt(sector, tileX + 1, tileY)) {
        pushFace(vertical, left + TILE_SIZE, kind, top, top + TILE_SIZE);
      }
    }
  }

  const segments: WallSegment[] = [];
  for (const key of sortedKeys(horizontal)) {
    const [y, kind] = key.split(':').map(Number);
    for (const run of mergeRuns(horizontal.get(key)!)) {
      segments.push({ x1: run.start, y1: y, x2: run.end, y2: y, kind });
    }
  }
  for (const key of sortedKeys(vertical)) {
    const [x, kind] = key.split(':').map(Number);
    for (const run of mergeRuns(vertical.get(key)!)) {
      segments.push({ x1: x, y1: run.start, x2: x, y2: run.end, kind });
    }
  }

  const doors: SectorDoorAnchor[] = [];
  for (const direction of EDGE_DIRECTIONS) {
    const anchor = doorAnchor(sector, direction);
    if (anchor) doors.push(anchor);
  }

  return { segments, doors };
}
