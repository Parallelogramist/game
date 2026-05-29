import Phaser from 'phaser';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

/**
 * Attack telegraphs — transient windup indicators drawn before a dangerous
 * enemy attack (dash, AOE slam) so the player can read and dodge it. Pure
 * readability: telegraphs deal no damage and never change attack timing.
 *
 * Pooled Graphics objects, updated once per frame. Quality-aware (skips when
 * the budget is low). Mirrors the lightweight pooling used elsewhere
 * (DeathRippleManager / StatusEffectVisualManager).
 */
type TelegraphShape = 'ring' | 'line';

interface Telegraph {
  graphics: Phaser.GameObjects.Graphics;
  shape: TelegraphShape;
  x: number;
  y: number;
  angle: number;       // line direction (radians)
  length: number;      // line length / max ring radius
  thickness: number;   // line width
  color: number;
  duration: number;    // seconds
  elapsed: number;
  inUse: boolean;
}

export class TelegraphManager {
  private pool: Telegraph[] = [];
  private quality: VisualQuality = 'high';

  private static readonly POOL_SIZE = 32;

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < TelegraphManager.POOL_SIZE; i++) {
      const graphics = scene.add.graphics();
      graphics.setDepth(DepthLayers.ATTACK_TELEGRAPH);
      graphics.setVisible(false);
      this.pool.push({
        graphics, shape: 'ring', x: 0, y: 0, angle: 0, length: 0,
        thickness: 0, color: 0xffffff, duration: 0, elapsed: 0, inUse: false,
      });
    }
  }

  setQuality(quality: VisualQuality): void {
    this.quality = quality;
  }

  private acquire(): Telegraph | null {
    for (const telegraph of this.pool) {
      if (!telegraph.inUse) return telegraph;
    }
    return null;
  }

  /** Expanding ground ring — used for AOE slams/stomps. */
  spawnRing(x: number, y: number, maxRadius: number, duration: number, color: number = 0xff5555): void {
    if (this.quality === 'low') return;
    const telegraph = this.acquire();
    if (!telegraph) return;
    telegraph.inUse = true;
    telegraph.shape = 'ring';
    telegraph.x = x;
    telegraph.y = y;
    telegraph.length = maxRadius;
    telegraph.color = color;
    telegraph.duration = duration;
    telegraph.elapsed = 0;
    telegraph.graphics.setVisible(true);
  }

  /** Swept line — used to show a dash/charge path. */
  spawnLine(x: number, y: number, angle: number, length: number, duration: number, color: number = 0xff9933, thickness: number = 14): void {
    if (this.quality === 'low') return;
    const telegraph = this.acquire();
    if (!telegraph) return;
    telegraph.inUse = true;
    telegraph.shape = 'line';
    telegraph.x = x;
    telegraph.y = y;
    telegraph.angle = angle;
    telegraph.length = length;
    telegraph.thickness = thickness;
    telegraph.color = color;
    telegraph.duration = duration;
    telegraph.elapsed = 0;
    telegraph.graphics.setVisible(true);
  }

  update(deltaSeconds: number): void {
    for (const telegraph of this.pool) {
      if (!telegraph.inUse) continue;
      telegraph.elapsed += deltaSeconds;
      const progress = telegraph.elapsed / telegraph.duration;
      if (progress >= 1) {
        telegraph.inUse = false;
        telegraph.graphics.clear();
        telegraph.graphics.setVisible(false);
        continue;
      }

      const graphics = telegraph.graphics;
      graphics.clear();
      // Ramp alpha up as the attack approaches so the warning intensifies.
      const alpha = 0.25 + progress * 0.5;

      if (telegraph.shape === 'ring') {
        graphics.setPosition(telegraph.x, telegraph.y);
        const radius = telegraph.length * progress;
        graphics.lineStyle(3, telegraph.color, alpha);
        graphics.strokeCircle(0, 0, radius);
        // Filled danger zone footprint at the final radius (faint).
        graphics.fillStyle(telegraph.color, 0.08);
        graphics.fillCircle(0, 0, telegraph.length);
      } else {
        graphics.setPosition(telegraph.x, telegraph.y);
        const dirX = Math.cos(telegraph.angle);
        const dirY = Math.sin(telegraph.angle);
        const halfW = telegraph.thickness / 2;
        const perpX = -dirY * halfW;
        const perpY = dirX * halfW;
        const endX = dirX * telegraph.length;
        const endY = dirY * telegraph.length;
        graphics.fillStyle(telegraph.color, alpha * 0.5);
        graphics.beginPath();
        graphics.moveTo(perpX, perpY);
        graphics.lineTo(endX + perpX, endY + perpY);
        graphics.lineTo(endX - perpX, endY - perpY);
        graphics.lineTo(-perpX, -perpY);
        graphics.closePath();
        graphics.fillPath();
        graphics.lineStyle(2, telegraph.color, alpha);
        graphics.strokePath();
      }
    }
  }

  /** Clears all active telegraphs (run reset). */
  reset(): void {
    for (const telegraph of this.pool) {
      telegraph.inUse = false;
      telegraph.graphics.clear();
      telegraph.graphics.setVisible(false);
    }
  }

  destroy(): void {
    for (const telegraph of this.pool) {
      telegraph.graphics.destroy();
    }
    this.pool = [];
  }
}
