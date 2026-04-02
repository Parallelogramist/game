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
import { Velocity, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';

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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds between burn damage ticks. */
const BURN_TICK_INTERVAL = 0.5;

/** Damage dealt per burn tick to each enemy in the zone. */
const BURN_TICK_DAMAGE = 5;

/** Velocity multiplier applied to enemies inside an ice patch. */
const ICE_SLOW_MULTIPLIER = 0.5;

/** Strength of the pull force (pixels / second²) applied by void rifts. */
const VOID_PULL_STRENGTH = 120;

/** Multiplicative damage boost while the player stands in an energy well. */
const ENERGY_DAMAGE_MULTIPLIER = 1.25;

/** Fraction of maxDuration during which the zone fades out. */
const FADE_THRESHOLD = 0.2;

// Zone colors (hex)
const HAZARD_COLORS: Record<HazardType, number> = {
  burn: 0xff6622,
  ice: 0x44ccff,
  void: 0xaa44ff,
  energy: 0xffcc22,
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

/** Monotonically increasing time used for pulsing outline. */
let elapsedTime = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store a reference to the Phaser scene so we can create Graphics objects.
 * Call this in GameScene.create() before the game loop starts.
 */
export function setHazardZoneScene(scene: Phaser.Scene): void {
  sceneRef = scene;
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

  const zoneGraphics = sceneRef.add.graphics();
  zoneGraphics.setDepth(DepthLayers.GROUND_EFFECTS);

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

  let playerDamageMultiplier = 1.0;

  const spatialHash = getEnemySpatialHash();

  // Iterate backwards so we can splice expired zones safely
  for (let i = activeZones.length - 1; i >= 0; i--) {
    const zone = activeZones[i];

    // --- Tick duration ---
    zone.duration -= deltaSeconds;
    if (zone.duration <= 0) {
      zone.graphics.destroy();
      activeZones.splice(i, 1);
      continue;
    }

    // --- Compute fade alpha ---
    const fadeStart = zone.maxDuration * FADE_THRESHOLD;
    const fadeFactor = zone.duration < fadeStart
      ? zone.duration / fadeStart
      : 1.0;

    // --- Apply zone effects ---
    switch (zone.type) {
      case 'burn': {
        zone.tickTimer += deltaSeconds;
        if (zone.tickTimer >= BURN_TICK_INTERVAL) {
          zone.tickTimer -= BURN_TICK_INTERVAL;
          const enemiesInZone = spatialHash.queryIds(zone.x, zone.y, zone.radius);
          for (let e = 0; e < enemiesInZone.length; e++) {
            const enemyId = enemiesInZone[e];
            // Skip the player entity
            if (enemyId === playerEntityId) continue;
            Health.current[enemyId] -= BURN_TICK_DAMAGE;
          }
        }
        break;
      }

      case 'ice': {
        const enemiesInZone = spatialHash.queryIds(zone.x, zone.y, zone.radius);
        for (let e = 0; e < enemiesInZone.length; e++) {
          const enemyId = enemiesInZone[e];
          if (enemyId === playerEntityId) continue;
          Velocity.x[enemyId] *= ICE_SLOW_MULTIPLIER;
          Velocity.y[enemyId] *= ICE_SLOW_MULTIPLIER;
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
            Velocity.x[entity.id] += normalizedX * VOID_PULL_STRENGTH * deltaSeconds;
            Velocity.y[entity.id] += normalizedY * VOID_PULL_STRENGTH * deltaSeconds;
          }
        }
        break;
      }

      case 'energy': {
        const distanceToPlayerX = playerX - zone.x;
        const distanceToPlayerY = playerY - zone.y;
        const playerDistanceSquared = distanceToPlayerX * distanceToPlayerX + distanceToPlayerY * distanceToPlayerY;
        if (playerDistanceSquared <= zone.radius * zone.radius) {
          playerDamageMultiplier *= ENERGY_DAMAGE_MULTIPLIER;
        }
        break;
      }
    }

    // --- Redraw visuals ---
    drawZone(zone, fadeFactor);
  }

  return { playerDamageMultiplier };
}

/**
 * Destroy all active zones and reset module state.
 * Call this in GameScene.create() to prevent stale state between runs.
 */
export function resetHazardZoneSystem(): void {
  for (let i = 0; i < activeZones.length; i++) {
    activeZones[i].graphics.destroy();
  }
  activeZones.length = 0;
  sceneRef = null;
  elapsedTime = 0;
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

  const zoneColor = HAZARD_COLORS[zone.type];
  const baseFillAlpha = HAZARD_FILL_ALPHA[zone.type];

  // Filled circle — low alpha area indicator
  const fillAlpha = baseFillAlpha * fadeFactor;
  graphics.fillStyle(zoneColor, fillAlpha);
  graphics.fillCircle(zone.x, zone.y, zone.radius);

  // Pulsing outline ring
  const pulseAlpha = (0.3 + 0.3 * Math.sin(elapsedTime * 3.0)) * fadeFactor;
  graphics.lineStyle(2, zoneColor, pulseAlpha);
  graphics.strokeCircle(zone.x, zone.y, zone.radius);
}
