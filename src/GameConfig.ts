import Phaser from 'phaser';

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#000008',  // Near-black for Geometry Wars neon aesthetic
  parent: 'game-container',
  antialias: false,
  roundPixels: true,
  input: {
    gamepad: true,
    // Phaser's default is a single touch pointer — the second finger (dash /
    // ultimate taps while the joystick thumb is down) would never register.
    activePointers: 4,
  },
  scale: {
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: true,
  },
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  scene: [],
};

// Game constants
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
