/**
 * MenuOverlay — backdrop variant for scenes that overlay GameScene.
 *
 * MenuBackground covers the full screen with a solid base; that's correct for
 * fullscreen menu scenes (BootScene, ShopScene), but UpgradeScene and the
 * pause menu render *over* live gameplay and need the gameplay to bleed
 * through. MenuOverlay skips the solid base and dims the gameplay layer with
 * a configurable tint, then runs the same gradient/grid/spotlight/drifters/
 * vignette stack on top.
 *
 * Same `update(deltaMs)` / `destroy()` shape as MenuBackground so callers can
 * swap them without other code changes.
 */

import Phaser from 'phaser';

const DRIFT_DEPTH = -20;
const SPOTLIGHT_DEPTH = -22;
const VIGNETTE_DEPTH = -5;
const GRID_DEPTH = -23;

export interface MenuOverlayOptions {
  /** Fill alpha for the dim overlay over gameplay. 0 = transparent, 1 = opaque. */
  dim?: number;
  /** Light-streak count. Defaults to 5 (lighter than MenuBackground's 7). */
  drifterCount?: number;
  /** Disable streaks entirely (e.g. on low-quality machines). */
  drifters?: boolean;
}

export interface MenuOverlay {
  update(deltaMs: number): void;
  destroy(): void;
}

interface Drifter {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationVel: number;
}

export function createMenuOverlay(
  scene: Phaser.Scene,
  options: MenuOverlayOptions = {},
): MenuOverlay {
  const { dim = 0.65, drifterCount = 5, drifters = true } = options;
  const screenWidth = scene.scale.width;
  const screenHeight = scene.scale.height;

  // Dim layer over gameplay. Cool blue-black so it harmonizes with menu bg.
  const dimLayer = scene.add.rectangle(
    screenWidth / 2,
    screenHeight / 2,
    screenWidth,
    screenHeight,
    0x070b1d,
    dim,
  );
  dimLayer.setDepth(GRID_DEPTH - 1);

  // Vertical gradient — matches MenuBackground intensity.
  const gradient = scene.add.graphics();
  gradient.setDepth(GRID_DEPTH);
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const alpha = 0.03 + t * t * 0.18;
    gradient.fillStyle(0x000000, alpha);
    gradient.fillRect(0, (screenHeight * i) / bands, screenWidth, screenHeight / bands + 2);
  }

  // Spotlight pulling focus to the centre.
  const spotlight = scene.add.graphics();
  spotlight.setDepth(SPOTLIGHT_DEPTH);
  const spotlightCenterX = screenWidth / 2;
  const spotlightCenterY = screenHeight * 0.5;
  const spotlightMaxRadius = Math.min(screenWidth, screenHeight) * 0.6;
  const spotColor = 0x1c2c5a;
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const radius = spotlightMaxRadius * (1 - t * 0.85);
    const alpha = 0.03 + (1 - t) * 0.05;
    spotlight.fillStyle(spotColor, alpha);
    spotlight.fillCircle(spotlightCenterX, spotlightCenterY, radius);
  }

  const drifterPool: Drifter[] = [];
  if (drifters) {
    for (let i = 0; i < drifterCount; i++) {
      drifterPool.push(createDrifter(scene, screenWidth, screenHeight, i / drifterCount));
    }
  }

  // Edge vignette — softer than MenuBackground so text remains crisp.
  const vignette = scene.add.graphics();
  vignette.setDepth(VIGNETTE_DEPTH);
  const cx = screenWidth / 2;
  const cy = screenHeight / 2;
  const maxRadius = Math.hypot(screenWidth, screenHeight) * 0.7;
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const radius = maxRadius * (0.6 + t * 0.4);
    const alpha = 0.04 + t * 0.05;
    vignette.fillStyle(0x000000, alpha);
    vignette.fillCircle(cx, cy, radius);
  }

  return {
    update(deltaMs: number) {
      const dt = deltaMs / 1000;
      for (const drifter of drifterPool) {
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
      dimLayer.destroy();
      gradient.destroy();
      spotlight.destroy();
      vignette.destroy();
      for (const drifter of drifterPool) drifter.graphics.destroy();
    },
  };
}

function createDrifter(
  scene: Phaser.Scene,
  screenWidth: number,
  screenHeight: number,
  phaseSeed: number,
): Drifter {
  const streakLength = 50 + Math.round(phaseSeed * 80);
  const halfLen = streakLength / 2;

  const graphics = scene.add.graphics();
  graphics.setDepth(DRIFT_DEPTH);

  // Thin vertical light streak — dimmer than MenuBackground's since gameplay
  // bleeds through beneath the overlay.
  graphics.fillStyle(0x4a6ba8, 0.08);
  graphics.fillRect(-1.5, -halfLen, 3, streakLength);
  graphics.fillStyle(0xaaccee, 0.2);
  graphics.fillRect(-0.5, -halfLen, 1, streakLength);
  graphics.fillStyle(0xcfe4ff, 0.3);
  graphics.fillRect(-1, -halfLen, 2, 8);

  const x = phaseSeed * screenWidth + (Math.random() - 0.5) * 200;
  const y = ((phaseSeed * 1.7) % 1) * screenHeight + (Math.random() - 0.5) * 200;
  const speed = 11 + Math.random() * 14;
  const vx = 0;
  const vy = -speed;
  const rotation = 0;
  const rotationVel = 0;

  graphics.setPosition(x, y);

  return { graphics, x, y, vx, vy, rotation, rotationVel };
}
