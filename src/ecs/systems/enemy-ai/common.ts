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
  if (!context.flowStep(enemyX, enemyY, flowPoint)) return heading;
  const stepX = flowPoint.x - enemyX;
  const stepY = flowPoint.y - enemyY;
  const stepLength = Math.sqrt(stepX * stepX + stepY * stepY);
  if (stepLength < 1) return heading;
  heading.x = stepX / stepLength;
  heading.y = stepY / stepLength;
  return heading;
}
