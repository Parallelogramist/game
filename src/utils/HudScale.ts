/**
 * HudScale.ts — Shared DPI-aware UI scaling utilities.
 *
 * Provides scaling functions for both in-game HUD (GameScene, ToastManager)
 * and menu scenes (BootScene, SettingsScene). Accounts for devicePixelRatio
 * so high-PPI phones get readable text sizes.
 */

import { GAME_WIDTH, GAME_HEIGHT } from '../GameConfig';

/**
 * DPI boost factor based on device characteristics.
 * High-DPI small screens (phones) get the largest boost since CSS pixels
 * are physically tiny on these devices.
 */
function getDpiBoost(canvasWidth: number, canvasHeight: number): number {
  const devicePixelRatio = window.devicePixelRatio || 1;
  if (devicePixelRatio < 2) return 1.0;

  const shorterSide = Math.min(canvasWidth, canvasHeight);
  if (shorterSide < 500) {
    // Phone: CSS pixels are physically tiny, boost significantly
    return 1 + (devicePixelRatio - 1) * 0.4;
  } else if (shorterSide < 900) {
    // Tablet: moderate boost
    return 1 + (devicePixelRatio - 1) * 0.2;
  }
  // Desktop HiDPI monitor: no boost needed (large physical screen)
  return 1.0;
}

/**
 * Scale factor for in-game HUD elements (GameScene, ToastManager).
 * Makes HUD elements larger on small/high-DPI screens.
 *
 * @param canvasWidth  - scene.scale.width (CSS pixels)
 * @param canvasHeight - scene.scale.height (CSS pixels)
 * @param userMultiplier - user's UI Scale setting (0.5–2.0, default 1.0)
 */
export function computeHudScale(
  canvasWidth: number,
  canvasHeight: number,
  userMultiplier: number = 1.0
): number {
  const longerSide = Math.max(canvasWidth, canvasHeight);
  const baseScale = Math.max(1.0, GAME_WIDTH / longerSide);
  const dpiBoost = getDpiBoost(canvasWidth, canvasHeight);
  return Math.max(0.5, Math.min(4.0, baseScale * dpiBoost * userMultiplier));
}

/**
 * Layout scale for menu scenes — shrinks positions to fit small screens.
 * Capped at 1.0 so desktop layout stays unchanged.
 */
export function computeMenuLayoutScale(canvasWidth: number, canvasHeight: number): number {
  return Math.min(1.0, canvasWidth / GAME_WIDTH, canvasHeight / GAME_HEIGHT);
}

/**
 * Font scale for menu scenes — layout shrink compensated by DPI boost
 * so text stays readable on high-PPI phones even though layout is smaller.
 */
export function computeMenuFontScale(
  canvasWidth: number,
  canvasHeight: number,
  userMultiplier: number = 1.0
): number {
  const layoutScale = computeMenuLayoutScale(canvasWidth, canvasHeight);
  const dpiBoost = getDpiBoost(canvasWidth, canvasHeight);
  return Math.max(0.5, Math.min(2.5, layoutScale * dpiBoost * userMultiplier));
}

/** Returns a scaled font size string like '28px'. */
export function scaledFontPx(scale: number, basePixels: number): string {
  return `${Math.round(basePixels * scale)}px`;
}

/** Returns a dimension scaled by the given factor, rounded to integer. */
export function scaledInt(scale: number, basePixels: number): number {
  return Math.round(basePixels * scale);
}
