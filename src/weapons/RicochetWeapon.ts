import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { GAME_WIDTH, GAME_HEIGHT } from '../GameConfig';
import { getEnemySpatialHash } from '../utils/SpatialHash';

interface RicochetBall {
  sprite: Phaser.GameObjects.Arc;
  trail: Phaser.GameObjects.Arc;
  velocityX: number;
  velocityY: number;
  damage: number;
  bounces: number;
  lifetime: number;
  hitEnemies: Set<number>;
  isEcho?: boolean; // Mastery: Kinetic Amplification - echo projectiles don't spawn more echoes
}

/**
 * RicochetWeapon fires bouncing projectiles that reflect off screen edges.
 * Great for enclosed areas and hitting enemies from unexpected angles.
 */
export class RicochetWeapon extends BaseWeapon {
  private balls: RicochetBall[] = [];

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
    const size = 8 * this.stats.size;

    const sprite = ctx.scene.add.circle(ctx.playerX, ctx.playerY, size, 0x4488ff); // Blue
    sprite.setStrokeStyle(2, 0xffffff); // White outline
    sprite.setDepth(10);

    // Add trail effect
    const trail = ctx.scene.add.circle(ctx.playerX, ctx.playerY, size * 0.7, 0x66aaff, 0.3); // Blue trail
    trail.setDepth(9);

    this.balls.push({
      sprite,
      trail,
      velocityX: Math.cos(angle) * this.stats.speed,
      velocityY: Math.sin(angle) * this.stats.speed,
      damage: this.stats.damage,
      bounces: 3 + Math.floor(this.level / 2), // More bounces at higher levels
      lifetime: this.stats.duration,
      hitEnemies: new Set(),
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    // OPTIMIZATION: Use Set for O(1) removal checks
    const toRemove = new Set<RicochetBall>();
    // OPTIMIZATION: Get spatial hash once per frame
    const spatialHash = getEnemySpatialHash();

    for (const ball of this.balls) {
      // Update lifetime
      ball.lifetime -= ctx.deltaTime;
      if (ball.lifetime <= 0) {
        toRemove.add(ball);
        continue;
      }

      // Move ball
      ball.sprite.x += ball.velocityX * ctx.deltaTime;
      ball.sprite.y += ball.velocityY * ctx.deltaTime;

      // Update trail position to follow ball
      ball.trail.x = ball.sprite.x;
      ball.trail.y = ball.sprite.y;

      // Check wall bounces
      const margin = 10;
      let bounced = false;

      if (ball.sprite.x <= margin) {
        ball.sprite.x = margin;
        ball.velocityX = Math.abs(ball.velocityX);
        bounced = true;
      } else if (ball.sprite.x >= GAME_WIDTH - margin) {
        ball.sprite.x = GAME_WIDTH - margin;
        ball.velocityX = -Math.abs(ball.velocityX);
        bounced = true;
      }

      if (ball.sprite.y <= margin) {
        ball.sprite.y = margin;
        ball.velocityY = Math.abs(ball.velocityY);
        bounced = true;
      } else if (ball.sprite.y >= GAME_HEIGHT - margin) {
        ball.sprite.y = GAME_HEIGHT - margin;
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

        // Bounce visual
        ctx.effectsManager.playHitSparks(ball.sprite.x, ball.sprite.y, Math.atan2(ball.velocityY, ball.velocityX));

        if (ball.bounces <= 0) {
          toRemove.add(ball);
          continue;
        }
      }

      // OPTIMIZATION: Use spatial hash for O(1) proximity lookup instead of O(n) all enemies
      const collisionRadius = 20;
      const collisionRadiusSq = collisionRadius * collisionRadius;
      const nearbyEnemies = spatialHash.queryPotential(ball.sprite.x, ball.sprite.y, collisionRadius + 5);
      let hitsThisFrame = 0;

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;
        if (ball.hitEnemies.has(enemyId)) continue;
        if (hitsThisFrame >= this.stats.piercing) break;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - ball.sprite.x;
        const dy = ey - ball.sprite.y;
        // OPTIMIZATION: Squared distance comparison
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          ctx.damageEnemy(enemyId, ball.damage, 100);
          ball.hitEnemies.add(enemyId);
          hitsThisFrame++;

          ctx.effectsManager.playHitSparks(ball.sprite.x, ball.sprite.y, Math.atan2(ball.velocityY, ball.velocityX));
        }
      }
    }

    // OPTIMIZATION: Single filter pass with O(1) Set.has()
    if (toRemove.size > 0) {
      for (const ball of toRemove) {
        ball.sprite.destroy();
        ball.trail.destroy();
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

    // Gold/yellow color for echo projectiles
    const sprite = ctx.scene.add.circle(
      parentBall.sprite.x,
      parentBall.sprite.y,
      echoSize,
      0xffdd44  // Gold
    );
    sprite.setStrokeStyle(2, 0xffffff);
    sprite.setDepth(9);

    // Smaller trail for echo
    const trail = ctx.scene.add.circle(
      parentBall.sprite.x,
      parentBall.sprite.y,
      echoSize * 0.7,
      0xffee88,  // Light gold
      0.3
    );
    trail.setDepth(8);

    // Echo fires in a slightly different direction (perpendicular-ish)
    const angleOffset = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * Math.PI / 4);
    const baseAngle = Math.atan2(parentBall.velocityY, parentBall.velocityX);
    const echoAngle = baseAngle + angleOffset;
    const echoSpeed = Math.sqrt(parentBall.velocityX ** 2 + parentBall.velocityY ** 2) * 0.8;

    this.balls.push({
      sprite,
      trail,
      velocityX: Math.cos(echoAngle) * echoSpeed,
      velocityY: Math.sin(echoAngle) * echoSpeed,
      damage: parentBall.damage * 0.5, // 50% damage
      bounces: 2, // Max 2 bounces for echoes
      lifetime: 2.5, // Shorter lifetime
      hitEnemies: new Set(),
      isEcho: true,
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
      ball.trail.destroy();
    }
    this.balls = [];
    super.destroy();
  }
}
