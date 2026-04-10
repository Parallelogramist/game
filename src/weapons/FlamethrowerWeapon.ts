import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

/**
 * FlamethrowerWeapon sprays fire in a cone toward enemies.
 * Continuous damage, great for groups in one direction.
 */
export class FlamethrowerWeapon extends BaseWeapon {
  private flameGraphics: Phaser.GameObjects.Graphics | null = null;
  private coneGraphics: Phaser.GameObjects.Graphics | null = null;
  // OPTIMIZATION: Use Set for O(1) add/delete instead of array indexOf+splice
  private particles: Set<Phaser.GameObjects.GameObject> = new Set();
  private lastAimAngle: number = 0;
  private hitCooldowns: Map<number, number> = new Map();

  // Mastery: Dragon's Breath
  private burnTime: Map<number, number> = new Map();      // How long enemy has been burning
  private ignitedEnemies: Set<number> = new Set();        // Enemies that reached 2s burn (Ignited)
  private readonly IGNITE_THRESHOLD = 2.0;                // Seconds to become Ignited

  // Visual quality tracking
  private currentQuality: VisualQuality = 'high';

  // Ember ring buffer (high quality only)
  private emberBuffer: { x: number; y: number; age: number }[] = [];
  private readonly MAX_EMBERS = 12;

  // Deterministic cleanup timer (replaces random 1% check)
  private cleanupTimer: number = 0;

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
    // Update visual quality from context
    this.currentQuality = ctx.visualQuality;

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

    // Draw visible flame cone
    const coneAngleHalf = coneAngle / 2;
    const coneRange = this.stats.range * 0.7;

    if (!this.coneGraphics) {
      this.coneGraphics = ctx.scene.add.graphics();
      this.coneGraphics.setDepth(7);
    }
    this.coneGraphics.clear();

    // 4-layer gradient cone based on quality
    this.drawGradientCone(ctx, coneAngleHalf, coneRange);

    // Cone edge lines
    const coneLeftAngle = this.lastAimAngle - coneAngleHalf;
    const coneRightAngle = this.lastAimAngle + coneAngleHalf;
    const leftTipX = ctx.playerX + Math.cos(coneLeftAngle) * coneRange;
    const leftTipY = ctx.playerY + Math.sin(coneLeftAngle) * coneRange;
    const rightTipX = ctx.playerX + Math.cos(coneRightAngle) * coneRange;
    const rightTipY = ctx.playerY + Math.sin(coneRightAngle) * coneRange;

    this.coneGraphics.lineStyle(1, 0x66aaff, 0.15);
    this.coneGraphics.beginPath();
    this.coneGraphics.moveTo(ctx.playerX, ctx.playerY);
    this.coneGraphics.lineTo(leftTipX, leftTipY);
    this.coneGraphics.strokePath();
    this.coneGraphics.beginPath();
    this.coneGraphics.moveTo(ctx.playerX, ctx.playerY);
    this.coneGraphics.lineTo(rightTipX, rightTipY);
    this.coneGraphics.strokePath();

    // Heat shimmer lines inside the cone (quality-scaled)
    this.drawShimmerLines(ctx, coneAngleHalf, coneRange);

    // Ember ring buffer (high quality only)
    if (this.currentQuality === 'high') {
      this.updateAndDrawEmbers(ctx, coneAngleHalf, coneRange);
    }

    // Ignite aura on burning enemies (high quality only)
    if (this.currentQuality === 'high') {
      let igniteDrawCount = 0;
      for (const enemyId of this.ignitedEnemies) {
        if (igniteDrawCount >= 8) break;
        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        // Only draw for enemies in range
        const dx = ex - ctx.playerX, dy = ey - ctx.playerY;
        if (dx * dx + dy * dy > rangeSq) continue;
        const pulseSize = 12 + Math.sin(ctx.gameTime * 8) * 3;
        this.coneGraphics.fillStyle(0xff6600, 0.2);
        this.coneGraphics.fillCircle(ex, ey, pulseSize);
        this.coneGraphics.lineStyle(1, 0xffaa00, 0.4);
        this.coneGraphics.strokeCircle(ex, ey, pulseSize);
        igniteDrawCount++;
      }
    }

    // Create flame visual
    this.createFlameVisual(ctx);
  }

  /**
   * Draw multi-layer gradient cone based on visual quality.
   */
  private drawGradientCone(ctx: WeaponContext, coneAngleHalf: number, coneRange: number): void {
    if (this.currentQuality === 'low') {
      // Low: single cone layer with slightly boosted alpha
      this.drawConeLayer(ctx, coneAngleHalf, coneRange, 0x4488ff, 0.12, 1.0);
    } else if (this.currentQuality === 'medium') {
      // Medium: 2-layer cone
      this.drawConeLayer(ctx, coneAngleHalf, coneRange, 0xff4400, 0.06, 1.0);
      this.drawConeLayer(ctx, coneAngleHalf, coneRange, 0xff6600, 0.10, 0.8);
    } else {
      // High: 4-layer gradient
      this.drawConeLayer(ctx, coneAngleHalf, coneRange, 0xff4400, 0.06, 1.0);
      this.drawConeLayer(ctx, coneAngleHalf, coneRange, 0xff6600, 0.10, 0.85);
      this.drawConeLayer(ctx, coneAngleHalf, coneRange, 0xffaa00, 0.14, 0.70);
      this.drawConeLayer(ctx, coneAngleHalf, coneRange, 0xffcc44, 0.18, 0.50);
    }
  }

  /**
   * Draw a single cone layer with the given width fraction.
   */
  private drawConeLayer(
    ctx: WeaponContext,
    coneAngleHalf: number,
    coneRange: number,
    color: number,
    alpha: number,
    widthFraction: number
  ): void {
    const narrowAngleHalf = coneAngleHalf * widthFraction;
    const layerLeftAngle = this.lastAimAngle - narrowAngleHalf;
    const layerRightAngle = this.lastAimAngle + narrowAngleHalf;
    const layerLeftTipX = ctx.playerX + Math.cos(layerLeftAngle) * coneRange;
    const layerLeftTipY = ctx.playerY + Math.sin(layerLeftAngle) * coneRange;
    const layerRightTipX = ctx.playerX + Math.cos(layerRightAngle) * coneRange;
    const layerRightTipY = ctx.playerY + Math.sin(layerRightAngle) * coneRange;

    this.coneGraphics!.fillStyle(color, alpha);
    this.coneGraphics!.beginPath();
    this.coneGraphics!.moveTo(ctx.playerX, ctx.playerY);
    this.coneGraphics!.lineTo(layerLeftTipX, layerLeftTipY);
    this.coneGraphics!.lineTo(layerRightTipX, layerRightTipY);
    this.coneGraphics!.closePath();
    this.coneGraphics!.fillPath();
  }

  /**
   * Draw heat shimmer lines scaled by visual quality.
   */
  private drawShimmerLines(ctx: WeaponContext, coneAngleHalf: number, coneRange: number): void {
    const perpAngle = this.lastAimAngle + Math.PI / 2;
    // Cache trig values used in every segment iteration
    const cosPerp = Math.cos(perpAngle);
    const sinPerp = Math.sin(perpAngle);
    const cosAim = Math.cos(this.lastAimAngle);
    const sinAim = Math.sin(this.lastAimAngle);
    const sinConeHalf = Math.sin(coneAngleHalf);

    let shimmerDistances: number[];
    let shimmerLineCount: number;
    let shimmerAlpha: number;
    let wobbleAmplitude: number;
    let shimmerColors: number[] | null = null;

    if (this.currentQuality === 'low') {
      shimmerDistances = [0.35, 0.65];
      shimmerLineCount = 2;
      shimmerAlpha = 0.12;
      wobbleAmplitude = 5;
    } else if (this.currentQuality === 'medium') {
      shimmerDistances = [0.3, 0.5, 0.7];
      shimmerLineCount = 3;
      shimmerAlpha = 0.18;
      wobbleAmplitude = 5;
    } else {
      shimmerDistances = [0.2, 0.35, 0.5, 0.65, 0.8];
      shimmerLineCount = 5;
      shimmerAlpha = 0.22;
      wobbleAmplitude = 8;
      shimmerColors = [0xffaa66, 0x88ccff, 0xffaa66, 0x88ccff, 0xffaa66];
    }

    for (let shimmerIndex = 0; shimmerIndex < shimmerLineCount; shimmerIndex++) {
      const distanceFraction = shimmerDistances[shimmerIndex];
      const rangeFraction = coneRange * distanceFraction;
      const lineCenterX = ctx.playerX + cosAim * rangeFraction;
      const lineCenterY = ctx.playerY + sinAim * rangeFraction;
      const halfSpread = rangeFraction * sinConeHalf * 0.8;

      const lineColor = shimmerColors ? shimmerColors[shimmerIndex] : 0x88ccff;
      this.coneGraphics!.lineStyle(1, lineColor, shimmerAlpha);

      const shimmerSegments = 6;
      this.coneGraphics!.beginPath();
      for (let segmentIndex = 0; segmentIndex <= shimmerSegments; segmentIndex++) {
        const segmentFraction = segmentIndex / shimmerSegments;
        const spreadOffset = (segmentFraction - 0.5) * 2 * halfSpread;
        const sineWobble = Math.sin(ctx.gameTime * 4 + shimmerIndex * 2 + segmentFraction * Math.PI * 2) * wobbleAmplitude;
        const pointX = lineCenterX + cosPerp * spreadOffset + cosAim * sineWobble;
        const pointY = lineCenterY + sinPerp * spreadOffset + sinAim * sineWobble;
        if (segmentIndex === 0) {
          this.coneGraphics!.moveTo(pointX, pointY);
        } else {
          this.coneGraphics!.lineTo(pointX, pointY);
        }
      }
      this.coneGraphics!.strokePath();
    }
  }

  /**
   * Update and draw ember particles (high quality only).
   * Embers spawn randomly in the cone and drift upward as they age.
   */
  private updateAndDrawEmbers(ctx: WeaponContext, coneAngleHalf: number, coneRange: number): void {
    // Spawn new ember ~every 3rd frame
    if (Math.random() < 0.33 && this.emberBuffer.length < this.MAX_EMBERS) {
      const randomAngleOffset = (Math.random() - 0.5) * 2 * coneAngleHalf;
      const randomDistance = 0.2 + Math.random() * 0.7; // 20%-90% of cone range
      const emberAngle = this.lastAimAngle + randomAngleOffset;
      const emberX = ctx.playerX + Math.cos(emberAngle) * coneRange * randomDistance;
      const emberY = ctx.playerY + Math.sin(emberAngle) * coneRange * randomDistance;
      this.emberBuffer.push({ x: emberX, y: emberY, age: 0 });
    }

    // Age and draw embers, remove old ones
    const maxEmberAge = 0.6; // seconds
    for (let emberIndex = this.emberBuffer.length - 1; emberIndex >= 0; emberIndex--) {
      const ember = this.emberBuffer[emberIndex];
      ember.age += ctx.deltaTime;
      ember.y -= 20 * ctx.deltaTime; // Drift upward

      if (ember.age >= maxEmberAge) {
        this.emberBuffer.splice(emberIndex, 1);
        continue;
      }

      const ageFraction = ember.age / maxEmberAge;
      const emberAlpha = 0.5 * (1 - ageFraction);
      this.coneGraphics!.fillStyle(0xffcc44, emberAlpha);
      this.coneGraphics!.fillCircle(ember.x, ember.y, 1.5);
    }
  }

  private createFlameVisual(ctx: WeaponContext): void {
    // Particle cap based on quality
    const particleCap = this.currentQuality === 'low' ? 10
      : this.currentQuality === 'medium' ? 20
      : 30;

    // Spawn flame particles (skip if at cap)
    for (let i = 0; i < 3; i++) {
      if (this.particles.size >= particleCap) break;

      const spreadAngle = this.lastAimAngle + (Math.random() - 0.5) * (Math.PI / 3) * this.stats.size;
      const dist = 20 + Math.random() * this.stats.range * 0.8;

      const x = ctx.playerX + Math.cos(spreadAngle) * dist;
      const y = ctx.playerY + Math.sin(spreadAngle) * dist;

      this.createFlameParticle(ctx, x, y);
    }
  }

  private createFlameParticle(ctx: WeaponContext, x: number, y: number, isIgnited: boolean = false): void {
    // Respect particle cap
    const particleCap = this.currentQuality === 'low' ? 10
      : this.currentQuality === 'medium' ? 20
      : 30;
    if (this.particles.size >= particleCap) return;

    const size = 6 + Math.random() * 8;
    // Blue energy particles normally, orange/red for ignited
    const colors = isIgnited
      ? [0xff4400, 0xff6600, 0xffaa00, 0xffcc00]  // Orange/red for ignited
      : [0x2266dd, 0x4488ff, 0x66aaff, 0x88ccff]; // Blue normally
    const color = colors[Math.floor(Math.random() * colors.length)];

    const particleSize = isIgnited ? size * 1.3 : size;
    const angleFromPlayer = Math.atan2(y - ctx.playerY, x - ctx.playerX);

    // Teardrop-shaped flame particle using Graphics
    const particleGraphics = ctx.scene.add.graphics();
    particleGraphics.setPosition(x, y);
    particleGraphics.setDepth(8);
    particleGraphics.setRotation(angleFromPlayer);

    // Draw elongated teardrop: ellipse body + pointed tail
    particleGraphics.fillStyle(color, 0.8);
    particleGraphics.fillEllipse(0, 0, particleSize * 1.5, particleSize * 0.7);
    // Pointed tail toward player (negative x in local space)
    particleGraphics.fillTriangle(
      -particleSize * 0.6, 0,
      -particleSize * 1.2, -particleSize * 0.15,
      -particleSize * 1.2, particleSize * 0.15
    );

    this.particles.add(particleGraphics);

    ctx.scene.tweens.add({
      targets: particleGraphics,
      scaleX: 0.3,
      scaleY: 0.3,
      alpha: 0,
      y: y - 20 - Math.random() * 20,
      duration: 200 + Math.random() * 200,
      onComplete: () => {
        this.particles.delete(particleGraphics);
        particleGraphics.destroy();
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

    // Deterministic cleanup of old cooldowns, burn times, and dead ignited enemies
    this.cleanupTimer += ctx.deltaTime;
    if (this.cleanupTimer > 2.0) {
      this.cleanupTimer = 0;
      for (const [enemyId, time] of this.hitCooldowns) {
        if (ctx.gameTime - time > 2) {
          this.hitCooldowns.delete(enemyId);
          const currentBurn = this.burnTime.get(enemyId);
          if (currentBurn !== undefined) {
            const newBurn = currentBurn - 0.5;
            if (newBurn <= 0) {
              this.burnTime.delete(enemyId);
              this.ignitedEnemies.delete(enemyId);
            } else {
              this.burnTime.set(enemyId, newBurn);
            }
          }
        }
      }
      // Prune dead enemies from ignited set
      for (const enemyId of this.ignitedEnemies) {
        if (Health.current[enemyId] <= 0) {
          this.ignitedEnemies.delete(enemyId);
          this.burnTime.delete(enemyId);
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
    explosion.setDepth(DepthLayers.PROJECTILES);

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
    if (this.coneGraphics) {
      this.coneGraphics.destroy();
      this.coneGraphics = null;
    }
    for (const particle of this.particles) {
      particle.destroy();
    }
    this.particles.clear();
    this.hitCooldowns.clear();
    this.burnTime.clear();
    this.ignitedEnemies.clear();
    this.emberBuffer.length = 0;
    super.destroy();
  }
}
