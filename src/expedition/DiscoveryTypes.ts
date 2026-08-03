/**
 * DiscoveryTypes: what a profile remembers about the shape of the expedition world.
 *
 * Flags are bitmask numbers rather than boolean objects on purpose: they sanitize with a
 * single `& VALID_MASK`, they keep the stored payload roughly a fifth the size, and an
 * implication like "visited implies discovered" is one bit-or instead of a branch.
 */

export const DISCOVERY_VERSION = 1;

export const SectorFlags = {
  /** On the map as an outline: seen from a neighbour, never entered. */
  DISCOVERED: 1 << 0,
  /** The ship has been inside it, so its interior may render. */
  VISITED: 1 << 1,
  /** Its encounter was cleared in at least one run. No writer until the sector director. */
  CLEARED_ONCE: 1 << 2,
} as const;
export const SECTOR_VALID_MASK = 0b111;

export const EdgeFlags = {
  KNOWN: 1 << 0,
  TRAVERSED: 1 << 1,
} as const;
export const EDGE_VALID_MASK = 0b11;

export const PoiFlags = {
  SEEN: 1 << 0,
  COLLECTED: 1 << 1,
  /** Its placed guard encounter was killed. Permanent per world: the fight is never re-run. */
  GUARD_CLEARED: 1 << 2,
  /** This Treasure slot is one of the world's permanent hives, and the ship has been in the
   *  room. Permanent per world because the hive is: poiRoll draws hive-ness off the world
   *  seed alone, so the marker cannot outlive what it names. */
  HAZARD_NEST: 1 << 3,
} as const;
export const POI_VALID_MASK = 0b1111;

export const SecretFlags = {
  HINTED: 1 << 0,
  FOUND: 1 << 1,
  /** This profile walked into this cache and it refused, because the cache is its region's vault
   *  and the region is unfinished. Implies nothing and is implied by nothing: it records a place
   *  the ship has personally stood, which is a weaker claim than FOUND (the cache is still there
   *  to claim, and getFoundSecretCount reads FOUND only, so the completion percent cannot move)
   *  and a different claim from HINTED (a lead points into a region; this is a sighting). */
  VAULT_SEEN: 1 << 2,
} as const;
export const SECRET_VALID_MASK = 0b111;

/**
 * Bound to a world by seed AND generator version, the pair WorldProfileStore already keys
 * on: a different generator names sectors that no longer exist, so the state is discarded
 * rather than migrated.
 */
export interface DiscoveryState {
  version: number;
  worldSeed: number;
  worldGenVersion: number;
  sectors: Record<string, number>;
  edges: Record<string, number>;
  pois: Record<string, number>;
  secrets: Record<string, number>;
}

/** What a single reveal actually added. Also the feedback contract a later chunk reads. */
export interface DiscoveryChanges {
  sectorsDiscovered: string[];
  sectorsVisited: string[];
  edgesKnown: string[];
  edgesTraversed: string[];
  poisSeen: string[];
  poisCollected: string[];
  poisGuardCleared: string[];
  poisHazardNest: string[];
  secretsHinted: string[];
  secretsFound: string[];
  secretsVaultSeen: string[];
}

export function emptyChanges(): DiscoveryChanges {
  return {
    sectorsDiscovered: [],
    sectorsVisited: [],
    edgesKnown: [],
    edgesTraversed: [],
    poisSeen: [],
    poisCollected: [],
    poisGuardCleared: [],
    poisHazardNest: [],
    secretsHinted: [],
    secretsFound: [],
    secretsVaultSeen: [],
  };
}

export function hasChanges(changes: DiscoveryChanges): boolean {
  return changes.sectorsDiscovered.length > 0
    || changes.sectorsVisited.length > 0
    || changes.edgesKnown.length > 0
    || changes.edgesTraversed.length > 0
    || changes.poisSeen.length > 0
    || changes.poisCollected.length > 0
    || changes.poisGuardCleared.length > 0
    || changes.poisHazardNest.length > 0
    || changes.secretsHinted.length > 0
    || changes.secretsFound.length > 0
    || changes.secretsVaultSeen.length > 0;
}
