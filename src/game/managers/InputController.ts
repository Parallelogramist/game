/**
 * InputController.ts
 *
 * Manages all player input: keyboard, mouse, joystick, and the dash ability.
 * Also handles focus-loss auto-pause via document visibility and window blur.
 *
 * Extracted from GameScene to keep input concerns in one place.
 */

import Phaser from 'phaser';
import { InputState } from '../../ecs/systems/InputSystem';
import { JoystickManager } from '../../ui/JoystickManager';
import { TUNING } from '../../data/GameTuning';
import { getSprite } from '../../ecs/systems/SpriteSystem';
import { PLAYER_NEON } from '../../visual/NeonColors';

export interface InputControllerOptions {
  getDashCooldown: () => number;
  onFocusLost: () => void;
}

export interface DashState {
  isDashing: boolean;
  velocityX: number;
  velocityY: number;
  cooldownRemaining: number;
}

export class InputController {
  private scene: Phaser.Scene;
  private options: InputControllerOptions;

  // Input state shared with ECS InputSystem
  private inputState!: InputState;

  // Virtual joystick for touch devices
  private joystickManager: JoystickManager | null = null;

  // Dash ability state
  private dashCooldownTimer: number = 0;
  private isDashingFlag: boolean = false;
  private dashTimer: number = 0;
  private dashDirectionX: number = 0;
  private dashDirectionY: number = 0;
  private readonly DASH_DURATION = TUNING.player.dashDuration;
  private readonly DASH_SPEED_MULT = TUNING.player.dashSpeedMultiplier;

  // Focus/visibility change handler references for cleanup
  private handleVisibilityChange: (() => void) | null = null;
  private handleWindowBlur: (() => void) | null = null;

  // Shift key handler reference for cleanup
  private shiftKeyHandler: (() => void) | null = null;

  // Pointerdown handler reference for cleanup
  private pointerDownHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;

  constructor(scene: Phaser.Scene, options: InputControllerOptions) {
    this.scene = scene;
    this.options = options;
  }

  /**
   * Initializes input state, keyboard/mouse/joystick handlers,
   * and focus-loss auto-pause handlers.
   */
  create(): void {
    this.setupInput();
    this.setupFocusLossHandlers();
  }

  /**
   * Syncs joystick, keyboard, and mouse inputs each frame.
   * Returns the current InputState for use in ECS systems.
   */
  update(): InputState {
    // Update joystick input
    if (this.joystickManager) {
      const joystickDirection = this.joystickManager.getDirection();
      this.inputState.joystickX = joystickDirection.x;
      this.inputState.joystickY = joystickDirection.y;
    }

    // Update control mode based on actual input device usage
    const activePointer = this.scene.input.activePointer;

    const keyboardIsActive = this.inputState.cursors.left.isDown
      || this.inputState.cursors.right.isDown
      || this.inputState.cursors.up.isDown
      || this.inputState.cursors.down.isDown
      || this.inputState.wasd.W.isDown
      || this.inputState.wasd.A.isDown
      || this.inputState.wasd.S.isDown
      || this.inputState.wasd.D.isDown;

    if (this.inputState.joystickX !== 0 || this.inputState.joystickY !== 0) {
      this.inputState.controlMode = 'joystick';
      this.inputState.hasClickTarget = false;
    } else if (keyboardIsActive) {
      this.inputState.controlMode = 'keyboard';
      this.inputState.hasClickTarget = false;
    }
    // Mouse control mode is set in the pointerdown handler

    this.inputState.mouseX = activePointer.worldX;
    this.inputState.mouseY = activePointer.worldY;
    this.inputState.mouseActive = this.inputState.controlMode === 'mouse';

    return this.inputState;
  }

  /**
   * Updates dash cooldown and active dash timer each frame.
   * Returns the current dash state for applying velocity in ECS.
   */
  updateDash(deltaSeconds: number): DashState {
    // Update dash cooldown
    if (this.dashCooldownTimer > 0) {
      this.dashCooldownTimer -= deltaSeconds;
    }

    // Compute dash velocity for this frame
    let dashVelocityX = 0;
    let dashVelocityY = 0;

    // Process active dash
    if (this.isDashingFlag) {
      this.dashTimer -= deltaSeconds;

      // Velocity is direction * speed multiplier; caller scales by moveSpeed
      dashVelocityX = this.dashDirectionX * this.DASH_SPEED_MULT;
      dashVelocityY = this.dashDirectionY * this.DASH_SPEED_MULT;

      // End dash when timer expires
      if (this.dashTimer <= 0) {
        this.isDashingFlag = false;
      }
    }

    return {
      isDashing: this.isDashingFlag,
      velocityX: dashVelocityX,
      velocityY: dashVelocityY,
      cooldownRemaining: this.dashCooldownTimer,
    };
  }

  /**
   * Attempts to initiate a dash in the current movement direction.
   * Falls back to cursor direction if not moving.
   */
  tryDash(playerX: number, playerY: number, playerId: number): void {
    // Check if dash ability is available (dashCooldown > 0 means they have dash)
    if (this.options.getDashCooldown() <= 0) return;
    if (this.isDashingFlag) return;
    if (this.dashCooldownTimer > 0) return;

    // Get current movement direction
    let directionX = 0;
    let directionY = 0;

    if (this.inputState.cursors.left.isDown || this.inputState.wasd.A.isDown) directionX -= 1;
    if (this.inputState.cursors.right.isDown || this.inputState.wasd.D.isDown) directionX += 1;
    if (this.inputState.cursors.up.isDown || this.inputState.wasd.W.isDown) directionY -= 1;
    if (this.inputState.cursors.down.isDown || this.inputState.wasd.S.isDown) directionY += 1;

    // If not moving, dash toward cursor
    if (directionX === 0 && directionY === 0) {
      const pointer = this.scene.input.activePointer;
      directionX = pointer.worldX - playerX;
      directionY = pointer.worldY - playerY;
    }

    // Normalize direction
    const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
    if (magnitude > 0) {
      directionX /= magnitude;
      directionY /= magnitude;
    } else {
      return; // No direction to dash
    }

    // Start dash
    this.isDashingFlag = true;
    this.dashTimer = this.DASH_DURATION;
    this.dashDirectionX = directionX;
    this.dashDirectionY = directionY;
    this.dashCooldownTimer = this.options.getDashCooldown();

    // Visual feedback - brief player flash
    const playerSprite = getSprite(playerId);
    if (playerSprite && 'setFillStyle' in playerSprite) {
      const rectangle = playerSprite as Phaser.GameObjects.Rectangle;
      rectangle.setFillStyle(0xffffff);
      this.scene.time.delayedCall(50, () => {
        if (playerId !== -1) {
          rectangle.setFillStyle(PLAYER_NEON.core);
        }
      });
    }
  }

  /**
   * Enables or disables the joystick (used during pause/game over).
   */
  setEnabled(enabled: boolean): void {
    if (this.joystickManager) {
      this.joystickManager.setEnabled(enabled);
    }
  }

  /**
   * Returns the current input state.
   */
  getInputState(): InputState {
    return this.inputState;
  }

  /**
   * Returns whether a dash is currently active.
   */
  isDashActive(): boolean {
    return this.isDashingFlag;
  }

  /**
   * Returns the remaining dash cooldown time in seconds.
   */
  getDashCooldownRemaining(): number {
    return this.dashCooldownTimer;
  }

  /**
   * Sets the dash cooldown timer directly (used when restoring saved state).
   */
  setDashCooldownTimer(value: number): void {
    this.dashCooldownTimer = value;
  }

  /**
   * Resets dash state (used when restoring saved state).
   */
  resetDashState(): void {
    this.isDashingFlag = false;
    this.dashTimer = 0;
    this.dashDirectionX = 0;
    this.dashDirectionY = 0;
  }

  /**
   * Cleans up all handlers, joystick, and event listeners.
   */
  destroy(): void {
    // Remove shift key handler
    if (this.shiftKeyHandler) {
      this.scene.input.keyboard?.off('keydown-SHIFT', this.shiftKeyHandler);
      this.shiftKeyHandler = null;
    }

    // Remove pointerdown handler
    if (this.pointerDownHandler) {
      this.scene.input.off('pointerdown', this.pointerDownHandler);
      this.pointerDownHandler = null;
    }

    // Clean up joystick manager
    if (this.joystickManager) {
      this.joystickManager.destroy();
      this.joystickManager = null;
    }

    // Remove focus/visibility change handlers
    if (this.handleVisibilityChange) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.handleVisibilityChange = null;
    }
    if (this.handleWindowBlur) {
      window.removeEventListener('blur', this.handleWindowBlur);
      this.handleWindowBlur = null;
    }
  }

  /**
   * Creates InputState with cursor keys, WASD, mouse tracking, and
   * registers pointer handler for click-to-move and shift for dash.
   */
  private setupInput(): void {
    const keyboard = this.scene.input.keyboard!;

    this.inputState = {
      cursors: keyboard.createCursorKeys(),
      wasd: {
        W: keyboard.addKey('W'),
        A: keyboard.addKey('A'),
        S: keyboard.addKey('S'),
        D: keyboard.addKey('D'),
      },
      joystickX: 0,
      joystickY: 0,
      mouseX: 0,
      mouseY: 0,
      mouseActive: false,
      controlMode: 'keyboard',
      clickTargetX: 0,
      clickTargetY: 0,
      hasClickTarget: false,
    };

    // Point-and-click movement: click to set destination
    this.pointerDownHandler = (pointer: Phaser.Input.Pointer) => {
      // Ignore touch input (handled by joystick) and UI interactions
      if (pointer.wasTouch) return;

      this.inputState.clickTargetX = pointer.worldX;
      this.inputState.clickTargetY = pointer.worldY;
      this.inputState.hasClickTarget = true;
      this.inputState.controlMode = 'mouse';
    };
    this.scene.input.on('pointerdown', this.pointerDownHandler);

    // Shift key for dash ability — store reference for cleanup
    this.shiftKeyHandler = () => {
      // Dash is triggered externally via tryDash() from GameScene,
      // which passes playerX/playerY. We emit through the scene event system.
      this.scene.events.emit('input-dash-requested');
    };
    keyboard.on('keydown-SHIFT', this.shiftKeyHandler);

    // Create virtual joystick for touch input
    this.joystickManager = new JoystickManager(this.scene);
  }

  /**
   * Registers document visibilitychange and window blur handlers
   * to auto-pause when the user switches away.
   */
  private setupFocusLossHandlers(): void {
    this.handleVisibilityChange = () => {
      if (document.hidden) {
        this.options.onFocusLost();
      }
    };
    this.handleWindowBlur = () => {
      this.options.onFocusLost();
    };

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('blur', this.handleWindowBlur);
  }
}
