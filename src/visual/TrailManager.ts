import Phaser from 'phaser';
import { VisualQuality } from './GlowGraphics';

interface TrailPoint {
  x: number;
  y: number;
  age: number;
  color: number;
  size: number;
  active: boolean;
}

interface TrackedEntity {
  lastX: number;
  lastY: number;
}

/**
 * TrailManager creates glowing motion trails behind moving entities.
 * Uses a single Graphics object and pooled trail points for performance.
 */
export class TrailManager {
  private graphics: Phaser.GameObjects.Graphics;

  // Trail point pool
  private readonly MAX_TRAIL_POINTS = 500;
  private trailPool: TrailPoint[] = [];
  private nextPoolIndex: number = 0;

  // Trail configuration
  private readonly TRAIL_LIFETIME = 0.25;  // Seconds
  private readonly MIN_MOVE_DISTANCE = 5;  // Min distance to add new trail point

  // Track entity last positions to detect movement
  private trackedEntities: Map<number, TrackedEntity> = new Map();

  // Quality settings
  private enabled: boolean = true;
  private maxTrailsPerFrame: number = 50;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(1);  // Just above grid, below entities

    // Pre-allocate trail point pool
    for (let i = 0; i < this.MAX_TRAIL_POINTS; i++) {
      this.trailPool.push({
        x: 0,
        y: 0,
        age: this.TRAIL_LIFETIME,  // Start expired
        color: 0xffffff,
        size: 5,
        active: false,
      });
    }
  }

  /**
   * Set visual quality level.
   */
  setQuality(quality: VisualQuality): void {
    switch (quality) {
      case 'high':
        this.enabled = true;
        this.maxTrailsPerFrame = 50;
        break;
      case 'medium':
        this.enabled = true;
        this.maxTrailsPerFrame = 20;
        break;
      case 'low':
        this.enabled = false;  // Disable trails in low quality
        break;
    }
  }

  /**
   * Add a trail point for an entity if it has moved enough.
   * Call this each frame for entities that should leave trails.
   *
   * @param entityId - Unique identifier for the entity
   * @param x - Current X position
   * @param y - Current Y position
   * @param color - Trail color
   * @param size - Trail point size
   * @returns true if a trail point was added
   */
  addTrailPoint(
    entityId: number,
    x: number,
    y: number,
    color: number,
    size: number
  ): boolean {
    if (!this.enabled) return false;

    // Check if entity has moved enough since last trail point
    const tracked = this.trackedEntities.get(entityId);
    if (tracked) {
      const dx = x - tracked.lastX;
      const dy = y - tracked.lastY;
      const distSq = dx * dx + dy * dy;

      if (distSq < this.MIN_MOVE_DISTANCE * this.MIN_MOVE_DISTANCE) {
        return false;  // Not moved enough
      }

      tracked.lastX = x;
      tracked.lastY = y;
    } else {
      // First time seeing this entity
      this.trackedEntities.set(entityId, { lastX: x, lastY: y });
      return false;  // Don't add trail on first frame
    }

    // Get a trail point from the pool (cycling through)
    const point = this.trailPool[this.nextPoolIndex];
    this.nextPoolIndex = (this.nextPoolIndex + 1) % this.MAX_TRAIL_POINTS;

    // Configure the trail point
    point.x = x;
    point.y = y;
    point.age = 0;
    point.color = color;
    point.size = size;
    point.active = true;

    return true;
  }

  /**
   * Remove tracking for an entity (call when entity is destroyed).
   */
  removeEntity(entityId: number): void {
    this.trackedEntities.delete(entityId);
  }

  /**
   * Update and render all active trail points.
   * @param deltaSeconds - Time since last frame in seconds
   */
  update(deltaSeconds: number): void {
    // OPTIMIZATION: Early exit before clear() when disabled
    if (!this.enabled) return;

    this.graphics.clear();

    let trailsDrawn = 0;

    for (const point of this.trailPool) {
      if (!point.active) continue;

      // Age the point
      point.age += deltaSeconds;

      if (point.age >= this.TRAIL_LIFETIME) {
        point.active = false;
        continue;
      }

      // Limit trails per frame for performance
      if (trailsDrawn >= this.maxTrailsPerFrame) continue;
      trailsDrawn++;

      // Calculate fade based on age
      const lifeProgress = point.age / this.TRAIL_LIFETIME;
      const alpha = (1 - lifeProgress) * 0.6;  // Max alpha 0.6 - brighter (was 0.4)
      const shrink = 0.3 + (1 - lifeProgress) * 0.7;  // Shrink from 100% to 30%

      // Draw glowing trail point
      const radius = point.size * shrink;

      // Outer glow
      this.graphics.fillStyle(point.color, alpha * 0.5);  // Brighter glow (was 0.3)
      this.graphics.fillCircle(point.x, point.y, radius * 1.5);

      // Core
      this.graphics.fillStyle(point.color, alpha);
      this.graphics.fillCircle(point.x, point.y, radius);
    }
  }

  /**
   * Clear all trail points and tracking data.
   */
  clear(): void {
    for (const point of this.trailPool) {
      point.active = false;
    }
    this.trackedEntities.clear();
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.graphics.destroy();
    this.trackedEntities.clear();
  }
}
