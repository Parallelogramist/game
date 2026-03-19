import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { GAME_WIDTH, GAME_HEIGHT } from '../GameConfig';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';

const RICOCHET_TRAIL_LENGTH = 6;

interface RicochetBall {
  sprite: Phaser.GameObjects.Graphics;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
  damage: number;
  bounces: number;
  lifetime: number;
  hitEnemies: Set<number>;
  isEcho?: boolean; // Mastery: Kinetic Amplification - echo projectiles don't spawn more echoes
  trailHistory: { x: number; y: number }[];
  trailIndex: number;
  trailCount: number;
  ballSize: number;
  ballColor: number;
}

/**
 * RicochetWeapon fires bouncing projectiles that reflect off screen edges.
 * Great for enclosed areas and hitting enemies from unexpected angles.
 */
export class RicochetWeapon extends BaseWeapon {
  private balls: RicochetBall[] = [];
  private trailGraphics: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 18,
      cooldown: 1.2,
      range: 300,
      count: 1,
      piercing: 2,        // Enemies per bounce
      size: 1,
      speed: 350,
      duration: 5,        // Max lifetime
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

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();

    for (let i = 0; i < this.stats.count; i++) {
      let angle: number;

      if (enemies.length > 0 && i === 0) {
        // First ball aims at nearest enemy
        let nearestId = -1;
        // OPTIMIZATION: Use squared distance for comparisons
        let nearestDistSq = Infinity;

        for (const enemyId of enemies) {
          const ex = Transform.x[enemyId];
          const ey = Transform.y[enemyId];
          const dx = ex - ctx.playerX;
          const dy = ey - ctx.playerY;
          const distSq = dx * dx + dy * dy;
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearestId = enemyId;
          }
        }

        const ex = Transform.x[nearestId];
        const ey = Transform.y[nearestId];
        angle = Math.atan2(ey - ctx.playerY, ex - ctx.playerX);
      } else {
        // Random direction for additional balls
        angle = Math.random() * Math.PI * 2;
      }

      this.createBall(ctx, angle);
    }
  }

  private createBall(ctx: WeaponContext, angle: number): void {
    const ballSize = 8 * this.stats.size;

    const sprite = ctx.scene.add.graphics();
    sprite.setDepth(DepthLayers.PROJECTILES);

    this.balls.push({
      sprite,
      x: ctx.playerX,
      y: ctx.playerY,
      velocityX: Math.cos(angle) * this.stats.speed,
      velocityY: Math.sin(angle) * this.stats.speed,
      damage: this.stats.damage,
      bounces: 3 + Math.floor(this.level / 2), // More bounces at higher levels
      lifetime: this.stats.duration,
      hitEnemies: new Set(),
      trailHistory: new Array(RICOCHET_TRAIL_LENGTH).fill(null).map(() => ({ x: 0, y: 0 })),
      trailIndex: 0,
      trailCount: 0,
      ballSize,
      ballColor: 0x4488ff,
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    // OPTIMIZATION: Use Set for O(1) removal checks
    const toRemove = new Set<RicochetBall>();
    // OPTIMIZATION: Get spatial hash once per frame
    const spatialHash = getEnemySpatialHash();

    // Ensure shared trail graphics exists
    if (!this.trailGraphics && ctx.scene) {
      this.trailGraphics = ctx.scene.add.graphics();
      this.trailGraphics.setDepth(9);
    }

    // Clear shared trail graphics each frame
    if (this.trailGraphics) {
      this.trailGraphics.clear();
    }

    for (const ball of this.balls) {
      // Update lifetime
      ball.lifetime -= ctx.deltaTime;
      if (ball.lifetime <= 0) {
        toRemove.add(ball);
        continue;
      }

      // Record trail position in circular buffer
      ball.trailHistory[ball.trailIndex].x = ball.x;
      ball.trailHistory[ball.trailIndex].y = ball.y;
      ball.trailIndex = (ball.trailIndex + 1) % RICOCHET_TRAIL_LENGTH;
      if (ball.trailCount < RICOCHET_TRAIL_LENGTH) ball.trailCount++;

      // Move ball
      ball.x += ball.velocityX * ctx.deltaTime;
      ball.y += ball.velocityY * ctx.deltaTime;

      // Check wall bounces
      const margin = 10;
      let bounced = false;

      if (ball.x <= margin) {
        ball.x = margin;
        ball.velocityX = Math.abs(ball.velocityX);
        bounced = true;
      } else if (ball.x >= GAME_WIDTH - margin) {
        ball.x = GAME_WIDTH - margin;
        ball.velocityX = -Math.abs(ball.velocityX);
        bounced = true;
      }

      if (ball.y <= margin) {
        ball.y = margin;
        ball.velocityY = Math.abs(ball.velocityY);
        bounced = true;
      } else if (ball.y >= GAME_HEIGHT - margin) {
        ball.y = GAME_HEIGHT - margin;
        ball.velocityY = -Math.abs(ball.velocityY);
        bounced = true;
      }

      if (bounced) {
        ball.bounces--;
        ball.hitEnemies.clear(); // Can hit same enemies again after bounce

        // Mastery: Kinetic Amplification - +30% damage per bounce and spawn echo
        if (this.isMastered()) {
          ball.damage *= 1.3; // +30% damage

          // Spawn echo projectile (only main balls spawn echoes, not echoes themselves)
          if (!ball.isEcho) {
            this.spawnEchoBall(ctx, ball);
          }
        }

        // Bounce flash: white expanding circle
        const bounceFlash = ctx.scene.add.circle(ball.x, ball.y, ball.ballSize, 0xffffff, 0.8);
        bounceFlash.setDepth(11);
        ctx.scene.tweens.add({
          targets: bounceFlash,
          scaleX: 3,
          scaleY: 3,
          alpha: 0,
          duration: 120,
          onComplete: () => bounceFlash.destroy(),
        });

        // Bounce visual
        ctx.effectsManager.playHitSparks(ball.x, ball.y, Math.atan2(ball.velocityY, ball.velocityX));

        if (ball.bounces <= 0) {
          toRemove.add(ball);
          continue;
        }
      }

      // Draw trail circles at previous positions using shared graphics
      if (this.trailGraphics) {
        for (let i = 0; i < ball.trailCount; i++) {
          const bufferIdx = (ball.trailIndex - ball.trailCount + i + RICOCHET_TRAIL_LENGTH) % RICOCHET_TRAIL_LENGTH;
          const trailAlpha = ((i + 1) / ball.trailCount) * 0.35;
          const trailRadius = ball.ballSize * 0.6 * ((i + 1) / ball.trailCount);
          this.trailGraphics.fillStyle(ball.ballColor, trailAlpha);
          this.trailGraphics.fillCircle(ball.trailHistory[bufferIdx].x, ball.trailHistory[bufferIdx].y, trailRadius);
        }
      }

      // Draw velocity-stretched ellipse for ball
      const currentSpeed = Math.sqrt(ball.velocityX * ball.velocityX + ball.velocityY * ball.velocityY);
      const baseSpeed = this.stats.speed;
      const stretchFactor = Math.min(1.5, currentSpeed / baseSpeed);
      const movementAngle = Math.atan2(ball.velocityY, ball.velocityX);

      ball.sprite.clear();
      ball.sprite.setPosition(ball.x, ball.y);
      ball.sprite.setRotation(movementAngle);

      // Filled stretched ellipse
      ball.sprite.fillStyle(ball.ballColor, 1);
      ball.sprite.fillEllipse(0, 0, ball.ballSize * 2 * stretchFactor, ball.ballSize * 2 / stretchFactor);

      // White stroke outline
      ball.sprite.lineStyle(2, 0xffffff, 1);
      ball.sprite.strokeEllipse(0, 0, ball.ballSize * 2 * stretchFactor, ball.ballSize * 2 / stretchFactor);

      // OPTIMIZATION: Use spatial hash for O(1) proximity lookup instead of O(n) all enemies
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
        // OPTIMIZATION: Squared distance comparison
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          ctx.damageEnemy(enemyId, ball.damage, 100);
          ball.hitEnemies.add(enemyId);
          hitsThisFrame++;

          ctx.effectsManager.playHitSparks(ball.x, ball.y, Math.atan2(ball.velocityY, ball.velocityX));
        }
      }
    }

    // OPTIMIZATION: Single filter pass with O(1) Set.has()
    if (toRemove.size > 0) {
      for (const ball of toRemove) {
        ball.sprite.destroy();
      }
      this.balls = this.balls.filter(b => !toRemove.has(b));
    }
  }

  /**
   * Mastery: Kinetic Amplification - spawn an echo projectile on bounce.
   * Echoes are 50% size, have 2 bounces max, and don't spawn more echoes.
   */
  private spawnEchoBall(ctx: WeaponContext, parentBall: RicochetBall): void {
    const echoSize = 8 * this.stats.size * 0.5; // 50% size

    // Gold/yellow color for echo projectiles - use Graphics for velocity stretch
    const sprite = ctx.scene.add.graphics();
    sprite.setDepth(9);

    // Echo fires in a slightly different direction (perpendicular-ish)
    const angleOffset = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * Math.PI / 4);
    const baseAngle = Math.atan2(parentBall.velocityY, parentBall.velocityX);
    const echoAngle = baseAngle + angleOffset;
    const echoSpeed = Math.sqrt(parentBall.velocityX ** 2 + parentBall.velocityY ** 2) * 0.8;

    this.balls.push({
      sprite,
      x: parentBall.x,
      y: parentBall.y,
      velocityX: Math.cos(echoAngle) * echoSpeed,
      velocityY: Math.sin(echoAngle) * echoSpeed,
      damage: parentBall.damage * 0.5, // 50% damage
      bounces: 2, // Max 2 bounces for echoes
      lifetime: 2.5, // Shorter lifetime
      hitEnemies: new Set(),
      isEcho: true,
      trailHistory: new Array(RICOCHET_TRAIL_LENGTH).fill(null).map(() => ({ x: 0, y: 0 })),
      trailIndex: 0,
      trailCount: 0,
      ballSize: echoSize,
      ballColor: 0xffdd44,
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 3) + this.externalBonusCount;
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 30;
  }

  public destroy(): void {
    for (const ball of this.balls) {
      ball.sprite.destroy();
    }
    this.balls = [];
    if (this.trailGraphics) {
      this.trailGraphics.destroy();
      this.trailGraphics = null;
    }
    super.destroy();
  }
}
