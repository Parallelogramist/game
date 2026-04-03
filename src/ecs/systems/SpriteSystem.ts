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
const spriteRegistry = new Map<number, SpriteGameObject>();

// Viewport culling margin — entities within this distance of screen edge stay visible
const CULL_MARGIN = 50;

/**
 * SpriteSystem syncs ECS entity positions to Phaser sprite positions.
 * This is the bridge between our ECS data and Phaser's rendering.
 *
 * Performs viewport culling: entities outside the visible screen (plus margin)
 * are set invisible so the WebGL renderer skips them entirely.
 */
export function spriteSystem(world: IWorld, screenWidth: number, screenHeight: number): IWorld {
  const entities = spriteQuery(world);

  const minX = -CULL_MARGIN;
  const minY = -CULL_MARGIN;
  const maxX = screenWidth + CULL_MARGIN;
  const maxY = screenHeight + CULL_MARGIN;

  for (let i = 0; i < entities.length; i++) {
    const entityId = entities[i];
    const sprite = spriteRegistry.get(entityId);

    if (sprite) {
      const entityX = Transform.x[entityId];
      const entityY = Transform.y[entityId];

      // Always sync position so sprite.x/y stays current (other systems may read it)
      sprite.setPosition(entityX, entityY);
      sprite.setRotation(Transform.rotation[entityId]);

      // Toggle visibility — WebGL renderer skips invisible objects entirely
      const onScreen = entityX >= minX && entityX <= maxX && entityY >= minY && entityY <= maxY;
      if (onScreen) {
        if (!sprite.visible) sprite.setVisible(true);
      } else {
        if (sprite.visible) sprite.setVisible(false);
      }
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
