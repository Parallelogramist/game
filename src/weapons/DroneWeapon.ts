import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';

interface Drone {
  container: Phaser.GameObjects.Container;
  orbitAngle: number;
  shootCooldown: number;
  targetId: number;
}

interface DroneProjectile {
  sprite: Phaser.GameObjects.Arc;
  velocityX: number;
  velocityY: number;
  lifetime: number;
  damage: number;
  isSynchronized?: boolean; // Mastery: Combat Network - synchronized strike bonus
}

/**
 * DroneWeapon spawns autonomous drones that orbit and shoot at enemies.
 * Great for sustained supplementary damage.
 */
export class DroneWeapon extends BaseWeapon {
  private drones: Drone[] = [];
  private projectiles: DroneProjectile[] = [];
  private orbitRadius: number = 70;
  private orbitSpeed: number = 1.5;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 8,
      cooldown: 0.6,       // Drone fire rate
      range: 250,          // Drone targeting range
      count: 1,            // Number of drones
      piercing: 0,
      size: 1,
      speed: 350,          // Projectile speed
      duration: 2,         // Projectile lifetime
    };

    super(
      'drone',
      'Combat Drone',
      'drone',
      'Autonomous shooting helper',
      10,
      baseStats,
      'Combat Network',
      'Drones targeting same enemy fire Synchronized Strikes (+100% damage)'
    );
  }

  protected attack(_ctx: WeaponContext): void {
    // Drones are continuous, handled in updateEffects
  }

  protected updateEffects(ctx: WeaponContext): void {
    // Ensure correct drone count
    this.ensureDroneCount(ctx);

    // Mastery: Combat Network - check for drones targeting same enemy
    const targetCounts = new Map<number, number>();
    if (this.isMastered()) {
      for (const drone of this.drones) {
        if (drone.targetId !== -1) {
          targetCounts.set(drone.targetId, (targetCounts.get(drone.targetId) || 0) + 1);
        }
      }
    }

    // Update drones
    for (let i = 0; i < this.drones.length; i++) {
      this.updateDrone(ctx, this.drones[i], i, targetCounts);
    }

    // Update projectiles
    this.updateProjectiles(ctx);
  }

  private ensureDroneCount(ctx: WeaponContext): void {
    // Add drones if needed
    while (this.drones.length < this.stats.count) {
      const angle = (this.drones.length / this.stats.count) * Math.PI * 2;
      this.drones.push(this.createDrone(ctx, angle));
    }

    // Remove excess drones
    while (this.drones.length > this.stats.count) {
      const drone = this.drones.pop();
      drone?.container.destroy();
    }
  }

  private createDrone(ctx: WeaponContext, startAngle: number): Drone {
    const container = ctx.scene.add.container(ctx.playerX, ctx.playerY);
    container.setDepth(8);

    // Drone body
    const body = ctx.scene.add.graphics();
    const size = 10 * this.stats.size;

    // Main body
    body.fillStyle(0x44aaff, 1);
    body.fillEllipse(0, 0, size * 2, size);

    // Cockpit
    body.fillStyle(0x88ddff, 1);
    body.fillCircle(0, 0, size * 0.4);

    // Thrusters
    body.fillStyle(0x2288dd, 1);
    body.fillRect(-size * 0.8, size * 0.3, size * 0.4, size * 0.3);
    body.fillRect(size * 0.4, size * 0.3, size * 0.4, size * 0.3);

    container.add(body);

    return {
      container,
      orbitAngle: startAngle,
      shootCooldown: 0,
      targetId: -1,
    };
  }

  private updateDrone(ctx: WeaponContext, drone: Drone, index: number, targetCounts: Map<number, number>): void {
    // Update orbit
    const baseAngle = (index / this.stats.count) * Math.PI * 2;
    drone.orbitAngle += this.orbitSpeed * ctx.deltaTime;

    const x = ctx.playerX + Math.cos(drone.orbitAngle + baseAngle) * this.orbitRadius;
    const y = ctx.playerY + Math.sin(drone.orbitAngle + baseAngle) * this.orbitRadius;

    drone.container.setPosition(x, y);

    // Point toward target or movement direction
    const targetAngle = drone.targetId !== -1 ?
      Math.atan2(Transform.y[drone.targetId] - y, Transform.x[drone.targetId] - x) :
      drone.orbitAngle;
    drone.container.setRotation(targetAngle);

    // Shooting logic
    drone.shootCooldown -= ctx.deltaTime;

    if (drone.shootCooldown <= 0) {
      // Find nearest target using spatial hash
      const spatialHash = getEnemySpatialHash();
      const nearestEnemy = spatialHash.findNearest(x, y, this.stats.range);

      if (nearestEnemy) {
        const nearestId = nearestEnemy.id;
        drone.targetId = nearestId;

        // Mastery: Combat Network - synchronized strike bonus when 2+ drones target same enemy
        const isSynchronized = this.isMastered() && (targetCounts.get(nearestId) || 0) >= 2;

        this.fireDroneProjectile(ctx, x, y, nearestId, isSynchronized);
        drone.shootCooldown = this.stats.cooldown;
      }
    }
  }

  private fireDroneProjectile(
    ctx: WeaponContext,
    startX: number,
    startY: number,
    targetId: number,
    isSynchronized: boolean = false
  ): void {
    const targetX = Transform.x[targetId];
    const targetY = Transform.y[targetId];
    const angle = Math.atan2(targetY - startY, targetX - startX);

    const size = 4 * this.stats.size;
    // Gold color for synchronized strikes
    const projectileColor = isSynchronized ? 0xffd700 : 0x4488ff;
    const sprite = ctx.scene.add.circle(startX, startY, isSynchronized ? size * 1.3 : size, projectileColor);
    sprite.setStrokeStyle(2, 0xffffff); // White outline
    sprite.setDepth(7);

    // Combat Network: +100% damage for synchronized strikes
    const projectileDamage = isSynchronized ? this.stats.damage * 2 : this.stats.damage;

    this.projectiles.push({
      sprite,
      velocityX: Math.cos(angle) * this.stats.speed,
      velocityY: Math.sin(angle) * this.stats.speed,
      lifetime: this.stats.duration,
      damage: projectileDamage,
      isSynchronized,
    });

    // Muzzle flash (gold for synchronized)
    const flashColor = isSynchronized ? 0xffd700 : 0x88ddff;
    const flash = ctx.scene.add.circle(startX, startY, size * 2, flashColor, 0.5);
    ctx.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: isSynchronized ? 3 : 2,
      scaleY: isSynchronized ? 3 : 2,
      duration: 100,
      onComplete: () => flash.destroy(),
    });
  }

  private updateProjectiles(ctx: WeaponContext): void {
    // OPTIMIZATION: Use Set for O(1) removal checks instead of indexOf O(n)
    const toRemove = new Set<DroneProjectile>();
    // OPTIMIZATION: Pre-compute squared collision radius to avoid sqrt
    const collisionRadius = 18;
    const collisionRadiusSq = collisionRadius * collisionRadius;

    for (const proj of this.projectiles) {
      proj.lifetime -= ctx.deltaTime;
      if (proj.lifetime <= 0) {
        toRemove.add(proj);
        continue;
      }

      proj.sprite.x += proj.velocityX * ctx.deltaTime;
      proj.sprite.y += proj.velocityY * ctx.deltaTime;

      // Bounds check
      if (proj.sprite.x < -50 || proj.sprite.x > 1330 ||
          proj.sprite.y < -50 || proj.sprite.y > 770) {
        toRemove.add(proj);
        continue;
      }

      // Collision check using spatial hash
      const spatialHash = getEnemySpatialHash();
      const nearbyEnemies = spatialHash.queryPotential(proj.sprite.x, proj.sprite.y, collisionRadius + 5);

      for (const enemy of nearbyEnemies) {
        const ex = Transform.x[enemy.id];
        const ey = Transform.y[enemy.id];
        const dx = ex - proj.sprite.x;
        const dy = ey - proj.sprite.y;
        // OPTIMIZATION: Squared distance comparison avoids sqrt
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          ctx.damageEnemy(enemy.id, proj.damage, 80);
          ctx.effectsManager.playHitSparks(proj.sprite.x, proj.sprite.y,
            Math.atan2(proj.velocityY, proj.velocityX));
          toRemove.add(proj);
          break;
        }
      }
    }

    // OPTIMIZATION: Single filter pass with O(1) Set.has() instead of O(n) indexOf + splice
    if (toRemove.size > 0) {
      for (const proj of toRemove) {
        proj.sprite.destroy();
      }
      this.projectiles = this.projectiles.filter(p => !toRemove.has(p));
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.cooldown = Math.max(0.25, this.baseStats.cooldown - (this.level - 1) * 0.05);
    this.orbitRadius = 70 + (this.level - 1) * 10;
  }

  public destroy(): void {
    for (const drone of this.drones) {
      drone.container.destroy();
    }
    for (const proj of this.projectiles) {
      proj.sprite.destroy();
    }
    this.drones = [];
    this.projectiles = [];
    super.destroy();
  }
}
