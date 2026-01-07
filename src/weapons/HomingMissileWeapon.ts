import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { getEnemyIds } from '../ecs/FrameCache';

interface Missile {
  sprite: Phaser.GameObjects.Container;
  targetId: number;
  damage: number;
  speed: number;
  lifetime: number;
  isBomblet?: boolean; // Mastery: Cluster Ordnance - true for split projectiles
}

/**
 * HomingMissileWeapon fires slow missiles that track enemies.
 * High damage, slow rate - great for picking off tough enemies.
 */
export class HomingMissileWeapon extends BaseWeapon {
  private missiles: Missile[] = [];

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

  protected attack(ctx: WeaponContext): void {
    const enemies = getEnemyIds();
    if (enemies.length === 0) return;

    // Fire missiles at random enemies
    for (let i = 0; i < this.stats.count; i++) {
      const targetIndex = Math.floor(Math.random() * enemies.length);
      const targetId = enemies[targetIndex];

      this.createMissile(ctx, targetId);
    }
  }

  private createMissile(ctx: WeaponContext, targetId: number): void {
    const container = ctx.scene.add.container(ctx.playerX, ctx.playerY);
    container.setDepth(10);

    // Missile body - blue
    const body = ctx.scene.add.graphics();
    const size = 8 * this.stats.size;

    body.fillStyle(0x4488ff, 1); // Blue body
    body.fillRect(-size, -size / 2, size * 2, size);
    body.fillStyle(0x2266dd, 1); // Dark blue nose
    body.fillTriangle(-size, -size / 2, -size, size / 2, -size * 1.5, 0);

    // Exhaust - blue glow
    const exhaust = ctx.scene.add.graphics();
    exhaust.fillStyle(0x66ccff, 0.8); // Light blue
    exhaust.fillCircle(-size * 1.5, 0, size / 2);
    exhaust.fillStyle(0x4488ff, 0.5); // Blue core
    exhaust.fillCircle(-size * 2, 0, size / 3);

    container.add([exhaust, body]);

    this.missiles.push({
      sprite: container,
      targetId,
      damage: this.stats.damage,
      speed: this.stats.speed,
      lifetime: this.stats.duration,
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    const toRemove: Missile[] = [];

    for (const missile of this.missiles) {
      missile.lifetime -= ctx.deltaTime;
      if (missile.lifetime <= 0) {
        toRemove.push(missile);
        continue;
      }

      // Check if target still exists
      const targetHealth = Health.current[missile.targetId];
      if (targetHealth === undefined || targetHealth <= 0) {
        // Find new target using cached enemy list
        const enemies = getEnemyIds();
        if (enemies.length > 0) {
          missile.targetId = enemies[Math.floor(Math.random() * enemies.length)];
        } else {
          toRemove.push(missile);
          continue;
        }
      }

      const targetX = Transform.x[missile.targetId];
      const targetY = Transform.y[missile.targetId];
      const mx = missile.sprite.x;
      const my = missile.sprite.y;

      const dx = targetX - mx;
      const dy = targetY - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      // Hit detection
      if (dist < 20) {
        ctx.damageEnemy(missile.targetId, missile.damage, 150);
        ctx.effectsManager.playHitSparks(mx, my, angle);

        // Mastery: Cluster Ordnance - spawn 4 bomblets on impact (if not already a bomblet)
        if (this.isMastered() && !missile.isBomblet) {
          this.spawnClusterBomblets(ctx, mx, my, missile.targetId);
        }

        // Explosion effect - blue (golden for mastery bomblets)
        const explosionColor = missile.isBomblet ? 0xffaa44 : 0x66aaff;
        const explosion = ctx.scene.add.circle(mx, my, missile.isBomblet ? 12 : 20, explosionColor, 0.6);
        ctx.scene.tweens.add({
          targets: explosion,
          scaleX: 2,
          scaleY: 2,
          alpha: 0,
          duration: 200,
          onComplete: () => explosion.destroy(),
        });

        toRemove.push(missile);
        continue;
      }

      // Move toward target with homing
      missile.sprite.setRotation(angle);

      missile.sprite.x += (dx / dist) * missile.speed * ctx.deltaTime;
      missile.sprite.y += (dy / dist) * missile.speed * ctx.deltaTime;
    }

    // Clean up
    for (const missile of toRemove) {
      const index = this.missiles.indexOf(missile);
      if (index !== -1) this.missiles.splice(index, 1);
      missile.sprite.destroy();
    }
  }

  /**
   * Mastery: Cluster Ordnance - spawn 4 smaller homing bomblets on missile impact.
   */
  private spawnClusterBomblets(
    ctx: WeaponContext,
    x: number,
    y: number,
    excludeTargetId: number
  ): void {
    // Use spatial hash to find nearby enemies for bomblet targeting
    const spatialHash = getEnemySpatialHash();
    const nearbyEnemies = spatialHash.query(x, y, 200); // Look for enemies within 200px

    const bombletCount = 4;
    const bombletDamage = this.stats.damage * 0.3; // 30% damage each
    const bombletSpeed = this.stats.speed * 1.2;   // Faster than main missile
    const bombletLifetime = 1.5;                   // Shorter lifetime

    // Find targets (prefer different enemies than the one hit)
    const potentialTargets = nearbyEnemies.filter(e => e.id !== excludeTargetId && Health.current[e.id] > 0);

    for (let i = 0; i < bombletCount; i++) {
      // Spread angle for initial direction
      const spreadAngle = (i / bombletCount) * Math.PI * 2 + Math.random() * 0.5;

      // Pick a target
      let targetId: number;
      if (potentialTargets.length > 0) {
        targetId = potentialTargets[Math.floor(Math.random() * potentialTargets.length)].id;
      } else if (nearbyEnemies.length > 0) {
        targetId = nearbyEnemies[Math.floor(Math.random() * nearbyEnemies.length)].id;
      } else {
        // Fall back to cached enemy list if no nearby enemies
        const allEnemies = getEnemyIds();
        if (allEnemies.length > 0) {
          targetId = allEnemies[Math.floor(Math.random() * allEnemies.length)];
        } else {
          continue; // No targets available
        }
      }

      // Create bomblet (smaller missile)
      this.createBomblet(ctx, x, y, targetId, spreadAngle, bombletDamage, bombletSpeed, bombletLifetime);
    }
  }

  /**
   * Create a smaller bomblet missile for Cluster Ordnance mastery.
   */
  private createBomblet(
    ctx: WeaponContext,
    x: number,
    y: number,
    targetId: number,
    initialAngle: number,
    damage: number,
    speed: number,
    lifetime: number
  ): void {
    const container = ctx.scene.add.container(x, y);
    container.setDepth(10);

    // Smaller missile body - orange/gold tint for bomblets
    const body = ctx.scene.add.graphics();
    const size = 5 * this.stats.size;

    body.fillStyle(0xffaa44, 1); // Orange body
    body.fillRect(-size, -size / 2, size * 2, size);
    body.fillStyle(0xff6622, 1); // Dark orange nose
    body.fillTriangle(-size, -size / 2, -size, size / 2, -size * 1.2, 0);

    // Small exhaust
    const exhaust = ctx.scene.add.graphics();
    exhaust.fillStyle(0xffcc66, 0.8);
    exhaust.fillCircle(-size * 1.2, 0, size / 3);

    container.add([exhaust, body]);
    container.setRotation(initialAngle);

    // Push away from impact point initially
    const pushDist = 20;
    container.x += Math.cos(initialAngle) * pushDist;
    container.y += Math.sin(initialAngle) * pushDist;

    this.missiles.push({
      sprite: container,
      targetId,
      damage,
      speed,
      lifetime,
      isBomblet: true,
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 20;
  }

  public destroy(): void {
    for (const missile of this.missiles) {
      missile.sprite.destroy();
    }
    this.missiles = [];
    super.destroy();
  }
}
