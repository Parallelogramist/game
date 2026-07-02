import Phaser from 'phaser';
import { getSettingsManager } from '../settings';

/**
 * Scene transition helpers.
 *
 * Menu-to-menu navigation uses the sweep pair: `transitionToScene` plays an
 * accent-line exit sweep + dim on the departing scene, `sweepIn` plays the
 * reverse on the arriving scene. Gameplay flow (into/out of GameScene)
 * keeps the plain `fadeOut`/`fadeIn` helpers.
 *
 * All transition objects live at depth 3000 — the whole-frame transition
 * band — so they cover every UI layer for the handful of frames they exist.
 */

const TRANSITION_DEPTH = 3000;
const SWEEP_ACCENT = 0x66bbff;
/** Sweep geometry extends past the core line — offset start/end so the glow clears the screen. */
const SWEEP_PAD = 16;

/**
 * One transition at a time — a second click during the exit sweep must not
 * start a second scene change. Reset when the sweep hands off to
 * `scene.start`, when the arriving scene calls `sweepIn`, and on scene
 * shutdown (covers tweens killed mid-flight by `tweens.killAll`).
 */
let transitionInFlight = false;

function createFullscreenOverlay(scene: Phaser.Scene, alpha: number): Phaser.GameObjects.Rectangle {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const overlay = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, alpha);
  overlay.setDepth(1000);
  return overlay;
}

/** Full-screen black dim used by the sweep transitions (depth 3000 band). */
function createTransitionDim(scene: Phaser.Scene, alpha: number): Phaser.GameObjects.Rectangle {
  const dim = createFullscreenOverlay(scene, alpha);
  dim.setDepth(TRANSITION_DEPTH);
  dim.setScrollFactor(0);
  return dim;
}

/** Vertical sweep line: 2px bright accent core over a soft 8px glow pass. */
function createSweepLine(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const height = scene.scale.height;
  const line = scene.add.graphics();
  // Soft glow underlay — wide faint pass + tighter brighter pass.
  line.fillStyle(SWEEP_ACCENT, 0.12);
  line.fillRect(-8, 0, 16, height);
  line.fillStyle(SWEEP_ACCENT, 0.3);
  line.fillRect(-4, 0, 8, height);
  // Bright 2px core.
  line.fillStyle(SWEEP_ACCENT, 1);
  line.fillRect(-1, 0, 2, height);
  line.setDepth(TRANSITION_DEPTH);
  line.setScrollFactor(0);
  return line;
}

/**
 * Exit transition between menu scenes: an accent line sweeps left-to-right
 * while a black dim fades in just behind the sweep front, then the target
 * scene starts. Reduced motion: plain 150ms fade to black.
 *
 * Safe against double-invocation (in-flight guard) and interruption — the
 * dim/line are destroyed in onComplete, and scene shutdown clears the guard
 * if the tweens get killed mid-flight.
 */
export function transitionToScene(scene: Phaser.Scene, targetSceneKey: string, data?: object): void {
  if (transitionInFlight) return;
  transitionInFlight = true;
  // tweens.killAll on shutdown drops onComplete — never leave the guard set.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    transitionInFlight = false;
  });

  const start = () => {
    transitionInFlight = false;
    scene.scene.start(targetSceneKey, data);
  };

  const dim = createTransitionDim(scene, 0);

  if (getSettingsManager().isReducedMotionEnabled()) {
    scene.tweens.add({
      targets: dim,
      alpha: 1,
      duration: 150,
      onComplete: () => {
        dim.destroy();
        start();
      },
    });
    return;
  }

  const line = createSweepLine(scene);
  line.x = -SWEEP_PAD;

  scene.tweens.add({
    targets: line,
    x: scene.scale.width + SWEEP_PAD,
    duration: 240,
    ease: 'Cubic.easeInOut',
  });
  scene.tweens.add({
    targets: dim,
    alpha: 1,
    duration: 300,
    ease: 'Cubic.easeInOut',
    onComplete: () => {
      line.destroy();
      dim.destroy();
      start();
    },
  });
}

/**
 * Entrance counterpart to `transitionToScene` — call from the receiving
 * menu scene's create(). Screen starts black; the dim fades out while the
 * accent line sweeps back out right-to-left, then everything self-destructs.
 * Reduced motion: plain 150ms fade-in.
 */
export function sweepIn(scene: Phaser.Scene): void {
  // The arriving scene owns the screen — clear any stale in-flight guard.
  transitionInFlight = false;

  const dim = createTransitionDim(scene, 1);

  if (getSettingsManager().isReducedMotionEnabled()) {
    scene.tweens.add({
      targets: dim,
      alpha: 0,
      duration: 150,
      onComplete: () => dim.destroy(),
    });
    return;
  }

  const line = createSweepLine(scene);
  line.x = scene.scale.width + SWEEP_PAD;

  scene.tweens.add({
    targets: line,
    x: -SWEEP_PAD,
    duration: 240,
    ease: 'Cubic.easeInOut',
    onComplete: () => line.destroy(),
  });
  scene.tweens.add({
    targets: dim,
    alpha: 0,
    duration: 260,
    ease: 'Cubic.easeInOut',
    onComplete: () => dim.destroy(),
  });
}

export interface StaggerEntranceOptions {
  baseDelayMs?: number;
  stepMs?: number;
  riseDistance?: number;
  durationMs?: number;
}

/** Anything with tweenable alpha + y — containers, texts, graphics, images. */
export type EntranceItem = Phaser.GameObjects.GameObject & {
  alpha: number;
  y: number;
  setAlpha(value: number): unknown;
  setY(value: number): unknown;
};

/**
 * Standard entrance choreography: each item fades in and rises to its
 * resting position, staggered in array order (title first, then cards/rows
 * in visual order). Snapshots each item's current alpha/y as the tween
 * target, so pre-dimmed items keep their intended alpha and interactive hit
 * zones end up exactly where the layout put them.
 *
 * Reduced motion: items stay at their final state — no tweens.
 */
export function staggerEntrance(
  scene: Phaser.Scene,
  items: EntranceItem[],
  opts: StaggerEntranceOptions = {},
): void {
  const { baseDelayMs = 60, stepMs = 40, riseDistance = 12, durationMs = 280 } = opts;

  // Items are already laid out at their final state — nothing to do.
  if (getSettingsManager().isReducedMotionEnabled()) return;

  items.forEach((item, index) => {
    if (!item.scene) return; // destroyed before the entrance began
    const targetAlpha = item.alpha;
    const targetY = item.y;
    item.setAlpha(0);
    item.setY(targetY + riseDistance);
    scene.tweens.add({
      targets: item,
      alpha: targetAlpha,
      y: targetY,
      delay: baseDelayMs + index * stepMs,
      duration: durationMs,
      ease: 'Sine.easeOut',
      onStart: (tween: Phaser.Tweens.Tween) => {
        // Destroyed while waiting out the stagger delay — don't tween a corpse.
        if (!item.scene) tween.stop();
      },
    });
  });
}

/**
 * Fade out: black rectangle tweens alpha 0 -> 1, then calls callback.
 */
export function fadeOut(scene: Phaser.Scene, duration: number, callback: () => void): void {
  const overlay = createFullscreenOverlay(scene, 0);
  scene.tweens.add({ targets: overlay, alpha: 1, duration, onComplete: callback });
}

/**
 * Fade in: black rectangle tweens alpha 1 -> 0, then self-destructs.
 * Includes a subtle camera zoom-in (0.98 → 1.0) for a more dynamic entrance.
 */
export function fadeIn(scene: Phaser.Scene, duration: number): void {
  const overlay = createFullscreenOverlay(scene, 1);
  scene.tweens.add({
    targets: overlay,
    alpha: 0,
    duration,
    onComplete: () => overlay.destroy(),
  });

  scene.cameras.main.zoom = 0.98;
  scene.tweens.add({
    targets: scene.cameras.main,
    zoom: 1.0,
    duration,
    ease: 'Sine.easeOut',
  });
}

/**
 * Adds hover + press animation to an interactive game object (button feedback).
 * pointerover/up: scale to 1.03 (hover lift), pointerdown: 0.95 (press), pointerout: 1.0.
 * Uses killTweensOf to prevent tween stacking on rapid pointer events.
 */
export function addButtonInteraction(
  scene: Phaser.Scene,
  button: Phaser.GameObjects.GameObject & { scaleX?: number; scaleY?: number }
): void {
  const scaleTween = (targetScale: number, duration: number) => {
    scene.tweens.killTweensOf(button);
    scene.tweens.add({ targets: button, scaleX: targetScale, scaleY: targetScale, duration });
  };

  button.on('pointerover', () => scaleTween(1.03, 80));
  button.on('pointerdown', () => scaleTween(0.95, 50));
  button.on('pointerup', () => scaleTween(1.03, 80));
  button.on('pointerout', () => scaleTween(1.0, 80));
}
