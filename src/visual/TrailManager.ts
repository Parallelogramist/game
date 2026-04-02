import Phaser from 'phaser';
import { VisualQuality } from './GlowGraphics';
import { getSettingsManager } from '../settings';

interface TrailPoint {
  x: number;
  y: number;
  age: number;
  color: number;
  size: number;
  active: boolean;
  entityId: number;
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
        entityId: -1,
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
    if (!this.enabled || getSettingsManager().isReducedMotionEnabled()) return false;

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
    point.entityId = entityId;

    return true;
  }

  /**
   * Remove tracking for an entity (call when entity is destroyed).
   * Trail points remain active and fade out naturally.
   */
  removeEntity(entityId: number): void {
    this.trackedEntities.delete(entityId);
  }

  // Reusable map for grouping trail points by entity each frame (avoids allocation)
  private entityTrailGroups: Map<number, TrailPoint[]> = new Map();
  // Reusable arrays for entity grouping to avoid per-frame allocation
  private groupArrayPool: TrailPoint[][] = [];
  private groupArrayPoolIndex: number = 0;

  private getGroupArray(): TrailPoint[] {
    if (this.groupArrayPoolIndex < this.groupArrayPool.length) {
      const arr = this.groupArrayPool[this.groupArrayPoolIndex++];
      arr.length = 0;
      return arr;
    }
    const arr: TrailPoint[] = [];
    this.groupArrayPool.push(arr);
    this.groupArrayPoolIndex++;
    return arr;
  }

  /**
   * Update and render all active trail points as connected ribbon geometry.
   * @param deltaSeconds - Time since last frame in seconds
   */
  update(deltaSeconds: number): void {
    // OPTIMIZATION: Early exit before clear() when disabled
    if (!this.enabled) return;

    this.graphics.clear();

    // Age all points and group active ones by entityId
    this.entityTrailGroups.clear();
    this.groupArrayPoolIndex = 0;
    let activePointCount = 0;

    for (const point of this.trailPool) {
      if (!point.active) continue;

      // Age the point
      point.age += deltaSeconds;

      if (point.age >= this.TRAIL_LIFETIME) {
        point.active = false;
        continue;
      }

      activePointCount++;
      if (activePointCount > this.maxTrailsPerFrame) continue;

      let group = this.entityTrailGroups.get(point.entityId);
      if (!group) {
        group = this.getGroupArray();
        this.entityTrailGroups.set(point.entityId, group);
      }
      group.push(point);
    }

    // Render each entity's trail as a ribbon
    for (const [, trailPoints] of this.entityTrailGroups) {
      // Sort by age descending so oldest points come first (tail) and newest last (head)
      trailPoints.sort((a, b) => b.age - a.age);

      if (trailPoints.length < 2) {
        // Single point: fall back to a simple circle
        const singlePoint = trailPoints[0];
        const lifeProgress = singlePoint.age / this.TRAIL_LIFETIME;
        const singleAlpha = (1 - lifeProgress) * 0.6;
        const singleShrink = 0.3 + (1 - lifeProgress) * 0.7;
        const singleRadius = singlePoint.size * singleShrink;
        this.graphics.fillStyle(singlePoint.color, singleAlpha * 0.5);
        this.graphics.fillCircle(singlePoint.x, singlePoint.y, singleRadius * 1.5);
        this.graphics.fillStyle(singlePoint.color, singleAlpha);
        this.graphics.fillCircle(singlePoint.x, singlePoint.y, singleRadius);
        continue;
      }

      // Precompute perpendicular normals and widths/alphas for each point
      const pointCount = trailPoints.length;

      // Two-pass ribbon rendering: outer glow pass, then core pass
      for (let pass = 0; pass < 2; pass++) {
        const isGlowPass = pass === 0;
        const widthScale = isGlowPass ? 1.5 : 1.0;
        const alphaScale = isGlowPass ? 0.5 : 1.0;

        for (let i = 0; i < pointCount - 1; i++) {
          const currentPoint = trailPoints[i];
          const nextPoint = trailPoints[i + 1];

          // Direction vector from current to next
          const segmentDx = nextPoint.x - currentPoint.x;
          const segmentDy = nextPoint.y - currentPoint.y;
          const segmentLength = Math.sqrt(segmentDx * segmentDx + segmentDy * segmentDy);

          if (segmentLength < 0.001) continue; // Skip zero-length segments

          // Perpendicular normal (rotated 90 degrees)
          const normalX = -segmentDy / segmentLength;
          const normalY = segmentDx / segmentLength;

          // Current point properties (older = thinner, more transparent)
          const currentLifeProgress = currentPoint.age / this.TRAIL_LIFETIME;
          const currentAlpha = (1 - currentLifeProgress) * 0.6 * alphaScale;
          const currentShrink = 0.3 + (1 - currentLifeProgress) * 0.7;
          const currentHalfWidth = currentPoint.size * currentShrink * widthScale;

          // Next point properties (newer = wider, more opaque)
          const nextLifeProgress = nextPoint.age / this.TRAIL_LIFETIME;
          const nextAlpha = (1 - nextLifeProgress) * 0.6 * alphaScale;
          const nextShrink = 0.3 + (1 - nextLifeProgress) * 0.7;
          const nextHalfWidth = nextPoint.size * nextShrink * widthScale;

          // Four corners of the ribbon quad
          const currentLeftX = currentPoint.x + normalX * currentHalfWidth;
          const currentLeftY = currentPoint.y + normalY * currentHalfWidth;
          const currentRightX = currentPoint.x - normalX * currentHalfWidth;
          const currentRightY = currentPoint.y - normalY * currentHalfWidth;

          const nextLeftX = nextPoint.x + normalX * nextHalfWidth;
          const nextLeftY = nextPoint.y + normalY * nextHalfWidth;
          const nextRightX = nextPoint.x - normalX * nextHalfWidth;
          const nextRightY = nextPoint.y - normalY * nextHalfWidth;

          // Average alpha for this quad segment
          const quadAlpha = (currentAlpha + nextAlpha) * 0.5;

          // Draw quad as two triangles
          this.graphics.fillStyle(currentPoint.color, quadAlpha);

          // Triangle 1: currentLeft, currentRight, nextLeft
          this.graphics.fillTriangle(
            currentLeftX, currentLeftY,
            currentRightX, currentRightY,
            nextLeftX, nextLeftY
          );

          // Triangle 2: currentRight, nextRight, nextLeft
          this.graphics.fillTriangle(
            currentRightX, currentRightY,
            nextRightX, nextRightY,
            nextLeftX, nextLeftY
          );
        }
      }
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
