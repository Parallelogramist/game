import Phaser from 'phaser';

/**
 * Configuration for weapon wind-up anticipation effects.
 */
export interface WindUpConfig {
  weaponId: string;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  duration: number;
  intensity?: number;
  onComplete?: () => void;
}

/**
 * Active wind-up effect tracking.
 */
interface ActiveWindUp {
  weaponId: string;
  graphics: Phaser.GameObjects.GameObject[];
  tweens: Phaser.Tweens.Tween[];
  onComplete?: () => void;
  cancelled: boolean;
}

/**
 * JuiceManager - Centralized system for game feel effects.
 * Provides anticipation/wind-up, hit stop, screen shake, and other juice effects.
 */
export class JuiceManager {
  private scene: Phaser.Scene | null = null;
  private activeWindUps: Map<string, ActiveWindUp> = new Map();
  private hitStopActive: boolean = false;
  private originalTimeScale: number = 1;

  public setScene(scene: Phaser.Scene): void {
    this.scene = scene;
  }

  public update(_deltaMs: number): void {
    // Reserved for continuous effects
  }

  public destroy(): void {
    for (const [weaponId] of this.activeWindUps) {
      this.cancelWindUp(weaponId);
    }
    this.activeWindUps.clear();
    if (this.hitStopActive && this.scene) {
      this.scene.tweens.timeScale = this.originalTimeScale;
      this.hitStopActive = false;
    }
    this.scene = null;
  }

  // ============================================================
  // WIND-UP / ANTICIPATION EFFECTS
  // ============================================================

  public windUp(config: WindUpConfig): Promise<void> {
    if (!this.scene) {
      config.onComplete?.();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (this.activeWindUps.has(config.weaponId)) {
        this.cancelWindUp(config.weaponId);
      }

      const windUp: ActiveWindUp = {
        weaponId: config.weaponId,
        graphics: [],
        tweens: [],
        onComplete: () => {
          config.onComplete?.();
          resolve();
        },
        cancelled: false,
      };

      this.activeWindUps.set(config.weaponId, windUp);
      this.createWeaponWindUp(config, windUp);
    });
  }

  public cancelWindUp(weaponId: string): void {
    const windUp = this.activeWindUps.get(weaponId);
    if (!windUp) return;

    windUp.cancelled = true;
    windUp.tweens.forEach(tween => tween.isPlaying() && tween.stop());
    windUp.graphics.forEach(obj => obj.scene && obj.destroy());
    this.activeWindUps.delete(weaponId);
  }

  private createWeaponWindUp(config: WindUpConfig, windUp: ActiveWindUp): void {
    const { weaponId, x, y, duration, targetX, targetY, intensity = 1 } = config;

    switch (weaponId) {
      case 'frost_nova':
        this.createFrostNovaWindUp(x, y, duration, intensity, windUp);
        break;
      case 'meteor':
        this.createMeteorWindUp(targetX ?? x, targetY ?? y, duration, intensity, windUp);
        break;
      case 'laser_beam':
        this.createLaserWindUp(x, y, targetX ?? x + 100, targetY ?? y, duration, intensity, windUp);
        break;
      case 'katana':
        this.createKatanaWindUp(x, y, targetX ?? x + 100, targetY ?? y, duration, intensity, windUp);
        break;
      case 'chain_lightning':
        this.createChainLightningWindUp(x, y, targetX, targetY, duration, intensity, windUp);
        break;
      case 'homing_missile':
        this.createHomingMissileWindUp(x, y, targetX, targetY, duration, intensity, windUp);
        break;
      case 'ground_spike':
        this.createGroundSpikeWindUp(targetX ?? x, targetY ?? y, duration, intensity, windUp);
        break;
      case 'projectile':
        this.createProjectileWindUp(x, y, targetX, targetY, duration, intensity, windUp);
        break;
      case 'shuriken':
        this.createShurikenWindUp(x, y, duration, intensity, windUp);
        break;
      case 'ricochet':
        this.createRicochetWindUp(x, y, duration, intensity, windUp);
        break;
      case 'flamethrower':
        this.createFlamethrowerWindUp(x, y, targetX ?? x + 50, targetY ?? y, duration, intensity, windUp);
        break;
      case 'drone':
        this.createDroneWindUp(x, y, targetX, targetY, duration, intensity, windUp);
        break;
      default:
        this.createGenericWindUp(x, y, duration, intensity, windUp);
    }
  }

  // ============================================================
  // WEAPON-SPECIFIC WIND-UP VISUALS
  // ============================================================

  private createFrostNovaWindUp(x: number, y: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;
    const crystalCount = 8;

    // Ice crystals spiral inward
    for (let i = 0; i < crystalCount; i++) {
      const angle = (i / crystalCount) * Math.PI * 2;
      const startRadius = 60 * intensity;

      const crystal = scene.add.circle(
        x + Math.cos(angle) * startRadius,
        y + Math.sin(angle) * startRadius,
        4 * intensity, 0x88ccff, 0.8
      );
      crystal.setDepth(16);
      windUp.graphics.push(crystal);

      windUp.tweens.push(scene.tweens.add({
        targets: crystal,
        x, y,
        scale: 1.5,
        duration,
        ease: 'Cubic.easeIn',
        onComplete: () => crystal.destroy(),
      }));
    }

    // Frost ground effect
    const frost = scene.add.graphics();
    frost.setDepth(1);
    windUp.graphics.push(frost);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        frost.clear();
        frost.fillStyle(0x88ccff, 0.2 * p * intensity);
        frost.fillCircle(x, y, 30 + p * 70 * intensity);
        frost.lineStyle(2, 0xaaddff, 0.4 * p * intensity);
        frost.strokeCircle(x, y, 30 + p * 70 * intensity);
      },
      onComplete: () => {
        frost.destroy();
        this.finishWindUp(windUp);
      },
    }));

    // Rising cold mist
    for (let i = 0; i < 5; i++) {
      scene.time.delayedCall(i * (duration / 5), () => {
        if (windUp.cancelled) return;
        const mist = scene.add.circle(x + (Math.random() - 0.5) * 40, y, 3, 0xaaddff, 0.5);
        mist.setDepth(15);
        scene.tweens.add({ targets: mist, y: y - 30, alpha: 0, duration: duration * 0.6, onComplete: () => mist.destroy() });
      });
    }
  }

  private createMeteorWindUp(targetX: number, targetY: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    // Pulsing warning circle
    const warning = scene.add.graphics();
    warning.setDepth(5);
    windUp.graphics.push(warning);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 3, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        const pulse = p % 1;
        const radius = 30 + pulse * 20 * intensity;
        const alpha = 0.3 + (1 - pulse) * 0.4;
        warning.clear();
        warning.lineStyle(3, 0xff6600, alpha * intensity);
        warning.strokeCircle(targetX, targetY, radius);
        warning.lineStyle(1, 0xffaa00, alpha * 0.5 * intensity);
        warning.strokeCircle(targetX, targetY, radius * 0.6);
      },
      onComplete: () => warning.destroy(),
    }));

    // Descending streak
    const streak = scene.add.graphics();
    streak.setDepth(50);
    windUp.graphics.push(streak);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      ease: 'Quad.easeIn',
      onUpdate: (t) => {
        const p = t.getValue()!;
        streak.clear();
        const currentY = targetY - 200 + p * 150;
        const trailLen = 60 * intensity * p;

        streak.lineStyle(4, 0xff6600, 0.8 * p);
        streak.beginPath();
        streak.moveTo(targetX, currentY - trailLen);
        streak.lineTo(targetX, currentY);
        streak.strokePath();

        streak.lineStyle(2, 0xffcc00, p);
        streak.beginPath();
        streak.moveTo(targetX, currentY - trailLen * 0.5);
        streak.lineTo(targetX, currentY);
        streak.strokePath();
      },
      onComplete: () => {
        streak.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createLaserWindUp(x: number, y: number, targetX: number, targetY: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const laser = scene.add.graphics();
    laser.setDepth(10);
    windUp.graphics.push(laser);

    const flare = scene.add.graphics();
    flare.setDepth(11);
    windUp.graphics.push(flare);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        const alpha = 0.1 + p * 0.6 * intensity;

        laser.clear();
        laser.lineStyle(6, 0x2266dd, alpha * 0.3);
        laser.lineBetween(x, y, targetX, targetY);
        laser.lineStyle(2, 0x4488ff, alpha);
        laser.lineBetween(x, y, targetX, targetY);

        flare.clear();
        const size = 8 + p * 16 * intensity;
        flare.fillStyle(0x4488ff, 0.2 * p);
        flare.fillCircle(x, y, size * 1.5);
        flare.fillStyle(0xffffff, 0.6 * p);
        flare.fillCircle(x, y, size * 0.4);
        flare.fillStyle(0x88ccff, 0.3 * p);
        flare.fillRect(x - size, y - 1, size * 2, 2);
      },
      onComplete: () => {
        laser.destroy();
        flare.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createKatanaWindUp(x: number, y: number, targetX: number, _targetY: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;
    const direction = targetX >= x ? 1 : -1;

    const preview = scene.add.graphics();
    preview.setDepth(8);
    windUp.graphics.push(preview);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        preview.clear();

        const slashWidth = 100 * intensity;
        [-0.4, 0, 0.4].forEach((offset, i) => {
          const lineP = Math.max(0, (p - i * 0.15) / 0.6);
          if (lineP <= 0) return;

          const len = slashWidth * Math.min(lineP, 1);
          const alpha = 0.2 + lineP * 0.4 * intensity;

          preview.lineStyle(4, 0x4488ff, alpha * 0.4);
          preview.lineBetween(x, y, x + Math.cos(offset) * len * direction, y + Math.sin(offset) * len);
          preview.lineStyle(2, 0x88ccff, alpha);
          preview.lineBetween(x, y, x + Math.cos(offset) * len * direction, y + Math.sin(offset) * len);
        });

        preview.fillStyle(0x4488ff, 0.15 * p);
        preview.fillCircle(x, y, 10 + p * 15 * intensity);
      },
      onComplete: () => {
        preview.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createChainLightningWindUp(x: number, y: number, targetX: number | undefined, targetY: number | undefined, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const sparks = scene.add.graphics();
    sparks.setDepth(12);
    windUp.graphics.push(sparks);

    let phase = 0;
    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        phase += 0.3;
        sparks.clear();

        // Mini arcs around player
        const count = Math.floor(3 + p * 5);
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + phase;
          const inner = 15 * intensity;
          const outer = 25 + p * 20 * intensity;

          const sx = x + Math.cos(angle) * inner;
          const sy = y + Math.sin(angle) * inner;
          const ex = x + Math.cos(angle + (Math.random() - 0.5) * 0.5) * outer;
          const ey = y + Math.sin(angle + (Math.random() - 0.5) * 0.5) * outer;

          sparks.lineStyle(2, 0x88ccff, 0.5 + p * 0.5);
          sparks.beginPath();
          sparks.moveTo(sx, sy);
          sparks.lineTo((sx + ex) / 2 + (Math.random() - 0.5) * 10, (sy + ey) / 2 + (Math.random() - 0.5) * 10);
          sparks.lineTo(ex, ey);
          sparks.strokePath();
        }

        // Preview arc to target
        if (targetX !== undefined && targetY !== undefined && p > 0.3) {
          sparks.lineStyle(2, 0xaaddff, 0.3 * ((p - 0.3) / 0.7) * intensity);
          sparks.beginPath();
          sparks.moveTo(x, y);
          const dx = targetX - x, dy = targetY - y;
          for (let s = 1; s <= 4; s++) {
            const st = s / 4;
            sparks.lineTo(x + dx * st + (Math.random() - 0.5) * 20 * (1 - st), y + dy * st + (Math.random() - 0.5) * 20 * (1 - st));
          }
          sparks.strokePath();
        }

        sparks.fillStyle(0x88ccff, 0.2 * p);
        sparks.fillCircle(x, y, 12 + p * 8);
      },
      onComplete: () => {
        sparks.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createHomingMissileWindUp(x: number, y: number, targetX: number | undefined, targetY: number | undefined, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const reticle = scene.add.graphics();
    reticle.setDepth(15);
    windUp.graphics.push(reticle);

    const glow = scene.add.graphics();
    glow.setDepth(10);
    windUp.graphics.push(glow);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        reticle.clear();
        glow.clear();

        // Launch bay glow
        const glowSize = 10 + p * 20 * intensity;
        glow.fillStyle(0xff4444, 0.2 * p);
        glow.fillCircle(x, y, glowSize);
        glow.lineStyle(2, 0xff6666, 0.4 * p);
        glow.strokeCircle(x, y, glowSize * 0.8);

        if (targetX !== undefined && targetY !== undefined) {
          const size = 30 - p * 12;
          const rot = p * Math.PI * 2;

          reticle.lineStyle(2, 0xff4444, (0.3 + p * 0.7) * intensity);
          for (let i = 0; i < 4; i++) {
            const a = rot + (i * Math.PI / 2);
            const cx = targetX + Math.cos(a) * size;
            const cy = targetY + Math.sin(a) * size;

            reticle.beginPath();
            reticle.moveTo(cx + Math.cos(a + Math.PI / 4) * 8, cy + Math.sin(a + Math.PI / 4) * 8);
            reticle.lineTo(cx, cy);
            reticle.lineTo(cx + Math.cos(a - Math.PI / 4) * 8, cy + Math.sin(a - Math.PI / 4) * 8);
            reticle.strokePath();
          }

          if (p > 0.7) {
            reticle.fillStyle(0xff0000, (p - 0.7) / 0.3);
            reticle.fillCircle(targetX, targetY, 4);
          }

          reticle.lineStyle(1, 0xff6666, 0.2 * p);
          reticle.lineBetween(x, y, targetX, targetY);
        }
      },
      onComplete: () => {
        reticle.destroy();
        glow.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createGroundSpikeWindUp(targetX: number, targetY: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const cracks = scene.add.graphics();
    cracks.setDepth(3);
    windUp.graphics.push(cracks);

    this.screenShake(0.003 * intensity, duration * 0.8);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        cracks.clear();

        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.2;
          const len = 20 + p * 30 * intensity;

          cracks.lineStyle(2, 0x8b4513, 0.4 + p * 0.4);
          cracks.beginPath();
          cracks.moveTo(targetX, targetY);
          for (let s = 1; s <= 3; s++) {
            const st = s / 3;
            cracks.lineTo(
              targetX + Math.cos(angle + (Math.random() - 0.5) * 0.3) * len * st,
              targetY + Math.sin(angle + (Math.random() - 0.5) * 0.3) * len * st
            );
          }
          cracks.strokePath();
        }

        cracks.lineStyle(2, 0x8b4513, 0.3 * p);
        cracks.strokeCircle(targetX, targetY, 25 + p * 15);
      },
      onComplete: () => {
        cracks.destroy();
        this.finishWindUp(windUp);
      },
    }));

    // Rising debris
    for (let i = 0; i < 4; i++) {
      scene.time.delayedCall(i * (duration / 4), () => {
        if (windUp.cancelled) return;
        const debris = scene.add.circle(targetX + (Math.random() - 0.5) * 30, targetY, 2, 0x8b4513, 0.7);
        debris.setDepth(4);
        scene.tweens.add({ targets: debris, y: targetY - 20 - Math.random() * 10, alpha: 0, duration: duration * 0.5, onComplete: () => debris.destroy() });
      });
    }
  }

  private createProjectileWindUp(x: number, y: number, targetX: number | undefined, targetY: number | undefined, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const gfx = scene.add.graphics();
    gfx.setDepth(10);
    windUp.graphics.push(gfx);

    const particles = Array.from({ length: 6 }, (_, i) => ({
      angle: (i / 6) * Math.PI * 2,
      radius: 35 * intensity,
      size: 2 + Math.random() * 2,
    }));

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        gfx.clear();

        particles.forEach(part => {
          part.angle += 0.1;
          const r = part.radius * (1 - p * 0.9);
          gfx.fillStyle(0x66ccff, 0.5 + p * 0.5);
          gfx.fillCircle(x + Math.cos(part.angle) * r, y + Math.sin(part.angle) * r, part.size * (1 + p));
        });

        const core = 4 + p * 10 * intensity;
        gfx.fillStyle(0x88ddff, 0.3 * p);
        gfx.fillCircle(x, y, core);
        gfx.fillStyle(0xffffff, 0.5 * p);
        gfx.fillCircle(x, y, core * 0.4);

        if (targetX !== undefined && targetY !== undefined && p > 0.5) {
          const dx = targetX - x, dy = targetY - y;
          const len = Math.sqrt(dx * dx + dy * dy);
          gfx.lineStyle(2, 0x66ccff, 0.3 * (p - 0.5) * 2);
          gfx.lineBetween(x, y, x + (dx / len) * 30, y + (dy / len) * 30);
        }
      },
      onComplete: () => {
        gfx.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createShurikenWindUp(x: number, y: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const gfx = scene.add.graphics();
    gfx.setDepth(10);
    windUp.graphics.push(gfx);

    let rot = 0;
    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      ease: 'Quad.easeIn',
      onUpdate: (t) => {
        const p = t.getValue()!;
        rot += 0.1 + p * 0.5;
        gfx.clear();

        const size = 12 * intensity;
        gfx.fillStyle(0xcccccc, 0.4 + p * 0.4);

        for (let i = 0; i < 4; i++) {
          const a = rot + (i / 4) * Math.PI * 2;
          gfx.beginPath();
          gfx.moveTo(x, y);
          gfx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
          gfx.lineTo(x + Math.cos(a + 0.3) * size * 0.3, y + Math.sin(a + 0.3) * size * 0.3);
          gfx.closePath();
          gfx.fillPath();
        }

        if (p > 0.7) {
          gfx.fillStyle(0xffffff, 0.5 * ((p - 0.7) / 0.3));
          gfx.fillCircle(x + 3, y - 3, 3 * intensity);
        }
      },
      onComplete: () => {
        gfx.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createRicochetWindUp(x: number, y: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const gfx = scene.add.graphics();
    gfx.setDepth(10);
    windUp.graphics.push(gfx);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        gfx.clear();

        const squashX = 1 + p * 0.3;
        const squashY = 1 - p * 0.3;
        const size = 8 * intensity;

        gfx.fillStyle(0x44ff44, 0.5 + p * 0.3);
        gfx.fillEllipse(x, y, size * squashX, size * squashY);
        gfx.fillStyle(0xaaffaa, 0.2 * p);
        gfx.fillCircle(x, y, size * 1.5);
      },
      onComplete: () => {
        gfx.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createFlamethrowerWindUp(x: number, y: number, targetX: number, targetY: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const gfx = scene.add.graphics();
    gfx.setDepth(10);
    windUp.graphics.push(gfx);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        gfx.clear();

        const dx = targetX - x, dy = targetY - y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len, ny = dy / len;

        const flicker = Math.sin(p * 20) * 2;
        const px = x + nx * 15, py = y + ny * 15 + flicker;

        gfx.fillStyle(0x4488ff, 0.3 * p * intensity);
        gfx.fillCircle(px, py, 8 + p * 4);
        gfx.fillStyle(0xff6600, 0.4 + p * 0.4);
        gfx.fillCircle(px, py, 4 + p * 2);
        gfx.fillStyle(0xffcc00, 0.6 * p);
        gfx.fillCircle(px, py, 2);

        if (p < 0.5) {
          for (let i = 0; i < 3; i++) {
            const sa = Math.random() * Math.PI * 2;
            const sd = 5 + Math.random() * 10;
            gfx.fillStyle(0xffaa00, 0.6 * (1 - p * 2));
            gfx.fillCircle(px + Math.cos(sa) * sd, py + Math.sin(sa) * sd, 1);
          }
        }
      },
      onComplete: () => {
        gfx.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createDroneWindUp(x: number, y: number, targetX: number | undefined, targetY: number | undefined, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const gfx = scene.add.graphics();
    gfx.setDepth(10);
    windUp.graphics.push(gfx);

    const startAngle = Math.random() * Math.PI * 2;
    const targetAngle = targetX !== undefined && targetY !== undefined
      ? Math.atan2(targetY - y, targetX - x)
      : startAngle;

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        gfx.clear();

        const angle = startAngle + (targetAngle - startAngle) * p;
        const len = 12 * intensity;
        const ex = x + Math.cos(angle) * len;
        const ey = y + Math.sin(angle) * len;

        gfx.lineStyle(4, 0x666666, 0.7);
        gfx.lineBetween(x, y, ex, ey);
        gfx.fillStyle(0x66ccff, 0.3 + p * 0.5);
        gfx.fillCircle(ex, ey, 3 + p * 3);

        if (targetX !== undefined && targetY !== undefined && p > 0.4) {
          gfx.lineStyle(1, 0xff4444, 0.3 * ((p - 0.4) / 0.6));
          gfx.lineBetween(ex, ey, targetX, targetY);
        }
      },
      onComplete: () => {
        gfx.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private createGenericWindUp(x: number, y: number, duration: number, intensity: number, windUp: ActiveWindUp): void {
    const scene = this.scene!;

    const gfx = scene.add.graphics();
    gfx.setDepth(10);
    windUp.graphics.push(gfx);

    windUp.tweens.push(scene.tweens.addCounter({
      from: 0, to: 1, duration,
      onUpdate: (t) => {
        const p = t.getValue()!;
        gfx.clear();
        gfx.lineStyle(2, 0xffffff, 0.3 + p * 0.4);
        gfx.strokeCircle(x, y, 10 + p * 20 * intensity);
        gfx.fillStyle(0xffffff, 0.5 * p);
        gfx.fillCircle(x, y, 3);
      },
      onComplete: () => {
        gfx.destroy();
        this.finishWindUp(windUp);
      },
    }));
  }

  private finishWindUp(windUp: ActiveWindUp): void {
    if (windUp.cancelled) return;
    this.activeWindUps.delete(windUp.weaponId);
    windUp.onComplete?.();
  }

  // ============================================================
  // HIT STOP / FREEZE FRAME
  // ============================================================

  public hitStop(duration: number, intensity: number = 1): void {
    if (!this.scene || this.hitStopActive) return;

    this.hitStopActive = true;
    this.originalTimeScale = this.scene.tweens.timeScale;
    this.scene.tweens.timeScale = 0.01 * (1 - intensity * 0.99);

    this.scene.time.delayedCall(duration, () => {
      if (this.scene) this.scene.tweens.timeScale = this.originalTimeScale;
      this.hitStopActive = false;
    });
  }

  public isHitStopActive(): boolean {
    return this.hitStopActive;
  }

  // ============================================================
  // SCREEN SHAKE
  // ============================================================

  public screenShake(intensity: number, duration: number): void {
    if (!this.scene) return;
    this.scene.cameras.main.shake(duration, intensity);
  }

  // ============================================================
  // SQUASH & STRETCH
  // ============================================================

  public squashStretch(target: Phaser.GameObjects.GameObject, squashX: number, squashY: number, duration: number): void {
    if (!this.scene) return;
    this.scene.tweens.add({
      targets: target,
      scaleX: squashX,
      scaleY: squashY,
      duration: duration * 0.3,
      ease: 'Quad.easeOut',
      yoyo: true,
    });
  }

  // ============================================================
  // IMPACT FLASH
  // ============================================================

  public impactFlash(intensity: number = 0.3, duration: number = 80): void {
    if (!this.scene) return;

    const flash = this.scene.add.rectangle(
      this.scene.cameras.main.width / 2,
      this.scene.cameras.main.height / 2,
      this.scene.cameras.main.width,
      this.scene.cameras.main.height,
      0xffffff, 0
    );
    flash.setScrollFactor(0);
    flash.setDepth(2000);

    this.scene.tweens.add({
      targets: flash,
      alpha: intensity,
      duration: duration * 0.3,
      yoyo: true,
      hold: duration * 0.1,
      onComplete: () => flash.destroy(),
    });
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance: JuiceManager | null = null;

export function getJuiceManager(): JuiceManager {
  if (!instance) instance = new JuiceManager();
  return instance;
}

export function resetJuiceManager(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
