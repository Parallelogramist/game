/**
 * JoystickManager.ts
 *
 * Dynamic virtual joystick for mobile/touch devices.
 * Spawns at touch point, follows finger, disappears on release.
 * Outputs normalized direction vector for InputSystem.
 */

import Phaser from 'phaser';

// Configuration
const JOYSTICK_BASE_RADIUS = 70;
const JOYSTICK_KNOB_RADIUS = 32;
const JOYSTICK_DEAD_ZONE = 10;
const JOYSTICK_ALPHA = 0.7;
const JOYSTICK_DEPTH = 999;

interface JoystickState {
  active: boolean;
  baseX: number;
  baseY: number;
  directionX: number;
  directionY: number;
}

export class JoystickManager {
  private scene: Phaser.Scene;
  private baseCircle: Phaser.GameObjects.Arc | null = null;
  private knobCircle: Phaser.GameObjects.Arc | null = null;
  private baseShadow: Phaser.GameObjects.Arc | null = null;
  private knobShadow: Phaser.GameObjects.Arc | null = null;
  private activePointerId: number = -1;
  private enabled: boolean = true;

  private state: JoystickState = {
    active: false,
    baseX: 0,
    baseY: 0,
    directionX: 0,
    directionY: 0,
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.setupPointerEvents();
  }

  private setupPointerEvents(): void {
    this.scene.input.on('pointerdown', this.onPointerDown, this);
    this.scene.input.on('pointermove', this.onPointerMove, this);
    this.scene.input.on('pointerup', this.onPointerUp, this);
    this.scene.input.on('pointerupoutside', this.onPointerUp, this);
    // Reset joystick when pointer leaves the game canvas entirely
    this.scene.input.on('gameout', this.onGameOut, this);
  }

  private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
    const hitObjects = this.scene.input.hitTestPointer(pointer);
    return hitObjects.some((obj) => {
      const gameObj = obj as Phaser.GameObjects.GameObject;
      return gameObj.input?.enabled;
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // Only respond to touch input — mouse clicks are used for cursor-follow movement
    if (!pointer.wasTouch) return;
    // Don't spawn joystick when disabled (pause, game over, overlays)
    if (!this.enabled) return;

    // If joystick is already active from a stale pointer (missed pointerup),
    // force-reset it and start fresh with this new touch
    if (this.state.active) {
      this.hideJoystick();
    }

    if (this.isPointerOverUI(pointer)) return;

    this.activePointerId = pointer.id;
    this.spawnJoystick(pointer.x, pointer.y);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.state.active || pointer.id !== this.activePointerId) return;
    this.updateKnobPosition(pointer.x, pointer.y);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.state.active) return;
    // Accept pointerup from the active pointer, OR from any touch if active pointer
    // seems stale (handles cases where pointer ID changes between down and up)
    if (pointer.id !== this.activePointerId && pointer.wasTouch) {
      // Only reset if no other pointer is currently down
      const activePointers = this.scene.input.manager?.pointers?.filter(
        (p: Phaser.Input.Pointer) => p.isDown && p.wasTouch
      );
      if (!activePointers || activePointers.length === 0) {
        this.hideJoystick();
      }
      return;
    }
    if (pointer.id !== this.activePointerId) return;
    this.hideJoystick();
  }

  private onGameOut(): void {
    // Pointer left the game canvas — reset joystick to prevent stuck state
    if (this.state.active) {
      this.hideJoystick();
    }
  }

  private spawnJoystick(x: number, y: number): void {
    this.state.active = true;
    this.state.baseX = x;
    this.state.baseY = y;
    this.state.directionX = 0;
    this.state.directionY = 0;

    // Create shadow behind base for contrast against light backgrounds
    this.baseShadow = this.scene.add.circle(x + 2, y + 2, JOYSTICK_BASE_RADIUS, 0x000000, 0.3);
    this.baseShadow.setDepth(JOYSTICK_DEPTH - 1);
    this.baseShadow.setScrollFactor(0);

    // Create base circle (outer ring)
    this.baseCircle = this.scene.add.circle(x, y, JOYSTICK_BASE_RADIUS, 0xffffff, 0.22);
    this.baseCircle.setStrokeStyle(3, 0xffffff, JOYSTICK_ALPHA);
    this.baseCircle.setDepth(JOYSTICK_DEPTH);
    this.baseCircle.setScrollFactor(0);

    // Create shadow behind knob for contrast
    this.knobShadow = this.scene.add.circle(x + 2, y + 2, JOYSTICK_KNOB_RADIUS, 0x000000, 0.3);
    this.knobShadow.setDepth(JOYSTICK_DEPTH);
    this.knobShadow.setScrollFactor(0);

    // Create knob circle (inner thumb)
    this.knobCircle = this.scene.add.circle(x, y, JOYSTICK_KNOB_RADIUS, 0xffffff, JOYSTICK_ALPHA);
    this.knobCircle.setDepth(JOYSTICK_DEPTH + 1);
    this.knobCircle.setScrollFactor(0);
  }

  private updateKnobPosition(pointerX: number, pointerY: number): void {
    if (!this.knobCircle) return;

    const deltaX = pointerX - this.state.baseX;
    const deltaY = pointerY - this.state.baseY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Calculate max radius for knob movement
    const maxRadius = JOYSTICK_BASE_RADIUS - JOYSTICK_KNOB_RADIUS;

    // Clamp knob position within the base circle
    let clampedX = deltaX;
    let clampedY = deltaY;

    if (distance > maxRadius) {
      const scale = maxRadius / distance;
      clampedX = deltaX * scale;
      clampedY = deltaY * scale;
    }

    // Update knob visual position (and shadow)
    const knobX = this.state.baseX + clampedX;
    const knobY = this.state.baseY + clampedY;
    this.knobCircle.setPosition(knobX, knobY);
    if (this.knobShadow) {
      this.knobShadow.setPosition(knobX + 2, knobY + 2);
    }

    // Calculate normalized direction (-1 to 1)
    if (distance > JOYSTICK_DEAD_ZONE) {
      this.state.directionX = clampedX / maxRadius;
      this.state.directionY = clampedY / maxRadius;
    } else {
      this.state.directionX = 0;
      this.state.directionY = 0;
    }
  }

  private hideJoystick(): void {
    this.state.active = false;
    this.state.directionX = 0;
    this.state.directionY = 0;
    this.activePointerId = -1;

    if (this.baseShadow) {
      this.baseShadow.destroy();
      this.baseShadow = null;
    }
    if (this.baseCircle) {
      this.baseCircle.destroy();
      this.baseCircle = null;
    }
    if (this.knobShadow) {
      this.knobShadow.destroy();
      this.knobShadow = null;
    }
    if (this.knobCircle) {
      this.knobCircle.destroy();
      this.knobCircle = null;
    }
  }

  /**
   * Enable or disable joystick spawning.
   * When disabled, hides any active joystick and ignores new touches.
   * Call setEnabled(false) during pause, game over, and overlay screens.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.state.active) {
      this.hideJoystick();
    }
  }

  /**
   * Get the current joystick direction vector.
   * Returns {x: 0, y: 0} if joystick is not active.
   */
  getDirection(): { x: number; y: number } {
    return {
      x: this.state.directionX,
      y: this.state.directionY,
    };
  }

  /**
   * Check if joystick is currently active.
   */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * Clean up resources and remove event listeners.
   */
  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointerupoutside', this.onPointerUp, this);
    this.scene.input.off('gameout', this.onGameOut, this);
    this.hideJoystick();
  }
}
