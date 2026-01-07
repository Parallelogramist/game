import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../GameConfig';
import { GRID_COLORS } from './NeonColors';
import { VisualQuality } from './GlowGraphics';
import { SpatialHash } from '../utils/SpatialHash';

interface GravityPoint {
  x: number;
  y: number;
  weight: number;  // Entity mass/size determines warp intensity (0.3-3.0)
}

/**
 * GridBackground creates the iconic Geometry Wars warping grid effect.
 * Grid lines bend around entities like gravity wells.
 *
 * PERFORMANCE OPTIMIZATIONS:
 * 1. Uses spatial hashing to only check nearby entities (O(1) vs O(n) per point)
 * 2. Updates every 2 frames with position interpolation for smooth visuals
 * 3. Caches warped line data between frames
 */
export class GridBackground {
  private graphics: Phaser.GameObjects.Graphics;

  // Grid configuration
  private readonly CELL_SIZE = 40;
  private readonly LINE_ALPHA_BASE = 0.55;  // Brighter (was 0.35)
  private readonly WARP_RADIUS = 80;       // Max distance for warping effect (reduced for cleaner grid)
  private readonly MAX_WARP = 12;          // Maximum displacement per gravity point in pixels
  private readonly MAX_TOTAL_DISPLACEMENT = 15;  // Hard cap on cumulative displacement

  // Segments per line (more = smoother warping, less = better performance)
  private segmentsPerLine = 20;

  // Pulse animation
  private pulsePhase: number = 0;
  private readonly PULSE_SPEED = 1.5;

  // Gravity points (entity positions that warp the grid)
  private gravityPoints: GravityPoint[] = [];

  // Spatial hash for gravity points (80px cells match WARP_RADIUS)
  private spatialHash: SpatialHash;

  // Frame throttling for performance
  private frameCounter: number = 0;
  private readonly UPDATE_EVERY_N_FRAMES = 2;

  // Cached gravity points for interpolation
  private prevGravityPoints: GravityPoint[] = [];
  private currentGravityPoints: GravityPoint[] = [];
  private playerPos: { x: number; y: number } | null = null;
  private prevPlayerPos: { x: number; y: number } | null = null;

  // OPTIMIZATION: Pre-allocated points array for warped line calculation
  private warpedPointsBuffer: { x: number; y: number; warpAmount: number }[] = [];

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(0);  // Behind everything
    this.spatialHash = new SpatialHash(80);  // Cell size matches WARP_RADIUS

    // OPTIMIZATION: Pre-allocate warped points buffer with default size (high quality)
    for (let i = 0; i <= 20; i++) {
      this.warpedPointsBuffer.push({ x: 0, y: 0, warpAmount: 0 });
    }
  }

  /**
   * Set the visual quality level, adjusting segments and warp complexity.
   */
  setQuality(quality: VisualQuality): void {
    switch (quality) {
      case 'high':
        this.segmentsPerLine = 20;
        break;
      case 'medium':
        this.segmentsPerLine = 12;
        break;
      case 'low':
        this.segmentsPerLine = 0;  // No warping, just static grid
        break;
    }

    // OPTIMIZATION: Pre-allocate warped points buffer based on segments
    if (this.segmentsPerLine > 0) {
      const requiredSize = this.segmentsPerLine + 1;
      while (this.warpedPointsBuffer.length < requiredSize) {
        this.warpedPointsBuffer.push({ x: 0, y: 0, warpAmount: 0 });
      }
    }
  }

  /**
   * Update gravity points from entity positions.
   * Should be called each frame with current entity data.
   *
   * @param playerPos - Player position (always included with strong effect)
   * @param entityData - Array of entity positions with pre-calculated weights
   */
  setGravityPoints(
    playerPos: { x: number; y: number } | null,
    entityData: { x: number; y: number; weight: number }[]
  ): void {
    // Store previous positions for interpolation
    this.prevPlayerPos = this.playerPos;
    this.playerPos = playerPos;

    // Swap buffers for interpolation
    const temp = this.prevGravityPoints;
    this.prevGravityPoints = this.currentGravityPoints;
    this.currentGravityPoints = temp;

    // Update current gravity points
    this.currentGravityPoints.length = 0;
    for (const entity of entityData) {
      this.currentGravityPoints.push({
        x: entity.x,
        y: entity.y,
        weight: entity.weight,
      });
    }
  }

  /**
   * Update and redraw the grid.
   * @param deltaSeconds - Time since last frame in seconds
   */
  update(deltaSeconds: number): void {
    // Update pulse animation (always, for smooth pulsing)
    this.pulsePhase += deltaSeconds * this.PULSE_SPEED;

    this.frameCounter++;

    // Only do full recalculation every N frames
    const isFullUpdateFrame = this.frameCounter % this.UPDATE_EVERY_N_FRAMES === 0;

    if (isFullUpdateFrame) {
      // Rebuild gravity points and spatial hash
      this.rebuildGravityPoints(1.0);  // Use current positions
    } else {
      // Interpolate between previous and current positions
      const interpolationFactor = (this.frameCounter % this.UPDATE_EVERY_N_FRAMES) / this.UPDATE_EVERY_N_FRAMES;
      this.rebuildGravityPoints(interpolationFactor);
    }

    // Redraw grid
    this.redrawGrid();
  }

  /**
   * Rebuild gravity points array with optional interpolation.
   * @param t - Interpolation factor (0 = prev positions, 1 = current positions)
   */
  private rebuildGravityPoints(t: number): void {
    this.gravityPoints.length = 0;
    this.spatialHash.clear();

    // Add player with interpolated position
    if (this.playerPos) {
      let px = this.playerPos.x;
      let py = this.playerPos.y;

      if (t < 1 && this.prevPlayerPos) {
        px = this.prevPlayerPos.x + (this.playerPos.x - this.prevPlayerPos.x) * t;
        py = this.prevPlayerPos.y + (this.playerPos.y - this.prevPlayerPos.y) * t;
      }

      const playerGP: GravityPoint = { x: px, y: py, weight: 1.5 };
      this.gravityPoints.push(playerGP);
      this.spatialHash.insert(-1, px, py);  // -1 as special ID for player
    }

    // Add entities with interpolated positions
    const currentLen = this.currentGravityPoints.length;
    const prevLen = this.prevGravityPoints.length;

    for (let i = 0; i < currentLen; i++) {
      const curr = this.currentGravityPoints[i];
      let x = curr.x;
      let y = curr.y;

      // Interpolate if we have previous positions
      if (t < 1 && i < prevLen) {
        const prev = this.prevGravityPoints[i];
        x = prev.x + (curr.x - prev.x) * t;
        y = prev.y + (curr.y - prev.y) * t;
      }

      const gp: GravityPoint = { x, y, weight: curr.weight };
      this.gravityPoints.push(gp);
      this.spatialHash.insert(i, x, y);
    }
  }

  /**
   * Redraws the entire grid with warping effects.
   */
  private redrawGrid(): void {
    this.graphics.clear();

    // Calculate pulse effect on alpha
    const pulseAlpha = this.LINE_ALPHA_BASE + Math.sin(this.pulsePhase) * 0.15;

    // Draw horizontal lines
    for (let y = 0; y <= GAME_HEIGHT; y += this.CELL_SIZE) {
      this.drawWarpedLine(0, y, GAME_WIDTH, y, pulseAlpha);
    }

    // Draw vertical lines
    for (let x = 0; x <= GAME_WIDTH; x += this.CELL_SIZE) {
      this.drawWarpedLine(x, 0, x, GAME_HEIGHT, pulseAlpha);
    }
  }

  /**
   * Draws a line that warps around gravity points.
   * Uses spatial hashing for O(1) nearby entity lookup instead of O(n).
   */
  private drawWarpedLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    baseAlpha: number
  ): void {
    // In low quality mode, draw simple straight lines
    if (this.segmentsPerLine === 0) {
      this.graphics.lineStyle(1, GRID_COLORS.line, baseAlpha);
      this.graphics.lineBetween(x1, y1, x2, y2);
      return;
    }

    // OPTIMIZATION: Use pre-allocated buffer instead of creating new array per line
    const points = this.warpedPointsBuffer;
    const numPoints = this.segmentsPerLine + 1;

    for (let i = 0; i < numPoints; i++) {
      const t = i / this.segmentsPerLine;
      const basePx = x1 + (x2 - x1) * t;
      const basePy = y1 + (y2 - y1) * t;

      // Accumulate displacement from NEARBY gravity points only (spatial hash query)
      let totalDx = 0;
      let totalDy = 0;
      let totalWarpAmount = 0;

      // Query spatial hash for entities within WARP_RADIUS
      const nearbyEntities = this.spatialHash.queryPotential(basePx, basePy, this.WARP_RADIUS);

      for (const entity of nearbyEntities) {
        // Look up the full gravity point data
        // Entity ID -1 is player (index 0 in gravityPoints), others are offset by 1
        const gpIndex = entity.id === -1 ? 0 : entity.id + 1;
        if (gpIndex >= this.gravityPoints.length) continue;

        const gp = this.gravityPoints[gpIndex];
        const dx = basePx - gp.x;
        const dy = basePy - gp.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);

        if (dist < this.WARP_RADIUS && dist > 0.01) {
          const normalizedDist = dist / this.WARP_RADIUS;

          // Smoothstep falloff - gentler S-curve, no harsh spike at center
          // Formula: t^2(3-2t) where t = 1 - normalizedDist
          const edge = 1 - normalizedDist;
          const falloff = edge * edge * (3 - 2 * edge);

          // Scale down warp strength to prevent over-clustering
          const warpStrength = falloff * gp.weight * 0.5;

          // Accumulate displacement vector (don't apply yet)
          const warpAmount = warpStrength * this.MAX_WARP;
          totalDx -= (dx / dist) * warpAmount;
          totalDy -= (dy / dist) * warpAmount;

          totalWarpAmount += warpStrength;
        }
      }

      // Apply hard cap on total displacement to maintain grid integrity
      const totalDisplacement = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      if (totalDisplacement > this.MAX_TOTAL_DISPLACEMENT) {
        const scale = this.MAX_TOTAL_DISPLACEMENT / totalDisplacement;
        totalDx *= scale;
        totalDy *= scale;
      }

      // Now apply the capped displacement
      const px = basePx + totalDx;
      const py = basePy + totalDy;

      // Soft asymptotic cap for visual effects (brightness)
      const cappedWarp = totalWarpAmount / (1 + totalWarpAmount);
      // OPTIMIZATION: Write to pre-allocated buffer instead of pushing
      points[i].x = px;
      points[i].y = py;
      points[i].warpAmount = cappedWarp;
    }

    // Draw each segment with averaged brightness for smooth transitions
    for (let i = 1; i < numPoints; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      // AVERAGE instead of MAX - prevents discontinuous brightness jumps
      const warp = (prev.warpAmount + curr.warpAmount) * 0.5;

      // Reduced brightness boost (0.3 instead of 0.5) to preserve pulse effect
      const alpha = baseAlpha + warp * 0.3;
      const lineWidth = 1 + warp * 0.5;
      const color = this.lerpColor(GRID_COLORS.line, GRID_COLORS.warpHighlight, warp);

      this.graphics.lineStyle(lineWidth, color, alpha);
      this.graphics.lineBetween(prev.x, prev.y, curr.x, curr.y);
    }
  }

  /**
   * Linear interpolation between two colors.
   */
  private lerpColor(color1: number, color2: number, t: number): number {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;

    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return (r << 16) | (g << 8) | b;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.graphics.destroy();
  }
}
