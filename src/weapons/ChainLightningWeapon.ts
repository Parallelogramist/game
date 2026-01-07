import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';

/**
 * ChainLightningWeapon fires a bolt that jumps between enemies.
 * Great for hitting clustered enemies. Damage reduces per jump.
 */
export class ChainLightningWeapon extends BaseWeapon {
  private lightningGraphics: Phaser.GameObjects.Graphics | null = null;

  // OPTIMIZATION: Pre-allocated arrays to avoid per-attack allocations
  private chainTargetsTemp: { id: number; x: number; y: number }[] = [];
  private allConnectionsTemp: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  private allTargetsTemp: { id: number; x: number; y: number }[] = [];
  private currentSourcesTemp: { x: number; y: number }[] = [];
  private nextSourcesTemp: { x: number; y: number }[] = [];

  constructor() {
    const baseStats: WeaponStats = {
      damage: 20,
      cooldown: 1.0,
      range: 200,        // Max range to first target
      count: 3,          // Number of chain jumps
      piercing: 0,
      size: 1,
      speed: 150,        // Chain range between enemies
      duration: 0.2,     // Visual duration
    };

    super(
      'chain_lightning',
      'Chain Lightning',
      'chain-lightning',
      'Bolt jumps between enemies',
      10,
      baseStats,
      'Lightning Conductor',
      'Lightning arcs to ALL enemies in chain range simultaneously'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const spatialHash = getEnemySpatialHash();

    // Find nearest enemy within range using spatial hash (O(1) instead of O(n))
    const nearestEnemy = spatialHash.findNearest(ctx.playerX, ctx.playerY, this.stats.range);
    if (!nearestEnemy) return;

    const firstTargetId = nearestEnemy.id;

    // Mastery: Lightning Conductor - hit ALL enemies in range from each source
    if (this.isMastered()) {
      this.attackLightningConductor(ctx, firstTargetId);
      return;
    }

    // OPTIMIZATION: Reuse pre-allocated array
    this.chainTargetsTemp.length = 0;
    const hitEnemies = new Set<number>();

    // Add first target
    this.chainTargetsTemp.push({
      id: firstTargetId,
      x: Transform.x[firstTargetId],
      y: Transform.y[firstTargetId],
    });
    hitEnemies.add(firstTargetId);

    // Find chain targets using spatial hash
    let lastX = this.chainTargetsTemp[0].x;
    let lastY = this.chainTargetsTemp[0].y;

    for (let jump = 0; jump < this.stats.count; jump++) {
      // Query nearby enemies and find the nearest one that hasn't been hit
      const nearbyEnemies = spatialHash.query(lastX, lastY, this.stats.speed);
      let nextTargetId = -1;
      // OPTIMIZATION: Use squared distance comparison
      let nextDistSq = Infinity;

      for (const enemy of nearbyEnemies) {
        if (hitEnemies.has(enemy.id)) continue;

        const dx = enemy.x - lastX;
        const dy = enemy.y - lastY;
        const distSq = dx * dx + dy * dy;

        if (distSq < nextDistSq) {
          nextDistSq = distSq;
          nextTargetId = enemy.id;
        }
      }

      if (nextTargetId === -1) break;

      this.chainTargetsTemp.push({
        id: nextTargetId,
        x: Transform.x[nextTargetId],
        y: Transform.y[nextTargetId],
      });
      hitEnemies.add(nextTargetId);
      lastX = Transform.x[nextTargetId];
      lastY = Transform.y[nextTargetId];
    }

    // Deal damage with falloff
    let currentDamage = this.stats.damage;
    for (let i = 0; i < this.chainTargetsTemp.length; i++) {
      ctx.damageEnemy(this.chainTargetsTemp[i].id, currentDamage, 100);
      currentDamage *= 0.8; // 20% damage reduction per jump

      // Apply overcharge stun if enabled
      if (ctx.overchargeStunDuration > 0) {
        ctx.stunEnemy(this.chainTargetsTemp[i].id, ctx.overchargeStunDuration);
      }
    }

    // Draw lightning visual
    this.drawLightning(ctx, this.chainTargetsTemp);

    // Play sound
    ctx.soundManager.playHit();
  }

  /**
   * Mastery: Lightning Conductor - arcs to ALL enemies within chain range simultaneously.
   * Creates a web pattern of lightning spreading outward from the player.
   * OPTIMIZED: Uses spatial hash for O(nearby) instead of O(all enemies) per source.
   */
  private attackLightningConductor(
    ctx: WeaponContext,
    firstTargetId: number
  ): void {
    const spatialHash = getEnemySpatialHash();
    const hitEnemies = new Set<number>();
    // OPTIMIZATION: Reuse pre-allocated arrays
    this.allConnectionsTemp.length = 0;
    this.allTargetsTemp.length = 0;
    this.currentSourcesTemp.length = 0;

    // Hit first target
    const firstX = Transform.x[firstTargetId];
    const firstY = Transform.y[firstTargetId];
    this.allConnectionsTemp.push({
      from: { x: ctx.playerX, y: ctx.playerY },
      to: { x: firstX, y: firstY },
    });
    this.allTargetsTemp.push({ id: firstTargetId, x: firstX, y: firstY });
    hitEnemies.add(firstTargetId);

    // Now spread lightning to ALL enemies in range from each hit target
    this.currentSourcesTemp.push({ x: firstX, y: firstY });

    for (let wave = 0; wave < this.stats.count; wave++) {
      // OPTIMIZATION: Reuse pre-allocated array
      this.nextSourcesTemp.length = 0;

      for (const source of this.currentSourcesTemp) {
        // Use spatial hash to find ALL enemies within chain range (O(nearby) instead of O(n))
        const nearbyEnemies = spatialHash.query(source.x, source.y, this.stats.speed);

        for (const enemy of nearbyEnemies) {
          if (hitEnemies.has(enemy.id)) continue;

          // Connect this enemy
          this.allConnectionsTemp.push({
            from: source,
            to: { x: enemy.x, y: enemy.y },
          });
          this.allTargetsTemp.push({ id: enemy.id, x: enemy.x, y: enemy.y });
          hitEnemies.add(enemy.id);
          this.nextSourcesTemp.push({ x: enemy.x, y: enemy.y });
        }
      }

      if (this.nextSourcesTemp.length === 0) break;
      // Swap arrays instead of creating new one
      const temp = this.currentSourcesTemp;
      this.currentSourcesTemp = this.nextSourcesTemp;
      this.nextSourcesTemp = temp;
    }

    // Deal damage to all hit targets (reduced damage for web pattern)
    const conductorDamage = this.stats.damage * 0.7; // 70% base damage for hitting many
    for (const target of this.allTargetsTemp) {
      ctx.damageEnemy(target.id, conductorDamage, 80);

      // Apply overcharge stun if enabled
      if (ctx.overchargeStunDuration > 0) {
        ctx.stunEnemy(target.id, ctx.overchargeStunDuration);
      }
    }

    // Draw the lightning web
    this.drawLightningWeb(ctx, this.allConnectionsTemp, this.allTargetsTemp);

    ctx.soundManager.playHit();
  }

  /**
   * Draw lightning web pattern for Lightning Conductor mastery.
   */
  private drawLightningWeb(
    ctx: WeaponContext,
    connections: { from: { x: number; y: number }; to: { x: number; y: number } }[],
    targets: { id: number; x: number; y: number }[]
  ): void {
    // Clean up previous lightning
    if (this.lightningGraphics) {
      this.lightningGraphics.destroy();
    }

    this.lightningGraphics = ctx.scene.add.graphics();
    this.lightningGraphics.setDepth(15);

    // Draw all connections
    for (const conn of connections) {
      this.drawLightningBolt(conn.from.x, conn.from.y, conn.to.x, conn.to.y);
    }

    // Sparks at all hit points
    for (const target of targets) {
      ctx.effectsManager.playHitSparks(target.x, target.y, 0);
    }

    // Fade out
    ctx.scene.tweens.add({
      targets: this.lightningGraphics,
      alpha: 0,
      duration: this.stats.duration * 1000 * 1.5, // Longer duration for dramatic effect
      onComplete: () => {
        if (this.lightningGraphics) {
          this.lightningGraphics.destroy();
          this.lightningGraphics = null;
        }
      },
    });
  }

  private drawLightning(
    ctx: WeaponContext,
    targets: { id: number; x: number; y: number }[]
  ): void {
    // Clean up previous lightning
    if (this.lightningGraphics) {
      this.lightningGraphics.destroy();
    }

    this.lightningGraphics = ctx.scene.add.graphics();
    this.lightningGraphics.setDepth(15);

    // Draw from player to first target, then between targets
    let startX = ctx.playerX;
    let startY = ctx.playerY;

    for (const target of targets) {
      this.drawLightningBolt(startX, startY, target.x, target.y);
      startX = target.x;
      startY = target.y;

      // Spark at each hit point
      ctx.effectsManager.playHitSparks(target.x, target.y, 0);
    }

    // Fade out
    ctx.scene.tweens.add({
      targets: this.lightningGraphics,
      alpha: 0,
      duration: this.stats.duration * 1000,
      onComplete: () => {
        if (this.lightningGraphics) {
          this.lightningGraphics.destroy();
          this.lightningGraphics = null;
        }
      },
    });
  }

  private drawLightningBolt(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.lightningGraphics) return;

    const segments = 6;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const perpX = -dy / dist;
    const perpY = dx / dist;

    // Main bolt
    this.lightningGraphics.lineStyle(3, 0x88ccff, 1);
    this.lightningGraphics.beginPath();
    this.lightningGraphics.moveTo(x1, y1);

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const baseX = x1 + dx * t;
      const baseY = y1 + dy * t;
      const offset = (Math.random() - 0.5) * 20 * this.stats.size;
      this.lightningGraphics.lineTo(baseX + perpX * offset, baseY + perpY * offset);
    }

    this.lightningGraphics.lineTo(x2, y2);
    this.lightningGraphics.strokePath();

    // Glow effect
    this.lightningGraphics.lineStyle(8, 0x4488ff, 0.3);
    this.lightningGraphics.beginPath();
    this.lightningGraphics.moveTo(x1, y1);
    this.lightningGraphics.lineTo(x2, y2);
    this.lightningGraphics.strokePath();

    // Core
    this.lightningGraphics.lineStyle(1, 0xffffff, 1);
    this.lightningGraphics.beginPath();
    this.lightningGraphics.moveTo(x1, y1);
    this.lightningGraphics.lineTo(x2, y2);
    this.lightningGraphics.strokePath();
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // More jumps at higher levels
    this.stats.count = this.baseStats.count + Math.floor(this.level / 2) + this.externalBonusCount;
    // Longer chain range
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 20;
  }

  public destroy(): void {
    if (this.lightningGraphics) {
      this.lightningGraphics.destroy();
      this.lightningGraphics = null;
    }
    super.destroy();
  }
}
