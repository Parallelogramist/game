/**
 * The discovery rules fail silently when they are wrong: a sanitizer that drops the wrong
 * key, a reveal that leaks across a wall, or a repair that forgets an implication all still
 * return a plausible-looking state, and the only symptom is a map that quietly lies. These
 * nine pin the four behaviours with that failure mode: the id universe, what entry reveals,
 * what traversal reveals, and what a tampered payload comes back as.
 */

import { describe, it, expect } from 'vitest';
import {
  EdgeKind, PoiKind, SECTOR_TILE_COUNT, TileKind, WALL_EDGE,
} from '../world/worldTypes';
import type { EdgeDef, EdgeDirection, PoiSlot, SectorDef, WorldMap } from '../world/worldTypes';
import {
  DISCOVERY_VERSION, EdgeFlags, PoiFlags, SecretFlags, SectorFlags, emptyChanges,
} from './DiscoveryTypes';
import {
  buildIdUniverse, emptyDiscoveryState, revealOnEdgeTraversal, revealOnSecretFound,
  revealOnSectorEntry, sanitizeDiscoveryState,
} from './discoveryRules';

const OPEN_EDGE: EdgeDef = { kind: EdgeKind.Open, apertureStart: 10, apertureEnd: 13 };
const SEED = 1;
const GEN_VERSION = 1;
const PLAIN_POI_ID = 'poi:0,0:0';
const SECRET_POI_ID = 'poi:0,0:1';
const SHARED_EDGE_ID = 'edge:0,0:east';

function makeSector(
  sx: number, sy: number,
  edges: Partial<Record<EdgeDirection, EdgeDef>>,
  poiSlots: PoiSlot[] = [],
): SectorDef {
  return {
    sx, sy, key: `${sx},${sy}`, biomeId: 'stage_deep_void', danger: 0,
    tiles: new Uint8Array(SECTOR_TILE_COUNT).fill(TileKind.Open),
    edges: {
      north: edges.north ?? WALL_EDGE, east: edges.east ?? WALL_EDGE,
      south: edges.south ?? WALL_EDGE, west: edges.west ?? WALL_EDGE,
    },
    poiSlots, isStart: sx === 0 && sy === 0, isBossArena: false, depth: 0,
    entryTiles: {}, breakables: [],
  };
}

function makeWorld(seed = SEED, worldGenVersion = GEN_VERSION): WorldMap {
  const origin = makeSector(0, 0, { east: OPEN_EDGE }, [
    { id: PLAIN_POI_ID, kind: PoiKind.Treasure, tileX: 5, tileY: 5 },
    { id: SECRET_POI_ID, kind: PoiKind.Secret, tileX: 9, tileY: 9 },
  ]);
  const east = makeSector(1, 0, { west: OPEN_EDGE });
  const south = makeSector(0, 1, {});
  return {
    worldGenVersion, seed, startKey: '0,0',
    sectors: new Map([['0,0', origin], ['1,0', east], ['0,1', south]]),
    abilityOrder: [], bossArenaKey: '1,0',
  };
}

describe('discoveryRules', () => {
  it('collects sector keys, canonical edge ids, poi ids and secret ids', () => {
    const universe = buildIdUniverse(makeWorld());

    expect([...universe.sectorKeys].sort()).toEqual(['0,0', '0,1', '1,0']);
    expect([...universe.edgeIds]).toEqual([SHARED_EDGE_ID]);
    expect([...universe.poiIds]).toEqual([PLAIN_POI_ID]);
    expect([...universe.secretIds]).toEqual([SECRET_POI_ID]);
    expect(universe.overCap).toBe(false);
  });

  it('entering a sector marks it visited and discovered', () => {
    const map = makeWorld();
    const universe = buildIdUniverse(map);
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    const changes = revealOnSectorEntry(state, map, universe, '0,0');

    expect(state.sectors['0,0']).toBe(SectorFlags.VISITED | SectorFlags.DISCOVERED);
    expect(changes.sectorsVisited).toEqual(['0,0']);
    expect(changes.sectorsDiscovered).toContain('0,0');
  });

  it('entering a sector makes its open borders known and peeks at the neighbour', () => {
    const map = makeWorld();
    const universe = buildIdUniverse(map);
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    const changes = revealOnSectorEntry(state, map, universe, '0,0');

    expect(state.edges[SHARED_EDGE_ID]).toBe(EdgeFlags.KNOWN);
    expect(changes.edgesKnown).toEqual([SHARED_EDGE_ID]);
    expect(state.sectors['1,0']).toBe(SectorFlags.DISCOVERED);
    expect(state.sectors['1,0'] & SectorFlags.VISITED).toBe(0);
    expect(changes.sectorsVisited).not.toContain('1,0');
  });

  it('entering a sector does not reveal anything across a wall border', () => {
    const map = makeWorld();
    const universe = buildIdUniverse(map);
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    revealOnSectorEntry(state, map, universe, '0,0');

    expect(state.sectors['0,1'] ?? 0).toBe(0);
  });

  it('entering a sector sees its plain poi slots and not its secret slots', () => {
    const map = makeWorld();
    const universe = buildIdUniverse(map);
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    const changes = revealOnSectorEntry(state, map, universe, '0,0');

    expect(state.pois[PLAIN_POI_ID]).toBe(PoiFlags.SEEN);
    expect(changes.poisSeen).toEqual([PLAIN_POI_ID]);
    expect(state.pois[SECRET_POI_ID]).toBeUndefined();
    expect(state.secrets).toEqual({});
  });

  it('re-entering a known sector reports no change', () => {
    const map = makeWorld();
    const universe = buildIdUniverse(map);
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    revealOnSectorEntry(state, map, universe, '0,0');
    const second = revealOnSectorEntry(state, map, universe, '0,0');

    expect(second).toEqual(emptyChanges());
  });

  it('traversing an edge marks it traversed and known', () => {
    const universe = buildIdUniverse(makeWorld());
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    const changes = revealOnEdgeTraversal(state, universe, SHARED_EDGE_ID);

    expect(state.edges[SHARED_EDGE_ID]).toBe(EdgeFlags.TRAVERSED | EdgeFlags.KNOWN);
    expect(changes.edgesTraversed).toEqual([SHARED_EDGE_ID]);
    expect(changes.edgesKnown).toEqual([SHARED_EDGE_ID]);

    const ignored = revealOnEdgeTraversal(state, universe, 'edge:9,9:north');

    expect(ignored).toEqual(emptyChanges());
    expect(state.edges['edge:9,9:north'] ?? 0).toBe(0);
  });

  it('sanitizing drops unknown ids and junk values and clamps to the mask', () => {
    const universe = buildIdUniverse(makeWorld());
    const raw = {
      version: DISCOVERY_VERSION,
      worldSeed: SEED,
      worldGenVersion: GEN_VERSION,
      sectors: { '0,0': 255, '1,0': 1.9, '0,1': 'nope', '99,99': 3 },
      edges: { [SHARED_EDGE_ID]: -1, 'edge:9,9:north': 3 },
      pois: { [PLAIN_POI_ID]: 7 },
      secrets: { [SECRET_POI_ID]: Number.NaN },
    };

    const state = sanitizeDiscoveryState(raw, SEED, GEN_VERSION, universe);

    expect(Object.keys(state.sectors).sort()).toEqual(['0,0', '1,0']);
    expect(state.sectors['0,0']).toBe(0b111);
    expect(state.sectors['1,0']).toBe(SectorFlags.DISCOVERED);
    expect(Object.keys(state.edges)).toEqual([SHARED_EDGE_ID]);
    expect(state.edges[SHARED_EDGE_ID]).toBe(0b11);
    expect(state.pois[PLAIN_POI_ID]).toBe(0b11);
    expect(state.secrets).toEqual({});
  });

  it('sanitizing repairs implications and resets on a foreign version or seed', () => {
    const universe = buildIdUniverse(makeWorld());
    const stored = {
      version: DISCOVERY_VERSION,
      worldSeed: SEED,
      worldGenVersion: GEN_VERSION,
      sectors: { '0,0': SectorFlags.VISITED },
      edges: { [SHARED_EDGE_ID]: EdgeFlags.TRAVERSED },
      pois: {},
      secrets: {},
    };

    const repaired = sanitizeDiscoveryState(stored, SEED, GEN_VERSION, universe);

    expect(repaired.sectors['0,0']).toBe(SectorFlags.VISITED | SectorFlags.DISCOVERED);
    expect(repaired.edges[SHARED_EDGE_ID]).toBe(EdgeFlags.TRAVERSED | EdgeFlags.KNOWN);

    const fresh = emptyDiscoveryState(SEED, GEN_VERSION);
    expect(sanitizeDiscoveryState(
      { ...stored, version: DISCOVERY_VERSION + 1 }, SEED, GEN_VERSION, universe,
    )).toEqual(fresh);
    expect(sanitizeDiscoveryState(
      { ...stored, worldSeed: SEED + 1 }, SEED, GEN_VERSION, universe,
    )).toEqual(fresh);
    expect(sanitizeDiscoveryState('not an object', SEED, GEN_VERSION, universe)).toEqual(fresh);
  });
});

describe('revealOnSecretFound', () => {
  it('finds a known secret and marks it found and hinted', () => {
    const universe = buildIdUniverse(makeWorld());
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    const changes = revealOnSecretFound(state, universe, SECRET_POI_ID);

    expect(changes.secretsFound).toEqual([SECRET_POI_ID]);
    expect(state.secrets[SECRET_POI_ID] & SecretFlags.FOUND).toBe(SecretFlags.FOUND);
    expect(state.secrets[SECRET_POI_ID] & SecretFlags.HINTED).toBe(SecretFlags.HINTED);
  });

  it('re-finding the same secret changes nothing', () => {
    const universe = buildIdUniverse(makeWorld());
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    revealOnSecretFound(state, universe, SECRET_POI_ID);
    const changes = revealOnSecretFound(state, universe, SECRET_POI_ID);

    expect(changes.secretsFound).toEqual([]);
    expect(changes.secretsHinted).toEqual([]);
  });

  it('rejects a secret id the world does not carry', () => {
    const universe = buildIdUniverse(makeWorld());
    const state = emptyDiscoveryState(SEED, GEN_VERSION);

    const changes = revealOnSecretFound(state, universe, 'poi:9,9:9');

    expect(changes).toEqual(emptyChanges());
    expect(state.secrets['poi:9,9:9']).toBeUndefined();
  });
});
