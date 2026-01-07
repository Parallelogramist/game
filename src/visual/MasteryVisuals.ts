import Phaser from 'phaser';
import { NeonColorPair } from './NeonColors';

/**
 * Colors for each mastery visual - thematic to the stat they represent.
 */
export const MASTERY_COLORS: Record<string, NeonColorPair> = {
  might: { core: 0xff4444, glow: 0xff8888 },      // Red - power/damage
  haste: { core: 0xffff44, glow: 0xffffaa },      // Yellow - speed/lightning
  swiftness: { core: 0x44ffff, glow: 0xaaffff },  // Cyan - wind/movement
  vitality: { core: 0x44ff44, glow: 0xaaffaa },   // Green - life/health
  multishot: { core: 0xff8844, glow: 0xffbb88 },  // Orange - multiple projectiles
  piercing: { core: 0xaa44ff, glow: 0xcc88ff },   // Purple - penetration
  reach: { core: 0x4488ff, glow: 0x88bbff },      // Blue - range/extension
  magnetism: { core: 0xff44ff, glow: 0xffaaff },  // Magenta - attraction
  velocity: { core: 0xffffff, glow: 0xffffff },   // White - speed/light
};

/**
 * Interface for a mastery visual attached to the player.
 */
export interface MasteryVisual {
  id: string;
  container: Phaser.GameObjects.Container;
  update: (playerX: number, playerY: number, deltaTime: number) => void;
}

/**
 * Manages all level 10 mastery visual indicators attached to the player.
 * Each maxed stat skill displays a unique visual effect orbiting the player.
 */
export class MasteryVisualsManager {
  private scene: Phaser.Scene;
  private activeVisuals: Map<string, MasteryVisual> = new Map();
  private baseOrbitRadius: number = 35;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Add a mastery visual for a maxed stat.
   */
  public addMasteryVisual(statId: string): void {
    if (this.activeVisuals.has(statId)) return;

    const visual = this.createMasteryVisual(statId);
    if (visual) {
      this.activeVisuals.set(statId, visual);
      this.redistributeVisuals();
    }
  }

  /**
   * Check if a mastery visual exists for a stat.
   */
  public hasMasteryVisual(statId: string): boolean {
    return this.activeVisuals.has(statId);
  }

  /**
   * Update all mastery visuals - called each frame.
   */
  public update(playerX: number, playerY: number, deltaTime: number): void {
    for (const visual of this.activeVisuals.values()) {
      visual.update(playerX, playerY, deltaTime);
    }
  }

  /**
   * Redistribute visual orbit phases when new ones are added.
   */
  private redistributeVisuals(): void {
    const count = this.activeVisuals.size;
    let index = 0;
    for (const visual of this.activeVisuals.values()) {
      (visual as any).baseOrbitPhase = (index / count) * Math.PI * 2;
      index++;
    }
  }

  /**
   * Create the appropriate visual for a stat ID.
   */
  private createMasteryVisual(statId: string): MasteryVisual | null {
    switch (statId) {
      case 'might':
        return this.createMightVisual();
      case 'haste':
        return this.createHasteVisual();
      case 'swiftness':
        return this.createSwiftnessVisual();
      case 'vitality':
        return this.createVitalityVisual();
      case 'multishot':
        return this.createMultishotVisual();
      case 'piercing':
        return this.createPiercingVisual();
      case 'reach':
        return this.createReachVisual();
      case 'magnetism':
        return this.createMagnetismVisual();
      case 'velocity':
        return this.createVelocityVisual();
      default:
        return null;
    }
  }

  /**
   * Might (Damage) - Orbiting Sword
   * A small glowing red sword that orbits the player menacingly.
   */
  private createMightVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(9);

    const color = MASTERY_COLORS.might;

    // Glow effect behind sword
    const glow = this.scene.add.graphics();
    glow.fillStyle(color.glow, 0.3);
    glow.fillCircle(0, 0, 12);
    container.add(glow);

    // Sword shape
    const sword = this.scene.add.graphics();
    sword.fillStyle(color.core, 1);
    sword.beginPath();
    sword.moveTo(0, -12);  // Tip
    sword.lineTo(3, -2);   // Right guard
    sword.lineTo(2, 8);    // Right blade
    sword.lineTo(0, 10);   // Pommel
    sword.lineTo(-2, 8);   // Left blade
    sword.lineTo(-3, -2);  // Left guard
    sword.closePath();
    sword.fillPath();
    sword.lineStyle(1, 0xffffff, 0.8);
    sword.strokePath();
    container.add(sword);

    let orbitPhase = 0;
    const orbitSpeed = 1.5;

    return {
      id: 'might',
      container,
      update: (playerX, playerY, deltaTime) => {
        orbitPhase += orbitSpeed * deltaTime;
        const radius = this.baseOrbitRadius;
        container.setPosition(
          playerX + Math.cos(orbitPhase) * radius,
          playerY + Math.sin(orbitPhase) * radius
        );
        container.setRotation(orbitPhase + Math.PI / 2);
      },
    };
  }

  /**
   * Haste (Attack Speed) - Lightning Sparks
   * Crackling lightning bolts that flicker around the player.
   */
  private createHasteVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(9);

    const color = MASTERY_COLORS.haste;
    const sparks: Phaser.GameObjects.Graphics[] = [];
    const sparkCount = 3;

    for (let i = 0; i < sparkCount; i++) {
      const spark = this.scene.add.graphics();
      sparks.push(spark);
      container.add(spark);
    }

    let time = 0;
    const flickerSpeed = 8;

    const drawLightningBolt = (g: Phaser.GameObjects.Graphics, seed: number) => {
      g.clear();
      // Glow layer
      g.lineStyle(4, color.glow, 0.3);
      g.beginPath();
      const segments = 3;
      let x = 0, y = -6;
      g.moveTo(x, y);
      for (let i = 0; i < segments; i++) {
        x += Math.sin(seed * 10 + i) * 4;
        y += 4;
        g.lineTo(x, y);
      }
      g.strokePath();

      // Core line
      g.lineStyle(2, color.core, 0.9);
      x = 0; y = -6;
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < segments; i++) {
        x += Math.sin(seed * 10 + i) * 4;
        y += 4;
        g.lineTo(x, y);
      }
      g.strokePath();
    };

    return {
      id: 'haste',
      container,
      update: (playerX, playerY, deltaTime) => {
        time += deltaTime * flickerSpeed;
        container.setPosition(playerX, playerY);

        sparks.forEach((spark, i) => {
          const angle = (i / sparkCount) * Math.PI * 2 + time * 0.3;
          const radius = this.baseOrbitRadius * 0.8;
          spark.setPosition(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
          );
          // Flicker by redrawing occasionally
          if (Math.random() < 0.3) {
            drawLightningBolt(spark, time + i);
          }
        });
      },
    };
  }

  /**
   * Swiftness (Movement Speed) - Wind Trails
   * Flowing wind streams that trail around the player.
   */
  private createSwiftnessVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(8);

    const color = MASTERY_COLORS.swiftness;
    const streamGraphics = this.scene.add.graphics();
    container.add(streamGraphics);

    let phase = 0;

    return {
      id: 'swiftness',
      container,
      update: (playerX, playerY, deltaTime) => {
        phase += deltaTime * 4;
        container.setPosition(playerX, playerY);

        streamGraphics.clear();

        // Draw 3 wind streams
        for (let stream = 0; stream < 3; stream++) {
          const baseAngle = (stream / 3) * Math.PI * 2 + phase * 0.5;
          const alpha = 0.3 + Math.sin(phase + stream) * 0.15;

          streamGraphics.lineStyle(2 + stream * 0.5, color.core, alpha);
          streamGraphics.beginPath();

          for (let i = 0; i < 8; i++) {
            const t = i / 7;
            const angle = baseAngle + Math.sin(phase + t * 3) * 0.3;
            const radius = this.baseOrbitRadius * (0.7 + t * 0.6);
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            if (i === 0) streamGraphics.moveTo(x, y);
            else streamGraphics.lineTo(x, y);
          }
          streamGraphics.strokePath();
        }
      },
    };
  }

  /**
   * Vitality (HP) - Pulsing Heart
   * A green heart that pulses with life energy.
   */
  private createVitalityVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(9);

    const color = MASTERY_COLORS.vitality;
    const heartGraphics = this.scene.add.graphics();
    container.add(heartGraphics);

    let pulsePhase = 0;
    let orbitPhase = 0;

    const drawHeart = (scale: number) => {
      heartGraphics.clear();
      const s = 6 * scale;

      // Glow layer
      heartGraphics.fillStyle(color.glow, 0.3);
      heartGraphics.beginPath();
      heartGraphics.moveTo(0, s * 0.5);
      heartGraphics.lineTo(-s, -s * 0.2);
      heartGraphics.arc(-s * 0.5, -s * 0.5, s * 0.5, Math.PI, 0, false);
      heartGraphics.arc(s * 0.5, -s * 0.5, s * 0.5, Math.PI, 0, false);
      heartGraphics.lineTo(0, s * 0.5);
      heartGraphics.fillPath();

      // Core heart
      heartGraphics.fillStyle(color.core, 1);
      const cs = s * 0.7;
      heartGraphics.beginPath();
      heartGraphics.moveTo(0, cs * 0.5);
      heartGraphics.lineTo(-cs, -cs * 0.2);
      heartGraphics.arc(-cs * 0.5, -cs * 0.5, cs * 0.5, Math.PI, 0, false);
      heartGraphics.arc(cs * 0.5, -cs * 0.5, cs * 0.5, Math.PI, 0, false);
      heartGraphics.lineTo(0, cs * 0.5);
      heartGraphics.fillPath();

      // White highlight
      heartGraphics.fillStyle(0xffffff, 0.4);
      heartGraphics.fillCircle(-s * 0.3, -s * 0.4, s * 0.2);
    };

    return {
      id: 'vitality',
      container,
      update: (playerX, playerY, deltaTime) => {
        pulsePhase += deltaTime * 3;
        orbitPhase += deltaTime * 0.8;

        const pulseScale = 1 + Math.sin(pulsePhase) * 0.15;
        drawHeart(pulseScale);

        const radius = this.baseOrbitRadius;
        container.setPosition(
          playerX + Math.cos(orbitPhase) * radius,
          playerY + Math.sin(orbitPhase) * radius
        );
      },
    };
  }

  /**
   * Multishot (Projectiles) - Triple Arrow Fan
   * Three arrows in a fan formation orbiting the player.
   */
  private createMultishotVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(9);

    const color = MASTERY_COLORS.multishot;

    // Add glow behind
    const glow = this.scene.add.graphics();
    glow.fillStyle(color.glow, 0.25);
    glow.fillCircle(0, 0, 14);
    container.add(glow);

    // Create 3 arrows in a fan
    for (let i = -1; i <= 1; i++) {
      const arrow = this.scene.add.graphics();
      const spreadAngle = i * 0.3;

      arrow.fillStyle(color.core, 1);
      arrow.beginPath();
      arrow.moveTo(0, -8);   // Tip
      arrow.lineTo(3, 2);    // Right
      arrow.lineTo(1, 0);    // Right notch
      arrow.lineTo(1, 6);    // Right tail
      arrow.lineTo(-1, 6);   // Left tail
      arrow.lineTo(-1, 0);   // Left notch
      arrow.lineTo(-3, 2);   // Left
      arrow.closePath();
      arrow.fillPath();
      arrow.lineStyle(1, 0xffffff, 0.7);
      arrow.strokePath();

      arrow.setRotation(spreadAngle);
      arrow.setPosition(Math.sin(spreadAngle) * 8, 0);
      container.add(arrow);
    }

    let orbitPhase = 0;

    return {
      id: 'multishot',
      container,
      update: (playerX, playerY, deltaTime) => {
        orbitPhase += deltaTime * 1.2;
        const radius = this.baseOrbitRadius;
        container.setPosition(
          playerX + Math.cos(orbitPhase) * radius,
          playerY + Math.sin(orbitPhase) * radius
        );
        container.setRotation(orbitPhase + Math.PI / 2);
      },
    };
  }

  /**
   * Piercing (Pierce Enemies) - Spinning Drill
   * A sharp spiral drill point that rotates rapidly.
   */
  private createPiercingVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(9);

    const color = MASTERY_COLORS.piercing;
    const drill = this.scene.add.graphics();
    container.add(drill);

    let spinPhase = 0;
    let orbitPhase = 0;

    const drawDrill = (spin: number) => {
      drill.clear();

      // Glow
      drill.fillStyle(color.glow, 0.2);
      drill.fillCircle(0, 0, 10);

      // Spiral lines on the drill
      for (let i = 0; i < 3; i++) {
        const spiralOffset = (i / 3) * Math.PI * 2 + spin * 3;
        drill.lineStyle(2, color.core, 0.8);
        drill.beginPath();
        for (let t = 0; t < 10; t++) {
          const y = -10 + t * 2;
          const radius = Math.max(0, (10 - t) * 0.4);
          const x = Math.sin(spiralOffset + t * 0.5) * radius;
          if (t === 0) drill.moveTo(x, y);
          else drill.lineTo(x, y);
        }
        drill.strokePath();
      }

      // Core point
      drill.fillStyle(color.core, 1);
      drill.fillTriangle(0, -12, 4, 6, -4, 6);
      drill.lineStyle(1, 0xffffff, 0.8);
      drill.strokeTriangle(0, -12, 4, 6, -4, 6);
    };

    return {
      id: 'piercing',
      container,
      update: (playerX, playerY, deltaTime) => {
        spinPhase += deltaTime * 8;
        orbitPhase += deltaTime * 1.0;

        drawDrill(spinPhase);

        const radius = this.baseOrbitRadius;
        container.setPosition(
          playerX + Math.cos(orbitPhase) * radius,
          playerY + Math.sin(orbitPhase) * radius
        );
        container.setRotation(orbitPhase + Math.PI / 2);
      },
    };
  }

  /**
   * Reach (Range) - Expanding Rings
   * Concentric rings that pulse outward from the player.
   */
  private createReachVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(7);

    const color = MASTERY_COLORS.reach;
    const ringsGraphics = this.scene.add.graphics();
    container.add(ringsGraphics);

    let phase = 0;

    return {
      id: 'reach',
      container,
      update: (playerX, playerY, deltaTime) => {
        phase += deltaTime * 2;
        container.setPosition(playerX, playerY);

        ringsGraphics.clear();

        // Draw 3 expanding rings at different phases
        for (let ring = 0; ring < 3; ring++) {
          const ringPhase = (phase + ring * 1.0) % 3;
          const radius = this.baseOrbitRadius * (0.5 + ringPhase * 0.5);
          const alpha = Math.max(0, 0.4 - ringPhase * 0.13);

          // Glow ring
          ringsGraphics.lineStyle(4, color.glow, alpha * 0.3);
          ringsGraphics.strokeCircle(0, 0, radius);

          // Core ring
          ringsGraphics.lineStyle(2, color.core, alpha);
          ringsGraphics.strokeCircle(0, 0, radius);
        }
      },
    };
  }

  /**
   * Magnetism (Pickup Range) - Magnetic Field Lines
   * Curved field lines arcing toward the player center.
   */
  private createMagnetismVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(7);

    const color = MASTERY_COLORS.magnetism;
    const fieldGraphics = this.scene.add.graphics();
    container.add(fieldGraphics);

    let phase = 0;

    return {
      id: 'magnetism',
      container,
      update: (playerX, playerY, deltaTime) => {
        phase += deltaTime * 2;
        container.setPosition(playerX, playerY);

        fieldGraphics.clear();

        // Draw 4 magnetic field arc lines
        for (let line = 0; line < 4; line++) {
          const baseAngle = (line / 4) * Math.PI * 2 + phase * 0.3;
          const pulseOffset = Math.sin(phase * 2 + line) * 5;

          fieldGraphics.lineStyle(2, color.core, 0.6);
          fieldGraphics.beginPath();

          // Arc from outside toward center
          for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            const radius = (this.baseOrbitRadius + pulseOffset) * (1 - t * 0.5);
            const angle = baseAngle + t * 0.4;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            if (i === 0) fieldGraphics.moveTo(x, y);
            else fieldGraphics.lineTo(x, y);
          }
          fieldGraphics.strokePath();

          // Small attracting particles at the ends
          const particleRadius = this.baseOrbitRadius + pulseOffset;
          const particleX = Math.cos(baseAngle) * particleRadius;
          const particleY = Math.sin(baseAngle) * particleRadius;
          fieldGraphics.fillStyle(color.glow, 0.5);
          fieldGraphics.fillCircle(particleX, particleY, 3);
        }
      },
    };
  }

  /**
   * Velocity (Projectile Speed) - Speed Streaks
   * Fast-moving white streaks zooming outward from the player.
   */
  private createVelocityVisual(): MasteryVisual {
    const container = this.scene.add.container(0, 0);
    container.setDepth(8);

    const color = MASTERY_COLORS.velocity;
    const streakGraphics = this.scene.add.graphics();
    container.add(streakGraphics);

    // Store streak data
    const streaks: { angle: number; phase: number; length: number }[] = [];
    for (let i = 0; i < 6; i++) {
      streaks.push({
        angle: (i / 6) * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        length: 8 + Math.random() * 8,
      });
    }

    let time = 0;

    return {
      id: 'velocity',
      container,
      update: (playerX, playerY, deltaTime) => {
        time += deltaTime * 6;
        container.setPosition(playerX, playerY);

        streakGraphics.clear();

        for (const streak of streaks) {
          // Each streak moves outward rapidly then resets
          const cyclePhase = (time + streak.phase) % 2;
          const radius = this.baseOrbitRadius * (0.3 + cyclePhase * 0.8);
          const alpha = Math.max(0, 1 - cyclePhase * 0.6);

          const x = Math.cos(streak.angle) * radius;
          const y = Math.sin(streak.angle) * radius;

          // Draw streak line
          const tailX = Math.cos(streak.angle) * (radius - streak.length);
          const tailY = Math.sin(streak.angle) * (radius - streak.length);

          streakGraphics.lineStyle(2, color.core, alpha * 0.8);
          streakGraphics.beginPath();
          streakGraphics.moveTo(tailX, tailY);
          streakGraphics.lineTo(x, y);
          streakGraphics.strokePath();

          // Bright head
          streakGraphics.fillStyle(0xffffff, alpha);
          streakGraphics.fillCircle(x, y, 2);
        }
      },
    };
  }

  /**
   * Clean up all visuals.
   */
  public destroy(): void {
    for (const visual of this.activeVisuals.values()) {
      visual.container.destroy();
    }
    this.activeVisuals.clear();
  }
}
