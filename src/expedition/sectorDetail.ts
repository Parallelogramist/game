/**
 * sectorDetail: what the map screen's readout says about one focused sector.
 *
 * Pure and Phaser-free like the rest of src/expedition/. The caller supplies what the profile
 * knows through predicates, so this module obeys the same leak rules SectorMapRenderer does:
 * an unfound secret contributes nothing and a POI contributes nothing until it is SEEN,
 * because a readout that names what the chart refuses to draw is the same spoiler by another
 * route.
 */

import { EDGE_DIRECTIONS, EdgeKind, PoiKind, edgeIdFor } from '../world/worldTypes';
import type { EdgeDef, EdgeDirection, SectorDef, WorldMap } from '../world/worldTypes';
import { EdgeFlags, PoiFlags, SecretFlags, SectorFlags } from './DiscoveryTypes';
import { gateGlyphFor } from './gateGlyphs';
import { HAZARD_NEST_GLYPH, poiGlyphFor } from './poiGlyphs';
import { getStageById } from '../data/Stages';
import { getTraversalAbility } from '../data/TraversalAbilities';
import { WARDEN_SEAL_KEY_ID, getQuestForKeyId } from '../data/ExpeditionQuests';
import { countIntactGridBands, isGridFenceIntact } from '../world/securityGrids';
import type { PoiHazardKind } from '../data/PoiCatalog';

/** The two risk rooms a Treasure slot can roll instead of loot. Declared in the POI catalog,
 *  which the quest catalog also reads; re-exported here so every map-side importer keeps its
 *  existing import line. */
export type { PoiHazardKind } from '../data/PoiCatalog';

export interface SectorDetailInputs {
  map: WorldMap;
  gridX: number;
  gridY: number;
  sectorFlagsOf: (sectorKey: string) => number;
  edgeFlagsOf: (edgeId: string) => number;
  poiFlagsOf: (poiId: string) => number;
  secretFlagsOf: (secretId: string) => number;
  holdsAbility: (abilityId: string) => boolean;
  holdsQuestKey: (keyId: string) => boolean;
  /** Sectors an active objective points at. The chart draws the same pin, so naming it here
   *  leaks nothing the map does not already show. */
  objectiveSectorKeys: ReadonlySet<string>;
  /** Sectors a lore fragment already points at. The chart's corner badge shows the same fact,
   *  so naming it here leaks nothing the map does not already show. */
  hintedSectorKeys: ReadonlySet<string>;
  /** Sectors holding a DORMANT risk room, keyed by sector key, as THIS run rolled them. A woken
   *  hive or den is a fight already in progress and is deliberately absent. Naming one leaks
   *  nothing: a hazard exists only in a room the run has already entered, where its own
   *  world-space graphic is visible from across the floor. */
  hazardSectorKinds: ReadonlyMap<string, PoiHazardKind>;
  /** Rooms this expedition's ambient bloom grew fresh hazard ground in. Required rather than
   *  optional, on the hazardSectorKinds precedent: a call site that forgets it is a compile error
   *  rather than a chart that silently stops naming a room that changed. */
  bloomedSectorKeys: ReadonlySet<string>;
  /** Rooms this expedition's ambient shift changed the shape of. Required rather than optional, on
   *  the bloomedSectorKeys precedent: a call site that forgets it is a compile error rather than a
   *  chart that silently stops naming a room that changed. */
  shiftedSectorKeys: ReadonlySet<string>;
}

export interface SectorDetailView {
  sectorKey: string;
  /** EXPLORED or CHARTED, plus HANGAR / ARENA / HIDDEN ROOM / CLEARED when they apply. */
  headline: string;
  /** Biome and graph distance, e.g. "Crystal Caves · 5 jumps out". */
  place: string;
  /** One entry per KNOWN non-Wall border, e.g. "N Ability door · requires Blink Drive". */
  doors: string[];
  /** One entry per thing this sector still advertises, e.g. "Ability vault · guarded". */
  rewards: string[];
}

const DIRECTION_LABELS: Record<EdgeDirection, string> = {
  north: 'N', east: 'E', south: 'S', west: 'W',
};

/** Null for a cell this world has no sector for, and for one the profile has never seen. */
export function buildSectorDetail(inputs: SectorDetailInputs): SectorDetailView | null {
  const sectorKey = `${inputs.gridX},${inputs.gridY}`;
  const sector = inputs.map.sectors.get(sectorKey);
  if (!sector) return null;
  const flags = inputs.sectorFlagsOf(sectorKey);
  if (flags === 0) return null;

  const marks: string[] = [(flags & SectorFlags.VISITED) !== 0 ? 'Explored' : 'Charted'];
  if (sectorKey === inputs.map.startKey) marks.push('Hangar');
  if (sector.isBossArena) marks.push('Arena');
  if (sector.hidden === true) marks.push('Hidden room');
  if ((flags & SectorFlags.CLEARED_ONCE) !== 0) marks.push('Cleared');

  return {
    sectorKey,
    headline: marks.join(' · '),
    place: describePlace(sector),
    doors: describeDoors(sector, inputs),
    rewards: describeRewards(sector, inputs),
  };
}

function describePlace(sector: SectorDef): string {
  const stage = getStageById(sector.biomeId);
  const biome = stage ? stage.name : 'Uncharted space';
  const jumps = sector.depth <= 0 ? 'at the hangar'
    : sector.depth === 1 ? '1 jump out'
    : `${sector.depth} jumps out`;
  return `${biome} · ${jumps}`;
}

function describeDoors(sector: SectorDef, inputs: SectorDetailInputs): string[] {
  const lines: string[] = [];
  for (const direction of EDGE_DIRECTIONS) {
    const edge = sector.edges[direction];
    if (edge.kind === EdgeKind.Wall) continue;
    const edgeId = edgeIdFor(sector.sx, sector.sy, direction);
    if ((inputs.edgeFlagsOf(edgeId) & EdgeFlags.KNOWN) === 0) continue;
    lines.push(
      `${DIRECTION_LABELS[direction]} ${gateGlyphFor(edge.kind).label}`
      + requirementSuffix(edge, inputs),
    );
  }
  return lines;
}

/**
 * Doc 03 section 4.5 rule 3: a door names what it wants, or says the mechanism is unknown
 * rather than lying. Deliberately the same two branches the in-world SEALED DOOR toast takes,
 * so the map and the door can never disagree about a route.
 */
function requirementSuffix(edge: EdgeDef, inputs: SectorDetailInputs): string {
  if (edge.kind === EdgeKind.AbilityDoor) {
    const definition = edge.requiredId ? getTraversalAbility(edge.requiredId) : undefined;
    if (!definition) return ' · mechanism unknown';
    return inputs.holdsAbility(definition.id)
      ? ' · open to you'
      : ` · requires ${definition.name}`;
  }
  if (edge.kind === EdgeKind.KeyDoor) {
    if (edge.requiredId === undefined) return ' · mechanism unknown';
    if (edge.requiredId === WARDEN_SEAL_KEY_ID) {
      return inputs.holdsQuestKey(edge.requiredId)
        ? ' · open to you'
        : ' · slay the Warden';
    }
    const quest = getQuestForKeyId(edge.requiredId);
    if (!quest) return ' · mechanism unknown';
    return inputs.holdsQuestKey(edge.requiredId)
      ? ' · open to you'
      : ` · finish ${quest.name}`;
  }
  if (edge.kind === EdgeKind.OneWay && edge.passDirection) {
    return ` · passes ${edge.passDirection} only`;
  }
  return '';
}

const HAZARD_LABELS: Record<PoiHazardKind, string> = {
  nest: 'Ambush nest · dormant',
  lair: 'Nemesis lair · dormant',
  warden: 'Warden throne · dormant',
};

const HAZARD_NEST_LABEL = HAZARD_NEST_GLYPH.label;

const PHASE_CLOAK_ABILITY_ID = 'ability_phase_cloak';
const MAGNO_TETHER_ABILITY_ID = 'ability_magno_tether';

function describeRewards(sector: SectorDef, inputs: SectorDetailInputs): string[] {
  const lines: string[] = [];
  let nestNamedBySlot = false;
  for (const slot of sector.poiSlots) {
    const glyph = poiGlyphFor(slot.kind);
    if (glyph.shape === 'none') continue;
    if (slot.kind === PoiKind.Secret) {
      // The leak guard, same as SectorMapRenderer.drawPoiIcons: an unfound secret's position
      // is the entire point of the room, so only a FOUND one is ever named.
      if ((inputs.secretFlagsOf(slot.id) & SecretFlags.FOUND) !== 0) lines.push(glyph.label);
      continue;
    }
    const flags = inputs.poiFlagsOf(slot.id);
    if ((flags & PoiFlags.SEEN) === 0) continue;
    if ((flags & PoiFlags.HAZARD_NEST) !== 0) {
      lines.push(HAZARD_NEST_LABEL);
      nestNamedBySlot = true;
      continue;
    }
    if ((flags & PoiFlags.COLLECTED) !== 0) {
      lines.push(`${glyph.label} · claimed`);
      continue;
    }
    if (slot.kind === PoiKind.Shrine && isGridFenceIntact(sector, slot)) {
      lines.push(`${glyph.label} · ${inputs.holdsAbility(PHASE_CLOAK_ABILITY_ID)
        ? 'grid open to you' : 'behind a security grid'}`);
      continue;
    }
    const guarded = slot.kind === PoiKind.AbilityPowerUp
      && (flags & PoiFlags.GUARD_CLEARED) === 0;
    lines.push(guarded ? `${glyph.label} · guarded` : glyph.label);
  }
  // Same VISITED rule lockouts.ts takes, and for the same reason: a band has no POI slot, so
  // there is no SEEN to gate on and a merely charted room must not have its interior named.
  const intactBands = (inputs.sectorFlagsOf(sector.key) & SectorFlags.VISITED) !== 0
    ? countIntactGridBands(sector) : 0;
  if (intactBands === 1) {
    lines.push(`Corridor grid · ${inputs.holdsAbility(PHASE_CLOAK_ABILITY_ID)
      ? 'shortcut open to you' : 'blocking a shortcut'}`);
  } else if (intactBands > 1) {
    lines.push(`${intactBands} corridor grids · ${inputs.holdsAbility(PHASE_CLOAK_ABILITY_ID)
      ? 'shortcuts open to you' : 'blocking shortcuts'}`);
  }
  // Same VISITED rule the corridor-grid rows above take: a bloom is terrain rather than a reward,
  // but naming it in a room the profile has only charted as an outline would describe an interior
  // the chart refuses to draw. A room the profile HAS explored is exactly the case this exists
  // for: the ground it learned is not the ground it will land on.
  if (inputs.bloomedSectorKeys.has(sector.key)
    && (inputs.sectorFlagsOf(sector.key) & SectorFlags.VISITED) !== 0) {
    lines.push('Bloomed ground · fresh hazard strips');
  }
  // Same VISITED rule the bloom row above takes, and for the same reason: a shifted wall is an
  // interior fact, and naming it in a room the profile has only charted as an outline would
  // describe an interior the chart refuses to draw.
  if (inputs.shiftedSectorKeys.has(sector.key)
    && (inputs.sectorFlagsOf(sector.key) & SectorFlags.VISITED) !== 0) {
    lines.push('Shifted walls · the room changed shape');
  }
  const hazard = inputs.hazardSectorKinds.get(sector.key);
  // The run-scoped nest line would restate the slot line above it, which is slot-precise and
  // survives the run. The lair keeps its room-level line: it is never remembered, because it
  // is conditional on live nemesis state and its room genuinely moves between runs.
  if (hazard !== undefined && !(hazard === 'nest' && nestNamedBySlot)) {
    lines.push(HAZARD_LABELS[hazard]);
  }
  if (inputs.objectiveSectorKeys.has(sector.key)) lines.push('An objective points here');
  if (inputs.hintedSectorKeys.has(sector.key)) {
    lines.push(`A lead points here${leadSealSuffix(sector, inputs)}`);
  }
  return lines;
}

/** What still stands between the ship and the cache a lead names. Only a HINTED secret is
 *  read, which is the same fact the chart's corner badge and the LEADS panel already admit. */
function leadSealSuffix(sector: SectorDef, inputs: SectorDetailInputs): string {
  let walled = false;
  let gapped = false;
  for (const slot of sector.poiSlots) {
    if (slot.kind !== PoiKind.Secret) continue;
    const flags = inputs.secretFlagsOf(slot.id);
    if ((flags & SecretFlags.HINTED) === 0 || (flags & SecretFlags.FOUND) !== 0) continue;
    if (slot.sealed === true) walled = true;
    if (slot.gapped === true) gapped = true;
  }
  const clauses: string[] = [];
  if (walled) clauses.push('sealed behind cracked rock');
  if (gapped) {
    clauses.push(inputs.holdsAbility(MAGNO_TETHER_ABILITY_ID)
      ? 'across a void gap open to you'
      : 'across a void gap');
  }
  return clauses.length === 0 ? '' : ` · ${clauses.join(' · ')}`;
}
