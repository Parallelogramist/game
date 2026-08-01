import Phaser from 'phaser';
import { STAGES } from '../data/Stages';
import { EDGE_DIRECTIONS, EdgeKind, PoiKind, TILE_SIZE, directionDelta,
  edgeIdFor } from '../world/worldTypes';
import type { EdgeDef, SectorDef, WorldMap } from '../world/worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH, sectorOfWorldPoint } from '../world/worldSpace';
import { EdgeFlags, PoiFlags, SecretFlags, SectorFlags } from '../expedition/DiscoveryTypes';
import { gateGlyphFor } from '../expedition/gateGlyphs';
import { HAZARD_NEST_GLYPH, poiGlyphFor } from '../expedition/poiGlyphs';
import type { PoiGlyph } from '../expedition/poiGlyphs';
import { WORLD_GEOMETRY_COLORS } from './NeonColors';
import { edgeAnchor, sectorCellRect, worldPointToMap } from './mapProjection';
import type { MapViewTransform } from './mapProjection';

const UNVISITED_FILL = 0x141d2c;
const UNVISITED_STROKE = 0x3b4d6b;
const VISITED_STROKE = 0x7fd4ff;
/** The breakable amber the wall itself and the radar's secret ping already use, so a found
 *  hidden room reads in the same language as the wall that hid it. */
const HIDDEN_FOUND_STROKE = WORLD_GEOMETRY_COLORS.breakable.stroke;
const VISITED_FILL_ALPHA = 0.35;
const CLEARED_NOTCH = 0x9dffb0;
const PLAYER_MARKER = 0x66ccff;
/** The focused-sector cursor. White is the one value no glyph in either table uses, so the
 *  cursor always reads on top of whatever it is bracketing. */
const CURSOR_STROKE = 0xffffff;
/** The objective pin. Rose is the one hue neither glyph table nor any chart stroke uses, so a
 *  pin can never be misread as a POI, a door or a secret. */
export const OBJECTIVE_PIN = 0xff5fa2;
const FALLBACK_TINT = 0x2a3a52;

const DASH_LENGTH = 5;
const DASH_GAP = 4;

/** Doc 03 section 4.4: a COLLECTED point of interest renders at 40% with a check overlay. */
export const COLLECTED_ALPHA = 0.4;
/** The size the legend draws every glyph at, map zoom being irrelevant in a panel row. */
export const LEGEND_GLYPH_SIZE = 5;
/** The hazard orange the world already uses for a sealed, guarded vault core. */
const GUARDED_RING = WORLD_GEOMETRY_COLORS.hazard.stroke;

const BIOME_TINTS = new Map<string, number>(STAGES.map(stage => [stage.id, stage.gridPulseColor]));

/** Shared with the radar underlay so the two map surfaces cannot drift apart. */
export function biomeTintFor(biomeId: string): number {
  return BIOME_TINTS.get(biomeId) ?? FALLBACK_TINT;
}

export function drawGateGlyph(
  graphics: Phaser.GameObjects.Graphics,
  kind: EdgeKind, x: number, y: number, horizontalWall: boolean, size: number,
): void {
  const glyph = gateGlyphFor(kind);
  if (glyph.shape === 'none') return;
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

/**
 * Doc 03 section 4.5 rule 2: locked state is a ring, never a colour swap, so it survives
 * every colourblind pipeline the game ships. A door the profile can already pass carries no
 * ring at all, which is what makes the map a to-do list the moment an ability is claimed.
 */
export function drawGateLockRing(
  graphics: Phaser.GameObjects.Graphics,
  kind: EdgeKind, x: number, y: number, size: number,
): void {
  const glyph = gateGlyphFor(kind);
  graphics.lineStyle(Math.max(1, size * 0.3), glyph.color, 0.85);
  graphics.strokeCircle(x, y, size * 1.8);
}

/**
 * One point of interest, at map scale. Vector shapes rather than the icon atlas doc 03
 * section 4.4 names: the map is a single Graphics cleared on every pan, so atlas sprites
 * would mean creating and destroying a GameObject per slot per redraw. The gate glyphs set
 * this precedent.
 */
export function drawPoiGlyph(
  graphics: Phaser.GameObjects.Graphics,
  kind: PoiKind, x: number, y: number, size: number, alpha: number,
): void {
  drawGlyph(graphics, poiGlyphFor(kind), x, y, size, alpha);
}

/** The profile's memory of a permanent hive, drawn in place of that slot's Cache chest.
 *  Its own entry point rather than a PoiKind, because the kind is Treasure either way. */
export function drawAmbushNestGlyph(
  graphics: Phaser.GameObjects.Graphics,
  x: number, y: number, size: number, alpha: number,
): void {
  drawGlyph(graphics, HAZARD_NEST_GLYPH, x, y, size, alpha);
}

function drawGlyph(
  graphics: Phaser.GameObjects.Graphics,
  glyph: PoiGlyph, x: number, y: number, size: number, alpha: number,
): void {
  if (glyph.shape === 'none') return;
  graphics.lineStyle(Math.max(1, size * 0.4), glyph.color, alpha);
  graphics.fillStyle(glyph.color, alpha);

  switch (glyph.shape) {
    case 'star': {
      const inner = size * 0.45;
      const points: Array<{ x: number; y: number }> = [];
      for (let step = 0; step < 8; step++) {
        const radius = step % 2 === 0 ? size : inner;
        const angle = -Math.PI / 2 + (Math.PI * step) / 4;
        points.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
      }
      graphics.fillPoints(points, true);
      break;
    }
    case 'chest':
      graphics.fillRect(x - size, y - size * 0.7, size * 2, size * 1.4);
      graphics.lineStyle(Math.max(1, size * 0.3), UNVISITED_FILL, alpha);
      graphics.lineBetween(x - size, y, x + size, y);
      break;
    case 'altar':
      graphics.fillTriangle(x, y - size, x + size, y + size * 0.8, x - size, y + size * 0.8);
      break;
    case 'ring':
      graphics.strokeCircle(x, y, size);
      graphics.fillCircle(x, y, Math.max(1, size * 0.35));
      break;
    case 'board':
      graphics.fillRect(x - size, y - size, size * 2, size * 1.3);
      graphics.lineBetween(x - size * 0.5, y + size * 0.3, x - size * 0.5, y + size);
      graphics.lineBetween(x + size * 0.5, y + size * 0.3, x + size * 0.5, y + size);
      break;
    case 'hive': {
      const points: Array<{ x: number; y: number }> = [];
      for (let step = 0; step < 6; step++) {
        const angle = -Math.PI / 2 + (Math.PI * step) / 3;
        points.push({ x: x + Math.cos(angle) * size, y: y + Math.sin(angle) * size });
      }
      graphics.strokePoints(points, true, true);
      graphics.fillCircle(x, y, Math.max(1, size * 0.4));
      break;
    }
  }
}

/** A vault whose placed pack is still standing. The same hazard orange the core itself
 *  reads GUARDED in, so the chart and the room agree. */
export function drawVaultGuardRing(
  graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number,
): void {
  graphics.lineStyle(Math.max(1, size * 0.35), GUARDED_RING, 0.9);
  graphics.strokeCircle(x, y, size * 1.7);
}

/** A door a just-claimed ability or key opened, until the map has been looked at once. Drawn
 *  outside the lock-ring radius in the cleared-green the chart already reads as "done here":
 *  the two rings can never land on one door, since a door keyed to what you just gained is by
 *  definition no longer sealed. */
export function drawNewRouteRing(
  graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number,
): void {
  graphics.lineStyle(Math.max(1, size * 0.35), CLEARED_NOTCH, 1);
  graphics.strokeCircle(x, y, size * 2.4);
}

export function drawCollectedCheck(
  graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number,
): void {
  graphics.lineStyle(Math.max(1, size * 0.35), CLEARED_NOTCH, 1);
  graphics.lineBetween(x - size * 0.6, y, x - size * 0.1, y + size * 0.55);
  graphics.lineBetween(x - size * 0.1, y + size * 0.55, x + size * 0.7, y - size * 0.6);
}

/** Four corner brackets, never a fill: shape rather than colour is this map's standing rule,
 *  and brackets leave the cell's own icons readable underneath. */
export function drawSectorCursor(
  graphics: Phaser.GameObjects.Graphics,
  x: number, y: number, width: number, height: number,
): void {
  const armX = Math.max(4, width * 0.28);
  const armY = Math.max(3, height * 0.28);
  graphics.lineStyle(2, CURSOR_STROKE, 1);
  graphics.lineBetween(x, y, x + armX, y);
  graphics.lineBetween(x, y, x, y + armY);
  graphics.lineBetween(x + width - armX, y, x + width, y);
  graphics.lineBetween(x + width, y, x + width, y + armY);
  graphics.lineBetween(x, y + height - armY, x, y + height);
  graphics.lineBetween(x, y + height, x + armX, y + height);
  graphics.lineBetween(x + width - armX, y + height, x + width, y + height);
  graphics.lineBetween(x + width, y + height - armY, x + width, y + height);
}

/** A wedge pointing down into the cell from its top edge: it sits clear of the CLEARED_ONCE
 *  notch in the top-right corner and the hint badge in the top-left, so a sector can carry all
 *  three at once and still be read. */
export function drawObjectivePin(
  graphics: Phaser.GameObjects.Graphics, centreX: number, topY: number, size: number,
): void {
  graphics.fillStyle(OBJECTIVE_PIN, 1);
  graphics.fillTriangle(
    centreX - size, topY + size * 0.25,
    centreX + size, topY + size * 0.25,
    centreX, topY + size * 1.7,
  );
}

/**
 * Gated kinds only. A door reads sealed until the profile holds what it asks for: a traversal
 * ability for an AbilityDoor, a quest key for a KeyDoor. An edge with no requiredId can never
 * be satisfied by anything, so it always reads sealed.
 */
function isGatedEdgeSealed(
  edge: EdgeDef,
  holdsAbility: (abilityId: string) => boolean,
  holdsQuestKey: (keyId: string) => boolean,
): boolean {
  if (edge.kind !== EdgeKind.AbilityDoor && edge.kind !== EdgeKind.KeyDoor) return false;
  if (edge.requiredId === undefined) return true;
  return edge.kind === EdgeKind.KeyDoor
    ? !holdsQuestKey(edge.requiredId)
    : !holdsAbility(edge.requiredId);
}

export function strokeDashedLine(
  graphics: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number,
): void {
  const spanX = x2 - x1;
  const spanY = y2 - y1;
  const length = Math.hypot(spanX, spanY);
  if (length <= 0) return;
  const stepX = spanX / length;
  const stepY = spanY / length;
  for (let travelled = 0; travelled < length; travelled += DASH_LENGTH + DASH_GAP) {
    const end = Math.min(travelled + DASH_LENGTH, length);
    graphics.lineBetween(
      x1 + stepX * travelled, y1 + stepY * travelled,
      x1 + stepX * end, y1 + stepY * end,
    );
  }
}

export interface SectorMapDrawInput {
  map: WorldMap;
  view: MapViewTransform;
  panelWidth: number;
  panelHeight: number;
  sectorFlagsOf: (sectorKey: string) => number;
  edgeFlagsOf: (edgeId: string) => number;
  /** Sectors carrying a secret the profile has been pointed at but has not found. */
  hintedSectorKeys: ReadonlySet<string>;
  /** Sectors an active place-naming objective points at. Charted keys only: the caller resolves
   *  them against discovery, and an unknown sector draws nothing at all. */
  objectiveSectorKeys: ReadonlySet<string>;
  /** Doors opened by a gain this run and not yet looked at. Empty on every ordinary open. */
  newlyPassableEdgeIds: ReadonlySet<string>;
  /** The sector the readout is describing. Null when nothing is focused. */
  focusedCell: { gridX: number; gridY: number } | null;
  /** Flags for a non-secret POI slot id. Predicate rather than a Map, matching holdsAbility:
   *  the renderer never learns where discovery state is stored. */
  poiFlagsOf: (poiId: string) => number;
  /** Flags for a Secret slot, whose slot id IS the secret id (buildIdUniverse splits them). */
  secretFlagsOf: (secretId: string) => number;
  /** Traversal-ability ownership for this profile. A predicate rather than a Set so the
   *  renderer never learns where ownership is stored. */
  holdsAbility: (abilityId: string) => boolean;
  /** Quest-key ownership, same predicate-not-Set reasoning as holdsAbility. */
  holdsQuestKey: (keyId: string) => boolean;
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
        if (sector.hidden === true) graphics.lineStyle(2.5, HIDDEN_FOUND_STROKE, 1);
        else graphics.lineStyle(1.5, VISITED_STROKE, 1);
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

      // Deliberately the same amber a found hidden room strokes in and the radar ping shimmers
      // in: every secret surface speaks one colour. An undiscovered sector draws nothing at all
      // (the `flags === 0` continue above), so a lead stays a riddle until the region is charted.
      if (input.hintedSectorKeys.has(sector.key)) {
        const badge = Math.max(3, 4.5 * input.view.scale);
        graphics.fillStyle(HIDDEN_FOUND_STROKE, 1);
        graphics.fillCircle(cell.x + badge + 2, cell.y + badge + 2, badge);
      }

      if (input.objectiveSectorKeys.has(sector.key)) {
        drawObjectivePin(graphics, cell.x + cell.width / 2, cell.y,
          Math.max(4, 6 * input.view.scale));
      }

      this.drawPoiIcons(sector, input);
      this.drawDoors(sector.sx, sector.sy, input);
    }

    if (input.focusedCell) {
      const cell = sectorCellRect(input.focusedCell.gridX, input.focusedCell.gridY, input.view);
      drawSectorCursor(graphics, cell.x, cell.y, cell.width, cell.height);
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
      const glyphSize = Math.max(3, 5 * input.view.scale);
      drawGateGlyph(
        this.graphics, edge.kind, anchor.x, anchor.y, anchor.horizontalWall, glyphSize,
      );
      if (isGatedEdgeSealed(edge, input.holdsAbility, input.holdsQuestKey)) {
        drawGateLockRing(this.graphics, edge.kind, anchor.x, anchor.y, glyphSize);
      }
      if (input.newlyPassableEdgeIds.has(edgeId)) {
        drawNewRouteRing(this.graphics, anchor.x, anchor.y, glyphSize);
      }
    }
  }

  private drawPoiIcons(sector: SectorDef, input: SectorMapDrawInput): void {
    const size = Math.max(2, 3 * input.view.scale);
    for (const slot of sector.poiSlots) {
      if (poiGlyphFor(slot.kind).shape === 'none') continue;

      let alpha = 1;
      let collected = false;
      let guarded = false;
      let hive = false;
      if (slot.kind === PoiKind.Secret) {
        // A secret draws only once it is FOUND. HINTED keeps the corner badge and an unfound
        // secret must never leak its position from the chart: that is the whole point of the
        // room, and revealOnSectorEntry skips secret slots for exactly this reason.
        if ((input.secretFlagsOf(slot.id) & SecretFlags.FOUND) === 0) continue;
      } else {
        const flags = input.poiFlagsOf(slot.id);
        if ((flags & PoiFlags.SEEN) === 0) continue;
        hive = (flags & PoiFlags.HAZARD_NEST) !== 0;
        collected = (flags & PoiFlags.COLLECTED) !== 0;
        // Every VAULT_GUARD_PACKS entry is non-empty (pinned by referentialIntegrity.test.ts),
        // so an uncleared vault really does still have its pack standing.
        guarded = slot.kind === PoiKind.AbilityPowerUp && !collected
          && (flags & PoiFlags.GUARD_CLEARED) === 0;
        if (collected) alpha = COLLECTED_ALPHA;
      }

      const point = worldPointToMap(
        sector.sx, sector.sy,
        slot.tileX * TILE_SIZE + TILE_SIZE / 2, slot.tileY * TILE_SIZE + TILE_SIZE / 2,
        SECTOR_WIDTH, SECTOR_HEIGHT, input.view,
      );
      if (hive) {
        drawAmbushNestGlyph(this.graphics, point.x, point.y, size, alpha);
        continue;
      }
      drawPoiGlyph(this.graphics, slot.kind, point.x, point.y, size, alpha);
      if (guarded) drawVaultGuardRing(this.graphics, point.x, point.y, size);
      if (collected) drawCollectedCheck(this.graphics, point.x, point.y, size);
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
    strokeDashedLine(this.graphics, x1, y1, x2, y2);
  }
}
