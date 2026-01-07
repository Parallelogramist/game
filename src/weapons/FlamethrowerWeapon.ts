import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';

/**
 * FlamethrowerWeapon sprays fire in a cone toward enemies.
 * Continuous damage, great for groups in one direction.
 */
export class FlamethrowerWeapon extends BaseWeapon {
  private flameGraphics: Phaser.GameObjects.Graphics | null = null;
  // OPTIMIZATION: Use Set for O(1) add/delete instead of array indexOf+splice
  private particles: Set<Phaser.GameObjects.Arc> = new Set();
  private lastAimAngle: number = 0;
  private hitCooldowns: Map<number, number> = new Map();

  // Mastery: Dragon's Breath
  private burnTime: Map<number, number> = new Map();      // How long enemy has been burning
  private ignitedEnemies: Set<number> = new Set();        // Enemies that reached 2s burn (Ignited)
  private readonly IGNITE_THRESHOLD = 2.0;                // Seconds to become Ignited

  constructor() {
    const baseStats: WeaponStats = {
      damage: 8,
      cooldown: 0.1,      // Damage tick rate
      range: 150,         // Flame reach
      count: 1,
      piercing: 999,
      size: 1,            // Cone width multiplier
      speed: 1,
      duration: 0.5,      // Attack duration (fires continuously)
    };

    super(
      'flamethrower',
      'Flamethrower',
      'flamethrower',
      'Spray fire at enemies',
      10,
      baseStats,
      'Dragon\'s Breath',
      '2s flames = Ignited (+50% damage). Ignited enemies explode on death'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    // OPTIMIZATION: Pre-compute squared range for comparisons
    const rangeSq = this.stats.range * this.stats.range;

    // Find nearest enemy to aim at
    let nearestId = -1;
    // OPTIMIZATION: Use squared distance comparison, avoid sqrt
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

    if (nearestId !== -1) {
      const ex = Transform.x[nearestId];
      const ey = Transform.y[nearestId];
      this.lastAimAngle = Math.atan2(ey - ctx.playerY, ex - ctx.playerX);
    }

    // Damage enemies in cone
    const coneAngle = (Math.PI / 4) * this.stats.size; // 45 degrees base

    for (const enemyId of enemies) {
      const lastHit = this.hitCooldowns.get(enemyId) || 0;
      if (ctx.gameTime - lastHit < this.stats.cooldown) continue;

      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;
      // OPTIMIZATION: Squared distance for range check
      const distSq = dx * dx + dy * dy;

      if (distSq > rangeSq) continue;

      // Check if in cone
      const angleToEnemy = Math.atan2(dy, dx);
      let angleDiff = Math.abs(angleToEnemy - this.lastAimAngle);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

      if (angleDiff <= coneAngle / 2) {
        // Mastery: Dragon's Breath - track burn time
        if (this.isMastered()) {
          const currentBurn = this.burnTime.get(enemyId) || 0;
          this.burnTime.set(enemyId, currentBurn + this.stats.cooldown);

          // Check if enemy should become Ignited
          if (currentBurn >= this.IGNITE_THRESHOLD && !this.ignitedEnemies.has(enemyId)) {
            this.ignitedEnemies.add(enemyId);
            this.showIgniteEffect(ctx, ex, ey);
          }
        }

        // Calculate damage (+50% for Ignited enemies)
        const isIgnited = this.ignitedEnemies.has(enemyId);
        const finalDamage = isIgnited ? this.stats.damage * 1.5 : this.stats.damage;

        ctx.damageEnemy(enemyId, finalDamage, 80);
        this.hitCooldowns.set(enemyId, ctx.gameTime);

        // Fire hit effect (orange for ignited, blue for normal)
        if (Math.random() < 0.3) {
          this.createFlameParticle(ctx, ex, ey, isIgnited);
        }
      }
    }

    // Create flame visual
    this.createFlameVisual(ctx);
  }

  private createFlameVisual(ctx: WeaponContext): void {
    // Spawn flame particles
    for (let i = 0; i < 3; i++) {
      const spreadAngle = this.lastAimAngle + (Math.random() - 0.5) * (Math.PI / 3) * this.stats.size;
      const dist = 20 + Math.random() * this.stats.range * 0.8;

      const x = ctx.playerX + Math.cos(spreadAngle) * dist;
      const y = ctx.playerY + Math.sin(spreadAngle) * dist;

      this.createFlameParticle(ctx, x, y);
    }
  }

  private createFlameParticle(ctx: WeaponContext, x: number, y: number, isIgnited: boolean = false): void {
    const size = 6 + Math.random() * 8;
    // Blue energy particles normally, orange/red for ignited
    const colors = isIgnited
      ? [0xff4400, 0xff6600, 0xffaa00, 0xffcc00]  // Orange/red for ignited
      : [0x2266dd, 0x4488ff, 0x66aaff, 0x88ccff]; // Blue normally
    const color = colors[Math.floor(Math.random() * colors.length)];

    const particle = ctx.scene.add.circle(x, y, isIgnited ? size * 1.3 : size, color, 0.8);
    particle.setDepth(8);
    // OPTIMIZATION: Set.add is O(1)
    this.particles.add(particle);

    ctx.scene.tweens.add({
      targets: particle,
      scaleX: 0.3,
      scaleY: 0.3,
      alpha: 0,
      y: y - 20 - Math.random() * 20,
      duration: 200 + Math.random() * 200,
      onComplete: () => {
        // OPTIMIZATION: Set.delete is O(1) instead of indexOf O(n) + splice O(n)
        this.particles.delete(particle);
        particle.destroy();
      },
    });
  }

  /**
   * Mastery: Show visual effect when enemy becomes Ignited.
   */
  private showIgniteEffect(ctx: WeaponContext, x: number, y: number): void {
    // Flame burst effect
    const burst = ctx.scene.add.graphics();
    burst.setPosition(x, y);
    burst.setDepth(9);

    burst.fillStyle(0xff6600, 0.8);
    burst.fillCircle(0, 0, 15);
    burst.fillStyle(0xffaa00, 0.9);
    burst.fillCircle(0, 0, 8);

    ctx.scene.tweens.add({
      targets: burst,
      scaleX: 2,
      scaleY: 2,
      alpha: 0,
      duration: 300,
      onComplete: () => burst.destroy(),
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    // Mastery: Dragon's Breath - check for ignited enemy deaths
    if (this.isMastered() && this.ignitedEnemies.size > 0) {
      const deadIgnited: number[] = [];
      for (const enemyId of this.ignitedEnemies) {
        if (Health.current[enemyId] <= 0) {
          deadIgnited.push(enemyId);
        }
      }

      // Trigger explosions for dead ignited enemies
      for (const enemyId of deadIgnited) {
        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        this.triggerIgniteExplosion(ctx, ex, ey);
        this.ignitedEnemies.delete(enemyId);
        this.burnTime.delete(enemyId);
      }
    }

    // Clean up old cooldowns and burn times
    if (Math.random() < 0.01) {
      for (const [enemyId, time] of this.hitCooldowns) {
        if (ctx.gameTime - time > 2) {
          this.hitCooldowns.delete(enemyId);
          // Also decay burn time for enemies not being hit
          const currentBurn = this.burnTime.get(enemyId);
          if (currentBurn !== undefined) {
            const newBurn = currentBurn - 0.5; // Decay burn time
            if (newBurn <= 0) {
              this.burnTime.delete(enemyId);
              this.ignitedEnemies.delete(enemyId);
            } else {
              this.burnTime.set(enemyId, newBurn);
            }
          }
        }
      }
    }
  }

  /**
   * Mastery: Dragon's Breath - Ignited enemy explosion on death.
   * Spreads burn to nearby enemies.
   */
  private triggerIgniteExplosion(ctx: WeaponContext, x: number, y: number): void {
    const explosionRadius = 60;
    // OPTIMIZATION: Pre-compute squared radius for comparisons
    const explosionRadiusSq = explosionRadius * explosionRadius;
    const explosionDamage = this.stats.damage * 3;

    // Visual explosion
    const explosion = ctx.scene.add.graphics();
    explosion.setPosition(x, y);
    explosion.setDepth(10);

    explosion.fillStyle(0xff4400, 0.7);
    explosion.fillCircle(0, 0, explosionRadius * 0.3);
    explosion.fillStyle(0xff6600, 0.5);
    explosion.fillCircle(0, 0, explosionRadius * 0.6);
    explosion.fillStyle(0xffaa00, 0.3);
    explosion.fillCircle(0, 0, explosionRadius);

    ctx.scene.tweens.add({
      targets: explosion,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 400,
      onComplete: () => explosion.destroy(),
    });

    // Fire particles
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const particleX = x + Math.cos(angle) * 20;
      const particleY = y + Math.sin(angle) * 20;
      this.createFlameParticle(ctx, particleX, particleY, true);
    }

    // Damage and ignite nearby enemies
    const enemies = ctx.getEnemies();
    for (const enemyId of enemies) {
      if (Health.current[enemyId] <= 0) continue;

      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - x;
      const dy = ey - y;
      // OPTIMIZATION: Use squared distance comparison
      const distSq = dx * dx + dy * dy;

      if (distSq <= explosionRadiusSq && distSq > 0) {
        // Deal explosion damage
        ctx.damageEnemy(enemyId, explosionDamage, 200);

        // Spread burn to hit enemies (give them 1s of burn time)
        const currentBurn = this.burnTime.get(enemyId) || 0;
        this.burnTime.set(enemyId, currentBurn + 1.0);
      }
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.range = this.baseStats.range + (this.level - 1) * 15;
    this.stats.size = 1 + (this.level - 1) * 0.15; // Wider cone
    this.stats.cooldown = Math.max(0.05, this.baseStats.cooldown - (this.level - 1) * 0.01);
  }

  public destroy(): void {
    if (this.flameGraphics) {
      this.flameGraphics.destroy();
      this.flameGraphics = null;
    }
    for (const particle of this.particles) {
      particle.destroy();
    }
    this.particles.clear();
    this.hitCooldowns.clear();
    this.burnTime.clear();
    this.ignitedEnemies.clear();
    super.destroy();
  }
}
