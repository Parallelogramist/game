import { IWorld, hasComponent } from 'bitecs';
import { Destructible, Transform } from '../../components';
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

// ── Per-enemy navigation state ──────────────────────────────────────────────

/**
 * A zero-width line-of-sight ray answers clear on one frame and blocked on the next at a doorway
 * edge, and the flow field is 8-direction quantized, so a heading taken raw from either
 * alternates while the enemy has barely moved. Both are damped per enemy: a line-of-sight flip
 * must hold for LOS_COMMIT_SECONDS before the steering mode follows it, and the returned heading
 * eases toward its new value over HEADING_SMOOTH_SECONDS instead of snapping.
 *
 * bitecs sizes every component array to the world capacity, so an entity id can never index past
 * arrays sized the same way.
 */
const NAV_CAPACITY = Transform.x.length;

const committedDirect = new Uint8Array(NAV_CAPACITY);
const losFlipTimer = new Float32Array(NAV_CAPACITY);
const smoothedHeadingX = new Float32Array(NAV_CAPACITY);
const smoothedHeadingY = new Float32Array(NAV_CAPACITY);
const lastNavTime = new Float32Array(NAV_CAPACITY).fill(-1);

const LOS_COMMIT_SECONDS = 0.1;
const HEADING_SMOOTH_SECONDS = 0.07;

/**
 * Past this a slot is re-seeded rather than eased from. Covers an entity id recycled onto a new
 * enemy, and a handler that steers through chaseHeading in only some of its phases (the circler
 * closes its orbit, the lurker approaches), whose stored heading would otherwise be seconds
 * stale on return. Comfortably above the 0.1s period of the 6x LOD band.
 */
const NAV_SLOT_STALE_SECONDS = 0.25;

let navClock = 0;
let navEnemyId = -1;
let navDelta = 0;

/** Once per dispatcher frame, before any enemy is stepped. */
export function advanceNavClock(deltaSeconds: number): void {
  navClock += deltaSeconds;
}

/**
 * Once per enemy per AI tick, before its handler runs. Without it chaseHeading keeps its
 * undamped behavior, which is what a direct call from a unit test gets.
 */
export function setNavFrame(enemyId: number, deltaSeconds: number): void {
  navEnemyId = enemyId;
  navDelta = deltaSeconds;
}

export function resetEnemyNavState(): void {
  committedDirect.fill(0);
  losFlipTimer.fill(0);
  smoothedHeadingX.fill(0);
  smoothedHeadingY.fill(0);
  lastNavTime.fill(-1);
  navClock = 0;
  navEnemyId = -1;
  navDelta = 0;
}

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
 * The two rungs under line of sight: one flow-field step around the wall, or the wall tangent
 * when the field has no route. Overwrites `heading`; leaves it alone when neither rung answers.
 */
function routeHeading(
  context: NavigationContext,
  enemyX: number, enemyY: number,
  directX: number, directY: number,
): void {
  if (!context.flowStep(enemyX, enemyY, flowPoint)) {
    applyWallTangent(context, enemyX, enemyY, directX, directY);
    return;
  }
  const stepX = flowPoint.x - enemyX;
  const stepY = flowPoint.y - enemyY;
  const stepLength = Math.sqrt(stepX * stepX + stepY * stepY);
  if (stepLength < 1) return;
  heading.x = stepX / stepLength;
  heading.y = stepY / stepLength;
}

/**
 * The steering mode this enemy is committed to, true for the straight line at the player. A raw
 * answer that disagrees has to hold for LOS_COMMIT_SECONDS before it takes effect, so a ray
 * alternating on a doorway edge never flips the mode at all.
 */
function commitDirectMode(enemyId: number, rawDirect: boolean, fresh: boolean): boolean {
  if (fresh) {
    committedDirect[enemyId] = rawDirect ? 1 : 0;
    losFlipTimer[enemyId] = 0;
    return rawDirect;
  }
  const committed = committedDirect[enemyId] === 1;
  if (rawDirect === committed) {
    losFlipTimer[enemyId] = 0;
    return committed;
  }
  losFlipTimer[enemyId] += navDelta;
  if (losFlipTimer[enemyId] < LOS_COMMIT_SECONDS) return committed;
  losFlipTimer[enemyId] = 0;
  committedDirect[enemyId] = rawDirect ? 1 : 0;
  return rawDirect;
}

/**
 * Overwrites `heading` with its eased value and stores it. Time-based rather than per-frame, so
 * an enemy on the 3x or 6x LOD band turns over the same wall-clock window; at 6x the window has
 * already elapsed, so a distant enemy neither lags nor pays.
 */
function smoothHeading(enemyId: number, fresh: boolean): void {
  const previousX = smoothedHeadingX[enemyId];
  const previousY = smoothedHeadingY[enemyId];
  if (fresh || (previousX === 0 && previousY === 0)) {
    smoothedHeadingX[enemyId] = heading.x;
    smoothedHeadingY[enemyId] = heading.y;
    return;
  }
  const easing = navDelta >= HEADING_SMOOTH_SECONDS ? 1 : navDelta / HEADING_SMOOTH_SECONDS;
  let easedX = previousX + (heading.x - previousX) * easing;
  let easedY = previousY + (heading.y - previousY) * easing;
  const length = Math.sqrt(easedX * easedX + easedY * easedY);
  // A reversal cancels to about zero, where normalizing would amplify float noise into a
  // direction. Snap instead.
  if (length < 0.001) {
    easedX = heading.x;
    easedY = heading.y;
  } else {
    easedX /= length;
    easedY /= length;
  }
  smoothedHeadingX[enemyId] = easedX;
  smoothedHeadingY[enemyId] = easedY;
  heading.x = easedX;
  heading.y = easedY;
}

/**
 * Where a chase-family handler should point this frame: straight at the player unless rock is
 * in the way, in which case one flow-field step around it. Direction only, never speed or
 * timers, so every distance-driven scale a handler already applies keeps measuring the real
 * distance to the player. Returns a shared instance: read it before the next call, never retain it.
 * Damped per enemy when the dispatcher has named one through setNavFrame; called without that
 * (a direct unit-test call) it steers undamped.
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

  const rawDirect = context.hasLineOfSight(enemyX, enemyY, playerX, playerY);
  const enemyId = navEnemyId;
  if (enemyId < 0) {
    if (!rawDirect) routeHeading(context, enemyX, enemyY, directX, directY);
    return heading;
  }

  const fresh = navClock - lastNavTime[enemyId] > NAV_SLOT_STALE_SECONDS;
  lastNavTime[enemyId] = navClock;
  if (!commitDirectMode(enemyId, rawDirect, fresh)) {
    routeHeading(context, enemyX, enemyY, directX, directY);
  }
  smoothHeading(enemyId, fresh);
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
