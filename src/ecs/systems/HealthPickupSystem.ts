import { defineQuery, removeEntity, addEntity, addComponent, IWorld } from 'bitecs';
import { Transform, HealthPickup, HealthPickupTag, PlayerTag, SpriteRef } from '../components';
import { getSprite, unregisterSprite, registerSprite } from './SpriteSystem';
import { EffectsManager } from '../../effects/EffectsManager';
import { SoundManager } from '../../audio/SoundManager';

// Queries
const healthPickupQuery = defineQuery([Transform, HealthPickup, HealthPickupTag]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// Configuration
let currentMagnetRange = 60; // Distance at which pickups start moving toward player
const MAGNET_SPEED = 250; // Speed pickups move when magnetized
const COLLECT_RANGE = 24; // Distance to collect pickup

// Callback for health collection
type HealthCollectCallback = (healAmount: number) => void;
let onHealthCollectCallback: HealthCollectCallback | null = null;

// Scene reference for creating pickup sprites
let sceneReference: Phaser.Scene | null = null;

// Effects and sound managers
let effectsManager: EffectsManager | null = null;
let soundManager: SoundManager | null = null;

/**
 * Sets the Phaser scene reference for creating pickup visuals.
 */
export function setHealthPickupSystemScene(scene: Phaser.Scene): void {
  sceneReference = scene;
}

/**
 * Set the effects manager for visual feedback.
 */
export function setHealthPickupEffectsManager(manager: EffectsManager): void {
  effectsManager = manager;
}

/**
 * Set the sound manager for audio feedback.
 */
export function setHealthPickupSoundManager(manager: SoundManager): void {
  soundManager = manager;
}

/**
 * Set the magnet range for health pickup attraction.
 * Called when player upgrades the magnetism stat.
 */
export function setHealthPickupMagnetRange(range: number): void {
  currentMagnetRange = range;
}

/**
 * Register a callback for when health is collected.
 */
export function setHealthCollectCallback(callback: HealthCollectCallback): void {
  onHealthCollectCallback = callback;
}

/**
 * Spawns a health pickup at the specified position.
 */
export function spawnHealthPickup(world: IWorld, positionX: number, positionY: number, healAmount: number): number {
  const pickupId = addEntity(world);

  // Add components
  addComponent(world, Transform, pickupId);
  addComponent(world, HealthPickup, pickupId);
  addComponent(world, HealthPickupTag, pickupId);
  addComponent(world, SpriteRef, pickupId);

  // Set position
  Transform.x[pickupId] = positionX;
  Transform.y[pickupId] = positionY;
  Transform.rotation[pickupId] = 0;

  // Set heal amount
  HealthPickup.healAmount[pickupId] = healAmount;
  HealthPickup.magnetized[pickupId] = 0;

  // Create visual - med pack with black cross
  if (sceneReference) {
    const width = 22;
    const height = 18;
    const crossThickness = 5;
    const crossLength = 10;

    const graphics = sceneReference.add.graphics();
    graphics.setPosition(positionX, positionY);

    // Red med pack background with white border
    graphics.lineStyle(2, 0xffffff, 1);
    graphics.fillStyle(0xff6666, 1);
    graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 3);
    graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 3);

    // White outline for cross (drawn first, slightly larger)
    const outlineSize = 1;
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(-crossLength / 2 - outlineSize, -crossThickness / 2 - outlineSize, crossLength + outlineSize * 2, crossThickness + outlineSize * 2);
    graphics.fillRect(-crossThickness / 2 - outlineSize, -crossLength / 2 - outlineSize, crossThickness + outlineSize * 2, crossLength + outlineSize * 2);

    // Black cross in the center
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(-crossLength / 2, -crossThickness / 2, crossLength, crossThickness);
    graphics.fillRect(-crossThickness / 2, -crossLength / 2, crossThickness, crossLength);

    registerSprite(pickupId, graphics);
  }

  return pickupId;
}

/**
 * HealthPickupSystem handles pickup magnetization toward player and collection.
 * @param gameTime - Total elapsed game time in seconds (used for visual effects)
 */
export function healthPickupSystem(world: IWorld, deltaTime: number, gameTime: number = 0): IWorld {
  const pickups = healthPickupQuery(world);
  const players = playerQuery(world);

  // No player, no collection
  if (players.length === 0) return world;

  const playerId = players[0];
  const playerX = Transform.x[playerId];
  const playerY = Transform.y[playerId];

  const pickupsToRemove: number[] = [];

  // Pre-compute squared thresholds (avoid sqrt in hot loop)
  const collectRangeSq = COLLECT_RANGE * COLLECT_RANGE;
  const magnetRangeSq = currentMagnetRange * currentMagnetRange;

  for (let i = 0; i < pickups.length; i++) {
    const pickupId = pickups[i];
    const pickupX = Transform.x[pickupId];
    const pickupY = Transform.y[pickupId];

    const directionX = playerX - pickupX;
    const directionY = playerY - pickupY;
    // OPTIMIZATION: Use squared distance for comparisons, only sqrt when needed
    const distanceSq = directionX * directionX + directionY * directionY;

    // Collect pickup if close enough (squared comparison)
    if (distanceSq < collectRangeSq) {
      pickupsToRemove.push(pickupId);

      // Play collection effects
      if (effectsManager) {
        effectsManager.playHealthPickup(pickupX, pickupY);
      }
      if (soundManager) {
        soundManager.playPickupHealth();
      }

      if (onHealthCollectCallback) {
        onHealthCollectCallback(HealthPickup.healAmount[pickupId]);
      }
      continue;
    }

    // Magnetize if within range (or already magnetized) - squared comparison
    if (distanceSq < magnetRangeSq || HealthPickup.magnetized[pickupId] === 1) {
      HealthPickup.magnetized[pickupId] = 1;

      // Only compute sqrt when we actually need to normalize
      const distance = Math.sqrt(distanceSq);
      const normalizedDirectionX = directionX / distance;
      const normalizedDirectionY = directionY / distance;

      Transform.x[pickupId] += normalizedDirectionX * MAGNET_SPEED * deltaTime;
      Transform.y[pickupId] += normalizedDirectionY * MAGNET_SPEED * deltaTime;
    }

    // Pulse the pickup sprite for visibility (speed matches XP gem shimmer)
    // OPTIMIZATION: Use gameTime instead of expensive Date.now() call
    const sprite = getSprite(pickupId);
    if (sprite) {
      const pulse = 0.9 + Math.sin(gameTime * 2.5) * 0.1;
      sprite.setScale(pulse);
    }
  }

  // Remove collected pickups
  for (const pickupId of pickupsToRemove) {
    const sprite = getSprite(pickupId);
    if (sprite) {
      sprite.destroy();
      unregisterSprite(pickupId);
    }
    removeEntity(world, pickupId);
  }

  return world;
}

/**
 * Resets all module-level state in HealthPickupSystem.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetHealthPickupSystem(): void {
  currentMagnetRange = 60; // Reset to default
  onHealthCollectCallback = null;
}
