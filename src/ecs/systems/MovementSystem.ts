import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity } from '../components';
import { GAME_WIDTH, GAME_HEIGHT } from '../../GameConfig';

// Query for entities with transform and velocity
const movementQuery = defineQuery([Transform, Velocity]);

/**
 * MovementSystem applies velocity to position each frame.
 * Also handles boundary clamping to keep entities on screen.
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
 * Clamps player position to screen boundaries
 */
export function clampPlayerToScreen(_world: IWorld, playerId: number, padding: number = 16): void {
  Transform.x[playerId] = Math.max(padding, Math.min(GAME_WIDTH - padding, Transform.x[playerId]));
  Transform.y[playerId] = Math.max(padding, Math.min(GAME_HEIGHT - padding, Transform.y[playerId]));
}
