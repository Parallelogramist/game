/**
 * GamepadManager.ts
 *
 * Polling-based gamepad wrapper for Phaser 3.
 * Provides dead-zoned stick input and edge-detected button presses.
 * Integrates with InputController for gameplay and MenuNavigator for menus.
 */

import Phaser from 'phaser';

// W3C Standard Gamepad button indices
export const GAMEPAD_BUTTON_A = 0;
export const GAMEPAD_BUTTON_B = 1;
export const GAMEPAD_BUTTON_X = 2;
export const GAMEPAD_BUTTON_Y = 3;
export const GAMEPAD_BUTTON_LB = 4;
export const GAMEPAD_BUTTON_RB = 5;
export const GAMEPAD_BUTTON_LT = 6;
export const GAMEPAD_BUTTON_RT = 7;
export const GAMEPAD_BUTTON_SELECT = 8;
export const GAMEPAD_BUTTON_START = 9;
export const GAMEPAD_BUTTON_L3 = 10;
export const GAMEPAD_BUTTON_R3 = 11;
export const GAMEPAD_DPAD_UP = 12;
export const GAMEPAD_DPAD_DOWN = 13;
export const GAMEPAD_DPAD_LEFT = 14;
export const GAMEPAD_DPAD_RIGHT = 15;

const STICK_DEAD_ZONE = 0.15;
const BUTTON_COUNT = 16;

export class GamepadManager {
  private scene: Phaser.Scene;
  private pad: Phaser.Input.Gamepad.Gamepad | null = null;
  private previousButtons: boolean[] = new Array(BUTTON_COUNT).fill(false);
  private currentButtons: boolean[] = new Array(BUTTON_COUNT).fill(false);
  private connectedHandler: ((pad: Phaser.Input.Gamepad.Gamepad) => void) | null = null;
  private disconnectedHandler: ((pad: Phaser.Input.Gamepad.Gamepad) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Check if a gamepad is already connected
    if (scene.input.gamepad && scene.input.gamepad.pad1) {
      this.pad = scene.input.gamepad.pad1;
    }

    // Listen for connect/disconnect
    this.connectedHandler = (pad: Phaser.Input.Gamepad.Gamepad) => {
      if (!this.pad) {
        this.pad = pad;
      }
    };
    this.disconnectedHandler = (pad: Phaser.Input.Gamepad.Gamepad) => {
      if (this.pad === pad) {
        this.pad = null;
        this.previousButtons.fill(false);
        this.currentButtons.fill(false);
      }
    };

    if (scene.input.gamepad) {
      scene.input.gamepad.on('connected', this.connectedHandler);
      scene.input.gamepad.on('disconnected', this.disconnectedHandler);
    }
  }

  /**
   * Snapshot button states for edge detection. Call once per frame.
   */
  update(): void {
    // Copy current → previous
    for (let i = 0; i < BUTTON_COUNT; i++) {
      this.previousButtons[i] = this.currentButtons[i];
    }

    if (!this.pad || !this.pad.connected) {
      this.currentButtons.fill(false);
      return;
    }

    // Read current button states
    for (let i = 0; i < BUTTON_COUNT; i++) {
      const button = this.pad.buttons[i];
      this.currentButtons[i] = button ? button.pressed : false;
    }
  }

  /**
   * Returns normalized left stick direction with dead zone applied.
   */
  getLeftStick(): { x: number; y: number } {
    if (!this.pad || !this.pad.connected) {
      return { x: 0, y: 0 };
    }

    let stickX = this.pad.leftStick.x;
    let stickY = this.pad.leftStick.y;

    // Apply dead zone
    const magnitude = Math.sqrt(stickX * stickX + stickY * stickY);
    if (magnitude < STICK_DEAD_ZONE) {
      return { x: 0, y: 0 };
    }

    // Rescale so that the range just outside dead zone starts at 0
    const rescaled = (magnitude - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
    const normalizedMagnitude = Math.min(rescaled, 1);
    stickX = (stickX / magnitude) * normalizedMagnitude;
    stickY = (stickY / magnitude) * normalizedMagnitude;

    return { x: stickX, y: stickY };
  }

  /**
   * True only on the frame the button transitions from released to pressed.
   */
  justPressed(buttonIndex: number): boolean {
    if (buttonIndex < 0 || buttonIndex >= BUTTON_COUNT) return false;
    return this.currentButtons[buttonIndex] && !this.previousButtons[buttonIndex];
  }

  /**
   * True while the button is held down.
   */
  isDown(buttonIndex: number): boolean {
    if (buttonIndex < 0 || buttonIndex >= BUTTON_COUNT) return false;
    return this.currentButtons[buttonIndex];
  }

  /**
   * Whether a gamepad is currently connected.
   */
  isConnected(): boolean {
    return this.pad !== null && this.pad.connected;
  }

  /**
   * Clean up event listeners.
   */
  destroy(): void {
    if (this.scene.input.gamepad) {
      if (this.connectedHandler) {
        this.scene.input.gamepad.off('connected', this.connectedHandler);
      }
      if (this.disconnectedHandler) {
        this.scene.input.gamepad.off('disconnected', this.disconnectedHandler);
      }
    }
    this.connectedHandler = null;
    this.disconnectedHandler = null;
    this.pad = null;
  }
}
