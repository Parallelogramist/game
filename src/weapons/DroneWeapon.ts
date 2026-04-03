import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import { PROJECTILE_ATLAS_KEY, getDroneProjectileFrame, getDroneBodyFrame } from '../visual/ProjectileAtlasRenderer';

interface Drone {
  bodySprite: Phaser.GameObjects.Image;
  orbitAngle: number;
  shootCooldown: number;
  targetId: number;
}

const PROJECTILE_POOL_SIZE = 40;

interface DroneProjectile {
  sprite: Phaser.GameObjects.Image | null;
  velocityX: number;
  velocityY: number;
  lifetime: number;
  damage: number;
  isSynchronized: boolean;
  prevX: number;
  prevY: number;
  active: boolean;
}

/**
 * DroneWeapon spawns autonomous drones that orbit and shoot at enemies.
 *
 * PERF: Drone bodies and projectiles are atlas Images (batched draw).
 * Trails, links, and thruster flames on shared Graphics objects.
 */
export class DroneWeapon extends BaseWeapon {
  private drones: Drone[] = [];
  private projectilePool: DroneProjectile[] = [];
  private orbitRadius: number = 70;
  private orbitSpeed: number = 1.5;
  private projectileTrailGraphics: Phaser.GameObjects.Graphics | null = null;
  private linkGraphics: Phaser.GameObjects.Graphics | null = null;
  private thrusterGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized: boolean = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 8,
      cooldown: 0.6,
      range: 250,
      count: 1,
      piercing: 0,
      size: 1,
      speed: 350,
      duration: 2,
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

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.projectileTrailGraphics = scene.add.graphics();
    this.projectileTrailGraphics.setDepth(DepthLayers.BLADE_HIT);
    this.linkGraphics = scene.add.graphics();
    this.linkGraphics.setDepth(DepthLayers.BLADE);
    this.thrusterGraphics = scene.add.graphics();
    this.thrusterGraphics.setDepth(DepthLayers.BLADE);

    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const sprite = scene.add.image(0, 0, PROJECTILE_ATLAS_KEY, getDroneProjectileFrame(false, 'high'));
      sprite.setDepth(7);
      sprite.setVisible(false);
      sprite.setActive(false);

      this.projectilePool.push({
        sprite,
        velocityX: 0, velocityY: 0,
        lifetime: 0, damage: 0,
        isSynchronized: false,
        prevX: 0, prevY: 0,
        active: false,
      });
    }
  }

  private acquireProjectile(ctx: WeaponContext): DroneProjectile | null {
    this.initPool(ctx.scene);
    for (const proj of this.projectilePool) {
      if (!proj.active) return proj;
    }
    for (const proj of this.projectilePool) {
      if (proj.active) {
        this.deactivateProjectile(proj);
        return proj;
      }
    }
    return null;
  }

  private deactivateProjectile(proj: DroneProjectile): void {
    proj.active = false;
    if (proj.sprite) {
      proj.sprite.setVisible(false);
      proj.sprite.setActive(false);
    }
  }

  protected attack(_ctx: WeaponContext): void {
    // Drones are continuous, handled in updateEffects
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    this.ensureDroneCount(ctx);

    // Clear shared graphics each frame
    if (this.projectileTrailGraphics) this.projectileTrailGraphics.clear();
    if (this.linkGraphics) this.linkGraphics.clear();
    if (this.thrusterGraphics) this.thrusterGraphics.clear();

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

    // Sync strike visual
    if (this.currentQuality === 'high' && this.isMastered() && this.linkGraphics) {
      for (const [targetId, count] of targetCounts) {
        if (count < 2) continue;
        const syncedDrones = this.drones.filter(d => d.targetId === targetId);
        for (let i = 0; i < syncedDrones.length - 1; i++) {
          this.linkGraphics.lineStyle(1, 0xffd700, 0.3);
          this.linkGraphics.lineBetween(
            syncedDrones[i].bodySprite.x, syncedDrones[i].bodySprite.y,
            syncedDrones[i + 1].bodySprite.x, syncedDrones[i + 1].bodySprite.y
          );
        }
        const targetEnemyX = Transform.x[targetId];
        const targetEnemyY = Transform.y[targetId];
        const reticleSize = 12 + Math.sin(ctx.gameTime * 6) * 3;
        this.linkGraphics.lineStyle(1, 0xffd700, 0.4);
        this.linkGraphics.strokeCircle(targetEnemyX, targetEnemyY, reticleSize);
      }
    }

    // Update projectiles
    this.updateProjectiles(ctx);
  }

  private ensureDroneCount(ctx: WeaponContext): void {
    while (this.drones.length < this.stats.count) {
      const angle = (this.drones.length / this.stats.count) * Math.PI * 2;
      this.drones.push(this.createDrone(ctx, angle));
    }
    while (this.drones.length > this.stats.count) {
      const drone = this.drones.pop();
      drone?.bodySprite.destroy();
    }
  }

  private createDrone(ctx: WeaponContext, startAngle: number): Drone {
    const bodySprite = ctx.scene.add.image(ctx.playerX, ctx.playerY, PROJECTILE_ATLAS_KEY, getDroneBodyFrame(ctx.visualQuality));
    bodySprite.setDepth(8);

    return {
      bodySprite,
      orbitAngle: startAngle,
      shootCooldown: 0,
      targetId: -1,
    };
  }

  private updateDrone(ctx: WeaponContext, drone: Drone, index: number, targetCounts: Map<number, number>): void {
    const baseAngle = (index / this.stats.count) * Math.PI * 2;
    drone.orbitAngle += this.orbitSpeed * ctx.deltaTime;

    const droneX = ctx.playerX + Math.cos(drone.orbitAngle + baseAngle) * this.orbitRadius;
    const droneY = ctx.playerY + Math.sin(drone.orbitAngle + baseAngle) * this.orbitRadius;

    drone.bodySprite.setPosition(droneX, droneY);

    const targetAngle = drone.targetId !== -1 ?
      Math.atan2(Transform.y[drone.targetId] - droneY, Transform.x[drone.targetId] - droneX) :
      drone.orbitAngle;
    drone.bodySprite.setRotation(targetAngle);

    // Draw thruster flames on shared thrusterGraphics (world coords)
    if (this.thrusterGraphics) {
      const droneSize = 10 * this.stats.size;
      const cosA = Math.cos(targetAngle);
      const sinA = Math.sin(targetAngle);

      if (this.currentQuality === 'low') {
        const thrusterSize = 4 + Math.sin(ctx.gameTime * 15) * 2;
        // Both thrusters offset from drone center in local space, rotated to world
        const thrusterOffsets = [
          { lx: -droneSize * 0.6, ly: -droneSize * 0.45 },
          { lx: -droneSize * 0.6, ly: droneSize * 0.45 },
        ];
        for (const offset of thrusterOffsets) {
          const wx = droneX + offset.lx * cosA - offset.ly * sinA;
          const wy = droneY + offset.lx * sinA + offset.ly * cosA;
          this.thrusterGraphics.fillStyle(0xffaa44, 0.7);
          this.thrusterGraphics.fillCircle(wx, wy, thrusterSize);
          this.thrusterGraphics.fillStyle(0x66ccff, 0.9);
          this.thrusterGraphics.fillCircle(wx, wy, thrusterSize * 0.5);
        }
      } else {
        const exhaustLength = 6 + Math.sin(ctx.gameTime * 12) * 3;
        const thrusterOffsets = [
          { lx: -droneSize * 0.6, ly: -droneSize * 0.45 },
          { lx: -droneSize * 0.6, ly: droneSize * 0.45 },
        ];
        for (const offset of thrusterOffsets) {
          const wx = droneX + offset.lx * cosA - offset.ly * sinA;
          const wy = droneY + offset.lx * sinA + offset.ly * cosA;
          this.thrusterGraphics.fillStyle(0xffaa44, 0.5);
          this.thrusterGraphics.fillCircle(wx, wy, exhaustLength * 0.4);
          this.thrusterGraphics.fillStyle(0x88ddff, 0.8);
          this.thrusterGraphics.fillCircle(wx, wy, exhaustLength * 0.2);
        }
      }
    }

    // Draw player-drone energy link on shared linkGraphics
    if (this.linkGraphics) {
      if (this.currentQuality === 'low') {
        const linkDotCount = 5;
        this.linkGraphics.fillStyle(0x44aaff, 0.1);
        for (let dotIdx = 0; dotIdx < linkDotCount; dotIdx++) {
          const interpolation = (dotIdx + 1) / (linkDotCount + 1);
          this.linkGraphics.fillCircle(
            ctx.playerX + (droneX - ctx.playerX) * interpolation,
            ctx.playerY + (droneY - ctx.playerY) * interpolation,
            1.5
          );
        }
      } else {
        const flowDotCount = this.currentQuality === 'high' ? 8 : 5;
        if (this.currentQuality === 'high') {
          this.linkGraphics.lineStyle(1, 0x44aaff, 0.05);
          this.linkGraphics.lineBetween(ctx.playerX, ctx.playerY, droneX, droneY);
        }
        this.linkGraphics.fillStyle(0x44aaff, 0.15);
        for (let dotIdx = 0; dotIdx < flowDotCount; dotIdx++) {
          const interpolation = (dotIdx / flowDotCount + ctx.gameTime * 3) % 1.0;
          this.linkGraphics.fillCircle(
            ctx.playerX + (droneX - ctx.playerX) * interpolation,
            ctx.playerY + (droneY - ctx.playerY) * interpolation,
            1.5
          );
        }
      }
    }

    // Shooting logic
    drone.shootCooldown -= ctx.deltaTime;

    if (drone.shootCooldown <= 0) {
      const spatialHash = getEnemySpatialHash();
      const nearestEnemy = spatialHash.findNearest(droneX, droneY, this.stats.range);

      if (nearestEnemy) {
        const nearestId = nearestEnemy.id;
        drone.targetId = nearestId;
        const isSynchronized = this.isMastered() && (targetCounts.get(nearestId) || 0) >= 2;
        this.fireDroneProjectile(ctx, droneX, droneY, nearestId, isSynchronized);
        drone.shootCooldown = this.stats.cooldown;
      }
    }
  }

  private fireDroneProjectile(
    ctx: WeaponContext, startX: number, startY: number,
    targetId: number, isSynchronized: boolean,
  ): void {
    const targetX = Transform.x[targetId];
    const targetY = Transform.y[targetId];
    const angle = Math.atan2(targetY - startY, targetX - startX);

    const projectileDamage = isSynchronized ? this.stats.damage * 2 : this.stats.damage;

    const proj = this.acquireProjectile(ctx);
    if (!proj) return;

    proj.velocityX = Math.cos(angle) * this.stats.speed;
    proj.velocityY = Math.sin(angle) * this.stats.speed;
    proj.lifetime = this.stats.duration;
    proj.damage = projectileDamage;
    proj.isSynchronized = isSynchronized;
    proj.prevX = startX;
    proj.prevY = startY;
    proj.active = true;

    if (proj.sprite) {
      proj.sprite.setFrame(getDroneProjectileFrame(isSynchronized, ctx.visualQuality));
      proj.sprite.setPosition(startX, startY);
      proj.sprite.setRotation(angle);
      proj.sprite.setVisible(true);
      proj.sprite.setActive(true);
    }

    // Muzzle flash
    const flashColor = isSynchronized ? 0xffd700 : 0x88ddff;
    const flashSize = 4 * this.stats.size * 2;
    const flash = ctx.scene.add.circle(startX, startY, flashSize, flashColor, 0.5);
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
    const collisionRadius = 18;
    const collisionRadiusSq = collisionRadius * collisionRadius;
    const spatialHash = getEnemySpatialHash();

    for (const proj of this.projectilePool) {
      if (!proj.active) continue;

      proj.lifetime -= ctx.deltaTime;
      if (proj.lifetime <= 0) {
        this.deactivateProjectile(proj);
        continue;
      }

      // Record previous position for trail
      if (proj.sprite) {
        proj.prevX = proj.sprite.x;
        proj.prevY = proj.sprite.y;
        proj.sprite.x += proj.velocityX * ctx.deltaTime;
        proj.sprite.y += proj.velocityY * ctx.deltaTime;

        // Draw trail on shared graphics
        if (this.projectileTrailGraphics) {
          const trailColor = proj.isSynchronized ? 0xffd700 : 0x4488ff;
          if (this.currentQuality === 'high') {
            this.projectileTrailGraphics.lineStyle(4, trailColor, 0.2);
            this.projectileTrailGraphics.lineBetween(proj.prevX, proj.prevY, proj.sprite.x, proj.sprite.y);
            this.projectileTrailGraphics.lineStyle(1, 0xffffff, 0.5);
            this.projectileTrailGraphics.lineBetween(proj.prevX, proj.prevY, proj.sprite.x, proj.sprite.y);
          } else {
            this.projectileTrailGraphics.lineStyle(2, trailColor, 0.4);
            this.projectileTrailGraphics.lineBetween(proj.prevX, proj.prevY, proj.sprite.x, proj.sprite.y);
          }
        }

        // Bounds check
        if (proj.sprite.x < -50 || proj.sprite.x > ctx.scene.scale.width + 50 ||
            proj.sprite.y < -50 || proj.sprite.y > ctx.scene.scale.height + 50) {
          this.deactivateProjectile(proj);
          continue;
        }

        // Collision check
        const nearbyEnemies = spatialHash.queryPotential(proj.sprite.x, proj.sprite.y, collisionRadius + 5);

        for (const enemy of nearbyEnemies) {
          const ex = Transform.x[enemy.id];
          const ey = Transform.y[enemy.id];
          const dx = ex - proj.sprite.x;
          const dy = ey - proj.sprite.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < collisionRadiusSq) {
            ctx.damageEnemy(enemy.id, proj.damage, 80);
            ctx.effectsManager.playHitSparks(proj.sprite.x, proj.sprite.y,
              Math.atan2(proj.velocityY, proj.velocityX));
            this.deactivateProjectile(proj);
            break;
          }
        }
      }
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
      drone.bodySprite.destroy();
    }
    for (const proj of this.projectilePool) {
      if (proj.sprite) {
        proj.sprite.destroy();
        proj.sprite = null;
      }
    }
    this.drones = [];
    this.projectilePool = [];
    this.poolInitialized = false;
    if (this.projectileTrailGraphics) {
      this.projectileTrailGraphics.destroy();
      this.projectileTrailGraphics = null;
    }
    if (this.linkGraphics) {
      this.linkGraphics.destroy();
      this.linkGraphics = null;
    }
    if (this.thrusterGraphics) {
      this.thrusterGraphics.destroy();
      this.thrusterGraphics = null;
    }
    super.destroy();
  }
}
