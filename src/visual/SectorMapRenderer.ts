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
import { SECTOR_MARKS } from '../expedition/sectorMarks';
import type { SectorMarkKind } from '../expedition/sectorMarks';
import type { MapOpenReveal } from '../expedition/mapReveal';
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
/** Everything the world put on this chart has a hue of its own; everything the player wrote is
 *  white, so a glance separates what was found from what was decided. It shares white with the
 *  focus cursor deliberately: the cursor is four corner brackets on the cell's edge and a mark
 *  is a glyph inside it, and both are the player's own hand rather than the world's. */
const PLAYER_MARK = 0xffffff;
/** The plotted course, white with the focus cursor and the sector mark on this file's own rule:
 *  everything the world put on this chart has a hue of its own, everything the player decided is
 *  white. Picking a route is a decision. */
const COURSE_STROKE = PLAYER_MARK;
const COURSE_ALPHA = 0.55;
/** A course through a door that is still shut draws fainter and dashed: the chart says "this is
 *  the way" without saying "go". */
const COURSE_BLOCKED_ALPHA = 0.32;
const FALLBACK_TINT = 0x2a3a52;

const DASH_LENGTH = 5;
const DASH_GAP = 4;

/** Doc 03 section 4.4: a COLLECTED point of interest renders at 40% with a check overlay. */
export const COLLECTED_ALPHA = 0.4;
/** The size the legend draws every glyph at, map zoom being irrelevant in a panel row. */
export const LEGEND_GLYPH_SIZE = 5;
/** The hazard orange the world already uses for a sealed, guarded vault core. */
const GUARDED_RING = WORLD_GEOMETRY_COLORS.hazard.stroke;
/** A room this expedition's ambient stir changed. The hazard orange the world already paints the
 *  ground a bloom grows, so the chart names a change in the colour the room itself will show it
 *  in. Shared with GUARDED_RING and unconfusable with it: that is a ring around a POI glyph in the
 *  cell interior, this is a badge in the cell's own bottom-right corner. */
const STIR_BADGE = WORLD_GEOMETRY_COLORS.hazard.stroke;

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

/** Doc 03 section 7 moment 3: the cell where a secret was just found blooms once, the first time
 *  the chart is looked at afterwards. Amber is the language the lead badge and a found hidden
 *  room already speak, and the ring expands OUT of the glyph rather than covering it, so the
 *  icon it is pointing at stays readable for the whole bloom. */
export function drawSecretBloomRing(
  graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, progress: number,
): void {
  if (!(progress < 1)) return;
  const grown = progress < 0 ? 0 : progress;
  graphics.lineStyle(Math.max(1, size * 0.4 * (1 - grown)), HIDDEN_FOUND_STROKE, 1 - grown);
  graphics.strokeCircle(x, y, size * (1.2 + grown * 3.8));
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

/** Doc 03 section 7 moment 5: an objective that moved while the ship was flying, badged on its
 *  own pin until the chart is next looked at. Green is the chart's one "this is new" hue, and
 *  it never lands on a pin elsewhere, so it cannot be confused with the newly-opened door ring
 *  it shares a colour with. Static by construction, so it needs no reduced-motion branch. */
export function drawObjectiveUpdatedBadge(
  graphics: Phaser.GameObjects.Graphics, centreX: number, topY: number, size: number,
): void {
  graphics.fillStyle(CLEARED_NOTCH, 1);
  graphics.fillCircle(centreX + size * 0.95, topY + size * 0.5, Math.max(1.5, size * 0.42));
}

/**
 * The corner badge saying a lore fragment points into this sector. A filled disc is a lead the
 * ship can fly to and walk into; a hollow ring is one sealed against the profile right now.
 *
 * The ring rather than a second colour, on this file's standing rule: shape carries the
 * meaning. Which seal it is (cracked rock, or a void gap) is deliberately not encoded here:
 * the focused-sector readout and the LEADS panel both already name it, and a third badge state
 * would cost a third legend row on a panel that is already 21 rows tall.
 */
export function drawLeadBadge(
  graphics: Phaser.GameObjects.Graphics,
  x: number, y: number, radius: number, sealed: boolean,
): void {
  if (!sealed) {
    graphics.fillStyle(HIDDEN_FOUND_STROKE, 1);
    graphics.fillCircle(x, y, radius);
    return;
  }
  graphics.lineStyle(Math.max(1.25, radius * 0.45), HIDDEN_FOUND_STROKE, 1);
  graphics.strokeCircle(x, y, radius * 0.85);
}

/** Bottom-left of the cell: the objective pin owns the top edge, the cleared notch the top-right
 *  corner and the hint badge the top-left, so this is the one corner a sector can always spare. */
export function drawSectorMark(
  graphics: Phaser.GameObjects.Graphics,
  kind: SectorMarkKind, centreX: number, centreY: number, size: number,
): void {
  graphics.lineStyle(Math.max(1.5, size * 0.4), PLAYER_MARK, 1);
  switch (SECTOR_MARKS[kind].shape) {
    case 'chevron':
      graphics.lineBetween(centreX - size, centreY + size * 0.5, centreX, centreY - size * 0.6);
      graphics.lineBetween(centreX, centreY - size * 0.6, centreX + size, centreY + size * 0.5);
      break;
    case 'cross':
      graphics.lineBetween(centreX - size, centreY - size, centreX + size, centreY + size);
      graphics.lineBetween(centreX - size, centreY + size, centreX + size, centreY - size);
      break;
    case 'triangle':
      graphics.strokePoints([
        { x: centreX, y: centreY - size },
        { x: centreX + size, y: centreY + size * 0.8 },
        { x: centreX - size, y: centreY + size * 0.8 },
      ], true);
      break;
  }
}

/** The tell that a mark carries words. It rides the mark's upper-right, the one side of the
 *  bottom-left corner nothing else claims, and shares the mark's white so it reads as part of it
 *  rather than as a seventh overlay. */
export function drawSectorNoteDot(
  graphics: Phaser.GameObjects.Graphics, markCentreX: number, markCentreY: number, size: number,
): void {
  graphics.fillStyle(PLAYER_MARK, 1);
  graphics.fillCircle(
    markCentreX + size * 1.1, markCentreY - size * 1.1, Math.max(1, size * 0.42),
  );
}

/**
 * Where a sortie puts the ship down. Bottom-right is the last corner a cell can spare: the
 * pin owns the top edge, the cleared notch the top-right, the lead badge the top-left and the
 * player's own mark the bottom-left. It draws in the ship marker's cyan rather than in the
 * player-mark white, because a landing site is where the world will put the ship, not something
 * the player drew, and it makes both ends of one jump read as the same colour.
 */
export function drawSortieBadge(
  graphics: Phaser.GameObjects.Graphics, centreX: number, centreY: number, size: number,
): void {
  graphics.lineStyle(Math.max(1.5, size * 0.4), PLAYER_MARKER, 1);
  graphics.lineBetween(centreX, centreY - size, centreX, centreY + size * 0.35);
  graphics.lineBetween(
    centreX - size * 0.6, centreY - size * 0.25, centreX, centreY + size * 0.35);
  graphics.lineBetween(
    centreX + size * 0.6, centreY - size * 0.25, centreX, centreY + size * 0.35);
  graphics.lineBetween(centreX - size, centreY + size, centreX + size, centreY + size);
}

/**
 * A room whose ground bloomed or whose walls shifted this expedition. Occupant 2 of the
 * destination lane (README section 4.4), so it draws only in a cell the sortie badge did not take.
 * A doubled ripple rather than the Breakable door's single crack: the same "this is not the ground
 * you learned" vocabulary, doubled so a corner badge can never be misread as an edge glyph.
 */
export function drawStirBadge(
  graphics: Phaser.GameObjects.Graphics, centreX: number, centreY: number, size: number,
): void {
  graphics.lineStyle(Math.max(1.5, size * 0.34), STIR_BADGE, 1);
  for (const rippleY of [centreY - size * 0.5, centreY + size * 0.5]) {
    graphics.strokePoints([
      { x: centreX - size, y: rippleY },
      { x: centreX - size * 0.33, y: rippleY - size * 0.4 },
      { x: centreX + size * 0.33, y: rippleY + size * 0.4 },
      { x: centreX + size, y: rippleY },
    ], false);
  }
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
  /** The subset of hintedSectorKeys whose every lead is sealed against the profile. Required
   *  rather than optional, on the markedSectorKinds precedent: a call site that forgets it is
   *  a compile error rather than a silently mislabelled chart. */
  sealedLeadSectorKeys: ReadonlySet<string>;
  /** Sectors an active place-naming objective points at. Charted keys only: the caller resolves
   *  them against discovery, and an unknown sector draws nothing at all. */
  objectiveSectorKeys: ReadonlySet<string>;
  /** What the player wrote on each sector, keyed by sector key. Required rather than optional,
   *  on the updatedObjectiveSectorKeys precedent. */
  markedSectorKinds: ReadonlyMap<string, SectorMarkKind>;
  /** Marked sectors whose mark carries a typed note. Required rather than optional, on the
   *  markedSectorKinds precedent: a call site that forgets it is a compile error. */
  notedSectorKeys: ReadonlySet<string>;
  /** The subset of objectiveSectorKeys whose objective moved since the chart was last opened.
   *  Required rather than optional, on the hazardSectorKinds precedent: a call site that
   *  forgets it is a compile error rather than a silently unbadged map. */
  updatedObjectiveSectorKeys: ReadonlySet<string>;
  /** Doors opened by a gain this run and not yet looked at. Empty on every ordinary open. */
  newlyPassableEdgeIds: ReadonlySet<string>;
  /** The plotted course, ship room first and focused room last. Empty when nothing is focused,
   *  when the focus IS the ship's room, and when the chart knows no route. Required rather than
   *  optional, on the updatedObjectiveSectorKeys precedent: a call site that forgets it is a
   *  compile error rather than a chart that silently stops plotting. */
  courseSectorKeys: readonly string[];
  /** True when the course crosses a door this profile cannot open. */
  courseBlocked: boolean;
  /** The room a sortie lands in right now: the focused room whenever the chart says the ship
   *  could fly there, and the anchor the profile already holds otherwise. Null when this profile
   *  holds no sortie for this world. Required rather than optional, on the courseSectorKeys
   *  precedent: a call site that forgets it is a compile error rather than a chart that silently
   *  stops saying where the jump goes. */
  sortieSectorKey: string | null;
  /** Rooms this expedition's ambient stir bloomed or shifted, unioned by the caller: the lane
   *  draws ONE badge per cell (README section 4.4), so a room that took both is one mark. Required
   *  rather than optional, on the sortieSectorKey precedent: a call site that forgets it is a
   *  compile error rather than a chart that silently stops saying what changed. */
  stirredSectorKeys: ReadonlySet<string>;
  /** Doc 03 section 7 moments 3 and 4: the one-time replay running on THIS map open. Required
   *  rather than optional, on the updatedObjectiveSectorKeys precedent: a call site that forgets
   *  it is a compile error rather than a chart that silently never replays anything. Null on
   *  every ordinary open and on every open under reduced motion. */
  mapOpenReveal: MapOpenReveal | null;
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
      const cellAlpha = input.mapOpenReveal?.cascadeAlphaBySectorKey.get(sector.key) ?? 1;
      if (cellAlpha <= 0) continue;
      const cell = sectorCellRect(sector.sx, sector.sy, input.view);
      if (cell.x + cell.width < 0 || cell.y + cell.height < 0) continue;
      if (cell.x > input.panelWidth || cell.y > input.panelHeight) continue;

      if ((flags & SectorFlags.VISITED) !== 0) {
        const tint = BIOME_TINTS.get(sector.biomeId) ?? FALLBACK_TINT;
        graphics.fillStyle(tint, VISITED_FILL_ALPHA * cellAlpha);
        graphics.fillRect(cell.x, cell.y, cell.width, cell.height);
        if (sector.hidden === true) graphics.lineStyle(2.5, HIDDEN_FOUND_STROKE, cellAlpha);
        else graphics.lineStyle(1.5, VISITED_STROKE, cellAlpha);
        graphics.strokeRect(cell.x, cell.y, cell.width, cell.height);
      } else {
        graphics.fillStyle(UNVISITED_FILL, cellAlpha);
        graphics.fillRect(cell.x, cell.y, cell.width, cell.height);
        graphics.lineStyle(1, UNVISITED_STROKE, cellAlpha);
        this.strokeDashedRect(cell.x, cell.y, cell.width, cell.height);
      }

      // A cell still fading in draws its outline and nothing else: its notch, badges, pin, mark,
      // icons and doors all join at full alpha the instant the cascade reaches it. That is why no
      // alpha has to be threaded through five glyph helpers for one 400 ms replay.
      if (cellAlpha < 1) continue;

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
        drawLeadBadge(graphics, cell.x + badge + 2, cell.y + badge + 2, badge,
          input.sealedLeadSectorKeys.has(sector.key));
      }

      if (input.objectiveSectorKeys.has(sector.key)) {
        const pinSize = Math.max(4, 6 * input.view.scale);
        drawObjectivePin(graphics, cell.x + cell.width / 2, cell.y, pinSize);
        if (input.updatedObjectiveSectorKeys.has(sector.key)) {
          drawObjectiveUpdatedBadge(graphics, cell.x + cell.width / 2, cell.y, pinSize);
        }
      }

      const mark = input.markedSectorKinds.get(sector.key);
      if (mark) {
        const markSize = Math.max(3, 4.5 * input.view.scale);
        const markX = cell.x + markSize + 3;
        const markY = cell.y + cell.height - markSize - 3;
        drawSectorMark(graphics, mark, markX, markY, markSize);
        if (input.notedSectorKeys.has(sector.key)) {
          drawSectorNoteDot(graphics, markX, markY, markSize);
        }
      }

      // Occupant order is README section 4.4's: the sortie wins the lane, because an action one
      // press away beats a fact. The stir badge takes the VISITED gate sectorDetail's own bloom and
      // shift rows take: a stir is an interior fact, and marking it on a room charted only as an
      // outline would describe an interior the chart refuses to draw.
      const laneBadge = Math.max(3, 4.5 * input.view.scale);
      const laneX = cell.x + cell.width - laneBadge - 3;
      const laneY = cell.y + cell.height - laneBadge - 3;
      if (input.sortieSectorKey === sector.key) {
        drawSortieBadge(graphics, laneX, laneY, laneBadge);
      } else if (input.stirredSectorKeys.has(sector.key)
        && (flags & SectorFlags.VISITED) !== 0) {
        drawStirBadge(graphics, laneX, laneY, laneBadge);
      }

      this.drawPoiIcons(sector, input);
      this.drawDoors(sector.sx, sector.sy, input);
    }

    this.drawCourse(input);
    if (input.focusedCell) {
      const cell = sectorCellRect(input.focusedCell.gridX, input.focusedCell.gridY, input.view);
      drawSectorCursor(graphics, cell.x, cell.y, cell.width, cell.height);
    }
    this.drawPlayerMarker(input);
  }

  /**
   * Drawn after every cell and door so the line reads over the fills, and before the focus
   * cursor so the brackets still bracket. Suppressed entirely while the map-open cascade runs,
   * on the same rule a cell still fading in draws only its outline.
   */
  private drawCourse(input: SectorMapDrawInput): void {
    if (input.mapOpenReveal !== null) return;
    if (input.courseSectorKeys.length < 2) return;
    const { graphics } = this;
    const points: Array<{ x: number; y: number }> = [];
    for (const key of input.courseSectorKeys) {
      const sector = input.map.sectors.get(key);
      if (sector === undefined) return;
      const cell = sectorCellRect(sector.sx, sector.sy, input.view);
      points.push({ x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 });
    }
    const alpha = input.courseBlocked ? COURSE_BLOCKED_ALPHA : COURSE_ALPHA;
    graphics.lineStyle(2, COURSE_STROKE, alpha);
    for (let step = 0; step + 1 < points.length; step++) {
      const from = points[step];
      const to = points[step + 1];
      if (input.courseBlocked) strokeDashedLine(graphics, from.x, from.y, to.x, to.y);
      else graphics.lineBetween(from.x, from.y, to.x, to.y);
    }
    const dotRadius = Math.max(1.5, 2 * input.view.scale);
    graphics.fillStyle(COURSE_STROKE, alpha);
    for (const point of points) graphics.fillCircle(point.x, point.y, dotRadius);
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
      const reveal = input.mapOpenReveal;
      if (reveal && reveal.bloomSecretIds.has(slot.id)) {
        drawSecretBloomRing(this.graphics, point.x, point.y, size, reveal.bloomProgress);
      }
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
