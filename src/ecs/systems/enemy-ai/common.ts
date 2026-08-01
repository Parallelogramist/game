import { IWorld, hasComponent } from 'bitecs';
import { Destructible } from '../../components';
import type { TelegraphManager } from '../../../effects/TelegraphManager';

/**
 * Constants and per-frame context shared between the enemy AI behavior
 * modules and the dispatcher/miniboss/boss code still in EnemyAISystem.ts.
 * Lives here rather than in EnemyAISystem.ts because the dispatcher imports
 * the behavior modules — exporting from there back into them would cycle.
 */

// OPTIMIZATION: Pre-computed Math constants to avoid repeated calculations
export const PI_HALF = Math.PI / 2;
export const PI_TWO = Math.PI * 2;

// Attack telegraph manager (injected by GameScene). Draws windup indicators
// before dangerous enemy attacks (dash / charge / ground slam / boss AOEs).
// Geometry + timing live in ./telegraphs (pure, unit-tested). Pure
// readability — never affects damage or timing. Read it via the live import
// binding — GameScene injects it after module load.
export let telegraphManager: TelegraphManager | null = null;
export function setTelegraphManager(manager: TelegraphManager | null): void {
  telegraphManager = manager;
}

// Current world ref for the frame, set at the top of enemyAISystem() so AI
// sub-functions (healer, auras) can test for Destructible (crates share the
// EnemyTag spatial hash but must be excluded from heals/auras).
let aiWorld: IWorld | null = null;

export function setAIWorld(world: IWorld): void {
  aiWorld = world;
}

export function isDestructible(entityId: number): boolean {
  return aiWorld !== null && hasComponent(aiWorld, Destructible, entityId);
}

/**
 * Static-geometry queries for the run's world, injected by GameScene the same way
 * telegraphManager is. Null in arena, and null is the byte-identical guarantee: with no
 * context chaseHeading hands back the caller's own direct vector by assignment.
 */
export interface NavigationContext {
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean;
  /** Centre of the next tile toward the player, false when there is no route. */
  flowStep(x: number, y: number, out: { x: number; y: number }): boolean;
  /** True where a tile an enemy cannot cross covers this point. */
  isSolidAt(x: number, y: number): boolean;
  /** Nearest point a mover-sized circle fits, for teleport destinations. */
  freeSpotNear(x: number, y: number, out: { x: number; y: number }): void;
}

export let navigationContext: NavigationContext | null = null;
export function setNavigationContext(context: NavigationContext | null): void {
  navigationContext = context;
}

const heading = { x: 0, y: 0 };
const flowPoint = { x: 0, y: 0 };

/**
 * Just over half a tile, so a probe always lands in the neighbouring tile rather than the one
 * the enemy is standing in.
 */
const WALL_PROBE_DISTANCE = 24;

/**
 * How usable one side of an obstacle is: 0 blocked outright, 1 open but the obstacle keeps
 * going that way, 2 open and the obstacle ends. The second probe is an L offset rather than a
 * true diagonal so it samples the tile beside the one the forward probe hit; a shorter diagonal
 * never reaches the obstacle at all and scores every side the same.
 */
function sideScore(
  context: NavigationContext,
  enemyX: number, enemyY: number,
  directX: number, directY: number,
  perpendicularX: number, perpendicularY: number,
): number {
  if (context.isSolidAt(
    enemyX + perpendicularX * WALL_PROBE_DISTANCE,
    enemyY + perpendicularY * WALL_PROBE_DISTANCE,
  )) return 0;
  return context.isSolidAt(
    enemyX + (directX + perpendicularX) * WALL_PROBE_DISTANCE,
    enemyY + (directY + perpendicularY) * WALL_PROBE_DISTANCE,
  ) ? 1 : 2;
}

/**
 * The last rung under line of sight and the flow field: an enemy with neither still must not
 * press into rock forever. Overwrites `heading` with the wall tangent when there is rock ahead
 * and a way round it, and leaves the caller's direct vector alone otherwise. At most five tile
 * reads, and only for enemies that already failed both cheaper rungs.
 *
 * The side is chosen by geometry, never by distance to the player: the two perpendicular probes
 * are mirror images about the enemy-to-player line, so they are always equidistant from the
 * player and a distance test decides on rounding noise. A tie keeps the positive perpendicular,
 * which makes every enemy round an obstacle the same way instead of swapping sides frame to frame.
 */
function applyWallTangent(
  context: NavigationContext,
  enemyX: number, enemyY: number,
  directX: number, directY: number,
): void {
  if (!context.isSolidAt(
    enemyX + directX * WALL_PROBE_DISTANCE,
    enemyY + directY * WALL_PROBE_DISTANCE,
  )) return;

  const perpendicularX = -directY;
  const perpendicularY = directX;
  const positiveScore = sideScore(
    context, enemyX, enemyY, directX, directY, perpendicularX, perpendicularY,
  );
  const negativeScore = sideScore(
    context, enemyX, enemyY, directX, directY, -perpendicularX, -perpendicularY,
  );
  if (positiveScore === 0 && negativeScore === 0) return;

  const takePositive = positiveScore >= negativeScore;
  heading.x = takePositive ? perpendicularX : -perpendicularX;
  heading.y = takePositive ? perpendicularY : -perpendicularY;
}

/**
 * Where a chase-family handler should point this frame: straight at the player unless rock is
 * in the way, in which case one flow-field step around it. Direction only, never speed or
 * timers, so every distance-driven scale a handler already applies keeps measuring the real
 * distance to the player. Returns a shared instance: read it before the next call, never retain it.
 */
export function chaseHeading(
  enemyX: number,
  enemyY: number,
  playerX: number,
  playerY: number,
  directX: number,
  directY: number,
): { x: number; y: number } {
  heading.x = directX;
  heading.y = directY;
  const context = navigationContext;
  if (context === null) return heading;
  if (context.hasLineOfSight(enemyX, enemyY, playerX, playerY)) return heading;
  if (!context.flowStep(enemyX, enemyY, flowPoint)) {
    applyWallTangent(context, enemyX, enemyY, directX, directY);
    return heading;
  }
  const stepX = flowPoint.x - enemyX;
  const stepY = flowPoint.y - enemyY;
  const stepLength = Math.sqrt(stepX * stepX + stepY * stepY);
  if (stepLength < 1) return heading;
  heading.x = stepX / stepLength;
  heading.y = stepY / stepLength;
  return heading;
}

const spot = { x: 0, y: 0 };

/**
 * The nearest point that is not inside rock, for the handlers that pick a destination near the
 * player (a patrol offset, a wander point) instead of steering at the player. A point inside a
 * wall is a destination the enemy can never arrive at, so it presses into the wall until the
 * timer that picked it expires. Returns a shared instance: read it before the next call,
 * never retain it.
 */
export function openSpot(x: number, y: number): { x: number; y: number } {
  spot.x = x;
  spot.y = y;
  navigationContext?.freeSpotNear(x, y, spot);
  return spot;
}
