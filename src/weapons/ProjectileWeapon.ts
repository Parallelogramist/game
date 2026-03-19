import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import type { VisualQuality } from '../visual/GlowGraphics';

/**
 * ProjectileWeapon fires auto-targeting projectiles at the nearest enemy.
 * This is the starting weapon - reliable, upgradeable, good all-around.
 */
// OPTIMIZATION: Circular buffer constants for trails
const TRAIL_LENGTH = 6;

export class ProjectileWeapon extends BaseWeapon {
  private projectiles: Phaser.GameObjects.Graphics[] = [];
  private impactPuffsThisFrame: number = 0;
  private currentQuality: VisualQuality = 'high';
  private projectileData: Map<Phaser.GameObjects.Graphics, {
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    angle: number;
    piercing: number;
    damage: number;
    lifetime: number;
    hitEnemies: Set<number>;
    // OPTIMIZATION: Circular buffer for trail - avoids push/shift O(n) operations
    trailBuffer: { x: number; y: number }[];
    trailIndex: number;
    trailCount: number;
    // Mastery: Soul Seeker
    killCount: number;       // Number of kills this projectile has achieved
    maxRetargets: number;    // Maximum retargets allowed (0 if not mastered)
  }> = new Map();

  constructor() {
    const baseStats: WeaponStats = {
      damage: 10,
      cooldown: 0.5,
      range: 300,
      count: 1,
      piercing: 0,
      size: 6,
      speed: 400,
      duration: 2,
    };

    super(
      'projectile',
      'Energy Darts',
      'projectile',
      'Auto-targeting energy darts',
      10,
      baseStats,
      'Soul Seeker',
      'Darts retarget on kill, gaining +25% damage (up to 3 retargets)'
    );
  }

  protected attack(ctx: WeaponContext): void {
    // Use spatial hash to find nearest enemy
    const spatialHash = getEnemySpatialHash();
    const nearestEnemy = spatialHash.findNearest(ctx.playerX, ctx.playerY, this.stats.range);

    if (!nearestEnemy) return;
    const nearestId = nearestEnemy.id;

    // Calculate base angle to target
    const targetX = Transform.x[nearestId];
    const targetY = Transform.y[nearestId];
    const baseAngle = Math.atan2(targetY - ctx.playerY, targetX - ctx.playerX);

    // Fire multiple projectiles with spread
    const spreadAngle = Math.PI / 12; // 15 degrees

    for (let i = 0; i < this.stats.count; i++) {
      let angleOffset = 0;
      if (this.stats.count > 1) {
        const totalSpread = spreadAngle * (this.stats.count - 1);
        angleOffset = -totalSpread / 2 + spreadAngle * i;
      }

      const finalAngle = baseAngle + angleOffset;
      this.createProjectile(ctx, finalAngle);
    }

    ctx.soundManager.playHit();
  }

  private createProjectile(ctx: WeaponContext, angle: number): void {
    const projectile = ctx.scene.add.graphics();
    projectile.setDepth(DepthLayers.PROJECTILES);

    const velocityX = Math.cos(angle) * this.stats.speed;
    const velocityY = Math.sin(angle) * this.stats.speed;

    this.projectiles.push(projectile);
    this.projectileData.set(projectile, {
      x: ctx.playerX,
      y: ctx.playerY,
      velocityX,
      velocityY,
      angle,
      piercing: this.stats.piercing,
      damage: this.stats.damage,
      lifetime: this.stats.duration,
      hitEnemies: new Set(),
      // OPTIMIZATION: Pre-allocate circular buffer for trail
      trailBuffer: new Array(TRAIL_LENGTH).fill(null).map(() => ({ x: 0, y: 0 })),
      trailIndex: 0,
      trailCount: 0,
      // Soul Seeker mastery: allow 3 retargets when mastered
      killCount: 0,
      maxRetargets: this.isMastered() ? 3 : 0,
    });
  }

  /**
   * Find the nearest enemy to a position, excluding already-hit enemies.
   * Used by Soul Seeker mastery for retargeting.
   * OPTIMIZED: Uses spatial hash for O(nearby) instead of O(all enemies)
   */
  private findNearestEnemy(
    _ctx: WeaponContext,
    fromX: number,
    fromY: number,
    excludeIds: Set<number>
  ): number {
    const spatialHash = getEnemySpatialHash();
    const searchRadius = this.stats.range * 1.5; // Slightly extended range for retargeting
    // OPTIMIZATION: Use squared distance for comparisons
    const searchRadiusSq = searchRadius * searchRadius;

    // Query nearby enemies
    const nearbyEnemies = spatialHash.query(fromX, fromY, searchRadius);

    let nearestId = -1;
    let nearestDistSq = searchRadiusSq;

    for (const enemy of nearbyEnemies) {
      if (excludeIds.has(enemy.id)) continue;
      if (Health.current[enemy.id] <= 0) continue; // Skip dead enemies

      const dx = enemy.x - fromX;
      const dy = enemy.y - fromY;
      // OPTIMIZATION: Squared distance comparison avoids sqrt
      const distSq = dx * dx + dy * dy;

      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestId = enemy.id;
      }
    }

    return nearestId;
  }

  protected updateEffects(ctx: WeaponContext): void {
    // OPTIMIZATION: Use Set for O(1) removal checks
    const toRemove = new Set<Phaser.GameObjects.Graphics>();
    // Size reduced by 75% (from 6 to 1.5 base)
    const size = (this.stats.size * 0.25) + this.stats.piercing * 0.5;
    this.impactPuffsThisFrame = 0;
    this.currentQuality = ctx.visualQuality;

    for (const projectile of this.projectiles) {
      const data = this.projectileData.get(projectile);
      if (!data) continue;

      // OPTIMIZATION: Circular buffer - O(1) add instead of push/shift O(n)
      data.trailBuffer[data.trailIndex].x = data.x;
      data.trailBuffer[data.trailIndex].y = data.y;
      data.trailIndex = (data.trailIndex + 1) % TRAIL_LENGTH;
      if (data.trailCount < TRAIL_LENGTH) data.trailCount++;

      // Move projectile
      data.x += data.velocityX * ctx.deltaTime;
      data.y += data.velocityY * ctx.deltaTime;

      // Update lifetime
      data.lifetime -= ctx.deltaTime;
      if (data.lifetime <= 0) {
        toRemove.add(projectile);
        continue;
      }

      // Check bounds
      if (data.x < -50 || data.x > 1330 ||
          data.y < -50 || data.y > 770) {
        toRemove.add(projectile);
        continue;
      }

      // Draw the projectile (diamond + trail)
      projectile.clear();
      projectile.setPosition(data.x, data.y);

      // Soul Seeker mastery: color progression based on kills
      // 0 kills = Blue, 1 kill = Purple, 2 kills = Gold, 3 kills = White
      const soulColors = [
        { fill: 0x66ccff, trail: 0x99ddff },  // Blue (default)
        { fill: 0xaa66ff, trail: 0xcc99ff },  // Purple (1 kill)
        { fill: 0xffd700, trail: 0xffec8b },  // Gold (2 kills)
        { fill: 0xffffff, trail: 0xffffff },  // White (3 kills)
      ];
      const colorIdx = Math.min(data.killCount, soulColors.length - 1);
      const currentColors = soulColors[colorIdx];

      // Draw streak trails (quality-dependent)
      // Low: no trail; Medium: simple line trail; High: tapered quad strip
      if (this.currentQuality !== 'low') {
        if (this.currentQuality === 'high' && data.trailCount >= 2) {
          // High: Tapered quad strip - filled polygons with decreasing width
          for (let i = 0; i < data.trailCount - 1; i++) {
            const bufferIdxA = (data.trailIndex - data.trailCount + i + TRAIL_LENGTH) % TRAIL_LENGTH;
            const bufferIdxB = (data.trailIndex - data.trailCount + i + 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
            const progressA = (i + 1) / data.trailCount;
            const progressB = (i + 2) / data.trailCount;
            const trailAlpha = progressA * 0.5;
            const widthA = Math.max(0.5, size * 0.8 * progressA);
            const widthB = Math.max(0.5, size * 0.8 * progressB);
            const relAX = data.trailBuffer[bufferIdxA].x - data.x;
            const relAY = data.trailBuffer[bufferIdxA].y - data.y;
            const relBX = data.trailBuffer[bufferIdxB].x - data.x;
            const relBY = data.trailBuffer[bufferIdxB].y - data.y;
            // Calculate perpendicular direction for quad width
            const segDx = relBX - relAX;
            const segDy = relBY - relAY;
            const segLength = Math.sqrt(segDx * segDx + segDy * segDy);
            if (segLength < 0.01) continue;
            const perpX = -segDy / segLength;
            const perpY = segDx / segLength;
            // Draw filled quad connecting 4 corners
            projectile.fillStyle(currentColors.trail, trailAlpha);
            projectile.beginPath();
            projectile.moveTo(relAX + perpX * widthA, relAY + perpY * widthA);
            projectile.lineTo(relBX + perpX * widthB, relBY + perpY * widthB);
            projectile.lineTo(relBX - perpX * widthB, relBY - perpY * widthB);
            projectile.lineTo(relAX - perpX * widthA, relAY - perpY * widthA);
            projectile.closePath();
            projectile.fillPath();
          }
        } else {
          // Medium: simple line trail (original lineBetween)
          // OPTIMIZATION: Iterate circular buffer without creating new arrays
          for (let i = 0; i < data.trailCount - 1; i++) {
            const bufferIdxA = (data.trailIndex - data.trailCount + i + TRAIL_LENGTH) % TRAIL_LENGTH;
            const bufferIdxB = (data.trailIndex - data.trailCount + i + 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
            const trailAlpha = ((i + 1) / data.trailCount) * 0.5;
            const trailWidth = Math.max(1, size * 0.8 * ((i + 1) / data.trailCount));
            const relAX = data.trailBuffer[bufferIdxA].x - data.x;
            const relAY = data.trailBuffer[bufferIdxA].y - data.y;
            const relBX = data.trailBuffer[bufferIdxB].x - data.x;
            const relBY = data.trailBuffer[bufferIdxB].y - data.y;
            projectile.lineStyle(trailWidth, currentColors.trail, trailAlpha);
            projectile.lineBetween(relAX, relAY, relBX, relBY);
          }
        }
      }

      // Glow halo behind bolt (quality-dependent breathing)
      if (this.currentQuality === 'high') {
        // High: breathing pulse on glow radius and alpha
        const breathingRadius = size * 3 * (1 + Math.sin(ctx.gameTime * 6) * 0.15);
        const breathingAlpha = 0.25 + Math.sin(ctx.gameTime * 6) * 0.08;
        projectile.fillStyle(currentColors.trail, breathingAlpha);
        projectile.fillCircle(0, 0, breathingRadius);
      } else {
        // Low/Medium: static glow circle
        projectile.fillStyle(currentColors.trail, 0.25);
        projectile.fillCircle(0, 0, size * 3);
      }

      // Draw projectile shape pointing in direction of travel (quality-dependent)
      const length = size * 4;  // Front to back
      const width = size * 2;   // Side to side
      const cos = Math.cos(data.angle);
      const sin = Math.sin(data.angle);

      // Front and back base positions (shared across quality levels)
      const frontX = cos * length;
      const frontY = sin * length;
      const backX = -cos * length * 0.5;
      const backY = -sin * length * 0.5;

      if (this.currentQuality === 'low') {
        // Low: 4-vertex diamond (front, right, back, left)
        const rightX = -sin * width;
        const rightY = cos * width;
        const leftX = sin * width;
        const leftY = -cos * width;

        projectile.fillStyle(currentColors.fill, 1);
        projectile.beginPath();
        projectile.moveTo(frontX, frontY);
        projectile.lineTo(rightX, rightY);
        projectile.lineTo(backX, backY);
        projectile.lineTo(leftX, leftY);
        projectile.closePath();
        projectile.fillPath();

        // White stroke outline
        const strokeAlpha = 0.8 + data.killCount * 0.07;
        projectile.lineStyle(1 + data.killCount * 0.5, 0xffffff, strokeAlpha);
        projectile.beginPath();
        projectile.moveTo(frontX, frontY);
        projectile.lineTo(rightX, rightY);
        projectile.lineTo(backX, backY);
        projectile.lineTo(leftX, leftY);
        projectile.closePath();
        projectile.strokePath();
      } else {
        // Medium/High: 7-vertex energy bolt - arrowhead front with concave rear notch
        // Right shoulder (wider than diamond)
        const rightShoulderX = -sin * width * 1.2;
        const rightShoulderY = cos * width * 1.2;
        // Right rear
        const rightRearX = backX + sin * width * 0.5;
        const rightRearY = backY - cos * width * 0.5;
        // Rear notch center (concave)
        const notchX = -cos * length * 0.15;
        const notchY = -sin * length * 0.15;
        // Left rear
        const leftRearX = backX - sin * width * 0.5;
        const leftRearY = backY + cos * width * 0.5;
        // Left shoulder
        const leftShoulderX = sin * width * 1.2;
        const leftShoulderY = -cos * width * 1.2;

        // Fill energy bolt
        projectile.fillStyle(currentColors.fill, 1);
        projectile.beginPath();
        projectile.moveTo(frontX, frontY);
        projectile.lineTo(rightShoulderX, rightShoulderY);
        projectile.lineTo(rightRearX, rightRearY);
        projectile.lineTo(notchX, notchY);
        projectile.lineTo(leftRearX, leftRearY);
        projectile.lineTo(leftShoulderX, leftShoulderY);
        projectile.closePath();
        projectile.fillPath();

        // White stroke outline (brighter for higher kill counts)
        const strokeAlpha = 0.8 + data.killCount * 0.07;
        projectile.lineStyle(1 + data.killCount * 0.5, 0xffffff, strokeAlpha);
        projectile.beginPath();
        projectile.moveTo(frontX, frontY);
        projectile.lineTo(rightShoulderX, rightShoulderY);
        projectile.lineTo(rightRearX, rightRearY);
        projectile.lineTo(notchX, notchY);
        projectile.lineTo(leftRearX, leftRearY);
        projectile.lineTo(leftShoulderX, leftShoulderY);
        projectile.closePath();
        projectile.strokePath();

        // High quality: white center spine line from front tip to back notch
        if (this.currentQuality === 'high') {
          projectile.lineStyle(1, 0xffffff, 0.8);
          projectile.lineBetween(frontX, frontY, notchX, notchY);
        }
      }

      // Check collision with nearby enemies using spatial hash
      const spatialHash = getEnemySpatialHash();
      const collisionRadius = 20;
      // OPTIMIZATION: Pre-compute squared collision radius
      const collisionRadiusSq = collisionRadius * collisionRadius;
      const nearbyEnemies = spatialHash.queryPotential(data.x, data.y, collisionRadius + 5);

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;
        if (data.hitEnemies.has(enemyId)) continue;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - data.x;
        const dy = ey - data.y;
        // OPTIMIZATION: Squared distance comparison
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          // Hit!
          const enemyHealthBefore = Health.current[enemyId];
          ctx.damageEnemy(enemyId, data.damage, 200);
          data.hitEnemies.add(enemyId);
          const enemyKilled = enemyHealthBefore > 0 && Health.current[enemyId] <= 0;

          ctx.effectsManager.playHitSparks(data.x, data.y, Math.atan2(data.velocityY, data.velocityX));

          // Soul Seeker mastery: retarget on kill
          if (enemyKilled && data.maxRetargets > 0 && data.killCount < data.maxRetargets) {
            data.killCount++;
            // +25% damage per kill
            data.damage *= 1.25;
            // Find new target
            const newTarget = this.findNearestEnemy(ctx, data.x, data.y, data.hitEnemies);
            if (newTarget !== -1) {
              // Retarget to new enemy
              const newAngle = Math.atan2(
                Transform.y[newTarget] - data.y,
                Transform.x[newTarget] - data.x
              );
              data.velocityX = Math.cos(newAngle) * this.stats.speed;
              data.velocityY = Math.sin(newAngle) * this.stats.speed;
              data.angle = newAngle;
              // Reset lifetime for continued flight
              data.lifetime = this.stats.duration * 0.7;
              // Reset circular buffer trail for visual reset
              data.trailIndex = 0;
              data.trailCount = 0;
              continue; // Don't remove or decrement piercing - it found a new target
            }
          }

          if (data.piercing <= 0) {
            toRemove.add(projectile);
            break;
          }
          data.piercing--;
        }
      }
    }

    // OPTIMIZATION: Single filter pass with O(1) Set.has() instead of indexOf + splice
    if (toRemove.size > 0) {
      for (const projectile of toRemove) {
        const removedData = this.projectileData.get(projectile);
        // Spawn impact puff (capped at 3 per frame for performance)
        if (removedData && this.impactPuffsThisFrame < 3) {
          this.impactPuffsThisFrame++;
          const puffColor = removedData.killCount > 0 ? 0xffd700 : 0x66ccff;

          if (this.currentQuality === 'high') {
            // High: Directional ellipse stretched along travel angle + radiating lines for Soul Seeker kills
            const impactGraphics = ctx.scene.add.graphics();
            impactGraphics.setPosition(removedData.x, removedData.y);
            impactGraphics.setDepth(DepthLayers.PROJECTILES);

            // Draw ellipse rotated to the projectile angle
            const impactCos = Math.cos(removedData.angle);
            const impactSin = Math.sin(removedData.angle);
            const ellipseRadiusX = size * 3;
            const ellipseRadiusY = size * 1.5;
            // Approximate rotated ellipse with a polygon
            const ellipseSegments = 12;
            impactGraphics.fillStyle(puffColor, 0.6);
            impactGraphics.beginPath();
            for (let segment = 0; segment <= ellipseSegments; segment++) {
              const theta = (segment / ellipseSegments) * Math.PI * 2;
              const localX = Math.cos(theta) * ellipseRadiusX;
              const localY = Math.sin(theta) * ellipseRadiusY;
              // Rotate by projectile angle
              const rotatedX = localX * impactCos - localY * impactSin;
              const rotatedY = localX * impactSin + localY * impactCos;
              if (segment === 0) {
                impactGraphics.moveTo(rotatedX, rotatedY);
              } else {
                impactGraphics.lineTo(rotatedX, rotatedY);
              }
            }
            impactGraphics.closePath();
            impactGraphics.fillPath();

            // Soul Seeker kills: add 3 radiating lines
            if (removedData.killCount > 0) {
              impactGraphics.lineStyle(1.5, 0xffffff, 0.7);
              for (let lineIdx = 0; lineIdx < 3; lineIdx++) {
                const radiateAngle = removedData.angle + (lineIdx - 1) * (Math.PI / 6);
                const lineLength = size * 4;
                impactGraphics.lineBetween(
                  0, 0,
                  Math.cos(radiateAngle) * lineLength,
                  Math.sin(radiateAngle) * lineLength
                );
              }
            }

            ctx.scene.tweens.add({
              targets: impactGraphics,
              scaleX: 3,
              scaleY: 3,
              alpha: 0,
              duration: 150,
              onComplete: () => impactGraphics.destroy(),
            });
          } else {
            // Low/Medium: expanding circle (original)
            const puff = ctx.scene.add.circle(removedData.x, removedData.y, size * 1.5, puffColor, 0.6);
            puff.setDepth(DepthLayers.PROJECTILES);
            ctx.scene.tweens.add({
              targets: puff,
              scaleX: 3,
              scaleY: 3,
              alpha: 0,
              duration: 150,
              onComplete: () => puff.destroy(),
            });
          }
        }
        this.projectileData.delete(projectile);
        projectile.destroy();
      }
      this.projectiles = this.projectiles.filter(p => !toRemove.has(p));
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // Projectile weapon gets extra count scaling
    this.stats.count = this.baseStats.count + Math.floor(this.level / 3) + this.externalBonusCount;
    this.stats.piercing = Math.floor(this.level / 2);
  }

  public destroy(): void {
    for (const projectile of this.projectiles) {
      projectile.destroy();
    }
    this.projectiles = [];
    this.projectileData.clear();
    super.destroy();
  }
}
