import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getJuiceManager } from '../effects/JuiceManager';
import { DepthLayers } from '../visual/DepthLayers';
import type { VisualQuality } from '../visual/GlowGraphics';

/**
 * MeteorWeapon drops devastating meteors on enemy clusters.
 * High damage AOE, but with a delay before impact.
 */
export class MeteorWeapon extends BaseWeapon {
  private currentQuality: VisualQuality = 'high';

  private pendingMeteors: {
    x: number;
    y: number;
    delay: number;
    damage: number;
    radius: number;
    warning: Phaser.GameObjects.Arc;
    warningOverlay?: Phaser.GameObjects.Graphics;
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
    this.currentQuality = ctx.visualQuality;

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

      const explosionRadius = 60 * this.stats.size;

      // Create base warning circle (used at all quality levels for type consistency)
      const warning = ctx.scene.add.circle(x, y, explosionRadius, 0x4488ff, 0.2);
      warning.setStrokeStyle(2, 0x2266dd, 0.5);
      warning.setDepth(DepthLayers.GROUND_SPIKE_WARNING);

      let warningOverlay: Phaser.GameObjects.Graphics | undefined;

      if (this.currentQuality === 'low') {
        // Low: plain pulsing circle only
        ctx.scene.tweens.add({
          targets: warning,
          scaleX: 1.1,
          scaleY: 1.1,
          alpha: 0.4,
          duration: 200,
          yoyo: true,
          repeat: Math.floor(this.stats.duration * 1000 / 400),
        });
      } else if (this.currentQuality === 'medium') {
        // Medium: ring + center dot overlay
        warning.setAlpha(0.05); // Dim the base circle, overlay does the visuals

        warningOverlay = ctx.scene.add.graphics();
        warningOverlay.setPosition(x, y);
        warningOverlay.setDepth(DepthLayers.GROUND_SPIKE_WARNING);
        warningOverlay.lineStyle(2, 0x2266dd, 0.5);
        warningOverlay.strokeCircle(0, 0, explosionRadius);
        warningOverlay.fillStyle(0x4488ff, 0.3);
        warningOverlay.fillCircle(0, 0, 5);

        // Pulse both together
        ctx.scene.tweens.add({
          targets: [warning, warningOverlay],
          scaleX: 1.1,
          scaleY: 1.1,
          alpha: 0.4,
          duration: 200,
          yoyo: true,
          repeat: Math.floor(this.stats.duration * 1000 / 400),
        });
      } else {
        // High: full targeting reticle with rotation animation
        warning.setAlpha(0.05); // Dim the base circle, overlay does the visuals

        warningOverlay = ctx.scene.add.graphics();
        warningOverlay.setPosition(x, y);
        warningOverlay.setDepth(DepthLayers.GROUND_SPIKE_WARNING);

        // Animated reticle redrawn each frame via addCounter
        const reticleStartTime = ctx.gameTime;
        ctx.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: this.stats.duration * 1000,
          onUpdate: () => {
            if (!warningOverlay || !warningOverlay.scene) return;
            warningOverlay.clear();

            const elapsedTime = reticleStartTime + (Date.now() * 0.001 - reticleStartTime);
            const rotAngle = elapsedTime * 2;

            // Outer ring
            warningOverlay.lineStyle(2, 0x2266dd, 0.5);
            warningOverlay.strokeCircle(0, 0, explosionRadius);

            // Crosshair lines
            warningOverlay.lineStyle(1, 0x4488ff, 0.3);
            warningOverlay.lineBetween(-explosionRadius, 0, explosionRadius, 0);
            warningOverlay.lineBetween(0, -explosionRadius, 0, explosionRadius);

            // 8 rotating dash arcs
            for (let dashIndex = 0; dashIndex < 8; dashIndex++) {
              const dashAngle = rotAngle + (dashIndex / 8) * Math.PI * 2;
              const dashStart = explosionRadius * 0.7;
              const dashEnd = explosionRadius * 0.9;
              warningOverlay.lineStyle(2, 0x4488ff, 0.4);
              warningOverlay.lineBetween(
                Math.cos(dashAngle) * dashStart, Math.sin(dashAngle) * dashStart,
                Math.cos(dashAngle) * dashEnd, Math.sin(dashAngle) * dashEnd
              );
            }

            // Pulsing center dot
            const dotPulse = 3 + Math.sin(elapsedTime * 8) * 2;
            warningOverlay.fillStyle(0x88ccff, 0.6);
            warningOverlay.fillCircle(0, 0, dotPulse);
          },
        });

        // Pulse the base warning alongside
        ctx.scene.tweens.add({
          targets: warning,
          scaleX: 1.1,
          scaleY: 1.1,
          duration: 200,
          yoyo: true,
          repeat: Math.floor(this.stats.duration * 1000 / 400),
        });
      }

      this.pendingMeteors.push({
        x,
        y,
        delay: this.stats.duration,
        damage: this.stats.damage,
        radius: explosionRadius,
        warning,
        warningOverlay,
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
    // Remove warning and overlay
    meteor.warning.destroy();
    if (meteor.warningOverlay) {
      meteor.warningOverlay.destroy();
    }

    // Visual explosion
    this.createExplosion(ctx, meteor.x, meteor.y, meteor.radius, this.currentQuality);

    // Impact feel scales with quality
    if (this.currentQuality === 'high') {
      getJuiceManager().screenShake(0.006, 250);
      ctx.effectsManager.playImpactFlash(0.15, 60);
    } else {
      getJuiceManager().screenShake(0.004, 200);
    }

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
    graphics.setDepth(DepthLayers.GROUND_SPIKE_WARNING);

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

    if (this.currentQuality === 'low') {
      // Low: gradient circles + triangle flames
      const flameCount = 6;
      for (let i = 0; i < flameCount; i++) {
        const angle = (i / flameCount) * Math.PI * 2 + gameTime * 2;
        const flameHeight = 15 + Math.sin(gameTime * 8 + i) * 8;
        const flameX = zone.x + Math.cos(angle) * zone.radius * 0.6;
        const flameY = zone.y + Math.sin(angle) * zone.radius * 0.6;

        zone.graphics.fillStyle(0xffcc00, alpha * 0.7);
        zone.graphics.fillTriangle(
          flameX - 5, flameY,
          flameX + 5, flameY,
          flameX, flameY - flameHeight
        );
      }
    } else if (this.currentQuality === 'medium') {
      // Medium: triangle flames + pulsing edge ring
      const flameCount = 6;
      for (let i = 0; i < flameCount; i++) {
        const angle = (i / flameCount) * Math.PI * 2 + gameTime * 2;
        const flameHeight = 15 + Math.sin(gameTime * 8 + i) * 8;
        const flameX = zone.x + Math.cos(angle) * zone.radius * 0.6;
        const flameY = zone.y + Math.sin(angle) * zone.radius * 0.6;

        zone.graphics.fillStyle(0xffcc00, alpha * 0.7);
        zone.graphics.fillTriangle(
          flameX - 5, flameY,
          flameX + 5, flameY,
          flameX, flameY - flameHeight
        );
      }

      // Pulsing edge ring
      const edgePulse = 0.3 + Math.sin(gameTime * 6) * 0.15;
      zone.graphics.lineStyle(2, 0xff6600, alpha * edgePulse);
      zone.graphics.strokeCircle(zone.x, zone.y, zone.radius);
    } else {
      // High: curved organic flame shapes + ember dots + pulsing edge ring
      const flameCount = 6;
      for (let i = 0; i < flameCount; i++) {
        const angle = (i / flameCount) * Math.PI * 2 + gameTime * 2;
        const flameHeight = 15 + Math.sin(gameTime * 8 + i) * 8;
        const flameX = zone.x + Math.cos(angle) * zone.radius * 0.6;
        const flameY = zone.y + Math.sin(angle) * zone.radius * 0.6;

        // Bezier-based organic flame shapes
        zone.graphics.fillStyle(0xffcc00, alpha * 0.7);
        zone.graphics.beginPath();
        zone.graphics.moveTo(flameX - 5, flameY);
        zone.graphics.lineTo(flameX - 3, flameY - flameHeight * 0.5);
        zone.graphics.lineTo(flameX + 2, flameY - flameHeight * 0.7);
        zone.graphics.lineTo(flameX, flameY - flameHeight);
        zone.graphics.lineTo(flameX - 1, flameY - flameHeight * 0.6);
        zone.graphics.lineTo(flameX + 3, flameY - flameHeight * 0.4);
        zone.graphics.lineTo(flameX + 5, flameY);
        zone.graphics.closePath();
        zone.graphics.fillPath();
      }

      // 4 ember dots that drift upward
      for (let emberIndex = 0; emberIndex < 4; emberIndex++) {
        const emberAngle = (emberIndex / 4) * Math.PI * 2 + gameTime * 3;
        const emberDrift = (gameTime * 20 + emberIndex * 17) % 30;
        const emberX = zone.x + Math.cos(emberAngle) * zone.radius * 0.4;
        const emberY = zone.y + Math.sin(emberAngle) * zone.radius * 0.4 - emberDrift;
        const emberAlpha = alpha * (1 - emberDrift / 30) * 0.8;

        zone.graphics.fillStyle(0xffaa00, emberAlpha);
        zone.graphics.fillCircle(emberX, emberY, 2);
      }

      // Pulsing edge ring
      const edgePulse = 0.3 + Math.sin(gameTime * 6) * 0.15;
      zone.graphics.lineStyle(2, 0xff6600, alpha * edgePulse);
      zone.graphics.strokeCircle(zone.x, zone.y, zone.radius);
    }
  }

  private createExplosion(
    ctx: WeaponContext,
    x: number,
    y: number,
    radius: number,
    quality: VisualQuality
  ): void {
    // --- Meteor falling trail ---
    const fallingTrailGraphics = ctx.scene.add.graphics();
    fallingTrailGraphics.setDepth(DepthLayers.METEOR);

    ctx.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 100,
      onUpdate: (tween) => {
        const trailProgress = tween.getValue() ?? 0;
        fallingTrailGraphics.clear();
        const currentTrailY = (y - 200) + trailProgress * 200;

        if (quality === 'high') {
          // High: wider outer trail + thin core + white-hot tip + spark lines + smoke wisps
          fallingTrailGraphics.lineStyle(8, 0x4488ff, 0.8 * (1 - trailProgress * 0.3));
          fallingTrailGraphics.beginPath();
          fallingTrailGraphics.moveTo(x, currentTrailY - 30);
          fallingTrailGraphics.lineTo(x, currentTrailY);
          fallingTrailGraphics.strokePath();

          fallingTrailGraphics.lineStyle(3, 0xffffff, 1);
          fallingTrailGraphics.beginPath();
          fallingTrailGraphics.moveTo(x, currentTrailY - 30);
          fallingTrailGraphics.lineTo(x, currentTrailY);
          fallingTrailGraphics.strokePath();

          // White-hot tip circle
          fallingTrailGraphics.fillStyle(0xffffff, 0.9);
          fallingTrailGraphics.fillCircle(x, currentTrailY, 5);

          // 3 short spark lines radiating from tip
          for (let sparkIndex = 0; sparkIndex < 3; sparkIndex++) {
            const sparkAngle = Math.random() * Math.PI * 2;
            const sparkLength = 6 + Math.random() * 6;
            fallingTrailGraphics.lineStyle(1, 0x88ccff, 0.6);
            fallingTrailGraphics.lineBetween(
              x, currentTrailY,
              x + Math.cos(sparkAngle) * sparkLength,
              currentTrailY + Math.sin(sparkAngle) * sparkLength
            );
          }

          // 2 small grey smoke wisps behind the tip
          for (let wispIndex = 0; wispIndex < 2; wispIndex++) {
            const wispOffsetX = (Math.random() - 0.5) * 10;
            const wispOffsetY = -8 - wispIndex * 10;
            const wispAlpha = 0.3 * (1 - trailProgress);
            fallingTrailGraphics.fillStyle(0x888888, wispAlpha);
            fallingTrailGraphics.fillCircle(x + wispOffsetX, currentTrailY + wispOffsetY, 3);
          }
        } else if (quality === 'medium') {
          // Medium: standard trail lines + white-hot tip
          fallingTrailGraphics.lineStyle(6, 0x4488ff, 0.8 * (1 - trailProgress * 0.3));
          fallingTrailGraphics.beginPath();
          fallingTrailGraphics.moveTo(x, currentTrailY - 30);
          fallingTrailGraphics.lineTo(x, currentTrailY);
          fallingTrailGraphics.strokePath();

          fallingTrailGraphics.lineStyle(2, 0xffffff, 1);
          fallingTrailGraphics.beginPath();
          fallingTrailGraphics.moveTo(x, currentTrailY - 30);
          fallingTrailGraphics.lineTo(x, currentTrailY);
          fallingTrailGraphics.strokePath();

          // White-hot tip circle
          fallingTrailGraphics.fillStyle(0xffffff, 0.9);
          fallingTrailGraphics.fillCircle(x, currentTrailY, 4);
        } else {
          // Low: 2 vertical lines (original)
          fallingTrailGraphics.lineStyle(6, 0x4488ff, 0.8 * (1 - trailProgress * 0.3));
          fallingTrailGraphics.beginPath();
          fallingTrailGraphics.moveTo(x, currentTrailY - 30);
          fallingTrailGraphics.lineTo(x, currentTrailY);
          fallingTrailGraphics.strokePath();

          fallingTrailGraphics.lineStyle(2, 0xffffff, 1);
          fallingTrailGraphics.beginPath();
          fallingTrailGraphics.moveTo(x, currentTrailY - 30);
          fallingTrailGraphics.lineTo(x, currentTrailY);
          fallingTrailGraphics.strokePath();
        }
      },
      onComplete: () => fallingTrailGraphics.destroy(),
    });

    // --- Meteor sphere ---
    if (quality === 'medium' || quality === 'high') {
      // Medium/High: 3-layer meteor sphere drawn on Graphics
      const meteorGraphics = ctx.scene.add.graphics();
      meteorGraphics.setPosition(x, y - 200);
      meteorGraphics.setDepth(DepthLayers.METEOR);

      // Outer glow
      meteorGraphics.fillStyle(0x4488ff, 0.5);
      meteorGraphics.fillCircle(0, 0, 18);
      // Bright center
      meteorGraphics.fillStyle(0x88ccff, 0.8);
      meteorGraphics.fillCircle(0, 0, 12);
      // White hot core
      meteorGraphics.fillStyle(0xffffff, 1.0);
      meteorGraphics.fillCircle(0, 0, 6);

      ctx.scene.tweens.add({
        targets: meteorGraphics,
        y: y,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 100,
        onComplete: () => meteorGraphics.destroy(),
      });
    } else {
      // Low: single blue circle (original)
      const meteorSprite = ctx.scene.add.circle(x, y - 200, 15, 0x4488ff);
      meteorSprite.setDepth(DepthLayers.METEOR);

      ctx.scene.tweens.add({
        targets: meteorSprite,
        y: y,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 100,
        onComplete: () => meteorSprite.destroy(),
      });
    }

    // --- Impact flash ---
    const flashScale = quality === 'high' ? 6 : 4; // 1.5x larger at high
    const impactFlash = ctx.scene.add.circle(x, y, 8, 0xffffff, 1);
    impactFlash.setDepth(16);

    ctx.scene.tweens.add({
      targets: impactFlash,
      scaleX: flashScale,
      scaleY: flashScale,
      alpha: 0,
      duration: 60,
      onComplete: () => impactFlash.destroy(),
    });

    // --- Main explosion ---
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

    // --- Energy ring ---
    if (quality === 'high') {
      // High: filled ring, shockwave extends to 2.5x
      const ring = ctx.scene.add.circle(x, y, radius * 0.5, 0x2266dd, 0.15);
      ring.setStrokeStyle(8, 0x4488ff, 1);
      ring.setDepth(14);

      ctx.scene.tweens.add({
        targets: ring,
        scaleX: 2.5,
        scaleY: 2.5,
        alpha: 0,
        duration: 300,
        onComplete: () => ring.destroy(),
      });
    } else {
      // Low/Medium: stroke-only ring, 2x scale
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
    }

    // --- Debris particles ---
    const debrisCount = quality === 'high' ? 12 : 8;
    for (let i = 0; i < debrisCount; i++) {
      const angle = (i / debrisCount) * Math.PI * 2 + Math.random() * 0.5;
      const dist = radius * 0.5 + Math.random() * radius * 0.5;

      if (quality === 'high' && i >= 8) {
        // High: last 4 debris are rock chunks drawn as small quads on Graphics
        const chunkGraphics = ctx.scene.add.graphics();
        chunkGraphics.setPosition(x, y);
        chunkGraphics.setDepth(16);
        chunkGraphics.fillStyle(0x4466aa, 0.8);
        chunkGraphics.fillRect(-4, -4, 8, 8);

        ctx.scene.tweens.add({
          targets: chunkGraphics,
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist - 20,
          alpha: 0,
          angle: Math.random() * 360,
          duration: 400 + Math.random() * 200,
          onComplete: () => chunkGraphics.destroy(),
        });
      } else {
        // Standard circle debris
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

    // --- Ground scorch mark (medium/high) ---
    if (quality === 'medium' || quality === 'high') {
      const scorchMark = ctx.scene.add.circle(x, y, radius * 0.7, 0x222222, 0.15);
      scorchMark.setDepth(DepthLayers.GROUND_SPIKE_WARNING);

      ctx.scene.tweens.add({
        targets: scorchMark,
        alpha: 0,
        duration: 1500,
        onComplete: () => scorchMark.destroy(),
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
      if (meteor.warningOverlay) {
        meteor.warningOverlay.destroy();
      }
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
