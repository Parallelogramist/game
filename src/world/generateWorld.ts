/**
 * generateWorld — the deterministic expedition world generator.
 *
 * Pure and total: one seed in, one world out, no retry loop and no repair pass.
 * Every property the game later depends on (edge reciprocity, gate-order
 * solvability, no unreachable reward) is a consequence of how the world is
 * built, not something a validator patches up afterwards. The invariants in
 * generateWorld.test.ts are therefore assertions about the algorithm being
 * implemented correctly, never a filter over candidate worlds.
 *
 * Phaser-free like the rest of src/world/: the only imports outside this
 * directory are src/utils/dailySeed, src/data/Stages and src/data/LoreFragments,
 * all dependency-free.
 */

import { getStageById } from '../data/Stages';
import { LORE_FRAGMENTS } from '../data/LoreFragments';
import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';
import { buildSectorInterior } from './sectorInterior';
import {
  DEFAULT_SECTOR_BUDGET,
  EDGE_DIRECTIONS,
  EdgeKind,
  PoiKind,
  SECTOR_TILE_COLS,
  SECTOR_TILE_ROWS,
  WALL_EDGE,
  WORLDGEN_VERSION,
  directionDelta,
  edgeIdFor,
  oppositeDirection,
} from './worldTypes';
import type {
  EdgeDef,
  EdgeDirection,
  SectorDef,
  SectorKey,
  WorldGenInputs,
  WorldMap,
} from './worldTypes';

const START_KEY: SectorKey = '0,0';
const SPINE_BIOME_ID = 'stage_deep_void';
const REGION_DEPTH_SPAN = 2;
const APERTURE_AXIS_MARGIN = 3;
const GATE_TIER_DANGER_STEP = 0.08;
const QUEST_DOOR_REGION_DIVISOR = 4;
const HIDDEN_SECTOR_COUNT_CAP = 8;

/** Grow depth-first enough that a nested gate has a large subtree to cut. A bushy tree caps
 *  a root child's subtree near a quarter of the world, which puts the equal-tier target out
 *  of reach for the first gate and compounds downward: measured over the invariant suite's
 *  100 seeds, 47 of 700 tiers opened one sector or fewer. */
const DEPTH_GROWTH_BIAS = 3;

/** An ability that opens one room reads as a non-reward, so a gate must leave at least this
 *  many sectors on its near side and room for every later gate to do the same. */
const MIN_GATE_TIER_SECTORS = 2;

interface GrowingSector {
  sx: number;
  sy: number;
  key: SectorKey;
  depth: number;
  parentKey: SectorKey | null;
  childKeys: SectorKey[];
  growthDirection: EdgeDirection | null;
  edges: Record<EdgeDirection, EdgeDef>;
  biomeId: string;
  danger: number;
  isBossArena: boolean;
}

interface FrontierCandidate {
  fromKey: SectorKey;
  direction: EdgeDirection;
}

type EdgeExtras = Partial<Pick<EdgeDef, 'requiredId' | 'passDirection'>>;

export function generateWorld(seed: number, inputs: WorldGenInputs): WorldMap {
  const budget = Math.max(4, Math.min(400,
    Math.floor(inputs.sectorBudget ?? DEFAULT_SECTOR_BUDGET)));
  const abilityIds = dedupePreservingOrder(inputs.abilityGateOrder);
  const topologyRng = mulberry32(hashStringToSeed(`world:${seed}:topology:v${WORLDGEN_VERSION}`));

  const makeEdge = (
    sx: number, sy: number, direction: EdgeDirection, kind: EdgeKind, extras: EdgeExtras = {}
  ): EdgeDef => {
    const edgeRng = mulberry32(hashStringToSeed(
      `edge:${seed}:${edgeIdFor(sx, sy, direction)}:v${WORLDGEN_VERSION}`));
    const axisLength = direction === 'north' || direction === 'south'
      ? SECTOR_TILE_COLS : SECTOR_TILE_ROWS;
    const width = 3 + Math.min(2, Math.floor(edgeRng() * 3));
    // Keep the span clear of the two perpendicular borders' own three depths:
    // an aperture reaching a corner would stamp its approach straight through
    // the neighbouring aperture's mouth, and the two kinds cannot both win.
    const placements = axisLength - 2 * APERTURE_AXIS_MARGIN - width + 1;
    const start = APERTURE_AXIS_MARGIN
      + Math.min(placements - 1, Math.floor(edgeRng() * placements));
    return { kind, apertureStart: start, apertureEnd: start + width - 1, ...extras };
  };

  const sectors = growSpanningTree(budget, topologyRng, makeEdge);
  const ordered = sortSectors(sectors);
  addLoopEdges(sectors, ordered, topologyRng, makeEdge);

  const { abilityOrder, abilitySlotBySector, gateSubtrees, finalRegion } =
    placeAbilityGates(sectors, ordered, abilityIds, topologyRng, makeEdge);
  plugLoopEdgesWithBreakables(sectors, ordered, topologyRng, makeEdge);

  const bossArenaKey = pickBossArenaKey(ordered, finalRegion);
  sectors.get(bossArenaKey)!.isBossArena = true;

  placeQuestKeyDoors(
    sectors, ordered, dedupePreservingOrder(inputs.questKeyOrder ?? []),
    abilitySlotBySector, bossArenaKey, makeEdge,
  );

  const hiddenSectorKeys = placeHiddenSectors(
    sectors, ordered,
    Math.max(0, Math.min(HIDDEN_SECTOR_COUNT_CAP,
      Math.floor(inputs.hiddenSectorCount ?? 0))),
    abilitySlotBySector, bossArenaKey, makeEdge,
  );

  assignDangerAndBiomes(ordered, gateSubtrees, inputs.availableBiomeIds);

  const sectorDefs = new Map<SectorKey, SectorDef>();
  for (const sector of ordered) {
    const sectorRng = mulberry32(hashStringToSeed(
      `sector:${seed}:${sector.sx},${sector.sy}:v${WORLDGEN_VERSION}`));
    const interior = buildSectorInterior({
      rng: sectorRng,
      sx: sector.sx,
      sy: sector.sy,
      edges: sector.edges,
      biomeId: sector.biomeId,
      danger: sector.danger,
      isStart: sector.key === START_KEY,
      isBossArena: sector.isBossArena,
      grantedAbilityIds: abilitySlotBySector.get(sector.key) ?? [],
      worldSeed: seed,
      depth: sector.depth,
    });
    sectorDefs.set(sector.key, {
      sx: sector.sx,
      sy: sector.sy,
      key: sector.key,
      biomeId: sector.biomeId,
      danger: sector.danger,
      tiles: interior.tiles,
      edges: sector.edges,
      poiSlots: interior.poiSlots,
      isStart: sector.key === START_KEY,
      isBossArena: sector.isBossArena,
      hidden: hiddenSectorKeys.has(sector.key),
      depth: sector.depth,
      entryTiles: interior.entryTiles,
      breakables: interior.breakables,
      gridBands: interior.gridBands,
    });
  }

  topUpSecretSlots(sectorDefs, ordered);

  // Layout is derived from the seed and is never where mutable state lives:
  // opened doors and broken walls belong to WorldProfileState, so a frozen
  // EdgeDef stops a later chunk from growing a second source of truth.
  for (const sector of ordered) {
    for (const direction of EDGE_DIRECTIONS) Object.freeze(sector.edges[direction]);
  }

  return {
    worldGenVersion: WORLDGEN_VERSION,
    seed,
    startKey: START_KEY,
    sectors: sectorDefs,
    abilityOrder,
    bossArenaKey,
  };
}

/** Hidden-lore collection is finishable only in a world holding a slot per catalog row, and
 *  one slot in four is drawn as a Secret, so most worlds fall short by luck: 125 of 200
 *  seeds held fewer than the catalog's 26 before this pass, the shipped seed landing on
 *  exactly 26 by accident. Converting spare Treasure slots in sector order, one per sector
 *  per round, spreads the top-up across the map and consumes no RNG. */
function topUpSecretSlots(
  sectorDefs: Map<SectorKey, SectorDef>, ordered: GrowingSector[]
): void {
  let secrets = 0;
  for (const sector of sectorDefs.values()) {
    for (const slot of sector.poiSlots) if (slot.kind === PoiKind.Secret) secrets++;
  }
  while (secrets < LORE_FRAGMENTS.length) {
    let converted = false;
    for (const growing of ordered) {
      if (secrets >= LORE_FRAGMENTS.length) break;
      const sector = sectorDefs.get(growing.key)!;
      if (sector.isBossArena) continue;
      const slot = sector.poiSlots.find(candidate => candidate.kind === PoiKind.Treasure);
      if (!slot) continue;
      slot.kind = PoiKind.Secret;
      secrets++;
      converted = true;
    }
    if (!converted) break;
  }
}

type EdgeFactory = (
  sx: number, sy: number, direction: EdgeDirection, kind: EdgeKind, extras?: EdgeExtras
) => EdgeDef;

function growSpanningTree(
  budget: number, topologyRng: () => number, makeEdge: EdgeFactory
): Map<SectorKey, GrowingSector> {
  const sectors = new Map<SectorKey, GrowingSector>();
  sectors.set(START_KEY, newGrowingSector(0, 0, 0, null, null));

  let frontier: FrontierCandidate[] = EDGE_DIRECTIONS.map(direction => ({
    fromKey: START_KEY, direction,
  }));
  const boxLimit = Math.max(2, Math.round(budget / 6));

  while (sectors.size < budget && frontier.length > 0) {
    frontier = frontier.filter(candidate => !sectors.has(targetKeyOf(sectors, candidate)));
    if (frontier.length === 0) break;

    const weights = frontier.map(candidate => {
      const from = sectors.get(candidate.fromKey)!;
      const { dsx, dsy } = directionDelta(candidate.direction);
      let weight = 1;
      if (candidate.direction === from.growthDirection) weight *= 3;
      if (Math.abs(from.sx + dsx) > boxLimit || Math.abs(from.sy + dsy) > boxLimit) weight *= 0.15;
      weight *= Math.pow(1 + from.depth, DEPTH_GROWTH_BIAS);
      return weight;
    });

    const picked = weightedPick(weights, topologyRng);
    const candidate = frontier[picked];
    frontier.splice(picked, 1);

    const from = sectors.get(candidate.fromKey)!;
    const { dsx, dsy } = directionDelta(candidate.direction);
    const target = newGrowingSector(
      from.sx + dsx, from.sy + dsy, from.depth + 1, from.key, candidate.direction);
    sectors.set(target.key, target);
    from.childKeys.push(target.key);

    const treeEdge = makeEdge(from.sx, from.sy, candidate.direction, EdgeKind.Open);
    from.edges[candidate.direction] = treeEdge;
    target.edges[oppositeDirection(candidate.direction)] = treeEdge;

    for (const direction of EDGE_DIRECTIONS) {
      frontier.push({ fromKey: target.key, direction });
    }
  }
  return sectors;
}

function addLoopEdges(
  sectors: Map<SectorKey, GrowingSector>,
  ordered: GrowingSector[],
  topologyRng: () => number,
  makeEdge: EdgeFactory
): void {
  for (const sector of ordered) {
    for (const direction of ['east', 'south'] as EdgeDirection[]) {
      const neighbour = neighbourOf(sectors, sector, direction);
      if (!neighbour) continue;
      if (sector.edges[direction].kind !== EdgeKind.Wall) continue;

      const roll = topologyRng();
      const depthGap = Math.abs(sector.depth - neighbour.depth);
      if (depthGap <= 2) {
        if (roll < 0.25) {
          attachEdge(sector, neighbour, direction,
            makeEdge(sector.sx, sector.sy, direction, EdgeKind.Open));
        }
      } else if (roll < 0.15) {
        const deeper = sector.depth >= neighbour.depth ? sector : neighbour;
        const shallower = deeper === sector ? neighbour : sector;
        attachEdge(sector, neighbour, direction,
          makeEdge(sector.sx, sector.sy, direction, EdgeKind.OneWay, {
            passDirection: directionFrom(deeper, shallower),
          }));
      }
    }
  }
}

interface GatePlacement {
  abilityOrder: string[];
  abilitySlotBySector: Map<SectorKey, string[]>;
  gateSubtrees: Set<SectorKey>[];
  finalRegion: Set<SectorKey>;
}

interface GateCandidate {
  parent: GrowingSector;
  child: GrowingSector;
  subtree: Set<SectorKey>;
  /** Longest downward path from child: the ceiling on how many gates can still nest. */
  height: number;
}

function placeAbilityGates(
  sectors: Map<SectorKey, GrowingSector>,
  ordered: GrowingSector[],
  abilityIds: string[],
  topologyRng: () => number,
  makeEdge: EdgeFactory
): GatePlacement {
  const abilityOrder: string[] = [];
  const abilitySlotBySector = new Map<SectorKey, string[]>();
  const gateSubtrees: Set<SectorKey>[] = [];
  const subtreeHeights = measureSubtreeHeights(ordered);
  let availableRegion = new Set<SectorKey>(ordered.map(sector => sector.key));

  for (let placed = 0; placed < abilityIds.length; placed++) {
    const abilityId = abilityIds[placed];
    const gatesLeft = abilityIds.length - placed;
    const candidates: GateCandidate[] = [];
    for (const parent of ordered) {
      if (!availableRegion.has(parent.key)) continue;
      for (const childKey of parent.childKeys) {
        if (!availableRegion.has(childKey)) continue;
        const child = sectors.get(childKey)!;
        const subtree = subtreeOf(sectors, child);
        const keyHasHome = [...availableRegion].some(key => !subtree.has(key));
        if (!keyHasHome) continue;
        candidates.push({
          parent, child, subtree, height: subtreeHeights.get(childKey) ?? 0,
        });
      }
    }
    if (candidates.length === 0) break;

    const chosen = pickGateCandidate(candidates, availableRegion.size, gatesLeft);
    const gateDirection = directionFrom(chosen.parent, chosen.child);
    attachEdge(chosen.parent, chosen.child, gateDirection,
      makeEdge(chosen.parent.sx, chosen.parent.sy, gateDirection, EdgeKind.AbilityDoor, {
        requiredId: abilityId,
      }));

    deleteEdgesCrossing(sectors, ordered, chosen.subtree);

    const hosts = ordered.filter(sector =>
      availableRegion.has(sector.key) && !chosen.subtree.has(sector.key));
    const host = hosts[weightedPick(hosts.map(sector => 1 + sector.depth), topologyRng)];
    const hosted = abilitySlotBySector.get(host.key) ?? [];
    hosted.push(abilityId);
    abilitySlotBySector.set(host.key, hosted);

    availableRegion = chosen.subtree;
    gateSubtrees.push(chosen.subtree);
    abilityOrder.push(abilityId);
  }

  return { abilityOrder, abilitySlotBySector, gateSubtrees, finalRegion: availableRegion };
}

/**
 * Nesting feasibility first, tier balance second. Weighting toward the deepest edge (the
 * v1 rule) collapsed availableRegion onto a leaf subtree, after which no later gate had an
 * edge left to sit on: over seeds 1..40 at seven sector budgets, 6 of 6 gates was placed
 * zero times and the floor was 1. A candidate whose subtree is shorter than the gates
 * still to place cannot host them, so it is excluded before balance is weighed at all.
 * A second filter (BALANCE-GATE-TIER-FLOOR) keeps only candidates that leave
 * MIN_GATE_TIER_SECTORS on the near side and gatesLeft * MIN_GATE_TIER_SECTORS on the far
 * side, so no ability opens a single room and every later gate still has room to do the
 * same. It falls back to the height-only pool when nothing qualifies: on 1000 spread seeds
 * that fallback fires for 14 of 6000 gates.
 */
function pickGateCandidate(
  candidates: GateCandidate[], regionSize: number, gatesLeft: number
): GateCandidate {
  const tallEnough = candidates.filter(candidate => candidate.height >= gatesLeft - 1);
  const strict = tallEnough.filter(candidate =>
    regionSize - candidate.subtree.size >= MIN_GATE_TIER_SECTORS
    && candidate.subtree.size >= gatesLeft * MIN_GATE_TIER_SECTORS);
  const feasible = strict.length > 0 ? strict : tallEnough;
  const tallest = candidates.reduce(
    (best, candidate) => Math.max(best, candidate.height), 0);
  const pool = feasible.length > 0
    ? feasible
    : candidates.filter(candidate => candidate.height === tallest);
  // gatesLeft gates cut a region of regionSize into gatesLeft + 1 equal tiers, so this
  // gate's subtree wants every tier but the first.
  const target = regionSize * gatesLeft / (gatesLeft + 1);
  return pool.reduce((best, candidate) =>
    compareGateCandidates(candidate, best, target) < 0 ? candidate : best);
}

function compareGateCandidates(a: GateCandidate, b: GateCandidate, target: number): number {
  return Math.abs(a.subtree.size - target) - Math.abs(b.subtree.size - target)
    || b.height - a.height
    || compareKeys(a.child.key, b.child.key);
}

/** Children are strictly deeper than their parent, so one pass in descending depth order
 *  settles every sector after all of its children. */
function measureSubtreeHeights(ordered: GrowingSector[]): Map<SectorKey, number> {
  const heights = new Map<SectorKey, number>();
  for (const sector of [...ordered].sort((a, b) => b.depth - a.depth)) {
    let height = 0;
    for (const childKey of sector.childKeys) {
      height = Math.max(height, 1 + (heights.get(childKey) ?? 0));
    }
    heights.set(sector.key, height);
  }
  return heights;
}

/** A loop edge that skips a gate would let a player into the locked subtree
 *  without its key, and re-labelling it would break an earlier gate's ordering. */
function deleteEdgesCrossing(
  sectors: Map<SectorKey, GrowingSector>,
  ordered: GrowingSector[],
  subtree: Set<SectorKey>
): void {
  for (const sector of ordered) {
    for (const direction of EDGE_DIRECTIONS) {
      if (sector.edges[direction].kind === EdgeKind.Wall) continue;
      const neighbour = neighbourOf(sectors, sector, direction);
      if (!neighbour) continue;
      if (isTreeEdge(sector, neighbour)) continue;
      if (subtree.has(sector.key) === subtree.has(neighbour.key)) continue;
      sector.edges[direction] = WALL_EDGE;
      neighbour.edges[oppositeDirection(direction)] = WALL_EDGE;
    }
  }
}

function plugLoopEdgesWithBreakables(
  sectors: Map<SectorKey, GrowingSector>,
  ordered: GrowingSector[],
  topologyRng: () => number,
  makeEdge: EdgeFactory
): void {
  for (const sector of ordered) {
    for (const direction of ['east', 'south'] as EdgeDirection[]) {
      if (sector.edges[direction].kind !== EdgeKind.Open) continue;
      const neighbour = neighbourOf(sectors, sector, direction);
      if (!neighbour || isTreeEdge(sector, neighbour)) continue;
      if (topologyRng() >= 0.20) continue;
      attachEdge(sector, neighbour, direction,
        makeEdge(sector.sx, sector.sy, direction, EdgeKind.Breakable));
    }
  }
}

interface QuestDoorCandidate {
  near: GrowingSector;
  far: GrowingSector;
  direction: EdgeDirection;
  edgeId: string;
  farSide: Set<SectorKey>;
}

/**
 * Seals optional regions behind quest keys. Deliberately consumes no RNG and only converts an
 * existing Open edge, reusing makeEdge (seeded per canonical edge id), so the aperture it
 * writes is the one that edge already had: adding quest doors leaves every other property of a
 * seed's world byte-identical and needs no WORLDGEN_VERSION bump.
 *
 * A candidate must be a bridge whose far side holds no start sector, no boss arena, no
 * ability-granting slot and no ability door. The bridge test counts every non-Wall edge as a
 * connection, so a region reachable around the door through a breakable or a one-way membrane
 * is rejected rather than half-locked, and the critical path stays passable with abilities alone.
 */
function placeQuestKeyDoors(
  sectors: Map<SectorKey, GrowingSector>,
  ordered: GrowingSector[],
  questKeyIds: string[],
  abilitySlotBySector: Map<SectorKey, string[]>,
  bossArenaKey: SectorKey,
  makeEdge: EdgeFactory
): void {
  if (questKeyIds.length === 0) return;
  const regionCap = Math.max(2, Math.floor(ordered.length / QUEST_DOOR_REGION_DIVISOR));

  const candidates: QuestDoorCandidate[] = [];
  const inspected = new Set<string>();
  for (const near of ordered) {
    for (const direction of EDGE_DIRECTIONS) {
      if (near.edges[direction].kind !== EdgeKind.Open) continue;
      const far = neighbourOf(sectors, near, direction);
      if (!far) continue;
      const edgeId = edgeIdFor(near.sx, near.sy, direction);
      if (inspected.has(edgeId)) continue;
      inspected.add(edgeId);

      const startSide = componentWithout(sectors, START_KEY, edgeId);
      if (startSide.has(near.key) === startSide.has(far.key)) continue;
      const farRoot = startSide.has(near.key) ? far : near;
      const farSide = componentWithout(sectors, farRoot.key, edgeId);
      if (farSide.size > regionCap) continue;
      if (farSide.has(START_KEY) || farSide.has(bossArenaKey)) continue;
      if (!isOptionalRegion(sectors, farSide, abilitySlotBySector)) continue;

      candidates.push({ near, far, direction, edgeId, farSide });
    }
  }

  // Biggest sealed region first so a key is worth the walk; the edge id breaks ties so the
  // choice is a pure function of the layout.
  candidates.sort((a, b) =>
    b.farSide.size - a.farSide.size || compareKeys(a.edgeId, b.edgeId));

  const claimed = new Set<SectorKey>();
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= questKeyIds.length) break;
    if ([...candidate.farSide].some(key => claimed.has(key))) continue;
    attachEdge(candidate.near, candidate.far, candidate.direction,
      makeEdge(candidate.near.sx, candidate.near.sy, candidate.direction, EdgeKind.KeyDoor, {
        requiredId: questKeyIds[placed],
      }));
    for (const key of candidate.farSide) claimed.add(key);
    placed++;
  }
}

/** Every sector reachable from `from` across any non-Wall edge except `bannedEdgeId`. */
function componentWithout(
  sectors: Map<SectorKey, GrowingSector>,
  from: SectorKey,
  bannedEdgeId: string
): Set<SectorKey> {
  const reached = new Set<SectorKey>([from]);
  const stack: SectorKey[] = [from];
  while (stack.length > 0) {
    const sector = sectors.get(stack.pop()!)!;
    for (const direction of EDGE_DIRECTIONS) {
      if (sector.edges[direction].kind === EdgeKind.Wall) continue;
      if (edgeIdFor(sector.sx, sector.sy, direction) === bannedEdgeId) continue;
      const neighbour = neighbourOf(sectors, sector, direction);
      if (!neighbour || reached.has(neighbour.key)) continue;
      reached.add(neighbour.key);
      stack.push(neighbour.key);
    }
  }
  return reached;
}

function isOptionalRegion(
  sectors: Map<SectorKey, GrowingSector>,
  region: Set<SectorKey>,
  abilitySlotBySector: Map<SectorKey, string[]>
): boolean {
  for (const key of region) {
    if (abilitySlotBySector.has(key)) return false;
    const sector = sectors.get(key)!;
    for (const direction of EDGE_DIRECTIONS) {
      if (sector.edges[direction].kind === EdgeKind.AbilityDoor) return false;
    }
  }
  return true;
}

/**
 * Conceals dead-end leaf sectors behind a breakable wall. Like placeQuestKeyDoors this
 * consumes no RNG and only converts an existing Open edge through makeEdge (seeded per
 * canonical edge id), so the aperture it writes is the one that edge already had and a
 * seed's world is otherwise byte-identical: concealing costs no WORLDGEN_VERSION bump.
 *
 * A leaf is on no path between two other sectors, so sealing one can strand nothing and
 * gate-order solvability with breakables treated as walls holds by construction rather than
 * by a check. The start sector, the boss arena and any ability host are excluded anyway.
 */
function placeHiddenSectors(
  sectors: Map<SectorKey, GrowingSector>,
  ordered: GrowingSector[],
  wanted: number,
  abilitySlotBySector: Map<SectorKey, string[]>,
  bossArenaKey: SectorKey,
  makeEdge: EdgeFactory
): Set<SectorKey> {
  const hidden = new Set<SectorKey>();
  if (wanted <= 0) return hidden;

  const candidates: {
    sector: GrowingSector; direction: EdgeDirection; neighbour: GrowingSector;
  }[] = [];
  for (const sector of ordered) {
    if (sector.key === START_KEY || sector.key === bossArenaKey) continue;
    if (abilitySlotBySector.has(sector.key)) continue;
    const openDirections = EDGE_DIRECTIONS.filter(
      direction => sector.edges[direction].kind !== EdgeKind.Wall);
    if (openDirections.length !== 1) continue;
    const direction = openDirections[0];
    if (sector.edges[direction].kind !== EdgeKind.Open) continue;
    const neighbour = neighbourOf(sectors, sector, direction);
    if (!neighbour) continue;
    candidates.push({ sector, direction, neighbour });
  }

  // Deepest first, so a concealed room rewards pushing outward; the key breaks ties so the
  // choice is a pure function of the layout.
  candidates.sort((a, b) =>
    b.sector.depth - a.sector.depth || compareKeys(a.sector.key, b.sector.key));

  for (const candidate of candidates) {
    if (hidden.size >= wanted) break;
    // Never conceal a room behind another concealed room: one wall, one secret.
    if (hidden.has(candidate.neighbour.key)) continue;
    attachEdge(candidate.sector, candidate.neighbour, candidate.direction,
      makeEdge(candidate.sector.sx, candidate.sector.sy, candidate.direction,
        EdgeKind.Breakable));
    hidden.add(candidate.sector.key);
  }
  return hidden;
}

function pickBossArenaKey(ordered: GrowingSector[], region: Set<SectorKey>): SectorKey {
  const ranked = ordered
    .filter(sector => region.has(sector.key))
    .sort((a, b) => b.depth - a.depth || compareKeys(a.key, b.key));
  if (ranked[0].key === START_KEY && ranked.length > 1) return ranked[1].key;
  return ranked[0].key;
}

function assignDangerAndBiomes(
  ordered: GrowingSector[], gateSubtrees: Set<SectorKey>[], availableBiomeIds: string[]
): void {
  const maxDepth = ordered.reduce((deepest, sector) => Math.max(deepest, sector.depth), 0);
  const orderedBiomes = orderBiomesByHarshness(availableBiomeIds);

  for (const sector of ordered) {
    const gateTier = gateSubtrees.filter(subtree => subtree.has(sector.key)).length;
    const baseDanger = maxDepth === 0 ? 0 : sector.depth / maxDepth;
    sector.danger = Math.min(1, baseDanger + GATE_TIER_DANGER_STEP * gateTier);

    const regionIndex = Math.floor(sector.depth / REGION_DEPTH_SPAN);
    sector.biomeId = orderedBiomes[Math.min(regionIndex, orderedBiomes.length - 1)];
  }
}

function orderBiomesByHarshness(availableBiomeIds: string[]): string[] {
  const resolved = availableBiomeIds.filter(id => getStageById(id) !== undefined);
  const rest = resolved
    .filter(id => id !== SPINE_BIOME_ID)
    .sort((a, b) => harshnessOf(a) - harshnessOf(b) || compareKeys(a, b));
  return [SPINE_BIOME_ID, ...rest];
}

function harshnessOf(biomeId: string): number {
  const stage = getStageById(biomeId);
  if (!stage) return 0;
  return stage.enemyHealthMultiplier + stage.enemyDamageMultiplier;
}

function newGrowingSector(
  sx: number, sy: number, depth: number,
  parentKey: SectorKey | null, growthDirection: EdgeDirection | null
): GrowingSector {
  return {
    sx, sy,
    key: `${sx},${sy}`,
    depth,
    parentKey,
    childKeys: [],
    growthDirection,
    edges: { north: WALL_EDGE, east: WALL_EDGE, south: WALL_EDGE, west: WALL_EDGE },
    biomeId: SPINE_BIOME_ID,
    danger: 0,
    isBossArena: false,
  };
}

function sortSectors(sectors: Map<SectorKey, GrowingSector>): GrowingSector[] {
  return [...sectors.values()].sort((a, b) => a.sy - b.sy || a.sx - b.sx);
}

function targetKeyOf(
  sectors: Map<SectorKey, GrowingSector>, candidate: FrontierCandidate
): SectorKey {
  const from = sectors.get(candidate.fromKey)!;
  const { dsx, dsy } = directionDelta(candidate.direction);
  return `${from.sx + dsx},${from.sy + dsy}`;
}

function neighbourOf(
  sectors: Map<SectorKey, GrowingSector>, sector: GrowingSector, direction: EdgeDirection
): GrowingSector | undefined {
  const { dsx, dsy } = directionDelta(direction);
  return sectors.get(`${sector.sx + dsx},${sector.sy + dsy}`);
}

function attachEdge(
  sector: GrowingSector, neighbour: GrowingSector, direction: EdgeDirection, edge: EdgeDef
): void {
  sector.edges[direction] = edge;
  neighbour.edges[oppositeDirection(direction)] = edge;
}

function isTreeEdge(a: GrowingSector, b: GrowingSector): boolean {
  return a.parentKey === b.key || b.parentKey === a.key;
}

function directionFrom(
  from: { sx: number; sy: number }, to: { sx: number; sy: number }
): EdgeDirection {
  if (to.sy < from.sy) return 'north';
  if (to.sy > from.sy) return 'south';
  return to.sx > from.sx ? 'east' : 'west';
}

function subtreeOf(
  sectors: Map<SectorKey, GrowingSector>, root: GrowingSector
): Set<SectorKey> {
  const members = new Set<SectorKey>([root.key]);
  const stack = [root];
  while (stack.length > 0) {
    const sector = stack.pop()!;
    for (const childKey of sector.childKeys) {
      if (members.has(childKey)) continue;
      members.add(childKey);
      stack.push(sectors.get(childKey)!);
    }
  }
  return members;
}

export function weightedPick(weights: number[], rng: () => number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  let picked = 0;
  while (picked < weights.length - 1 && roll >= weights[picked]) {
    roll -= weights[picked];
    picked++;
  }
  return picked;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dedupePreservingOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}
