/**
 * lockouts: what the profile still cannot open, and what each missing thing would unlock.
 *
 * Doc 03 section 4.5 rule 4's "the map is now a to-do list", answered world-wide instead of
 * one door at a time. Pure and Phaser-free like the rest of src/expedition/: the caller
 * supplies what the profile knows through predicates, so this module obeys the same leak
 * rules SectorMapRenderer and sectorDetail do. An uncharted sector contributes nothing, an
 * unseen POI contributes nothing, and an un-hinted secret contributes nothing, because a
 * count with a nearest-distance beside it is a position by another route. A row's source is
 * named only where the chart already draws the slot, which is PoiFlags.SEEN for both a vault
 * and a board.
 */

import { EDGE_DIRECTIONS, EdgeKind, PoiKind, edgeIdFor } from '../world/worldTypes';
import type { SectorDef, WorldMap } from '../world/worldTypes';
import { EdgeFlags, PoiFlags, SecretFlags, SectorFlags } from './DiscoveryTypes';
import { plotSectorCourse } from './sectorRoute';
import type { SectorCourse } from './sectorRoute';
import { getTraversalAbility } from '../data/TraversalAbilities';
import { WARDEN_SEAL_KEY_ID, WARDEN_SEAL_LABEL, getQuestForKeyId } from '../data/ExpeditionQuests';
import { countIntactGridBands, isGridFenceIntact } from '../world/securityGrids';

const MAGNO_TETHER_ABILITY_ID = 'ability_magno_tether';
const PHASE_CLOAK_ABILITY_ID = 'ability_phase_cloak';

/** How far the ship must actually fly to a lockout row's source, over the chart rather than
 *  across it. Projected from SectorCourse: the panel needs the length and what shuts the way,
 *  never the path, so the sector keys are dropped here. */
export type LockoutTravel =
  /** The source is in the room the ship is standing in. */
  | { kind: 'here' }
  /** A route the ship can fly right now, in hops. */
  | { kind: 'hops'; hops: number }
  /** A charted route exists and at least one door on it is shut to this profile. */
  | { kind: 'blocked'; hops: number; requirements: string[] }
  /** Nothing the chart knows about connects the ship to it. */
  | { kind: 'none' };

export type LockoutKind = 'ability' | 'questKey' | 'warden';

/** Where the profile goes to earn a lockout row. A place only where the chart already draws
 *  one: every sectorKey here belongs to a POI slot the profile has actually stood beside. */
export type LockoutSource =
  /** The ability vault that grants it. Always reachable WITHOUT the ability it grants:
   *  placeAbilityGates hosts a vault outside its own gate's subtree, by construction. It may
   *  still sit behind a DIFFERENT ability's door, which is what a blocked travel reports. */
  | { kind: 'vault'; sectorKey: string; travel: LockoutTravel }
  /** The quest is accepted and running, so the key is steps away rather than sectors. */
  | { kind: 'questActive'; stepNumber: number; stepCount: number }
  /** The quest is on offer and this is the best board the profile has seen: the shortest flight
   *  it can actually make, not the shortest line. */
  | { kind: 'questBoard'; sectorKey: string; travel: LockoutTravel }
  /** The quest is on offer but all three objective slots are taken. */
  | { kind: 'questSlotsFull' }
  /** The world's boss arena, and only once the profile has charted it: naming a route to a
   *  sector the chart refuses to draw would leak a position, the same rule the vault and board
   *  scans obey. */
  | { kind: 'wardenArena'; sectorKey: string; travel: LockoutTravel }
  /** Nothing charted starts it: the vault or the board is still unfound. */
  | { kind: 'unfound' };

/** What the profile can do about a quest right now. Resolved by the caller from the quest store
 *  so this module stays free of src/meta/ and src/systems/. */
export type LockoutQuestState =
  | { kind: 'active'; stepNumber: number; stepCount: number }
  | { kind: 'acceptable' }
  | { kind: 'slotsFull' }
  | { kind: 'unoffered' };

/** One ability vault the profile has stood beside and has not claimed. */
export interface AbilityVaultSite {
  abilityId: string;
  poiId: string;
  sectorKey: string;
  sx: number;
  sy: number;
}

export interface AbilityVaultInputs {
  map: WorldMap;
  sectorFlagsOf: (sectorKey: string) => number;
  poiFlagsOf: (poiId: string) => number;
  holdsAbility: (abilityId: string) => boolean;
}

export interface LockoutRow {
  /** Traversal ability id or quest key id. Stable across opens. */
  id: string;
  kind: LockoutKind;
  /** Ability name, the name of the quest that grants the key, or the Warden. */
  name: string;
  /** KNOWN sector borders this would open. */
  doors: number;
  /** Charted reward sites this would reach. */
  sites: number;
  /** Lit corridor grids, in rooms the ship has walked, this would permanently open. Counted
   *  apart from doors and sites because a band is neither a sector border nor a reward. */
  shortcuts: number;
  /** Chebyshev sector distance from the ship to the nearest counted place. Not rendered any
   *  more, since the source distance is the actionable one: kept as the sort tiebreak so two
   *  rows opening the same amount put the nearer payoff first. */
  nearestDistance: number;
  /** Where to go to earn it. */
  source: LockoutSource;
}

export interface LockoutInputs {
  map: WorldMap;
  sectorFlagsOf: (sectorKey: string) => number;
  edgeFlagsOf: (edgeId: string) => number;
  poiFlagsOf: (poiId: string) => number;
  secretFlagsOf: (secretId: string) => number;
  holdsAbility: (abilityId: string) => boolean;
  holdsQuestKey: (keyId: string) => boolean;
  /** Quest-store state for the quest that grants a key. Only called for questKey rows. */
  questStateOf: (questId: string) => LockoutQuestState;
  shipCell: { col: number; row: number };
}

interface Accumulator {
  id: string;
  kind: LockoutKind;
  name: string;
  doors: number;
  sites: number;
  shortcuts: number;
  nearestDistance: number;
}

function sectorDistance(sector: SectorDef, ship: { col: number; row: number }): number {
  return Math.max(Math.abs(sector.sx - ship.col), Math.abs(sector.sy - ship.row));
}

/** The chart's own answer to "how do I get there from here", asked with the same predicates the
 *  rest of this module is given, so the panel, the chart's plotted line and the lock ring drawn
 *  on a door can never disagree. */
function courseTo(inputs: LockoutInputs, toSectorKey: string): SectorCourse {
  return plotSectorCourse({
    map: inputs.map,
    fromSectorKey: `${inputs.shipCell.col},${inputs.shipCell.row}`,
    toSectorKey,
    sectorFlagsOf: inputs.sectorFlagsOf,
    edgeFlagsOf: inputs.edgeFlagsOf,
    holdsAbility: inputs.holdsAbility,
    holdsQuestKey: inputs.holdsQuestKey,
  });
}

function travelOf(course: SectorCourse): LockoutTravel {
  if (course.kind === 'here') return { kind: 'here' };
  if (course.kind === 'none') return { kind: 'none' };
  const hops = course.sectorKeys.length - 1;
  if (course.kind === 'plotted') return { kind: 'hops', hops };
  return { kind: 'blocked', hops, requirements: course.requirements };
}

function travelRank(travel: LockoutTravel): number {
  if (travel.kind === 'here' || travel.kind === 'hops') return 0;
  return travel.kind === 'blocked' ? 1 : 2;
}

function travelHops(travel: LockoutTravel): number {
  if (travel.kind === 'here') return 0;
  if (travel.kind === 'none') return Number.MAX_SAFE_INTEGER;
  return travel.hops;
}

/** Flyable beats gated beats unrouted, then the shorter flight. A row's source is the place the
 *  panel is about to send the player, so "nearest" has to mean the shortest trip that can
 *  actually be made. The sector key breaks a tie so the place a profile is sent to never depends
 *  on Map iteration order. */
function isBetterPlace(
  candidate: { sectorKey: string; travel: LockoutTravel },
  incumbent: { sectorKey: string; travel: LockoutTravel },
): boolean {
  const byRank = travelRank(candidate.travel) - travelRank(incumbent.travel);
  if (byRank !== 0) return byRank < 0;
  const byHops = travelHops(candidate.travel) - travelHops(incumbent.travel);
  if (byHops !== 0) return byHops < 0;
  return candidate.sectorKey < incumbent.sectorKey;
}

/**
 * Every ability vault the profile has stood beside and still has no ability from.
 *
 * PoiFlags.SEEN, not a charted sector, is the gate: SEEN is written on sector ENTRY
 * (discoveryRules' reveal-on-entered pass), and SectorMapRenderer draws a POI icon on exactly
 * the same flag, so naming a vault the chart refuses to draw would leak a position.
 */
export function findUnclaimedAbilityVaults(inputs: AbilityVaultInputs): AbilityVaultSite[] {
  const sites: AbilityVaultSite[] = [];
  for (const sector of inputs.map.sectors.values()) {
    if (inputs.sectorFlagsOf(sector.key) === 0) continue;
    for (const slot of sector.poiSlots) {
      if (slot.kind !== PoiKind.AbilityPowerUp) continue;
      if (slot.grantsAbilityId === undefined) continue;
      if ((inputs.poiFlagsOf(slot.id) & PoiFlags.SEEN) === 0) continue;
      if (inputs.holdsAbility(slot.grantsAbilityId)) continue;
      sites.push({
        abilityId: slot.grantsAbilityId,
        poiId: slot.id,
        sectorKey: sector.key,
        sx: sector.sx,
        sy: sector.sy,
      });
    }
  }
  return sites;
}

/** The best quest board the profile has stood beside, or null. Same SEEN rule and same reason as
 *  the vault scan: naming a board the chart refuses to draw would leak a position. */
function bestSeenQuestBoard(
  inputs: LockoutInputs,
): { sectorKey: string; travel: LockoutTravel } | null {
  let best: { sectorKey: string; travel: LockoutTravel } | null = null;
  for (const sector of inputs.map.sectors.values()) {
    if (inputs.sectorFlagsOf(sector.key) === 0) continue;
    if (!sector.poiSlots.some(slot => slot.kind === PoiKind.QuestGiver
      && (inputs.poiFlagsOf(slot.id) & PoiFlags.SEEN) !== 0)) continue;
    const candidate = { sectorKey: sector.key, travel: travelOf(courseTo(inputs, sector.key)) };
    if (best === null || isBetterPlace(candidate, best)) best = candidate;
  }
  return best;
}

export function buildLockoutRows(inputs: LockoutInputs): LockoutRow[] {
  const rows = new Map<string, Accumulator>();
  // Every border is reachable from both of its sectors, so an interior door would count twice.
  // Same dedup SectorMapRenderer.drawnEdges keeps, and for the same reason.
  const countedEdges = new Set<string>();

  const bump = (
    key: string, kind: LockoutKind, name: string,
    field: 'doors' | 'sites' | 'shortcuts', distance: number,
  ): void => {
    const existing = rows.get(key);
    if (existing) {
      existing[field]++;
      existing.nearestDistance = Math.min(existing.nearestDistance, distance);
      return;
    }
    rows.set(key, {
      id: key.slice(key.indexOf(':') + 1),
      kind,
      name,
      doors: field === 'doors' ? 1 : 0,
      sites: field === 'sites' ? 1 : 0,
      shortcuts: field === 'shortcuts' ? 1 : 0,
      nearestDistance: distance,
    });
  };

  for (const sector of inputs.map.sectors.values()) {
    const sectorFlags = inputs.sectorFlagsOf(sector.key);
    if (sectorFlags === 0) continue;
    const distance = sectorDistance(sector, inputs.shipCell);

    for (const direction of EDGE_DIRECTIONS) {
      const edge = sector.edges[direction];
      if (edge.kind !== EdgeKind.AbilityDoor && edge.kind !== EdgeKind.KeyDoor) continue;
      if (edge.requiredId === undefined) continue;
      const edgeId = edgeIdFor(sector.sx, sector.sy, direction);
      if (countedEdges.has(edgeId)) continue;
      if ((inputs.edgeFlagsOf(edgeId) & EdgeFlags.KNOWN) === 0) continue;
      countedEdges.add(edgeId);

      if (edge.kind === EdgeKind.AbilityDoor) {
        if (inputs.holdsAbility(edge.requiredId)) continue;
        const definition = getTraversalAbility(edge.requiredId);
        if (!definition) continue;
        bump(`ability:${definition.id}`, 'ability', definition.name, 'doors', distance);
        continue;
      }
      if (inputs.holdsQuestKey(edge.requiredId)) continue;
      if (edge.requiredId === WARDEN_SEAL_KEY_ID) {
        bump(`warden:${WARDEN_SEAL_KEY_ID}`, 'warden', WARDEN_SEAL_LABEL, 'doors', distance);
        continue;
      }
      const quest = getQuestForKeyId(edge.requiredId);
      if (!quest) continue;
      bump(`questKey:${edge.requiredId}`, 'questKey', quest.name, 'doors', distance);
    }

    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret) {
        if (slot.gapped !== true) continue;
        // A cache the profile has not been pointed at is the whole point of the room, so it
        // may not raise a count that carries a distance. HINTED is what the LEADS panel and
        // the chart badge already admit.
        const flags = inputs.secretFlagsOf(slot.id);
        if ((flags & SecretFlags.HINTED) === 0) continue;
        if ((flags & SecretFlags.FOUND) !== 0) continue;
        if (inputs.holdsAbility(MAGNO_TETHER_ABILITY_ID)) continue;
        const tether = getTraversalAbility(MAGNO_TETHER_ABILITY_ID);
        if (!tether) continue;
        bump(`ability:${tether.id}`, 'ability', tether.name, 'sites', distance);
        continue;
      }
      if (slot.kind !== PoiKind.Shrine) continue;
      if (!isGridFenceIntact(sector, slot)) continue;
      if ((inputs.poiFlagsOf(slot.id) & PoiFlags.SEEN) === 0) continue;
      if (inputs.holdsAbility(PHASE_CLOAK_ABILITY_ID)) continue;
      const cloak = getTraversalAbility(PHASE_CLOAK_ABILITY_ID);
      if (!cloak) continue;
      bump(`ability:${cloak.id}`, 'ability', cloak.name, 'sites', distance);
    }

    // A band is interior geometry with no POI slot, so SEEN is unavailable and DISCOVERED is
    // too weak: SectorFlags.VISITED is the flag that already means "its interior may render".
    if ((sectorFlags & SectorFlags.VISITED) !== 0
      && !inputs.holdsAbility(PHASE_CLOAK_ABILITY_ID)) {
      const intactBands = countIntactGridBands(sector);
      const cloak = intactBands > 0 ? getTraversalAbility(PHASE_CLOAK_ABILITY_ID) : undefined;
      if (cloak) {
        for (let counted = 0; counted < intactBands; counted++) {
          bump(`ability:${cloak.id}`, 'ability', cloak.name, 'shortcuts', distance);
        }
      }
    }
  }

  const vaultByAbilityId = new Map<string, { sectorKey: string; travel: LockoutTravel }>();
  for (const site of findUnclaimedAbilityVaults(inputs)) {
    const candidate = {
      sectorKey: site.sectorKey,
      travel: travelOf(courseTo(inputs, site.sectorKey)),
    };
    const incumbent = vaultByAbilityId.get(site.abilityId);
    if (incumbent === undefined || isBetterPlace(candidate, incumbent)) {
      vaultByAbilityId.set(site.abilityId, candidate);
    }
  }

  let board: { sectorKey: string; travel: LockoutTravel } | null | undefined;
  const boardOnce = (): { sectorKey: string; travel: LockoutTravel } | null => {
    if (board === undefined) board = bestSeenQuestBoard(inputs);
    return board;
  };

  const sourceFor = (accumulator: Accumulator): LockoutSource => {
    if (accumulator.kind === 'ability') {
      const vault = vaultByAbilityId.get(accumulator.id);
      if (!vault) return { kind: 'unfound' };
      return { kind: 'vault', sectorKey: vault.sectorKey, travel: vault.travel };
    }
    if (accumulator.kind === 'warden') {
      const arena = inputs.map.sectors.get(inputs.map.bossArenaKey);
      if (!arena || inputs.sectorFlagsOf(arena.key) === 0) return { kind: 'unfound' };
      return {
        kind: 'wardenArena',
        sectorKey: arena.key,
        travel: travelOf(courseTo(inputs, arena.key)),
      };
    }
    const quest = getQuestForKeyId(accumulator.id);
    if (!quest) return { kind: 'unfound' };
    const state = inputs.questStateOf(quest.id);
    if (state.kind === 'active') {
      return { kind: 'questActive', stepNumber: state.stepNumber, stepCount: state.stepCount };
    }
    if (state.kind === 'slotsFull') return { kind: 'questSlotsFull' };
    if (state.kind === 'unoffered') return { kind: 'unfound' };
    const seen = boardOnce();
    return seen === null
      ? { kind: 'unfound' }
      : { kind: 'questBoard', sectorKey: seen.sectorKey, travel: seen.travel };
  };

  const sourceTravel = (source: LockoutSource): LockoutTravel | null =>
    source.kind === 'vault' || source.kind === 'questBoard' || source.kind === 'wardenArena'
      ? source.travel
      : null;

  const built: LockoutRow[] = [...rows.values()].map(accumulator => ({
    ...accumulator,
    source: sourceFor(accumulator),
  }));
  // A row you can act on now outranks one whose source is still unfound, at the same opening
  // count: the panel is a plan, so the actionable line goes first. A source the chart knows but
  // cannot route to is as unactionable as no source at all and sinks with it, while a GATED one
  // does not, because going and earning that gate IS the plan.
  const actionRank = (row: LockoutRow): number => {
    if (row.source.kind === 'unfound') return 2;
    return sourceTravel(row.source)?.kind === 'none' ? 1 : 0;
  };
  return built.sort((a, b) =>
    (b.doors + b.sites + b.shortcuts) - (a.doors + a.sites + a.shortcuts)
    || actionRank(a) - actionRank(b)
    || a.nearestDistance - b.nearestDistance
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
