import { defineQuery, removeEntity, addEntity, addComponent, IWorld } from 'bitecs';
import { Transform, MagnetPickup, MagnetPickupTag, PlayerTag, SpriteRef } from '../components';
import { getSprite, unregisterSprite, registerSprite } from './SpriteSystem';
import { magnetizeAllGems } from './XPGemSystem';
import { EffectsManager } from '../../effects/EffectsManager';
import { SoundManager } from '../../audio/SoundManager';

// Queries
const magnetPickupQuery = defineQuery([Transform, MagnetPickup, MagnetPickupTag]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// Configuration
const MAGNET_RANGE = 100; // Distance at which pickup starts moving toward player
const MAGNET_SPEED = 200; // Speed pickup moves when magnetized
const COLLECT_RANGE = 28; // Distance to collect pickup

// Scene reference for creating pickup sprites
let sceneReference: Phaser.Scene | null = null;

// Effects and sound managers
let effectsManager: EffectsManager | null = null;
let soundManager: SoundManager | null = null;

/**
 * Sets the Phaser scene reference for creating pickup visuals.
 */
export function setMagnetPickupSystemScene(scene: Phaser.Scene): void {
  sceneReference = scene;
}

/**
 * Set the effects manager for visual feedback.
 */
export function setMagnetPickupEffectsManager(manager: EffectsManager): void {
  effectsManager = manager;
}

/**
 * Set the sound manager for audio feedback.
 */
export function setMagnetPickupSoundManager(manager: SoundManager): void {
  soundManager = manager;
}

/**
 * Spawns a magnet pickup at the specified position.
 * When collected, attracts all XP gems on the field to the player.
 */
export function spawnMagnetPickup(world: IWorld, positionX: number, positionY: number): number {
  const pickupId = addEntity(world);

  // Add components
  addComponent(world, Transform, pickupId);
  addComponent(world, MagnetPickup, pickupId);
  addComponent(world, MagnetPickupTag, pickupId);
  addComponent(world, SpriteRef, pickupId);

  // Set position
  Transform.x[pickupId] = positionX;
  Transform.y[pickupId] = positionY;
  Transform.rotation[pickupId] = 0;

  // Initialize magnetized state
  MagnetPickup.magnetized[pickupId] = 0;

  // Create visual - classic horseshoe magnet with red body and white tips
  if (sceneReference) {
    const graphics = sceneReference.add.graphics();
    graphics.setPosition(positionX, positionY);

    drawHorseshoeMagnet(graphics);

    registerSprite(pickupId, graphics);
  }

  return pickupId;
}

/**
 * Draws a classic horseshoe magnet shape with red body and white tips.
 * The U-shape is oriented with the opening facing up (poles/white tips at top).
 */
function drawHorseshoeMagnet(graphics: Phaser.GameObjects.Graphics): void {
  const scale = 1.2;

  // Magnet dimensions
  const outerRadius = 10 * scale;
  const innerRadius = 5 * scale;
  const legLength = 8 * scale;
  const tipHeight = 4 * scale;

  // Colors
  const redBody = 0xcc2222;
  const darkRed = 0x991111;
  const whiteTip = 0xffffff;
  const grayTip = 0xdddddd;

  // Draw dark outline/shadow first for depth
  graphics.lineStyle(2, 0x000000, 0.4);
  drawMagnetOutline(graphics, outerRadius + 1, innerRadius - 1, legLength, tipHeight);

  // Draw the red body of the magnet (the curved part and lower legs)
  graphics.fillStyle(redBody, 1);

  // Left leg (red part below white tip)
  graphics.fillRect(-outerRadius, 0, outerRadius - innerRadius, legLength);

  // Right leg (red part below white tip)
  graphics.fillRect(innerRadius, 0, outerRadius - innerRadius, legLength);

  // Draw the curved horseshoe part at the bottom
  // Outer arc
  graphics.beginPath();
  graphics.arc(0, legLength, outerRadius, 0, Math.PI, false);
  graphics.arc(0, legLength, innerRadius, Math.PI, 0, true);
  graphics.closePath();
  graphics.fillPath();

  // Add darker shade on right side for 3D effect
  graphics.fillStyle(darkRed, 0.5);
  graphics.beginPath();
  graphics.arc(0, legLength, outerRadius, Math.PI * 0.3, Math.PI, false);
  graphics.arc(0, legLength, innerRadius, Math.PI, Math.PI * 0.3, true);
  graphics.closePath();
  graphics.fillPath();

  // Draw the white tips (poles of the magnet) at the top
  graphics.fillStyle(whiteTip, 1);

  // Left tip
  graphics.fillRect(-outerRadius, -tipHeight, outerRadius - innerRadius, tipHeight);

  // Right tip
  graphics.fillRect(innerRadius, -tipHeight, outerRadius - innerRadius, tipHeight);

  // Add slight gray shading on tips for depth
  graphics.fillStyle(grayTip, 0.6);
  graphics.fillRect(-outerRadius + 2, -tipHeight + 1, (outerRadius - innerRadius) - 3, tipHeight - 2);
  graphics.fillRect(innerRadius + 1, -tipHeight + 1, (outerRadius - innerRadius) - 3, tipHeight - 2);

  // Add highlight on left side for shine
  graphics.fillStyle(0xff4444, 0.4);
  graphics.fillRect(-outerRadius, 0, 2, legLength);

  // Draw red outline for crisp edges
  graphics.lineStyle(1, 0x881111, 0.8);
  drawMagnetOutline(graphics, outerRadius, innerRadius, legLength, tipHeight);
}

/**
 * Helper to draw the outline path of the horseshoe magnet (inverted - opening up).
 */
function drawMagnetOutline(
  graphics: Phaser.GameObjects.Graphics,
  outerRadius: number,
  innerRadius: number,
  legLength: number,
  tipHeight: number
): void {
  graphics.beginPath();

  // Start at top-left of left tip
  graphics.moveTo(-outerRadius, -tipHeight);

  // Down the left outer edge
  graphics.lineTo(-outerRadius, legLength);

  // Around the outer arc (bottom)
  graphics.arc(0, legLength, outerRadius, Math.PI, 0, true);

  // Up the right outer edge
  graphics.lineTo(outerRadius, -tipHeight);

  // Across top of right tip
  graphics.lineTo(innerRadius, -tipHeight);

  // Down right inner edge
  graphics.lineTo(innerRadius, legLength);

  // Around the inner arc (bottom)
  graphics.arc(0, legLength, innerRadius, 0, Math.PI, false);

  // Up left inner edge
  graphics.lineTo(-innerRadius, -tipHeight);

  // Close to start
  graphics.lineTo(-outerRadius, -tipHeight);

  graphics.strokePath();
}

/**
 * MagnetPickupSystem handles pickup magnetization toward player and collection.
 * When collected, triggers magnetizeAllGems to pull all XP to player.
 */
export function magnetPickupSystem(world: IWorld, deltaTime: number, gameTime: number = 0): IWorld {
  const pickups = magnetPickupQuery(world);
  const players = playerQuery(world);

  // No player, no collection
  if (players.length === 0) return world;

  const playerId = players[0];
  const playerX = Transform.x[playerId];
  const playerY = Transform.y[playerId];

  const pickupsToRemove: number[] = [];

  // Pre-compute squared thresholds (avoid sqrt in hot loop)
  const collectRangeSq = COLLECT_RANGE * COLLECT_RANGE;
  const magnetRangeSq = MAGNET_RANGE * MAGNET_RANGE;

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

      // Magnetize ALL XP gems to home toward the player!
      magnetizeAllGems(world);

      // Play collection effects
      if (effectsManager) {
        effectsManager.playXPSparkle(pickupX, pickupY);
      }
      if (soundManager) {
        soundManager.playLevelUp();
      }

      continue;
    }

    // Magnetize if within range (or already magnetized) - squared comparison
    if (distanceSq < magnetRangeSq || MagnetPickup.magnetized[pickupId] === 1) {
      MagnetPickup.magnetized[pickupId] = 1;

      // Only compute sqrt when we actually need to normalize
      const distance = Math.sqrt(distanceSq);
      const normalizedDirectionX = directionX / distance;
      const normalizedDirectionY = directionY / distance;

      Transform.x[pickupId] += normalizedDirectionX * MAGNET_SPEED * deltaTime;
      Transform.y[pickupId] += normalizedDirectionY * MAGNET_SPEED * deltaTime;
    }

    // Update sprite position and add pulsing effect
    // OPTIMIZATION: Use gameTime instead of expensive Date.now() calls
    const sprite = getSprite(pickupId);
    if (sprite) {
      sprite.setPosition(Transform.x[pickupId], Transform.y[pickupId]);

      // Pulsing glow effect (speed matches XP gem shimmer)
      const pulse = 0.8 + Math.sin(gameTime * 2.5) * 0.2;
      sprite.setScale(pulse);

      // Rotate slowly for visual appeal (speed matches XP gem shimmer)
      sprite.setRotation(gameTime * 2.5);
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
 * Resets all module-level state in MagnetPickupSystem.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetMagnetPickupSystem(): void {
  // No critical state to reset, but included for consistency
  // Scene/effects/sound refs get overwritten in create() anyway
}
