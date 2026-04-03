import Phaser from 'phaser';
import { VisualQuality } from './GlowGraphics';
import { getSettingsManager } from '../settings';

interface NewTrailSegment {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  color: number;
  size: number;
}

interface TrackedEntity {
  lastX: number;
  lastY: number;
}

// Background color for fade — matches GameConfig backgroundColor
const FADE_BG_COLOR = 0x000008;

/**
 * TrailManager creates glowing motion trails behind moving entities.
 *
 * GPU optimization: Uses a persistent RenderTexture that accumulates trail segments.
 * Each frame only NEW segments are drawn (not all active ones), and a background-color
 * fill fades existing content. This reduces per-frame draw calls from hundreds to ~5-10.
 */
export class TrailManager {
  private renderTexture: Phaser.GameObjects.RenderTexture;
  private tempGraphics: Phaser.GameObjects.Graphics;

  // New segments queued this frame for drawing
  private newSegments: NewTrailSegment[] = [];
  private readonly MAX_NEW_SEGMENTS = 50;

  // Trail configuration
  private readonly MIN_MOVE_DISTANCE = 5;  // Min distance to add new trail point
  private readonly FADE_ALPHA = 0.12;      // Per-frame fade intensity (higher = faster fade)

  // Track entity last positions to detect movement and connect segments
  private trackedEntities: Map<number, TrackedEntity> = new Map();

  // Quality settings
  private enabled: boolean = true;
  private maxTrailsPerFrame: number = 50;

  constructor(scene: Phaser.Scene) {
    const screenWidth = scene.scale.width;
    const screenHeight = scene.scale.height;

    this.renderTexture = scene.add.renderTexture(0, 0, screenWidth, screenHeight);
    this.renderTexture.setOrigin(0, 0);
    this.renderTexture.setDepth(1);  // Just above grid, below entities
    // ADD blend: accumulated near-black fill is invisible (adds ~0), bright trail
    // segments add visible light. Prevents the RT from ever blocking the background.
    this.renderTexture.setBlendMode(Phaser.BlendModes.ADD);

    // Offscreen temp graphics for drawing new segments
    this.tempGraphics = scene.add.graphics();
    this.tempGraphics.setVisible(false);

    // Pre-allocate segment buffer
    for (let i = 0; i < this.MAX_NEW_SEGMENTS; i++) {
      this.newSegments.push({ x: 0, y: 0, prevX: 0, prevY: 0, color: 0, size: 0 });
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
        this.newSegmentCount = 0;  // Discard queued segments
        break;
    }
  }

  // Counter for queued segments this frame
  private newSegmentCount: number = 0;

  /**
   * Add a trail point for an entity if it has moved enough.
   * Queues a new segment connecting this position to the entity's last known position.
   *
   * @param entityId - Unique identifier for the entity
   * @param x - Current X position
   * @param y - Current Y position
   * @param color - Trail color
   * @param size - Trail point size
   * @returns true if a trail segment was queued
   */
  addTrailPoint(
    entityId: number,
    x: number,
    y: number,
    color: number,
    size: number
  ): boolean {
    // Early exit: skip Map lookup and distance check when budget is exhausted
    if (!this.enabled || this.newSegmentCount >= this.maxTrailsPerFrame) return false;
    if (getSettingsManager().isReducedMotionEnabled()) return false;

    // Check if entity has moved enough since last trail point
    const tracked = this.trackedEntities.get(entityId);
    if (tracked) {
      const dx = x - tracked.lastX;
      const dy = y - tracked.lastY;
      const distSq = dx * dx + dy * dy;

      if (distSq < this.MIN_MOVE_DISTANCE * this.MIN_MOVE_DISTANCE) {
        return false;  // Not moved enough
      }

      // Queue a segment from previous position to current
      if (this.newSegmentCount < this.maxTrailsPerFrame) {
        // Grow buffer if needed
        if (this.newSegmentCount >= this.newSegments.length) {
          this.newSegments.push({ x: 0, y: 0, prevX: 0, prevY: 0, color: 0, size: 0 });
        }
        const segment = this.newSegments[this.newSegmentCount++];
        segment.x = x;
        segment.y = y;
        segment.prevX = tracked.lastX;
        segment.prevY = tracked.lastY;
        segment.color = color;
        segment.size = size;
      }

      tracked.lastX = x;
      tracked.lastY = y;
    } else {
      // First time seeing this entity — record position, no segment yet
      this.trackedEntities.set(entityId, { lastX: x, lastY: y });
      return false;
    }

    return true;
  }

  /**
   * Remove tracking for an entity (call when entity is destroyed).
   * Existing trail content on the RenderTexture fades out naturally.
   */
  removeEntity(entityId: number): void {
    this.trackedEntities.delete(entityId);
  }

  /**
   * Update: fade existing trail content, then stamp new segments onto the RenderTexture.
   * Only newly-queued segments are drawn each frame (not all active trails).
   */
  update(_deltaSeconds: number): void {
    if (!this.enabled) return;

    // Fade existing content toward background color
    this.renderTexture.fill(FADE_BG_COLOR, this.FADE_ALPHA);

    // Draw new segments if any were queued this frame
    if (this.newSegmentCount > 0) {
      this.tempGraphics.clear();

      for (let i = 0; i < this.newSegmentCount; i++) {
        const segment = this.newSegments[i];

        const segmentDx = segment.x - segment.prevX;
        const segmentDy = segment.y - segment.prevY;
        const segmentLength = Math.sqrt(segmentDx * segmentDx + segmentDy * segmentDy);
        if (segmentLength < 0.001) continue;

        // Perpendicular normal
        const normalX = -segmentDy / segmentLength;
        const normalY = segmentDx / segmentLength;

        const halfWidth = segment.size;

        // Ribbon quad corners
        const prevLeftX = segment.prevX + normalX * halfWidth * 0.3;
        const prevLeftY = segment.prevY + normalY * halfWidth * 0.3;
        const prevRightX = segment.prevX - normalX * halfWidth * 0.3;
        const prevRightY = segment.prevY - normalY * halfWidth * 0.3;

        const currLeftX = segment.x + normalX * halfWidth;
        const currLeftY = segment.y + normalY * halfWidth;
        const currRightX = segment.x - normalX * halfWidth;
        const currRightY = segment.y - normalY * halfWidth;

        // Glow pass (wider, dimmer)
        this.tempGraphics.fillStyle(segment.color, 0.25);
        this.tempGraphics.fillTriangle(
          segment.prevX + normalX * halfWidth * 0.5, segment.prevY + normalY * halfWidth * 0.5,
          segment.prevX - normalX * halfWidth * 0.5, segment.prevY - normalY * halfWidth * 0.5,
          segment.x + normalX * halfWidth * 1.5, segment.y + normalY * halfWidth * 1.5
        );
        this.tempGraphics.fillTriangle(
          segment.prevX - normalX * halfWidth * 0.5, segment.prevY - normalY * halfWidth * 0.5,
          segment.x - normalX * halfWidth * 1.5, segment.y - normalY * halfWidth * 1.5,
          segment.x + normalX * halfWidth * 1.5, segment.y + normalY * halfWidth * 1.5
        );

        // Core pass (narrow, bright)
        this.tempGraphics.fillStyle(segment.color, 0.6);
        this.tempGraphics.fillTriangle(
          prevLeftX, prevLeftY,
          prevRightX, prevRightY,
          currLeftX, currLeftY
        );
        this.tempGraphics.fillTriangle(
          prevRightX, prevRightY,
          currRightX, currRightY,
          currLeftX, currLeftY
        );
      }

      // Stamp new segments onto the persistent RenderTexture
      this.renderTexture.draw(this.tempGraphics);
      this.newSegmentCount = 0;
    }
  }

  /**
   * Resize the RenderTexture to match new screen dimensions.
   * Call from GameScene.handleResize().
   */
  resize(screenWidth: number, screenHeight: number): void {
    this.renderTexture.resize(screenWidth, screenHeight);
  }

  /**
   * Clear all trail content and tracking data.
   */
  clear(): void {
    this.renderTexture.clear();
    this.trackedEntities.clear();
    this.newSegmentCount = 0;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.renderTexture.destroy();
    this.tempGraphics.destroy();
    this.trackedEntities.clear();
  }
}
