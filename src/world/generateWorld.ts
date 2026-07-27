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
 * directory are src/utils/dailySeed and src/data/Stages, both dependency-free.
 */

import { getStageById } from '../data/Stages';
import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';
import { buildSectorInterior } from './sectorInterior';
import {
  DEFAULT_SECTOR_BUDGET,
  EDGE_DIRECTIONS,
  EdgeKind,
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
      depth: sector.depth,
      entryTiles: interior.entryTiles,
      breakables: interior.breakables,
    });
  }

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
  let availableRegion = new Set<SectorKey>(ordered.map(sector => sector.key));

  for (const abilityId of abilityIds) {
    const candidates: { parent: GrowingSector; child: GrowingSector; subtree: Set<SectorKey> }[] = [];
    for (const parent of ordered) {
      if (!availableRegion.has(parent.key)) continue;
      for (const childKey of parent.childKeys) {
        if (!availableRegion.has(childKey)) continue;
        const child = sectors.get(childKey)!;
        const subtree = subtreeOf(sectors, child);
        const keyHasHome = [...availableRegion].some(key => !subtree.has(key));
        if (!keyHasHome) continue;
        candidates.push({ parent, child, subtree });
      }
    }
    if (candidates.length === 0) break;

    const chosen = candidates[weightedPick(
      candidates.map(candidate => 1 + candidate.child.depth), topologyRng)];
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

function weightedPick(weights: number[], rng: () => number): number {
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
