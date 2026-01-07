import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';

/**
 * MeteorWeapon drops devastating meteors on enemy clusters.
 * High damage AOE, but with a delay before impact.
 */
export class MeteorWeapon extends BaseWeapon {
  private pendingMeteors: {
    x: number;
    y: number;
    delay: number;
    damage: number;
    radius: number;
    warning: Phaser.GameObjects.Arc;
  }[] = [];

  // Mastery: Cataclysm - burning ground zones
  private burningZones: {
    x: number;
    y: number;
    radius: number;
    damagePerSecond: number;
    remainingTime: number;
    graphics: Phaser.GameObjects.Graphics;
    hitCooldowns: Map<number, number>;
  }[] = [];

  // OPTIMIZATION: Pre-allocated arrays to avoid per-frame allocations
  private toExplodeTemp: typeof this.pendingMeteors = [];
  private toRemoveTemp: number[] = [];

  constructor() {
    const baseStats: WeaponStats = {
      damage: 60,
      cooldown: 3.5,
      range: 500,         // Max distance to spawn meteor
      count: 1,           // Meteors per attack
      piercing: 999,
      size: 1,            // Explosion radius multiplier
      speed: 1,
      duration: 0.8,      // Delay before impact
    };

    super(
      'meteor',
      'Meteor Strike',
      'meteor',
      'Devastating sky bombs',
      10,
      baseStats,
      'Cataclysm',
      'Impacts create burning ground for 4s, dealing 20% damage/sec'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    for (let i = 0; i < this.stats.count; i++) {
      // Find a cluster of enemies
      const targetPos = this.findEnemyCluster(ctx, enemies);
      if (!targetPos) continue;

      // Add some randomness
      const offsetX = (Math.random() - 0.5) * 40;
      const offsetY = (Math.random() - 0.5) * 40;
      const x = targetPos.x + offsetX;
      const y = targetPos.y + offsetY;

      // Create warning indicator - blue
      const explosionRadius = 60 * this.stats.size;
      const warning = ctx.scene.add.circle(x, y, explosionRadius, 0x4488ff, 0.2);
      warning.setStrokeStyle(2, 0x2266dd, 0.5);
      warning.setDepth(2);

      // Pulsing warning
      ctx.scene.tweens.add({
        targets: warning,
        scaleX: 1.1,
        scaleY: 1.1,
        alpha: 0.4,
        duration: 200,
        yoyo: true,
        repeat: Math.floor(this.stats.duration * 1000 / 400),
      });

      this.pendingMeteors.push({
        x,
        y,
        delay: this.stats.duration,
        damage: this.stats.damage,
        radius: explosionRadius,
        warning,
      });
    }
  }

  private findEnemyCluster(
    ctx: WeaponContext,
    enemies: readonly number[]
  ): { x: number; y: number } | null {
    if (enemies.length === 0) return null;

    // Score each enemy position by nearby enemy count
    let bestX = 0;
    let bestY = 0;
    let bestScore = 0;

    const sampleSize = Math.min(10, enemies.length);
    const sampled = enemies.slice().sort(() => Math.random() - 0.5).slice(0, sampleSize);

    for (const enemyId of sampled) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];

      // Check distance from player
      const playerDist = Math.sqrt(
        (ex - ctx.playerX) ** 2 + (ey - ctx.playerY) ** 2
      );
      if (playerDist > this.stats.range) continue;

      // Count nearby enemies
      let score = 0;
      for (const otherId of enemies) {
        const ox = Transform.x[otherId];
        const oy = Transform.y[otherId];
        const dist = Math.sqrt((ex - ox) ** 2 + (ey - oy) ** 2);
        if (dist < 80) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestX = ex;
        bestY = ey;
      }
    }

    if (bestScore === 0) {
      // No cluster found, just pick a random enemy
      const randomEnemy = enemies[Math.floor(Math.random() * enemies.length)];
      return {
        x: Transform.x[randomEnemy],
        y: Transform.y[randomEnemy],
      };
    }

    return { x: bestX, y: bestY };
  }

  protected updateEffects(ctx: WeaponContext): void {
    // OPTIMIZATION: Reuse pre-allocated array instead of creating new each frame
    this.toExplodeTemp.length = 0;

    for (const meteor of this.pendingMeteors) {
      meteor.delay -= ctx.deltaTime;

      if (meteor.delay <= 0) {
        this.toExplodeTemp.push(meteor);
      }
    }

    // Explode meteors
    for (const meteor of this.toExplodeTemp) {
      this.explodeMeteor(ctx, meteor);

      const index = this.pendingMeteors.indexOf(meteor);
      if (index !== -1) this.pendingMeteors.splice(index, 1);
    }

    // Mastery: Update burning zones
    if (this.burningZones.length > 0) {
      this.updateBurningZones(ctx);
    }
  }

  private explodeMeteor(
    ctx: WeaponContext,
    meteor: typeof this.pendingMeteors[0]
  ): void {
    // Remove warning
    meteor.warning.destroy();

    // Visual explosion
    this.createExplosion(ctx, meteor.x, meteor.y, meteor.radius);

    // Damage enemies in radius
    const enemies = ctx.getEnemies();
    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dist = Math.sqrt((ex - meteor.x) ** 2 + (ey - meteor.y) ** 2);

      if (dist <= meteor.radius) {
        // Damage falls off with distance
        const falloff = 1 - (dist / meteor.radius) * 0.5;
        ctx.damageEnemy(enemyId, meteor.damage * falloff, 300);
      }
    }

    // Mastery: Cataclysm - create burning ground zone
    if (this.isMastered()) {
      this.createBurningZone(ctx, meteor.x, meteor.y, meteor.radius, meteor.damage);
    }

    ctx.soundManager.playHit();
  }

  /**
   * Mastery: Cataclysm - Create a burning ground zone that damages enemies over time.
   */
  private createBurningZone(
    ctx: WeaponContext,
    x: number,
    y: number,
    radius: number,
    baseDamage: number
  ): void {
    const graphics = ctx.scene.add.graphics();
    graphics.setDepth(2);

    this.burningZones.push({
      x,
      y,
      radius: radius * 0.8, // Slightly smaller than explosion
      damagePerSecond: baseDamage * 0.2, // 20% damage per second
      remainingTime: 4.0, // 4 second duration
      graphics,
      hitCooldowns: new Map(),
    });
  }

  /**
   * Update burning zone visuals and deal damage.
   */
  private updateBurningZones(ctx: WeaponContext): void {
    // OPTIMIZATION: Reuse pre-allocated array
    this.toRemoveTemp.length = 0;

    for (let i = 0; i < this.burningZones.length; i++) {
      const zone = this.burningZones[i];
      zone.remainingTime -= ctx.deltaTime;

      if (zone.remainingTime <= 0) {
        zone.graphics.destroy();
        this.toRemoveTemp.push(i);
        continue;
      }

      // Draw burning ground effect
      this.drawBurningZone(zone, ctx.gameTime);

      // Deal damage to enemies in zone
      const enemies = ctx.getEnemies();
      for (const enemyId of enemies) {
        // Per-enemy tick cooldown (0.5s between hits)
        const lastHit = zone.hitCooldowns.get(enemyId) || 0;
        if (ctx.gameTime - lastHit < 0.5) continue;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dist = Math.sqrt((ex - zone.x) ** 2 + (ey - zone.y) ** 2);

        if (dist <= zone.radius) {
          // Deal tick damage (0.5s worth)
          ctx.damageEnemy(enemyId, zone.damagePerSecond * 0.5, 0);
          zone.hitCooldowns.set(enemyId, ctx.gameTime);
        }
      }
    }

    // Remove expired zones (reverse order to maintain indices)
    for (let i = this.toRemoveTemp.length - 1; i >= 0; i--) {
      this.burningZones.splice(this.toRemoveTemp[i], 1);
    }
  }

  /**
   * Draw the burning ground visual effect.
   */
  private drawBurningZone(
    zone: typeof this.burningZones[0],
    gameTime: number
  ): void {
    zone.graphics.clear();

    const fadeProgress = 1 - (zone.remainingTime / 4.0);
    const alpha = 0.4 * (1 - fadeProgress * 0.7);

    // Animated fire pattern
    const flicker = Math.sin(gameTime * 10) * 0.1;

    // Orange/red gradient circles
    zone.graphics.fillStyle(0xff4400, alpha * (0.3 + flicker));
    zone.graphics.fillCircle(zone.x, zone.y, zone.radius);

    zone.graphics.fillStyle(0xff6600, alpha * (0.4 + flicker));
    zone.graphics.fillCircle(zone.x, zone.y, zone.radius * 0.7);

    zone.graphics.fillStyle(0xffaa00, alpha * (0.5 + flicker));
    zone.graphics.fillCircle(zone.x, zone.y, zone.radius * 0.4);

    // Animated flame tongues
    const flameCount = 6;
    for (let i = 0; i < flameCount; i++) {
      const angle = (i / flameCount) * Math.PI * 2 + gameTime * 2;
      const flameHeight = 15 + Math.sin(gameTime * 8 + i) * 8;
      const fx = zone.x + Math.cos(angle) * zone.radius * 0.6;
      const fy = zone.y + Math.sin(angle) * zone.radius * 0.6;

      zone.graphics.fillStyle(0xffcc00, alpha * 0.7);
      zone.graphics.fillTriangle(
        fx - 5, fy,
        fx + 5, fy,
        fx, fy - flameHeight
      );
    }
  }

  private createExplosion(
    ctx: WeaponContext,
    x: number,
    y: number,
    radius: number
  ): void {
    // Meteor falling visual - blue
    const meteorSprite = ctx.scene.add.circle(x, y - 200, 15, 0x4488ff);
    meteorSprite.setDepth(20);

    ctx.scene.tweens.add({
      targets: meteorSprite,
      y: y,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 100,
      onComplete: () => meteorSprite.destroy(),
    });

    // Main explosion - blue
    const explosion = ctx.scene.add.circle(x, y, radius * 0.3, 0x66aaff, 0.9);
    explosion.setDepth(15);

    ctx.scene.tweens.add({
      targets: explosion,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => explosion.destroy(),
    });

    // Energy ring - blue
    const ring = ctx.scene.add.circle(x, y, radius * 0.5, 0x2266dd, 0);
    ring.setStrokeStyle(8, 0x4488ff, 1);
    ring.setDepth(14);

    ctx.scene.tweens.add({
      targets: ring,
      scaleX: 2,
      scaleY: 2,
      alpha: 0,
      duration: 300,
      onComplete: () => ring.destroy(),
    });

    // Debris particles - blue
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
      const dist = radius * 0.5 + Math.random() * radius * 0.5;

      const debris = ctx.scene.add.circle(x, y, 4, 0x66aaff);
      debris.setDepth(16);

      ctx.scene.tweens.add({
        targets: debris,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist - 20,
        alpha: 0,
        duration: 400 + Math.random() * 200,
        onComplete: () => debris.destroy(),
      });
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = 1 + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.size = 1 + (this.level - 1) * 0.12;
    this.stats.duration = Math.max(0.4, this.baseStats.duration - (this.level - 1) * 0.05);
  }

  public destroy(): void {
    for (const meteor of this.pendingMeteors) {
      meteor.warning.destroy();
    }
    this.pendingMeteors = [];

    // Clean up burning zones
    for (const zone of this.burningZones) {
      zone.graphics.destroy();
    }
    this.burningZones = [];

    super.destroy();
  }
}
