import Phaser from 'phaser';
import { NeonColorPair, getGlowAlphas, getGlowRadiusMultipliers } from './NeonColors';

export type VisualQuality = 'high' | 'medium' | 'low';

type ShapeName = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon';

// OPTIMIZATION: Pre-compute hexagon unit vectors at module level (constant trig values)
const HEX_POINTS: readonly { cos: number; sin: number }[] = (() => {
  const points: { cos: number; sin: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;  // Start from top
    points.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  return points;
})();

// =====================================================================
// Neon shape drawing
// =====================================================================

function drawNeonCircle(
  graphics: Phaser.GameObjects.Graphics,
  radius: number,
  neonColor: NeonColorPair,
  quality: VisualQuality
): void {
  const alphas = getGlowAlphas(quality);
  const radiusMultipliers = getGlowRadiusMultipliers(quality);

  for (let i = 0; i < alphas.length; i++) {
    const glowRadius = radius * radiusMultipliers[i];
    graphics.fillStyle(neonColor.glow, alphas[i]);
    graphics.fillCircle(0, 0, glowRadius);
  }
  graphics.fillStyle(neonColor.core, 1);
  graphics.fillCircle(0, 0, radius);
  graphics.lineStyle(2, 0xffffff, 0.85);
  graphics.strokeCircle(0, 0, radius);
  graphics.fillStyle(0xffffff, 0.6);
  graphics.fillCircle(0, 0, radius * 0.35);
}

function drawNeonShape(
  graphics: Phaser.GameObjects.Graphics,
  size: number,
  shape: ShapeName,
  neonColor: NeonColorPair,
  quality: VisualQuality
): void {
  if (shape === 'circle') {
    drawNeonCircle(graphics, size, neonColor, quality);
    return;
  }
  const alphas = getGlowAlphas(quality);
  const mults = getGlowRadiusMultipliers(quality);

  const drawPath = (sz: number) => {
    graphics.beginPath();
    switch (shape) {
      case 'square':
        graphics.moveTo(-sz, -sz);
        graphics.lineTo(sz, -sz);
        graphics.lineTo(sz, sz);
        graphics.lineTo(-sz, sz);
        graphics.closePath();
        break;
      case 'triangle': {
        const h = sz * 1.5;
        graphics.moveTo(0, -h * 0.5);
        graphics.lineTo(sz, h * 0.5);
        graphics.lineTo(-sz, h * 0.5);
        graphics.closePath();
        break;
      }
      case 'diamond':
        graphics.moveTo(0, -sz);
        graphics.lineTo(sz, 0);
        graphics.lineTo(0, sz);
        graphics.lineTo(-sz, 0);
        graphics.closePath();
        break;
      case 'hexagon':
        for (let i = 0; i < 6; i++) {
          const px = HEX_POINTS[i].cos * sz;
          const py = HEX_POINTS[i].sin * sz;
          if (i === 0) graphics.moveTo(px, py);
          else graphics.lineTo(px, py);
        }
        graphics.closePath();
        break;
    }
  };

  for (let i = 0; i < alphas.length; i++) {
    graphics.fillStyle(neonColor.glow, alphas[i]);
    drawPath(size * mults[i]);
    graphics.fillPath();
  }
  graphics.fillStyle(neonColor.core, 1);
  drawPath(size);
  graphics.fillPath();
  graphics.lineStyle(2, 0xffffff, 0.85);
  drawPath(size);
  graphics.strokePath();
}

// =====================================================================
// Public API — creates a container with a Graphics object. Quality
// routing happens at draw time so the render paths stay in sync.
// =====================================================================

function drawShapeIntoGraphics(
  graphics: Phaser.GameObjects.Graphics,
  size: number,
  shape: ShapeName,
  neonColor: NeonColorPair,
  quality: VisualQuality
): void {
  drawNeonShape(graphics, size, shape, neonColor, quality);
}

export function createGlowingCircle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  return createGlowingShape(scene, x, y, radius, 'circle', neonColor, quality);
}

export function createGlowingTriangle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  return createGlowingShape(scene, x, y, size, 'triangle', neonColor, quality);
}

export function createGlowingSquare(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  return createGlowingShape(scene, x, y, size, 'square', neonColor, quality);
}

export function createGlowingDiamond(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  return createGlowingShape(scene, x, y, size, 'diamond', neonColor, quality);
}

export function createGlowingHexagon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  return createGlowingShape(scene, x, y, size, 'hexagon', neonColor, quality);
}

export function createGlowingShape(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  shape: ShapeName,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const graphics = scene.add.graphics();
  drawShapeIntoGraphics(graphics, size, shape, neonColor, quality);
  container.add(graphics);
  return container;
}

// =====================================================================
// Cached shape texture system — pre-renders shapes to textures so enemies
// using the same combo share ONE texture.
// =====================================================================

const shapeTextureCache = new Map<string, string>();
let shapeTextureCacheIdCounter = 0;

function getShapeCacheKey(
  shape: string, coreColor: number, glowColor: number, size: number,
  quality: VisualQuality
): string {
  return `${shape}_${coreColor.toString(16)}_${glowColor.toString(16)}_${size}_${quality}`;
}

function ensureCachedShapeTexture(
  scene: Phaser.Scene,
  size: number,
  shape: ShapeName,
  neonColor: NeonColorPair,
  quality: VisualQuality
): string {
  const cacheKey = getShapeCacheKey(shape, neonColor.core, neonColor.glow, size, quality);
  const existingTextureKey = shapeTextureCache.get(cacheKey);
  if (existingTextureKey && scene.textures.exists(existingTextureKey)) {
    return existingTextureKey;
  }

  const tempContainer = createGlowingShape(scene, 0, 0, size, shape, neonColor, quality);

  // Calculate texture dimensions — glow extends beyond shape.
  const outlinePadding = size * getGlowRadiusMultipliers(quality)[0] - size + 4;
  const padding = size + outlinePadding + 4;
  const textureWidth = Math.ceil(padding * 2);
  const textureHeight = Math.ceil(padding * 2);

  const textureKey = `glow_shape_${shapeTextureCacheIdCounter++}`;
  const renderTexture = scene.add.renderTexture(0, 0, textureWidth, textureHeight);
  renderTexture.draw(tempContainer, padding, padding);
  renderTexture.saveTexture(textureKey);

  renderTexture.destroy();
  tempContainer.destroy();

  shapeTextureCache.set(cacheKey, textureKey);
  return textureKey;
}

export function createCachedGlowingShape(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  shape: ShapeName,
  neonColor: NeonColorPair,
  quality: VisualQuality = 'high'
): Phaser.GameObjects.Container {
  const textureKey = ensureCachedShapeTexture(scene, size, shape, neonColor, quality);

  const container = scene.add.container(x, y);
  const image = scene.add.image(0, 0, textureKey);
  container.add(image);
  return container;
}

export function resetShapeTextureCache(scene: Phaser.Scene): void {
  for (const textureKey of shapeTextureCache.values()) {
    if (scene.textures.exists(textureKey)) {
      scene.textures.remove(textureKey);
    }
  }
  shapeTextureCache.clear();
  shapeTextureCacheIdCounter = 0;
}

export function updateGlowQuality(
  container: Phaser.GameObjects.Container,
  scene: Phaser.Scene,
  size: number,
  shape: ShapeName,
  neonColor: NeonColorPair,
  newQuality: VisualQuality
): void {
  const x = container.x;
  const y = container.y;
  const rotation = container.rotation;
  const depth = container.depth;

  const newContainer = createGlowingShape(scene, x, y, size, shape, neonColor, newQuality);
  newContainer.setRotation(rotation);
  newContainer.setDepth(depth);

  container.removeAll(true);
  container.add(newContainer.getAll());
  newContainer.destroy();
}
