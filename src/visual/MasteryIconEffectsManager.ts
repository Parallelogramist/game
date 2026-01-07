import Phaser from 'phaser';

/**
 * Tracks a single mastered icon's visual effect state.
 */
interface MasteredIconEffect {
  upgradeId: string;
  x: number;
  y: number;
  glowPhase: number;           // Animation phase for breathing effect
  particleTimer: number;       // Time until next particle emission
}

/**
 * Gold mastery colors for the glow and particle effects.
 */
const MASTERY_GOLD = {
  core: 0xffd700,        // Gold
  outer: 0xffec8b,       // Light gold
  particle: 0xffffff,    // White sparkle
};

/**
 * MasteryIconEffectsManager handles animated visual effects for mastered
 * (level 10) weapon and upgrade icons in the HUD.
 *
 * Effects include:
 * - Animated golden glow that pulses/breathes
 * - Floating gold/white particles that drift upward
 *
 * The manager maintains effects outside the icon container so they persist
 * when icons are rebuilt during upgrade events.
 */
export class MasteryIconEffectsManager {
  private scene: Phaser.Scene;

  // Track all mastered icon effects
  private effects: Map<string, MasteredIconEffect> = new Map();

  // Shared graphics for all glows (more efficient than one per icon)
  private glowGraphics: Phaser.GameObjects.Graphics | null = null;

  // Shared particle emitter for sparkles
  private sparkleEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  // HUD depth constants
  private readonly HUD_GLOW_DEPTH = 998;      // Below icons (which are at 1000)
  private readonly HUD_PARTICLE_DEPTH = 1001; // Above icons

  // Animation settings
  private readonly GLOW_PULSE_SPEED = 3;      // Radians per second
  private readonly PARTICLE_INTERVAL_MIN = 0.08;
  private readonly PARTICLE_INTERVAL_MAX = 0.15;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initGraphics();
    this.initParticleEmitter();
  }

  /**
   * Initialize the shared graphics object for glow effects.
   */
  private initGraphics(): void {
    this.glowGraphics = this.scene.add.graphics();
    this.glowGraphics.setDepth(this.HUD_GLOW_DEPTH);
    this.glowGraphics.setScrollFactor(0); // Fixed to camera (HUD)
  }

  /**
   * Initialize the shared particle emitter for sparkle effects.
   */
  private initParticleEmitter(): void {
    // Check if particle texture exists
    if (!this.scene.textures.exists('particle')) {
      return;
    }

    this.sparkleEmitter = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 8, max: 20 },
      angle: { min: 250, max: 290 },     // Mostly upward
      scale: { start: 0.6, end: 0 },
      lifespan: { min: 400, max: 700 },
      alpha: { start: 0.8, end: 0 },
      tint: [MASTERY_GOLD.core, MASTERY_GOLD.outer, MASTERY_GOLD.particle],
      emitting: false,
    });
    this.sparkleEmitter.setDepth(this.HUD_PARTICLE_DEPTH);
    this.sparkleEmitter.setScrollFactor(0); // Fixed to camera (HUD)
  }

  /**
   * Update the list of mastered icons and their positions.
   * Called after updateUpgradeIcons() rebuilds the icon container.
   *
   * @param masteredPositions Map of upgradeId -> {x, y} screen positions
   */
  public updateMasteredIcons(masteredPositions: Map<string, { x: number; y: number }>): void {
    // Remove effects for icons no longer mastered
    const toRemove: string[] = [];
    for (const upgradeId of this.effects.keys()) {
      if (!masteredPositions.has(upgradeId)) {
        toRemove.push(upgradeId);
      }
    }
    for (const upgradeId of toRemove) {
      this.effects.delete(upgradeId);
    }

    // Add or update effects for mastered icons
    for (const [upgradeId, pos] of masteredPositions) {
      const existing = this.effects.get(upgradeId);
      if (existing) {
        // Update position
        existing.x = pos.x;
        existing.y = pos.y;
      } else {
        // Add new effect with staggered phase
        this.effects.set(upgradeId, {
          upgradeId,
          x: pos.x,
          y: pos.y,
          glowPhase: Math.random() * Math.PI * 2, // Random starting phase
          particleTimer: Math.random() * this.PARTICLE_INTERVAL_MAX,
        });
      }
    }
  }

  /**
   * Update all mastery effects - called each frame.
   *
   * @param deltaSeconds Time since last frame in seconds
   */
  public update(deltaSeconds: number): void {
    if (this.effects.size === 0) {
      // Clear glow graphics if no effects
      if (this.glowGraphics) {
        this.glowGraphics.clear();
      }
      return;
    }

    // Draw all glows
    this.drawGlows(deltaSeconds);

    // Emit particles
    this.emitParticles(deltaSeconds);
  }

  /**
   * Draw animated glow effects for all mastered icons.
   */
  private drawGlows(deltaSeconds: number): void {
    if (!this.glowGraphics) return;

    this.glowGraphics.clear();

    for (const effect of this.effects.values()) {
      // Update animation phase
      effect.glowPhase += this.GLOW_PULSE_SPEED * deltaSeconds;

      // Calculate pulse values
      const pulse = Math.sin(effect.glowPhase) * 0.5 + 0.5; // 0 to 1
      const baseAlpha = 0.25 + pulse * 0.25;                // 0.25 to 0.5
      const scale = 1.0 + pulse * 0.08;                     // 1.0 to 1.08

      const iconSize = 32;
      const halfSize = iconSize / 2;
      const x = effect.x;
      const y = effect.y;

      // Outer glow layer (softer, larger)
      this.glowGraphics.fillStyle(MASTERY_GOLD.outer, baseAlpha * 0.4);
      this.glowGraphics.fillRoundedRect(
        x - halfSize - 6 * scale,
        y - halfSize - 6 * scale,
        (iconSize + 12) * scale,
        (iconSize + 12) * scale,
        6
      );

      // Middle glow layer
      this.glowGraphics.fillStyle(MASTERY_GOLD.core, baseAlpha * 0.5);
      this.glowGraphics.fillRoundedRect(
        x - halfSize - 4 * scale,
        y - halfSize - 4 * scale,
        (iconSize + 8) * scale,
        (iconSize + 8) * scale,
        5
      );

      // Inner bright edge (stroke)
      this.glowGraphics.lineStyle(2, MASTERY_GOLD.core, baseAlpha * 0.8);
      this.glowGraphics.strokeRoundedRect(
        x - halfSize - 2,
        y - halfSize - 2,
        iconSize + 4,
        iconSize + 4,
        4
      );
    }
  }

  /**
   * Emit sparkle particles from mastered icons.
   */
  private emitParticles(deltaSeconds: number): void {
    if (!this.sparkleEmitter) return;

    for (const effect of this.effects.values()) {
      effect.particleTimer -= deltaSeconds;

      if (effect.particleTimer <= 0) {
        // Emit 1-2 particles near the icon
        const particleCount = Math.random() < 0.3 ? 2 : 1;

        for (let i = 0; i < particleCount; i++) {
          const offsetX = (Math.random() - 0.5) * 24; // Within icon bounds
          const offsetY = (Math.random() - 0.5) * 24;

          this.sparkleEmitter.emitParticleAt(
            effect.x + offsetX,
            effect.y + offsetY,
            1
          );
        }

        // Reset timer with slight randomness
        effect.particleTimer = Phaser.Math.FloatBetween(
          this.PARTICLE_INTERVAL_MIN,
          this.PARTICLE_INTERVAL_MAX
        );
      }
    }
  }

  /**
   * Check if any icons have mastery effects active.
   */
  public hasMasteredIcons(): boolean {
    return this.effects.size > 0;
  }

  /**
   * Get the count of mastered icons being tracked.
   */
  public getMasteredCount(): number {
    return this.effects.size;
  }

  /**
   * Clean up all resources.
   */
  public destroy(): void {
    if (this.glowGraphics) {
      this.glowGraphics.destroy();
      this.glowGraphics = null;
    }

    if (this.sparkleEmitter) {
      this.sparkleEmitter.destroy();
      this.sparkleEmitter = null;
    }

    this.effects.clear();
  }
}
