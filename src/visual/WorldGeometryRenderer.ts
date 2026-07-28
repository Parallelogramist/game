import Phaser from 'phaser';
import { DepthLayers } from './DepthLayers';
import { WORLD_GEOMETRY_COLORS } from './NeonColors';
import {
  SECTOR_TILE_COLS,
  SECTOR_TILE_ROWS,
  TILE_SIZE,
  TileKind,
  tileIndex,
} from '../world/worldTypes';
import type { SectorDef, WorldMap } from '../world/worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from '../world/worldSpace';
import type { WorldRect } from '../world/worldSpace';

interface TileStyle {
  fill: number;
  stroke: number;
}

const OUTLINE_WIDTH = 2;
const OUTLINE_ALPHA = 0.9;

function styleOf(tileKind: number): TileStyle | null {
  switch (tileKind) {
    case TileKind.Solid: return WORLD_GEOMETRY_COLORS.solid;
    case TileKind.Breakable: return WORLD_GEOMETRY_COLORS.breakable;
    case TileKind.GateClosed: return WORLD_GEOMETRY_COLORS.gate;
    default: return null;
  }
}

/**
 * Draws the expedition world's blocking tiles. HazardFloor is deliberately not drawn:
 * it does not block anything and has no behaviour until FEAT-BARRIER-GATES, and a
 * painted floor that does nothing is a promise the game does not keep. Ungenerated
 * space is not drawn either: every reachable tile is enclosed by a sector's own border
 * ring, so the void is unreachable and filling it would only hide the lattice.
 */
export class WorldGeometryRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly world: WorldMap;
  private drawnMinCol = Number.NaN;
  private drawnMinRow = Number.NaN;
  private drawnMaxCol = Number.NaN;
  private drawnMaxRow = Number.NaN;

  constructor(scene: Phaser.Scene, world: WorldMap) {
    this.world = world;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(DepthLayers.WORLD_GEOMETRY);
  }

  /** Redraws only when the camera has moved onto a different set of sectors. */
  update(view: WorldRect): void {
    const minCol = Math.floor(view.minX / SECTOR_WIDTH);
    const maxCol = Math.floor((view.maxX - 1) / SECTOR_WIDTH);
    const minRow = Math.floor(view.minY / SECTOR_HEIGHT);
    const maxRow = Math.floor((view.maxY - 1) / SECTOR_HEIGHT);
    if (minCol === this.drawnMinCol && maxCol === this.drawnMaxCol
      && minRow === this.drawnMinRow && maxRow === this.drawnMaxRow) {
      return;
    }
    this.drawnMinCol = minCol;
    this.drawnMaxCol = maxCol;
    this.drawnMinRow = minRow;
    this.drawnMaxRow = maxRow;

    this.graphics.clear();
    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        const sector = this.world.sectors.get(`${col},${row}`);
        if (sector) this.drawSector(sector);
      }
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private drawSector(sector: SectorDef): void {
    const originX = sector.sx * SECTOR_WIDTH;
    const originY = sector.sy * SECTOR_HEIGHT;
    this.fillSector(sector, originX, originY);
    this.outlineSector(sector, originX, originY);
  }

  /** One rect per horizontal run of same-kind tiles, so a wall is a few draws, not 576. */
  private fillSector(sector: SectorDef, originX: number, originY: number): void {
    for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) {
      let runStart = -1;
      let runKind = -1;
      for (let tileX = 0; tileX <= SECTOR_TILE_COLS; tileX++) {
        const kind = tileX < SECTOR_TILE_COLS
          ? sector.tiles[tileIndex(tileX, tileY)]
          : -1;
        const style = styleOf(kind);
        if (runStart !== -1 && (style === null || kind !== runKind)) {
          const runStyle = styleOf(runKind);
          if (runStyle) {
            this.graphics.fillStyle(runStyle.fill, 1);
            this.graphics.fillRect(
              originX + runStart * TILE_SIZE,
              originY + tileY * TILE_SIZE,
              (tileX - runStart) * TILE_SIZE,
              TILE_SIZE,
            );
          }
          runStart = -1;
          runKind = -1;
        }
        if (style !== null && runStart === -1) {
          runStart = tileX;
          runKind = kind;
        }
      }
    }
  }

  /** Only faces that touch something non-blocking, so a wall mass reads as one shape. */
  private outlineSector(sector: SectorDef, originX: number, originY: number): void {
    const globalOriginX = sector.sx * SECTOR_TILE_COLS;
    const globalOriginY = sector.sy * SECTOR_TILE_ROWS;
    for (let tileY = 0; tileY < SECTOR_TILE_ROWS; tileY++) {
      for (let tileX = 0; tileX < SECTOR_TILE_COLS; tileX++) {
        const style = styleOf(sector.tiles[tileIndex(tileX, tileY)]);
        if (!style) continue;
        const globalX = globalOriginX + tileX;
        const globalY = globalOriginY + tileY;
        const left = originX + tileX * TILE_SIZE;
        const top = originY + tileY * TILE_SIZE;
        this.graphics.lineStyle(OUTLINE_WIDTH, style.stroke, OUTLINE_ALPHA);
        if (!this.blocksAt(globalX, globalY - 1)) {
          this.graphics.lineBetween(left, top, left + TILE_SIZE, top);
        }
        if (!this.blocksAt(globalX, globalY + 1)) {
          this.graphics.lineBetween(left, top + TILE_SIZE, left + TILE_SIZE, top + TILE_SIZE);
        }
        if (!this.blocksAt(globalX - 1, globalY)) {
          this.graphics.lineBetween(left, top, left, top + TILE_SIZE);
        }
        if (!this.blocksAt(globalX + 1, globalY)) {
          this.graphics.lineBetween(left + TILE_SIZE, top, left + TILE_SIZE, top + TILE_SIZE);
        }
      }
    }
  }

  private blocksAt(globalTileX: number, globalTileY: number): boolean {
    const sx = Math.floor(globalTileX / SECTOR_TILE_COLS);
    const sy = Math.floor(globalTileY / SECTOR_TILE_ROWS);
    const sector = this.world.sectors.get(`${sx},${sy}`);
    if (!sector) return false;
    const localX = globalTileX - sx * SECTOR_TILE_COLS;
    const localY = globalTileY - sy * SECTOR_TILE_ROWS;
    return styleOf(sector.tiles[tileIndex(localX, localY)]) !== null;
  }
}
