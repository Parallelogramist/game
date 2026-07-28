import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity } from '../components';
import { WorldRect } from '../../world/worldSpace';
import { MoverKind, createCollisionResult, resolveCircleMove } from '../../world/staticCollision';
import type { WorldMap } from '../../world/worldTypes';

const movementQuery = defineQuery([Transform, Velocity]);

/** What the player resolves against, when the run's mode has geometry at all. */
export interface PlayerWallCollision {
  worldMap: WorldMap;
  playerId: number;
  playerRadius: number;
}

// Caller-owned scratch, reused every frame: this runs once per player per frame and the
// repo's pooling rule forbids allocating in it. It carries no state between frames, so
// unlike the systems in CLAUDE.md's reset rule it needs no reset function.
const collisionResult = createCollisionResult();

/**
 * MovementSystem applies velocity to position each frame.
 * The player additionally resolves against static geometry when the mode supplies it;
 * with no context the arithmetic is exactly what it was before walls existed.
 */
export function movementSystem(
  world: IWorld,
  deltaTime: number,
  wallCollision?: PlayerWallCollision | null,
): IWorld {
  const entities = movementQuery(world);

  for (let i = 0; i < entities.length; i++) {
    const entityId = entities[i];
    const nextX = Transform.x[entityId] + Velocity.x[entityId] * deltaTime;
    const nextY = Transform.y[entityId] + Velocity.y[entityId] * deltaTime;

    if (wallCollision && entityId === wallCollision.playerId) {
      resolveCircleMove(
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
