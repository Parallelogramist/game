/**
 * discoveryRules: the pure half of expedition discovery.
 *
 * The rules APPLY and REPORT rather than proposing a delta the caller then applies. Doc 03
 * section 1.4 describes them as pure `(state, index, args) -> DiscoveryChanges`; applying in
 * place is the deliberate deviation, because it makes "re-entering a known sector changes
 * nothing" provable from the returned delta alone and removes the second code path in which
 * a manager could double-apply or forget to apply.
 *
 * There is no WorldMapIndex. Doc 03 contract 11.2 asked doc 02 for one before doc 02's
 * generator existed; the shipped WorldMap already carries every id (sector keys, canonical
 * edge ids, POI slot ids), so a second parallel index would be duplicate state.
 */

import {
  EDGE_DIRECTIONS,
  EdgeKind,
  PoiKind,
  directionDelta,
  edgeIdFor,
} from '../world/worldTypes';
import type { WorldMap } from '../world/worldTypes';
import {
  DISCOVERY_VERSION,
  EDGE_VALID_MASK,
  EdgeFlags,
  POI_VALID_MASK,
  PoiFlags,
  SECRET_VALID_MASK,
  SECTOR_VALID_MASK,
  SecretFlags,
  SectorFlags,
  emptyChanges,
} from './DiscoveryTypes';
import type { DiscoveryChanges, DiscoveryState } from './DiscoveryTypes';

/** Ceiling on the ids one world may carry, so a generator bug cannot balloon the save. */
export const MAX_DISCOVERY_IDS = 5000;

export interface WorldIdUniverse {
  sectorKeys: Set<string>;
  edgeIds: Set<string>;
  poiIds: Set<string>;
  secretIds: Set<string>;
  hiddenSectorKeys: Set<string>;
  overCap: boolean;
}

export function emptyIdUniverse(): WorldIdUniverse {
  return {
    sectorKeys: new Set(),
    edgeIds: new Set(),
    poiIds: new Set(),
    secretIds: new Set(),
    hiddenSectorKeys: new Set(),
    overCap: false,
  };
}

/**
 * A Wall edge is not an id: a border with no aperture is not a door the player can ever
 * learn about, and admitting one would let the map draw a passage that does not exist.
 */
export function buildIdUniverse(map: WorldMap): WorldIdUniverse {
  const universe = emptyIdUniverse();
  for (const sector of map.sectors.values()) {
    universe.sectorKeys.add(sector.key);
    if (sector.hidden === true) universe.hiddenSectorKeys.add(sector.key);
    for (const direction of EDGE_DIRECTIONS) {
      if (sector.edges[direction].kind === EdgeKind.Wall) continue;
      universe.edgeIds.add(edgeIdFor(sector.sx, sector.sy, direction));
    }
    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret) universe.secretIds.add(slot.id);
      else universe.poiIds.add(slot.id);
    }
  }
  const total = universe.sectorKeys.size + universe.edgeIds.size
    + universe.poiIds.size + universe.secretIds.size;
  universe.overCap = total > MAX_DISCOVERY_IDS;
  return universe;
}

export function emptyDiscoveryState(worldSeed: number, worldGenVersion: number): DiscoveryState {
  return {
    version: DISCOVERY_VERSION,
    worldSeed,
    worldGenVersion,
    sectors: {},
    edges: {},
    pois: {},
    secrets: {},
  };
}

export function sanitizeDiscoveryState(
  raw: unknown,
  worldSeed: number,
  worldGenVersion: number,
  universe: WorldIdUniverse,
): DiscoveryState {
  const fresh = emptyDiscoveryState(worldSeed, worldGenVersion);
  if (universe.overCap) {
    console.warn(
      `[discovery] world carries more than ${MAX_DISCOVERY_IDS} ids; discovery disabled`,
    );
    return fresh;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fresh;
  const stored = raw as Partial<DiscoveryState>;
  if (stored.version !== DISCOVERY_VERSION) return fresh;
  if (stored.worldSeed !== worldSeed || stored.worldGenVersion !== worldGenVersion) return fresh;
  return {
    version: DISCOVERY_VERSION,
    worldSeed,
    worldGenVersion,
    sectors: sanitizeRecord(stored.sectors, universe.sectorKeys, SECTOR_VALID_MASK, repairSector),
    edges: sanitizeRecord(stored.edges, universe.edgeIds, EDGE_VALID_MASK, repairEdge),
    pois: sanitizeRecord(stored.pois, universe.poiIds, POI_VALID_MASK, repairPoi),
    secrets: sanitizeRecord(stored.secrets, universe.secretIds, SECRET_VALID_MASK, repairSecret),
  };
}

/**
 * Rebuilt by iterating the KNOWN ids rather than the stored keys (the sanitizeWeapons
 * pattern), so an injected key is dropped by construction rather than by a filter someone
 * has to remember to write.
 */
function sanitizeRecord(
  raw: unknown,
  known: ReadonlySet<string>,
  validMask: number,
  repair: (flags: number) => number,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result;
  const record = raw as Record<string, unknown>;
  for (const id of known) {
    const value = record[id];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const flags = repair(Math.trunc(value) & validMask);
    if (flags !== 0) result[id] = flags;
  }
  return result;
}

function repairSector(flags: number): number {
  return (flags & SectorFlags.VISITED) !== 0 ? flags | SectorFlags.DISCOVERED : flags;
}

function repairEdge(flags: number): number {
  return (flags & EdgeFlags.TRAVERSED) !== 0 ? flags | EdgeFlags.KNOWN : flags;
}

function repairPoi(flags: number): number {
  return (flags & (PoiFlags.COLLECTED | PoiFlags.GUARD_CLEARED)) !== 0
    ? flags | PoiFlags.SEEN
    : flags;
}

function repairSecret(flags: number): number {
  return (flags & SecretFlags.FOUND) !== 0 ? flags | SecretFlags.HINTED : flags;
}

export function revealOnSectorEntry(
  state: DiscoveryState,
  map: WorldMap,
  universe: WorldIdUniverse,
  enteredKey: string,
): DiscoveryChanges {
  const changes = emptyChanges();
  const sector = map.sectors.get(enteredKey);
  if (!sector || !universe.sectorKeys.has(enteredKey)) return changes;

  addSector(state, changes, enteredKey, SectorFlags.VISITED | SectorFlags.DISCOVERED);

  for (const direction of EDGE_DIRECTIONS) {
    if (sector.edges[direction].kind === EdgeKind.Wall) continue;
    const { dsx, dsy } = directionDelta(direction);
    const neighbourKey = `${sector.sx + dsx},${sector.sy + dsy}`;
    // A hidden sector is not on the chart until the ship is inside it, so neither its
    // outline nor the door into it may leak from next door: a drawn door pointing at blank
    // space would answer the question the room exists to ask. Entering it clears the guard
    // for good, because the sector is VISITED from that moment on.
    if (universe.hiddenSectorKeys.has(neighbourKey)
      && ((state.sectors[neighbourKey] ?? 0) & SectorFlags.VISITED) === 0) continue;
    const edgeId = edgeIdFor(sector.sx, sector.sy, direction);
    if (universe.edgeIds.has(edgeId)) addEdge(state, changes, edgeId, EdgeFlags.KNOWN);
    if (universe.sectorKeys.has(neighbourKey)) {
      addSector(state, changes, neighbourKey, SectorFlags.DISCOVERED);
    }
  }

  // A secret slot stays unseen from inside the room: that is the whole point of it. It
  // becomes HINTED or FOUND through its own path, never through walking in.
  for (const slot of sector.poiSlots) {
    if (slot.kind === PoiKind.Secret) continue;
    if (universe.poiIds.has(slot.id)) addPoi(state, changes, slot.id, PoiFlags.SEEN);
  }

  return changes;
}

export function revealOnEdgeTraversal(
  state: DiscoveryState,
  universe: WorldIdUniverse,
  edgeId: string,
): DiscoveryChanges {
  const changes = emptyChanges();
  if (!universe.edgeIds.has(edgeId)) return changes;
  addEdge(state, changes, edgeId, EdgeFlags.TRAVERSED | EdgeFlags.KNOWN);
  return changes;
}

export function revealOnPoiCollected(
  state: DiscoveryState,
  universe: WorldIdUniverse,
  poiId: string,
): DiscoveryChanges {
  const changes = emptyChanges();
  if (!universe.poiIds.has(poiId)) return changes;
  addPoi(state, changes, poiId, PoiFlags.COLLECTED | PoiFlags.SEEN);
  return changes;
}

/** Clearing a guard is permanent per world and implies SEEN: you cannot kill a pack around a
 *  core you never stood next to, and repairPoi already treats the pair as the repaired form. */
export function revealOnVaultGuardCleared(
  state: DiscoveryState,
  universe: WorldIdUniverse,
  poiId: string,
): DiscoveryChanges {
  const changes = emptyChanges();
  if (!universe.poiIds.has(poiId)) return changes;
  addPoi(state, changes, poiId, PoiFlags.GUARD_CLEARED | PoiFlags.SEEN);
  return changes;
}

/** Finding is permanent and implies hinted: repairSecret already treats FOUND without
 *  HINTED as corrupt, so writing both keeps a live state byte-identical to a reloaded one. */
export function revealOnSecretFound(
  state: DiscoveryState,
  universe: WorldIdUniverse,
  secretId: string,
): DiscoveryChanges {
  const changes = emptyChanges();
  if (!universe.secretIds.has(secretId)) return changes;
  addSecret(state, changes, secretId, SecretFlags.FOUND | SecretFlags.HINTED);
  return changes;
}

/** Hinted is a pointer, never a find: it says a secret is worth flying to and nothing about
 *  having reached it, so unlike revealOnSecretFound it must not imply FOUND. */
export function revealOnSecretHinted(
  state: DiscoveryState,
  universe: WorldIdUniverse,
  secretId: string,
): DiscoveryChanges {
  const changes = emptyChanges();
  if (!universe.secretIds.has(secretId)) return changes;
  addSecret(state, changes, secretId, SecretFlags.HINTED);
  return changes;
}

function addSector(
  state: DiscoveryState, changes: DiscoveryChanges, id: string, flags: number,
): void {
  const before = state.sectors[id] ?? 0;
  const after = before | flags;
  if (after === before) return;
  state.sectors[id] = after;
  const gained = after & ~before;
  if ((gained & SectorFlags.DISCOVERED) !== 0) changes.sectorsDiscovered.push(id);
  if ((gained & SectorFlags.VISITED) !== 0) changes.sectorsVisited.push(id);
}

function addEdge(
  state: DiscoveryState, changes: DiscoveryChanges, id: string, flags: number,
): void {
  const before = state.edges[id] ?? 0;
  const after = before | flags;
  if (after === before) return;
  state.edges[id] = after;
  const gained = after & ~before;
  if ((gained & EdgeFlags.KNOWN) !== 0) changes.edgesKnown.push(id);
  if ((gained & EdgeFlags.TRAVERSED) !== 0) changes.edgesTraversed.push(id);
}

function addPoi(
  state: DiscoveryState, changes: DiscoveryChanges, id: string, flags: number,
): void {
  const before = state.pois[id] ?? 0;
  const after = before | flags;
  if (after === before) return;
  state.pois[id] = after;
  const gained = after & ~before;
  if ((gained & PoiFlags.SEEN) !== 0) changes.poisSeen.push(id);
  if ((gained & PoiFlags.COLLECTED) !== 0) changes.poisCollected.push(id);
  if ((gained & PoiFlags.GUARD_CLEARED) !== 0) changes.poisGuardCleared.push(id);
}

function addSecret(
  state: DiscoveryState, changes: DiscoveryChanges, id: string, flags: number,
): void {
  const before = state.secrets[id] ?? 0;
  const after = before | flags;
  if (after === before) return;
  state.secrets[id] = after;
  const gained = after & ~before;
  if ((gained & SecretFlags.HINTED) !== 0) changes.secretsHinted.push(id);
  if ((gained & SecretFlags.FOUND) !== 0) changes.secretsFound.push(id);
}
