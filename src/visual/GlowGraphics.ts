import Phaser from 'phaser';
import { NeonColorPair, getGlowAlphas, getGlowRadiusMultipliers } from './NeonColors';

export type VisualQuality = 'high' | 'medium' | 'low';

// OPTIMIZATION: Pre-compute hexagon unit vectors at module level (constant trig values)
const HEX_POINTS: readonly { cos: number; sin: number }[] = (() => {
  const points: { cos: number; sin: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;  // Start from top
    points.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  return points;
})();

/**
 * Creates a glowing circle using a single Graphics object for all layers.
 * OPTIMIZED: Draws all 15+ glow layers into ONE Graphics object instead of
 * creating 17 separate GameObjects per shape. This reduces object count by 17x.
 */
export function createGlowingCircle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const alphas = getGlowAlphas(quality);
  const radiusMultipliers = getGlowRadiusMultipliers(quality);

  // Single graphics object for ALL layers (massive object count reduction!)
  const graphics = scene.add.graphics();

  // Draw glow layers (outermost first) - all to same graphics object
  for (let i = 0; i < alphas.length; i++) {
    const glowRadius = radius * radiusMultipliers[i];
    graphics.fillStyle(neonColor.glow, alphas[i]);
    graphics.fillCircle(0, 0, glowRadius);
  }

  // Core circle
  graphics.fillStyle(neonColor.core, 1);
  graphics.fillCircle(0, 0, radius);

  // White outline on core
  graphics.lineStyle(2, 0xffffff, 0.85);
  graphics.strokeCircle(0, 0, radius);

  // Bright center highlight
  graphics.fillStyle(0xffffff, 0.6);
  graphics.fillCircle(0, 0, radius * 0.35);

  container.add(graphics);
  return container;
}

/**
 * Creates a glowing triangle using a single Graphics object.
 * OPTIMIZED: All layers drawn to one Graphics object.
 */
export function createGlowingTriangle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const alphas = getGlowAlphas(quality);
  const radiusMultipliers = getGlowRadiusMultipliers(quality);

  // Single graphics object for all layers
  const graphics = scene.add.graphics();
  const baseSize = size;

  // Helper to draw triangle path
  const drawTrianglePath = (triangleSize: number) => {
    const triangleH = triangleSize * 1.5;
    graphics.beginPath();
    graphics.moveTo(0, -triangleH * 0.5);           // Top
    graphics.lineTo(triangleSize, triangleH * 0.5);  // Bottom right
    graphics.lineTo(-triangleSize, triangleH * 0.5); // Bottom left
    graphics.closePath();
  };

  // Draw glow layers using stroked outlines
  for (let i = 0; i < alphas.length; i++) {
    const strokeWidth = (radiusMultipliers[i] - 1) * baseSize * 2;
    graphics.lineStyle(strokeWidth, neonColor.glow, alphas[i]);
    drawTrianglePath(baseSize);
    graphics.strokePath();
  }

  // Core triangle with fill
  graphics.fillStyle(neonColor.core, 1);
  drawTrianglePath(baseSize);
  graphics.fillPath();

  // White outline
  graphics.lineStyle(2, 0xffffff, 0.85);
  drawTrianglePath(baseSize);
  graphics.strokePath();

  container.add(graphics);
  return container;
}

/**
 * Creates a glowing square/rectangle using a single Graphics object.
 * OPTIMIZED: All layers drawn to one Graphics object.
 */
export function createGlowingSquare(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const alphas = getGlowAlphas(quality);
  const radiusMultipliers = getGlowRadiusMultipliers(quality);

  const baseWidth = size * 2;
  const baseHeight = size * 2;

  // Single graphics object for all layers
  const graphics = scene.add.graphics();

  // Draw glow layers
  for (let i = 0; i < alphas.length; i++) {
    const mult = radiusMultipliers[i];
    const w = baseWidth * mult;
    const h = baseHeight * mult;
    graphics.fillStyle(neonColor.glow, alphas[i]);
    graphics.fillRect(-w / 2, -h / 2, w, h);
  }

  // Core rectangle
  graphics.fillStyle(neonColor.core, 1);
  graphics.fillRect(-baseWidth / 2, -baseHeight / 2, baseWidth, baseHeight);

  // White outline
  graphics.lineStyle(2, 0xffffff, 0.85);
  graphics.strokeRect(-baseWidth / 2, -baseHeight / 2, baseWidth, baseHeight);

  container.add(graphics);
  return container;
}

/**
 * Creates a glowing diamond shape using a single Graphics object.
 * OPTIMIZED: All layers drawn to one Graphics object.
 */
export function createGlowingDiamond(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const alphas = getGlowAlphas(quality);
  const radiusMultipliers = getGlowRadiusMultipliers(quality);

  // Single graphics object for all layers
  const graphics = scene.add.graphics();

  // Helper to draw diamond path
  const drawDiamond = (s: number) => {
    graphics.beginPath();
    graphics.moveTo(0, -s);   // Top
    graphics.lineTo(s, 0);    // Right
    graphics.lineTo(0, s);    // Bottom
    graphics.lineTo(-s, 0);   // Left
    graphics.closePath();
  };

  // Draw glow layers
  for (let i = 0; i < alphas.length; i++) {
    const layerSize = size * radiusMultipliers[i];
    graphics.fillStyle(neonColor.glow, alphas[i]);
    drawDiamond(layerSize);
    graphics.fillPath();
  }

  // Core diamond
  graphics.fillStyle(neonColor.core, 1);
  drawDiamond(size);
  graphics.fillPath();

  // White outline
  graphics.lineStyle(2, 0xffffff, 0.85);
  drawDiamond(size);
  graphics.strokePath();

  container.add(graphics);
  return container;
}

/**
 * Creates a glowing hexagon shape using a single Graphics object.
 * OPTIMIZED: All layers drawn to one Graphics object.
 */
export function createGlowingHexagon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const alphas = getGlowAlphas(quality);
  const radiusMultipliers = getGlowRadiusMultipliers(quality);

  // Single graphics object for all layers
  const graphics = scene.add.graphics();

  // Helper to draw hexagon path at given radius
  // OPTIMIZATION: Uses module-level HEX_POINTS instead of recalculating trig each call
  const drawHexagon = (radius: number) => {
    graphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const px = HEX_POINTS[i].cos * radius;
      const py = HEX_POINTS[i].sin * radius;
      if (i === 0) {
        graphics.moveTo(px, py);
      } else {
        graphics.lineTo(px, py);
      }
    }
    graphics.closePath();
  };

  // Draw glow layers
  for (let i = 0; i < alphas.length; i++) {
    const layerSize = size * radiusMultipliers[i];
    graphics.fillStyle(neonColor.glow, alphas[i]);
    drawHexagon(layerSize);
    graphics.fillPath();
  }

  // Core hexagon
  graphics.fillStyle(neonColor.core, 1);
  drawHexagon(size);
  graphics.fillPath();

  // White outline
  graphics.lineStyle(2, 0xffffff, 0.85);
  drawHexagon(size);
  graphics.strokePath();

  container.add(graphics);
  return container;
}

/**
 * Factory function to create any glowing shape based on shape type.
 */
export function createGlowingShape(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  shape: 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon',
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  switch (shape) {
    case 'circle':
      return createGlowingCircle(scene, x, y, size, neonColor, quality);
    case 'square':
      return createGlowingSquare(scene, x, y, size, neonColor, quality);
    case 'triangle':
      return createGlowingTriangle(scene, x, y, size, neonColor, quality);
    case 'diamond':
      return createGlowingDiamond(scene, x, y, size, neonColor, quality);
    case 'hexagon':
      return createGlowingHexagon(scene, x, y, size, neonColor, quality);
    default:
      return createGlowingCircle(scene, x, y, size, neonColor, quality);
  }
}

/**
 * Updates the visual quality of a glow container by recreating its layers.
 * This is called when performance auto-scaling changes the quality level.
 * Note: This destroys and recreates children, use sparingly.
 */
export function updateGlowQuality(
  container: Phaser.GameObjects.Container,
  scene: Phaser.Scene,
  size: number,
  shape: 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon',
  neonColor: NeonColorPair,
  newQuality: VisualQuality
): void {
  const x = container.x;
  const y = container.y;
  const rotation = container.rotation;
  const depth = container.depth;

  // Create new container with updated quality
  const newContainer = createGlowingShape(scene, x, y, size, shape, neonColor, newQuality);
  newContainer.setRotation(rotation);
  newContainer.setDepth(depth);

  // Copy position to parent container
  container.removeAll(true);
  container.add(newContainer.getAll());
  newContainer.destroy();
}
