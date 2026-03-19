import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

// Pre-computed hexagon unit vectors for prism flash effect
const HEXAGON_VERTICES: readonly { cos: number; sin: number }[] = (() => {
  const vertices: { cos: number; sin: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    vertices.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  return vertices;
})();

const PRISMATIC_PALETTE = [0xff4488, 0xffaa44, 0x44ff88, 0x44aaff, 0xaa44ff] as const;

/**
 * LaserBeamWeapon fires a piercing beam that damages all enemies in a line.
 * High damage, pierces everything, but narrow and directional.
 */
export class LaserBeamWeapon extends BaseWeapon {
  private beamGraphics: Phaser.GameObjects.Graphics | null = null;

  // Mastery: Prismatic Convergence - track refracted beams
  private refractedBeamCount: number = 0;
  private readonly MAX_REFRACTED_BEAMS = 5;

  // OPTIMIZATION: Pre-allocated array for hit positions
  private hitPositionsTemp: { id: number; x: number; y: number }[] = [];

  constructor() {
    const baseStats: WeaponStats = {
      damage: 30,
      cooldown: 1.5,
      range: 600,         // Beam length
      count: 1,           // Number of beams
      piercing: 999,
      size: 1,            // Beam width multiplier
      speed: 1,
      duration: 0.15,     // Visual duration
    };

    super(
      'laser_beam',
      'Laser Beam',
      'laser',
      'Piercing energy beam',
      10,
      baseStats,
      'Prismatic Convergence',
      'Each enemy hit spawns a 40% damage refracted beam (max 5)'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    // Reset refracted beam counter for this attack cycle
    this.refractedBeamCount = 0;

    // Find targets for each beam
    for (let b = 0; b < this.stats.count; b++) {
      // Find a random enemy to target
      let targetId = -1;
      // OPTIMIZATION: Use squared distance for comparisons
      let targetDistSq = Infinity;

      // For first beam, target nearest. For others, spread out
      if (b === 0) {
        for (const enemyId of enemies) {
          const ex = Transform.x[enemyId];
          const ey = Transform.y[enemyId];
          const dx = ex - ctx.playerX;
          const dy = ey - ctx.playerY;
          const distSq = dx * dx + dy * dy;

          if (distSq < targetDistSq) {
            targetDistSq = distSq;
            targetId = enemyId;
          }
        }
      } else {
        // Random enemy for additional beams
        targetId = enemies[Math.floor(Math.random() * enemies.length)];
      }

      if (targetId === -1) continue;

      const targetX = Transform.x[targetId];
      const targetY = Transform.y[targetId];
      const angle = Math.atan2(targetY - ctx.playerY, targetX - ctx.playerX);

      // Calculate beam end point
      const endX = ctx.playerX + Math.cos(angle) * this.stats.range;
      const endY = ctx.playerY + Math.sin(angle) * this.stats.range;

      // Fire beam and hit all enemies along it
      this.fireBeam(ctx, ctx.playerX, ctx.playerY, endX, endY, angle, this.stats.damage, false);
    }
  }

  private fireBeam(
    ctx: WeaponContext,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    beamAngle: number,
    damage: number,
    isRefracted: boolean
  ): void {
    const beamWidth = isRefracted ? 8 * this.stats.size : 12 * this.stats.size;
    const hitEnemies = new Set<number>();
    // OPTIMIZATION: Reuse pre-allocated array for main beams
    if (!isRefracted) {
      this.hitPositionsTemp.length = 0;
    }

    // Check all enemies along the beam
    const enemies = ctx.getEnemies();
    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];

      // Calculate distance from enemy to beam line
      const dist = this.pointToLineDistance(ex, ey, startX, startY, endX, endY);

      if (dist <= beamWidth + 12) { // 12 = enemy radius
        ctx.damageEnemy(enemyId, damage, 50);
        hitEnemies.add(enemyId);
        // Only track positions for main beams (for refraction)
        if (!isRefracted) {
          this.hitPositionsTemp.push({ id: enemyId, x: ex, y: ey });
        }
      }
    }

    // Visual beam (different color for refracted)
    this.drawBeam(ctx, startX, startY, endX, endY, beamWidth, isRefracted, ctx.gameTime);

    // Hit sparks along beam
    for (const enemyId of hitEnemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      ctx.effectsManager.playHitSparks(ex, ey, beamAngle);
    }

    // Hit flash rings at enemy positions (cap at 5 per beam)
    let hitFlashCount = 0;
    for (const enemyId of hitEnemies) {
      if (hitFlashCount >= 5) break;
      const flashX = Transform.x[enemyId];
      const flashY = Transform.y[enemyId];

      const hitRing = ctx.scene.add.circle(flashX, flashY, 5, 0x4488ff, 0);
      hitRing.setStrokeStyle(2, 0x88ccff, 0.8);
      hitRing.setDepth(DepthLayers.LASER);
      ctx.scene.tweens.add({
        targets: hitRing,
        scaleX: 3,
        scaleY: 3,
        alpha: 0,
        duration: 150,
        onComplete: () => hitRing.destroy(),
      });
      hitFlashCount++;
    }

    if (hitEnemies.size > 0) {
      ctx.soundManager.playHit();
    }

    // Mastery: Prismatic Convergence - spawn refracted beams from hit enemies
    if (this.isMastered() && !isRefracted && this.hitPositionsTemp.length > 0) {
      this.spawnRefractedBeams(ctx, this.hitPositionsTemp, hitEnemies);
    }
  }

  /**
   * Mastery: Prismatic Convergence - spawn refracted beams from hit enemy positions.
   * Each beam targets the nearest unhit enemy (max 5 total refracted beams).
   */
  private spawnRefractedBeams(
    ctx: WeaponContext,
    hitPositions: { id: number; x: number; y: number }[],
    alreadyHit: Set<number>
  ): void {
    const enemies = ctx.getEnemies();
    const refractedDamage = this.stats.damage * 0.4; // 40% damage
    const usedTargets = new Set<number>(alreadyHit);

    // OPTIMIZATION: Pre-compute squared max range
    const maxRefractRangeSq = 200 * 200; // 40000

    for (const hitPos of hitPositions) {
      if (this.refractedBeamCount >= this.MAX_REFRACTED_BEAMS) break;

      // Find nearest unhit enemy from this hit position
      let nearestId = -1;
      // OPTIMIZATION: Use squared distance for comparisons
      let nearestDistSq = maxRefractRangeSq;

      for (const enemyId of enemies) {
        if (usedTargets.has(enemyId)) continue;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - hitPos.x;
        const dy = ey - hitPos.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestId = enemyId;
        }
      }

      if (nearestId !== -1) {
        usedTargets.add(nearestId);
        this.refractedBeamCount++;

        const targetX = Transform.x[nearestId];
        const targetY = Transform.y[nearestId];
        const angle = Math.atan2(targetY - hitPos.y, targetX - hitPos.x);

        // Shorter range for refracted beams
        const refractRange = 150;
        const endX = hitPos.x + Math.cos(angle) * refractRange;
        const endY = hitPos.y + Math.sin(angle) * refractRange;

        // Fire the refracted beam (won't chain further due to isRefracted=true)
        this.fireBeam(ctx, hitPos.x, hitPos.y, endX, endY, angle, refractedDamage, true);
      }
    }
  }

  private pointToLineDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

    // Project point onto line
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  private drawBeam(
    ctx: WeaponContext,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    isRefracted: boolean = false,
    gameTime: number = 0
  ): void {
    const quality: VisualQuality = ctx.visualQuality;

    // For main beams, clean up old graphics
    // For refracted beams, create new graphics (they run simultaneously)
    const graphics = ctx.scene.add.graphics();
    graphics.setDepth(isRefracted ? 11 : 12);

    if (!isRefracted) {
      if (this.beamGraphics) {
        this.beamGraphics.destroy();
      }
      this.beamGraphics = graphics;
    }

    // --- Prismatic colors for refracted beams at high quality ---
    let outerColor: number;
    let mainColor: number;
    const coreColor = 0xffffff;

    if (isRefracted && quality === 'high') {
      const prismaticColor = PRISMATIC_PALETTE[this.refractedBeamCount % 5];
      outerColor = prismaticColor;
      mainColor = prismaticColor;
    } else if (isRefracted) {
      outerColor = 0xff66aa;   // Magenta/Pink for refracted
      mainColor = 0xffaa66;    // Orange for refracted
    } else {
      outerColor = 0x2266dd;
      mainColor = 0x4488ff;
    }

    // --- Beam line rendering (segmented shimmer at medium/high) ---
    const beamDx = x2 - x1;
    const beamDy = y2 - y1;
    const beamLength = Math.sqrt(beamDx * beamDx + beamDy * beamDy);
    const beamPerpX = beamLength > 0 ? -beamDy / beamLength : 0;
    const beamPerpY = beamLength > 0 ? beamDx / beamLength : 0;

    if (quality === 'low') {
      // Low: straight lines (original behavior)
      graphics.lineStyle(width * 2, outerColor, 0.3);
      graphics.beginPath();
      graphics.moveTo(x1, y1);
      graphics.lineTo(x2, y2);
      graphics.strokePath();

      graphics.lineStyle(width, mainColor, 0.8);
      graphics.beginPath();
      graphics.moveTo(x1, y1);
      graphics.lineTo(x2, y2);
      graphics.strokePath();

      graphics.lineStyle(width / 3, coreColor, 1);
      graphics.beginPath();
      graphics.moveTo(x1, y1);
      graphics.lineTo(x2, y2);
      graphics.strokePath();
    } else {
      // Medium/High: segmented shimmer polyline for outer and main layers
      const segmentCount = quality === 'high' ? 12 : 8;
      const shimmerAmplitude = quality === 'high' ? 1.5 : 1.0;

      // Outer glow shimmer
      graphics.lineStyle(width * 2, outerColor, 0.3);
      graphics.beginPath();
      for (let i = 0; i <= segmentCount; i++) {
        const segmentT = i / segmentCount;
        const baseX = x1 + beamDx * segmentT;
        const baseY = y1 + beamDy * segmentT;
        const shimmerOffset = Math.sin(gameTime * 12 + i * 1.5) * shimmerAmplitude;
        const vertexX = baseX + beamPerpX * shimmerOffset;
        const vertexY = baseY + beamPerpY * shimmerOffset;
        i === 0 ? graphics.moveTo(vertexX, vertexY) : graphics.lineTo(vertexX, vertexY);
      }
      graphics.strokePath();

      // Main beam shimmer
      graphics.lineStyle(width, mainColor, 0.8);
      graphics.beginPath();
      for (let i = 0; i <= segmentCount; i++) {
        const segmentT = i / segmentCount;
        const baseX = x1 + beamDx * segmentT;
        const baseY = y1 + beamDy * segmentT;
        const shimmerOffset = Math.sin(gameTime * 12 + i * 1.5) * shimmerAmplitude;
        const vertexX = baseX + beamPerpX * shimmerOffset;
        const vertexY = baseY + beamPerpY * shimmerOffset;
        i === 0 ? graphics.moveTo(vertexX, vertexY) : graphics.lineTo(vertexX, vertexY);
      }
      graphics.strokePath();

      // Core stays straight for contrast
      graphics.lineStyle(width / 3, coreColor, 1);
      graphics.beginPath();
      graphics.moveTo(x1, y1);
      graphics.lineTo(x2, y2);
      graphics.strokePath();
    }

    // Start flash (smaller for refracted)
    graphics.fillStyle(coreColor, isRefracted ? 0.6 : 0.8);
    graphics.fillCircle(x1, y1, isRefracted ? width * 0.7 : width);

    // --- Endpoint burst (quality-scaled) ---
    if (quality === 'low') {
      // Low: static expanding diamond (original behavior)
      const endpointFlare = ctx.scene.add.graphics();
      endpointFlare.setPosition(x2, y2);
      endpointFlare.setDepth(isRefracted ? 11 : 12);
      const flareSize = isRefracted ? 5 : 8;
      endpointFlare.fillStyle(coreColor, 0.9);
      endpointFlare.fillPoints([
        { x: 0, y: -flareSize },
        { x: flareSize, y: 0 },
        { x: 0, y: flareSize },
        { x: -flareSize, y: 0 },
      ], true);
      ctx.scene.tweens.add({
        targets: endpointFlare,
        scaleX: 2,
        scaleY: 2,
        alpha: 0,
        duration: 120,
        onComplete: () => endpointFlare.destroy(),
      });
    } else if (quality === 'medium') {
      // Medium: white flash circle (30ms) + ring shockwave (120ms)
      const flashCircle = ctx.scene.add.circle(x2, y2, 6, coreColor, 0.9);
      flashCircle.setDepth(isRefracted ? 11 : 12);
      ctx.scene.tweens.add({
        targets: flashCircle,
        alpha: 0,
        duration: 30,
        onComplete: () => flashCircle.destroy(),
      });

      const shockwaveRing = ctx.scene.add.circle(x2, y2, 4, 0x000000, 0);
      shockwaveRing.setStrokeStyle(2, mainColor, 0.8);
      shockwaveRing.setDepth(isRefracted ? 11 : 12);
      ctx.scene.tweens.add({
        targets: shockwaveRing,
        scaleX: 4,
        scaleY: 4,
        alpha: 0,
        duration: 120,
        onComplete: () => shockwaveRing.destroy(),
      });
    } else {
      // High: 3 stages - flash + shockwave + 6 radiating spark lines
      const flashCircle = ctx.scene.add.circle(x2, y2, 8, coreColor, 1.0);
      flashCircle.setDepth(isRefracted ? 11 : 12);
      ctx.scene.tweens.add({
        targets: flashCircle,
        alpha: 0,
        duration: 30,
        onComplete: () => flashCircle.destroy(),
      });

      const shockwaveRing = ctx.scene.add.circle(x2, y2, 5, 0x000000, 0);
      shockwaveRing.setStrokeStyle(2, mainColor, 0.9);
      shockwaveRing.setDepth(isRefracted ? 11 : 12);
      ctx.scene.tweens.add({
        targets: shockwaveRing,
        scaleX: 5,
        scaleY: 5,
        alpha: 0,
        duration: 120,
        onComplete: () => shockwaveRing.destroy(),
      });

      // 6 radiating spark lines from endpoint
      for (let sparkIndex = 0; sparkIndex < 6; sparkIndex++) {
        const sparkAngle = (Math.PI / 3) * sparkIndex;
        const sparkLength = 12;
        const sparkEndX = Math.cos(sparkAngle) * sparkLength;
        const sparkEndY = Math.sin(sparkAngle) * sparkLength;

        const sparkLine = ctx.scene.add.graphics();
        sparkLine.setPosition(x2, y2);
        sparkLine.setDepth(isRefracted ? 11 : 12);
        sparkLine.lineStyle(1.5, mainColor, 0.9);
        sparkLine.beginPath();
        sparkLine.moveTo(0, 0);
        sparkLine.lineTo(sparkEndX, sparkEndY);
        sparkLine.strokePath();

        ctx.scene.tweens.add({
          targets: sparkLine,
          scaleX: 2.5,
          scaleY: 2.5,
          alpha: 0,
          duration: 100,
          onComplete: () => sparkLine.destroy(),
        });
      }
    }

    // --- Energy pulse dot (quality-scaled) ---
    if (!isRefracted) {
      if (quality === 'low') {
        // Low: single white circle traveling along beam
        const pulseDot = ctx.scene.add.circle(x1, y1, 4, coreColor, 1);
        pulseDot.setDepth(DepthLayers.LASER);
        ctx.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: this.stats.duration * 1000 * 0.8,
          onUpdate: (tween: Phaser.Tweens.Tween) => {
            if (!pulseDot || !pulseDot.scene) return;
            const progress = tween.getValue() ?? 0;
            pulseDot.setPosition(
              x1 + (x2 - x1) * progress,
              y1 + (y2 - y1) * progress
            );
          },
          onComplete: () => {
            if (pulseDot && pulseDot.scene) pulseDot.destroy();
          },
        });
      } else if (quality === 'medium') {
        // Medium: 2-layer energy packet (outer glow + inner white)
        const packetGraphics = ctx.scene.add.graphics();
        packetGraphics.setPosition(x1, y1);
        packetGraphics.setDepth(DepthLayers.LASER);
        packetGraphics.fillStyle(mainColor, 0.4);
        packetGraphics.fillCircle(0, 0, 8);
        packetGraphics.fillStyle(coreColor, 1.0);
        packetGraphics.fillCircle(0, 0, 4);

        ctx.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: this.stats.duration * 1000 * 0.8,
          onUpdate: (tween: Phaser.Tweens.Tween) => {
            if (!packetGraphics || !packetGraphics.scene) return;
            const progress = tween.getValue() ?? 0;
            packetGraphics.setPosition(
              x1 + (x2 - x1) * progress,
              y1 + (y2 - y1) * progress
            );
          },
          onComplete: () => {
            if (packetGraphics && packetGraphics.scene) packetGraphics.destroy();
          },
        });
      } else {
        // High: 3-layer energy packet + trailing glow line
        const packetGraphics = ctx.scene.add.graphics();
        packetGraphics.setPosition(x1, y1);
        packetGraphics.setDepth(DepthLayers.LASER);
        packetGraphics.fillStyle(mainColor, 0.3);
        packetGraphics.fillCircle(0, 0, 12);
        packetGraphics.fillStyle(mainColor, 0.6);
        packetGraphics.fillCircle(0, 0, 6);
        packetGraphics.fillStyle(coreColor, 1.0);
        packetGraphics.fillCircle(0, 0, 3);

        const trailGraphics = ctx.scene.add.graphics();
        trailGraphics.setDepth(DepthLayers.LASER - 1);
        let previousTrailX = x1;
        let previousTrailY = y1;

        ctx.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: this.stats.duration * 1000 * 0.8,
          onUpdate: (tween: Phaser.Tweens.Tween) => {
            if (!packetGraphics || !packetGraphics.scene) return;
            const progress = tween.getValue() ?? 0;
            const currentTrailX = x1 + (x2 - x1) * progress;
            const currentTrailY = y1 + (y2 - y1) * progress;
            packetGraphics.setPosition(currentTrailX, currentTrailY);

            // Draw trailing glow line segment behind the dot
            if (trailGraphics && trailGraphics.scene) {
              trailGraphics.lineStyle(3, mainColor, 0.4 * (1 - progress));
              trailGraphics.beginPath();
              trailGraphics.moveTo(previousTrailX, previousTrailY);
              trailGraphics.lineTo(currentTrailX, currentTrailY);
              trailGraphics.strokePath();
            }
            previousTrailX = currentTrailX;
            previousTrailY = currentTrailY;
          },
          onComplete: () => {
            if (packetGraphics && packetGraphics.scene) packetGraphics.destroy();
            if (trailGraphics && trailGraphics.scene) {
              ctx.scene.tweens.add({
                targets: trailGraphics,
                alpha: 0,
                duration: 80,
                onComplete: () => trailGraphics.destroy(),
              });
            }
          },
        });
      }
    }

    // --- Hexagonal prism flash at refraction source (high quality only) ---
    if (isRefracted && quality === 'high') {
      this.drawPrismFlash(ctx, x1, y1, mainColor);
    }

    // Fade out
    ctx.scene.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: this.stats.duration * 1000 * (isRefracted ? 0.8 : 1),
      onComplete: () => {
        graphics.destroy();
        if (!isRefracted && this.beamGraphics === graphics) {
          this.beamGraphics = null;
        }
      },
    });
  }

  /**
   * Draws a hexagonal prism flash at a refraction source point (high quality).
   * A 6-vertex polygon that expands and fades out.
   */
  private drawPrismFlash(
    ctx: WeaponContext,
    centerX: number,
    centerY: number,
    prismColor: number
  ): void {
    const prismGraphics = ctx.scene.add.graphics();
    prismGraphics.setPosition(centerX, centerY);
    prismGraphics.setDepth(12);

    const prismRadius = 6;
    prismGraphics.fillStyle(prismColor, 0.6);
    prismGraphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const vertexX = HEXAGON_VERTICES[i].cos * prismRadius;
      const vertexY = HEXAGON_VERTICES[i].sin * prismRadius;
      i === 0 ? prismGraphics.moveTo(vertexX, vertexY) : prismGraphics.lineTo(vertexX, vertexY);
    }
    prismGraphics.closePath();
    prismGraphics.fillPath();

    prismGraphics.lineStyle(1.5, 0xffffff, 0.8);
    prismGraphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const vertexX = HEXAGON_VERTICES[i].cos * prismRadius;
      const vertexY = HEXAGON_VERTICES[i].sin * prismRadius;
      i === 0 ? prismGraphics.moveTo(vertexX, vertexY) : prismGraphics.lineTo(vertexX, vertexY);
    }
    prismGraphics.closePath();
    prismGraphics.strokePath();

    ctx.scene.tweens.add({
      targets: prismGraphics,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 150,
      onComplete: () => prismGraphics.destroy(),
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = 1 + Math.floor((this.level - 1) / 3) + this.externalBonusCount; // Extra beam every 3 levels
    this.stats.size = 1 + (this.level - 1) * 0.15;
  }

  public destroy(): void {
    if (this.beamGraphics) {
      this.beamGraphics.destroy();
      this.beamGraphics = null;
    }
    super.destroy();
  }
}
