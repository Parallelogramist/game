import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import type { VisualQuality } from '../visual/GlowGraphics';
import { PROJECTILE_ATLAS_KEY, getProjectileFrame } from '../visual/ProjectileAtlasRenderer';

/**
 * ProjectileWeapon fires auto-targeting projectiles at the nearest enemy.
 * This is the starting weapon - reliable, upgradeable, good all-around.
 *
 * PERF: Projectile bodies are pre-rendered atlas Images (batched in 1 draw call).
 * Trails are drawn on a single shared Graphics object (1 clear per frame).
 */
const TRAIL_LENGTH = 6;

// Pool constants
const POOL_SIZE = 80;

interface ProjectileData {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  angle: number;
  piercing: number;
  damage: number;
  lifetime: number;
  hitEnemies: Set<number>;
  trailBuffer: { x: number; y: number }[];
  trailIndex: number;
  trailCount: number;
  killCount: number;
  maxRetargets: number;
  active: boolean;
  sprite: Phaser.GameObjects.Image | null;
}

export class ProjectileWeapon extends BaseWeapon {
  private pool: ProjectileData[] = [];
  private trailGraphics: Phaser.GameObjects.Graphics | null = null;
  private impactPuffsThisFrame: number = 0;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized: boolean = false;

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

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.trailGraphics = scene.add.graphics();
    this.trailGraphics.setDepth(DepthLayers.PROJECTILES - 1);

    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = scene.add.image(0, 0, PROJECTILE_ATLAS_KEY, getProjectileFrame(0, 'high'));
      sprite.setDepth(DepthLayers.PROJECTILES);
      sprite.setVisible(false);
      sprite.setActive(false);

      this.pool.push({
        x: 0, y: 0,
        velocityX: 0, velocityY: 0,
        angle: 0, piercing: 0, damage: 0, lifetime: 0,
        hitEnemies: new Set(),
        trailBuffer: new Array(TRAIL_LENGTH).fill(null).map(() => ({ x: 0, y: 0 })),
        trailIndex: 0, trailCount: 0,
        killCount: 0, maxRetargets: 0,
        active: false,
        sprite,
      });
    }
  }

  private acquireProjectile(ctx: WeaponContext): ProjectileData | null {
    this.initPool(ctx.scene);

    // Find an inactive slot
    for (const data of this.pool) {
      if (!data.active) return data;
    }

    // Pool exhausted: recycle the oldest active projectile (first active in array)
    for (const data of this.pool) {
      if (data.active) {
        this.deactivateProjectile(data);
        return data;
      }
    }

    return null;
  }

  private deactivateProjectile(data: ProjectileData): void {
    data.active = false;
    if (data.sprite) {
      data.sprite.setVisible(false);
      data.sprite.setActive(false);
    }
  }

  protected attack(ctx: WeaponContext): void {
    const spatialHash = getEnemySpatialHash();
    const nearestEnemy = spatialHash.findNearest(ctx.playerX, ctx.playerY, this.stats.range);

    if (!nearestEnemy) return;
    const nearestId = nearestEnemy.id;

    const targetX = Transform.x[nearestId];
    const targetY = Transform.y[nearestId];
    const baseAngle = Math.atan2(targetY - ctx.playerY, targetX - ctx.playerX);

    const spreadAngle = Math.PI / 12;

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
    const data = this.acquireProjectile(ctx);
    if (!data) return;

    data.x = ctx.playerX;
    data.y = ctx.playerY;
    data.velocityX = Math.cos(angle) * this.stats.speed;
    data.velocityY = Math.sin(angle) * this.stats.speed;
    data.angle = angle;
    data.piercing = this.stats.piercing;
    data.damage = this.stats.damage;
    data.lifetime = this.stats.duration;
    data.hitEnemies.clear();
    data.trailIndex = 0;
    data.trailCount = 0;
    data.killCount = 0;
    data.maxRetargets = this.isMastered() ? 3 : 0;
    data.active = true;

    if (data.sprite) {
      data.sprite.setFrame(getProjectileFrame(0, ctx.visualQuality));
      data.sprite.setPosition(ctx.playerX, ctx.playerY);
      data.sprite.setRotation(angle);
      data.sprite.setVisible(true);
      data.sprite.setActive(true);
    }
  }

  private findNearestEnemy(
    _ctx: WeaponContext,
    fromX: number,
    fromY: number,
    excludeIds: Set<number>
  ): number {
    const spatialHash = getEnemySpatialHash();
    const searchRadius = this.stats.range * 1.5;
    const searchRadiusSq = searchRadius * searchRadius;

    const nearbyEnemies = spatialHash.query(fromX, fromY, searchRadius);

    let nearestId = -1;
    let nearestDistSq = searchRadiusSq;

    for (const enemy of nearbyEnemies) {
      if (excludeIds.has(enemy.id)) continue;
      if (Health.current[enemy.id] <= 0) continue;

      const dx = enemy.x - fromX;
      const dy = enemy.y - fromY;
      const distSq = dx * dx + dy * dy;

      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestId = enemy.id;
      }
    }

    return nearestId;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.impactPuffsThisFrame = 0;
    this.currentQuality = ctx.visualQuality;

    const size = (this.stats.size * 0.25) + this.stats.piercing * 0.5;

    // Clear shared trail graphics once per frame
    if (this.trailGraphics) {
      this.trailGraphics.clear();
    }

    // Cache spatial hash ref for all projectiles
    const spatialHash = getEnemySpatialHash();
    const collisionRadius = 20;
    const collisionRadiusSq = collisionRadius * collisionRadius;
    const sceneWidth = ctx.scene.scale.width;
    const sceneHeight = ctx.scene.scale.height;

    // Soul Seeker trail colors
    const soulTrailColors = [0x99ddff, 0xcc99ff, 0xffec8b, 0xffffff];

    for (const data of this.pool) {
      if (!data.active) continue;

      // Record trail position
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
        this.removeProjectile(ctx, data, size);
        continue;
      }

      // Check bounds
      if (data.x < -50 || data.x > sceneWidth + 50 ||
          data.y < -50 || data.y > sceneHeight + 50) {
        this.removeProjectile(ctx, data, size);
        continue;
      }

      // Update sprite position and rotation (no redraw needed!)
      if (data.sprite) {
        data.sprite.setPosition(data.x, data.y);
        data.sprite.setRotation(data.angle);
      }

      // Draw trails on shared Graphics (quality-dependent)
      if (this.trailGraphics && this.currentQuality !== 'low' && data.trailCount >= 2) {
        const trailColor = soulTrailColors[Math.min(data.killCount, 3)];

        if (this.currentQuality === 'high') {
          // High: tapered quad strip
          for (let i = 0; i < data.trailCount - 1; i++) {
            const bufferIdxA = (data.trailIndex - data.trailCount + i + TRAIL_LENGTH) % TRAIL_LENGTH;
            const bufferIdxB = (data.trailIndex - data.trailCount + i + 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
            const progressA = (i + 1) / data.trailCount;
            const progressB = (i + 2) / data.trailCount;
            const trailAlpha = progressA * 0.5;
            const widthA = Math.max(0.5, size * 0.8 * progressA);
            const widthB = Math.max(0.5, size * 0.8 * progressB);
            const ax = data.trailBuffer[bufferIdxA].x;
            const ay = data.trailBuffer[bufferIdxA].y;
            const bx = data.trailBuffer[bufferIdxB].x;
            const by = data.trailBuffer[bufferIdxB].y;
            const segDx = bx - ax;
            const segDy = by - ay;
            const segLength = Math.sqrt(segDx * segDx + segDy * segDy);
            if (segLength < 0.01) continue;
            const perpX = -segDy / segLength;
            const perpY = segDx / segLength;
            this.trailGraphics.fillStyle(trailColor, trailAlpha);
            this.trailGraphics.beginPath();
            this.trailGraphics.moveTo(ax + perpX * widthA, ay + perpY * widthA);
            this.trailGraphics.lineTo(bx + perpX * widthB, by + perpY * widthB);
            this.trailGraphics.lineTo(bx - perpX * widthB, by - perpY * widthB);
            this.trailGraphics.lineTo(ax - perpX * widthA, ay - perpY * widthA);
            this.trailGraphics.closePath();
            this.trailGraphics.fillPath();
          }
        } else {
          // Medium: simple line trail
          for (let i = 0; i < data.trailCount - 1; i++) {
            const bufferIdxA = (data.trailIndex - data.trailCount + i + TRAIL_LENGTH) % TRAIL_LENGTH;
            const bufferIdxB = (data.trailIndex - data.trailCount + i + 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
            const trailAlpha = ((i + 1) / data.trailCount) * 0.5;
            const trailWidth = Math.max(1, size * 0.8 * ((i + 1) / data.trailCount));
            this.trailGraphics.lineStyle(trailWidth, trailColor, trailAlpha);
            this.trailGraphics.lineBetween(
              data.trailBuffer[bufferIdxA].x, data.trailBuffer[bufferIdxA].y,
              data.trailBuffer[bufferIdxB].x, data.trailBuffer[bufferIdxB].y,
            );
          }
        }
      }

      // Check collision with nearby enemies
      const nearbyEnemies = spatialHash.queryPotential(data.x, data.y, collisionRadius + 5);

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;
        if (data.hitEnemies.has(enemyId)) continue;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - data.x;
        const dy = ey - data.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          const enemyHealthBefore = Health.current[enemyId];
          ctx.damageEnemy(enemyId, data.damage, 200);
          data.hitEnemies.add(enemyId);
          const enemyKilled = enemyHealthBefore > 0 && Health.current[enemyId] <= 0;

          ctx.effectsManager.playHitSparks(data.x, data.y, Math.atan2(data.velocityY, data.velocityX));

          // Soul Seeker mastery: retarget on kill
          if (enemyKilled && data.maxRetargets > 0 && data.killCount < data.maxRetargets) {
            data.killCount++;
            data.damage *= 1.25;
            // Update sprite frame for new soul color
            if (data.sprite) {
              data.sprite.setFrame(getProjectileFrame(data.killCount, this.currentQuality));
            }
            const newTarget = this.findNearestEnemy(ctx, data.x, data.y, data.hitEnemies);
            if (newTarget !== -1) {
              const newAngle = Math.atan2(
                Transform.y[newTarget] - data.y,
                Transform.x[newTarget] - data.x
              );
              data.velocityX = Math.cos(newAngle) * this.stats.speed;
              data.velocityY = Math.sin(newAngle) * this.stats.speed;
              data.angle = newAngle;
              data.lifetime = this.stats.duration * 0.7;
              data.trailIndex = 0;
              data.trailCount = 0;
              continue;
            }
          }

          if (data.piercing <= 0) {
            this.removeProjectile(ctx, data, size);
            break;
          }
          data.piercing--;
        }
      }
    }
  }

  private removeProjectile(ctx: WeaponContext, data: ProjectileData, size: number): void {
    // Spawn impact puff (capped at 3 per frame)
    if (this.impactPuffsThisFrame < 3) {
      this.impactPuffsThisFrame++;
      const puffColor = data.killCount > 0 ? 0xffd700 : 0x66ccff;

      if (this.currentQuality === 'high') {
        const impactGraphics = ctx.scene.add.graphics();
        impactGraphics.setPosition(data.x, data.y);
        impactGraphics.setDepth(DepthLayers.PROJECTILES);

        const impactCos = Math.cos(data.angle);
        const impactSin = Math.sin(data.angle);
        const ellipseRadiusX = size * 3;
        const ellipseRadiusY = size * 1.5;
        const ellipseSegments = 12;
        impactGraphics.fillStyle(puffColor, 0.6);
        impactGraphics.beginPath();
        for (let segment = 0; segment <= ellipseSegments; segment++) {
          const theta = (segment / ellipseSegments) * Math.PI * 2;
          const localX = Math.cos(theta) * ellipseRadiusX;
          const localY = Math.sin(theta) * ellipseRadiusY;
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

        if (data.killCount > 0) {
          impactGraphics.lineStyle(1.5, 0xffffff, 0.7);
          for (let lineIdx = 0; lineIdx < 3; lineIdx++) {
            const radiateAngle = data.angle + (lineIdx - 1) * (Math.PI / 6);
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
        const puff = ctx.scene.add.circle(data.x, data.y, size * 1.5, puffColor, 0.6);
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

    this.deactivateProjectile(data);
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor(this.level / 3) + this.externalBonusCount;
    this.stats.piercing = this.baseStats.piercing + Math.floor(this.level / 2) + this.externalBonusPiercing;
  }

  public destroy(): void {
    for (const data of this.pool) {
      if (data.sprite) {
        data.sprite.destroy();
        data.sprite = null;
      }
    }
    this.pool = [];
    this.poolInitialized = false;
    if (this.trailGraphics) {
      this.trailGraphics.destroy();
      this.trailGraphics = null;
    }
    super.destroy();
  }
}
