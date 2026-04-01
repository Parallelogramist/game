import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Velocity, Health } from '../ecs/components';
import { WEAPON_COLORS } from '../visual/NeonColors';
import { DepthLayers } from '../visual/DepthLayers';
import { getJuiceManager } from '../effects/JuiceManager';

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
      const distSq = dx * dx + dy * dy;

      if (distSq <= radius * radius) {
        // Deal damage
        ctx.damageEnemy(enemyId, this.stats.damage, 100);

        // Apply slow
        this.applySlowToEnemy(ctx, enemyId);

        // Frost visual on enemy
        this.createFrostOnEnemy(ctx, ex, ey);
      }
    }

    // Lingering frost ground effect at blast center
    this.createGroundFrost(ctx, radius);

    ctx.soundManager.playHit();
    getJuiceManager().screenShake(0.003, 150);
  }

  private createNovaVisual(ctx: WeaponContext, radius: number): void {
    const quality = ctx.visualQuality;

    // --- Expanding ring ---
    if (quality === 'low') {
      // Low: plain expanding arc
      const ring = ctx.scene.add.circle(ctx.playerX, ctx.playerY, 10, WEAPON_COLORS.frost.core, 0);
      ring.setStrokeStyle(4, 0xffffff, 1);
      ring.setDepth(DepthLayers.FROST_NOVA_RING);

      ctx.scene.tweens.add({
        targets: ring,
        scaleX: radius / 10,
        scaleY: radius / 10,
        alpha: 0,
        duration: 400,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    } else {
      // Medium/High: crystalline polygon ring
      const ringGraphics = ctx.scene.add.graphics();
      ringGraphics.setPosition(ctx.playerX, ctx.playerY);
      ringGraphics.setDepth(DepthLayers.FROST_NOVA_RING);

      const vertexCount = quality === 'high' ? 24 : 16;
      const spikeExtension = quality === 'high' ? 1.25 : 1.2;
      ringGraphics.lineStyle(4, 0xffffff, 1);
      ringGraphics.fillStyle(WEAPON_COLORS.frost.core, 0.15);
      ringGraphics.beginPath();
      for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
        const vertexAngle = (vertexIndex / vertexCount) * Math.PI * 2;
        const vertexRadius = (vertexIndex % 3 === 0) ? 10 * spikeExtension : 10;
        const vertexX = Math.cos(vertexAngle) * vertexRadius;
        const vertexY = Math.sin(vertexAngle) * vertexRadius;
        vertexIndex === 0 ? ringGraphics.moveTo(vertexX, vertexY) : ringGraphics.lineTo(vertexX, vertexY);
      }
      ringGraphics.closePath();
      ringGraphics.strokePath();
      ringGraphics.fillPath();

      ctx.scene.tweens.add({
        targets: ringGraphics,
        scaleX: radius / 10,
        scaleY: radius / 10,
        alpha: 0,
        duration: 400,
        ease: 'Cubic.easeOut',
        onComplete: () => ringGraphics.destroy(),
      });
    }

    // --- Snowflake crystals ---
    const crystalCount = quality === 'high' ? 8 : quality === 'medium' ? 6 : 4;

    for (let crystalIndex = 0; crystalIndex < crystalCount; crystalIndex++) {
      const spreadAngle = (crystalIndex / crystalCount) * Math.PI * 2;
      const crystal = ctx.scene.add.graphics();
      crystal.setPosition(ctx.playerX, ctx.playerY);
      crystal.setDepth(DepthLayers.FROST_NOVA_CRYSTAL);

      crystal.lineStyle(1, 0xffffff, 0.8);
      crystal.fillStyle(WEAPON_COLORS.frost.core, 0.6);

      if (quality === 'high') {
        // High: detailed snowflake with branches, barbs, and hexagonal center
        const branchLength = 8;
        for (let rayIndex = 0; rayIndex < 6; rayIndex++) {
          const rayAngle = (rayIndex / 6) * Math.PI * 2;
          const branchEndX = Math.cos(rayAngle) * branchLength;
          const branchEndY = Math.sin(rayAngle) * branchLength;
          // Main branch
          crystal.lineBetween(0, 0, branchEndX, branchEndY);

          // Barbs at 50% along branch
          const midDistance = branchLength * 0.5;
          const barbLength = 3;
          const barbAngleLeft = rayAngle + Math.PI / 4;
          const barbAngleRight = rayAngle - Math.PI / 4;
          const midX = Math.cos(rayAngle) * midDistance;
          const midY = Math.sin(rayAngle) * midDistance;
          crystal.lineBetween(midX, midY,
            midX + Math.cos(barbAngleLeft) * barbLength, midY + Math.sin(barbAngleLeft) * barbLength);
          crystal.lineBetween(midX, midY,
            midX + Math.cos(barbAngleRight) * barbLength, midY + Math.sin(barbAngleRight) * barbLength);

          // Barbs at 75% along branch
          const upperDistance = branchLength * 0.75;
          const upperBarbLength = 2;
          const upperX = Math.cos(rayAngle) * upperDistance;
          const upperY = Math.sin(rayAngle) * upperDistance;
          crystal.lineBetween(upperX, upperY,
            upperX + Math.cos(barbAngleLeft) * upperBarbLength, upperY + Math.sin(barbAngleLeft) * upperBarbLength);
          crystal.lineBetween(upperX, upperY,
            upperX + Math.cos(barbAngleRight) * upperBarbLength, upperY + Math.sin(barbAngleRight) * upperBarbLength);
        }
        // Hexagonal center
        crystal.lineStyle(1, 0xffffff, 0.6);
        crystal.beginPath();
        for (let hexIndex = 0; hexIndex < 6; hexIndex++) {
          const hexAngle = (hexIndex / 6) * Math.PI * 2;
          const hexX = Math.cos(hexAngle) * 2.5;
          const hexY = Math.sin(hexAngle) * 2.5;
          hexIndex === 0 ? crystal.moveTo(hexX, hexY) : crystal.lineTo(hexX, hexY);
        }
        crystal.closePath();
        crystal.strokePath();
      } else {
        // Low/Medium: simple 6-line stars with center dot
        for (let rayIndex = 0; rayIndex < 6; rayIndex++) {
          const rayAngle = (rayIndex / 6) * Math.PI * 2;
          const rayEndX = Math.cos(rayAngle) * 8;
          const rayEndY = Math.sin(rayAngle) * 8;
          crystal.beginPath();
          crystal.moveTo(0, 0);
          crystal.lineTo(rayEndX, rayEndY);
          crystal.strokePath();
        }
        crystal.fillCircle(0, 0, 2);
      }

      const targetX = ctx.playerX + Math.cos(spreadAngle) * radius;
      const targetY = ctx.playerY + Math.sin(spreadAngle) * radius;

      ctx.scene.tweens.add({
        targets: crystal,
        x: targetX,
        y: targetY,
        alpha: 0,
        duration: 500,
        ease: 'Cubic.easeOut',
        onComplete: () => crystal.destroy(),
      });
    }
  }

  private createGroundFrost(ctx: WeaponContext, radius: number): void {
    const quality = ctx.visualQuality;
    const frostRadius = radius * 0.8;

    if (quality === 'high') {
      // High: fractal frost pattern with branching lines and animated reveal
      const fractalFrost = ctx.scene.add.graphics();
      fractalFrost.setPosition(ctx.playerX, ctx.playerY);
      fractalFrost.setDepth(DepthLayers.GROUND_EFFECTS);

      const totalBranches = 6;
      const branchDepthLevels = 2;

      // Use a tween counter to progressively reveal the fractal pattern
      const revealState = { progress: 0 };
      ctx.scene.tweens.add({
        targets: revealState,
        progress: 1,
        duration: 600,
        ease: 'Cubic.easeOut',
        onUpdate: () => {
          fractalFrost.clear();

          // Central circle
          fractalFrost.fillStyle(WEAPON_COLORS.frost.core, 0.12 * revealState.progress);
          fractalFrost.fillCircle(0, 0, frostRadius * 0.15 * revealState.progress);
          fractalFrost.lineStyle(1, WEAPON_COLORS.frost.glow, 0.3 * revealState.progress);
          fractalFrost.strokeCircle(0, 0, frostRadius * 0.15 * revealState.progress);

          // Draw fractal branches
          const visibleLength = frostRadius * revealState.progress;
          for (let branchIndex = 0; branchIndex < totalBranches; branchIndex++) {
            const branchAngle = (branchIndex / totalBranches) * Math.PI * 2;
            const mainEndX = Math.cos(branchAngle) * visibleLength;
            const mainEndY = Math.sin(branchAngle) * visibleLength;

            // Main radial line
            fractalFrost.lineStyle(1.5, WEAPON_COLORS.frost.glow, 0.25 * revealState.progress);
            fractalFrost.lineBetween(0, 0, mainEndX, mainEndY);

            // Level 1 sub-branches at 60% along main branch
            if (revealState.progress > 0.4) {
              const subBranchProgress = Math.min(1, (revealState.progress - 0.4) / 0.3);
              const subOriginDistance = visibleLength * 0.6;
              const subOriginX = Math.cos(branchAngle) * subOriginDistance;
              const subOriginY = Math.sin(branchAngle) * subOriginDistance;
              const subBranchLength = frostRadius * 0.35 * subBranchProgress;

              for (let subDirection = -1; subDirection <= 1; subDirection += 2) {
                const subAngle = branchAngle + subDirection * (Math.PI / 4);
                const subEndX = subOriginX + Math.cos(subAngle) * subBranchLength;
                const subEndY = subOriginY + Math.sin(subAngle) * subBranchLength;
                fractalFrost.lineStyle(1, WEAPON_COLORS.frost.glow, 0.2 * subBranchProgress);
                fractalFrost.lineBetween(subOriginX, subOriginY, subEndX, subEndY);

                // Level 2 sub-sub-branches at 60% along sub-branch
                if (branchDepthLevels >= 2 && revealState.progress > 0.7) {
                  const subSubProgress = Math.min(1, (revealState.progress - 0.7) / 0.3);
                  const subSubOriginX = subOriginX + Math.cos(subAngle) * subBranchLength * 0.6;
                  const subSubOriginY = subOriginY + Math.sin(subAngle) * subBranchLength * 0.6;
                  const subSubLength = frostRadius * 0.15 * subSubProgress;

                  for (let subSubDir = -1; subSubDir <= 1; subSubDir += 2) {
                    const subSubAngle = subAngle + subSubDir * (Math.PI / 4);
                    const subSubEndX = subSubOriginX + Math.cos(subSubAngle) * subSubLength;
                    const subSubEndY = subSubOriginY + Math.sin(subSubAngle) * subSubLength;
                    fractalFrost.lineStyle(0.5, WEAPON_COLORS.frost.glow, 0.15 * subSubProgress);
                    fractalFrost.lineBetween(subSubOriginX, subSubOriginY, subSubEndX, subSubEndY);
                  }
                }
              }
            }
          }
        },
      });

      // Fade out over the slow duration
      ctx.scene.tweens.add({
        targets: fractalFrost,
        alpha: 0,
        delay: 600,
        duration: this.stats.duration * 1000 - 600,
        onComplete: () => fractalFrost.destroy(),
      });
    } else {
      // Low/Medium: plain circle ground frost
      const groundFrost = ctx.scene.add.circle(ctx.playerX, ctx.playerY, frostRadius, WEAPON_COLORS.frost.core, 0.12);
      groundFrost.setStrokeStyle(1, WEAPON_COLORS.frost.glow, 0.3);
      groundFrost.setDepth(DepthLayers.GROUND_EFFECTS);

      ctx.scene.tweens.add({
        targets: groundFrost,
        alpha: 0,
        duration: this.stats.duration * 1000,
        onComplete: () => groundFrost.destroy(),
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
    // Diamond-shaped frost indicator
    const frostDiamond = ctx.scene.add.graphics();
    frostDiamond.setPosition(x, y);
    frostDiamond.setDepth(DepthLayers.FROST_INDICATOR);

    // Draw diamond: 4 vertices at N/E/S/W, 8px from center
    frostDiamond.fillStyle(WEAPON_COLORS.frost.core, 0.8);
    frostDiamond.beginPath();
    frostDiamond.moveTo(0, -8);
    frostDiamond.lineTo(8, 0);
    frostDiamond.lineTo(0, 8);
    frostDiamond.lineTo(-8, 0);
    frostDiamond.closePath();
    frostDiamond.fillPath();

    frostDiamond.lineStyle(1, 0xffffff, 0.8);
    frostDiamond.strokePath();

    ctx.scene.tweens.add({
      targets: frostDiamond,
      alpha: 0,
      scaleX: 0.5,
      scaleY: 0.5,
      duration: this.stats.duration * 1000,
      onComplete: () => frostDiamond.destroy(),
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    // Check for expired slows and dead frozen enemies (Absolute Zero mastery)
    const toRemove: number[] = [];

    for (const [enemyId, data] of this.slowedEnemies) {
      // Check if enemy is dead - remove stale entries
      if (Health.current[enemyId] <= 0) {
        if (this.isMastered()) {
          // Mastery: Absolute Zero - trigger shatter effect before removal
          const ex = Transform.x[enemyId];
          const ey = Transform.y[enemyId];
          this.triggerShatterEffect(ctx, ex, ey, data.maxHealth);
        }
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
      const distSq = dx * dx + dy * dy;

      if (distSq <= shatterRadius * shatterRadius && distSq > 0) {
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
    const quality = ctx.visualQuality;
    const shardCount = quality === 'high' ? 12 : quality === 'medium' ? 6 : 4;

    for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
      const shardAngle = (shardIndex / shardCount) * Math.PI * 2;
      const shard = ctx.scene.add.graphics();
      shard.setPosition(x, y);
      shard.setDepth(DepthLayers.SHATTER);

      shard.fillStyle(WEAPON_COLORS.frost.glow, 1);
      shard.lineStyle(1, 0xffffff, 1);

      if (quality === 'high') {
        // High: asymmetric quadrilateral shards with randomized proportions
        const shardHeight = 6 + Math.random() * 5;
        const shardWidthLeft = 1.5 + Math.random() * 2.5;
        const shardWidthRight = 1.5 + Math.random() * 2.5;
        const shardMidOffset = (Math.random() - 0.5) * 3;
        shard.beginPath();
        shard.moveTo(0, -shardHeight);
        shard.lineTo(shardWidthRight, shardMidOffset);
        shard.lineTo(0, shardHeight * 0.7);
        shard.lineTo(-shardWidthLeft, shardMidOffset * 0.5);
        shard.closePath();
        shard.fillPath();
        shard.strokePath();
      } else {
        // Low/Medium: simple diamond shards
        shard.beginPath();
        shard.moveTo(0, -8);
        shard.lineTo(3, 0);
        shard.lineTo(0, 8);
        shard.lineTo(-3, 0);
        shard.closePath();
        shard.fillPath();
        shard.strokePath();
      }

      shard.setRotation(shardAngle);

      const shardTargetX = x + Math.cos(shardAngle) * 80;
      const shardTargetY = y + Math.sin(shardAngle) * 80;

      ctx.scene.tweens.add({
        targets: shard,
        x: shardTargetX,
        y: shardTargetY,
        alpha: 0,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: 400,
        ease: 'Cubic.easeOut',
        onComplete: () => shard.destroy(),
      });
    }

    // High quality: additional fast-moving dust circles
    if (quality === 'high') {
      const dustCount = 6;
      for (let dustIndex = 0; dustIndex < dustCount; dustIndex++) {
        const dustAngle = (dustIndex / dustCount) * Math.PI * 2 + Math.random() * 0.5;
        const dustParticle = ctx.scene.add.circle(x, y, 1.5, 0xffffff, 0.8);
        dustParticle.setDepth(DepthLayers.SHATTER);

        const dustTargetX = x + Math.cos(dustAngle) * 100;
        const dustTargetY = y + Math.sin(dustAngle) * 100;

        ctx.scene.tweens.add({
          targets: dustParticle,
          x: dustTargetX,
          y: dustTargetY,
          alpha: 0,
          duration: 250,
          ease: 'Cubic.easeOut',
          onComplete: () => dustParticle.destroy(),
        });
      }
    }

    // Central burst
    const burst = ctx.scene.add.circle(x, y, 5, 0xffffff, 1);
    burst.setDepth(DepthLayers.FINISHING_BLOW);
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
