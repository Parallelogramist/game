import Phaser from 'phaser';
import { VisualQuality } from './GlowGraphics';
import { getSettingsManager } from '../settings';

interface ParallaxLayer {
  graphics: Phaser.GameObjects.Graphics;
  factor: number;       // how strongly this layer reacts to player offset (far=small)
  driftX: number;       // ambient drift velocity px/s
  driftY: number;
  color: number;
  size: number;
  pointsX: Float32Array; // rest positions (screen space, pre-wrap)
  pointsY: Float32Array;
  count: number;
}

/**
 * Parallax depth layers rendered BEHIND the warp grid (negative depth). The camera is
 * fixed, so the parallax offset is driven by the player's distance from screen centre,
 * scaled per layer, plus a slow ambient drift so the field feels alive when idle.
 * Quality-aware and reduced-motion-aware. Mirrors TrailManager's lifecycle: constructed
 * per scene, updated each frame, destroyed on shutdown — no module-level state.
 */
export class ParallaxBackground {
  private layers: ParallaxLayer[] = [];
  private readonly width: number;
  private readonly height: number;
  private elapsed: number = 0;
  private enabled: boolean = true;

  // Per-layer config: factor (parallax strength), point count at high quality, color, size.
  private static readonly LAYER_DEFS = [
    { factor: 0.02, count: 60, color: 0x113355, size: 1.5, driftX: 4, driftY: 2 },
    { factor: 0.05, count: 40, color: 0x1f5577, size: 2.0, driftX: 8, driftY: -3 },
    { factor: 0.10, count: 28, color: 0x2a88aa, size: 2.8, driftX: 14, driftY: 5 },
  ];

  constructor(scene: Phaser.Scene) {
    this.width = scene.scale.width;
    this.height = scene.scale.height;

    // Deterministic point scatter (no Math.random reliance for repeatability across resets).
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < ParallaxBackground.LAYER_DEFS.length; i++) {
      const def = ParallaxBackground.LAYER_DEFS[i];
      const graphics = scene.add.graphics();
      graphics.setDepth(-3 + i); // -3, -2, -1 → all behind GRID_BACKGROUND (0)
      graphics.setScrollFactor(0);
      const pointsX = new Float32Array(def.count);
      const pointsY = new Float32Array(def.count);
      for (let p = 0; p < def.count; p++) {
        pointsX[p] = rand() * this.width;
        pointsY[p] = rand() * this.height;
      }
      this.layers.push({
        graphics, factor: def.factor, driftX: def.driftX, driftY: def.driftY,
        color: def.color, size: def.size, pointsX, pointsY, count: def.count,
      });
    }
  }

  setQuality(quality: VisualQuality): void {
    // high: all 3 layers; medium: nearest 2; low: disabled.
    const activeLayers = quality === 'high' ? 3 : quality === 'medium' ? 2 : 0;
    for (let i = 0; i < this.layers.length; i++) {
      const visible = i >= this.layers.length - activeLayers; // keep nearest layers
      this.layers[i].graphics.setVisible(visible && this.enabled);
    }
  }

  update(deltaSeconds: number, playerX: number, playerY: number): void {
    if (!this.enabled || getSettingsManager().isReducedMotionEnabled()) {
      for (const layer of this.layers) layer.graphics.setVisible(false);
      return;
    }
    this.elapsed += deltaSeconds;

    const offsetCx = playerX - this.width / 2;
    const offsetCy = playerY - this.height / 2;

    for (const layer of this.layers) {
      const g = layer.graphics;
      if (!g.visible) continue;
      g.clear();
      g.fillStyle(layer.color, 0.55);

      // Parallax offset (opposite player motion) + slow ambient drift, wrapped to screen.
      const px = -offsetCx * layer.factor + layer.driftX * this.elapsed;
      const py = -offsetCy * layer.factor + layer.driftY * this.elapsed;
      for (let p = 0; p < layer.count; p++) {
        const x = mod(layer.pointsX[p] + px, this.width);
        const y = mod(layer.pointsY[p] + py, this.height);
        g.fillCircle(x, y, layer.size);
      }
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) for (const layer of this.layers) layer.graphics.setVisible(false);
  }

  reset(): void {
    this.elapsed = 0;
  }

  destroy(): void {
    for (const layer of this.layers) layer.graphics.destroy();
    this.layers = [];
  }
}

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}
