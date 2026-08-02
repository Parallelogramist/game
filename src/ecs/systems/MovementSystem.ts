import { defineQuery, hasComponent, IWorld } from 'bitecs';
import { EnemyAI, Transform, Velocity } from '../components';
import { WorldRect } from '../../world/worldSpace';
import { MoverKind, createCollisionResult } from '../../world/staticCollision';
import { resolveMoveWithAssist } from '../../world/moveAssist';
import { isPhasedWraith } from './enemy-ai/wraith';
import type { WorldMap } from '../../world/worldTypes';

const movementQuery = defineQuery([Transform, Velocity]);

/** What the movers resolve against, when the run's mode has geometry at all. */
export interface WallCollisionContext {
  worldMap: WorldMap;
  playerId: number;
  playerRadius: number;
  enemyRadius: number;
}

/**
 * Bosses are exempt from geometry on purpose (doc 02 section 6.4): their patterns are tuned
 * for an open room, a sector lock already seals the fight, and a boss wedged in rock is an
 * unwinnable run. Minibosses are ordinary movers and do collide.
 * A phased Wraith is the other exemption, and it is a fantasy rather than a tuning problem:
 * doc 02 section 5.3 gives it the ghost rule, and GameScene snaps it back onto legal floor when
 * it turns corporeal.
 */
const BOSS_AI_TYPE_FLOOR = 100;

// Caller-owned scratch, reused every frame: this runs once per player per frame and the
// repo's pooling rule forbids allocating in it. It carries no state between frames, so
// unlike the systems in CLAUDE.md's reset rule it needs no reset function.
const collisionResult = createCollisionResult();

/**
 * MovementSystem applies velocity to position each frame.
 * The player and every non-boss enemy additionally resolve against static geometry when the
 * mode supplies it; with no context the arithmetic is exactly what it was before walls existed.
 */
export function movementSystem(
  world: IWorld,
  deltaTime: number,
  wallCollision?: WallCollisionContext | null,
): IWorld {
  const entities = movementQuery(world);

  for (let i = 0; i < entities.length; i++) {
    const entityId = entities[i];
    const nextX = Transform.x[entityId] + Velocity.x[entityId] * deltaTime;
    const nextY = Transform.y[entityId] + Velocity.y[entityId] * deltaTime;

    if (wallCollision) {
      if (entityId === wallCollision.playerId) {
        resolveMoveWithAssist(
          wallCollision.worldMap,
          Transform.x[entityId],
          Transform.y[entityId],
          nextX,
          nextY,
          wallCollision.playerRadius,
          MoverKind.Player,
          collisionResult,
        );
        Transform.x[entityId] = collisionResult.x;
        Transform.y[entityId] = collisionResult.y;
        continue;
      }
      if (hasComponent(world, EnemyAI, entityId)
        && EnemyAI.aiType[entityId] < BOSS_AI_TYPE_FLOOR
        && !isPhasedWraith(entityId)) {
        resolveMoveWithAssist(
          wallCollision.worldMap,
          Transform.x[entityId],
          Transform.y[entityId],
          nextX,
          nextY,
          wallCollision.enemyRadius,
          MoverKind.Enemy,
          collisionResult,
        );
        Transform.x[entityId] = collisionResult.x;
        Transform.y[entityId] = collisionResult.y;
        continue;
      }
    }

    Transform.x[entityId] = nextX;
    Transform.y[entityId] = nextY;
  }

  return world;
}

/**
 * Clamps the player inside the legal playfield.
 */
export function clampPlayerToRect(_world: IWorld, playerId: number, rect: WorldRect, padding: number = 16): void {
  Transform.x[playerId] = Math.max(rect.minX + padding, Math.min(rect.maxX - padding, Transform.x[playerId]));
  Transform.y[playerId] = Math.max(rect.minY + padding, Math.min(rect.maxY - padding, Transform.y[playerId]));
}
