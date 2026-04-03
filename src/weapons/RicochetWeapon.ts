import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import type { VisualQuality } from '../visual/GlowGraphics';
import { findNearestEnemy } from './WeaponUtils';
import { PROJECTILE_ATLAS_KEY, getRicochetFrame } from '../visual/ProjectileAtlasRenderer';

const RICOCHET_TRAIL_LENGTH = 6;
const POOL_SIZE = 40;

interface RicochetBall {
  sprite: Phaser.GameObjects.Image | null;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
  damage: number;
  bounces: number;
  lifetime: number;
  hitEnemies: Set<number>;
  isEcho: boolean;
  trailHistory: { x: number; y: number }[];
  trailIndex: number;
  trailCount: number;
  ballSize: number;
  ballColor: number;
  active: boolean;
}

/**
 * RicochetWeapon fires bouncing projectiles that reflect off screen edges.
 *
 * PERF: Ball bodies are atlas Images (batched draw). Trails on shared Graphics.
 * Velocity-stretch is approximated via setScale(stretchFactor, 1/stretchFactor).
 */
export class RicochetWeapon extends BaseWeapon {
  private pool: RicochetBall[] = [];
  private trailGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized: boolean = false;
  private bounceEffectsThisFrame: number = 0;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 18,
      cooldown: 1.2,
      range: 300,
      count: 1,
      piercing: 2,
      size: 1,
      speed: 350,
      duration: 5,
    };

    super(
      'ricochet',
      'Bouncing Ball',
      'ricochet',
      'Ricochets off walls',
      10,
      baseStats,
      'Kinetic Amplification',
      'Each bounce: +30% damage and spawns an echo projectile'
    );
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.trailGraphics = scene.add.graphics();
    this.trailGraphics.setDepth(DepthLayers.PROJECTILES - 1);

    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = scene.add.image(0, 0, PROJECTILE_ATLAS_KEY, getRicochetFrame(false, 'high'));
      sprite.setDepth(DepthLayers.PROJECTILES);
      sprite.setVisible(false);
      sprite.setActive(false);

      this.pool.push({
        sprite,
        velocityX: 0, velocityY: 0, x: 0, y: 0,
        damage: 0, bounces: 0, lifetime: 0,
        hitEnemies: new Set(),
        isEcho: false,
        trailHistory: new Array(RICOCHET_TRAIL_LENGTH).fill(null).map(() => ({ x: 0, y: 0 })),
        trailIndex: 0, trailCount: 0,
        ballSize: 8, ballColor: 0x4488ff,
        active: false,
      });
    }
  }

  private acquireBall(ctx: WeaponContext): RicochetBall | null {
    this.initPool(ctx.scene);
    for (const ball of this.pool) {
      if (!ball.active) return ball;
    }
    // Pool exhausted: recycle oldest
    for (const ball of this.pool) {
      if (ball.active) {
        this.deactivateBall(ball);
        return ball;
      }
    }
    return null;
  }

  private deactivateBall(ball: RicochetBall): void {
    ball.active = false;
    if (ball.sprite) {
      ball.sprite.setVisible(false);
      ball.sprite.setActive(false);
    }
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();

    for (let i = 0; i < this.stats.count; i++) {
      let angle: number;

      if (enemies.length > 0 && i === 0) {
        const nearestId = findNearestEnemy(ctx, ctx.playerX, ctx.playerY);
        const ex = Transform.x[nearestId];
        const ey = Transform.y[nearestId];
        angle = Math.atan2(ey - ctx.playerY, ex - ctx.playerX);
      } else {
        angle = Math.random() * Math.PI * 2;
      }

      this.createBall(ctx, angle, false, this.stats.damage, 3 + Math.floor(this.level / 2), this.stats.duration, 8 * this.stats.size, 0x4488ff);
    }
  }

  private createBall(
    ctx: WeaponContext, angle: number, isEcho: boolean,
    damage: number, bounces: number, lifetime: number,
    ballSize: number, ballColor: number,
  ): void {
    const ball = this.acquireBall(ctx);
    if (!ball) return;

    const speed = isEcho ? this.stats.speed * 0.8 : this.stats.speed;

    ball.x = ctx.playerX;
    ball.y = ctx.playerY;
    ball.velocityX = Math.cos(angle) * speed;
    ball.velocityY = Math.sin(angle) * speed;
    ball.damage = damage;
    ball.bounces = bounces;
    ball.lifetime = lifetime;
    ball.hitEnemies.clear();
    ball.isEcho = isEcho;
    ball.trailIndex = 0;
    ball.trailCount = 0;
    ball.ballSize = ballSize;
    ball.ballColor = ballColor;
    ball.active = true;

    if (ball.sprite) {
      ball.sprite.setFrame(getRicochetFrame(isEcho, ctx.visualQuality));
      ball.sprite.setPosition(ball.x, ball.y);
      ball.sprite.setVisible(true);
      ball.sprite.setActive(true);
    }
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;
    this.bounceEffectsThisFrame = 0;

    const spatialHash = getEnemySpatialHash();

    // Clear shared trail graphics once per frame
    if (this.trailGraphics) {
      this.trailGraphics.clear();
    }

    for (const ball of this.pool) {
      if (!ball.active) continue;

      // Update lifetime
      ball.lifetime -= ctx.deltaTime;
      if (ball.lifetime <= 0) {
        this.deactivateBall(ball);
        continue;
      }

      // Record trail
      ball.trailHistory[ball.trailIndex].x = ball.x;
      ball.trailHistory[ball.trailIndex].y = ball.y;
      ball.trailIndex = (ball.trailIndex + 1) % RICOCHET_TRAIL_LENGTH;
      if (ball.trailCount < RICOCHET_TRAIL_LENGTH) ball.trailCount++;

      // Move
      ball.x += ball.velocityX * ctx.deltaTime;
      ball.y += ball.velocityY * ctx.deltaTime;

      // Wall bounces
      const margin = 10;
      let bounced = false;

      if (ball.x <= margin) {
        ball.x = margin;
        ball.velocityX = Math.abs(ball.velocityX);
        bounced = true;
      } else if (ball.x >= ctx.scene.scale.width - margin) {
        ball.x = ctx.scene.scale.width - margin;
        ball.velocityX = -Math.abs(ball.velocityX);
        bounced = true;
      }

      if (ball.y <= margin) {
        ball.y = margin;
        ball.velocityY = Math.abs(ball.velocityY);
        bounced = true;
      } else if (ball.y >= ctx.scene.scale.height - margin) {
        ball.y = ctx.scene.scale.height - margin;
        ball.velocityY = -Math.abs(ball.velocityY);
        bounced = true;
      }

      if (bounced) {
        ball.bounces--;
        ball.hitEnemies.clear();

        // Mastery: Kinetic Amplification
        if (this.isMastered()) {
          ball.damage *= 1.3;
          if (!ball.isEcho) {
            this.spawnEchoBall(ctx, ball);
          }
        }

        // Bounce visual effects (capped at 3 per frame to prevent tween explosion)
        if (this.bounceEffectsThisFrame < 3) {
          this.bounceEffectsThisFrame++;

          const bounceFlash = ctx.scene.add.circle(ball.x, ball.y, ball.ballSize, 0xffffff, 0.8);
          bounceFlash.setDepth(11);
          ctx.scene.tweens.add({
            targets: bounceFlash,
            scaleX: 3, scaleY: 3, alpha: 0,
            duration: 120,
            onComplete: () => bounceFlash.destroy(),
          });

          if (this.currentQuality === 'high') {
            const travelAngle = Math.atan2(ball.velocityY, ball.velocityX);
            const sparkFanGraphics = ctx.scene.add.graphics();
            sparkFanGraphics.setPosition(ball.x, ball.y);
            sparkFanGraphics.setDepth(11);
            for (let sparkIndex = 0; sparkIndex < 5; sparkIndex++) {
              const sparkAngle = travelAngle - Math.PI / 3 + (sparkIndex / 4) * Math.PI * 2 / 3;
              sparkFanGraphics.lineStyle(2, 0xffffff, 0.8);
              sparkFanGraphics.lineBetween(0, 0, Math.cos(sparkAngle) * 25, Math.sin(sparkAngle) * 25);
            }
            ctx.scene.tweens.add({
              targets: sparkFanGraphics,
              scaleX: 2, scaleY: 2, alpha: 0,
              duration: 150,
              onComplete: () => sparkFanGraphics.destroy(),
            });
          }

          ctx.effectsManager.playHitSparks(ball.x, ball.y, Math.atan2(ball.velocityY, ball.velocityX));
        }

        if (ball.bounces <= 0) {
          this.deactivateBall(ball);
          continue;
        }
      }

      // Draw trail on shared graphics
      if (this.trailGraphics && this.currentQuality !== 'low') {
        if (this.currentQuality === 'medium') {
          for (let i = 0; i < ball.trailCount; i++) {
            const bufferIdx = (ball.trailIndex - ball.trailCount + i + RICOCHET_TRAIL_LENGTH) % RICOCHET_TRAIL_LENGTH;
            const trailAlpha = ((i + 1) / ball.trailCount) * 0.35;
            const trailRadius = ball.ballSize * 0.6 * ((i + 1) / ball.trailCount);
            this.trailGraphics.fillStyle(ball.ballColor, trailAlpha);
            this.trailGraphics.fillCircle(ball.trailHistory[bufferIdx].x, ball.trailHistory[bufferIdx].y, trailRadius);
          }
        } else {
          for (let i = 1; i < ball.trailCount; i++) {
            const prevBufferIdx = (ball.trailIndex - ball.trailCount + i - 1 + RICOCHET_TRAIL_LENGTH) % RICOCHET_TRAIL_LENGTH;
            const currentBufferIdx = (ball.trailIndex - ball.trailCount + i + RICOCHET_TRAIL_LENGTH) % RICOCHET_TRAIL_LENGTH;
            const segmentProgress = (i + 1) / ball.trailCount;
            const segmentAlpha = segmentProgress * 0.5;
            const segmentWidth = Math.max(1, ball.ballSize * 1.2 * segmentProgress);
            this.trailGraphics.lineStyle(segmentWidth, ball.ballColor, segmentAlpha);
            this.trailGraphics.lineBetween(
              ball.trailHistory[prevBufferIdx].x, ball.trailHistory[prevBufferIdx].y,
              ball.trailHistory[currentBufferIdx].x, ball.trailHistory[currentBufferIdx].y
            );
          }
        }
      }

      // Update sprite: position + velocity stretch
      if (ball.sprite) {
        const currentSpeed = Math.sqrt(ball.velocityX * ball.velocityX + ball.velocityY * ball.velocityY);
        const stretchFactor = Math.min(1.5, currentSpeed / this.stats.speed);
        const movementAngle = Math.atan2(ball.velocityY, ball.velocityX);

        ball.sprite.setPosition(ball.x, ball.y);
        ball.sprite.setRotation(movementAngle);
        ball.sprite.setScale(stretchFactor, 1 / stretchFactor);
      }

      // Collision check
      const collisionRadius = 20;
      const collisionRadiusSq = collisionRadius * collisionRadius;
      const nearbyEnemies = spatialHash.queryPotential(ball.x, ball.y, collisionRadius + 5);
      let hitsThisFrame = 0;

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;
        if (ball.hitEnemies.has(enemyId)) continue;
        if (hitsThisFrame >= this.stats.piercing) break;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - ball.x;
        const dy = ey - ball.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          ctx.damageEnemy(enemyId, ball.damage, 100);
          ball.hitEnemies.add(enemyId);
          hitsThisFrame++;
          ctx.effectsManager.playHitSparks(ball.x, ball.y, Math.atan2(ball.velocityY, ball.velocityX));
        }
      }
    }
  }

  private spawnEchoBall(ctx: WeaponContext, parentBall: RicochetBall): void {
    const echoSize = 8 * this.stats.size * 0.5;
    const angleOffset = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * Math.PI / 4);
    const baseAngle = Math.atan2(parentBall.velocityY, parentBall.velocityX);
    const echoAngle = baseAngle + angleOffset;

    const ball = this.acquireBall(ctx);
    if (!ball) return;

    ball.x = parentBall.x;
    ball.y = parentBall.y;
    const echoSpeed = Math.sqrt(parentBall.velocityX ** 2 + parentBall.velocityY ** 2) * 0.8;
    ball.velocityX = Math.cos(echoAngle) * echoSpeed;
    ball.velocityY = Math.sin(echoAngle) * echoSpeed;
    ball.damage = parentBall.damage * 0.5;
    ball.bounces = 2;
    ball.lifetime = 2.5;
    ball.hitEnemies.clear();
    ball.isEcho = true;
    ball.trailIndex = 0;
    ball.trailCount = 0;
    ball.ballSize = echoSize;
    ball.ballColor = 0xffdd44;
    ball.active = true;

    if (ball.sprite) {
      ball.sprite.setFrame(getRicochetFrame(true, this.currentQuality));
      ball.sprite.setPosition(ball.x, ball.y);
      ball.sprite.setVisible(true);
      ball.sprite.setActive(true);
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 3) + this.externalBonusCount;
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 30;
  }

  public destroy(): void {
    for (const ball of this.pool) {
      if (ball.sprite) {
        ball.sprite.destroy();
        ball.sprite = null;
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
