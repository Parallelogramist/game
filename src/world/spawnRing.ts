/**
 * spawnRing — where things enter the field, and when they have wandered too far.
 *
 * The spawn ring is camera-relative, never sector-relative: enemies appear just
 * outside what the player can see, exactly as far away as they always have, so
 * the director's pacing (spawn intervals, credit budget, time-to-contact) is
 * untouched when the view starts to move.
 *
 * Callers pass their own random source: the game passes Math.random, tests pass
 * a scripted stub. Consumed per call in order: one draw picks the edge, one draw
 * picks the position along it.
 */

import type { WorldPoint, WorldRect } from './worldSpace';

/**
 * World px from the view centre past which a regular enemy is recycled onto the
 * ring. Clears both the 900 px radar range and the ~735 px view half-diagonal,
 * so nothing visible or radar-tracked can pop.
 */
export const LEASH_RADIUS = 1600;

export interface EdgeSpawnConfig {
  /** Distance outside the view edge (30 for regulars, 50 for minibosses). */
  spawnOffset: number;
  /** Inset from the corners along the chosen edge (0 regulars, 100 minibosses). */
  edgeInset: number;
}

/**
 * Picks a point just outside a view rect, uniformly over four edges, reproducing
 * the distribution of the legacy screen-edge switch statements.
 */
export function pickEdgeSpawnPoint(
  view: WorldRect, config: EdgeSpawnConfig, random: () => number
): WorldPoint {
  // A stubbed random may legally return 1, which Math.random never does.
  const side = Math.min(3, Math.floor(random() * 4));
  const { spawnOffset, edgeInset } = config;

  switch (side) {
    case 0: // Left
      return { x: view.minX - spawnOffset, y: alongEdge(view.minY, view.maxY, edgeInset, random) };
    case 1: // Right
      return { x: view.maxX + spawnOffset, y: alongEdge(view.minY, view.maxY, edgeInset, random) };
    case 2: // Top
      return { x: alongEdge(view.minX, view.maxX, edgeInset, random), y: view.minY - spawnOffset };
    default: // Bottom
      return { x: alongEdge(view.minX, view.maxX, edgeInset, random), y: view.maxY + spawnOffset };
  }
}

export function isBeyondLeash(
  x: number, y: number, centerX: number, centerY: number, leashRadius: number
): boolean {
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy > leashRadius * leashRadius;
}

/** Where a leashed regular re-enters: a fresh edge point on the current view ring. */
export function repositionOntoSpawnRing(
  view: WorldRect, spawnOffset: number, random: () => number
): WorldPoint {
  return pickEdgeSpawnPoint(view, { spawnOffset, edgeInset: 0 }, random);
}

/**
 * A point inside a rect, no closer than `padding` to any edge. Over the arena screen
 * rect this is exactly the legacy `padding + random() * (screen - padding * 2)`
 * placement; over a scrolled view rect it is the same placement, in front of the player.
 * Consumed in order: one draw for x, one for y.
 */
export function pickInteriorPoint(
  rect: WorldRect, padding: number, random: () => number
): WorldPoint {
  return {
    x: alongEdge(rect.minX, rect.maxX, padding, random),
    y: alongEdge(rect.minY, rect.maxY, padding, random),
  };
}

function alongEdge(min: number, max: number, inset: number, random: () => number): number {
  const lo = min + inset;
  // An inset wider than the edge would invert the span; pin to lo instead.
  const hi = Math.max(lo, max - inset);
  return lo + random() * (hi - lo);
}
