/**
 * HazardZoneSystem manages temporary hazard zones on the battlefield.
 *
 * Module-level state pattern — no class, just exported functions.
 * Call resetHazardZoneSystem() in GameScene.create() to clear state between runs.
 *
 * Hazard types:
 *   burn   – Circular DoT zone (orange/red)
 *   ice    – Slows enemies by 50% (cyan/blue)
 *   void   – Pulls enemies toward center (purple)
 *   energy – Boosts player damage while standing in it (gold)
 */

import Phaser from 'phaser';
import { Transform, Velocity, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { NeonColorPair, getGlowAlphas, getGlowRadiusMultipliers } from '../visual/NeonColors';
import { TUNING } from '../data/GameTuning';
import type { EffectsManager } from '../effects/EffectsManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HazardType = 'burn' | 'ice' | 'void' | 'energy';

export interface HazardZone {
  x: number;
  y: number;
  radius: number;
  type: HazardType;
  duration: number;
  maxDuration: number;
  tickTimer: number;
  graphics: Phaser.GameObjects.Graphics;
}

/** Return value from updateHazardZones — lets the caller read per-frame multipliers. */
export interface HazardUpdateResult {
  /** Multiplicative damage boost for the player (1.0 = no boost). */
  playerDamageMultiplier: number;
  /** Entity IDs of enemies killed by hazard damage this frame. */
  killedEnemyIds: number[];
}

// ---------------------------------------------------------------------------
// Visual constants — neon color pairs per hazard type
// ---------------------------------------------------------------------------

const HAZARD_NEON: Record<HazardType, NeonColorPair> = {
  burn:   { core: 0xff6622, glow: 0xff8844 },
  ice:    { core: 0x44ccff, glow: 0x88eeff },
  void:   { core: 0xaa44ff, glow: 0xcc88ff },
  energy: { core: 0xffcc22, glow: 0xffee66 },
};

// Fill alphas per type (base, before fade)
const HAZARD_FILL_ALPHA: Record<HazardType, number> = {
  burn: 0.20,
  ice: 0.18,
  void: 0.22,
  energy: 0.25,
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const activeZones: HazardZone[] = [];
let sceneRef: Phaser.Scene | null = null;
let effectsManagerRef: EffectsManager | null = null;

/** Monotonically increasing time used for pulsing outline. */
let elapsedTime = 0;

/** Visual quality level — controls glow layer count and per-type flair. */
let visualQuality: 'high' | 'medium' | 'low' = 'high';

// Graphics object pool
const graphicsPool: Phaser.GameObjects.Graphics[] = [];
let poolInitialized = false;

// Ice slow dedup — prevents compounding when zones overlap
const iceSlowedThisFrame = new Set<number>();

// General hazard spawner state
let hazardSpawnTimer = 0;
let nextSpawnInterval = 0;
let worldLevel = 1;

// ---------------------------------------------------------------------------
// Graphics pool helpers
// ---------------------------------------------------------------------------

function initGraphicsPool(): void {
  if (!sceneRef || poolInitialized) return;
  const poolSize = TUNING.hazards.graphicsPoolSize;
  for (let i = 0; i < poolSize; i++) {
    const graphics = sceneRef.add.graphics();
    graphics.setDepth(DepthLayers.GROUND_EFFECTS);
    graphics.setVisible(false);
    graphicsPool.push(graphics);
  }
  poolInitialized = true;
}

function acquireGraphics(): Phaser.GameObjects.Graphics | null {
  for (let i = 0; i < graphicsPool.length; i++) {
    if (!graphicsPool[i].visible) {
      graphicsPool[i].setVisible(true);
      return graphicsPool[i];
    }
  }
  return null; // Pool exhausted — silently skip spawn
}

function releaseGraphics(graphics: Phaser.GameObjects.Graphics): void {
  graphics.clear();
  graphics.setVisible(false);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store a reference to the Phaser scene so we can create Graphics objects.
 * Call this in GameScene.create() before the game loop starts.
 */
export function setHazardZoneScene(scene: Phaser.Scene): void {
  sceneRef = scene;
  initGraphicsPool();
}

/** Store a reference to the EffectsManager for damage numbers. */
export function setHazardZoneEffectsManager(manager: EffectsManager): void {
  effectsManagerRef = manager;
}

/** Set the visual quality level (called when quality changes dynamically). */
export function setHazardZoneQuality(quality: 'high' | 'medium' | 'low'): void {
  visualQuality = quality;
}

/** Set the world level for difficulty scaling. */
export function setHazardZoneWorldLevel(level: number): void {
  worldLevel = level;
}

/**
 * Spawn a new hazard zone at the given world position.
 *
 * @param x        Center X in world coordinates
 * @param y        Center Y in world coordinates
 * @param radius   Zone radius in pixels
 * @param type     One of 'burn' | 'ice' | 'void' | 'energy'
 * @param duration Lifetime in seconds
 */
export function spawnHazardZone(
  x: number,
  y: number,
  radius: number,
  type: HazardType,
  duration: number,
): void {
  if (!sceneRef) return;

  const zoneGraphics = acquireGraphics();
  if (!zoneGraphics) return; // Pool exhausted — natural cap enforcement

  const hazardZone: HazardZone = {
    x,
    y,
    radius,
    type,
    duration,
    maxDuration: duration,
    tickTimer: 0,
    graphics: zoneGraphics,
  };

  activeZones.push(hazardZone);
}

/**
 * Per-frame update: decay durations, apply effects, redraw visuals.
 *
 * @param deltaSeconds  Frame delta in seconds (Phaser delta * 0.001)
 * @param playerEntityId  The player's ECS entity id
 * @param playerX       Player world X (Transform.x[playerId])
 * @param playerY       Player world Y (Transform.y[playerId])
 * @returns HazardUpdateResult with aggregated multipliers for the caller
 */
export function updateHazardZones(
  deltaSeconds: number,
  playerEntityId: number,
  playerX: number,
  playerY: number,
): HazardUpdateResult {
  elapsedTime += deltaSeconds;
  iceSlowedThisFrame.clear();

  let playerDamageMultiplier = 1.0;
  const killedEnemyIds: number[] = [];

  const spatialHash = getEnemySpatialHash();
  const burnDamage = TUNING.hazards.burnTickDamage;
  const burnInterval = TUNING.hazards.burnTickInterval;
  const voidStrength = TUNING.hazards.voidPullStrength;
  const energyMultiplier = TUNING.hazards.energyDamageMultiplier;
  const fadeThreshold = TUNING.hazards.fadeThreshold;

  // Iterate backwards so we can splice expired zones safely
  for (let i = activeZones.length - 1; i >= 0; i--) {
    const zone = activeZones[i];

    // --- Tick duration ---
    zone.duration -= deltaSeconds;
    if (zone.duration <= 0) {
      releaseGraphics(zone.graphics);
      activeZones.splice(i, 1);
      continue;
    }

    // --- Compute fade alpha ---
    const fadeStart = zone.maxDuration * fadeThreshold;
    const fadeFactor = zone.duration < fadeStart
      ? zone.duration / fadeStart
      : 1.0;

    // --- Apply zone effects ---
    switch (zone.type) {
      case 'burn': {
        zone.tickTimer += deltaSeconds;
        if (zone.tickTimer >= burnInterval) {
          zone.tickTimer -= burnInterval;
          const enemiesInZone = spatialHash.queryIds(zone.x, zone.y, zone.radius);
          for (let e = 0; e < enemiesInZone.length; e++) {
            const enemyId = enemiesInZone[e];
            if (enemyId === playerEntityId) continue;
            Health.current[enemyId] -= burnDamage;
            if (Health.current[enemyId] <= 0) {
              killedEnemyIds.push(enemyId);
            }
            if (effectsManagerRef) {
              effectsManagerRef.showDamageNumber(
                Transform.x[enemyId],
                Transform.y[enemyId] - 15,
                burnDamage,
                HAZARD_NEON.burn.core,
              );
            }
          }
        }
        break;
      }

      case 'ice': {
        // Ice slow is deferred — collected here, applied in applyIceHazardSlow()
        // after EnemyAI sets velocities, matching the Warden slow pattern.
        const enemiesInZone = spatialHash.queryIds(zone.x, zone.y, zone.radius);
        for (let e = 0; e < enemiesInZone.length; e++) {
          const enemyId = enemiesInZone[e];
          if (enemyId === playerEntityId) continue;
          iceSlowedThisFrame.add(enemyId);
        }
        break;
      }

      case 'void': {
        const enemiesInZone = spatialHash.query(zone.x, zone.y, zone.radius);
        for (let e = 0; e < enemiesInZone.length; e++) {
          const entity = enemiesInZone[e];
          if (entity.id === playerEntityId) continue;
          const deltaX = zone.x - entity.x;
          const deltaY = zone.y - entity.y;
          const distanceToCenter = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          if (distanceToCenter > 1) {
            const normalizedX = deltaX / distanceToCenter;
            const normalizedY = deltaY / distanceToCenter;
            Velocity.x[entity.id] += normalizedX * voidStrength * deltaSeconds;
            Velocity.y[entity.id] += normalizedY * voidStrength * deltaSeconds;
          }
        }
        break;
      }

      case 'energy': {
        const distanceToPlayerX = playerX - zone.x;
        const distanceToPlayerY = playerY - zone.y;
        const playerDistanceSquared = distanceToPlayerX * distanceToPlayerX + distanceToPlayerY * distanceToPlayerY;
        if (playerDistanceSquared <= zone.radius * zone.radius) {
          playerDamageMultiplier *= energyMultiplier;
        }
        break;
      }
    }

    // --- Redraw visuals ---
    drawZone(zone, fadeFactor);
  }

  return { playerDamageMultiplier, killedEnemyIds };
}

/**
 * Apply ice hazard slow to enemies collected during updateHazardZones().
 * Must be called AFTER enemyAISystem (which sets velocities) and BEFORE movementSystem.
 * This matches the Warden slow aura pattern in GameScene.
 */
export function applyIceHazardSlow(): void {
  if (iceSlowedThisFrame.size === 0) return;
  const iceMultiplier = TUNING.hazards.iceSlowMultiplier;
  for (const enemyId of iceSlowedThisFrame) {
    Velocity.x[enemyId] *= iceMultiplier;
    Velocity.y[enemyId] *= iceMultiplier;
  }
}

// ---------------------------------------------------------------------------
// General hazard spawner
// ---------------------------------------------------------------------------

/**
 * Per-frame spawner: creates hazard zones throughout the run, escalating with time.
 * Call this from GameScene.update() after updateHazardZones().
 */
export function updateHazardSpawner(
  deltaSeconds: number,
  gameTime: number,
  playerX: number,
  playerY: number,
  screenWidth: number,
  screenHeight: number,
): void {
  const config = TUNING.hazards;

  // No spawns before the safe period
  if (gameTime < config.spawnStartTime) return;

  // Cap enforcement — don't accumulate timer if at max
  if (activeZones.length >= config.maxConcurrentZones) return;

  hazardSpawnTimer += deltaSeconds;

  // Compute current spawn interval
  if (nextSpawnInterval <= 0) {
    nextSpawnInterval = computeSpawnInterval(gameTime);
  }

  if (hazardSpawnTimer < nextSpawnInterval) return;

  hazardSpawnTimer = 0;

  // Pick hazard type from those unlocked at current game time
  const hazardType = pickHazardType(gameTime);
  if (!hazardType) return;

  // Compute world-level-scaled radius and duration
  const worldRadiusScale = 1 + (worldLevel - 1) * config.worldLevelRadiusBonus;
  const worldDurationScale = 1 + (worldLevel - 1) * config.worldLevelDurationBonus;
  const zoneRadius = config.baseRadius[hazardType] * worldRadiusScale;
  const zoneDuration = config.baseDuration[hazardType] * worldDurationScale;

  // Pick position within screen, avoiding player
  const margin = config.screenMargin;
  let spawnX = margin + Math.random() * (screenWidth - 2 * margin);
  let spawnY = margin + Math.random() * (screenHeight - 2 * margin);

  // Push away from player if too close
  const distanceToPlayerX = spawnX - playerX;
  const distanceToPlayerY = spawnY - playerY;
  const distanceToPlayerSquared = distanceToPlayerX * distanceToPlayerX + distanceToPlayerY * distanceToPlayerY;
  const exclusionRadius = config.playerExclusionRadius;
  if (distanceToPlayerSquared < exclusionRadius * exclusionRadius) {
    const distanceToPlayer = Math.sqrt(distanceToPlayerSquared);
    if (distanceToPlayer > 1) {
      const pushDistance = exclusionRadius - distanceToPlayer + 20;
      spawnX += (distanceToPlayerX / distanceToPlayer) * pushDistance;
      spawnY += (distanceToPlayerY / distanceToPlayer) * pushDistance;
    } else {
      // Player is exactly at spawn point — offset randomly
      spawnX += exclusionRadius * (Math.random() > 0.5 ? 1 : -1);
    }
    // Clamp back into screen bounds
    spawnX = Math.max(margin, Math.min(screenWidth - margin, spawnX));
    spawnY = Math.max(margin, Math.min(screenHeight - margin, spawnY));
  }

  spawnHazardZone(spawnX, spawnY, zoneRadius, hazardType, zoneDuration);
  nextSpawnInterval = computeSpawnInterval(gameTime);
}

function computeSpawnInterval(gameTime: number): number {
  const config = TUNING.hazards;
  const elapsedSinceStart = gameTime - config.spawnStartTime;
  const progress = Math.min(elapsedSinceStart / config.spawnRampDuration, 1);
  const baseInterval = config.baseSpawnInterval + (config.minSpawnInterval - config.baseSpawnInterval) * progress;
  const worldReduction = 1 - (worldLevel - 1) * config.worldLevelSpawnIntervalReduction;
  return Math.max(config.minSpawnInterval, baseInterval * Math.max(0.3, worldReduction));
}

function pickHazardType(gameTime: number): HazardType | null {
  const unlockTimes = TUNING.hazards.typeUnlockTimes;
  const eligible: { type: HazardType; weight: number }[] = [];

  // Build weighted pool from unlocked types
  if (gameTime >= unlockTimes.burn)   eligible.push({ type: 'burn',   weight: 35 });
  if (gameTime >= unlockTimes.ice)    eligible.push({ type: 'ice',    weight: 25 });
  if (gameTime >= unlockTimes.energy) eligible.push({ type: 'energy', weight: 20 });
  if (gameTime >= unlockTimes.void)   eligible.push({ type: 'void',   weight: 20 });

  if (eligible.length === 0) return null;

  // Weighted random selection
  let totalWeight = 0;
  for (let i = 0; i < eligible.length; i++) totalWeight += eligible[i].weight;

  let roll = Math.random() * totalWeight;
  for (let i = 0; i < eligible.length; i++) {
    roll -= eligible[i].weight;
    if (roll <= 0) return eligible[i].type;
  }
  return eligible[eligible.length - 1].type;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Destroy all active zones and reset module state.
 * Call this in GameScene.create() to prevent stale state between runs.
 */
export function resetHazardZoneSystem(): void {
  // Release all active zone graphics back to pool
  for (let i = 0; i < activeZones.length; i++) {
    releaseGraphics(activeZones[i].graphics);
  }
  activeZones.length = 0;

  // Destroy pooled graphics (scene is being torn down)
  for (let i = 0; i < graphicsPool.length; i++) {
    graphicsPool[i].destroy();
  }
  graphicsPool.length = 0;
  poolInitialized = false;

  sceneRef = null;
  effectsManagerRef = null;
  elapsedTime = 0;
  visualQuality = 'high';
  worldLevel = 1;
  hazardSpawnTimer = 0;
  nextSpawnInterval = 0;
  iceSlowedThisFrame.clear();
}

/**
 * Get the count of currently active hazard zones (useful for UI / debugging).
 */
export function getActiveHazardZoneCount(): number {
  return activeZones.length;
}

// ---------------------------------------------------------------------------
// Internal rendering
// ---------------------------------------------------------------------------

function drawZone(zone: HazardZone, fadeFactor: number): void {
  const graphics = zone.graphics;
  graphics.clear();

  const neon = HAZARD_NEON[zone.type];
  const baseFillAlpha = HAZARD_FILL_ALPHA[zone.type];

  // --- Quality-scaled neon glow rings (outermost first) ---
  const glowAlphas = getGlowAlphas(visualQuality);
  const glowMultipliers = getGlowRadiusMultipliers(visualQuality);

  for (let i = 0; i < glowAlphas.length; i++) {
    const glowRadius = zone.radius * glowMultipliers[i];
    // Ground hazards use half the normal glow intensity to stay subtle
    graphics.fillStyle(neon.glow, glowAlphas[i] * fadeFactor * 0.5);
    graphics.fillCircle(zone.x, zone.y, glowRadius);
  }

  // --- Core fill ---
  graphics.fillStyle(neon.core, baseFillAlpha * fadeFactor);
  graphics.fillCircle(zone.x, zone.y, zone.radius);

  // --- Pulsing outline ring ---
  const pulseAlpha = (0.4 + 0.3 * Math.sin(elapsedTime * 3.0)) * fadeFactor;
  graphics.lineStyle(2, neon.core, pulseAlpha);
  graphics.strokeCircle(zone.x, zone.y, zone.radius);

  // --- Per-type visual flair (medium/high quality only) ---
  if (visualQuality !== 'low') {
    drawTypeFlair(graphics, zone, fadeFactor);
  }
}

function drawTypeFlair(
  graphics: Phaser.GameObjects.Graphics,
  zone: HazardZone,
  fadeFactor: number,
): void {
  const neon = HAZARD_NEON[zone.type];

  switch (zone.type) {
    case 'burn': {
      // Inner flickering shimmer ring — heat distortion effect
      const shimmerAlpha = (0.15 + 0.12 * Math.sin(elapsedTime * 7)) * fadeFactor;
      graphics.lineStyle(3, neon.glow, shimmerAlpha);
      graphics.strokeCircle(zone.x, zone.y, zone.radius * 0.7);
      if (visualQuality === 'high') {
        const innerShimmerAlpha = (0.1 + 0.08 * Math.sin(elapsedTime * 11 + 1.5)) * fadeFactor;
        graphics.lineStyle(2, neon.core, innerShimmerAlpha);
        graphics.strokeCircle(zone.x, zone.y, zone.radius * 0.45);
      }
      break;
    }

    case 'ice': {
      // Crystalline edge segments at hexagonal positions
      const segmentCount = visualQuality === 'high' ? 6 : 3;
      for (let i = 0; i < segmentCount; i++) {
        const baseAngle = (i / segmentCount) * Math.PI * 2;
        const flickerAlpha = (0.2 + 0.15 * Math.sin(elapsedTime * 2 + i * 1.3)) * fadeFactor;
        graphics.lineStyle(2, neon.glow, flickerAlpha);

        const innerRadius = zone.radius * 0.85;
        const outerRadius = zone.radius * 1.05;
        const startX = zone.x + Math.cos(baseAngle) * innerRadius;
        const startY = zone.y + Math.sin(baseAngle) * innerRadius;
        const endX = zone.x + Math.cos(baseAngle) * outerRadius;
        const endY = zone.y + Math.sin(baseAngle) * outerRadius;

        graphics.beginPath();
        graphics.moveTo(startX, startY);
        graphics.lineTo(endX, endY);
        graphics.strokePath();
      }
      break;
    }

    case 'void': {
      // Swirling pull arcs that rotate over time
      const arcCount = visualQuality === 'high' ? 3 : 2;
      for (let i = 0; i < arcCount; i++) {
        const baseAngle = (i / arcCount) * Math.PI * 2 + elapsedTime * 1.5;
        const arcAlpha = (0.18 + 0.1 * Math.sin(elapsedTime * 3 + i * 2)) * fadeFactor;
        graphics.lineStyle(2, neon.glow, arcAlpha);
        graphics.beginPath();
        graphics.arc(zone.x, zone.y, zone.radius * 0.6, baseAngle, baseAngle + 0.8);
        graphics.strokePath();
      }
      break;
    }

    case 'energy': {
      // Rising bright inner pulse — concentrated power
      const pulseAlpha = (0.15 + 0.12 * Math.sin(elapsedTime * 4)) * fadeFactor;
      graphics.fillStyle(neon.glow, pulseAlpha);
      graphics.fillCircle(zone.x, zone.y, zone.radius * 0.4);
      if (visualQuality === 'high') {
        const coreAlpha = (0.08 + 0.06 * Math.sin(elapsedTime * 6 + 1)) * fadeFactor;
        graphics.fillStyle(0xffffff, coreAlpha);
        graphics.fillCircle(zone.x, zone.y, zone.radius * 0.2);
      }
      break;
    }
  }
}
