/**
 * PlayerParticleSwarm - A dense swarm of particles that form the player
 *
 * Features:
 * - 100 glowing particles with boids-inspired physics
 * - Separation: particles avoid overlapping each other
 * - Cohesion: gentle pull toward nearby neighbors
 * - Alignment: particles match neighbor velocity for coordinated flowing turns
 * - Center attraction: keeps the swarm anchored on the player with breathing pulse
 * - Multi-octave noise wander: 4 sinusoids at irrational frequency ratios (φ, e, φ³) for never-repeating drift
 * - Idle orbital motion: elliptical orbits with drifting tilt axis when stationary
 * - Movement elongation: comet-tail stretching along velocity axis when moving
 * - Enhanced inertia: asymmetric trailing (back particles lag 2.5× more)
 * - Staggered breathing: per-particle phase offsets create wave-like pulse
 * - Movement blend: smooth 0.3s ramp-up / 0.5s settle-down between idle and movement states
 * - Dynamic particle scale: speed-based size boost with per-particle velocity variation
 * - Alpha sparkle: flickering alpha variation during movement
 * - Color warmth shift: tints toward warm-white when moving
 * - Speed-dependent boids: tighter formation when moving, looser when idle
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
  // Boids state (container-local space)
  posX: number;
  posY: number;
  velX: number;
  velY: number;

  // Target distance from center (used by center attraction force)
  baseDistance: number;

  // Wander noise phase (unique per particle for organic variation)
  wanderPhase: number;

  // Multi-octave noise phase offsets (unique per particle per axis)
  wanderPhaseOffsetX2: number;
  wanderPhaseOffsetX3: number;
  wanderPhaseOffsetX4: number;
  wanderPhaseOffsetY1: number;
  wanderPhaseOffsetY2: number;
  wanderPhaseOffsetY3: number;
  wanderPhaseOffsetY4: number;

  // Idle orbital parameters
  orbitalPhase: number;
  orbitalSpeed: number;
  orbitalEccentricity: number;
  orbitalTilt: number;
  orbitalDriftSpeed: number;

  // Staggered breathing
  breathingOffset: number;

  // Visual properties
  radius: number;
  baseRadius: number;
  alphaMultiplier: number;

  // Color pulse (random brightening)
  pulsePhase: number;
  pulseSpeed: number;
  pulseOffset: number;

  // Phaser display object
  coreCircle: Phaser.GameObjects.Arc;
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

  // Container position tracking for movement inertia
  private lastContainerX: number = 0;
  private lastContainerY: number = 0;

  // Smoothed velocity for visual effects
  private smoothedSpeed: number = 0;

  // Movement blend state (0 = idle, 1 = full movement)
  private movementBlend: number = 0;
  private smoothedVelDirX: number = 0;
  private smoothedVelDirY: number = 0;

  // Level-up growth state
  private activeParticleCount: number;
  private burstTimer: number = 0;
  private burstNewStartIndex: number = 0;
  private burstNewEndIndex: number = 0;

  // --- Particle layout constants ---
  private static readonly PARTICLE_COUNT = 100;
  private static readonly INNER_RING_COUNT = 40;
  private static readonly INNER_RING_DISTANCE = 10;
  private static readonly OUTER_RING_DISTANCE = 18;
  private static readonly INNER_PARTICLE_SIZE_MIN = 2;
  private static readonly INNER_PARTICLE_SIZE_MAX = 3.5;
  private static readonly OUTER_PARTICLE_SIZE_MIN = 1.5;
  private static readonly OUTER_PARTICLE_SIZE_MAX = 2.5;

  private static readonly MAX_SPEED = 300;

  // --- Breathing ---
  private static readonly BREATHING_SPEED = 2.5;
  private static readonly BREATHING_AMPLITUDE = 0.22;

  // --- Boids tuning ---
  private static readonly SWARM_PERCEPTION_RADIUS = 30;
  private static readonly SWARM_SEPARATION_RADIUS = 8;
  private static readonly WEIGHT_SEPARATION = 3.0;
  private static readonly WEIGHT_CENTER = 0.8;
  private static readonly WEIGHT_ALIGNMENT = 0.6;
  private static readonly WEIGHT_WANDER = 1.0;
  private static readonly WEIGHT_COHESION = 0.35;
  private static readonly VELOCITY_LERP_FACTOR = 8.0;
  private static readonly MOVEMENT_INERTIA = 0.55;
  private static readonly MAX_PARTICLE_SPEED = 75;

  // --- Multi-octave noise wander ---
  private static readonly WANDER_OCTAVE_1_FREQ = 1.0;
  private static readonly WANDER_OCTAVE_2_FREQ = 1.6180339887;  // Golden ratio — maximally irrational
  private static readonly WANDER_OCTAVE_3_FREQ = 2.7182818284;  // Euler's number
  private static readonly WANDER_OCTAVE_4_FREQ = 4.2360679775;  // φ³
  private static readonly WANDER_OCTAVE_1_AMP = 0.5;
  private static readonly WANDER_OCTAVE_2_AMP = 0.25;
  private static readonly WANDER_OCTAVE_3_AMP = 0.125;
  private static readonly WANDER_OCTAVE_4_AMP = 0.0625;
  private static readonly WANDER_BASE_SPEED = 1.8;

  // --- Idle orbital behavior ---
  private static readonly IDLE_ORBITAL_SPEED_MIN = 0.8;
  private static readonly IDLE_ORBITAL_SPEED_MAX = 1.6;
  private static readonly IDLE_ORBITAL_ECCENTRICITY_MIN = 0.15;
  private static readonly IDLE_ORBITAL_ECCENTRICITY_MAX = 0.45;
  private static readonly IDLE_ORBITAL_WEIGHT = 1.2;
  private static readonly IDLE_ORBITAL_DRIFT_SPEED = 0.1;

  // --- Movement blend ---
  private static readonly MOVEMENT_BLEND_SPEED_UP = 3.3;
  private static readonly MOVEMENT_BLEND_SPEED_DOWN = 2.0;
  private static readonly MOVEMENT_SPEED_THRESHOLD = 15;

  // --- Movement elongation ---
  private static readonly ELONGATION_STRETCH_FACTOR = 0.4;
  private static readonly ELONGATION_COMPRESS_FACTOR = 0.15;
  private static readonly TRAIL_INERTIA_MULTIPLIER = 2.5;
  private static readonly MOVEMENT_CENTER_WEIGHT_BOOST = 0.6;
  private static readonly MOVEMENT_SEPARATION_REDUCTION = 0.4;

  // --- Speed-dependent visuals ---
  private static readonly SPEED_SIZE_BOOST = 0.25;
  private static readonly SPEED_ALPHA_VARIATION = 0.2;
  private static readonly SPEED_WARMTH_AMOUNT = 0.15;
  private static readonly SPEED_WARMTH_COLOR = 0xffeedd;
  private static readonly PARTICLE_VELOCITY_SIZE_FACTOR = 0.003;
  private static readonly PARTICLE_VELOCITY_SIZE_MAX = 0.35;

  // --- Directional streaming ---
  private static readonly STREAMING_CENTER_OFFSET = 6.0;
  private static readonly STREAMING_FORCE_STRENGTH = 2.5;
  private static readonly STREAMING_FRONT_DRAG = 0.3;
  private static readonly WEIGHT_STREAMING = 1.0;

  // --- Asymmetric elongation ---
  private static readonly ELONGATION_FORWARD_BIAS = 1.6;
  private static readonly ELONGATION_BACKWARD_BIAS = 0.6;

  // --- Leading/trailing visual differentiation ---
  private static readonly STREAMING_LEAD_SCALE = -0.15;
  private static readonly STREAMING_TRAIL_SCALE = 0.1;
  private static readonly STREAMING_LEAD_ALPHA = 0.15;
  private static readonly STREAMING_TRAIL_ALPHA = -0.1;

  // --- Color pulse ---
  private static readonly PULSE_SPEED_MIN = 0.3;
  private static readonly PULSE_SPEED_MAX = 1.2;
  private static readonly PULSE_INTENSITY = 0.4;

  // --- Level-up growth ---
  private static readonly STARTING_PARTICLE_COUNT = 20;
  private static readonly PARTICLES_PER_LEVEL = 4;    // All 100 active by level 21
  private static readonly BURST_DURATION = 0.3;        // seconds
  private static readonly BURST_SHOCKWAVE_STRENGTH = 15;
  private static readonly BURST_BRIGHTNESS_BOOST = 0.6;

  constructor(scene: Phaser.Scene, x: number, y: number, config: PlasmaConfig, startingLevel: number = 1) {
    this.scene = scene;
    this.config = config;
    this.container = scene.add.container(x, y);
    this.container.setDepth(10);

    this.lastContainerX = x;
    this.lastContainerY = y;

    this.activeParticleCount = Math.min(
      PlayerPlasmaCore.PARTICLE_COUNT,
      PlayerPlasmaCore.STARTING_PARTICLE_COUNT + (startingLevel - 1) * PlayerPlasmaCore.PARTICLES_PER_LEVEL
    );

    this.initializeParticles();
  }

  /**
   * Create all particles in dual-ring formation (initial positions only —
   * boids physics takes over immediately on first update)
   */
  private initializeParticles(): void {
    const innerCount = PlayerPlasmaCore.INNER_RING_COUNT;
    const outerCount = PlayerPlasmaCore.PARTICLE_COUNT - innerCount;

    for (let i = 0; i < innerCount; i++) {
      const baseAngle = (i / innerCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const baseDistance = PlayerPlasmaCore.INNER_RING_DISTANCE + (Math.random() - 0.5) * 3;
      const particleRadius = PlayerPlasmaCore.INNER_PARTICLE_SIZE_MIN +
        Math.random() * (PlayerPlasmaCore.INNER_PARTICLE_SIZE_MAX - PlayerPlasmaCore.INNER_PARTICLE_SIZE_MIN);

      this.createParticle(baseAngle, baseDistance, particleRadius);
    }

    for (let i = 0; i < outerCount; i++) {
      const baseAngle = (i / outerCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const baseDistance = PlayerPlasmaCore.OUTER_RING_DISTANCE + (Math.random() - 0.5) * 4;
      const particleRadius = PlayerPlasmaCore.OUTER_PARTICLE_SIZE_MIN +
        Math.random() * (PlayerPlasmaCore.OUTER_PARTICLE_SIZE_MAX - PlayerPlasmaCore.OUTER_PARTICLE_SIZE_MIN);

      this.createParticle(baseAngle, baseDistance, particleRadius);
    }

    // Hide particles beyond the current active count
    for (let i = this.activeParticleCount; i < this.particles.length; i++) {
      this.particles[i].coreCircle.setVisible(false);
      this.particles[i].coreCircle.setAlpha(0);
    }
  }

  /**
   * Create a single particle with boids state initialized from ring position
   */
  private createParticle(initialAngle: number, baseDistance: number, particleRadius: number): void {
    const { neonColor } = this.config;

    const initialX = Math.cos(initialAngle) * baseDistance;
    const initialY = Math.sin(initialAngle) * baseDistance;

    const randomPhase = () => Math.random() * Math.PI * 2;

    const particle: SwarmParticle = {
      posX: initialX,
      posY: initialY,
      velX: 0,
      velY: 0,
      baseDistance,
      wanderPhase: randomPhase(),

      // Multi-octave noise offsets (unique per particle per axis)
      wanderPhaseOffsetX2: randomPhase(),
      wanderPhaseOffsetX3: randomPhase(),
      wanderPhaseOffsetX4: randomPhase(),
      wanderPhaseOffsetY1: randomPhase(),
      wanderPhaseOffsetY2: randomPhase(),
      wanderPhaseOffsetY3: randomPhase(),
      wanderPhaseOffsetY4: randomPhase(),

      // Idle orbital parameters
      orbitalPhase: randomPhase(),
      orbitalSpeed: PlayerPlasmaCore.IDLE_ORBITAL_SPEED_MIN +
        Math.random() * (PlayerPlasmaCore.IDLE_ORBITAL_SPEED_MAX - PlayerPlasmaCore.IDLE_ORBITAL_SPEED_MIN),
      orbitalEccentricity: PlayerPlasmaCore.IDLE_ORBITAL_ECCENTRICITY_MIN +
        Math.random() * (PlayerPlasmaCore.IDLE_ORBITAL_ECCENTRICITY_MAX - PlayerPlasmaCore.IDLE_ORBITAL_ECCENTRICITY_MIN),
      orbitalTilt: randomPhase(),
      orbitalDriftSpeed: PlayerPlasmaCore.IDLE_ORBITAL_DRIFT_SPEED * (0.5 + Math.random()),

      // Staggered breathing
      breathingOffset: randomPhase(),

      radius: particleRadius,
      baseRadius: particleRadius,
      alphaMultiplier: 0.8 + Math.random() * 0.4,

      pulsePhase: randomPhase(),
      pulseSpeed: PlayerPlasmaCore.PULSE_SPEED_MIN +
        Math.random() * (PlayerPlasmaCore.PULSE_SPEED_MAX - PlayerPlasmaCore.PULSE_SPEED_MIN),
      pulseOffset: randomPhase(),

      coreCircle: null!,
    };

    particle.coreCircle = this.scene.add.circle(
      initialX,
      initialY,
      particleRadius,
      neonColor.core,
      particle.alphaMultiplier
    );
    this.container.add(particle.coreCircle);

    this.particles.push(particle);
  }

  /**
   * Called by GameScene when the player levels up.
   * Activates new particles and triggers the burst animation.
   */
  public onLevelUp(newLevel: number): void {
    const previousActiveCount = this.activeParticleCount;
    const newActiveCount = Math.min(
      PlayerPlasmaCore.PARTICLE_COUNT,
      PlayerPlasmaCore.STARTING_PARTICLE_COUNT + (newLevel - 1) * PlayerPlasmaCore.PARTICLES_PER_LEVEL
    );

    if (newActiveCount <= previousActiveCount) return;

    this.activeParticleCount = newActiveCount;

    // Track which particles are newly revealed for scale-in animation
    this.burstNewStartIndex = previousActiveCount;
    this.burstNewEndIndex = newActiveCount;

    // Make newly active particles visible at scale 0 (they'll scale in during burst)
    for (let i = previousActiveCount; i < newActiveCount; i++) {
      const particle = this.particles[i];
      particle.coreCircle.setVisible(true);
      particle.coreCircle.setAlpha(particle.alphaMultiplier);
      particle.coreCircle.setScale(0);
    }

    // Kick off burst animation
    this.burstTimer = PlayerPlasmaCore.BURST_DURATION;
  }

  /**
   * Main update — runs boids simulation each frame
   */
  public update(velocityX: number, velocityY: number, deltaSeconds: number): void {
    // Clamp delta to prevent huge jumps on tab-switch or lag spikes
    const dt = Math.min(deltaSeconds, 0.05);

    // Update timing
    this.globalTime += dt;
    this.breathingPhase += dt * PlayerPlasmaCore.BREATHING_SPEED;
    if (this.breathingPhase > Math.PI * 2) {
      this.breathingPhase -= Math.PI * 2;
    }

    // Container movement delta (for inertia force)
    const containerDeltaX = this.container.x - this.lastContainerX;
    const containerDeltaY = this.container.y - this.lastContainerY;
    this.lastContainerX = this.container.x;
    this.lastContainerY = this.container.y;

    // Smoothed speed for breathing modulation
    const currentSpeed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    this.smoothedSpeed = Phaser.Math.Linear(this.smoothedSpeed, currentSpeed, 0.1);
    const normalizedSpeed = Math.min(this.smoothedSpeed / PlayerPlasmaCore.MAX_SPEED, 1);

    // --- D1: Movement blend tracking (asymmetric ramp) ---
    const targetMovementBlend = currentSpeed > PlayerPlasmaCore.MOVEMENT_SPEED_THRESHOLD ? 1 : 0;
    if (targetMovementBlend > this.movementBlend) {
      this.movementBlend = Math.min(1, this.movementBlend + dt * PlayerPlasmaCore.MOVEMENT_BLEND_SPEED_UP);
    } else {
      this.movementBlend = Math.max(0, this.movementBlend - dt * PlayerPlasmaCore.MOVEMENT_BLEND_SPEED_DOWN);
    }
    const idleBlend = 1 - this.movementBlend;

    // --- D2: Smoothed velocity direction (for elongation axis) ---
    if (currentSpeed > 0.1) {
      const currentDirX = velocityX / currentSpeed;
      const currentDirY = velocityY / currentSpeed;
      this.smoothedVelDirX += (currentDirX - this.smoothedVelDirX) * 0.15;
      this.smoothedVelDirY += (currentDirY - this.smoothedVelDirY) * 0.15;
      // Normalize to prevent magnitude drift
      const smoothedDirMagnitude = Math.sqrt(
        this.smoothedVelDirX * this.smoothedVelDirX + this.smoothedVelDirY * this.smoothedVelDirY
      );
      if (smoothedDirMagnitude > 0.01) {
        this.smoothedVelDirX /= smoothedDirMagnitude;
        this.smoothedVelDirY /= smoothedDirMagnitude;
      }
    }

    // Movement direction (for directional inertia)
    const containerMoveMagnitude = Math.sqrt(
      containerDeltaX * containerDeltaX + containerDeltaY * containerDeltaY
    );
    const hasContainerMovement = containerMoveMagnitude > 0.1;
    const moveDirX = hasContainerMovement ? containerDeltaX / containerMoveMagnitude : 0;
    const moveDirY = hasContainerMovement ? containerDeltaY / containerMoveMagnitude : 0;

    // --- D3: Speed-dependent boids parameters ---
    const dynamicSeparationRadius = PlayerPlasmaCore.SWARM_SEPARATION_RADIUS *
      (1 - this.movementBlend * PlayerPlasmaCore.MOVEMENT_SEPARATION_REDUCTION);
    const dynamicCenterWeight = PlayerPlasmaCore.WEIGHT_CENTER +
      this.movementBlend * PlayerPlasmaCore.MOVEMENT_CENTER_WEIGHT_BOOST;

    // Precompute squared radii for neighbor checks
    const perceptionRadiusSq = PlayerPlasmaCore.SWARM_PERCEPTION_RADIUS * PlayerPlasmaCore.SWARM_PERCEPTION_RADIUS;
    const dynamicSeparationRadiusSq = dynamicSeparationRadius * dynamicSeparationRadius;

    // Exponential lerp factor (frame-rate independent momentum smoothing)
    const lerpFactor = 1 - Math.exp(-PlayerPlasmaCore.VELOCITY_LERP_FACTOR * dt);

    const activeCount = this.activeParticleCount;

    // --- Burst animation state ---
    let burstProgress = 0;
    let burstShockwaveForce = 0;
    const isBursting = this.burstTimer > 0;
    if (isBursting) {
      this.burstTimer -= dt;
      if (this.burstTimer < 0) this.burstTimer = 0;
      burstProgress = 1 - (this.burstTimer / PlayerPlasmaCore.BURST_DURATION);
      // Shockwave follows sin curve: ramps up then back down
      burstShockwaveForce = Math.sin(burstProgress * Math.PI) * PlayerPlasmaCore.BURST_SHOCKWAVE_STRENGTH;
    }

    // Wander weight modulated by idle/move state (halves during movement)
    const effectiveWanderWeight = PlayerPlasmaCore.WEIGHT_WANDER * (0.5 + 0.5 * idleBlend);

    // --- Boids simulation for each active particle ---
    for (let i = 0; i < activeCount; i++) {
      const particle = this.particles[i];

      // --- D4: Per-particle staggered breathing ---
      const particleBreathingPhase = this.breathingPhase + particle.breathingOffset;
      const breathingScale = 1 + Math.sin(particleBreathingPhase) *
        PlayerPlasmaCore.BREATHING_AMPLITUDE * (1 - normalizedSpeed * 0.7);

      // Accumulate boids forces
      let separationForceX = 0;
      let separationForceY = 0;
      let cohesionSumX = 0;
      let cohesionSumY = 0;
      let alignmentSumX = 0;
      let alignmentSumY = 0;
      let neighborCount = 0;
      let separationCount = 0;

      // Check all other active particles
      for (let j = 0; j < activeCount; j++) {
        if (i === j) continue;

        const other = this.particles[j];
        const diffX = particle.posX - other.posX;
        const diffY = particle.posY - other.posY;
        const distanceSq = diffX * diffX + diffY * diffY;

        // Within perception radius — count for cohesion and alignment
        if (distanceSq < perceptionRadiusSq && distanceSq > 0.001) {
          neighborCount++;
          cohesionSumX += other.posX;
          cohesionSumY += other.posY;
          alignmentSumX += other.velX;
          alignmentSumY += other.velY;

          // Within dynamic separation radius — add repulsion
          if (distanceSq < dynamicSeparationRadiusSq) {
            const distance = Math.sqrt(distanceSq);
            // Inverse-proportional repulsion (stronger when closer)
            const repulsionStrength = (dynamicSeparationRadius - distance) / dynamicSeparationRadius;
            separationForceX += (diffX / distance) * repulsionStrength;
            separationForceY += (diffY / distance) * repulsionStrength;
            separationCount++;
          }
        }
      }

      // Normalize separation
      if (separationCount > 0) {
        separationForceX /= separationCount;
        separationForceY /= separationCount;
      }

      // Cohesion — steer toward average neighbor position
      let cohesionForceX = 0;
      let cohesionForceY = 0;
      if (neighborCount > 0) {
        const averageNeighborX = cohesionSumX / neighborCount;
        const averageNeighborY = cohesionSumY / neighborCount;
        cohesionForceX = averageNeighborX - particle.posX;
        cohesionForceY = averageNeighborY - particle.posY;
      }

      // Alignment — match average neighbor velocity
      let alignmentForceX = 0;
      let alignmentForceY = 0;
      if (neighborCount > 0) {
        alignmentForceX = alignmentSumX / neighborCount - particle.velX;
        alignmentForceY = alignmentSumY / neighborCount - particle.velY;
      }

      // Center attraction — pull toward offset center at breathing-modulated target distance
      const targetDistance = particle.baseDistance * breathingScale;
      // Original distance from (0,0) — preserved for burst shockwave
      const distanceFromCenter = Math.sqrt(particle.posX * particle.posX + particle.posY * particle.posY);

      // Forward center offset — shift attraction point in movement direction
      const centerOffsetX = this.smoothedVelDirX * PlayerPlasmaCore.STREAMING_CENTER_OFFSET * this.movementBlend * normalizedSpeed;
      const centerOffsetY = this.smoothedVelDirY * PlayerPlasmaCore.STREAMING_CENTER_OFFSET * this.movementBlend * normalizedSpeed;
      const relativeToCenterX = particle.posX - centerOffsetX;
      const relativeToCenterY = particle.posY - centerOffsetY;
      const distanceFromOffsetCenter = Math.sqrt(relativeToCenterX * relativeToCenterX + relativeToCenterY * relativeToCenterY);

      let centerForceX = 0;
      let centerForceY = 0;
      if (distanceFromOffsetCenter > 0.01) {
        const directionToCenterX = -relativeToCenterX / distanceFromOffsetCenter;
        const directionToCenterY = -relativeToCenterY / distanceFromOffsetCenter;
        // Force proportional to how far from target distance
        const distanceError = distanceFromOffsetCenter - targetDistance;
        centerForceX = directionToCenterX * distanceError;
        centerForceY = directionToCenterY * distanceError;
      } else {
        // If at exact center, nudge outward to target distance
        const randomAngle = particle.wanderPhase;
        centerForceX = -Math.cos(randomAngle) * targetDistance;
        centerForceY = -Math.sin(randomAngle) * targetDistance;
      }

      // --- D5: Multi-octave noise wander ---
      particle.wanderPhase += dt * (PlayerPlasmaCore.WANDER_BASE_SPEED +
        Math.sin(particle.wanderPhase * 0.7) * 0.5);
      if (particle.wanderPhase > Math.PI * 200) {
        particle.wanderPhase -= Math.PI * 200;
      }
      const wanderPhase = particle.wanderPhase;
      const wanderForceX =
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_1_FREQ) * PlayerPlasmaCore.WANDER_OCTAVE_1_AMP +
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_2_FREQ + particle.wanderPhaseOffsetX2) * PlayerPlasmaCore.WANDER_OCTAVE_2_AMP +
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_3_FREQ + particle.wanderPhaseOffsetX3) * PlayerPlasmaCore.WANDER_OCTAVE_3_AMP +
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_4_FREQ + particle.wanderPhaseOffsetX4) * PlayerPlasmaCore.WANDER_OCTAVE_4_AMP;
      const wanderForceY =
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_1_FREQ + particle.wanderPhaseOffsetY1) * PlayerPlasmaCore.WANDER_OCTAVE_1_AMP +
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_2_FREQ + particle.wanderPhaseOffsetY2) * PlayerPlasmaCore.WANDER_OCTAVE_2_AMP +
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_3_FREQ + particle.wanderPhaseOffsetY3) * PlayerPlasmaCore.WANDER_OCTAVE_3_AMP +
        Math.sin(wanderPhase * PlayerPlasmaCore.WANDER_OCTAVE_4_FREQ + particle.wanderPhaseOffsetY4) * PlayerPlasmaCore.WANDER_OCTAVE_4_AMP;

      // --- D6: Idle orbital force ---
      let orbitalForceX = 0;
      let orbitalForceY = 0;
      if (idleBlend > 0.01) {
        particle.orbitalPhase += dt * particle.orbitalSpeed;
        particle.orbitalTilt += dt * particle.orbitalDriftSpeed;
        if (particle.orbitalPhase > Math.PI * 200) particle.orbitalPhase -= Math.PI * 200;
        if (particle.orbitalTilt > Math.PI * 200) particle.orbitalTilt -= Math.PI * 200;

        // Elliptical target position relative to anchor
        const semiMajor = targetDistance;
        const semiMinor = targetDistance * (1 - particle.orbitalEccentricity);
        const localX = Math.cos(particle.orbitalPhase) * semiMajor;
        const localY = Math.sin(particle.orbitalPhase) * semiMinor;

        // Rotate by orbital tilt
        const cosTilt = Math.cos(particle.orbitalTilt);
        const sinTilt = Math.sin(particle.orbitalTilt);
        const orbitalTargetX = localX * cosTilt - localY * sinTilt;
        const orbitalTargetY = localX * sinTilt + localY * cosTilt;

        // Steer toward orbital target
        orbitalForceX = (orbitalTargetX - particle.posX);
        orbitalForceY = (orbitalTargetY - particle.posY);
      }
      const orbitalWeight = PlayerPlasmaCore.IDLE_ORBITAL_WEIGHT * idleBlend;

      // --- D7: Movement elongation force ---
      let elongationForceX = 0;
      let elongationForceY = 0;
      if (this.movementBlend > 0.01) {
        // Project particle position onto velocity axis and perpendicular axis
        const velDirX = this.smoothedVelDirX;
        const velDirY = this.smoothedVelDirY;
        const perpDirX = -velDirY;
        const perpDirY = velDirX;

        // Dot products: how far along and perpendicular to movement direction
        const alongProjection = particle.posX * velDirX + particle.posY * velDirY;
        const perpProjection = particle.posX * perpDirX + particle.posY * perpDirY;

        // Stretch along velocity axis, compress perpendicular (asymmetric: longer nose, shorter tail)
        const stretchAmount = PlayerPlasmaCore.ELONGATION_STRETCH_FACTOR * this.movementBlend;
        const elongationBias = alongProjection >= 0
          ? PlayerPlasmaCore.ELONGATION_FORWARD_BIAS
          : PlayerPlasmaCore.ELONGATION_BACKWARD_BIAS;
        const compressAmount = PlayerPlasmaCore.ELONGATION_COMPRESS_FACTOR * this.movementBlend;

        elongationForceX = velDirX * alongProjection * stretchAmount * elongationBias - perpDirX * perpProjection * compressAmount;
        elongationForceY = velDirY * alongProjection * stretchAmount * elongationBias - perpDirY * perpProjection * compressAmount;
      }
      const elongationWeight = 0.8 * this.movementBlend;

      // --- Directional streaming force — per-particle flow in movement direction ---
      let streamingForceX = 0;
      let streamingForceY = 0;
      if (this.movementBlend > 0.01) {
        // Dot product: positive = leading particle, negative = trailing particle
        const streamDot = particle.posX * this.smoothedVelDirX + particle.posY * this.smoothedVelDirY;

        // Trailing particles get full force (rushing to catch up), leading particles coast
        const streamIntensity = streamDot < 0
          ? 1.0
          : PlayerPlasmaCore.STREAMING_FRONT_DRAG;

        const streamStrength = PlayerPlasmaCore.STREAMING_FORCE_STRENGTH * this.movementBlend * normalizedSpeed * streamIntensity;
        streamingForceX = this.smoothedVelDirX * streamStrength;
        streamingForceY = this.smoothedVelDirY * streamStrength;
      }

      // --- D8: Enhanced inertia with asymmetric trailing ---
      let inertiaForceX = 0;
      let inertiaForceY = 0;
      if (hasContainerMovement) {
        // Base inertia: push opposite to container movement
        const baseInertiaX = -containerDeltaX * PlayerPlasmaCore.MOVEMENT_INERTIA;
        const baseInertiaY = -containerDeltaY * PlayerPlasmaCore.MOVEMENT_INERTIA;

        // Back particles (opposite to movement dir) get dramatically stronger inertia
        const dotProduct = particle.posX * moveDirX + particle.posY * moveDirY;
        const maxDist = particle.baseDistance + 5;
        const normalizedDot = dotProduct / maxDist;

        // Trailing particles (negative dot) get up to TRAIL_INERTIA_MULTIPLIER, leading stay near 1.0
        let directionalMultiplier: number;
        if (normalizedDot < 0) {
          // Trailing: ramp from 1.0 to TRAIL_INERTIA_MULTIPLIER as particle is further behind
          directionalMultiplier = 1.0 + (-normalizedDot) * (PlayerPlasmaCore.TRAIL_INERTIA_MULTIPLIER - 1.0);
        } else {
          // Leading: reduce slightly
          directionalMultiplier = 1.0 - normalizedDot * 0.3;
        }
        const clampedMultiplier = Math.max(0.3, Math.min(PlayerPlasmaCore.TRAIL_INERTIA_MULTIPLIER, directionalMultiplier));

        inertiaForceX = baseInertiaX * clampedMultiplier;
        inertiaForceY = baseInertiaY * clampedMultiplier;
      }

      // Burst shockwave — radial outward push on existing particles
      let shockwaveForceX = 0;
      let shockwaveForceY = 0;
      if (isBursting && i < this.burstNewStartIndex && distanceFromCenter > 0.01) {
        shockwaveForceX = (particle.posX / distanceFromCenter) * burstShockwaveForce;
        shockwaveForceY = (particle.posY / distanceFromCenter) * burstShockwaveForce;
      }

      // --- D9: Updated force blending ---
      const targetVelX =
        separationForceX * PlayerPlasmaCore.WEIGHT_SEPARATION +
        cohesionForceX * PlayerPlasmaCore.WEIGHT_COHESION +
        alignmentForceX * PlayerPlasmaCore.WEIGHT_ALIGNMENT +
        centerForceX * dynamicCenterWeight +
        wanderForceX * effectiveWanderWeight +
        orbitalForceX * orbitalWeight +
        elongationForceX * elongationWeight +
        streamingForceX * PlayerPlasmaCore.WEIGHT_STREAMING +
        inertiaForceX +
        shockwaveForceX;

      const targetVelY =
        separationForceY * PlayerPlasmaCore.WEIGHT_SEPARATION +
        cohesionForceY * PlayerPlasmaCore.WEIGHT_COHESION +
        alignmentForceY * PlayerPlasmaCore.WEIGHT_ALIGNMENT +
        centerForceY * dynamicCenterWeight +
        wanderForceY * effectiveWanderWeight +
        orbitalForceY * orbitalWeight +
        elongationForceY * elongationWeight +
        streamingForceY * PlayerPlasmaCore.WEIGHT_STREAMING +
        inertiaForceY +
        shockwaveForceY;

      // Momentum smoothing — exponential lerp (frame-rate independent)
      particle.velX += (targetVelX - particle.velX) * lerpFactor;
      particle.velY += (targetVelY - particle.velY) * lerpFactor;

      // Speed cap
      const particleSpeedSq = particle.velX * particle.velX + particle.velY * particle.velY;
      const maxSpeedSq = PlayerPlasmaCore.MAX_PARTICLE_SPEED * PlayerPlasmaCore.MAX_PARTICLE_SPEED;
      if (particleSpeedSq > maxSpeedSq) {
        const speedScale = PlayerPlasmaCore.MAX_PARTICLE_SPEED / Math.sqrt(particleSpeedSq);
        particle.velX *= speedScale;
        particle.velY *= speedScale;
      }

      // Update position
      particle.posX += particle.velX * dt;
      particle.posY += particle.velY * dt;

      // Set display position
      particle.coreCircle.setPosition(particle.posX, particle.posY);

      // Compute leading/trailing visual differentiation factors
      let streamingScaleOffset = 0;
      let streamingAlphaOffset = 0;
      if (this.movementBlend > 0.01) {
        const positionDotForVisuals = particle.posX * this.smoothedVelDirX + particle.posY * this.smoothedVelDirY;
        const normalizedStreamPosition = Math.max(-1, Math.min(1, positionDotForVisuals / (particle.baseDistance + 5)));
        const streamVisualBlend = this.movementBlend * normalizedSpeed;

        // Leading (positive dot): smaller + brighter; Trailing (negative dot): larger + dimmer
        streamingScaleOffset = normalizedStreamPosition > 0
          ? normalizedStreamPosition * PlayerPlasmaCore.STREAMING_LEAD_SCALE * streamVisualBlend
          : -normalizedStreamPosition * PlayerPlasmaCore.STREAMING_TRAIL_SCALE * streamVisualBlend;

        streamingAlphaOffset = normalizedStreamPosition > 0
          ? normalizedStreamPosition * PlayerPlasmaCore.STREAMING_LEAD_ALPHA * streamVisualBlend
          : -normalizedStreamPosition * PlayerPlasmaCore.STREAMING_TRAIL_ALPHA * streamVisualBlend;
      }

      // New particle scale-in during burst
      if (isBursting && i >= this.burstNewStartIndex && i < this.burstNewEndIndex) {
        // Scale in over the first 33% of burst duration using cubic ease-out
        const scaleInWindow = 0.33;
        const scaleProgress = Math.min(burstProgress / scaleInWindow, 1);
        const easedScale = 1 - Math.pow(1 - scaleProgress, 3);
        particle.coreCircle.setScale(easedScale);
      } else {
        // --- D10: Dynamic particle scale with streaming differentiation ---
        const particleSpeed = Math.sqrt(particleSpeedSq);
        const globalSpeedSizeBoost = normalizedSpeed * PlayerPlasmaCore.SPEED_SIZE_BOOST;
        const velocitySizeBoost = Math.min(
          particleSpeed * PlayerPlasmaCore.PARTICLE_VELOCITY_SIZE_FACTOR,
          PlayerPlasmaCore.PARTICLE_VELOCITY_SIZE_MAX
        );
        particle.coreCircle.setScale(1 + globalSpeedSizeBoost + velocitySizeBoost + streamingScaleOffset);
      }

      // --- D11: Alpha sparkle during movement with streaming differentiation ---
      const alphaFlicker = Math.sin(this.globalTime * 4 + particle.wanderPhase * 2) *
        PlayerPlasmaCore.SPEED_ALPHA_VARIATION * this.movementBlend;
      const sparkleAlpha = Math.max(0.3, Math.min(1.0, particle.alphaMultiplier + alphaFlicker + streamingAlphaOffset));
      particle.coreCircle.setAlpha(sparkleAlpha);

      // Update color pulse
      this.updateParticlePulse(particle, dt);
    }

    // Finalize burst: ensure new particles are at full scale when animation completes
    if (isBursting && this.burstTimer <= 0) {
      for (let i = this.burstNewStartIndex; i < this.burstNewEndIndex; i++) {
        this.particles[i].coreCircle.setScale(1);
      }
      this.burstNewStartIndex = 0;
      this.burstNewEndIndex = 0;
    }
  }

  /**
   * Update particle color pulse — random slow brightening with movement warmth
   */
  private updateParticlePulse(particle: SwarmParticle, deltaSeconds: number): void {
    const { neonColor } = this.config;

    particle.pulsePhase += deltaSeconds * particle.pulseSpeed;
    if (particle.pulsePhase > Math.PI * 2) {
      particle.pulsePhase -= Math.PI * 2;
    }

    const pulse1 = Math.sin(particle.pulsePhase);
    const pulse2 = Math.sin(particle.pulsePhase * 0.7 + particle.pulseOffset);
    const combinedPulse = (pulse1 + pulse2) * 0.5;

    let brightenAmount = Math.max(0, combinedPulse) * PlayerPlasmaCore.PULSE_INTENSITY;

    // Burst brightness flash — decays over burst duration
    if (this.burstTimer > 0) {
      const burstBrightness = (this.burstTimer / PlayerPlasmaCore.BURST_DURATION) *
        PlayerPlasmaCore.BURST_BRIGHTNESS_BOOST;
      brightenAmount = Math.min(1, brightenAmount + burstBrightness);
    }

    let finalColor = lightenColor(neonColor.core, brightenAmount);

    // Color warmth shift — tint toward warm-white when moving
    if (this.movementBlend > 0.01) {
      finalColor = this.lerpColor(
        finalColor,
        PlayerPlasmaCore.SPEED_WARMTH_COLOR,
        this.movementBlend * PlayerPlasmaCore.SPEED_WARMTH_AMOUNT
      );
    }

    particle.coreCircle.setFillStyle(finalColor);
  }

  /**
   * Linear interpolation between two hex colors (bitwise RGB)
   */
  private lerpColor(color1: number, color2: number, interpolationFactor: number): number {
    const red1 = (color1 >> 16) & 0xff;
    const green1 = (color1 >> 8) & 0xff;
    const blue1 = color1 & 0xff;

    const red2 = (color2 >> 16) & 0xff;
    const green2 = (color2 >> 8) & 0xff;
    const blue2 = color2 & 0xff;

    const blendedRed = Math.round(red1 + (red2 - red1) * interpolationFactor);
    const blendedGreen = Math.round(green1 + (green2 - green1) * interpolationFactor);
    const blendedBlue = Math.round(blue1 + (blue2 - blue1) * interpolationFactor);

    return (blendedRed << 16) | (blendedGreen << 8) | blendedBlue;
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
