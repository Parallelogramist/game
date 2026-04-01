import Phaser from 'phaser';

/**
 * Scene transition helpers for fade effects.
 */

/**
 * Fade out: black rectangle tweens alpha 0 -> 1, then calls callback.
 */
export function fadeOut(scene: Phaser.Scene, duration: number, callback: () => void): void {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const overlay = scene.add.rectangle(
    w / 2,
    h / 2,
    w,
    h,
    0x000000,
    0
  );
  overlay.setDepth(1000);

  scene.tweens.add({
    targets: overlay,
    alpha: 1,
    duration,
    onComplete: () => {
      callback();
    },
  });
}

/**
 * Fade in: black rectangle tweens alpha 1 -> 0, then self-destructs.
 * Includes a subtle camera zoom-in (0.98 → 1.0) for a more dynamic entrance.
 */
export function fadeIn(scene: Phaser.Scene, duration: number): void {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const overlay = scene.add.rectangle(
    w / 2,
    h / 2,
    w,
    h,
    0x000000,
    1
  );
  overlay.setDepth(1000);

  scene.tweens.add({
    targets: overlay,
    alpha: 0,
    duration,
    onComplete: () => {
      overlay.destroy();
    },
  });

  // Subtle zoom-in for a more dynamic entrance
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
 * pointerover: scale to 1.03 (subtle hover lift)
 * pointerdown: scale to 0.95 (press)
 * pointerup: scale to 1.03 (return to hover state)
 * pointerout: scale to 1.0 (return to normal)
 * Uses killTweensOf to prevent tween stacking on rapid pointer events.
 */
export function addButtonInteraction(
  scene: Phaser.Scene,
  button: Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle
): void {
  button.on('pointerover', () => {
    scene.tweens.killTweensOf(button);
    scene.tweens.add({
      targets: button,
      scaleX: 1.03,
      scaleY: 1.03,
      duration: 80,
    });
  });

  button.on('pointerdown', () => {
    scene.tweens.killTweensOf(button);
    scene.tweens.add({
      targets: button,
      scaleX: 0.95,
      scaleY: 0.95,
      duration: 50,
    });
  });

  button.on('pointerup', () => {
    scene.tweens.killTweensOf(button);
    scene.tweens.add({
      targets: button,
      scaleX: 1.03,
      scaleY: 1.03,
      duration: 80,
    });
  });

  button.on('pointerout', () => {
    scene.tweens.killTweensOf(button);
    scene.tweens.add({
      targets: button,
      scaleX: 1.0,
      scaleY: 1.0,
      duration: 80,
    });
  });
}
