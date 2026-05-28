import Phaser from 'phaser';

/**
 * Scene transition helpers for fade effects.
 */

function createFullscreenOverlay(scene: Phaser.Scene, alpha: number): Phaser.GameObjects.Rectangle {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const overlay = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, alpha);
  overlay.setDepth(1000);
  return overlay;
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
