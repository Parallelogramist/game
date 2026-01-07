/**
 * PlayerParticleSwarm - A dense swarm of particles that form the player
 *
 * Features:
 * - 100 glowing particles in dual-ring formation
 * - Breathing animation (all particles pulse together)
 * - Individual micro-wobble per particle for organic feel
 * - Movement trailing (front particles lead, back particles trail)
 * - Scatter on sudden stop, then smooth regroup
 * - Speed glow (particles brighten when moving fast)
 */

import Phaser from 'phaser';
import { NeonColorPair, lightenColor } from './NeonColors';
import { VisualQuality } from './GlowGraphics';

export interface PlasmaConfig {
  baseRadius: number;
  neonColor: NeonColorPair;
  quality: VisualQuality;
}

interface SwarmParticle {
  // Home position (polar coordinates relative to center)
  baseAngle: number;
  baseDistance: number;

  // Visual properties
  radius: number;
  alphaMultiplier: number;

  // Per-particle wobble (unique frequencies/phases for organic feel)
  wobblePhaseX: number;
  wobblePhaseY: number;
  wobbleFreqX: number;
  wobbleFreqY: number;

  // Movement offset (creates trailing effect)
  offsetX: number;
  offsetY: number;
  offsetRecoverySpeed: number;  // How fast this particle recovers to base position
  offsetMultiplierVariation: number;  // Per-particle variation in how much it trails (0.5-1.5)

  // Scatter state (impulse that decays)
  scatterX: number;
  scatterY: number;

  // Color pulse (random brightening)
  pulsePhase: number;       // Current phase in the pulse cycle
  pulseSpeed: number;       // How fast this particle pulses
  pulseOffset: number;      // Random offset so particles don't sync

  // Phaser display object
  coreCircle: Phaser.GameObjects.Arc;  // Actually a Circle (subclass of Arc)
}

export class PlayerPlasmaCore {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private config: PlasmaConfig;

  // Particle data
  private particles: SwarmParticle[] = [];

  // Animation state
  private breathingPhase: number = 0;
  private globalTime: number = 0;

  // Container position tracking for movement offset
  private lastContainerX: number = 0;
  private lastContainerY: number = 0;

  // Scatter state
  private scatterDecay: number = 0;

  // Smoothed velocity for visual effects
  private smoothedSpeed: number = 0;

  // Constants - Tunable for feel
  private static readonly PARTICLE_COUNT = 100;
  private static readonly INNER_RING_COUNT = 40;
  private static readonly INNER_RING_DISTANCE = 6;
  private static readonly OUTER_RING_DISTANCE = 12;
  private static readonly INNER_PARTICLE_SIZE_MIN = 2;
  private static readonly INNER_PARTICLE_SIZE_MAX = 3.5;
  private static readonly OUTER_PARTICLE_SIZE_MIN = 1.5;
  private static readonly OUTER_PARTICLE_SIZE_MAX = 2.5;

  private static readonly MAX_SPEED = 300;

  // Breathing - collective pulse of the swarm
  private static readonly BREATHING_SPEED = 2.5;       // Slightly faster breathing
  private static readonly BREATHING_AMPLITUDE = 0.22;  // More pronounced breathing (was 0.12)

  // Wobble - individual particle random movement for lively feel
  private static readonly WOBBLE_AMPLITUDE = 3.5;      // More wobble (was 2.0)
  private static readonly WOBBLE_FREQ_MIN = 1.5;       // Slower wobble range (was 2.0)
  private static readonly WOBBLE_FREQ_MAX = 5.0;       // Wider frequency range (was 4.5)

  // Scatter decay (scatter is no longer triggered, but decay remains for any existing)
  private static readonly SCATTER_DECAY_RATE = 5.0;

  // Color pulse - random brightening effect
  private static readonly PULSE_SPEED_MIN = 0.3;      // Slowest pulse cycle
  private static readonly PULSE_SPEED_MAX = 1.2;      // Fastest pulse cycle
  private static readonly PULSE_INTENSITY = 0.4;      // How much lighter (0-1)

  // Movement trailing - THIS CREATES THE SWARM WAVE EFFECT
  private static readonly OFFSET_FRONT_MULTIPLIER = 0.08;   // Front particles offset 8% of movement (very tight)
  private static readonly OFFSET_BACK_MULTIPLIER = 0.4;     // Back particles offset 40% of movement
  private static readonly RECOVERY_SPEED_MIN = 10;          // Slowest recovery (back particles)
  private static readonly RECOVERY_SPEED_MAX = 22;          // Fastest recovery (front particles)
  private static readonly RECOVERY_RANDOM_RANGE = 5;        // Random variation in recovery speed
  private static readonly MIN_MOVEMENT_THRESHOLD = 0.5;     // Minimum movement to trigger offset

  constructor(scene: Phaser.Scene, x: number, y: number, config: PlasmaConfig) {
    this.scene = scene;
    this.config = config;
    this.container = scene.add.container(x, y);
    this.container.setDepth(10);

    // Initialize position tracking
    this.lastContainerX = x;
    this.lastContainerY = y;

    this.initializeParticles();
  }

  /**
   * Create all particles in dual-ring formation
   */
  private initializeParticles(): void {
    const innerCount = PlayerPlasmaCore.INNER_RING_COUNT;
    const outerCount = PlayerPlasmaCore.PARTICLE_COUNT - innerCount;

    // Inner ring particles (closer to center, slightly larger, faster recovery)
    for (let i = 0; i < innerCount; i++) {
      const baseAngle = (i / innerCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const baseDistance = PlayerPlasmaCore.INNER_RING_DISTANCE + (Math.random() - 0.5) * 3;
      const radius = PlayerPlasmaCore.INNER_PARTICLE_SIZE_MIN +
        Math.random() * (PlayerPlasmaCore.INNER_PARTICLE_SIZE_MAX - PlayerPlasmaCore.INNER_PARTICLE_SIZE_MIN);

      this.createParticle(baseAngle, baseDistance, radius, true);
    }

    // Outer ring particles (farther from center, slightly smaller, slower recovery)
    for (let i = 0; i < outerCount; i++) {
      const baseAngle = (i / outerCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const baseDistance = PlayerPlasmaCore.OUTER_RING_DISTANCE + (Math.random() - 0.5) * 4;
      const radius = PlayerPlasmaCore.OUTER_PARTICLE_SIZE_MIN +
        Math.random() * (PlayerPlasmaCore.OUTER_PARTICLE_SIZE_MAX - PlayerPlasmaCore.OUTER_PARTICLE_SIZE_MIN);

      this.createParticle(baseAngle, baseDistance, radius, false);
    }
  }

  /**
   * Create a single particle with its visual objects
   */
  private createParticle(baseAngle: number, baseDistance: number, radius: number, isInner: boolean): void {
    const { neonColor } = this.config;

    const initialX = Math.cos(baseAngle) * baseDistance;
    const initialY = Math.sin(baseAngle) * baseDistance;

    // Recovery speed: inner particles recover faster, outer particles slower
    // Add significant random variation for organic, varied movement speeds
    const baseRecovery = isInner
      ? PlayerPlasmaCore.RECOVERY_SPEED_MAX
      : PlayerPlasmaCore.RECOVERY_SPEED_MIN;
    const recoveryVariation = (Math.random() - 0.5) * PlayerPlasmaCore.RECOVERY_RANDOM_RANGE * 2;

    const particle: SwarmParticle = {
      baseAngle,
      baseDistance,
      radius,
      alphaMultiplier: 0.8 + Math.random() * 0.4,

      // Unique wobble parameters for organic feel
      wobblePhaseX: Math.random() * Math.PI * 2,
      wobblePhaseY: Math.random() * Math.PI * 2,
      wobbleFreqX: PlayerPlasmaCore.WOBBLE_FREQ_MIN +
        Math.random() * (PlayerPlasmaCore.WOBBLE_FREQ_MAX - PlayerPlasmaCore.WOBBLE_FREQ_MIN),
      wobbleFreqY: PlayerPlasmaCore.WOBBLE_FREQ_MIN +
        Math.random() * (PlayerPlasmaCore.WOBBLE_FREQ_MAX - PlayerPlasmaCore.WOBBLE_FREQ_MIN),

      // Movement offset (starts at zero)
      offsetX: 0,
      offsetY: 0,
      offsetRecoverySpeed: Math.max(4, baseRecovery + recoveryVariation),
      offsetMultiplierVariation: 0.5 + Math.random(),  // Range: 0.5 to 1.5

      scatterX: 0,
      scatterY: 0,

      // Random pulse timing per particle
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: PlayerPlasmaCore.PULSE_SPEED_MIN +
        Math.random() * (PlayerPlasmaCore.PULSE_SPEED_MAX - PlayerPlasmaCore.PULSE_SPEED_MIN),
      pulseOffset: Math.random() * Math.PI * 2,

      coreCircle: null!,
    };

    // Create core circle (no outline)
    particle.coreCircle = this.scene.add.circle(
      initialX,
      initialY,
      radius,
      neonColor.core,
      particle.alphaMultiplier
    );
    this.container.add(particle.coreCircle);

    this.particles.push(particle);
  }

  /**
   * Main update method - call each frame
   */
  public update(velocityX: number, velocityY: number, deltaSeconds: number): void {
    // Update timing
    this.globalTime += deltaSeconds;
    this.breathingPhase += deltaSeconds * PlayerPlasmaCore.BREATHING_SPEED;
    if (this.breathingPhase > Math.PI * 2) {
      this.breathingPhase -= Math.PI * 2;
    }

    // Calculate container movement this frame
    const containerDeltaX = this.container.x - this.lastContainerX;
    const containerDeltaY = this.container.y - this.lastContainerY;
    this.lastContainerX = this.container.x;
    this.lastContainerY = this.container.y;

    // Update smoothed speed for visual effects
    const currentSpeed = Math.sqrt(velocityX ** 2 + velocityY ** 2);
    this.smoothedSpeed = Phaser.Math.Linear(this.smoothedSpeed, currentSpeed, 0.1);
    const normalizedSpeed = Math.min(this.smoothedSpeed / PlayerPlasmaCore.MAX_SPEED, 1);

    // Breathing reduces when moving fast
    const breathingScale = 1 + Math.sin(this.breathingPhase) *
      PlayerPlasmaCore.BREATHING_AMPLITUDE * (1 - normalizedSpeed * 0.7);

    // Apply movement offsets based on container movement
    this.applyMovementOffsets(containerDeltaX, containerDeltaY);

    // Recover offsets toward zero
    this.recoverOffsets(deltaSeconds);

    // Decay any existing scatter
    this.decayScatter(deltaSeconds);

    // Update each particle
    for (const particle of this.particles) {
      this.updateParticlePosition(particle, breathingScale);
      this.updateParticlePulse(particle, deltaSeconds);
    }
  }

  /**
   * Update particle color pulse - random slow brightening
   */
  private updateParticlePulse(particle: SwarmParticle, deltaSeconds: number): void {
    const { neonColor } = this.config;

    // Advance pulse phase
    particle.pulsePhase += deltaSeconds * particle.pulseSpeed;
    if (particle.pulsePhase > Math.PI * 2) {
      particle.pulsePhase -= Math.PI * 2;
    }

    // Calculate pulse intensity using smooth sine wave
    // Use multiple sine waves for more organic feel
    const pulse1 = Math.sin(particle.pulsePhase);
    const pulse2 = Math.sin(particle.pulsePhase * 0.7 + particle.pulseOffset);
    const combinedPulse = (pulse1 + pulse2) * 0.5;

    // Only brighten when pulse is positive (creates pauses between pulses)
    const brightenAmount = Math.max(0, combinedPulse) * PlayerPlasmaCore.PULSE_INTENSITY;

    // Apply color
    const pulsedColor = lightenColor(neonColor.core, brightenAmount);
    particle.coreCircle.setFillStyle(pulsedColor);
  }

  /**
   * Apply movement offsets to create trailing effect
   * Front particles get small offset, back particles get large offset
   */
  private applyMovementOffsets(deltaX: number, deltaY: number): void {
    const movementMagnitude = Math.sqrt(deltaX ** 2 + deltaY ** 2);

    // Only apply offset if we're actually moving
    if (movementMagnitude < PlayerPlasmaCore.MIN_MOVEMENT_THRESHOLD) {
      return;
    }

    // Movement direction (normalized)
    const moveDirX = deltaX / movementMagnitude;
    const moveDirY = deltaY / movementMagnitude;

    for (const particle of this.particles) {
      // Calculate particle's home position
      const homeX = Math.cos(particle.baseAngle) * particle.baseDistance;
      const homeY = Math.sin(particle.baseAngle) * particle.baseDistance;

      // Dot product determines front/back position
      // Positive = particle is ahead (in movement direction)
      // Negative = particle is behind (opposite to movement direction)
      const dot = homeX * moveDirX + homeY * moveDirY;

      // Normalize to 0-1 range: 0 = front (smallest offset), 1 = back (largest offset)
      // Using baseDistance to normalize the dot product
      const maxDot = particle.baseDistance;
      const normalizedPosition = (maxDot - dot) / (maxDot * 2);
      const clampedPosition = Math.max(0, Math.min(1, normalizedPosition));

      // Calculate offset multiplier: front gets small offset, back gets large offset
      // Then apply per-particle variation for organic feel
      const baseOffsetMultiplier = PlayerPlasmaCore.OFFSET_FRONT_MULTIPLIER +
        clampedPosition * (PlayerPlasmaCore.OFFSET_BACK_MULTIPLIER - PlayerPlasmaCore.OFFSET_FRONT_MULTIPLIER);
      const offsetMultiplier = baseOffsetMultiplier * particle.offsetMultiplierVariation;

      // Apply offset OPPOSITE to movement direction
      // This makes particles "lag behind" the container
      particle.offsetX -= deltaX * offsetMultiplier;
      particle.offsetY -= deltaY * offsetMultiplier;
    }
  }

  /**
   * Recover offsets toward zero over time
   */
  private recoverOffsets(deltaSeconds: number): void {
    for (const particle of this.particles) {
      // Exponential decay toward zero
      const recoveryFactor = 1 - Math.min(1, particle.offsetRecoverySpeed * deltaSeconds);
      particle.offsetX *= recoveryFactor;
      particle.offsetY *= recoveryFactor;

      // Clamp tiny values to zero to prevent floating point drift
      if (Math.abs(particle.offsetX) < 0.01) particle.offsetX = 0;
      if (Math.abs(particle.offsetY) < 0.01) particle.offsetY = 0;
    }
  }

  /**
   * Decay any existing scatter offsets (scatter is no longer triggered on stop)
   */
  private decayScatter(deltaSeconds: number): void {
    if (this.scatterDecay > 0) {
      this.scatterDecay -= deltaSeconds;
      const decayFactor = Math.exp(-deltaSeconds * PlayerPlasmaCore.SCATTER_DECAY_RATE);

      for (const particle of this.particles) {
        particle.scatterX *= decayFactor;
        particle.scatterY *= decayFactor;
      }
    }
  }

  /**
   * Calculate wobble offset for a particle
   */
  private calculateWobble(particle: SwarmParticle): { wobbleX: number; wobbleY: number } {
    const wobbleX = Math.sin(this.globalTime * particle.wobbleFreqX + particle.wobblePhaseX) *
      Math.sin(this.globalTime * 1.3 + particle.wobblePhaseX * 0.7) *
      PlayerPlasmaCore.WOBBLE_AMPLITUDE;

    const wobbleY = Math.sin(this.globalTime * particle.wobbleFreqY + particle.wobblePhaseY) *
      Math.sin(this.globalTime * 1.7 + particle.wobblePhaseY * 0.5) *
      PlayerPlasmaCore.WOBBLE_AMPLITUDE;

    return { wobbleX, wobbleY };
  }

  /**
   * Update a particle's position
   */
  private updateParticlePosition(particle: SwarmParticle, breathingScale: number): void {
    // Base position with breathing
    const breathingDistance = particle.baseDistance * breathingScale;
    let posX = Math.cos(particle.baseAngle) * breathingDistance;
    let posY = Math.sin(particle.baseAngle) * breathingDistance;

    // Add wobble
    const wobble = this.calculateWobble(particle);
    posX += wobble.wobbleX;
    posY += wobble.wobbleY;

    // Add scatter offset
    posX += particle.scatterX;
    posY += particle.scatterY;

    // Add movement offset (THIS IS THE KEY - creates trailing effect)
    posX += particle.offsetX;
    posY += particle.offsetY;

    // Update display position
    particle.coreCircle.setPosition(posX, posY);
  }

  /**
   * Get the container for SpriteSystem registration
   */
  public getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  /**
   * Update visual quality
   */
  public setQuality(quality: VisualQuality): void {
    if (quality === this.config.quality) return;
    this.config.quality = quality;
  }

  /**
   * Clean up all resources
   */
  public destroy(): void {
    this.container.destroy();
  }
}
