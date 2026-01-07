import { defineQuery, removeEntity, addEntity, addComponent, IWorld } from 'bitecs';
import { Transform, XPGem, XPGemTag, PlayerTag, SpriteRef } from '../components';
import { getSprite, unregisterSprite, registerSprite } from './SpriteSystem';
import { EffectsManager } from '../../effects/EffectsManager';
import { SoundManager } from '../../audio/SoundManager';
import { renderGem3D, renderSimplifiedGem } from '../../visual/Gem3DRenderer';

// OPTIMIZATION: Pre-computed constants
const PI_TWO = Math.PI * 2;

// Queries
const xpGemQuery = defineQuery([Transform, XPGem, XPGemTag]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// Spin animation state for faux-3D Y-axis rotation effect
interface GemSpinState {
  spinPhase: number;           // Current rotation angle (0 to 2*PI)
  spinSpeed: number;           // Radians per second (randomized per gem)
  gemGraphics: Phaser.GameObjects.Graphics;  // Graphics object for drawing the gem
  halfWidth: number;           // Base diamond dimensions
  halfHeight: number;
  gemColor: number;
  outlineColor: number;
}

const gemSpinStates = new Map<number, GemSpinState>();

// Minimum scale for full 3D rendering (smaller gems use simplified 2D)
const MIN_3D_SCALE = 6;

/**
 * Redraws the gem as a true 3D rotating octahedron.
 * For small gems (< 6px), falls back to simplified 2D diamond for clarity.
 */
function redrawRotatingGem(
  graphics: Phaser.GameObjects.Graphics,
  halfWidth: number,
  halfHeight: number,
  spinPhase: number,
  gemColor: number,
  outlineColor: number
): void {
  graphics.clear();

  // Use halfHeight as the scale (vertical extent of the gem)
  const scale = halfHeight;

  // For tiny gems, use simplified 2D rendering for performance and clarity
  if (scale < MIN_3D_SCALE) {
    renderSimplifiedGem(graphics, halfWidth, halfHeight, gemColor, outlineColor);
    return;
  }

  // Full 3D octahedron rendering
  renderGem3D(graphics, spinPhase, scale, gemColor, outlineColor);
}

// Configuration
let currentMagnetRange = 80; // Distance at which gems start moving toward player
const MAGNET_SPEED = 350; // Speed gems move when magnetized
const COLLECT_RANGE = 24; // Distance to collect gem

// Callback for XP collection
type XPCollectCallback = (value: number) => void;
let onXPCollectCallback: XPCollectCallback | null = null;

// Scene reference for creating gem sprites
let sceneReference: Phaser.Scene | null = null;

// Effects and sound managers
let effectsManager: EffectsManager | null = null;
let soundManager: SoundManager | null = null;

/**
 * Sets the Phaser scene reference for creating gem visuals.
 */
export function setXPGemSystemScene(scene: Phaser.Scene): void {
  sceneReference = scene;
}

/**
 * Set the effects manager for visual feedback.
 */
export function setXPGemEffectsManager(manager: EffectsManager): void {
  effectsManager = manager;
}

/**
 * Set the sound manager for audio feedback.
 */
export function setXPGemSoundManager(manager: SoundManager): void {
  soundManager = manager;
}

/**
 * Set the magnet range for gem attraction.
 * Called when player upgrades the magnetism stat.
 */
export function setXPGemMagnetRange(range: number): void {
  currentMagnetRange = range;
}

/**
 * Register a callback for when XP is collected.
 */
export function setXPCollectCallback(callback: XPCollectCallback): void {
  onXPCollectCallback = callback;
}

/**
 * Spawns an XP gem at the specified position.
 */
export function spawnXPGem(world: IWorld, positionX: number, positionY: number, value: number): number {
  const gemId = addEntity(world);

  // Add components
  addComponent(world, Transform, gemId);
  addComponent(world, XPGem, gemId);
  addComponent(world, XPGemTag, gemId);
  addComponent(world, SpriteRef, gemId);

  // Set position
  Transform.x[gemId] = positionX;
  Transform.y[gemId] = positionY;
  Transform.rotation[gemId] = 0;

  // Set gem value
  XPGem.value[gemId] = value;
  XPGem.magnetized[gemId] = 0;

  // Create visual - enhanced diamond shape with size and color based on XP value
  if (sceneReference) {
    // Logarithmic size scaling: small for basic, huge for bosses
    // value 1: size 4, value 10: size 9, value 300: size 17, value 1000: size 19
    const size = 4 + Math.log2(Math.max(value, 1)) * 1.5;

    // Color tiers based on XP value
    let gemColor: number;
    let outlineColor: number;
    if (value >= 500) {
      // Legendary (boss) - golden
      gemColor = 0xffdd44;
      outlineColor = 0xffffff;
    } else if (value >= 100) {
      // Epic (miniboss) - orange
      gemColor = 0xff9944;
      outlineColor = 0xffffff;
    } else if (value >= 20) {
      // Rare - purple
      gemColor = 0xbb66ff;
      outlineColor = 0xffffff;
    } else if (value >= 5) {
      // Uncommon - blue
      gemColor = 0x44aaff;
      outlineColor = 0xffffff;
    } else {
      // Common - green
      gemColor = 0x44ff44;
      outlineColor = 0xffffff;
    }

    // Create main diamond gem dimensions
    const halfWidth = size * 0.5;
    const halfHeight = size * 1.1;

    // Use Graphics for the gem so we can redraw each frame with rotation scaling
    const gemGraphics = sceneReference.add.graphics();
    gemGraphics.setDepth(5);

    // Draw initial gem shape (will be redrawn each frame with rotation)
    redrawRotatingGem(gemGraphics, halfWidth, halfHeight, 0, gemColor, outlineColor);

    // Create glint highlight at RANDOM position around the gem
    const glintSize = size * 0.2;
    const glintAngle = Math.random() * Math.PI - Math.PI; // Upper half
    const glintRadius = halfHeight * 0.35;
    const glintX = Math.cos(glintAngle) * glintRadius * 0.6;
    const glintY = Math.sin(glintAngle) * glintRadius;

    const glintGraphics = sceneReference.add.graphics();
    glintGraphics.fillStyle(0xffffff, 0.7);
    glintGraphics.fillPoints([
      { x: glintX, y: glintY - glintSize },
      { x: glintX + glintSize * 0.5, y: glintY },
      { x: glintX, y: glintY + glintSize * 0.5 },
      { x: glintX - glintSize * 0.5, y: glintY },
    ], true);
    glintGraphics.setDepth(6);

    // Create container to group all gem visuals for unified movement
    const container = sceneReference.add.container(positionX, positionY, [
      gemGraphics, glintGraphics
    ]);
    container.setDepth(5);

    // Add subtle sparkle animation to the glint
    sceneReference.tweens.add({
      targets: glintGraphics,
      alpha: { from: 0.4, to: 0.9 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Register spin state with randomized phase and speed for visual variety
    gemSpinStates.set(gemId, {
      spinPhase: Math.random() * Math.PI * 2,
      spinSpeed: (0.3 + Math.random() * 0.2) * Math.PI * 2, // 0.3-0.5 rotations/sec
      gemGraphics,
      halfWidth,
      halfHeight,
      gemColor,
      outlineColor,
    });

    registerSprite(gemId, container as unknown as Phaser.GameObjects.Shape);
  }

  return gemId;
}

/**
 * XPGemSystem handles gem magnetization toward player and collection.
 */
export function xpGemSystem(world: IWorld, deltaTime: number): IWorld {
  const gems = xpGemQuery(world);
  const players = playerQuery(world);

  // No player, no collection
  if (players.length === 0) return world;

  const playerId = players[0];
  const playerX = Transform.x[playerId];
  const playerY = Transform.y[playerId];

  const gemsToRemove: number[] = [];

  // OPTIMIZATION: Pre-compute squared thresholds
  const collectRangeSq = COLLECT_RANGE * COLLECT_RANGE;
  const magnetRangeSq = currentMagnetRange * currentMagnetRange;

  for (let i = 0; i < gems.length; i++) {
    const gemId = gems[i];
    const gemX = Transform.x[gemId];
    const gemY = Transform.y[gemId];

    const directionX = playerX - gemX;
    const directionY = playerY - gemY;
    // OPTIMIZATION: Use squared distance for comparisons
    const distanceSq = directionX * directionX + directionY * directionY;

    // Collect gem if close enough (squared comparison)
    if (distanceSq < collectRangeSq) {
      const gemValue = XPGem.value[gemId];
      gemsToRemove.push(gemId);

      // Play collection effects
      if (effectsManager) {
        effectsManager.playXPSparkle(gemX, gemY);
      }
      if (soundManager) {
        soundManager.playPickupXP(gemValue);
      }

      if (onXPCollectCallback) {
        onXPCollectCallback(gemValue);
      }
      continue;
    }

    // Magnetize if within range (or already magnetized) - squared comparison
    if (distanceSq < magnetRangeSq || XPGem.magnetized[gemId] === 1) {
      XPGem.magnetized[gemId] = 1;

      // Only compute sqrt when we actually need to normalize
      const distance = Math.sqrt(distanceSq);

      // Move toward player with increasing speed as they get closer
      // Clamp to minimum 0.5 so distant gems (from magnet pickup) don't move away
      const speedMultiplier = Math.max(0.5, 1 + (1 - distance / currentMagnetRange) * 0.5);
      const speed = MAGNET_SPEED * speedMultiplier;

      const normalizedDirectionX = directionX / distance;
      const normalizedDirectionY = directionY / distance;

      Transform.x[gemId] += normalizedDirectionX * speed * deltaTime;
      Transform.y[gemId] += normalizedDirectionY * speed * deltaTime;
    }

    // Update spin animation for 360-degree rotation effect
    const spinState = gemSpinStates.get(gemId);
    if (spinState) {
      spinState.spinPhase += spinState.spinSpeed * deltaTime;
      if (spinState.spinPhase > PI_TWO) {
        spinState.spinPhase -= PI_TWO;
      }

      // Redraw gem with rotation-scaled width
      redrawRotatingGem(
        spinState.gemGraphics,
        spinState.halfWidth,
        spinState.halfHeight,
        spinState.spinPhase,
        spinState.gemColor,
        spinState.outlineColor
      );
    }
  }

  // Remove collected gems
  for (const gemId of gemsToRemove) {
    const sprite = getSprite(gemId);
    if (sprite) {
      sprite.destroy();
      unregisterSprite(gemId);
    }
    gemSpinStates.delete(gemId);
    removeEntity(world, gemId);
  }

  return world;
}

/**
 * Magnetizes all gems on screen (used for power-ups or level-up vacuum effect).
 */
export function magnetizeAllGems(world: IWorld): void {
  const gems = xpGemQuery(world);
  for (let i = 0; i < gems.length; i++) {
    XPGem.magnetized[gems[i]] = 1;
  }
}

/**
 * Instantly collects all XP gems on the field.
 * Awards the total XP value to the player and removes all gems.
 * Used by the magnet power-up for immediate collection.
 */
export function collectAllGems(world: IWorld): number {
  const gems = xpGemQuery(world);
  let totalXP = 0;

  for (let i = 0; i < gems.length; i++) {
    const gemId = gems[i];
    const gemValue = XPGem.value[gemId];
    totalXP += gemValue;

    // Play collection effects for each gem
    if (effectsManager) {
      effectsManager.playXPSparkle(Transform.x[gemId], Transform.y[gemId]);
    }

    // Clean up sprite and spin state
    const sprite = getSprite(gemId);
    if (sprite) {
      sprite.destroy();
      unregisterSprite(gemId);
    }
    gemSpinStates.delete(gemId);

    // Remove entity
    removeEntity(world, gemId);
  }

  // Play pickup sound once for the whole collection
  if (soundManager && totalXP > 0) {
    soundManager.playPickupXP(totalXP);
  }

  // Award all XP to the player
  if (onXPCollectCallback && totalXP > 0) {
    onXPCollectCallback(totalXP);
  }

  return totalXP;
}

// World reference for Glutton gem consumption
let worldReference: IWorld | null = null;

export function setXPGemWorldReference(world: IWorld): void {
  worldReference = world;
}

/**
 * Gets all XP gem positions (for Glutton miniboss to seek).
 */
export function getXPGemPositions(): { x: number; y: number; entityId: number }[] {
  if (!worldReference) return [];

  const gems = xpGemQuery(worldReference);
  const positions: { x: number; y: number; entityId: number }[] = [];

  for (let i = 0; i < gems.length; i++) {
    const gemId = gems[i];
    positions.push({
      x: Transform.x[gemId],
      y: Transform.y[gemId],
      entityId: gemId,
    });
  }

  return positions;
}

/**
 * Consume (destroy) an XP gem (for Glutton miniboss).
 * Does NOT trigger normal collection callback.
 */
export function consumeXPGem(gemId: number): void {
  if (!worldReference) return;

  const sprite = getSprite(gemId);
  if (sprite) {
    sprite.destroy();
    unregisterSprite(gemId);
  }
  gemSpinStates.delete(gemId);
  removeEntity(worldReference, gemId);
}

/**
 * Resets all module-level state in XPGemSystem.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetXPGemSystem(): void {
  worldReference = null;
  currentMagnetRange = 80; // Reset to default
  onXPCollectCallback = null;
  gemSpinStates.clear();
}
