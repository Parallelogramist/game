/**
 * secretHints: hint tier 2 from doc 04 section 5.
 *
 * A found secret hands over a lore fragment whose riddle names a REAL sector of the player's
 * own world, and the secret it names is marked HINTED so the chart and the map screen can
 * point at it. Pure: no Phaser, no manager, no storage. The caller supplies what the profile
 * already knows, so this module cannot leak anything the caller did not hand it.
 */

import { EDGE_DIRECTIONS, EdgeKind, PoiKind } from '../world/worldTypes';
import type { SectorDef, WorldMap } from '../world/worldTypes';
import { buildSecretPuzzle, describePuzzleSequence } from '../world/secretPuzzles';
import { getStageById } from '../data/Stages';
import { hashStringToSeed } from '../utils/dailySeed';
import { LORE_FRAGMENTS } from '../data/LoreFragments';
import type { LoreFragmentDefinition } from '../data/LoreFragments';

/** How many of the nearest candidates the hash may choose between. Always-nearest makes every
 *  lead predictable; the whole world makes a lead a cross-map errand. */
const HINT_CANDIDATE_POOL = 3;

export interface SecretHintInputs {
  map: WorldMap;
  /** Secrets already FOUND or HINTED. Neither is worth pointing at again. */
  knownSecretIds: ReadonlySet<string>;
  /** Sector keys the ship has been inside. A hidden sector outside this set is off limits: a
   *  lead into one would answer the question its breakable wall exists to ask. */
  visitedSectorKeys: ReadonlySet<string>;
  /** PoiSlot id of the cache just claimed, or SectorDef.key for a hidden sector. */
  sourceSecretId: string;
}

export interface SecretLead {
  secretId: string;
  sectorKey: string;
  /** Graph distance from the hangar: the number the riddle quotes. */
  depth: number;
  fragment: LoreFragmentDefinition;
  riddle: string;
  /** Present only when the named cache is sealed: the order its ring wakes in. */
  sigils?: string;
}

export function findSecretSector(map: WorldMap, secretId: string): SectorDef | null {
  for (const sector of map.sectors.values()) {
    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret && slot.id === secretId) return sector;
    }
  }
  return null;
}

/**
 * The secret a find points at next, or null when the world has nothing left to name.
 * Deterministic per (world seed, source secret): re-running it never moves the lead.
 */
export function chooseHintTarget(inputs: SecretHintInputs): string | null {
  const { map, knownSecretIds, visitedSectorKeys, sourceSecretId } = inputs;
  // A hidden sector's key is passed as the source id, so fall back to the sector lookup.
  const sourceSector = findSecretSector(map, sourceSecretId)
    ?? map.sectors.get(sourceSecretId)
    ?? null;

  const candidates: { secretId: string; distance: number }[] = [];
  for (const sector of map.sectors.values()) {
    if (sector.hidden === true && !visitedSectorKeys.has(sector.key)) continue;
    for (const slot of sector.poiSlots) {
      if (slot.kind !== PoiKind.Secret) continue;
      if (slot.id === sourceSecretId) continue;
      if (knownSecretIds.has(slot.id)) continue;
      candidates.push({
        secretId: slot.id,
        distance: sourceSector
          ? Math.max(Math.abs(sector.sx - sourceSector.sx), Math.abs(sector.sy - sourceSector.sy))
          : sector.depth,
      });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.distance - b.distance
    || (a.secretId < b.secretId ? -1 : a.secretId > b.secretId ? 1 : 0));
  const pool = candidates.slice(0, HINT_CANDIDATE_POOL);
  const index = hashStringToSeed(`secretHint:${map.seed}:${sourceSecretId}`) % pool.length;
  return pool[index].secretId;
}

/** No run salt, the secretRewards.ts reasoning: a lead is read again every time the map screen
 *  opens, so a per-run roll would make the same fragment change its name mid-hunt. */
export function loreFragmentFor(worldSeed: number, secretId: string): LoreFragmentDefinition {
  const index = hashStringToSeed(`secretLore:${worldSeed}:${secretId}`) % LORE_FRAGMENTS.length;
  return LORE_FRAGMENTS[index];
}

export function buildSecretLead(map: WorldMap, secretId: string): SecretLead | null {
  const sector = findSecretSector(map, secretId);
  if (!sector) return null;
  const puzzle = buildSecretPuzzle({
    worldSeed: map.seed, secretId, depth: sector.depth,
  });
  return {
    secretId,
    sectorKey: sector.key,
    depth: sector.depth,
    fragment: loreFragmentFor(map.seed, secretId),
    riddle: describeSecretLocation(map, sector),
    ...(puzzle ? { sigils: describePuzzleSequence(puzzle) } : {}),
  };
}

/**
 * The riddle. Every clause is read off the sector itself (shape, bearing from the hangar,
 * graph depth, biome), so it is true of the world by construction rather than by an author
 * remembering to keep it true.
 */
export function describeSecretLocation(map: WorldMap, sector: SectorDef): string {
  const landmark = landmarkPhrase(sector);
  const biome = biomePhrase(sector.biomeId);
  if (sector.key === map.startKey) return `${landmark} in the hangar itself, ${biome}.`;

  const start = map.sectors.get(map.startKey);
  const bearing = start ? bearingPhrase(sector.sx - start.sx, sector.sy - start.sy) : '';
  const jumps = sector.depth === 1 ? '1 jump out' : `${sector.depth} jumps out`;
  return bearing
    ? `${landmark} ${bearing} of the hangar, ${jumps}, ${biome}.`
    : `${landmark} ${jumps} from the hangar, ${biome}.`;
}

function landmarkPhrase(sector: SectorDef): string {
  if (sector.isBossArena) return 'The arena floor';
  let ways = 0;
  for (const direction of EDGE_DIRECTIONS) {
    if (sector.edges[direction].kind !== EdgeKind.Wall) ways++;
  }
  if (ways <= 1) return 'A dead end';
  if (ways === 2) return 'A stretch of corridor';
  if (ways === 3) return 'A three-way junction';
  return 'Where four ways cross';
}

function biomePhrase(biomeId: string): string {
  const stage = getStageById(biomeId);
  return stage ? `in the ${stage.name}` : 'in uncharted space';
}

/** Lattice rows grow south, so a negative dy is north. */
function bearingPhrase(dx: number, dy: number): string {
  const vertical = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const horizontal = dx < 0 ? 'west' : dx > 0 ? 'east' : '';
  if (vertical && horizontal) return `${vertical}-${horizontal}`;
  return vertical || horizontal;
}
