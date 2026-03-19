import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { VisualQuality } from '../visual/GlowGraphics';

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

    const currentQuality = ctx.visualQuality;

    // Initial draw of all connections
    for (const conn of connections) {
      this.drawLightningBolt(conn.from.x, conn.from.y, conn.to.x, conn.to.y, currentQuality);
    }

    // Sparks at all hit points
    for (const target of targets) {
      ctx.effectsManager.playHitSparks(target.x, target.y, 0);
    }

    // Impact point flashes (cap at 8)
    const impactFlashCount = Math.min(targets.length, 8);
    for (let flashIndex = 0; flashIndex < impactFlashCount; flashIndex++) {
      const target = targets[flashIndex];
      const impactFlash = ctx.scene.add.circle(target.x, target.y, 8, 0x88ccff, 0.8);
      impactFlash.setDepth(16);
      ctx.scene.tweens.add({
        targets: impactFlash,
        scaleX: 2.5,
        scaleY: 2.5,
        alpha: 0,
        duration: 100,
        onComplete: () => impactFlash.destroy(),
      });
    }

    // Snapshot connections and target positions for re-randomization
    const connectionSnapshot = connections.map(conn => ({
      fromX: conn.from.x,
      fromY: conn.from.y,
      toX: conn.to.x,
      toY: conn.to.y,
    }));
    const targetPositionSnapshot = targets.map(target => ({ x: target.x, y: target.y }));

    // Animated bolt re-randomization
    const animatedGraphics = this.lightningGraphics;
    ctx.scene.tweens.addCounter({
      from: 1,
      to: 0,
      duration: this.stats.duration * 1000 * 1.5,
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        if (!animatedGraphics || !animatedGraphics.scene) return;
        const counterValue = tween.getValue() ?? 0;
        animatedGraphics.clear();
        animatedGraphics.setAlpha(counterValue);
        for (const conn of connectionSnapshot) {
          this.drawLightningBoltOn(animatedGraphics, conn.fromX, conn.fromY, conn.toX, conn.toY, currentQuality);
        }

        // High quality: impact sparks + radial pulse web + energy node dots
        if (currentQuality === 'high') {
          this.drawImpactSparks(animatedGraphics, targetPositionSnapshot, counterValue);

          // Radial pulse: modulate connection width and alpha with sine wave
          const pulsePhase = Math.sin(counterValue * Math.PI * 2);
          const pulseAlpha = 0.15 + pulsePhase * 0.1;
          const pulseWidth = 4 + pulsePhase * 2;
          animatedGraphics.lineStyle(pulseWidth, 0x4488ff, pulseAlpha * counterValue);
          for (const conn of connectionSnapshot) {
            animatedGraphics.beginPath();
            animatedGraphics.moveTo(conn.fromX, conn.fromY);
            animatedGraphics.lineTo(conn.toX, conn.toY);
            animatedGraphics.strokePath();
          }

          // Energy node dots at each target position
          const nodeRadius = 3 + pulsePhase;
          const nodeAlpha = (0.6 + pulsePhase * 0.3) * counterValue;
          for (const targetPosition of targetPositionSnapshot) {
            animatedGraphics.fillStyle(0xaaddff, nodeAlpha);
            animatedGraphics.fillCircle(targetPosition.x, targetPosition.y, nodeRadius);
            // Outer glow ring
            animatedGraphics.lineStyle(1, 0x88ccff, nodeAlpha * 0.5);
            animatedGraphics.strokeCircle(targetPosition.x, targetPosition.y, nodeRadius + 3);
          }
        }
      },
      onComplete: () => {
        if (animatedGraphics && animatedGraphics.scene) {
          animatedGraphics.destroy();
        }
        if (this.lightningGraphics === animatedGraphics) {
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

    // Build segment list: player -> target1 -> target2 -> ...
    const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
    let segStartX = ctx.playerX;
    let segStartY = ctx.playerY;
    for (const target of targets) {
      segments.push({ x1: segStartX, y1: segStartY, x2: target.x, y2: target.y });
      segStartX = target.x;
      segStartY = target.y;
    }

    const currentQuality = ctx.visualQuality;

    // Initial draw
    for (const segment of segments) {
      this.drawLightningBolt(segment.x1, segment.y1, segment.x2, segment.y2, currentQuality);
    }

    // Spark at each hit point
    for (const target of targets) {
      ctx.effectsManager.playHitSparks(target.x, target.y, 0);
    }

    // Impact point flashes (cap at 8)
    const impactFlashCount = Math.min(targets.length, 8);
    for (let flashIndex = 0; flashIndex < impactFlashCount; flashIndex++) {
      const target = targets[flashIndex];
      const impactFlash = ctx.scene.add.circle(target.x, target.y, 8, 0x88ccff, 0.8);
      impactFlash.setDepth(16);
      ctx.scene.tweens.add({
        targets: impactFlash,
        scaleX: 2.5,
        scaleY: 2.5,
        alpha: 0,
        duration: 100,
        onComplete: () => impactFlash.destroy(),
      });
    }

    // Snapshot target positions for impact sparks during animation
    const targetPositionSnapshot = targets.map(target => ({ x: target.x, y: target.y }));

    // Animated bolt re-randomization: redraw with fresh random offsets each frame
    const animatedGraphics = this.lightningGraphics;
    ctx.scene.tweens.addCounter({
      from: 1,
      to: 0,
      duration: this.stats.duration * 1000,
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        if (!animatedGraphics || !animatedGraphics.scene) return;
        const counterValue = tween.getValue() ?? 0;
        animatedGraphics.clear();
        animatedGraphics.setAlpha(counterValue);
        for (const segment of segments) {
          this.drawLightningBoltOn(animatedGraphics, segment.x1, segment.y1, segment.x2, segment.y2, currentQuality);
        }

        // High quality: draw impact sparks at each hit point (re-randomized each frame for crackle)
        if (currentQuality === 'high') {
          this.drawImpactSparks(animatedGraphics, targetPositionSnapshot, counterValue);
        }
      },
      onComplete: () => {
        if (animatedGraphics && animatedGraphics.scene) {
          animatedGraphics.destroy();
        }
        if (this.lightningGraphics === animatedGraphics) {
          this.lightningGraphics = null;
        }
      },
    });
  }

  private drawLightningBolt(x1: number, y1: number, x2: number, y2: number, quality: VisualQuality = 'medium'): void {
    if (!this.lightningGraphics) return;
    this.drawLightningBoltOn(this.lightningGraphics, x1, y1, x2, y2, quality);
  }

  private drawLightningBoltOn(
    graphics: Phaser.GameObjects.Graphics,
    x1: number, y1: number, x2: number, y2: number,
    quality: VisualQuality = 'medium'
  ): void {
    const segmentCount = quality === 'high' ? 8 : quality === 'medium' ? 6 : 4;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;
    const perpX = -dy / dist;
    const perpY = dx / dist;

    // Build the jagged segment path once, shared by all 3 layers
    const segmentPoints: { x: number; y: number }[] = [{ x: x1, y: y1 }];
    for (let segmentIndex = 1; segmentIndex < segmentCount; segmentIndex++) {
      const interpolation = segmentIndex / segmentCount;
      const baseX = x1 + dx * interpolation;
      const baseY = y1 + dy * interpolation;
      const offset = (Math.random() - 0.5) * 20 * this.stats.size;
      const pointX = baseX + perpX * offset;
      const pointY = baseY + perpY * offset;
      segmentPoints.push({ x: pointX, y: pointY });
    }
    segmentPoints.push({ x: x2, y: y2 });

    // Glow layer - follows the jagged path
    graphics.lineStyle(8, 0x4488ff, 0.3);
    graphics.beginPath();
    graphics.moveTo(segmentPoints[0].x, segmentPoints[0].y);
    for (let pointIndex = 1; pointIndex < segmentPoints.length; pointIndex++) {
      graphics.lineTo(segmentPoints[pointIndex].x, segmentPoints[pointIndex].y);
    }
    graphics.strokePath();

    // Main bolt layer - follows the same jagged path
    graphics.lineStyle(3, 0x88ccff, 1);
    graphics.beginPath();
    graphics.moveTo(segmentPoints[0].x, segmentPoints[0].y);
    for (let pointIndex = 1; pointIndex < segmentPoints.length; pointIndex++) {
      graphics.lineTo(segmentPoints[pointIndex].x, segmentPoints[pointIndex].y);
    }
    graphics.strokePath();

    // Core layer - follows the same jagged path
    graphics.lineStyle(1, 0xffffff, 1);
    graphics.beginPath();
    graphics.moveTo(segmentPoints[0].x, segmentPoints[0].y);
    for (let pointIndex = 1; pointIndex < segmentPoints.length; pointIndex++) {
      graphics.lineTo(segmentPoints[pointIndex].x, segmentPoints[pointIndex].y);
    }
    graphics.strokePath();

    // Branching micro-bolts: quality-dependent chance and complexity
    const branchChance = quality === 'high' ? 0.65 : quality === 'medium' ? 0.50 : 0.40;
    const maxBranchSegments = quality === 'high' ? 3 : quality === 'medium' ? 2 : 1;
    const minBranchSegments = 1;

    graphics.lineStyle(1, 0xaaddff, 0.5);
    for (let segmentIndex = 1; segmentIndex < segmentPoints.length - 1; segmentIndex++) {
      if (Math.random() > branchChance) continue;

      const branchOrigin = segmentPoints[segmentIndex];
      const nextPoint = segmentPoints[segmentIndex + 1];
      const mainDirectionX = nextPoint.x - branchOrigin.x;
      const mainDirectionY = nextPoint.y - branchOrigin.y;
      const mainAngle = Math.atan2(mainDirectionY, mainDirectionX);

      // Diverge at +/- 30 to 45 degrees
      const branchAngle = mainAngle + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 6 + Math.random() * Math.PI / 12);
      const branchSegments = minBranchSegments + Math.floor(Math.random() * (maxBranchSegments - minBranchSegments + 1));
      const branchLength = 15 + Math.random() * 15;

      graphics.beginPath();
      graphics.moveTo(branchOrigin.x, branchOrigin.y);

      let branchCurrentX = branchOrigin.x;
      let branchCurrentY = branchOrigin.y;
      let lastBranchX = branchCurrentX;
      let lastBranchY = branchCurrentY;
      for (let branchStep = 0; branchStep < branchSegments; branchStep++) {
        const stepLength = branchLength / branchSegments;
        branchCurrentX += Math.cos(branchAngle) * stepLength + (Math.random() - 0.5) * 6;
        branchCurrentY += Math.sin(branchAngle) * stepLength + (Math.random() - 0.5) * 6;
        graphics.lineTo(branchCurrentX, branchCurrentY);
        lastBranchX = branchCurrentX;
        lastBranchY = branchCurrentY;
      }
      graphics.strokePath();

      // High quality: 20% chance of sub-fork from branch tip
      if (quality === 'high' && Math.random() < 0.20) {
        const subForkAngle = branchAngle + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 5 + Math.random() * Math.PI / 8);
        const subForkLength = 8 + Math.random() * 10;
        graphics.beginPath();
        graphics.moveTo(lastBranchX, lastBranchY);
        graphics.lineTo(
          lastBranchX + Math.cos(subForkAngle) * subForkLength,
          lastBranchY + Math.sin(subForkAngle) * subForkLength
        );
        graphics.strokePath();
      }
    }
  }

  /**
   * Draw 4 spark lines per impact point, re-randomized each frame for a crackle effect.
   * Used at high quality during the animated tween onUpdate.
   */
  private drawImpactSparks(
    graphics: Phaser.GameObjects.Graphics,
    targetPositions: { x: number; y: number }[],
    alphaMultiplier: number
  ): void {
    const sparkCount = 4;
    const sparkLength = 8;
    graphics.lineStyle(1, 0xccddff, 0.7 * alphaMultiplier);
    for (const targetPosition of targetPositions) {
      for (let sparkIndex = 0; sparkIndex < sparkCount; sparkIndex++) {
        const sparkAngle = Math.random() * Math.PI * 2;
        const sparkDist = 3 + Math.random() * sparkLength;
        graphics.beginPath();
        graphics.moveTo(targetPosition.x, targetPosition.y);
        graphics.lineTo(
          targetPosition.x + Math.cos(sparkAngle) * sparkDist,
          targetPosition.y + Math.sin(sparkAngle) * sparkDist
        );
        graphics.strokePath();
      }
    }
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
