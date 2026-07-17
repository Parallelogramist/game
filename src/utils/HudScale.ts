/**
 * HudScale.ts — Shared UI scaling utilities.
 *
 * Provides scaling functions for both in-game HUD (GameScene, ToastManager)
 * and menu scenes (BootScene, SettingsScene).
 *
 * Core idea: under Phaser's EXPAND scale mode the canvas can hold far more
 * game units than the screen has CSS points (e.g. iPhone landscape with the
 * Safari toolbar ≈ 956×345pt viewport → the 720-unit-tall game expands to
 * ~2000×720 at 0.48 zoom). UI sized in raw game units renders physically
 * tiny there. `densityCompensation` measures game-units-per-CSS-point and
 * scales UI back up so it keeps a readable physical size on any device.
 */

import { GAME_WIDTH, GAME_HEIGHT } from '../GameConfig';

/**
 * How many game units one CSS point covers, floored at 1 so large desktop
 * displays (zoom ≥ 1) keep their natural "UI grows with the canvas" feel.
 * Guarded for non-browser (test) environments.
 */
function densityCompensation(canvasWidth: number, canvasHeight: number): number {
  if (typeof window === 'undefined') return 1.0;
  const cssShorterSide = Math.min(window.innerWidth, window.innerHeight);
  const gameShorterSide = Math.min(canvasWidth, canvasHeight);
  if (cssShorterSide <= 0) return 1.0;
  return Math.max(1.0, gameShorterSide / cssShorterSide);
}

/**
 * Scale factor for in-game HUD elements (GameScene, ToastManager).
 * Keeps HUD text and touch targets at a stable physical size on dense
 * (phone) viewports while leaving desktop rendering unchanged.
 *
 * @param canvasWidth  - scene.scale.width (game units)
 * @param canvasHeight - scene.scale.height (game units)
 * @param userMultiplier - user's UI Scale setting (0.5–2.0, default 1.0)
 */
export function computeHudScale(
  canvasWidth: number,
  canvasHeight: number,
  userMultiplier: number = 1.0
): number {
  const longerSide = Math.max(canvasWidth, canvasHeight);
  const baseScale = Math.max(1.0, GAME_WIDTH / longerSide);
  const density = densityCompensation(canvasWidth, canvasHeight);
  return Math.max(0.5, Math.min(4.0, Math.max(baseScale, density) * userMultiplier));
}

/**
 * Layout scale for menu scenes — shrinks positions to fit small screens.
 * Capped at 1.0 so desktop layout stays unchanged.
 */
export function computeMenuLayoutScale(canvasWidth: number, canvasHeight: number): number {
  return Math.min(1.0, canvasWidth / GAME_WIDTH, canvasHeight / GAME_HEIGHT);
}

/**
 * Portrait variant — fits the orientation-matched 720×1280 design space
 * instead of shrinking the LANDSCAPE design into a portrait viewport (which
 * lands at 0.5625 and strands a tiny menu in the top third of the screen).
 * Under the orientation-aware EXPAND base (portrait guarantees ≥720×1280)
 * this resolves to 1.0 — so a scene may only opt in if its portrait
 * composition genuinely fits 720 units of width at full size (BootScene's
 * centered column does; SettingsScene's 1144-wide two-column grid does NOT —
 * it stays on the landscape-fit scale until it stacks).
 */
export function computeMenuLayoutScalePortrait(canvasWidth: number, canvasHeight: number): number {
  return Math.min(1.0, canvasWidth / GAME_HEIGHT, canvasHeight / GAME_WIDTH);
}

/**
 * Font scale for menu scenes — layout shrink compensated by pixel density so
 * text stays readable on phones even though the layout is smaller. The
 * density term is capped below the HUD's: menu cards have fixed layouts that
 * overflow past ~1.6×.
 */
export function computeMenuFontScale(
  canvasWidth: number,
  canvasHeight: number,
  userMultiplier: number = 1.0
): number {
  const layoutScale = computeMenuLayoutScale(canvasWidth, canvasHeight);
  const density = Math.min(1.6, densityCompensation(canvasWidth, canvasHeight));
  return Math.max(0.5, Math.min(2.5, layoutScale * density * userMultiplier));
}

/**
 * Portrait font companion to computeMenuLayoutScalePortrait. The density
 * boost caps at 1.2 (vs landscape's 1.6): width is the scarce axis in
 * portrait, and the widest text — the BootScene wordmark including its
 * 1.045× glow ghost — measures ~690 of the 720 units at 1.2 but clips at
 * 1.3. The text-vs-container ratio stays below the landscape ratio, so
 * anything that fits its card in landscape fits here too.
 */
export function computeMenuFontScalePortrait(
  canvasWidth: number,
  canvasHeight: number,
  userMultiplier: number = 1.0
): number {
  const layoutScale = computeMenuLayoutScalePortrait(canvasWidth, canvasHeight);
  const density = Math.min(1.2, densityCompensation(canvasWidth, canvasHeight));
  return Math.max(0.5, Math.min(2.5, layoutScale * density * userMultiplier));
}

/** Returns a scaled font size string like '28px'. */
export function scaledFontPx(scale: number, basePixels: number): string {
  return `${Math.round(basePixels * scale)}px`;
}

/** Returns a dimension scaled by the given factor, rounded to integer. */
export function scaledInt(scale: number, basePixels: number): number {
  return Math.round(basePixels * scale);
}

/**
 * Uniform shrink that fits a vertical stack of equal rows into `availableHeight`;
 * 1 when it already fits. The fit-to-height twin of BootScene's fit-to-width deck row.
 *
 * The practice dock needs it because the canvas is ~720 game units tall in EXPAND mode
 * while hudScale climbs to ~2 on a phone: its 10 design-size rows total more than the
 * canvas holds, and a centered over-tall stack overhangs BOTH edges, clipping the first
 * and last rows out of reach.
 */
export function computeRowStackFit(
  rowCount: number,
  rowHeight: number,
  gap: number,
  availableHeight: number
): number {
  if (rowCount <= 0 || availableHeight <= 0) return 1;
  const naturalHeight = rowCount * rowHeight + Math.max(0, rowCount - 1) * gap;
  if (naturalHeight <= 0) return 1;
  return naturalHeight > availableHeight ? availableHeight / naturalHeight : 1;
}
