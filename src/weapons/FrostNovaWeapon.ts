import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Velocity, Health } from '../ecs/components';

/**
 * FrostNovaWeapon periodically releases a freezing blast.
 * Damages and slows all enemies in range.
 */
export class FrostNovaWeapon extends BaseWeapon {
  private slowedEnemies: Map<number, {
    originalSpeed: number;
    expireTime: number;
    maxHealth: number;  // Track for Absolute Zero mastery
  }> = new Map();

  constructor() {
    const baseStats: WeaponStats = {
      damage: 12,
      cooldown: 3.0,
      range: 120,
      count: 1,
      piercing: 999,
      size: 1,
      speed: 0.5,       // Slow strength (50% speed reduction)
      duration: 2.0,    // Slow duration
    };

    super(
      'frost_nova',
      'Frost Nova',
      'frost-nova',
      'Freezing explosion',
      10,
      baseStats,
      'Absolute Zero',
      'Frozen enemies shatter on death, dealing 50% max HP to nearby foes'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const radius = this.stats.range * this.stats.size;

    // Visual nova effect
    this.createNovaVisual(ctx, radius);

    // Hit all enemies in range
    const enemies = ctx.getEnemies();
    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Deal damage
        ctx.damageEnemy(enemyId, this.stats.damage, 100);

        // Apply slow
        this.applySlowToEnemy(ctx, enemyId);

        // Frost visual on enemy
        this.createFrostOnEnemy(ctx, ex, ey);
      }
    }

    ctx.soundManager.playHit();
  }

  private createNovaVisual(ctx: WeaponContext, radius: number): void {
    // Expanding ring - ice blue with white stroke
    const ring = ctx.scene.add.circle(ctx.playerX, ctx.playerY, 10, 0x88ccff, 0);
    ring.setStrokeStyle(4, 0xffffff, 1); // White outline
    ring.setDepth(8);

    ctx.scene.tweens.add({
      targets: ring,
      scaleX: radius / 10,
      scaleY: radius / 10,
      alpha: 0,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // Ice particles
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const particle = ctx.scene.add.text(
        ctx.playerX,
        ctx.playerY,
        '❄',
        { fontSize: '16px' }
      );
      particle.setOrigin(0.5);
      particle.setDepth(9);

      ctx.scene.tweens.add({
        targets: particle,
        x: ctx.playerX + Math.cos(angle) * radius,
        y: ctx.playerY + Math.sin(angle) * radius,
        alpha: 0,
        duration: 500,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  private applySlowToEnemy(ctx: WeaponContext, enemyId: number): void {
    const currentSpeed = Velocity.speed[enemyId];
    const enemyMaxHealth = Health.max[enemyId];

    // Check if already slowed
    const existing = this.slowedEnemies.get(enemyId);
    if (existing) {
      // Refresh duration
      existing.expireTime = ctx.gameTime + this.stats.duration;
      return;
    }

    // Apply slow
    const slowedSpeed = currentSpeed * this.stats.speed;
    Velocity.speed[enemyId] = slowedSpeed;

    this.slowedEnemies.set(enemyId, {
      originalSpeed: currentSpeed,
      expireTime: ctx.gameTime + this.stats.duration,
      maxHealth: enemyMaxHealth,  // Track for Absolute Zero shatter
    });
  }

  private createFrostOnEnemy(ctx: WeaponContext, x: number, y: number): void {
    // Create a fading snowflake instead of a circle
    const snowflake = ctx.scene.add.text(x, y, '❄', {
      fontSize: '24px',
      color: '#88ccff',
    });
    snowflake.setOrigin(0.5);
    snowflake.setDepth(3);
    snowflake.setAlpha(0.8);

    ctx.scene.tweens.add({
      targets: snowflake,
      alpha: 0,
      scaleX: 0.5,
      scaleY: 0.5,
      duration: this.stats.duration * 1000,
      onComplete: () => snowflake.destroy(),
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    // Check for expired slows and dead frozen enemies (Absolute Zero mastery)
    const toRemove: number[] = [];

    for (const [enemyId, data] of this.slowedEnemies) {
      // Mastery: Absolute Zero - check if frozen enemy died
      if (this.isMastered() && Health.current[enemyId] <= 0) {
        // Trigger shatter effect before removal
        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        this.triggerShatterEffect(ctx, ex, ey, data.maxHealth);
        toRemove.push(enemyId);
        continue;
      }

      if (ctx.gameTime >= data.expireTime) {
        // Restore original speed
        Velocity.speed[enemyId] = data.originalSpeed;
        toRemove.push(enemyId);
      }
    }

    for (const enemyId of toRemove) {
      this.slowedEnemies.delete(enemyId);
    }
  }

  /**
   * Mastery: Absolute Zero - Shatter effect when frozen enemy dies.
   * Deals 50% of the dead enemy's max HP to nearby enemies.
   */
  private triggerShatterEffect(ctx: WeaponContext, x: number, y: number, deadEnemyMaxHealth: number): void {
    const shatterRadius = 80;
    const shatterDamage = deadEnemyMaxHealth * 0.5;

    // Visual: ice shards flying outward
    this.createShatterVisual(ctx, x, y);

    // Damage nearby enemies
    const enemies = ctx.getEnemies();
    for (const enemyId of enemies) {
      if (Health.current[enemyId] <= 0) continue; // Skip already dead

      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - x;
      const dy = ey - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= shatterRadius && dist > 0) {
        // Deal shatter damage
        ctx.damageEnemy(enemyId, shatterDamage, 250);

        // Also apply a brief slow
        this.applySlowToEnemy(ctx, enemyId);
      }
    }
  }

  /**
   * Visual effect for the Absolute Zero shatter.
   */
  private createShatterVisual(ctx: WeaponContext, x: number, y: number): void {
    // Create ice shard particles
    const shardCount = 8;
    for (let i = 0; i < shardCount; i++) {
      const angle = (i / shardCount) * Math.PI * 2;
      const shard = ctx.scene.add.graphics();
      shard.setPosition(x, y);
      shard.setDepth(10);

      // Draw ice shard shape
      shard.fillStyle(0x88ddff, 1);
      shard.beginPath();
      shard.moveTo(0, -8);
      shard.lineTo(3, 0);
      shard.lineTo(0, 8);
      shard.lineTo(-3, 0);
      shard.closePath();
      shard.fillPath();
      shard.lineStyle(1, 0xffffff, 1);
      shard.strokePath();

      shard.setRotation(angle);

      const targetX = x + Math.cos(angle) * 80;
      const targetY = y + Math.sin(angle) * 80;

      ctx.scene.tweens.add({
        targets: shard,
        x: targetX,
        y: targetY,
        alpha: 0,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: 400,
        ease: 'Cubic.easeOut',
        onComplete: () => shard.destroy(),
      });
    }

    // Central burst
    const burst = ctx.scene.add.circle(x, y, 5, 0xffffff, 1);
    burst.setDepth(11);
    ctx.scene.tweens.add({
      targets: burst,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 300,
      onComplete: () => burst.destroy(),
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.range = this.baseStats.range + (this.level - 1) * 20;
    this.stats.duration = this.baseStats.duration + (this.level - 1) * 0.3;
    this.stats.speed = Math.max(0.2, this.baseStats.speed - (this.level - 1) * 0.05); // More slow
  }

  public destroy(): void {
    // Restore all slowed enemies
    for (const [enemyId, data] of this.slowedEnemies) {
      Velocity.speed[enemyId] = data.originalSpeed;
    }
    this.slowedEnemies.clear();
    super.destroy();
  }
}
