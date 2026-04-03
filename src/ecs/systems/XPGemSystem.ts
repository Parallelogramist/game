import { defineQuery, removeEntity, addEntity, addComponent, IWorld } from 'bitecs';
import { Transform, XPGem, XPGemTag, PlayerTag } from '../components';
import { EffectsManager } from '../../effects/EffectsManager';
import { SoundManager } from '../../audio/SoundManager';
import {
  GEM_ATLAS_REFERENCE_SCALE,
  GEM_ATLAS_FRAME_COUNT,
  COMBINED_GEM_ATLAS_KEY,
  GEM_COLOR_TIERS,
  getValueTierIndex,
  getCombinedGemFrame,
  getCombinedSimplifiedFrame,
} from '../../visual/Gem3DRenderer';
import { TrailManager } from '../../visual/TrailManager';
import { VisualQuality } from '../../visual/GlowGraphics';

// ============================================================================
// Constants
// ============================================================================

const PI_TWO = Math.PI * 2;

// Queries
const xpGemQuery = defineQuery([Transform, XPGem, XPGemTag]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// Minimum halfHeight for full 3D rendering (smaller gems use simplified 2D texture)
const MIN_3D_SCALE = 6;

// Movement & collection
const MAGNET_SPEED = 350;
const COLLECT_RANGE = 24;
const COLLECT_RANGE_SQ = COLLECT_RANGE * COLLECT_RANGE;

// Gem limits
const MAX_GEMS = 300;

// Viewport culling margin
const CULL_MARGIN = 100;

// Merge configuration
const MERGE_INTERVAL = 2.0; // Seconds between batch merges
const MERGE_RADIUS_BY_QUALITY = { high: 40, medium: 60, low: 80 };

// Trail throttling
const TRAIL_FRAME_SKIP = 3;
const TRAIL_BUDGET_BY_QUALITY = { high: 20, medium: 8, low: 0 };

// Spatial index cell size (must be >= max merge radius)
const SPATIAL_CELL_SIZE = 80;

const GEM_DEPTH = 5;

// Pre-allocated removal buffers (avoid per-frame array allocations)
const gemsToRemoveBuffer: number[] = [];
const batchMergeRemoveBuffer: number[] = [];

// ============================================================================
// Spin State
// ============================================================================

interface GemSpinState {
  spinPhase: number;
  spinSpeed: number;
  halfHeight: number;
  gemColor: number;
  tierIndex: number;
  image: Phaser.GameObjects.Image;
  isSimplified: boolean;
  cellKey: number; // Spatial index cell key (for efficient removal)
}

const gemSpinStates = new Map<number, GemSpinState>();

// ============================================================================
// Image Sprite Pool
// ============================================================================

const gemImagePool: Phaser.GameObjects.Image[] = [];

// ============================================================================
// Module State
// ============================================================================

// Gem count tracking (avoids querying ECS just to count)
let currentGemCount = 0;

// Magnet range (upgraded by player)
let currentMagnetRange = 80;

// Quality settings
let trailBudgetPerFrame = TRAIL_BUDGET_BY_QUALITY.high;
let spinEveryFrame = true;
let mergeRadius = MERGE_RADIUS_BY_QUALITY.high;
let mergeRadiusSq = mergeRadius * mergeRadius;

// Frame counter for trail staggering
let frameCounter = 0;

// Periodic merge timer
let mergeTimer = 0;

// Callbacks
type XPCollectCallback = (value: number) => void;
let onXPCollectCallback: XPCollectCallback | null = null;

// Scene reference
let sceneReference: Phaser.Scene | null = null;

// Managers
let effectsManager: EffectsManager | null = null;
let soundManager: SoundManager | null = null;
let trailManager: TrailManager | null = null;

// ============================================================================
// Spatial Index for Gem Merging
// ============================================================================

// Maps cellKey -> array of gem entity IDs in that cell
const gemSpatialIndex = new Map<number, number[]>();

function computeCellKey(x: number, y: number): number {
  const cellX = Math.floor(x / SPATIAL_CELL_SIZE) & 0xFFFF;
  const cellY = Math.floor(y / SPATIAL_CELL_SIZE) & 0xFFFF;
  return (cellX << 16) | cellY;
}

function spatialIndexInsert(gemId: number, cellKey: number): void {
  let cell = gemSpatialIndex.get(cellKey);
  if (!cell) {
    cell = [];
    gemSpatialIndex.set(cellKey, cell);
  }
  cell.push(gemId);
}

function spatialIndexRemove(gemId: number, cellKey: number): void {
  const cell = gemSpatialIndex.get(cellKey);
  if (cell) {
    const index = cell.indexOf(gemId);
    if (index !== -1) {
      // Swap-remove for O(1)
      cell[index] = cell[cell.length - 1];
      cell.pop();
    }
    if (cell.length === 0) {
      gemSpatialIndex.delete(cellKey);
    }
  }
}

/**
 * Find the nearest non-magnetized gem within mergeRadiusSq of (x, y).
 * Searches the 3x3 neighborhood of spatial cells.
 */
function findNearbyGemForMerge(x: number, y: number): number {
  const cellX = Math.floor(x / SPATIAL_CELL_SIZE);
  const cellY = Math.floor(y / SPATIAL_CELL_SIZE);

  let nearestId = -1;
  let nearestDistSq = mergeRadiusSq;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const neighborX = (cellX + dx) & 0xFFFF;
      const neighborY = (cellY + dy) & 0xFFFF;
      const key = (neighborX << 16) | neighborY;
      const cell = gemSpatialIndex.get(key);
      if (!cell) continue;

      for (let i = 0; i < cell.length; i++) {
        const candidateId = cell[i];
        // Skip magnetized gems (they're moving and about to be collected)
        if (XPGem.magnetized[candidateId] === 1) continue;

        const candidateX = Transform.x[candidateId];
        const candidateY = Transform.y[candidateId];
        const distX = x - candidateX;
        const distY = y - candidateY;
        const distSq = distX * distX + distY * distY;
        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestId = candidateId;
        }
      }
    }
  }

  return nearestId;
}

// ============================================================================
// Setters
// ============================================================================

export function setXPGemSystemScene(scene: Phaser.Scene): void {
  sceneReference = scene;
}

export function setXPGemEffectsManager(manager: EffectsManager): void {
  effectsManager = manager;
}

export function setXPGemSoundManager(manager: SoundManager): void {
  soundManager = manager;
}

export function setXPGemTrailManager(manager: TrailManager): void {
  trailManager = manager;
}

export function setXPGemMagnetRange(range: number): void {
  currentMagnetRange = range;
}

export function setXPCollectCallback(callback: XPCollectCallback): void {
  onXPCollectCallback = callback;
}

/**
 * Set visual quality level for gems. Affects spin animation, trail budget, and merge aggressiveness.
 */
export function setXPGemQuality(quality: VisualQuality): void {
  trailBudgetPerFrame = TRAIL_BUDGET_BY_QUALITY[quality];
  spinEveryFrame = quality === 'high';
  mergeRadius = MERGE_RADIUS_BY_QUALITY[quality];
  mergeRadiusSq = mergeRadius * mergeRadius;
}

// ============================================================================
// Gem Visual Helpers
// ============================================================================

function computeGemSize(value: number): number {
  return 4 + Math.log2(Math.max(value, 1)) * 1.5;
}

/**
 * Update a gem's visual to match its current value (after merging).
 * Recalculates tier, size, texture frame, and scale.
 */
function updateGemVisual(gemId: number, spinState: GemSpinState): void {
  const value = XPGem.value[gemId];
  const newTierIndex = getValueTierIndex(value);
  const newSize = computeGemSize(value);
  const newHalfHeight = newSize * 1.1;
  const newIsSimplified = newHalfHeight < MIN_3D_SCALE;

  spinState.tierIndex = newTierIndex;
  spinState.gemColor = GEM_COLOR_TIERS[newTierIndex].gemColor;
  spinState.halfHeight = newHalfHeight;
  spinState.isSimplified = newIsSimplified;

  // Update texture frame
  if (newIsSimplified) {
    spinState.image.setFrame(getCombinedSimplifiedFrame(newTierIndex));
  } else {
    const rotationFrame = Math.floor((spinState.spinPhase / PI_TWO) * GEM_ATLAS_FRAME_COUNT) % GEM_ATLAS_FRAME_COUNT;
    spinState.image.setFrame(getCombinedGemFrame(newTierIndex, rotationFrame));
  }

  // Update scale
  const displayScale = newHalfHeight / GEM_ATLAS_REFERENCE_SCALE;
  spinState.image.setScale(displayScale);
}

// ============================================================================
// Spawn
// ============================================================================

/**
 * Spawns an XP gem at the specified position.
 * Merges with a nearby gem if one is within merge radius to limit gem count.
 */
export function spawnXPGem(world: IWorld, positionX: number, positionY: number, value: number): number {
  // Try to merge with a nearby existing gem
  const mergeTargetId = findNearbyGemForMerge(positionX, positionY);
  if (mergeTargetId !== -1) {
    XPGem.value[mergeTargetId] += value;
    const targetSpinState = gemSpinStates.get(mergeTargetId);
    if (targetSpinState) {
      updateGemVisual(mergeTargetId, targetSpinState);
    }
    return mergeTargetId;
  }

  // Hard cap: auto-collect the lowest-value gem if at limit
  if (currentGemCount >= MAX_GEMS) {
    autoCollectLowestValueGem(world);
  }

  const gemId = addEntity(world);

  addComponent(world, Transform, gemId);
  addComponent(world, XPGem, gemId);
  addComponent(world, XPGemTag, gemId);

  Transform.x[gemId] = positionX;
  Transform.y[gemId] = positionY;
  Transform.rotation[gemId] = 0;

  XPGem.value[gemId] = value;
  XPGem.magnetized[gemId] = 0;

  if (sceneReference) {
    const size = computeGemSize(value);
    const halfHeight = size * 1.1;
    const tierIndex = getValueTierIndex(value);
    const gemColor = GEM_COLOR_TIERS[tierIndex].gemColor;
    const isSimplified = halfHeight < MIN_3D_SCALE;
    const initialFrame = isSimplified
      ? getCombinedSimplifiedFrame(tierIndex)
      : getCombinedGemFrame(tierIndex, Math.floor(Math.random() * GEM_ATLAS_FRAME_COUNT));

    // Grab from pool or create new Image
    let gemImage: Phaser.GameObjects.Image;
    if (gemImagePool.length > 0) {
      gemImage = gemImagePool.pop()!;
      gemImage.setTexture(COMBINED_GEM_ATLAS_KEY, initialFrame);
      gemImage.setVisible(true);
      gemImage.setActive(true);
    } else {
      gemImage = sceneReference.add.image(positionX, positionY, COMBINED_GEM_ATLAS_KEY, initialFrame);
    }

    const displayScale = halfHeight / GEM_ATLAS_REFERENCE_SCALE;
    gemImage.setScale(displayScale);
    gemImage.setPosition(positionX, positionY);
    gemImage.setDepth(GEM_DEPTH);

    const cellKey = computeCellKey(positionX, positionY);
    gemSpinStates.set(gemId, {
      spinPhase: Math.random() * PI_TWO,
      spinSpeed: (0.3 + Math.random() * 0.2) * PI_TWO,
      halfHeight,
      gemColor,
      tierIndex,
      image: gemImage,
      isSimplified,
      cellKey,
    });

    spatialIndexInsert(gemId, cellKey);
  }

  currentGemCount++;
  return gemId;
}

/**
 * Auto-collect the lowest-value gem to make room for new spawns.
 */
function autoCollectLowestValueGem(world: IWorld): void {
  const gems = xpGemQuery(world);
  if (gems.length === 0) return;

  let lowestValueId = gems[0];
  let lowestValue = XPGem.value[gems[0]];

  for (let i = 1; i < gems.length; i++) {
    const gemValue = XPGem.value[gems[i]];
    if (gemValue < lowestValue) {
      lowestValue = gemValue;
      lowestValueId = gems[i];
    }
  }

  // Award XP silently (no effects/sound to avoid spam)
  if (onXPCollectCallback) {
    onXPCollectCallback(lowestValue);
  }

  cleanupGem(lowestValueId);
  removeEntity(world, lowestValueId);
}

// ============================================================================
// Main Update Loop
// ============================================================================

/**
 * XPGemSystem handles gem magnetization, collection, viewport culling,
 * trail emission, spin animation, and periodic merging.
 */
export function xpGemSystem(
  world: IWorld,
  deltaTime: number,
  screenWidth: number,
  screenHeight: number
): IWorld {
  const gems = xpGemQuery(world);
  const players = playerQuery(world);

  if (players.length === 0) return world;

  const playerId = players[0];
  const playerX = Transform.x[playerId];
  const playerY = Transform.y[playerId];

  const magnetRangeSq = currentMagnetRange * currentMagnetRange;
  let removeCount = 0;

  frameCounter++;
  let trailBudget = trailBudgetPerFrame;

  // Spin animation: on medium quality, only update every 2nd frame
  const shouldUpdateSpin = spinEveryFrame || (frameCounter & 1) === 0;

  for (let i = 0; i < gems.length; i++) {
    const gemId = gems[i];
    const gemX = Transform.x[gemId];
    const gemY = Transform.y[gemId];
    const isMagnetized = XPGem.magnetized[gemId] === 1;

    // VIEWPORT CULLING: skip all processing for off-screen, non-magnetized gems
    if (!isMagnetized) {
      const onScreen = gemX >= -CULL_MARGIN && gemX <= screenWidth + CULL_MARGIN
                    && gemY >= -CULL_MARGIN && gemY <= screenHeight + CULL_MARGIN;
      if (!onScreen) {
        // Hide sprite if visible
        const spinState = gemSpinStates.get(gemId);
        if (spinState && spinState.image.visible) {
          spinState.image.setVisible(false);
        }
        continue;
      }
    }

    const directionX = playerX - gemX;
    const directionY = playerY - gemY;
    const distanceSq = directionX * directionX + directionY * directionY;

    // Collect gem if close enough
    if (distanceSq < COLLECT_RANGE_SQ) {
      const gemValue = XPGem.value[gemId];
      gemsToRemoveBuffer[removeCount++] = gemId;

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

    // Magnetize if within range (or already magnetized)
    let movedThisFrame = false;
    if (distanceSq < magnetRangeSq || isMagnetized) {
      XPGem.magnetized[gemId] = 1;

      const distance = Math.sqrt(distanceSq);
      if (distance > 0.01) {
        const speedMultiplier = Math.max(0.5, 1 + (1 - distance / currentMagnetRange) * 0.5);
        const speed = MAGNET_SPEED * speedMultiplier;

        const normalizedDirectionX = directionX / distance;
        const normalizedDirectionY = directionY / distance;

        Transform.x[gemId] += normalizedDirectionX * speed * deltaTime;
        Transform.y[gemId] += normalizedDirectionY * speed * deltaTime;
        movedThisFrame = true;
      }
    }

    // Single Map lookup for all visual updates
    const spinState = gemSpinStates.get(gemId);
    if (!spinState) continue;

    // Ensure sprite is visible (may have been culled previously)
    if (!spinState.image.visible) {
      spinState.image.setVisible(true);
    }

    // Trail emission (throttled: staggered per-gem + budget cap)
    if (movedThisFrame && trailManager && trailBudget > 0) {
      if ((frameCounter + gemId) % TRAIL_FRAME_SKIP === 0) {
        const distance = Math.sqrt(distanceSq);
        const trailSize = distance < 50 ? 3.0 : 2.0;
        trailManager.addTrailPoint(gemId, Transform.x[gemId], Transform.y[gemId], spinState.gemColor, trailSize);
        trailBudget--;
      }
    }

    // Position update: only for gems that moved
    if (movedThisFrame) {
      spinState.image.setPosition(Transform.x[gemId], Transform.y[gemId]);
    }

    // Spin animation update (quality-scaled)
    if (!spinState.isSimplified && shouldUpdateSpin) {
      spinState.spinPhase += spinState.spinSpeed * deltaTime;
      if (spinState.spinPhase > PI_TWO) {
        spinState.spinPhase -= PI_TWO;
      }
      const rotationFrame = Math.floor((spinState.spinPhase / PI_TWO) * GEM_ATLAS_FRAME_COUNT) % GEM_ATLAS_FRAME_COUNT;
      spinState.image.setFrame(getCombinedGemFrame(spinState.tierIndex, rotationFrame));
    }
  }

  // Remove collected gems
  for (let i = 0; i < removeCount; i++) {
    cleanupGem(gemsToRemoveBuffer[i]);
    removeEntity(world, gemsToRemoveBuffer[i]);
  }

  // Periodic batch merge (every 2 seconds)
  mergeTimer += deltaTime;
  if (mergeTimer >= MERGE_INTERVAL && currentGemCount > 50) {
    mergeTimer = 0;
    batchMergeNearbyGems(world);
  }

  return world;
}

// ============================================================================
// Batch Merge
// ============================================================================

/**
 * Iterates all non-magnetized gems and merges nearby pairs using the spatial index.
 * Uses 3x3 neighbor search to handle cross-cell-boundary merging correctly.
 */
function batchMergeNearbyGems(world: IWorld): void {
  const gems = xpGemQuery(world);
  const mergedInto = new Set<number>(); // Gems that absorbed others (skip as merge targets)
  let removeCount = 0;

  for (let i = 0; i < gems.length; i++) {
    const gemId = gems[i];
    if (XPGem.magnetized[gemId] === 1) continue;
    if (mergedInto.has(gemId)) continue;

    // Use the spatial index 3x3 search to find a nearby merge partner
    const gemX = Transform.x[gemId];
    const gemY = Transform.y[gemId];
    const nearbyId = findNearbyGemForMerge(gemX, gemY);

    // findNearbyGemForMerge returns any nearby non-magnetized gem, which could be gemId itself
    if (nearbyId === -1 || nearbyId === gemId) continue;
    if (mergedInto.has(nearbyId)) continue;

    // Merge gemId into nearbyId (absorb into the one already in the index)
    XPGem.value[nearbyId] += XPGem.value[gemId];
    const targetSpinState = gemSpinStates.get(nearbyId);
    if (targetSpinState) {
      updateGemVisual(nearbyId, targetSpinState);
    }

    mergedInto.add(nearbyId);
    batchMergeRemoveBuffer[removeCount++] = gemId;
  }

  for (let i = 0; i < removeCount; i++) {
    cleanupGem(batchMergeRemoveBuffer[i]);
    removeEntity(world, batchMergeRemoveBuffer[i]);
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleans up a gem's visual state. Returns the Image sprite to the pool for reuse.
 */
function cleanupGem(gemId: number): void {
  const spinState = gemSpinStates.get(gemId);
  if (spinState) {
    spinState.image.setVisible(false);
    spinState.image.setActive(false);
    gemImagePool.push(spinState.image);
    spatialIndexRemove(gemId, spinState.cellKey);
  }
  gemSpinStates.delete(gemId);
  currentGemCount--;
}

// ============================================================================
// Public Utilities
// ============================================================================

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
 */
export function collectAllGems(world: IWorld): number {
  const gems = xpGemQuery(world);
  let totalXP = 0;

  for (let i = 0; i < gems.length; i++) {
    const gemId = gems[i];
    const gemValue = XPGem.value[gemId];
    totalXP += gemValue;

    if (effectsManager) {
      effectsManager.playXPSparkle(Transform.x[gemId], Transform.y[gemId]);
    }

    cleanupGem(gemId);
    removeEntity(world, gemId);
  }

  if (soundManager && totalXP > 0) {
    soundManager.playPickupXP(totalXP);
  }

  if (onXPCollectCallback && totalXP > 0) {
    onXPCollectCallback(totalXP);
  }

  return totalXP;
}

// ============================================================================
// Glutton Miniboss Support
// ============================================================================

let worldReference: IWorld | null = null;

export function setXPGemWorldReference(world: IWorld): void {
  worldReference = world;
}

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

export function consumeXPGem(gemId: number): void {
  if (!worldReference) return;

  cleanupGem(gemId);
  removeEntity(worldReference, gemId);
}

// ============================================================================
// Reset
// ============================================================================

/**
 * Resets all module-level state in XPGemSystem.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetXPGemSystem(): void {
  worldReference = null;
  sceneReference = null;
  effectsManager = null;
  soundManager = null;
  currentMagnetRange = 80;
  onXPCollectCallback = null;
  trailManager = null;
  currentGemCount = 0;
  frameCounter = 0;
  mergeTimer = 0;
  trailBudgetPerFrame = TRAIL_BUDGET_BY_QUALITY.high;
  spinEveryFrame = true;
  mergeRadius = MERGE_RADIUS_BY_QUALITY.high;
  mergeRadiusSq = mergeRadius * mergeRadius;

  // Destroy all active gem sprites
  for (const spinState of gemSpinStates.values()) {
    spinState.image.destroy();
  }
  gemSpinStates.clear();

  // Destroy pooled sprites
  for (const pooledImage of gemImagePool) {
    pooledImage.destroy();
  }
  gemImagePool.length = 0;

  // Clear spatial index
  gemSpatialIndex.clear();
}
