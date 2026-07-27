import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity } from '../components';
import { WorldRect } from '../../world/worldSpace';
// Query for entities with transform and velocity
const movementQuery = defineQuery([Transform, Velocity]);

/**
 * MovementSystem applies velocity to position each frame.
 * Also handles boundary clamping to keep entities inside the playfield.
 */
export function movementSystem(world: IWorld, deltaTime: number): IWorld {
  const entities = movementQuery(world);

  for (let i = 0; i < entities.length; i++) {
    const entityId = entities[i];

    // Apply velocity to position
    Transform.x[entityId] += Velocity.x[entityId] * deltaTime;
    Transform.y[entityId] += Velocity.y[entityId] * deltaTime;
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
