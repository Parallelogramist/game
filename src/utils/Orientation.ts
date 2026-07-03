/**
 * Orientation.ts — portrait/landscape support under Phaser's EXPAND scale.
 *
 * The game is designed in a 1280×720 landscape space, but EXPAND keeps the
 * BASE size on one axis and grows the other to match the window aspect. With
 * a landscape base in a portrait window the width axis pins at 1280 game
 * units across a ~390pt phone screen — the whole world renders ~3× smaller
 * than in landscape. Swapping the base to 720×1280 whenever the viewport is
 * portrait keeps the SHORTER side at 720 game units in both orientations, so
 * world objects and UI hold a steady physical size and only the visible
 * field of view changes shape.
 *
 * The watcher swaps the base on viewport orientation flips (debounced —
 * iOS fires bursts of resizes for toolbar show/hide, which must NOT restart
 * scenes) and lets the caller re-layout live scenes. Menu scenes re-run
 * create() via scene.restart(); GameScene uses its save-restore round trip
 * (the applyUiScaleChange machinery).
 */

import Phaser from 'phaser';

export const LANDSCAPE_BASE = { width: 1280, height: 720 } as const;
export const PORTRAIT_BASE = { width: 720, height: 1280 } as const;

/** Square windows count as landscape — the game's native shape. */
export function isViewportPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerHeight > window.innerWidth;
}

export function baseSizeForViewport(): { width: number; height: number } {
  return isViewportPortrait() ? PORTRAIT_BASE : LANDSCAPE_BASE;
}

/**
 * Watch the viewport and swap the Phaser base game size when the orientation
 * class (portrait vs landscape) flips. `onFlip` runs AFTER the base swap —
 * the caller re-lays-out whatever scenes are live. Returns a disposer.
 */
export function installOrientationWatcher(
  game: Phaser.Game,
  onFlip: (portrait: boolean) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  let currentPortrait = isViewportPortrait();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const evaluate = () => {
    debounceTimer = null;
    const portrait = isViewportPortrait();
    if (portrait === currentPortrait) return;
    currentPortrait = portrait;
    const base = portrait ? PORTRAIT_BASE : LANDSCAPE_BASE;
    game.scale.setGameSize(base.width, base.height);
    onFlip(portrait);
  };

  const onResize = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluate, 250);
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  };
}
