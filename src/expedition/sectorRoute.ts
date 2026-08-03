/**
 * sectorRoute: how the ship actually gets from the room it is in to the room the chart is
 * focused on, through the doors this profile can open.
 *
 * Pure and Phaser-free like the rest of src/expedition/. Every distance the chart printed
 * before this module was a straight line: lockouts' sectorDistance is Chebyshev over the grid
 * and sectorDetail's "jumps out" is generation depth from the hangar, and neither knows about
 * a wall, a one-way membrane or a door this profile cannot open.
 *
 * The course is planned over the CHART, never over the world. A sector is a node only when its
 * flags are non-zero (exactly SectorMapRenderer's `flags === 0` skip) and an edge is crossable
 * only when it is KNOWN (exactly the rule describeDoors and drawDoors take), so a plotted line
 * can never cross a border the chart refuses to draw.
 */

import { EDGE_DIRECTIONS, EdgeKind, directionDelta, edgeIdFor } from '../world/worldTypes';
import type { EdgeDef, EdgeDirection, SectorDef, WorldMap } from '../world/worldTypes';
import { EdgeFlags } from './DiscoveryTypes';
import { getTraversalAbility } from '../data/TraversalAbilities';
import { WARDEN_SEAL_KEY_ID, WARDEN_SEAL_LABEL, getQuestForKeyId } from '../data/ExpeditionQuests';

/** How many gates a blocked course names before it summarises the rest. Two keeps the detail
 *  bar's headline to one line beside the clauses it already carries. */
const MAX_NAMED_REQUIREMENTS = 2;

export interface SectorCourseInputs {
  map: WorldMap;
  /** The room the ship is standing in. */
  fromSectorKey: string;
  /** The focused room. */
  toSectorKey: string;
  sectorFlagsOf: (sectorKey: string) => number;
  edgeFlagsOf: (edgeId: string) => number;
  /** Predicates rather than Sets, matching lockouts and sectorDetail: this module never learns
   *  where ownership is stored. */
  holdsAbility: (abilityId: string) => boolean;
  holdsQuestKey: (keyId: string) => boolean;
}

export type SectorCourse =
  /** The focused room IS the ship's room. */
  | { kind: 'here' }
  /** A route the ship can fly right now. Origin first, focused room last, inclusive. */
  | { kind: 'plotted'; sectorKeys: string[] }
  /** A charted route exists but at least one door on it is shut to this profile. Same shape as
   *  plotted, so the chart can draw the intent, plus what would open it. */
  | { kind: 'blocked'; sectorKeys: string[]; requirements: string[] }
  /** Nothing the chart knows about connects the two rooms, in either passability. */
  | { kind: 'none' };

/** The same two branches SectorMapRenderer's isGatedEdgeSealed and sectorDetail's
 *  requirementSuffix take, so the lock ring the chart draws on a door, the readout's door line
 *  and this course can never disagree about that one door. */
function holdsGate(
  edge: EdgeDef,
  holdsAbility: (abilityId: string) => boolean,
  holdsQuestKey: (keyId: string) => boolean,
): boolean {
  if (edge.kind === EdgeKind.AbilityDoor) {
    return edge.requiredId !== undefined && holdsAbility(edge.requiredId);
  }
  if (edge.kind === EdgeKind.KeyDoor) {
    return edge.requiredId !== undefined && holdsQuestKey(edge.requiredId);
  }
  return true;
}

/** What a shut door wants, in the player's own words. Null for a kind that wants nothing. */
function gateRequirementLabel(edge: EdgeDef): string | null {
  if (edge.kind === EdgeKind.AbilityDoor) {
    if (edge.requiredId === undefined) return 'an unknown mechanism';
    return getTraversalAbility(edge.requiredId)?.name ?? 'an unknown mechanism';
  }
  if (edge.kind === EdgeKind.KeyDoor) {
    if (edge.requiredId === undefined) return 'an unknown mechanism';
    if (edge.requiredId === WARDEN_SEAL_KEY_ID) return WARDEN_SEAL_LABEL;
    return getQuestForKeyId(edge.requiredId)?.name ?? 'an unknown mechanism';
  }
  return null;
}

function canTravel(
  edge: EdgeDef,
  direction: EdgeDirection,
  inputs: SectorCourseInputs,
  ignoreGates: boolean,
): boolean {
  if (edge.kind === EdgeKind.Wall) return false;
  // A membrane is not something the profile can go and earn, so the relaxed pass keeps it hard:
  // relaxing it would report a course "blocked by" nothing at all.
  if (edge.kind === EdgeKind.OneWay) return edge.passDirection === direction;
  if (edge.kind === EdgeKind.AbilityDoor || edge.kind === EdgeKind.KeyDoor) {
    return ignoreGates || holdsGate(edge, inputs.holdsAbility, inputs.holdsQuestKey);
  }
  // Open and Breakable. requirementSuffix names no requirement for a breakable border either:
  // any wall-clipping weapon opens it, and the emanate-only ships are the separate gap
  // CHORE-SECRET-WALL-EMANATE-LOCKOUT already tracks.
  return true;
}

/** Breadth-first over the charted graph, so the first route found is a shortest one in hops. */
function walk(inputs: SectorCourseInputs, ignoreGates: boolean): string[] | null {
  const { map, fromSectorKey, toSectorKey } = inputs;
  const cameFrom = new Map<string, string>();
  const seen = new Set<string>([fromSectorKey]);
  const queue: string[] = [fromSectorKey];
  for (let head = 0; head < queue.length; head++) {
    const sectorKey = queue[head];
    if (sectorKey === toSectorKey) {
      const path = [sectorKey];
      for (let step = cameFrom.get(sectorKey); step !== undefined; step = cameFrom.get(step)) {
        path.push(step);
      }
      return path.reverse();
    }
    const sector = map.sectors.get(sectorKey);
    if (sector === undefined) continue;
    for (const direction of EDGE_DIRECTIONS) {
      const edge = sector.edges[direction];
      if (!canTravel(edge, direction, inputs, ignoreGates)) continue;
      const { dsx, dsy } = directionDelta(direction);
      const neighbourKey = `${sector.sx + dsx},${sector.sy + dsy}`;
      if (seen.has(neighbourKey)) continue;
      if (!map.sectors.has(neighbourKey)) continue;
      if (inputs.sectorFlagsOf(neighbourKey) === 0) continue;
      const edgeId = edgeIdFor(sector.sx, sector.sy, direction);
      if ((inputs.edgeFlagsOf(edgeId) & EdgeFlags.KNOWN) === 0) continue;
      seen.add(neighbourKey);
      cameFrom.set(neighbourKey, sectorKey);
      queue.push(neighbourKey);
    }
  }
  return null;
}

function directionToward(sector: SectorDef, neighbourKey: string): EdgeDirection | null {
  for (const direction of EDGE_DIRECTIONS) {
    const { dsx, dsy } = directionDelta(direction);
    if (`${sector.sx + dsx},${sector.sy + dsy}` === neighbourKey) return direction;
  }
  return null;
}

/** Every shut gate along a relaxed route, deduped, in the order the ship would meet them. */
function requirementsAlong(inputs: SectorCourseInputs, path: readonly string[]): string[] {
  const names: string[] = [];
  for (let step = 0; step + 1 < path.length; step++) {
    const sector = inputs.map.sectors.get(path[step]);
    if (sector === undefined) continue;
    const direction = directionToward(sector, path[step + 1]);
    if (direction === null) continue;
    const edge = sector.edges[direction];
    if (holdsGate(edge, inputs.holdsAbility, inputs.holdsQuestKey)) continue;
    const label = gateRequirementLabel(edge);
    if (label !== null && !names.includes(label)) names.push(label);
  }
  return names;
}

export function plotSectorCourse(inputs: SectorCourseInputs): SectorCourse {
  const { map, fromSectorKey, toSectorKey } = inputs;
  if (!map.sectors.has(fromSectorKey) || !map.sectors.has(toSectorKey)) return { kind: 'none' };
  if (inputs.sectorFlagsOf(fromSectorKey) === 0) return { kind: 'none' };
  if (inputs.sectorFlagsOf(toSectorKey) === 0) return { kind: 'none' };
  if (fromSectorKey === toSectorKey) return { kind: 'here' };

  const open = walk(inputs, false);
  if (open !== null) return { kind: 'plotted', sectorKeys: open };

  const relaxed = walk(inputs, true);
  if (relaxed === null) return { kind: 'none' };
  return {
    kind: 'blocked',
    sectorKeys: relaxed,
    requirements: requirementsAlong(inputs, relaxed),
  };
}

/** Sentence case, like every other src/expedition/ describer: the map screen uppercases. */
export function describeSectorCourse(course: SectorCourse): string {
  if (course.kind === 'here') return 'You are here';
  if (course.kind === 'none') return 'No charted course';
  const hops = course.sectorKeys.length - 1;
  const legs = `Course ${hops} ${hops === 1 ? 'hop' : 'hops'}`;
  if (course.kind === 'plotted') return legs;
  if (course.requirements.length === 0) return `${legs} · blocked`;
  const named = course.requirements.slice(0, MAX_NAMED_REQUIREMENTS);
  const unnamed = course.requirements.length - named.length;
  return `${legs} · blocked by ${named.join(', ')}${unnamed > 0 ? ` +${unnamed} more` : ''}`;
}
