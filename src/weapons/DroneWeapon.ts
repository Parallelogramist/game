import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

interface Drone {
  container: Phaser.GameObjects.Container;
  thrusterGraphics: Phaser.GameObjects.Graphics;
  orbitAngle: number;
  shootCooldown: number;
  targetId: number;
}

interface DroneProjectile {
  sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Graphics;
  velocityX: number;
  velocityY: number;
  lifetime: number;
  damage: number;
  isSynchronized?: boolean; // Mastery: Combat Network - synchronized strike bonus
  prevX: number;
  prevY: number;
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
  private projectileTrailGraphics: Phaser.GameObjects.Graphics | null = null;
  private linkGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';

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
    // Update quality setting from context
    this.currentQuality = ctx.visualQuality;

    // Ensure correct drone count
    this.ensureDroneCount(ctx);

    // Ensure shared graphics objects exist
    if (!this.projectileTrailGraphics && ctx.scene) {
      this.projectileTrailGraphics = ctx.scene.add.graphics();
      this.projectileTrailGraphics.setDepth(DepthLayers.BLADE_HIT);
    }
    if (!this.linkGraphics && ctx.scene) {
      this.linkGraphics = ctx.scene.add.graphics();
      this.linkGraphics.setDepth(DepthLayers.BLADE);
    }

    // Clear shared graphics each frame
    if (this.projectileTrailGraphics) this.projectileTrailGraphics.clear();
    if (this.linkGraphics) this.linkGraphics.clear();

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

    // Sync strike visual: gold connections between synchronized drones + reticle on target
    if (this.currentQuality === 'high' && this.isMastered() && this.linkGraphics) {
      for (const [targetId, count] of targetCounts) {
        if (count < 2) continue;
        const syncedDrones = this.drones.filter(d => d.targetId === targetId);
        // Draw lines between synced drones
        for (let i = 0; i < syncedDrones.length - 1; i++) {
          this.linkGraphics.lineStyle(1, 0xffd700, 0.3);
          this.linkGraphics.lineBetween(
            syncedDrones[i].container.x, syncedDrones[i].container.y,
            syncedDrones[i + 1].container.x, syncedDrones[i + 1].container.y
          );
        }
        // Gold reticle on target
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
    const bodyGraphics = ctx.scene.add.graphics();
    const size = 10 * this.stats.size;

    if (this.currentQuality === 'low') {
      // Current ellipse body
      bodyGraphics.fillStyle(0x44aaff, 1);
      bodyGraphics.fillEllipse(0, 0, size * 2, size);
      bodyGraphics.fillStyle(0x88ddff, 1);
      bodyGraphics.fillCircle(0, 0, size * 0.4);
    } else {
      // Angular hull: 6-vertex polygon
      bodyGraphics.fillStyle(0x44aaff, 1);
      bodyGraphics.beginPath();
      bodyGraphics.moveTo(size * 1.2, 0);            // nose
      bodyGraphics.lineTo(size * 0.4, -size * 0.6);  // upper forward
      bodyGraphics.lineTo(-size * 0.8, -size * 0.5); // upper rear
      bodyGraphics.lineTo(-size * 1.0, 0);            // tail
      bodyGraphics.lineTo(-size * 0.8, size * 0.5);   // lower rear
      bodyGraphics.lineTo(size * 0.4, size * 0.6);    // lower forward
      bodyGraphics.closePath();
      bodyGraphics.fillPath();

      // Trapezoidal cockpit
      bodyGraphics.fillStyle(0x88ddff, 1);
      bodyGraphics.beginPath();
      bodyGraphics.moveTo(size * 0.6, -size * 0.25);
      bodyGraphics.lineTo(size * 0.1, -size * 0.35);
      bodyGraphics.lineTo(size * 0.1, size * 0.35);
      bodyGraphics.lineTo(size * 0.6, size * 0.25);
      bodyGraphics.closePath();
      bodyGraphics.fillPath();

      if (this.currentQuality === 'high') {
        // Hull panel lines
        bodyGraphics.lineStyle(1, 0x2288dd, 0.3);
        bodyGraphics.lineBetween(-size * 0.3, -size * 0.45, -size * 0.3, size * 0.45);
        bodyGraphics.lineBetween(size * 0.1, -size * 0.5, -size * 0.8, -size * 0.3);
        bodyGraphics.lineBetween(size * 0.1, size * 0.5, -size * 0.8, size * 0.3);

        // Wing nubs
        bodyGraphics.fillStyle(0x3399dd, 1);
        bodyGraphics.fillTriangle(0, -size * 0.6, -size * 0.4, -size * 0.5, -size * 0.2, -size * 0.8);
        bodyGraphics.fillTriangle(0, size * 0.6, -size * 0.4, size * 0.5, -size * 0.2, size * 0.8);
      }
    }

    // Thrusters (static mounting points)
    bodyGraphics.fillStyle(0x2288dd, 1);
    bodyGraphics.fillRect(-size * 0.8, size * 0.3, size * 0.4, size * 0.3);
    bodyGraphics.fillRect(-size * 0.8, -size * 0.6, size * 0.4, size * 0.3);

    // Animated thruster flames (separate graphics for per-frame redraw)
    const thrusterGraphics = ctx.scene.add.graphics();

    container.add([bodyGraphics, thrusterGraphics]);

    return {
      container,
      thrusterGraphics,
      orbitAngle: startAngle,
      shootCooldown: 0,
      targetId: -1,
    };
  }

  private updateDrone(ctx: WeaponContext, drone: Drone, index: number, targetCounts: Map<number, number>): void {
    // Update orbit
    const baseAngle = (index / this.stats.count) * Math.PI * 2;
    drone.orbitAngle += this.orbitSpeed * ctx.deltaTime;

    const droneX = ctx.playerX + Math.cos(drone.orbitAngle + baseAngle) * this.orbitRadius;
    const droneY = ctx.playerY + Math.sin(drone.orbitAngle + baseAngle) * this.orbitRadius;

    drone.container.setPosition(droneX, droneY);

    // Point toward target or movement direction
    const targetAngle = drone.targetId !== -1 ?
      Math.atan2(Transform.y[drone.targetId] - droneY, Transform.x[drone.targetId] - droneX) :
      drone.orbitAngle;
    drone.container.setRotation(targetAngle);

    // Animate thruster flames
    const droneSize = 10 * this.stats.size;
    drone.thrusterGraphics.clear();

    if (this.currentQuality === 'low') {
      // Low: oscillating flame circles
      const thrusterSize = 4 + Math.sin(ctx.gameTime * 15) * 2;
      // Left thruster flame (orange outer, blue inner)
      drone.thrusterGraphics.fillStyle(0xffaa44, 0.7);
      drone.thrusterGraphics.fillCircle(-droneSize * 0.6, -droneSize * 0.45, thrusterSize);
      drone.thrusterGraphics.fillStyle(0x66ccff, 0.9);
      drone.thrusterGraphics.fillCircle(-droneSize * 0.6, -droneSize * 0.45, thrusterSize * 0.5);
      // Right thruster flame
      drone.thrusterGraphics.fillStyle(0xffaa44, 0.7);
      drone.thrusterGraphics.fillCircle(-droneSize * 0.6, droneSize * 0.45, thrusterSize);
      drone.thrusterGraphics.fillStyle(0x66ccff, 0.9);
      drone.thrusterGraphics.fillCircle(-droneSize * 0.6, droneSize * 0.45, thrusterSize * 0.5);
    } else {
      // Medium/High: exhaust ellipses with flickering length
      const exhaustLength = 6 + Math.sin(ctx.gameTime * 12) * 3;
      // Left thruster
      drone.thrusterGraphics.fillStyle(0xffaa44, 0.5);
      drone.thrusterGraphics.fillEllipse(-droneSize * 0.6, -droneSize * 0.45, exhaustLength, droneSize * 0.35);
      drone.thrusterGraphics.fillStyle(0x88ddff, 0.8);
      drone.thrusterGraphics.fillEllipse(-droneSize * 0.6, -droneSize * 0.45, exhaustLength * 0.5, droneSize * 0.15);
      // Right thruster
      drone.thrusterGraphics.fillStyle(0xffaa44, 0.5);
      drone.thrusterGraphics.fillEllipse(-droneSize * 0.6, droneSize * 0.45, exhaustLength, droneSize * 0.35);
      drone.thrusterGraphics.fillStyle(0x88ddff, 0.8);
      drone.thrusterGraphics.fillEllipse(-droneSize * 0.6, droneSize * 0.45, exhaustLength * 0.5, droneSize * 0.15);

      if (this.currentQuality === 'high') {
        // Hot center points
        drone.thrusterGraphics.fillStyle(0xffffff, 0.9);
        drone.thrusterGraphics.fillCircle(-droneSize * 0.5, -droneSize * 0.45, 1.5);
        drone.thrusterGraphics.fillCircle(-droneSize * 0.5, droneSize * 0.45, 1.5);
      }
    }

    // Draw player-drone energy link on shared linkGraphics
    if (this.linkGraphics) {
      if (this.currentQuality === 'low') {
        // Low: 5 static faint dots
        const linkDotCount = 5;
        this.linkGraphics.fillStyle(0x44aaff, 0.1);
        for (let dotIdx = 0; dotIdx < linkDotCount; dotIdx++) {
          const interpolation = (dotIdx + 1) / (linkDotCount + 1);
          const linkDotX = ctx.playerX + (droneX - ctx.playerX) * interpolation;
          const linkDotY = ctx.playerY + (droneY - ctx.playerY) * interpolation;
          this.linkGraphics.fillCircle(linkDotX, linkDotY, 1.5);
        }
      } else {
        // Medium/High: flowing dots cycling from player to drone
        const flowDotCount = this.currentQuality === 'high' ? 8 : 5;

        // Faint connecting line (high only)
        if (this.currentQuality === 'high') {
          this.linkGraphics.lineStyle(1, 0x44aaff, 0.05);
          this.linkGraphics.lineBetween(ctx.playerX, ctx.playerY, droneX, droneY);
        }

        this.linkGraphics.fillStyle(0x44aaff, 0.15);
        for (let dotIdx = 0; dotIdx < flowDotCount; dotIdx++) {
          const interpolation = (dotIdx / flowDotCount + ctx.gameTime * 3) % 1.0;
          const linkDotX = ctx.playerX + (droneX - ctx.playerX) * interpolation;
          const linkDotY = ctx.playerY + (droneY - ctx.playerY) * interpolation;
          this.linkGraphics.fillCircle(linkDotX, linkDotY, 1.5);
        }
      }
    }

    // Shooting logic
    drone.shootCooldown -= ctx.deltaTime;

    if (drone.shootCooldown <= 0) {
      // Find nearest target using spatial hash
      const spatialHash = getEnemySpatialHash();
      const nearestEnemy = spatialHash.findNearest(droneX, droneY, this.stats.range);

      if (nearestEnemy) {
        const nearestId = nearestEnemy.id;
        drone.targetId = nearestId;

        // Mastery: Combat Network - synchronized strike bonus when 2+ drones target same enemy
        const isSynchronized = this.isMastered() && (targetCounts.get(nearestId) || 0) >= 2;

        this.fireDroneProjectile(ctx, droneX, droneY, nearestId, isSynchronized);
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

    // Combat Network: +100% damage for synchronized strikes
    const projectileDamage = isSynchronized ? this.stats.damage * 2 : this.stats.damage;

    let projectileSprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Graphics;

    if (this.currentQuality === 'low') {
      // Low: simple circle
      const circleSprite = ctx.scene.add.circle(startX, startY, isSynchronized ? size * 1.3 : size, projectileColor);
      circleSprite.setStrokeStyle(2, 0xffffff);
      circleSprite.setDepth(7);
      projectileSprite = circleSprite;
    } else {
      // Medium/High: diamond shaped projectile
      const projGraphics = ctx.scene.add.graphics();
      projGraphics.setPosition(startX, startY);
      projGraphics.setDepth(7);

      const projSize = isSynchronized ? size * 1.3 : size;
      projGraphics.fillStyle(projectileColor, 1);
      projGraphics.beginPath();
      projGraphics.moveTo(projSize * 1.5, 0);     // front
      projGraphics.lineTo(0, -projSize * 0.8);     // top
      projGraphics.lineTo(-projSize, 0);            // back
      projGraphics.lineTo(0, projSize * 0.8);       // bottom
      projGraphics.closePath();
      projGraphics.fillPath();
      projGraphics.lineStyle(1, 0xffffff, 0.8);
      projGraphics.lineBetween(-projSize * 0.5, 0, projSize * 1.0, 0); // center line

      projGraphics.setRotation(angle);
      projectileSprite = projGraphics;
    }

    this.projectiles.push({
      sprite: projectileSprite,
      velocityX: Math.cos(angle) * this.stats.speed,
      velocityY: Math.sin(angle) * this.stats.speed,
      lifetime: this.stats.duration,
      damage: projectileDamage,
      isSynchronized,
      prevX: startX,
      prevY: startY,
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

      // Record previous position for trail drawing
      proj.prevX = proj.sprite.x;
      proj.prevY = proj.sprite.y;

      proj.sprite.x += proj.velocityX * ctx.deltaTime;
      proj.sprite.y += proj.velocityY * ctx.deltaTime;

      // Draw trail line from previous to current position
      if (this.projectileTrailGraphics) {
        const trailColor = proj.isSynchronized ? 0xffd700 : 0x4488ff;
        if (this.currentQuality === 'high') {
          // High: 2-layer trail - wider glow + thin white core
          this.projectileTrailGraphics.lineStyle(4, trailColor, 0.2);
          this.projectileTrailGraphics.lineBetween(proj.prevX, proj.prevY, proj.sprite.x, proj.sprite.y);
          this.projectileTrailGraphics.lineStyle(1, 0xffffff, 0.5);
          this.projectileTrailGraphics.lineBetween(proj.prevX, proj.prevY, proj.sprite.x, proj.sprite.y);
        } else {
          // Low/Medium: single line trail
          this.projectileTrailGraphics.lineStyle(2, trailColor, 0.4);
          this.projectileTrailGraphics.lineBetween(proj.prevX, proj.prevY, proj.sprite.x, proj.sprite.y);
        }
      }

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
    if (this.projectileTrailGraphics) {
      this.projectileTrailGraphics.destroy();
      this.projectileTrailGraphics = null;
    }
    if (this.linkGraphics) {
      this.linkGraphics.destroy();
      this.linkGraphics = null;
    }
    super.destroy();
  }
}
