import { defineQuery, IWorld } from 'bitecs';
import { Transform, SpriteRef } from '../components';

// Query for entities with transform and sprite reference
const spriteQuery = defineQuery([Transform, SpriteRef]);

// Type for game objects that support position and rotation
// Container added for layered glow effects (Geometry Wars aesthetic)
type SpriteGameObject =
  | Phaser.GameObjects.Shape
  | Phaser.GameObjects.Graphics
  | Phaser.GameObjects.Container;

// Global sprite registry: maps entity ID to Phaser game object
export const spriteRegistry = new Map<number, SpriteGameObject>();

/**
 * SpriteSystem syncs ECS entity positions to Phaser sprite positions.
 * This is the bridge between our ECS data and Phaser's rendering.
 */
export function spriteSystem(world: IWorld): IWorld {
  const entities = spriteQuery(world);

  for (let i = 0; i < entities.length; i++) {
    const entityId = entities[i];
    const sprite = spriteRegistry.get(entityId);

    if (sprite) {
      sprite.setPosition(Transform.x[entityId], Transform.y[entityId]);
      sprite.setRotation(Transform.rotation[entityId]);
    }
  }

  return world;
}

/**
 * Registers a sprite for an entity
 */
export function registerSprite(entityId: number, sprite: SpriteGameObject): void {
  spriteRegistry.set(entityId, sprite);
}

/**
 * Gets the sprite for an entity
 */
export function getSprite(entityId: number): SpriteGameObject | undefined {
  return spriteRegistry.get(entityId);
}

/**
 * Unregisters a sprite for an entity (does not destroy - caller handles that)
 */
export function unregisterSprite(entityId: number): void {
  spriteRegistry.delete(entityId);
}

/**
 * Resets the sprite registry, destroying all registered sprites.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetSpriteSystem(): void {
  // Destroy any remaining sprites before clearing
  for (const sprite of spriteRegistry.values()) {
    if (sprite && typeof sprite.destroy === 'function') {
      sprite.destroy();
    }
  }
  spriteRegistry.clear();
}
