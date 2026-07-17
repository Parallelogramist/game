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

// Fade fills pure black: the RT is displayed with ADD blend, so black content
// contributes nothing — any other fill color would tint the whole screen.
const FADE_BG_COLOR = 0x000000;

/**
 * TrailManager creates glowing motion trails behind moving entities.
 *
 * GPU optimization: Uses a persistent RenderTexture that accumulates trail segments.
 * Each frame only NEW segments are drawn (not all active ones), and a background-color
 * fill fades existing content. This reduces per-frame draw calls from hundreds to ~5-10.
 *
 * Ghost-trail prevention: a multiplicative alpha fade alone never reaches zero in an
 * 8-bit texture (values 1-4/255 round back to themselves), leaving every path ever
 * flown faintly burned into the RT. A second, subtractive fade pass (custom
 * REVERSE_SUBTRACT blend) drains those residuals to exact zero.
 */
export class TrailManager {
  private renderTexture: Phaser.GameObjects.RenderTexture;
  private tempGraphics: Phaser.GameObjects.Graphics;
  private fadeKillRect: Phaser.GameObjects.Rectangle | null = null;

  // New segments queued this frame for drawing
  private newSegments: NewTrailSegment[] = [];
  private readonly MAX_NEW_SEGMENTS = 50;

  // Trail configuration
  private readonly MIN_MOVE_DISTANCE = 5;   // Min distance to add new trail point
  private readonly FADE_ALPHA = 0.12;       // Fade intensity per 60fps-frame (higher = faster fade)
  // A position jump this large in one frame is never movement — it's a teleport
  // or a recycled bitecs entity id (enemy died, id reused across the map). Reset
  // tracking instead of drawing a bogus screen-crossing streak.
  private readonly TELEPORT_DIST_SQ = 150 * 150;
  // Per-frame constant drain (in 1/255 channel steps) that finishes off what the
  // multiplicative fade can't. 2 steps @60fps clears worst-case residue in ~2s.
  private readonly KILL_FADE_STEPS_PER_FRAME = 2;

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

    // Subtractive fade pass — WebGL only (Canvas fallback keeps the plain
    // alpha fade; its residue is the lesser evil vs porting the blend trick).
    const renderer = scene.game.renderer;
    if (renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      const gl = renderer.gl;
      const subtractBlendId = renderer.addBlendMode([gl.ONE, gl.ONE], gl.FUNC_REVERSE_SUBTRACT);
      this.fadeKillRect = scene.add.rectangle(0, 0, screenWidth, screenHeight, 0xffffff, 1);
      this.fadeKillRect.setOrigin(0, 0);
      this.fadeKillRect.setVisible(false);
      this.fadeKillRect.setBlendMode(subtractBlendId);
    }

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
        // Clear the persistent RenderTexture. update() early-returns while
        // disabled, so without this the last-stamped segments would stay
        // frozen on screen forever as ghost trails. Reset position tracking
        // too so re-enabling doesn't draw a long segment across the gap.
        this.renderTexture.clear();
        this.trackedEntities.clear();
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

      if (distSq > this.TELEPORT_DIST_SQ) {
        // Teleport or recycled entity id — re-anchor, never bridge the gap
        tracked.lastX = x;
        tracked.lastY = y;
        return false;
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
  update(deltaSeconds: number): void {
    if (!this.enabled) return;

    // Frame-rate-independent fade: FADE_ALPHA is calibrated for 60fps frames,
    // so a 120Hz display must apply a smaller per-frame alpha to decay at the
    // same real-time rate. Clamp delta so a tab-switch hitch can't wipe trails.
    const frames = Math.min(deltaSeconds, 0.1) * 60;
    const fadeAlpha = 1 - Math.pow(1 - this.FADE_ALPHA, frames);
    this.renderTexture.fill(FADE_BG_COLOR, fadeAlpha);

    // Subtractive kill pass: drains the 8-bit residue the multiplicative fade
    // stalls on, so old trails reach true zero instead of ghosting forever.
    if (this.fadeKillRect) {
      this.fadeKillRect.setAlpha(Math.min(8, this.KILL_FADE_STEPS_PER_FRAME * frames) / 255);
      this.renderTexture.draw(this.fadeKillRect);
    }

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

        // Uniform widths along the whole segment: earlier code widened each
        // segment front-to-back, which made consecutive segments meet in a
        // sawtooth of chevrons that read as ghost ship silhouettes. A constant
        // width chains segments into one smooth ribbon; the RT fade supplies
        // the temporal taper.
        const glowHalf = segment.size * 1.3;
        const coreHalf = segment.size * 0.55;

        // Glow pass (wider, dimmer)
        this.tempGraphics.fillStyle(segment.color, 0.22);
        this.tempGraphics.fillTriangle(
          segment.prevX + normalX * glowHalf, segment.prevY + normalY * glowHalf,
          segment.prevX - normalX * glowHalf, segment.prevY - normalY * glowHalf,
          segment.x + normalX * glowHalf, segment.y + normalY * glowHalf
        );
        this.tempGraphics.fillTriangle(
          segment.prevX - normalX * glowHalf, segment.prevY - normalY * glowHalf,
          segment.x - normalX * glowHalf, segment.y - normalY * glowHalf,
          segment.x + normalX * glowHalf, segment.y + normalY * glowHalf
        );

        // Core pass (narrow, bright)
        this.tempGraphics.fillStyle(segment.color, 0.6);
        this.tempGraphics.fillTriangle(
          segment.prevX + normalX * coreHalf, segment.prevY + normalY * coreHalf,
          segment.prevX - normalX * coreHalf, segment.prevY - normalY * coreHalf,
          segment.x + normalX * coreHalf, segment.y + normalY * coreHalf
        );
        this.tempGraphics.fillTriangle(
          segment.prevX - normalX * coreHalf, segment.prevY - normalY * coreHalf,
          segment.x - normalX * coreHalf, segment.y - normalY * coreHalf,
          segment.x + normalX * coreHalf, segment.y + normalY * coreHalf
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
    this.fadeKillRect?.setSize(screenWidth, screenHeight);
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
    this.fadeKillRect?.destroy();
    this.trackedEntities.clear();
  }
}
