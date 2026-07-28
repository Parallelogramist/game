import Phaser from 'phaser';
import { STAGES } from '../data/Stages';
import { EDGE_DIRECTIONS, EdgeKind, directionDelta, edgeIdFor } from '../world/worldTypes';
import type { WorldMap } from '../world/worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH, sectorOfWorldPoint } from '../world/worldSpace';
import { EdgeFlags, SectorFlags } from '../expedition/DiscoveryTypes';
import { gateGlyphFor } from '../expedition/gateGlyphs';
import { edgeAnchor, sectorCellRect, worldPointToMap } from './mapProjection';
import type { MapViewTransform } from './mapProjection';

const UNVISITED_FILL = 0x141d2c;
const UNVISITED_STROKE = 0x3b4d6b;
const VISITED_STROKE = 0x7fd4ff;
const VISITED_FILL_ALPHA = 0.35;
const CLEARED_NOTCH = 0x9dffb0;
const PLAYER_MARKER = 0x66ccff;
const FALLBACK_TINT = 0x2a3a52;

const DASH_LENGTH = 5;
const DASH_GAP = 4;

const BIOME_TINTS = new Map<string, number>(STAGES.map(stage => [stage.id, stage.gridPulseColor]));

export interface SectorMapDrawInput {
  map: WorldMap;
  view: MapViewTransform;
  panelWidth: number;
  panelHeight: number;
  sectorFlagsOf: (sectorKey: string) => number;
  edgeFlagsOf: (edgeId: string) => number;
  playerWorldX: number;
  playerWorldY: number;
  playerFacing: number;
}

/**
 * Draws the world map into one Graphics object. Stateless between frames apart from the
 * edge-dedup set: every border is reachable from both of its sectors, and drawing a door
 * twice doubles the alpha on a translucent glyph.
 */
export class SectorMapRenderer {
  private readonly drawnEdges = new Set<string>();

  constructor(private readonly graphics: Phaser.GameObjects.Graphics) {}

  draw(input: SectorMapDrawInput): void {
    const { graphics } = this;
    graphics.clear();
    this.drawnEdges.clear();

    for (const sector of input.map.sectors.values()) {
      const flags = input.sectorFlagsOf(sector.key);
      if (flags === 0) continue;               // Unknown draws nothing: the void is the invitation.
      const cell = sectorCellRect(sector.sx, sector.sy, input.view);
      if (cell.x + cell.width < 0 || cell.y + cell.height < 0) continue;
      if (cell.x > input.panelWidth || cell.y > input.panelHeight) continue;

      if ((flags & SectorFlags.VISITED) !== 0) {
        const tint = BIOME_TINTS.get(sector.biomeId) ?? FALLBACK_TINT;
        graphics.fillStyle(tint, VISITED_FILL_ALPHA);
        graphics.fillRect(cell.x, cell.y, cell.width, cell.height);
        graphics.lineStyle(1.5, VISITED_STROKE, 1);
        graphics.strokeRect(cell.x, cell.y, cell.width, cell.height);
      } else {
        graphics.fillStyle(UNVISITED_FILL, 1);
        graphics.fillRect(cell.x, cell.y, cell.width, cell.height);
        graphics.lineStyle(1, UNVISITED_STROKE, 1);
        this.strokeDashedRect(cell.x, cell.y, cell.width, cell.height);
      }

      if ((flags & SectorFlags.CLEARED_ONCE) !== 0) {
        const notch = Math.max(3, 5 * input.view.scale);
        graphics.fillStyle(CLEARED_NOTCH, 1);
        graphics.fillTriangle(
          cell.x + cell.width - notch, cell.y,
          cell.x + cell.width, cell.y,
          cell.x + cell.width, cell.y + notch,
        );
      }

      this.drawDoors(sector.sx, sector.sy, input);
    }

    this.drawPlayerMarker(input);
  }

  private drawDoors(sx: number, sy: number, input: SectorMapDrawInput): void {
    const sector = input.map.sectors.get(`${sx},${sy}`);
    if (!sector) return;
    for (const direction of EDGE_DIRECTIONS) {
      const edge = sector.edges[direction];
      if (edge.kind === EdgeKind.Wall) continue;
      const edgeId = edgeIdFor(sx, sy, direction);
      if (this.drawnEdges.has(edgeId)) continue;
      if ((input.edgeFlagsOf(edgeId) & EdgeFlags.KNOWN) === 0) continue;
      const { dsx, dsy } = directionDelta(direction);
      const anchor = edgeAnchor(sx, sy, sx + dsx, sy + dsy, input.view);
      if (!anchor) continue;
      this.drawnEdges.add(edgeId);
      this.drawGlyph(edge.kind, anchor.x, anchor.y, anchor.horizontalWall, input.view.scale);
    }
  }

  private drawGlyph(
    kind: EdgeKind, x: number, y: number, horizontalWall: boolean, scale: number,
  ): void {
    const glyph = gateGlyphFor(kind);
    if (glyph.shape === 'none') return;
    const size = Math.max(3, 5 * scale);
    const graphics = this.graphics;
    graphics.lineStyle(2, glyph.color, 1);
    graphics.fillStyle(glyph.color, 1);

    switch (glyph.shape) {
      case 'gap':
        if (horizontalWall) graphics.lineBetween(x - size, y, x + size, y);
        else graphics.lineBetween(x, y - size, x, y + size);
        break;
      case 'diamond':
        graphics.strokePoints([
          { x, y: y - size }, { x: x + size, y }, { x, y: y + size }, { x: x - size, y },
        ], true);
        break;
      case 'key':
        graphics.strokeCircle(x, y, size * 0.6);
        if (horizontalWall) graphics.lineBetween(x, y + size * 0.6, x, y + size * 1.4);
        else graphics.lineBetween(x + size * 0.6, y, x + size * 1.4, y);
        break;
      case 'crack':
        if (horizontalWall) {
          graphics.strokePoints([
            { x: x - size, y }, { x: x - size * 0.3, y: y - size * 0.5 },
            { x: x + size * 0.3, y: y + size * 0.5 }, { x: x + size, y },
          ], false);
        } else {
          graphics.strokePoints([
            { x, y: y - size }, { x: x - size * 0.5, y: y - size * 0.3 },
            { x: x + size * 0.5, y: y + size * 0.3 }, { x, y: y + size },
          ], false);
        }
        break;
      case 'chevron':
        if (horizontalWall) {
          graphics.lineBetween(x - size, y - size * 0.5, x, y + size * 0.5);
          graphics.lineBetween(x + size, y - size * 0.5, x, y + size * 0.5);
        } else {
          graphics.lineBetween(x - size * 0.5, y - size, x + size * 0.5, y);
          graphics.lineBetween(x - size * 0.5, y + size, x + size * 0.5, y);
        }
        break;
    }
  }

  private drawPlayerMarker(input: SectorMapDrawInput): void {
    const sector = sectorOfWorldPoint(input.playerWorldX, input.playerWorldY);
    const point = worldPointToMap(
      sector.col, sector.row,
      input.playerWorldX - sector.col * SECTOR_WIDTH,
      input.playerWorldY - sector.row * SECTOR_HEIGHT,
      SECTOR_WIDTH, SECTOR_HEIGHT, input.view,
    );
    const facing = Number.isFinite(input.playerFacing) ? input.playerFacing : 0;
    const nose = Math.max(6, 8 * input.view.scale);
    const tail = nose * 0.6;
    const corner = facing + Math.PI * 0.78;
    this.graphics.fillStyle(PLAYER_MARKER, 1);
    this.graphics.fillTriangle(
      point.x + Math.cos(facing) * nose, point.y + Math.sin(facing) * nose,
      point.x + Math.cos(corner) * tail, point.y + Math.sin(corner) * tail,
      point.x + Math.cos(facing - Math.PI * 0.78) * tail,
      point.y + Math.sin(facing - Math.PI * 0.78) * tail,
    );
  }

  private strokeDashedRect(x: number, y: number, width: number, height: number): void {
    this.dashedLine(x, y, x + width, y);
    this.dashedLine(x + width, y, x + width, y + height);
    this.dashedLine(x + width, y + height, x, y + height);
    this.dashedLine(x, y + height, x, y);
  }

  private dashedLine(x1: number, y1: number, x2: number, y2: number): void {
    const spanX = x2 - x1;
    const spanY = y2 - y1;
    const length = Math.hypot(spanX, spanY);
    if (length <= 0) return;
    const stepX = spanX / length;
    const stepY = spanY / length;
    for (let travelled = 0; travelled < length; travelled += DASH_LENGTH + DASH_GAP) {
      const end = Math.min(travelled + DASH_LENGTH, length);
      this.graphics.lineBetween(
        x1 + stepX * travelled, y1 + stepY * travelled,
        x1 + stepX * end, y1 + stepY * end,
      );
    }
  }
}
