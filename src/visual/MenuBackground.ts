/**
 * MenuBackground — Balatro-style felted backdrop.
 *
 * Layered render order (bottom → top):
 *   1. Solid base (deep navy / inky black).
 *   2. Vertical gradient bands (darker bottom).
 *   3. Faint diagonal grid pattern for texture.
 *   4. Center radial spotlight pulling focus to the middle.
 *   5. Drifting tilted card silhouettes for ambient motion.
 *   6. Edge vignette darkening the corners.
 *
 * One update() advances every drifter; no per-card tweens.
 */

import Phaser from 'phaser';

const DRIFT_DEPTH = -20;
const SPOTLIGHT_DEPTH = -22;
const VIGNETTE_DEPTH = -5;
const GRID_DEPTH = -23;

interface Drifter {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationVel: number;
}

export interface MenuBackground {
  update(deltaMs: number): void;
  destroy(): void;
}

export function createMenuBackground(scene: Phaser.Scene): MenuBackground {
  const screenWidth = scene.scale.width;
  const screenHeight = scene.scale.height;

  // 1. Solid base.
  const baseFill = scene.add.rectangle(
    screenWidth / 2,
    screenHeight / 2,
    screenWidth,
    screenHeight,
    0x070b1d,
    1,
  );
  baseFill.setDepth(GRID_DEPTH - 1);

  // 2. Vertical gradient — top stays brighter so the title pops, bottom sinks.
  const gradient = scene.add.graphics();
  gradient.setDepth(GRID_DEPTH);
  const bands = 16;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    // Quadratic falloff — most darkening lives in the bottom half.
    const alpha = 0.04 + t * t * 0.32;
    gradient.fillStyle(0x000000, alpha);
    gradient.fillRect(0, (screenHeight * i) / bands, screenWidth, screenHeight / bands + 2);
  }

  // 3. Faint diagonal grid pattern. Comic mode uses dark ink dots; neon
  // mode uses a cool blue tint. Keeps the backdrop from feeling vacuum-dark.
  const grid = scene.add.graphics();
  grid.setDepth(GRID_DEPTH);
  const cellSize = 36;
  const gridColor = 0x1a2a4a;
  grid.lineStyle(1, gridColor, 0.35);
  for (let gx = 0; gx < screenWidth + cellSize; gx += cellSize) {
    grid.beginPath();
    grid.moveTo(gx, 0);
    grid.lineTo(gx - screenHeight * 0.3, screenHeight);
    grid.strokePath();
  }
  for (let gy = 0; gy < screenHeight + cellSize; gy += cellSize) {
    grid.beginPath();
    grid.moveTo(0, gy);
    grid.lineTo(screenWidth, gy + screenWidth * 0.1);
    grid.strokePath();
  }

  // 4. Spotlight — soft circle of brightness behind the hero card. Built as
  // a stack of decreasing-radius alpha disks so the gradient feels smooth
  // without a shader.
  const spotlight = scene.add.graphics();
  spotlight.setDepth(SPOTLIGHT_DEPTH);
  const spotlightCenterX = screenWidth / 2;
  const spotlightCenterY = screenHeight * 0.42;
  const spotlightMaxRadius = Math.min(screenWidth, screenHeight) * 0.55;
  const spotColor = 0x1c2c5a;
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const radius = spotlightMaxRadius * (1 - t * 0.85);
    const alpha = 0.04 + (1 - t) * 0.06;
    spotlight.fillStyle(spotColor, alpha);
    spotlight.fillCircle(spotlightCenterX, spotlightCenterY, radius);
  }

  // 5. Drifting card silhouettes — ambient parallax motion.
  const drifters: Drifter[] = [];
  const drifterCount = 7;
  for (let i = 0; i < drifterCount; i++) {
    drifters.push(createDrifter(scene, screenWidth, screenHeight, i / drifterCount));
  }

  // 6. Edge vignette — concentric darkening rings to focus the eye on center.
  const vignette = scene.add.graphics();
  vignette.setDepth(VIGNETTE_DEPTH);
  const cx = screenWidth / 2;
  const cy = screenHeight / 2;
  const maxRadius = Math.hypot(screenWidth, screenHeight) * 0.7;
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const radius = maxRadius * (0.6 + t * 0.4);
    const alpha = 0.05 + t * 0.07;
    vignette.fillStyle(0x000000, alpha);
    vignette.fillCircle(cx, cy, radius);
  }

  return {
    update(deltaMs: number) {
      const dt = deltaMs / 1000;
      for (const drifter of drifters) {
        drifter.x += drifter.vx * dt;
        drifter.y += drifter.vy * dt;
        drifter.rotation += drifter.rotationVel * dt;

        const margin = 120;
        if (drifter.x < -margin) drifter.x = screenWidth + margin;
        if (drifter.x > screenWidth + margin) drifter.x = -margin;
        if (drifter.y < -margin) drifter.y = screenHeight + margin;
        if (drifter.y > screenHeight + margin) drifter.y = -margin;

        drifter.graphics.setPosition(drifter.x, drifter.y);
        drifter.graphics.setRotation(drifter.rotation);
      }
    },
    destroy() {
      baseFill.destroy();
      gradient.destroy();
      grid.destroy();
      spotlight.destroy();
      vignette.destroy();
      for (const drifter of drifters) drifter.graphics.destroy();
    },
  };
}

function createDrifter(
  scene: Phaser.Scene,
  screenWidth: number,
  screenHeight: number,
  phaseSeed: number,
): Drifter {
  const width = 70 + Math.round(phaseSeed * 60);
  const height = Math.round(width * 1.35);
  const halfW = width / 2;
  const halfH = height / 2;
  const radius = 12;

  const graphics = scene.add.graphics();
  graphics.setDepth(DRIFT_DEPTH);

  // Card silhouette — visible enough to register as background life, faint
  // enough to recede behind the menu UI.
  graphics.fillStyle(0x4a6ba8, 0.08);
  graphics.fillRoundedRect(-halfW, -halfH, width, height, radius);
  graphics.lineStyle(1, 0x88aacc, 0.18);
  graphics.strokeRoundedRect(-halfW, -halfH, width, height, radius);

  // Suit pip in the corner — tiny detail that sells the playing-card identity.
  graphics.fillStyle(0xaaccee, 0.3);
  graphics.fillCircle(-halfW + 14, -halfH + 14, 4);
  graphics.fillCircle(halfW - 14, halfH - 14, 4);

  const x = phaseSeed * screenWidth + (Math.random() - 0.5) * 200;
  const y = ((phaseSeed * 1.7) % 1) * screenHeight + (Math.random() - 0.5) * 200;
  const speed = 10 + Math.random() * 14;
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.7;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const rotation = (Math.random() - 0.5) * 0.7;
  const rotationVel = (Math.random() - 0.5) * 0.05;

  graphics.setPosition(x, y);
  graphics.setRotation(rotation);

  return { graphics, x, y, vx, vy, rotation, rotationVel };
}
