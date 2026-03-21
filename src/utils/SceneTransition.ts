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
}

/**
 * Adds press animation to an interactive game object (button feedback).
 * pointerdown: scale to 0.95 over 50ms
 * pointerup/pointerout: scale back to 1.0 over 80ms
 */
export function addButtonInteraction(
  scene: Phaser.Scene,
  button: Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle
): void {
  button.on('pointerdown', () => {
    scene.tweens.add({
      targets: button,
      scaleX: 0.95,
      scaleY: 0.95,
      duration: 50,
    });
  });

  const restoreScale = () => {
    scene.tweens.add({
      targets: button,
      scaleX: 1.0,
      scaleY: 1.0,
      duration: 80,
    });
  };

  button.on('pointerup', restoreScale);
  button.on('pointerout', restoreScale);
}
