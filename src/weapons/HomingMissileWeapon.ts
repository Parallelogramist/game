import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { getEnemyIds } from '../ecs/FrameCache';
import { getJuiceManager } from '../effects/JuiceManager';
import { DepthLayers } from '../visual/DepthLayers';
import type { VisualQuality } from '../visual/GlowGraphics';
import { PROJECTILE_ATLAS_KEY, getMissileFrame } from '../visual/ProjectileAtlasRenderer';

const MISSILE_TRAIL_LENGTH = 12;
const POOL_SIZE = 30;

interface Missile {
  sprite: Phaser.GameObjects.Image | null;
  actualX: number;
  actualY: number;
  targetId: number;
  damage: number;
  speed: number;
  lifetime: number;
  isBomblet: boolean;
  trailHistory: { x: number; y: number }[];
  trailIndex: number;
  trailCount: number;
  wobblePhase: number;
  active: boolean;
}

/**
 * HomingMissileWeapon fires slow missiles that track enemies.
 *
 * PERF: Missile bodies are atlas Images (batched draw). Exhaust and trails
 * drawn on a single shared Graphics object.
 */
export class HomingMissileWeapon extends BaseWeapon {
  private pool: Missile[] = [];
  private trailGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized: boolean = false;
  private explosionEffectsThisFrame: number = 0;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 35,
      cooldown: 2.0,
      range: 400,
      count: 1,
      piercing: 0,
      size: 1,
      speed: 180,
      duration: 4,
    };

    super(
      'homing_missile',
      'Homing Missiles',
      'homing-missile',
      'Slow but always hits',
      10,
      baseStats,
      'Cluster Ordnance',
      'On impact, missiles split into 4 homing bomblets (30% damage each)'
    );
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.trailGraphics = scene.add.graphics();
    this.trailGraphics.setDepth(DepthLayers.PROJECTILES - 1);

    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = scene.add.image(0, 0, PROJECTILE_ATLAS_KEY, getMissileFrame(false, 'high'));
      sprite.setDepth(DepthLayers.PROJECTILES);
      sprite.setVisible(false);
      sprite.setActive(false);

      this.pool.push({
        sprite,
        actualX: 0, actualY: 0,
        targetId: -1, damage: 0, speed: 0, lifetime: 0,
        isBomblet: false,
        trailHistory: new Array(MISSILE_TRAIL_LENGTH).fill(null).map(() => ({ x: 0, y: 0 })),
        trailIndex: 0, trailCount: 0,
        wobblePhase: 0,
        active: false,
      });
    }
  }

  private acquireMissile(ctx: WeaponContext): Missile | null {
    this.initPool(ctx.scene);
    for (const missile of this.pool) {
      if (!missile.active) return missile;
    }
    for (const missile of this.pool) {
      if (missile.active) {
        this.deactivateMissile(missile);
        return missile;
      }
    }
    return null;
  }

  private deactivateMissile(missile: Missile): void {
    missile.active = false;
    if (missile.sprite) {
      missile.sprite.setVisible(false);
      missile.sprite.setActive(false);
    }
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = getEnemyIds();
    if (enemies.length === 0) return;

    for (let i = 0; i < this.stats.count; i++) {
      const targetIndex = Math.floor(Math.random() * enemies.length);
      const targetId = enemies[targetIndex];
      this.createMissile(ctx, ctx.playerX, ctx.playerY, targetId, false,
        this.stats.damage, this.stats.speed, this.stats.duration);
    }
  }

  private createMissile(
    ctx: WeaponContext, x: number, y: number, targetId: number,
    isBomblet: boolean, damage: number, speed: number, lifetime: number,
  ): void {
    const missile = this.acquireMissile(ctx);
    if (!missile) return;

    missile.actualX = x;
    missile.actualY = y;
    missile.targetId = targetId;
    missile.damage = damage;
    missile.speed = speed;
    missile.lifetime = lifetime;
    missile.isBomblet = isBomblet;
    missile.trailIndex = 0;
    missile.trailCount = 0;
    missile.wobblePhase = Math.random() * Math.PI * 2;
    missile.active = true;

    if (missile.sprite) {
      missile.sprite.setFrame(getMissileFrame(isBomblet, ctx.visualQuality));
      missile.sprite.setPosition(x, y);
      missile.sprite.setVisible(true);
      missile.sprite.setActive(true);
    }
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;
    this.explosionEffectsThisFrame = 0;

    if (this.trailGraphics) {
      this.trailGraphics.clear();
    }

    for (const missile of this.pool) {
      if (!missile.active) continue;

      missile.lifetime -= ctx.deltaTime;
      if (missile.lifetime <= 0) {
        this.deactivateMissile(missile);
        continue;
      }

      // Check if target still exists
      const targetHealth = Health.current[missile.targetId];
      if (targetHealth === undefined || targetHealth <= 0) {
        const enemies = getEnemyIds();
        if (enemies.length > 0) {
          missile.targetId = enemies[Math.floor(Math.random() * enemies.length)];
        } else {
          this.deactivateMissile(missile);
          continue;
        }
      }

      // Record trail
      missile.trailHistory[missile.trailIndex].x = missile.actualX;
      missile.trailHistory[missile.trailIndex].y = missile.actualY;
      missile.trailIndex = (missile.trailIndex + 1) % MISSILE_TRAIL_LENGTH;
      if (missile.trailCount < MISSILE_TRAIL_LENGTH) missile.trailCount++;

      const targetX = Transform.x[missile.targetId];
      const targetY = Transform.y[missile.targetId];
      const mx = missile.actualX;
      const my = missile.actualY;

      const dx = targetX - mx;
      const dy = targetY - my;
      const distSq = dx * dx + dy * dy;

      // Hit detection (distSq avoids sqrt)
      if (distSq < 400) { // 20^2
        const angle = Math.atan2(dy, dx);
        ctx.damageEnemy(missile.targetId, missile.damage, 150);
        ctx.effectsManager.playHitSparks(mx, my, angle);

        if (this.isMastered() && !missile.isBomblet) {
          this.spawnClusterBomblets(ctx, mx, my, missile.targetId);
        }

        // Multi-layer explosion (capped at 3 per frame to prevent tween explosion)
        if (this.explosionEffectsThisFrame < 3) {
          this.explosionEffectsThisFrame++;
          const explosionRadius = missile.isBomblet ? 12 : 20;
          const explosionColor = missile.isBomblet ? 0xffaa44 : 0x66aaff;

          const whiteFlash = ctx.scene.add.circle(mx, my, explosionRadius * 2, 0xffffff, 1);
          whiteFlash.setDepth(12);
          ctx.scene.tweens.add({
            targets: whiteFlash,
            alpha: 0, duration: 100,
            onComplete: () => whiteFlash.destroy(),
          });

          const coloredRing = ctx.scene.add.circle(mx, my, explosionRadius, explosionColor, 0);
          coloredRing.setStrokeStyle(3, explosionColor, 0.8);
          coloredRing.setDepth(11);
          ctx.scene.tweens.add({
            targets: coloredRing,
            scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 250,
            onComplete: () => coloredRing.destroy(),
          });

          const expandingFill = ctx.scene.add.circle(mx, my, explosionRadius, explosionColor, 0.6);
          expandingFill.setDepth(DepthLayers.PROJECTILES);
          ctx.scene.tweens.add({
            targets: expandingFill,
            scaleX: 2, scaleY: 2, alpha: 0, duration: 300,
            onComplete: () => expandingFill.destroy(),
          });

          if (!missile.isBomblet) {
            getJuiceManager().screenShake(0.003, 150);
          }
        }

        this.deactivateMissile(missile);
        continue;
      }

      // Move toward target (sqrt needed for normalization)
      const dist = Math.sqrt(distSq);
      const angle = Math.atan2(dy, dx);
      missile.actualX += (dx / dist) * missile.speed * ctx.deltaTime;
      missile.actualY += (dy / dist) * missile.speed * ctx.deltaTime;

      // Corkscrew wobble (visual only)
      missile.wobblePhase += ctx.deltaTime * 8;
      const perpOffset = Math.sin(missile.wobblePhase) * 8;
      const perpX = -Math.sin(angle) * perpOffset;
      const perpY = Math.cos(angle) * perpOffset;

      // Update sprite position + rotation
      if (missile.sprite) {
        missile.sprite.setPosition(missile.actualX + perpX, missile.actualY + perpY);
        missile.sprite.setRotation(angle);
      }

      // Draw exhaust + trails on shared graphics
      if (this.trailGraphics) {
        // Exhaust flicker (medium/high only)
        if (this.currentQuality !== 'low') {
          const missileSize = missile.isBomblet ? 5 * this.stats.size : 8 * this.stats.size;
          const flickerLength = missileSize * (1.2 + Math.sin(ctx.gameTime * 20 + missile.wobblePhase) * 0.4);
          const exhaustColor = missile.isBomblet ? 0xffaa44 : 0x4488ff;
          const innerColor = missile.isBomblet ? 0xffcc66 : 0x88ccff;

          // Calculate exhaust position behind missile in world coords
          const exhaustX = missile.actualX + perpX - Math.cos(angle) * missileSize * 1.5;
          const exhaustY = missile.actualY + perpY - Math.sin(angle) * missileSize * 1.5;

          this.trailGraphics.fillStyle(exhaustColor, 0.4);
          this.trailGraphics.fillCircle(exhaustX, exhaustY, flickerLength * 0.4);
          this.trailGraphics.fillStyle(innerColor, 0.7);
          this.trailGraphics.fillCircle(exhaustX, exhaustY, flickerLength * 0.2);
        }

        // Trail rendering
        const trailColor = missile.isBomblet ? 0xffaa44 : 0x66ccff;

        if (this.currentQuality === 'high' && missile.trailCount > 1) {
          for (let i = 0; i < missile.trailCount - 1; i++) {
            const idxA = (missile.trailIndex - missile.trailCount + i + MISSILE_TRAIL_LENGTH) % MISSILE_TRAIL_LENGTH;
            const idxB = (missile.trailIndex - missile.trailCount + i + 1 + MISSILE_TRAIL_LENGTH) % MISSILE_TRAIL_LENGTH;
            const tA = (i + 1) / missile.trailCount;
            const tB = (i + 2) / missile.trailCount;
            const ribbonWidthA = 4 * (1 - tA);
            const ribbonWidthB = 4 * (1 - tB);

            const pointAx = missile.trailHistory[idxA].x, pointAy = missile.trailHistory[idxA].y;
            const pointBx = missile.trailHistory[idxB].x, pointBy = missile.trailHistory[idxB].y;
            const segmentDx = pointBx - pointAx, segmentDy = pointBy - pointAy;
            const segmentLength = Math.sqrt(segmentDx * segmentDx + segmentDy * segmentDy) || 1;
            const perpNormX = -segmentDy / segmentLength, perpNormY = segmentDx / segmentLength;

            this.trailGraphics.fillStyle(trailColor, tA * 0.3);
            this.trailGraphics.beginPath();
            this.trailGraphics.moveTo(pointAx + perpNormX * ribbonWidthA, pointAy + perpNormY * ribbonWidthA);
            this.trailGraphics.lineTo(pointBx + perpNormX * ribbonWidthB, pointBy + perpNormY * ribbonWidthB);
            this.trailGraphics.lineTo(pointBx - perpNormX * ribbonWidthB, pointBy - perpNormY * ribbonWidthB);
            this.trailGraphics.lineTo(pointAx - perpNormX * ribbonWidthA, pointAy - perpNormY * ribbonWidthA);
            this.trailGraphics.closePath();
            this.trailGraphics.fillPath();
          }
        } else if (this.currentQuality === 'medium') {
          for (let i = 0; i < missile.trailCount; i++) {
            const bufferIdx = (missile.trailIndex - missile.trailCount + i + MISSILE_TRAIL_LENGTH) % MISSILE_TRAIL_LENGTH;
            const trailAlpha = ((i + 1) / missile.trailCount) * 0.4;
            const trailRadius = 3 * ((i + 1) / missile.trailCount);
            this.trailGraphics.fillStyle(trailColor, trailAlpha);
            this.trailGraphics.fillCircle(missile.trailHistory[bufferIdx].x, missile.trailHistory[bufferIdx].y, trailRadius);
          }
        }
      }
    }
  }

  private spawnClusterBomblets(
    ctx: WeaponContext, x: number, y: number, excludeTargetId: number,
  ): void {
    const spatialHash = getEnemySpatialHash();
    const nearbyEnemies = spatialHash.query(x, y, 200);

    const bombletCount = 4;
    const bombletDamage = this.stats.damage * 0.3;
    const bombletSpeed = this.stats.speed * 1.2;
    const bombletLifetime = 1.5;

    const potentialTargets = nearbyEnemies.filter(e => e.id !== excludeTargetId && Health.current[e.id] > 0);

    for (let i = 0; i < bombletCount; i++) {
      const spreadAngle = (i / bombletCount) * Math.PI * 2 + Math.random() * 0.5;

      let targetId: number;
      if (potentialTargets.length > 0) {
        targetId = potentialTargets[Math.floor(Math.random() * potentialTargets.length)].id;
      } else if (nearbyEnemies.length > 0) {
        targetId = nearbyEnemies[Math.floor(Math.random() * nearbyEnemies.length)].id;
      } else {
        const allEnemies = getEnemyIds();
        if (allEnemies.length > 0) {
          targetId = allEnemies[Math.floor(Math.random() * allEnemies.length)];
        } else {
          continue;
        }
      }

      const pushDist = 20;
      const spawnX = x + Math.cos(spreadAngle) * pushDist;
      const spawnY = y + Math.sin(spreadAngle) * pushDist;

      this.createMissile(ctx, spawnX, spawnY, targetId, true,
        bombletDamage, bombletSpeed, bombletLifetime);
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 20;
  }

  public destroy(): void {
    for (const missile of this.pool) {
      if (missile.sprite) {
        missile.sprite.destroy();
        missile.sprite = null;
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
