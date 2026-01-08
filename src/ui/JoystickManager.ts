/**
 * JoystickManager.ts
 *
 * Dynamic virtual joystick for mobile/touch devices.
 * Spawns at touch point, follows finger, disappears on release.
 * Outputs normalized direction vector for InputSystem.
 */

import Phaser from 'phaser';

// Configuration
const JOYSTICK_BASE_RADIUS = 60;
const JOYSTICK_KNOB_RADIUS = 25;
const JOYSTICK_DEAD_ZONE = 10;
const JOYSTICK_ALPHA = 0.4;
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
  private activePointerId: number = -1;

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
  }

  private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
    const hitObjects = this.scene.input.hitTestPointer(pointer);
    return hitObjects.some((obj) => {
      const gameObj = obj as Phaser.GameObjects.GameObject;
      return gameObj.input?.enabled;
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // Ignore if joystick already active or pointer is over UI
    if (this.state.active) return;
    if (this.isPointerOverUI(pointer)) return;

    this.activePointerId = pointer.id;
    this.spawnJoystick(pointer.x, pointer.y);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.state.active || pointer.id !== this.activePointerId) return;
    this.updateKnobPosition(pointer.x, pointer.y);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.activePointerId) return;
    this.hideJoystick();
  }

  private spawnJoystick(x: number, y: number): void {
    this.state.active = true;
    this.state.baseX = x;
    this.state.baseY = y;
    this.state.directionX = 0;
    this.state.directionY = 0;

    // Create base circle (outer ring)
    this.baseCircle = this.scene.add.circle(x, y, JOYSTICK_BASE_RADIUS, 0xffffff, 0.15);
    this.baseCircle.setStrokeStyle(2, 0xffffff, JOYSTICK_ALPHA);
    this.baseCircle.setDepth(JOYSTICK_DEPTH);
    this.baseCircle.setScrollFactor(0);

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

    // Update knob visual position
    this.knobCircle.setPosition(this.state.baseX + clampedX, this.state.baseY + clampedY);

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

    if (this.baseCircle) {
      this.baseCircle.destroy();
      this.baseCircle = null;
    }
    if (this.knobCircle) {
      this.knobCircle.destroy();
      this.knobCircle = null;
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
    this.hideJoystick();
  }
}
