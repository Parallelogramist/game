/**
 * mapReveal: doc 03 section 7 moments 3 and 4, the one-time replay the chart plays the first
 * time it is opened after something changed while the ship was flying.
 *
 * Pure and Phaser-free, the mapFragments shape: the scene hands over what changed and how long
 * this open has been running, and gets back what to draw on this frame.
 */

import { EDGE_DIRECTIONS, EdgeKind, directionDelta } from '../world/worldTypes';
import type { WorldMap } from '../world/worldTypes';

/** Doc 03 section 7 moment 4 names 400 ms for the whole cascade, however many cells it covers. */
export const MAP_REVEAL_CASCADE_MS = 400;
/** How long one cell takes to fade up, inside that 400 ms. */
export const MAP_REVEAL_CELL_FADE_MS = 160;
/** Moment 3's bloom. Longer than the whole cascade so a find still reads when it lands alone,
 *  which is the common case: a cache is claimed far more often than a fragment is recovered. */
export const MAP_REVEAL_BLOOM_MS = 520;

export interface MapRevealPlan {
  /** Newly charted sectors and the BFS hop each one fades in on. */
  hopBySectorKey: ReadonlyMap<string, number>;
  /** Secret slot ids whose chart icon blooms. */
  bloomSecretIds: ReadonlySet<string>;
  /** Milliseconds the whole replay runs. 0 when there is nothing to play. */
  durationMs: number;
}

/** What the renderer draws on one frame of the replay. */
export interface MapOpenReveal {
  bloomProgress: number;
  bloomSecretIds: ReadonlySet<string>;
  /** Per newly charted sector: 0 = not drawn yet, 1 = fully drawn. A sector absent from this map
   *  is not part of the cascade and draws at full alpha, so an ordinary cell is untouched. */
  cascadeAlphaBySectorKey: ReadonlyMap<string, number>;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Orders the newly charted sectors by graph distance from the first of them, walking only
 * non-Wall edges and only through the granted set, so the outlines ripple outward from where the
 * grant starts rather than all landing at once. The caller's order is already deterministic
 * (chooseMapFragmentGrant returns shallowest first), so the seed is too.
 */
export function planMapOpenReveal(
  map: WorldMap,
  chartedSectorKeys: readonly string[],
  bloomSecretIds: readonly string[],
): MapRevealPlan {
  const charted = new Set(chartedSectorKeys);
  const hopBySectorKey = new Map<string, number>();
  const queue: string[] = [];
  if (chartedSectorKeys.length > 0) {
    hopBySectorKey.set(chartedSectorKeys[0], 0);
    queue.push(chartedSectorKeys[0]);
  }

  for (let head = 0; head < queue.length; head++) {
    const sectorKey = queue[head];
    const hops = hopBySectorKey.get(sectorKey) ?? 0;
    const sector = map.sectors.get(sectorKey);
    if (!sector) continue;
    for (const direction of EDGE_DIRECTIONS) {
      if (sector.edges[direction].kind === EdgeKind.Wall) continue;
      const { dsx, dsy } = directionDelta(direction);
      const neighbourKey = `${sector.sx + dsx},${sector.sy + dsy}`;
      if (!charted.has(neighbourKey) || hopBySectorKey.has(neighbourKey)) continue;
      hopBySectorKey.set(neighbourKey, hops + 1);
      queue.push(neighbourKey);
    }
  }

  // A grant slices one region by depth and a region is contiguous only by construction, so a
  // slice can still be cut in two by a wall: the stragglers land one hop behind everything the
  // walk reached rather than never fading in at all.
  let walkedMaxHop = 0;
  for (const hops of hopBySectorKey.values()) walkedMaxHop = Math.max(walkedMaxHop, hops);
  for (const sectorKey of chartedSectorKeys) {
    if (!hopBySectorKey.has(sectorKey)) hopBySectorKey.set(sectorKey, walkedMaxHop + 1);
  }

  let maxHop = 0;
  for (const hops of hopBySectorKey.values()) maxHop = Math.max(maxHop, hops);
  const cascadeMs = hopBySectorKey.size === 0
    ? 0
    : maxHop === 0 ? MAP_REVEAL_CELL_FADE_MS : MAP_REVEAL_CASCADE_MS;
  const bloomMs = bloomSecretIds.length === 0 ? 0 : MAP_REVEAL_BLOOM_MS;

  return {
    hopBySectorKey,
    bloomSecretIds: new Set(bloomSecretIds),
    durationMs: Math.max(cascadeMs, bloomMs),
  };
}

/** The stagger is derived rather than fixed, so the last cell finishes at exactly
 *  MAP_REVEAL_CASCADE_MS whether the grant is two sectors deep or eight. */
export function sampleMapOpenReveal(plan: MapRevealPlan, elapsedMs: number): MapOpenReveal {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  let maxHop = 0;
  for (const hops of plan.hopBySectorKey.values()) maxHop = Math.max(maxHop, hops);
  const staggerMs = maxHop === 0
    ? 0
    : (MAP_REVEAL_CASCADE_MS - MAP_REVEAL_CELL_FADE_MS) / maxHop;

  const cascadeAlphaBySectorKey = new Map<string, number>();
  for (const [sectorKey, hops] of plan.hopBySectorKey) {
    cascadeAlphaBySectorKey.set(
      sectorKey,
      clamp01((elapsed - hops * staggerMs) / MAP_REVEAL_CELL_FADE_MS),
    );
  }

  return {
    bloomProgress: plan.bloomSecretIds.size === 0 ? 1 : clamp01(elapsed / MAP_REVEAL_BLOOM_MS),
    bloomSecretIds: plan.bloomSecretIds,
    cascadeAlphaBySectorKey,
  };
}
