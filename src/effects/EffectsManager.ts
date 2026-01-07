import Phaser from 'phaser';
import { getSettingsManager } from '../settings';

/**
 * Pooled damage number for performance optimization.
 * Pre-created text objects are reused instead of creating new ones.
 */
interface PooledDamageNumber {
  text: Phaser.GameObjects.Text;
  active: boolean;
  startX: number;
  startY: number;
  elapsed: number;
  // Critical hit properties
  isCrit: boolean;
  isPerfectCrit: boolean;
  duration: number;
  shimmerPhase: number;
  nextSparkleTime: number; // When to emit next sparkle
}

/**
 * EffectsManager handles all visual game juice effects:
 * - Particle effects (death bursts, hit sparks, XP sparkles)
 * - Floating damage numbers
 *
 * Uses object pooling for performance with 100+ enemies.
 */
export class EffectsManager {
  private scene: Phaser.Scene;

  // Particle emitters - multi-layer for Geometry Wars aesthetic
  private deathBurstEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private deathFlashEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private deathGlowEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private hitSparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private xpSparkleEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private goldSparkleEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  // Damage number pool
  private damageNumberPool: PooledDamageNumber[] = [];
  private readonly POOL_SIZE = 50;
  private readonly DAMAGE_NUMBER_DURATION = 600; // ms
  private readonly DAMAGE_NUMBER_RISE = 30; // pixels

  // Throttling for mass death events
  private lastDeathBurstTime: number = 0;
  private readonly DEATH_BURST_COOLDOWN = 16; // ~60fps max

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initParticleEmitters();
    this.initDamageNumberPool();
  }

  /**
   * Initialize all particle emitters using the generated particle textures.
   * Multi-layer system for Geometry Wars-style explosions.
   */
  private initParticleEmitters(): void {
    // Layer 1: Death flash - bright white burst (very short-lived, instant impact)
    this.deathFlashEmitter = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 150, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 2, end: 0 },
      lifespan: { min: 80, max: 120 },
      tint: 0xffffff,
      emitting: false,
    });
    this.deathFlashEmitter.setDepth(102);

    // Layer 2: Death burst - colored debris particles
    this.deathBurstEmitter = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 80, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      lifespan: { min: 250, max: 400 },
      gravityY: 30,
      tint: 0xff4444,
      emitting: false,
    });
    this.deathBurstEmitter.setDepth(101);

    // Layer 3: Death glow - soft outer glow particles (longer-lived, ambient)
    this.deathGlowEmitter = this.scene.add.particles(0, 0, 'particle_glow', {
      speed: { min: 30, max: 80 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      lifespan: { min: 350, max: 550 },
      alpha: { start: 0.6, end: 0 },
      tint: 0xff8888,
      emitting: false,
    });
    this.deathGlowEmitter.setDepth(100);

    // Hit sparks - bright white/yellow particles in impact direction
    this.hitSparkEmitter = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 100, max: 180 },
      angle: { min: -30, max: 30 },
      scale: { start: 1, end: 0 },
      lifespan: { min: 120, max: 200 },
      tint: [0xffffff, 0xffffaa, 0xffff66],
      emitting: false,
    });
    this.hitSparkEmitter.setDepth(100);

    // XP sparkle - neon green particles floating up
    this.xpSparkleEmitter = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 25, max: 50 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.8, end: 0 },
      lifespan: 450,
      alpha: { start: 1, end: 0 },
      tint: 0x00ff88,
      emitting: false,
    });
    this.xpSparkleEmitter.setDepth(100);

    // Gold sparkle - for perfect crit numbers
    // Bright particles that pop in and fade out
    this.goldSparkleEmitter = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 20, max: 50 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 300, max: 500 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffd700, 0xffec8b, 0xffffff], // Gold, light gold, white
      emitting: false,
    });
    this.goldSparkleEmitter.setDepth(151); // Above damage numbers
  }

  /**
   * Pre-create damage number text objects for pooling.
   */
  private initDamageNumberPool(): void {
    for (let i = 0; i < this.POOL_SIZE; i++) {
      const text = this.scene.add.text(0, 0, '', {
        fontSize: '16px',
        fontFamily: 'Arial',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      });
      text.setOrigin(0.5, 0.5);
      text.setVisible(false);
      text.setDepth(150);

      this.damageNumberPool.push({
        text,
        active: false,
        startX: 0,
        startY: 0,
        elapsed: 0,
        // Initialize crit properties
        isCrit: false,
        isPerfectCrit: false,
        duration: this.DAMAGE_NUMBER_DURATION,
        shimmerPhase: 0,
        nextSparkleTime: 0,
      });
    }
  }

  /**
   * Play multi-layer death burst particle effect at position.
   * Geometry Wars-style explosion with flash, debris, and glow layers.
   * Throttled to prevent performance issues with mass deaths.
   *
   * @param x - X position
   * @param y - Y position
   * @param color - Optional tint color for the explosion (default: red)
   */
  playDeathBurst(x: number, y: number, color?: number): void {
    const now = Date.now();
    if (now - this.lastDeathBurstTime < this.DEATH_BURST_COOLDOWN) {
      return; // Skip to maintain framerate
    }
    this.lastDeathBurstTime = now;

    // Layer 1: Bright white flash (always white for maximum impact)
    if (this.deathFlashEmitter) {
      this.deathFlashEmitter.emitParticleAt(x, y, Phaser.Math.Between(3, 5));
    }

    // Layer 2: Colored debris particles
    if (this.deathBurstEmitter) {
      if (color !== undefined) {
        this.deathBurstEmitter.particleTint = color;
      }
      this.deathBurstEmitter.emitParticleAt(x, y, Phaser.Math.Between(10, 15));
    }

    // Layer 3: Soft glow particles (lighter version of the color)
    if (this.deathGlowEmitter) {
      if (color !== undefined) {
        // Lighten the color for the glow layer
        const r = Math.min(255, ((color >> 16) & 0xff) + 80);
        const g = Math.min(255, ((color >> 8) & 0xff) + 80);
        const b = Math.min(255, (color & 0xff) + 80);
        this.deathGlowEmitter.particleTint = (r << 16) | (g << 8) | b;
      }
      this.deathGlowEmitter.emitParticleAt(x, y, Phaser.Math.Between(6, 8));
    }
  }

  /**
   * Play hit spark particles at position, oriented based on hit angle.
   * @param x - Hit position X
   * @param y - Hit position Y
   * @param angle - Angle in radians (direction sparks should fly)
   */
  playHitSparks(x: number, y: number, angle: number): void {
    if (this.hitSparkEmitter) {
      // Convert angle to degrees and offset the emitter angle
      const angleDegrees = Phaser.Math.RadToDeg(angle);
      // Update particle angle config
      this.hitSparkEmitter.particleAngle = {
        min: angleDegrees - 30,
        max: angleDegrees + 30,
      };
      this.hitSparkEmitter.emitParticleAt(x, y, Phaser.Math.Between(3, 5));
    }
  }

  /**
   * Play XP collection sparkle effect.
   */
  playXPSparkle(x: number, y: number): void {
    if (this.xpSparkleEmitter) {
      this.xpSparkleEmitter.emitParticleAt(x, y, Phaser.Math.Between(2, 3));
    }
  }

  /**
   * Play health pickup effect (green burst).
   */
  playHealthPickup(x: number, y: number): void {
    // Reuse XP sparkle emitter with same green color
    if (this.xpSparkleEmitter) {
      this.xpSparkleEmitter.emitParticleAt(x, y, Phaser.Math.Between(4, 6));
    }
  }

  /**
   * Emit gold sparkle particles at position (used for special chests, perfect crits).
   */
  playGoldSparkle(x: number, y: number, count: number = 3): void {
    if (this.goldSparkleEmitter) {
      this.goldSparkleEmitter.emitParticleAt(x, y, count);
    }
  }

  /**
   * Play a screen-wide impact flash effect.
   * Creates a brief white overlay that fades out quickly.
   *
   * @param intensity - Alpha intensity of the flash (0.0-1.0, default 0.2)
   * @param duration - Duration of the flash in ms (default 80)
   */
  playImpactFlash(intensity: number = 0.2, duration: number = 80): void {
    const { width, height } = this.scene.scale;
    const flash = this.scene.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      0xffffff,
      intensity
    );
    flash.setDepth(1000);
    flash.setScrollFactor(0);  // Stay fixed to camera

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: duration,
      ease: 'Power2',
      onComplete: () => flash.destroy(),
    });
  }

  /**
   * Show floating damage number or text at position.
   * Uses object pooling for performance.
   * @param x - X position
   * @param y - Y position
   * @param value - Number or text to display
   * @param color - Optional color (default: white 0xffffff)
   * @param isCrit - Whether this is a critical hit
   * @param isPerfectCrit - Whether this is a perfect critical hit (max damage roll)
   */
  showDamageNumber(
    x: number,
    y: number,
    value: number | string,
    color: number = 0xffffff,
    isCrit: boolean = false,
    isPerfectCrit: boolean = false
  ): void {
    const settings = getSettingsManager();

    // Filter based on settings
    if (typeof value === 'string') {
      // Status text (DODGE, BLOCKED, PHASE, SHIELD, etc.)
      if (!settings.isStatusTextEnabled()) {
        return;
      }
    } else {
      // Numeric damage numbers - filter based on mode
      const mode = settings.getDamageNumbersMode();
      if (mode === 'off') {
        return;
      }
      if (mode === 'perfect_crits' && !isPerfectCrit) {
        return;
      }
      if (mode === 'crits' && !isCrit && !isPerfectCrit) {
        return;
      }
      // 'all' mode shows everything
    }

    // Find an inactive damage number from pool
    const pooledNumber = this.damageNumberPool.find(p => !p.active);
    if (!pooledNumber) {
      return; // Pool exhausted, skip this number
    }

    pooledNumber.active = true;
    pooledNumber.elapsed = 0;
    pooledNumber.isCrit = isCrit;
    pooledNumber.isPerfectCrit = isPerfectCrit;
    pooledNumber.shimmerPhase = 0;
    pooledNumber.nextSparkleTime = 0; // Emit first sparkle immediately

    // Set duration based on crit type: perfect=3s, crit=2s, normal=0.6s
    pooledNumber.duration = isPerfectCrit ? 3000 : (isCrit ? 2000 : this.DAMAGE_NUMBER_DURATION);

    // Set text based on value type
    const displayText = typeof value === 'number' ? Math.round(value).toString() : value;
    pooledNumber.text.setText(displayText);
    const posX = x + Phaser.Math.Between(-10, 10);
    pooledNumber.startX = posX;
    pooledNumber.startY = y;
    pooledNumber.text.setPosition(posX, y);
    pooledNumber.text.setAlpha(1);
    pooledNumber.text.setVisible(true);

    // Set styling based on crit type
    let scale: number;
    if (isPerfectCrit) {
      // Perfect crit: gold color, moderately larger, thick stroke
      scale = 1.75;
      pooledNumber.text.setFontSize('22px');
      pooledNumber.text.setColor('#ffd700'); // Gold
      pooledNumber.text.setStroke('#8b6914', 4); // Dark gold stroke
    } else if (isCrit) {
      // Regular crit: yellow, slightly larger than normal
      scale = 1.4;
      pooledNumber.text.setFontSize('19px');
      pooledNumber.text.setColor('#ffff00'); // Yellow
      pooledNumber.text.setStroke('#000000', 3);
    } else {
      // Normal hit: white, scale with damage
      scale = typeof value === 'number' ? Math.min(1 + value / 50, 1.5) : 1.0;
      pooledNumber.text.setFontSize('16px');
      pooledNumber.text.setColor('#' + color.toString(16).padStart(6, '0'));
      pooledNumber.text.setStroke('#000000', 3);
    }
    pooledNumber.text.setScale(scale);
  }

  /**
   * Update damage number animations. Call this every frame.
   * Handles variable duration, rise distance, and shimmer effects for crits.
   * @param deltaMs - Delta time in milliseconds
   */
  update(deltaMs: number): void {
    for (const pooledNumber of this.damageNumberPool) {
      if (!pooledNumber.active) continue;

      pooledNumber.elapsed += deltaMs;
      const progress = pooledNumber.elapsed / pooledNumber.duration;

      if (progress >= 1) {
        // Animation complete, return to pool
        pooledNumber.active = false;
        pooledNumber.text.setVisible(false);
        continue;
      }

      // Float upward (slower for longer-lived crit numbers)
      // Perfect crit: 60px, Regular crit: 45px, Normal: 30px
      const riseDistance = pooledNumber.isPerfectCrit ? 60 : (pooledNumber.isCrit ? 45 : this.DAMAGE_NUMBER_RISE);
      const yOffset = progress * riseDistance;

      // Perfect crit: smooth color shimmer + sparkle particles
      if (pooledNumber.isPerfectCrit) {
        pooledNumber.shimmerPhase += deltaMs * 0.005; // Smooth pulse speed

        // Smooth sine wave for color shimmer (gold → white → gold)
        const shimmerIntensity = (Math.sin(pooledNumber.shimmerPhase * Math.PI * 2) + 1) * 0.5;

        // Interpolate between gold (#ffd700: R=255, G=215, B=0) and white (#ffffff)
        const red = 255;
        const green = Math.round(215 + (255 - 215) * shimmerIntensity);
        const blue = Math.round(0 + 255 * shimmerIntensity);
        const hexColor = '#' + red.toString(16).padStart(2, '0') +
                                green.toString(16).padStart(2, '0') +
                                blue.toString(16).padStart(2, '0');
        pooledNumber.text.setColor(hexColor);

        // Emit gold sparkles at random intervals around the text
        if (pooledNumber.elapsed >= pooledNumber.nextSparkleTime && this.goldSparkleEmitter) {
          // Random position around the text (within ~30px radius)
          const currentY = pooledNumber.startY - yOffset;
          const sparkleX = pooledNumber.startX + Phaser.Math.Between(-30, 30);
          const sparkleY = currentY + Phaser.Math.Between(-20, 20);

          // Emit 2-4 sparkles per burst
          this.goldSparkleEmitter.emitParticleAt(sparkleX, sparkleY, Phaser.Math.Between(2, 4));

          // Schedule next sparkle (random interval 60-120ms for more frequent sparkles)
          pooledNumber.nextSparkleTime = pooledNumber.elapsed + Phaser.Math.Between(60, 120);
        }
      }

      // Float upward for all damage numbers
      pooledNumber.text.setY(pooledNumber.startY - yOffset);

      // Fade out in last 30%
      if (progress > 0.7) {
        const fadeProgress = (progress - 0.7) / 0.3;
        pooledNumber.text.setAlpha(1 - fadeProgress);
      }
    }
  }

  /**
   * Clean up all effects resources.
   */
  destroy(): void {
    this.deathFlashEmitter?.destroy();
    this.deathBurstEmitter?.destroy();
    this.deathGlowEmitter?.destroy();
    this.hitSparkEmitter?.destroy();
    this.xpSparkleEmitter?.destroy();
    this.goldSparkleEmitter?.destroy();

    for (const pooledNumber of this.damageNumberPool) {
      pooledNumber.text.destroy();
    }
    this.damageNumberPool = [];
  }
}
