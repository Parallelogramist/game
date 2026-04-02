/**
 * BossArenaSystem transforms the arena atmosphere when a boss spawns
 * and reverts it on boss death.
 *
 * Module-level state pattern — no class, just exported functions.
 * Call resetBossArenaSystem() in GameScene.create() to clear state between runs.
 */

import Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BossArenaTheme {
  readonly overlayColor: number;
  readonly targetAlpha: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-boss visual themes: tint color and overlay opacity. */
const BOSS_ARENA_THEMES: Record<string, BossArenaTheme> = {
  horde_king: { overlayColor: 0xff0000, targetAlpha: 0.08 },
  void_wyrm:  { overlayColor: 0x6600aa, targetAlpha: 0.10 },
  the_machine: { overlayColor: 0x4466aa, targetAlpha: 0.08 },
};

/** Duration (ms) for the overlay fade-in when a boss spawns. */
const FADE_IN_DURATION_MS = 1000;

/** Duration (ms) for the overlay fade-out when a boss dies. */
const FADE_OUT_DURATION_MS = 500;

/** Duration (ms) of the white cleansing flash on boss death. */
const CLEANSE_FLASH_DURATION_MS = 200;

/** Amplitude of the sine-wave alpha pulse while the arena is active. */
const PULSE_AMPLITUDE = 0.02;

/** Speed of the sine-wave alpha pulse (radians per second). */
const PULSE_SPEED = 2.0;

/** Depth for the arena overlay — above grid background, below gameplay. */
const ARENA_OVERLAY_DEPTH = 1;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let sceneRef: Phaser.Scene | null = null;
let arenaActive = false;
let arenaOverlay: Phaser.GameObjects.Rectangle | null = null;
let arenaTint: number = 0;
let baseAlpha: number = 0;
let pulseTimer: number = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stores the Phaser scene reference. Call once in GameScene.create().
 */
export function setBossArenaScene(scene: Phaser.Scene): void {
  sceneRef = scene;
}

/**
 * Creates the tinted overlay and fades it in for the given boss type.
 * @param bossType - The boss type ID string (e.g. 'horde_king').
 */
export function activateBossArena(bossType: string): void {
  if (!sceneRef || arenaActive) return;

  const theme = BOSS_ARENA_THEMES[bossType];
  if (!theme) return;

  arenaActive = true;
  arenaTint = theme.overlayColor;
  baseAlpha = theme.targetAlpha;
  pulseTimer = 0;

  // Full-screen overlay, fixed to camera
  const screenWidth = sceneRef.scale.width;
  const screenHeight = sceneRef.scale.height;

  arenaOverlay = sceneRef.add.rectangle(
    screenWidth / 2,
    screenHeight / 2,
    screenWidth,
    screenHeight,
    arenaTint,
    0,
  );
  arenaOverlay.setDepth(ARENA_OVERLAY_DEPTH);
  arenaOverlay.setScrollFactor(0);
  arenaOverlay.setAlpha(0);

  // Fade in from transparent to target alpha
  sceneRef.tweens.add({
    targets: arenaOverlay,
    alpha: baseAlpha,
    duration: FADE_IN_DURATION_MS,
    ease: 'Sine.easeIn',
  });
}

/**
 * Plays a cleansing flash, fades out the overlay, and cleans up.
 */
export function deactivateBossArena(): void {
  if (!sceneRef || !arenaActive || !arenaOverlay) return;

  arenaActive = false;

  // Brief white flash — "cleansing wave"
  sceneRef.cameras.main.flash(CLEANSE_FLASH_DURATION_MS, 255, 255, 255);

  // Fade overlay to transparent, then destroy
  const overlayToDestroy = arenaOverlay;
  sceneRef.tweens.add({
    targets: overlayToDestroy,
    alpha: 0,
    duration: FADE_OUT_DURATION_MS,
    ease: 'Sine.easeOut',
    onComplete: () => {
      overlayToDestroy.destroy();
    },
  });

  arenaOverlay = null;
  arenaTint = 0;
  baseAlpha = 0;
  pulseTimer = 0;
}

/**
 * Per-frame update — gently pulses the overlay alpha for atmosphere.
 * @param deltaSeconds - Frame delta in seconds.
 */
export function updateBossArena(deltaSeconds: number): void {
  if (!arenaActive || !arenaOverlay) return;

  pulseTimer += deltaSeconds * PULSE_SPEED;

  const pulsedAlpha = baseAlpha + Math.sin(pulseTimer) * PULSE_AMPLITUDE;
  arenaOverlay.setAlpha(Math.max(0, pulsedAlpha));
}

/**
 * Full reset — destroys any active overlay and clears all state.
 * Call in GameScene.create() to prevent stale state between runs.
 */
export function resetBossArenaSystem(): void {
  if (arenaOverlay) {
    // Kill any running tweens on the overlay before destroying
    if (sceneRef) {
      sceneRef.tweens.killTweensOf(arenaOverlay);
    }
    arenaOverlay.destroy();
  }

  sceneRef = null;
  arenaActive = false;
  arenaOverlay = null;
  arenaTint = 0;
  baseAlpha = 0;
  pulseTimer = 0;
}
