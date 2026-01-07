import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';

interface Shuriken {
  sprite: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  baseAngle: number;      // Direction of travel
  spiralPhase: number;    // Current position in spiral
  lifetime: number;
  damage: number;
  hitEnemies: Set<number>;
  hitCooldown: Map<number, number>;
  isCyclone?: boolean;    // Mastery: Cyclone Convergence - merged shuriken
  pullRadius?: number;    // Mastery: Cyclone pull range
}

/**
 * ShurikenWeapon fires spinning projectiles that travel in spiral patterns.
 * Unpredictable coverage, great for area denial.
 */
export class ShurikenWeapon extends BaseWeapon {
  private shurikens: Shuriken[] = [];
  private spinSpeed: number = 15;     // Visual spin speed
  private spiralAmplitude: number = 30;
  private spiralFrequency: number = 8;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 12,
      cooldown: 1.0,
      range: 300,
      count: 2,            // Shurikens per attack
      piercing: 2,         // Can hit same enemy multiple times
      size: 1,
      speed: 200,
      duration: 3,
    };

    super(
      'shuriken',
      'Spiral Shuriken',
      'shuriken',
      'Spinning spiral projectiles',
      10,
      baseStats,
      'Cyclone Convergence',
      'Two nearby shurikens merge into a Cyclone (250% damage, pulls enemies)'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    // OPTIMIZATION: Pre-compute squared range
    const rangeSq = this.stats.range * this.stats.range;

    // Find nearest enemy for initial direction
    let nearestId = -1;
    // OPTIMIZATION: Use squared distance comparison
    let nearestDistSq = Infinity;

    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;
      const distSq = dx * dx + dy * dy;

      if (distSq < nearestDistSq && distSq <= rangeSq) {
        nearestDistSq = distSq;
        nearestId = enemyId;
      }
    }

    const baseAngle = nearestId !== -1 ?
      Math.atan2(Transform.y[nearestId] - ctx.playerY, Transform.x[nearestId] - ctx.playerX) :
      Math.random() * Math.PI * 2;

    // Fire multiple shurikens with spread
    for (let i = 0; i < this.stats.count; i++) {
      let angle = baseAngle;
      if (this.stats.count > 1) {
        const spread = Math.PI / 3; // 60 degrees total spread
        angle = baseAngle - spread / 2 + (spread / (this.stats.count - 1)) * i;
      }

      this.createShuriken(ctx, angle);
    }

    ctx.soundManager.playHit();
  }

  private createShuriken(ctx: WeaponContext, angle: number): void {
    const graphics = ctx.scene.add.graphics();
    graphics.setDepth(10);

    this.shurikens.push({
      sprite: graphics,
      x: ctx.playerX,
      y: ctx.playerY,
      baseAngle: angle,
      spiralPhase: 0,
      lifetime: this.stats.duration,
      damage: this.stats.damage,
      hitEnemies: new Set(),
      hitCooldown: new Map(),
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    // OPTIMIZATION: Use Set for O(1) removal checks
    const toRemove = new Set<Shuriken>();

    // Mastery: Cyclone Convergence - check for shurikens to merge
    if (this.isMastered()) {
      this.checkForMerge(ctx);
    }

    // OPTIMIZATION: Get spatial hash once per frame
    const spatialHash = getEnemySpatialHash();

    for (const shuriken of this.shurikens) {
      shuriken.lifetime -= ctx.deltaTime;
      if (shuriken.lifetime <= 0) {
        toRemove.add(shuriken);
        continue;
      }

      // Update spiral phase
      shuriken.spiralPhase += this.spiralFrequency * ctx.deltaTime;

      // Calculate movement with spiral offset
      const perpAngle = shuriken.baseAngle + Math.PI / 2;

      // Base movement along direction
      const baseVelX = Math.cos(shuriken.baseAngle) * this.stats.speed;
      const baseVelY = Math.sin(shuriken.baseAngle) * this.stats.speed;

      // Add perpendicular spiral component
      const spiralVelX = Math.cos(perpAngle) * Math.cos(shuriken.spiralPhase) * this.spiralAmplitude * 3;
      const spiralVelY = Math.sin(perpAngle) * Math.cos(shuriken.spiralPhase) * this.spiralAmplitude * 3;

      // Cyclones move slower but are more powerful
      const speedMultiplier = shuriken.isCyclone ? 0.5 : 1;
      shuriken.x += (baseVelX + spiralVelX) * ctx.deltaTime * speedMultiplier;
      shuriken.y += (baseVelY + spiralVelY) * ctx.deltaTime * speedMultiplier;

      // Mastery: Cyclone pull effect
      if (shuriken.isCyclone && shuriken.pullRadius) {
        this.applyCyclonePull(ctx, shuriken, spatialHash);
      }

      // Draw spinning shuriken
      const baseSize = 12 * this.stats.size;
      const size = shuriken.isCyclone ? baseSize * 2 : baseSize; // Cyclones are 2x size
      const spinSpeed = shuriken.isCyclone ? this.spinSpeed * 2 : this.spinSpeed; // Faster spin
      const spinAngle = ctx.gameTime * spinSpeed;

      shuriken.sprite.clear();
      shuriken.sprite.setPosition(shuriken.x, shuriken.y);

      // Cyclones get a wind effect ring
      if (shuriken.isCyclone) {
        const windRing = 0.3 + Math.sin(ctx.gameTime * 8) * 0.1;
        shuriken.sprite.lineStyle(3, 0xffdd44, windRing);
        shuriken.sprite.strokeCircle(0, 0, size * 1.3);
        shuriken.sprite.lineStyle(2, 0xffaa22, windRing * 0.6);
        shuriken.sprite.strokeCircle(0, 0, size * 1.5);
      }

      // Colors: gold for cyclone, blue for normal
      const bladeColor = shuriken.isCyclone ? 0xffdd44 : 0x4488ff;
      const centerColor = shuriken.isCyclone ? 0xffaa22 : 0x2266dd;
      const bladeCount = shuriken.isCyclone ? 6 : 4; // More blades for cyclone

      // Draw star shape
      shuriken.sprite.fillStyle(bladeColor, 1);
      for (let i = 0; i < bladeCount; i++) {
        const pointAngle = spinAngle + (i * Math.PI * 2 / bladeCount);

        shuriken.sprite.beginPath();
        shuriken.sprite.moveTo(0, 0);
        shuriken.sprite.lineTo(
          Math.cos(pointAngle - 0.3) * size * 0.4,
          Math.sin(pointAngle - 0.3) * size * 0.4
        );
        shuriken.sprite.lineTo(
          Math.cos(pointAngle) * size,
          Math.sin(pointAngle) * size
        );
        shuriken.sprite.lineTo(
          Math.cos(pointAngle + 0.3) * size * 0.4,
          Math.sin(pointAngle + 0.3) * size * 0.4
        );
        shuriken.sprite.closePath();
        shuriken.sprite.fillPath();
      }

      // Center circle
      shuriken.sprite.fillStyle(centerColor, 1);
      shuriken.sprite.fillCircle(0, 0, size * 0.25);

      // White outline
      shuriken.sprite.lineStyle(2, 0xffffff, 1);
      shuriken.sprite.strokeCircle(0, 0, size * 0.25);

      // Check bounds
      if (shuriken.x < -50 || shuriken.x > 1330 ||
          shuriken.y < -50 || shuriken.y > 770) {
        toRemove.add(shuriken);
        continue;
      }

      // OPTIMIZATION: Use spatial hash for O(1) proximity lookup instead of O(n) all enemies
      const collisionRadius = size + 12;
      const collisionRadiusSq = collisionRadius * collisionRadius;
      const nearbyEnemies = spatialHash.queryPotential(shuriken.x, shuriken.y, collisionRadius + 5);

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;
        // Check hit cooldown for this enemy
        const lastHit = shuriken.hitCooldown.get(enemyId) || 0;
        if (ctx.gameTime - lastHit < 0.3) continue;

        // Check if we've exceeded piercing for this enemy
        const hitCount = shuriken.hitEnemies.has(enemyId) ? 1 : 0;
        if (hitCount > this.stats.piercing) continue;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - shuriken.x;
        const dy = ey - shuriken.y;
        // OPTIMIZATION: Squared distance comparison
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          ctx.damageEnemy(enemyId, shuriken.damage, 100);
          shuriken.hitEnemies.add(enemyId);
          shuriken.hitCooldown.set(enemyId, ctx.gameTime);

          ctx.effectsManager.playHitSparks(shuriken.x, shuriken.y, shuriken.baseAngle);
        }
      }
    }

    // OPTIMIZATION: Single filter pass with O(1) Set.has()
    if (toRemove.size > 0) {
      for (const shuriken of toRemove) {
        shuriken.sprite.destroy();
      }
      this.shurikens = this.shurikens.filter(s => !toRemove.has(s));
    }
  }

  /**
   * Mastery: Cyclone Convergence - check for nearby shurikens to merge.
   * Two non-cyclone shurikens within 20 units merge into a powerful cyclone.
   */
  private checkForMerge(ctx: WeaponContext): void {
    // OPTIMIZATION: Pre-compute squared distance to avoid sqrt in O(n²) loop
    const mergeDistanceSq = 20 * 20; // 400
    const toMerge: [Shuriken, Shuriken][] = [];
    const alreadyMerging = new Set<Shuriken>();

    // Find pairs of shurikens close enough to merge
    for (let i = 0; i < this.shurikens.length; i++) {
      const s1 = this.shurikens[i];
      if (s1.isCyclone || alreadyMerging.has(s1)) continue;

      for (let j = i + 1; j < this.shurikens.length; j++) {
        const s2 = this.shurikens[j];
        if (s2.isCyclone || alreadyMerging.has(s2)) continue;

        const dx = s1.x - s2.x;
        const dy = s1.y - s2.y;
        // OPTIMIZATION: Squared distance comparison - O(n²) makes this critical
        const distSq = dx * dx + dy * dy;
        if (distSq < mergeDistanceSq) {
          toMerge.push([s1, s2]);
          alreadyMerging.add(s1);
          alreadyMerging.add(s2);
          break;
        }
      }
    }

    // Perform merges
    for (const [s1, s2] of toMerge) {
      this.mergeToCyclone(ctx, s1, s2);
    }
  }

  /**
   * Merge two shurikens into a cyclone.
   */
  private mergeToCyclone(ctx: WeaponContext, s1: Shuriken, s2: Shuriken): void {
    // Calculate merge position (midpoint)
    const mergeX = (s1.x + s2.x) / 2;
    const mergeY = (s1.y + s2.y) / 2;

    // Average direction
    const avgAngle = (s1.baseAngle + s2.baseAngle) / 2;

    // OPTIMIZATION: Use filter instead of indexOf + splice (O(n) vs O(2n))
    s1.sprite.destroy();
    s2.sprite.destroy();
    this.shurikens = this.shurikens.filter(s => s !== s1 && s !== s2);

    // Create cyclone
    const cycloneGraphics = ctx.scene.add.graphics();
    cycloneGraphics.setDepth(11);

    // Merge visual effect
    const mergeEffect = ctx.scene.add.circle(mergeX, mergeY, 10, 0xffffff, 0.8);
    mergeEffect.setDepth(12);
    ctx.scene.tweens.add({
      targets: mergeEffect,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 200,
      onComplete: () => mergeEffect.destroy(),
    });

    // Combined damage (250% of base)
    const cycloneDamage = this.stats.damage * 2.5;

    this.shurikens.push({
      sprite: cycloneGraphics,
      x: mergeX,
      y: mergeY,
      baseAngle: avgAngle,
      spiralPhase: 0,
      lifetime: 5, // Extended lifetime
      damage: cycloneDamage,
      hitEnemies: new Set(),
      hitCooldown: new Map(),
      isCyclone: true,
      pullRadius: 80, // Pull enemies within this range
    });
  }

  /**
   * Mastery: Apply pull effect to enemies near a cyclone.
   */
  private applyCyclonePull(
    ctx: WeaponContext,
    cyclone: Shuriken,
    spatialHash: ReturnType<typeof getEnemySpatialHash>
  ): void {
    const pullStrength = 80; // Pixels per second
    const pullRadius = cyclone.pullRadius!;
    // OPTIMIZATION: Pre-compute squared radius
    const pullRadiusSq = pullRadius * pullRadius;

    // OPTIMIZATION: Use spatial hash for O(1) proximity lookup instead of O(n) all enemies
    const nearbyEnemies = spatialHash.queryPotential(cyclone.x, cyclone.y, pullRadius + 5);

    for (const enemy of nearbyEnemies) {
      const enemyId = enemy.id;
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = cyclone.x - ex;
      const dy = cyclone.y - ey;
      const distSq = dx * dx + dy * dy;

      if (distSq > 0 && distSq < pullRadiusSq) {
        // Need actual distance for normalization (only computed when in range)
        const dist = Math.sqrt(distSq);
        // Pull strength inversely proportional to distance
        const pullFactor = (1 - dist / pullRadius) * pullStrength * ctx.deltaTime;
        Transform.x[enemyId] += (dx / dist) * pullFactor;
        Transform.y[enemyId] += (dy / dist) * pullFactor;
      }
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.piercing = this.baseStats.piercing + Math.floor(this.level / 3);
    this.spiralAmplitude = 30 + (this.level - 1) * 5;
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 20;
  }

  public destroy(): void {
    for (const shuriken of this.shurikens) {
      shuriken.sprite.destroy();
    }
    this.shurikens = [];
    super.destroy();
  }
}
