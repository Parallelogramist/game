import Phaser from 'phaser';
import { GRID_COLORS } from './NeonColors';
import { VisualQuality } from './GlowGraphics';

interface GravityPoint {
  x: number;
  y: number;
  weight: number;
}

/**
 * Spring-mass grid background inspired by Geometry Wars.
 *
 * Two-layer system:
 * 1. **Gravity wells** — instant per-frame displacement toward entities (responsive, immediate)
 * 2. **Spring physics** — velocity-based ripples from explosions that propagate across the grid
 *
 * At render time, both layers are combined: physics position + gravity displacement.
 * This gives the best of both worlds: entities visibly warp the grid as they move,
 * and death explosions create propagating ripple waves.
 */
export class GridBackground {
  private graphics: Phaser.GameObjects.Graphics;

  // Grid topology
  private readonly CELL_SIZE = 40;
  private readonly numCols: number;
  private readonly numRows: number;
  private readonly totalPoints: number;

  // ─── Point mass SoA arrays (spring physics layer) ───
  private restX!: Float32Array;
  private restY!: Float32Array;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private posZ!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private velZ!: Float32Array;
  private inverseMass!: Float32Array;
  private dampingArr!: Float32Array;

  // ─── Spring arrays ───
  private springPointA!: Uint16Array;
  private springPointB!: Uint16Array;
  private springRestLength!: Float32Array;
  private springStiffness!: Float32Array;
  private springDamping!: Float32Array;
  private springCount: number = 0;

  // ─── Gravity well layer (instant displacement) ───
  private gravityPoints: GravityPoint[] = [];
  private readonly WARP_RADIUS = 100;
  private readonly MAX_WARP = 15;
  private readonly MAX_TOTAL_WARP = 20;

  // ─── Physics constants ───
  private readonly BASE_DAMPING = 0.94;
  private readonly MAX_DISPLACEMENT = 80;
  private readonly MAX_Z = 500;

  // ─── Rendering ───
  private readonly LINE_ALPHA_BASE = 0.55;
  private pulsePhase: number = 0;
  private readonly PULSE_SPEED = 1.5;

  // ─── Chromatic aberration ("double vision") ───
  private readonly CHROMATIC_CYAN = 0x00eeff;
  private readonly CHROMATIC_MAGENTA = 0xff0088;
  private readonly CHROMATIC_MAX_OFFSET = 3.0;
  private readonly CHROMATIC_ALPHA = 0.25;

  // Scratch arrays for line rendering (reused to avoid allocations)
  private lineScreenX: number[] = [];
  private lineScreenY: number[] = [];
  private lineDispX: number[] = [];
  private lineDispY: number[] = [];
  private lineDisplacement: number[] = [];
  private chromaticDrawX: number[] = [];
  private chromaticDrawY: number[] = [];

  // Quality settings
  private quality: VisualQuality = 'high';
  private catmullSubdivisions = 4;
  private frameCounter = 0;

  // Screen center for perspective projection
  private readonly centerX: number;
  private readonly centerY: number;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(0);

    const sceneWidth = scene.scale.width;
    const sceneHeight = scene.scale.height;
    this.centerX = sceneWidth / 2;
    this.centerY = sceneHeight / 2;

    // Grid dimensions — extend one cell beyond screen edges
    this.numCols = Math.ceil(sceneWidth / this.CELL_SIZE) + 1;
    this.numRows = Math.ceil(sceneHeight / this.CELL_SIZE) + 1;
    this.totalPoints = this.numCols * this.numRows;

    this.initializePointMasses();
    this.initializeSprings();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════

  private initializePointMasses(): void {
    const count = this.totalPoints;

    this.restX = new Float32Array(count);
    this.restY = new Float32Array(count);
    this.posX = new Float32Array(count);
    this.posY = new Float32Array(count);
    this.posZ = new Float32Array(count);
    this.velX = new Float32Array(count);
    this.velY = new Float32Array(count);
    this.velZ = new Float32Array(count);
    this.inverseMass = new Float32Array(count);
    this.dampingArr = new Float32Array(count);

    for (let row = 0; row < this.numRows; row++) {
      for (let col = 0; col < this.numCols; col++) {
        const index = row * this.numCols + col;
        const worldX = col * this.CELL_SIZE;
        const worldY = row * this.CELL_SIZE;

        this.restX[index] = worldX;
        this.restY[index] = worldY;
        this.posX[index] = worldX;
        this.posY[index] = worldY;

        // Border points are immovable (inverseMass = 0)
        const isBorder = row === 0 || row === this.numRows - 1 ||
                         col === 0 || col === this.numCols - 1;
        this.inverseMass[index] = isBorder ? 0 : 1.0;
        this.dampingArr[index] = this.BASE_DAMPING;
      }
    }
  }

  private initializeSprings(): void {
    // Two spring types for canonical Geometry Wars wave propagation:
    //   1. Structural — horizontal & vertical neighbors (transmit waves along axes)
    //   2. Anchor — pulls every-3rd interior point back to rest position (light anchoring)
    const horizontalCount = this.numRows * (this.numCols - 1);
    const verticalCount = (this.numRows - 1) * this.numCols;
    const anchorCount = (this.numRows - 2) * (this.numCols - 2); // upper bound
    const maxSprings = horizontalCount + verticalCount + anchorCount;

    this.springPointA = new Uint16Array(maxSprings);
    this.springPointB = new Uint16Array(maxSprings);
    this.springRestLength = new Float32Array(maxSprings);
    this.springStiffness = new Float32Array(maxSprings);
    this.springDamping = new Float32Array(maxSprings);

    let springIndex = 0;
    const structuralRestLength = this.CELL_SIZE;

    // Horizontal structural springs
    for (let row = 0; row < this.numRows; row++) {
      for (let col = 0; col < this.numCols - 1; col++) {
        const indexA = row * this.numCols + col;
        this.springPointA[springIndex] = indexA;
        this.springPointB[springIndex] = indexA + 1;
        this.springRestLength[springIndex] = structuralRestLength;
        this.springStiffness[springIndex] = 0.28;
        this.springDamping[springIndex] = 0.06;
        springIndex++;
      }
    }

    // Vertical structural springs
    for (let row = 0; row < this.numRows - 1; row++) {
      for (let col = 0; col < this.numCols; col++) {
        const indexA = row * this.numCols + col;
        this.springPointA[springIndex] = indexA;
        this.springPointB[springIndex] = indexA + this.numCols;
        this.springRestLength[springIndex] = structuralRestLength;
        this.springStiffness[springIndex] = 0.28;
        this.springDamping[springIndex] = 0.06;
        springIndex++;
      }
    }

    // Anchor springs on every-3rd interior point — light anchoring to rest position
    for (let row = 1; row < this.numRows - 1; row++) {
      for (let col = 1; col < this.numCols - 1; col++) {
        if (row % 3 !== 0 || col % 3 !== 0) continue;
        const index = row * this.numCols + col;
        this.springPointA[springIndex] = index;
        this.springPointB[springIndex] = index; // self-reference = anchor
        this.springRestLength[springIndex] = 0;
        this.springStiffness[springIndex] = 0.002;
        this.springDamping[springIndex] = 0.02;
        springIndex++;
      }
    }

    this.springCount = springIndex;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  QUALITY CONTROL
  // ═══════════════════════════════════════════════════════════════════

  setQuality(quality: VisualQuality): void {
    this.quality = quality;
    switch (quality) {
      case 'high':
        this.catmullSubdivisions = 4;
        break;
      case 'medium':
        this.catmullSubdivisions = 2;
        break;
      case 'low':
        this.catmullSubdivisions = 0;
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  FORCE APPLICATION (spring physics layer — one-shot impulses)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Apply an outward explosive force. Used for enemy death ripples.
   * This is a one-shot impulse — call once, the springs propagate it.
   */
  applyExplosiveForce(force: number, worldX: number, worldY: number, radius: number): void {
    const radiusSq = radius * radius;
    const minCol = Math.max(0, Math.floor((worldX - radius) / this.CELL_SIZE));
    const maxCol = Math.min(this.numCols - 1, Math.ceil((worldX + radius) / this.CELL_SIZE));
    const minRow = Math.max(0, Math.floor((worldY - radius) / this.CELL_SIZE));
    const maxRow = Math.min(this.numRows - 1, Math.ceil((worldY + radius) / this.CELL_SIZE));

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const index = row * this.numCols + col;
        if (this.inverseMass[index] === 0) continue;

        const deltaX = this.posX[index] - worldX;
        const deltaY = this.posY[index] - worldY;
        const distSq = deltaX * deltaX + deltaY * deltaY;

        if (distSq < radiusSq && distSq > 1) {
          const dist = Math.sqrt(distSq);
          // Canonical Geometry Wars rational falloff: smooth wavefront, no hard cutoff
          const falloff = (100 * force) / (10000 + distSq);
          this.velX[index] += (deltaX / dist) * falloff;
          this.velY[index] += (deltaY / dist) * falloff;
        }
      }
    }
  }

  /**
   * Apply a directed force (specific direction). Used for Z-axis punch on boss death.
   */
  applyDirectedForce(forceX: number, forceY: number, forceZ: number, worldX: number, worldY: number, radius: number): void {
    const radiusSq = radius * radius;
    const minCol = Math.max(0, Math.floor((worldX - radius) / this.CELL_SIZE));
    const maxCol = Math.min(this.numCols - 1, Math.ceil((worldX + radius) / this.CELL_SIZE));
    const minRow = Math.max(0, Math.floor((worldY - radius) / this.CELL_SIZE));
    const maxRow = Math.min(this.numRows - 1, Math.ceil((worldY + radius) / this.CELL_SIZE));

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const index = row * this.numCols + col;
        if (this.inverseMass[index] === 0) continue;

        const deltaX = this.posX[index] - worldX;
        const deltaY = this.posY[index] - worldY;
        const distSq = deltaX * deltaX + deltaY * deltaY;

        if (distSq < radiusSq) {
          const dist = Math.sqrt(distSq);
          // Canonical rational falloff: smooth decay, no hard edge
          const falloff = 10 / (10 + dist);
          this.velX[index] += forceX * falloff;
          this.velY[index] += forceY * falloff;
          this.velZ[index] += forceZ * falloff;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GRAVITY WELLS (instant displacement layer)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Set entity positions for instant gravity-well warping.
   * These are NOT physics forces — they produce immediate visual displacement
   * computed at render time, so the grid always tracks moving entities.
   */
  setGravityPoints(
    playerPos: { x: number; y: number } | null,
    entityData: { x: number; y: number; weight: number }[]
  ): void {
    this.gravityPoints.length = 0;

    if (playerPos) {
      this.gravityPoints.push({ x: playerPos.x, y: playerPos.y, weight: 1.5 });
    }

    for (let i = 0; i < entityData.length; i++) {
      this.gravityPoints.push(entityData[i]);
    }
  }

  /**
   * Compute gravity-well displacement for a given world position.
   * Uses smoothstep falloff — returns the (dx, dy) offset and warp intensity.
   */
  private computeGravityDisplacement(worldX: number, worldY: number): { dx: number; dy: number; warpAmount: number } {
    let totalDx = 0;
    let totalDy = 0;
    let totalWarpAmount = 0;

    for (let i = 0; i < this.gravityPoints.length; i++) {
      const gp = this.gravityPoints[i];
      const dx = worldX - gp.x;
      const dy = worldY - gp.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      if (dist < this.WARP_RADIUS && dist > 0.01) {
        const normalizedDist = dist / this.WARP_RADIUS;
        // Smoothstep falloff: t²(3 - 2t) where t = 1 - normalizedDist
        const edge = 1 - normalizedDist;
        const falloff = edge * edge * (3 - 2 * edge);

        const warpStrength = falloff * gp.weight * 0.5;
        const warpAmount = warpStrength * this.MAX_WARP;
        totalDx -= (dx / dist) * warpAmount;
        totalDy -= (dy / dist) * warpAmount;
        totalWarpAmount += warpStrength;
      }
    }

    // Hard cap on total displacement
    const totalDisplacement = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
    if (totalDisplacement > this.MAX_TOTAL_WARP) {
      const scale = this.MAX_TOTAL_WARP / totalDisplacement;
      totalDx *= scale;
      totalDy *= scale;
    }

    return { dx: totalDx, dy: totalDy, warpAmount: totalWarpAmount / (1 + totalWarpAmount) };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PHYSICS SIMULATION
  // ═══════════════════════════════════════════════════════════════════

  update(deltaSeconds: number): void {
    const clampedDelta = Math.min(deltaSeconds, 1 / 30);
    this.pulsePhase += clampedDelta * this.PULSE_SPEED;
    this.frameCounter++;

    // Spring physics always runs
    this.updateSprings();
    this.integratePointMasses();

    // Rendering may be throttled at low quality
    const shouldRender = this.quality !== 'low' || this.frameCounter % 2 === 0;
    if (shouldRender) {
      this.render();
    }
  }

  private updateSprings(): void {
    for (let i = 0; i < this.springCount; i++) {
      const pointA = this.springPointA[i];
      const pointB = this.springPointB[i];
      const stiffness = this.springStiffness[i];
      const damping = this.springDamping[i];
      const restLength = this.springRestLength[i];

      // Anchor spring: pulls point back toward its rest position
      if (pointA === pointB) {
        const deltaX = this.posX[pointA] - this.restX[pointA];
        const deltaY = this.posY[pointA] - this.restY[pointA];
        const deltaZ = this.posZ[pointA];

        this.velX[pointA] -= deltaX * stiffness + this.velX[pointA] * damping;
        this.velY[pointA] -= deltaY * stiffness + this.velY[pointA] * damping;
        this.velZ[pointA] -= deltaZ * stiffness + this.velZ[pointA] * damping;
        continue;
      }

      // Structural spring
      const deltaX = this.posX[pointB] - this.posX[pointA];
      const deltaY = this.posY[pointB] - this.posY[pointA];
      const distSq = deltaX * deltaX + deltaY * deltaY;

      if (distSq < 0.01) continue;

      const dist = Math.sqrt(distSq);
      const extension = dist - restLength;

      const inverseDist = 1 / dist;
      const dirX = deltaX * inverseDist;
      const dirY = deltaY * inverseDist;

      const relVelX = this.velX[pointB] - this.velX[pointA];
      const relVelY = this.velY[pointB] - this.velY[pointA];
      const relVelAlongSpring = relVelX * dirX + relVelY * dirY;

      const forceMagnitude = stiffness * extension + damping * relVelAlongSpring;
      const forceX = dirX * forceMagnitude;
      const forceY = dirY * forceMagnitude;

      if (this.inverseMass[pointA] > 0) {
        this.velX[pointA] += forceX;
        this.velY[pointA] += forceY;
      }
      if (this.inverseMass[pointB] > 0) {
        this.velX[pointB] -= forceX;
        this.velY[pointB] -= forceY;
      }
    }
  }

  private integratePointMasses(): void {
    for (let i = 0; i < this.totalPoints; i++) {
      if (this.inverseMass[i] === 0) continue;

      // Symplectic Euler
      this.posX[i] += this.velX[i];
      this.posY[i] += this.velY[i];
      this.posZ[i] += this.velZ[i];

      // Apply damping
      const dampingValue = this.dampingArr[i];
      this.velX[i] *= dampingValue;
      this.velY[i] *= dampingValue;
      this.velZ[i] *= dampingValue;

      // Reset per-frame damping
      this.dampingArr[i] = this.BASE_DAMPING;

      // Zero out tiny velocities
      if (this.velX[i] * this.velX[i] + this.velY[i] * this.velY[i] < 0.000001) {
        this.velX[i] = 0;
        this.velY[i] = 0;
      }
      if (this.velZ[i] * this.velZ[i] < 0.000001) {
        this.velZ[i] = 0;
      }

      // Clamp Z
      if (this.posZ[i] > this.MAX_Z) this.posZ[i] = this.MAX_Z;
      if (this.posZ[i] < -this.MAX_Z) this.posZ[i] = -this.MAX_Z;

      // Clamp XY displacement from rest
      const displacementX = this.posX[i] - this.restX[i];
      const displacementY = this.posY[i] - this.restY[i];
      const displacementSq = displacementX * displacementX + displacementY * displacementY;
      if (displacementSq > this.MAX_DISPLACEMENT * this.MAX_DISPLACEMENT) {
        const clampScale = this.MAX_DISPLACEMENT / Math.sqrt(displacementSq);
        this.posX[i] = this.restX[i] + displacementX * clampScale;
        this.posY[i] = this.restY[i] + displacementY * clampScale;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDERING (combines spring physics + gravity displacement)
  // ═══════════════════════════════════════════════════════════════════

  private render(): void {
    this.graphics.clear();

    const pulseAlpha = this.LINE_ALPHA_BASE + Math.sin(this.pulsePhase) * 0.15;
    const usePerspective = this.quality !== 'low';
    const useSubdivisions = this.catmullSubdivisions > 0;
    const useChromaticAberration = this.quality !== 'low';

    for (let row = 0; row < this.numRows; row++) {
      const isMajor = row % 3 === 0;
      this.computeLinePositions(row, true, usePerspective);

      // Chromatic ghost layers (behind main line)
      if (useChromaticAberration) {
        this.strokeLinePath(this.CHROMATIC_MAX_OFFSET, 0.8, this.CHROMATIC_CYAN, this.CHROMATIC_ALPHA, useSubdivisions);
        this.strokeLinePath(-this.CHROMATIC_MAX_OFFSET, 0.8, this.CHROMATIC_MAGENTA, this.CHROMATIC_ALPHA, useSubdivisions);
      }

      // Main grid line
      const normalizedWarp = this.computeLineWarp();
      const lineWidth = (isMajor ? 1.3 : 1.0) + normalizedWarp * 0.8;
      const alpha = pulseAlpha + normalizedWarp * 0.3;
      const lineColor = this.lerpColor(GRID_COLORS.line, GRID_COLORS.warpHighlight, normalizedWarp);
      this.strokeLinePath(0, lineWidth, lineColor, alpha, useSubdivisions);
    }

    for (let col = 0; col < this.numCols; col++) {
      const isMajor = col % 3 === 0;
      this.computeLinePositions(col, false, usePerspective);

      if (useChromaticAberration) {
        this.strokeLinePath(this.CHROMATIC_MAX_OFFSET, 0.8, this.CHROMATIC_CYAN, this.CHROMATIC_ALPHA, useSubdivisions);
        this.strokeLinePath(-this.CHROMATIC_MAX_OFFSET, 0.8, this.CHROMATIC_MAGENTA, this.CHROMATIC_ALPHA, useSubdivisions);
      }

      const normalizedWarp = this.computeLineWarp();
      const lineWidth = (isMajor ? 1.3 : 1.0) + normalizedWarp * 0.8;
      const alpha = pulseAlpha + normalizedWarp * 0.3;
      const lineColor = this.lerpColor(GRID_COLORS.line, GRID_COLORS.warpHighlight, normalizedWarp);
      this.strokeLinePath(0, lineWidth, lineColor, alpha, useSubdivisions);
    }
  }

  /**
   * Compute screen positions and displacement vectors for one grid line.
   * Results are stored in the scratch arrays (lineScreenX, etc.) for reuse
   * across multiple stroke passes (chromatic + main).
   */
  private computeLinePositions(lineIndex: number, isHorizontal: boolean, usePerspective: boolean): void {
    const lineLength = isHorizontal ? this.numCols : this.numRows;

    // Reset scratch arrays
    this.lineScreenX.length = lineLength;
    this.lineScreenY.length = lineLength;
    this.lineDispX.length = lineLength;
    this.lineDispY.length = lineLength;
    this.lineDisplacement.length = lineLength;

    for (let pointIdx = 0; pointIdx < lineLength; pointIdx++) {
      const index = isHorizontal
        ? lineIndex * this.numCols + pointIdx
        : pointIdx * this.numCols + lineIndex;

      // Start with spring physics position
      let renderX = this.posX[index];
      let renderY = this.posY[index];

      // Layer on gravity-well displacement
      const gravityWarp = this.computeGravityDisplacement(this.restX[index], this.restY[index]);
      renderX += gravityWarp.dx;
      renderY += gravityWarp.dy;

      // Perspective projection using Z
      if (usePerspective && this.posZ[index] !== 0) {
        const perspectiveScale = (this.posZ[index] + 2000) / 2000;
        renderX = this.centerX + (renderX - this.centerX) * perspectiveScale;
        renderY = this.centerY + (renderY - this.centerY) * perspectiveScale;
      }

      // Displacement from rest (both layers combined)
      const dispX = renderX - this.restX[index];
      const dispY = renderY - this.restY[index];
      const displacement = Math.sqrt(dispX * dispX + dispY * dispY);

      this.lineScreenX[pointIdx] = renderX;
      this.lineScreenY[pointIdx] = renderY;
      this.lineDispX[pointIdx] = dispX;
      this.lineDispY[pointIdx] = dispY;
      this.lineDisplacement[pointIdx] = displacement + gravityWarp.warpAmount * 10;
    }
  }

  /**
   * Compute average normalized warp for the current line data.
   */
  private computeLineWarp(): number {
    let totalDisplacement = 0;
    for (let i = 0; i < this.lineDisplacement.length; i++) {
      totalDisplacement += this.lineDisplacement[i];
    }
    return Math.min(1, totalDisplacement / this.lineDisplacement.length / 20);
  }

  /**
   * Stroke the current line data with optional chromatic offset.
   *
   * When chromaticShift != 0, each point is offset along its displacement
   * direction proportional to displacement magnitude — so at rest the ghost
   * layers perfectly overlap the main line (invisible), and during deformation
   * they separate into colored fringes.
   */
  private strokeLinePath(
    chromaticShift: number,
    lineWidth: number,
    color: number,
    alpha: number,
    useSubdivisions: boolean
  ): void {
    const lineLength = this.lineScreenX.length;
    if (lineLength < 2) return;

    // Apply chromatic offset: shift each point along its displacement direction
    let drawX = this.lineScreenX;
    let drawY = this.lineScreenY;

    if (chromaticShift !== 0) {
      // Reuse pre-allocated scratch arrays for offset positions
      this.chromaticDrawX.length = lineLength;
      this.chromaticDrawY.length = lineLength;
      for (let i = 0; i < lineLength; i++) {
        const displacement = this.lineDisplacement[i];
        if (displacement > 0.5) {
          // Scale offset: ramps from 0 at rest to full at ~12px displacement
          const offsetScale = Math.min(1, displacement / 12);
          const inverseDist = offsetScale * chromaticShift / displacement;
          this.chromaticDrawX[i] = this.lineScreenX[i] + this.lineDispX[i] * inverseDist;
          this.chromaticDrawY[i] = this.lineScreenY[i] + this.lineDispY[i] * inverseDist;
        } else {
          this.chromaticDrawX[i] = this.lineScreenX[i];
          this.chromaticDrawY[i] = this.lineScreenY[i];
        }
      }
      drawX = this.chromaticDrawX;
      drawY = this.chromaticDrawY;
    }

    this.graphics.lineStyle(lineWidth, color, alpha);
    this.graphics.beginPath();

    if (!useSubdivisions || lineLength < 4) {
      this.graphics.moveTo(drawX[0], drawY[0]);
      for (let i = 1; i < lineLength; i++) {
        this.graphics.lineTo(drawX[i], drawY[i]);
      }
    } else {
      this.graphics.moveTo(drawX[0], drawY[0]);

      for (let i = 0; i < lineLength - 1; i++) {
        const p0x = i > 0 ? drawX[i - 1] : drawX[0];
        const p0y = i > 0 ? drawY[i - 1] : drawY[0];
        const p1x = drawX[i];
        const p1y = drawY[i];
        const p2x = drawX[i + 1];
        const p2y = drawY[i + 1];
        const p3x = i + 2 < lineLength ? drawX[i + 2] : drawX[lineLength - 1];
        const p3y = i + 2 < lineLength ? drawY[i + 2] : drawY[lineLength - 1];

        // Skip subdivision for nearly-at-rest segments
        const segmentDisplacement = (this.lineDisplacement[i] + this.lineDisplacement[i + 1]) * 0.5;
        if (segmentDisplacement < 0.5) {
          this.graphics.lineTo(p2x, p2y);
          continue;
        }

        for (let sub = 1; sub <= this.catmullSubdivisions; sub++) {
          const t = sub / this.catmullSubdivisions;
          const t2 = t * t;
          const t3 = t2 * t;

          const subdivX = 0.5 * (
            (2 * p1x) +
            (-p0x + p2x) * t +
            (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 +
            (-p0x + 3 * p1x - 3 * p2x + p3x) * t3
          );
          const subdivY = 0.5 * (
            (2 * p1y) +
            (-p0y + p2y) * t +
            (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 +
            (-p0y + 3 * p1y - 3 * p2y + p3y) * t3
          );

          this.graphics.lineTo(subdivX, subdivY);
        }
      }
    }

    this.graphics.strokePath();
  }

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

  // ═══════════════════════════════════════════════════════════════════
  //  RESET / CLEANUP
  // ═══════════════════════════════════════════════════════════════════

  reset(): void {
    for (let i = 0; i < this.totalPoints; i++) {
      this.posX[i] = this.restX[i];
      this.posY[i] = this.restY[i];
      this.posZ[i] = 0;
      this.velX[i] = 0;
      this.velY[i] = 0;
      this.velZ[i] = 0;
      this.dampingArr[i] = this.BASE_DAMPING;
    }
    this.gravityPoints.length = 0;
    this.pulsePhase = 0;
    this.frameCounter = 0;
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
