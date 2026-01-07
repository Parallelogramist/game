import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';

/**
 * ProjectileWeapon fires auto-targeting projectiles at the nearest enemy.
 * This is the starting weapon - reliable, upgradeable, good all-around.
 */
// OPTIMIZATION: Circular buffer constants for trails
const TRAIL_LENGTH = 6;

export class ProjectileWeapon extends BaseWeapon {
  private projectiles: Phaser.GameObjects.Graphics[] = [];
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
    projectile.setDepth(10);

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

      // Draw sparkle trail first (behind the diamond)
      // OPTIMIZATION: Iterate circular buffer without creating new arrays
      for (let i = 0; i < data.trailCount; i++) {
        // Calculate the actual buffer index (oldest entries first for proper alpha)
        const bufferIdx = (data.trailIndex - data.trailCount + i + TRAIL_LENGTH) % TRAIL_LENGTH;
        const alpha = ((i + 1) / data.trailCount) * 0.5;
        const trailSize = size * 0.8 * ((i + 1) / data.trailCount);
        const relX = data.trailBuffer[bufferIdx].x - data.x;
        const relY = data.trailBuffer[bufferIdx].y - data.y;
        projectile.fillStyle(currentColors.trail, alpha);
        projectile.fillCircle(relX, relY, trailSize);
      }

      // Draw elongated diamond shape pointing in direction of travel
      const length = size * 4;  // Front to back
      const width = size * 2;   // Side to side
      const cos = Math.cos(data.angle);
      const sin = Math.sin(data.angle);

      // Diamond vertices: front, right, back, left
      const frontX = cos * length;
      const frontY = sin * length;
      const backX = -cos * length * 0.5;
      const backY = -sin * length * 0.5;
      const rightX = -sin * width;
      const rightY = cos * width;
      const leftX = sin * width;
      const leftY = -cos * width;

      // Fill diamond
      projectile.fillStyle(currentColors.fill, 1);
      projectile.beginPath();
      projectile.moveTo(frontX, frontY);
      projectile.lineTo(rightX, rightY);
      projectile.lineTo(backX, backY);
      projectile.lineTo(leftX, leftY);
      projectile.closePath();
      projectile.fillPath();

      // White stroke outline (brighter for higher kill counts)
      const strokeAlpha = 0.8 + data.killCount * 0.07;
      projectile.lineStyle(1 + data.killCount * 0.5, 0xffffff, strokeAlpha);
      projectile.beginPath();
      projectile.moveTo(frontX, frontY);
      projectile.lineTo(rightX, rightY);
      projectile.lineTo(backX, backY);
      projectile.lineTo(leftX, leftY);
      projectile.closePath();
      projectile.strokePath();

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
