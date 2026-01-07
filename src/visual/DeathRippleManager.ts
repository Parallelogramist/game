import Phaser from 'phaser';
import { VisualQuality } from './GlowGraphics';
import { spriteRegistry } from '../ecs/systems/SpriteSystem';
import { Transform, EnemyTag } from '../ecs/components';
import { defineQuery, IWorld } from 'bitecs';
import { GAME_WIDTH, GAME_HEIGHT } from '../GameConfig';

// Query for all enemies
const enemyQuery = defineQuery([Transform, EnemyTag]);

/**
 * Represents an expanding ripple wave from an enemy death.
 */
interface ActiveRipple {
  id: number;
  originX: number;
  originY: number;
  currentRadius: number;
  bandWidth: number;
  speed: number;
  maxRadius: number;
}

/**
 * Tracks an enemy's current pulse state from a death ripple.
 */
interface EnemyRippleState {
  entityId: number;
  rippleId: number;
  startTime: number;
  overlay: Phaser.GameObjects.Graphics | null;
}

/**
 * Stored enemy shape data for overlay drawing.
 */
interface EnemyShapeData {
  shape: 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon';
  size: number;
}

// Pre-computed hexagon unit vectors
const HEX_POINTS: { cos: number; sin: number }[] = [];
for (let i = 0; i < 6; i++) {
  const angle = (Math.PI / 3) * i - Math.PI / 2;
  HEX_POINTS.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
}

/**
 * DeathRippleManager handles visual effects related to enemy death:
 * 1. Subtle ambient pulsing (breathing animation on all enemies)
 * 2. Death ripple waves that propagate outward from death locations
 * 3. White flash overlay on enemies as ripples pass through them
 */
export class DeathRippleManager {
  private scene: Phaser.Scene;
  private world: IWorld | null = null;

  // Active ripples expanding outward
  private activeRipples: ActiveRipple[] = [];
  private nextRippleId: number = 0;
  private readonly MAX_RIPPLES = 8;

  // Ripple configuration
  private readonly RIPPLE_SPEED = 300;       // pixels per second
  private readonly RIPPLE_BAND_WIDTH = 75;   // width of the ripple band
  private readonly PULSE_DURATION = 3.0;     // seconds for full red->white->red cycle

  // Enemy pulse states (from death ripples)
  private enemyPulseStates: Map<number, EnemyRippleState> = new Map();

  // Overlay pool for white flash effects
  private overlayPool: Phaser.GameObjects.Graphics[] = [];
  private activeOverlays: Map<number, Phaser.GameObjects.Graphics> = new Map();
  private readonly OVERLAY_POOL_SIZE = 50;

  // Enemy shape data for drawing overlays
  private enemyShapes: Map<number, EnemyShapeData> = new Map();

  // Ambient pulse timing (shared across all enemies)
  private pulseTime: number = 0;
  private readonly PULSE_FREQUENCY = 1.5; // Hz

  // Quality settings
  private enabled: boolean = true;
  private ambientPulseEnabled: boolean = true;
  private rippleOverlaysEnabled: boolean = true;
  private useShapeMatchedOverlays: boolean = true;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initOverlayPool();
  }

  /**
   * Set the ECS world reference for enemy queries.
   */
  setWorld(world: IWorld): void {
    this.world = world;
  }

  /**
   * Pre-allocate overlay graphics objects for pooling.
   */
  private initOverlayPool(): void {
    for (let i = 0; i < this.OVERLAY_POOL_SIZE; i++) {
      const graphics = this.scene.add.graphics();
      graphics.setVisible(false);
      graphics.setDepth(9); // Just above enemies (depth 8)
      this.overlayPool.push(graphics);
    }
  }

  /**
   * Set visual quality level.
   */
  setQuality(quality: VisualQuality): void {
    switch (quality) {
      case 'high':
        this.enabled = true;
        this.ambientPulseEnabled = true;
        this.rippleOverlaysEnabled = true;
        this.useShapeMatchedOverlays = true;
        break;
      case 'medium':
        this.enabled = true;
        this.ambientPulseEnabled = true;
        this.rippleOverlaysEnabled = true;
        this.useShapeMatchedOverlays = false; // Circle only for performance
        break;
      case 'low':
        this.enabled = true;
        this.ambientPulseEnabled = false; // No ambient pulse
        this.rippleOverlaysEnabled = false; // Ripples expand but no enemy color change
        break;
    }
  }

  /**
   * Register an enemy's shape data for overlay drawing.
   * Call this when creating an enemy visual.
   */
  registerEnemy(
    entityId: number,
    shape: 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon',
    size: number
  ): void {
    this.enemyShapes.set(entityId, { shape, size });
  }

  /**
   * Unregister an enemy (call before destroying).
   */
  unregisterEnemy(entityId: number): void {
    this.enemyShapes.delete(entityId);

    // Clean up any active pulse state
    const pulseState = this.enemyPulseStates.get(entityId);
    if (pulseState) {
      this.returnOverlay(entityId);
      this.enemyPulseStates.delete(entityId);
    }
  }

  /**
   * Spawn a new death ripple at the given position.
   */
  spawnRipple(x: number, y: number): void {
    if (!this.enabled) return;

    // Remove oldest ripple if at capacity
    if (this.activeRipples.length >= this.MAX_RIPPLES) {
      this.activeRipples.shift();
    }

    // Calculate max radius needed to fully exit screen
    const maxDistX = Math.max(x, GAME_WIDTH - x);
    const maxDistY = Math.max(y, GAME_HEIGHT - y);
    const maxRadius = Math.sqrt(maxDistX * maxDistX + maxDistY * maxDistY) + this.RIPPLE_BAND_WIDTH;

    this.activeRipples.push({
      id: this.nextRippleId++,
      originX: x,
      originY: y,
      currentRadius: 0,
      bandWidth: this.RIPPLE_BAND_WIDTH,
      speed: this.RIPPLE_SPEED,
      maxRadius,
    });
  }

  /**
   * Main update loop - call each frame.
   */
  update(deltaSeconds: number): void {
    if (!this.enabled || !this.world) return;

    // Update ambient pulse time
    this.pulseTime += deltaSeconds;

    // Update ambient pulsing on all enemies
    if (this.ambientPulseEnabled) {
      this.updateAmbientPulse();
    }

    // Early exit if no ripples active
    if (this.activeRipples.length === 0) return;

    // Expand all ripples
    this.updateRipples(deltaSeconds);

    // Detect ripple collisions with enemies
    if (this.rippleOverlaysEnabled) {
      this.detectRippleCollisions();
    }

    // Update enemy overlay visuals
    this.updateEnemyOverlays(deltaSeconds);

    // Clean up completed ripples
    this.cleanupRipples();
  }

  /**
   * Apply subtle scale pulsing to all enemy containers.
   */
  private updateAmbientPulse(): void {
    if (!this.world) return;

    const enemies = enemyQuery(this.world);

    for (let i = 0; i < enemies.length; i++) {
      const entityId = enemies[i];
      const container = spriteRegistry.get(entityId) as Phaser.GameObjects.Container;

      if (!container) continue;

      // Get or create random phase offset for this enemy
      let phaseOffset = container.getData('pulsePhase') as number;
      if (phaseOffset === undefined || phaseOffset === null) {
        phaseOffset = Math.random();
        container.setData('pulsePhase', phaseOffset);
      }

      // Calculate pulse using sine wave
      const pulse = Math.sin((this.pulseTime * this.PULSE_FREQUENCY + phaseOffset) * Math.PI * 2);

      // Scale: 0.97 to 1.03 (subtle 3% variation)
      // Only apply if not being affected by a death ripple (ripple takes precedence)
      if (!this.enemyPulseStates.has(entityId)) {
        container.setScale(1 + pulse * 0.03);
      }
    }
  }

  /**
   * Expand all active ripples.
   */
  private updateRipples(deltaSeconds: number): void {
    for (const ripple of this.activeRipples) {
      ripple.currentRadius += ripple.speed * deltaSeconds;
    }
  }

  /**
   * Check which enemies are inside ripple bands and start their pulse.
   */
  private detectRippleCollisions(): void {
    if (!this.world) return;

    const enemies = enemyQuery(this.world);
    const currentTime = this.pulseTime;

    for (let i = 0; i < enemies.length; i++) {
      const entityId = enemies[i];
      const enemyX = Transform.x[entityId];
      const enemyY = Transform.y[entityId];

      // Check against all active ripples
      for (const ripple of this.activeRipples) {
        const dx = enemyX - ripple.originX;
        const dy = enemyY - ripple.originY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Inner edge of the ripple band
        const innerEdge = ripple.currentRadius - ripple.bandWidth;

        // Check if enemy is inside the band
        if (distance >= innerEdge && distance <= ripple.currentRadius) {
          // Enemy is being hit by this ripple!
          const existingState = this.enemyPulseStates.get(entityId);

          // Start new pulse or restart if hit by newer ripple
          if (!existingState || existingState.rippleId !== ripple.id) {
            this.startEnemyPulse(entityId, ripple.id, currentTime);
          }
        }
      }
    }
  }

  /**
   * Start or restart an enemy's pulse animation.
   */
  private startEnemyPulse(entityId: number, rippleId: number, startTime: number): void {
    // Get or assign overlay
    let overlay = this.activeOverlays.get(entityId);
    if (!overlay) {
      overlay = this.getOverlayFromPool();
      if (!overlay) return; // Pool exhausted
      this.activeOverlays.set(entityId, overlay);
    }

    // Draw the overlay shape for this enemy
    this.drawOverlayForEnemy(overlay, entityId);

    this.enemyPulseStates.set(entityId, {
      entityId,
      rippleId,
      startTime,
      overlay,
    });
  }

  /**
   * Draw white overlay matching enemy shape.
   */
  private drawOverlayForEnemy(graphics: Phaser.GameObjects.Graphics, entityId: number): void {
    const shapeData = this.enemyShapes.get(entityId);
    if (!shapeData) return;

    graphics.clear();

    const shape = this.useShapeMatchedOverlays ? shapeData.shape : 'circle';
    const size = shapeData.size;

    // Draw white shape (alpha will be set during update)
    graphics.fillStyle(0xffffff, 1);

    switch (shape) {
      case 'circle':
        graphics.fillCircle(0, 0, size * 1.1); // Slightly larger than enemy
        break;
      case 'square':
        const s = size * 1.1;
        graphics.fillRect(-s, -s, s * 2, s * 2);
        break;
      case 'triangle':
        this.drawTriangle(graphics, size * 1.1);
        break;
      case 'diamond':
        this.drawDiamond(graphics, size * 1.1);
        break;
      case 'hexagon':
        this.drawHexagon(graphics, size * 1.1);
        break;
    }
  }

  private drawTriangle(graphics: Phaser.GameObjects.Graphics, size: number): void {
    const h = size * 1.5;
    graphics.beginPath();
    graphics.moveTo(0, -h * 0.5);
    graphics.lineTo(size, h * 0.5);
    graphics.lineTo(-size, h * 0.5);
    graphics.closePath();
    graphics.fillPath();
  }

  private drawDiamond(graphics: Phaser.GameObjects.Graphics, size: number): void {
    graphics.beginPath();
    graphics.moveTo(0, -size);
    graphics.lineTo(size, 0);
    graphics.lineTo(0, size);
    graphics.lineTo(-size, 0);
    graphics.closePath();
    graphics.fillPath();
  }

  private drawHexagon(graphics: Phaser.GameObjects.Graphics, size: number): void {
    graphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const px = HEX_POINTS[i].cos * size;
      const py = HEX_POINTS[i].sin * size;
      if (i === 0) {
        graphics.moveTo(px, py);
      } else {
        graphics.lineTo(px, py);
      }
    }
    graphics.closePath();
    graphics.fillPath();
  }

  /**
   * Update overlay positions and alpha for all pulsing enemies.
   */
  private updateEnemyOverlays(_deltaSeconds: number): void {
    const currentTime = this.pulseTime;
    const toRemove: number[] = [];

    for (const [entityId, state] of this.enemyPulseStates) {
      const elapsed = currentTime - state.startTime;

      // Check if pulse is complete
      if (elapsed >= this.PULSE_DURATION) {
        toRemove.push(entityId);
        continue;
      }

      // Get enemy position
      const enemyX = Transform.x[entityId];
      const enemyY = Transform.y[entityId];

      // Position overlay at enemy location
      if (state.overlay) {
        state.overlay.setPosition(enemyX, enemyY);
        state.overlay.setVisible(true);

        // Calculate alpha using sine wave for smooth red->white->red
        // Progress 0->0.5: ramp up to white
        // Progress 0.5->1: ramp down to red
        const progress = elapsed / this.PULSE_DURATION;
        const sineValue = Math.sin(progress * Math.PI); // 0->1->0 over the duration
        const alpha = sineValue * 0.8; // Peak at 80% alpha

        state.overlay.setAlpha(alpha);
      }

      // Also scale up the enemy container slightly during ripple
      const container = spriteRegistry.get(entityId) as Phaser.GameObjects.Container;
      if (container) {
        const progress = elapsed / this.PULSE_DURATION;
        const scaleBoost = Math.sin(progress * Math.PI) * 0.08; // 8% scale boost at peak
        container.setScale(1 + scaleBoost);
      }
    }

    // Clean up completed pulses
    for (const entityId of toRemove) {
      this.returnOverlay(entityId);
      this.enemyPulseStates.delete(entityId);

      // Reset enemy scale
      const container = spriteRegistry.get(entityId) as Phaser.GameObjects.Container;
      if (container) {
        container.setScale(1);
      }
    }
  }

  /**
   * Remove ripples that have fully expanded past screen bounds.
   */
  private cleanupRipples(): void {
    this.activeRipples = this.activeRipples.filter(ripple => {
      const innerEdge = ripple.currentRadius - ripple.bandWidth;
      return innerEdge < ripple.maxRadius;
    });
  }

  /**
   * Get an overlay from the pool.
   */
  private getOverlayFromPool(): Phaser.GameObjects.Graphics | undefined {
    for (const overlay of this.overlayPool) {
      if (!overlay.visible) {
        return overlay;
      }
    }
    return undefined; // Pool exhausted
  }

  /**
   * Return an overlay to the pool.
   */
  private returnOverlay(entityId: number): void {
    const overlay = this.activeOverlays.get(entityId);
    if (overlay) {
      overlay.setVisible(false);
      overlay.clear();
      this.activeOverlays.delete(entityId);
    }
  }

  /**
   * Clear all active effects (e.g., when restarting game).
   */
  clear(): void {
    this.activeRipples = [];

    // Return all overlays to pool
    for (const [entityId] of this.activeOverlays) {
      this.returnOverlay(entityId);
    }
    this.activeOverlays.clear();
    this.enemyPulseStates.clear();
    this.enemyShapes.clear();
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.clear();

    for (const overlay of this.overlayPool) {
      overlay.destroy();
    }
    this.overlayPool = [];
  }
}
