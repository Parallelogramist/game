/**
 * MenuNavigator.ts
 *
 * Shared keyboard + gamepad navigation for menus.
 * Replaces duplicated keyboard navigation logic across all menu scenes.
 * Supports vertical lists, horizontal rows, and grid layouts.
 */

import Phaser from 'phaser';
import {
  GAMEPAD_BUTTON_A,
  GAMEPAD_BUTTON_B,
  GAMEPAD_DPAD_UP,
  GAMEPAD_DPAD_DOWN,
  GAMEPAD_DPAD_LEFT,
  GAMEPAD_DPAD_RIGHT,
} from './GamepadManager';

export interface NavigableItem {
  onFocus: () => void;
  onBlur: () => void;
  onActivate: () => void;
}

export interface MenuNavigatorConfig {
  scene: Phaser.Scene;
  items: NavigableItem[];
  columns?: number;         // >1 for grid/horizontal layout. Default: 1 (vertical)
  wrap?: boolean;            // Wrap around at edges. Default: true
  onCancel?: () => void;     // B button / Escape handler
  initialIndex?: number;     // Default: 0
}

const GAMEPAD_REPEAT_DELAY = 200; // ms between repeated D-pad/stick moves
const STICK_NAV_THRESHOLD = 0.5;  // Stick magnitude to trigger navigation

export class MenuNavigator {
  private scene: Phaser.Scene;
  private items: NavigableItem[];
  private columns: number;
  private wrap: boolean;
  private onCancel: (() => void) | null;
  private selectedIndex: number;

  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private gamepadPollTimer: Phaser.Time.TimerEvent | null = null;
  private lastNavTime: number = 0;
  private previousGamepadButtons: boolean[] = new Array(16).fill(false);

  constructor(config: MenuNavigatorConfig) {
    this.scene = config.scene;
    this.items = config.items;
    this.columns = config.columns ?? 1;
    this.wrap = config.wrap ?? true;
    this.onCancel = config.onCancel ?? null;
    this.selectedIndex = config.initialIndex ?? 0;

    this.setupKeyboard();
    this.setupGamepadPolling();

    // Focus initial item
    if (this.items.length > 0 && this.selectedIndex < this.items.length) {
      this.items[this.selectedIndex].onFocus();
    }
  }

  private setupKeyboard(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (event.key === 'ArrowDown' || key === 's') {
        event.preventDefault();
        this.navigate(0, 1);
      } else if (event.key === 'ArrowUp' || key === 'w') {
        event.preventDefault();
        this.navigate(0, -1);
      } else if (event.key === 'ArrowRight' || key === 'd') {
        if (this.columns > 1) {
          event.preventDefault();
          this.navigate(1, 0);
        }
      } else if (event.key === 'ArrowLeft' || key === 'a') {
        if (this.columns > 1) {
          event.preventDefault();
          this.navigate(-1, 0);
        }
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        this.activate();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      }
    };
    this.scene.input.keyboard?.on('keydown', this.keydownHandler);
  }

  private setupGamepadPolling(): void {
    this.gamepadPollTimer = this.scene.time.addEvent({
      delay: 16, // ~60fps polling
      loop: true,
      callback: this.pollGamepad,
      callbackScope: this,
    });
  }

  private pollGamepad(): void {
    const pad = this.scene.input.gamepad?.pad1;
    if (!pad || !pad.connected) return;

    const now = Date.now();
    const canRepeat = now - this.lastNavTime >= GAMEPAD_REPEAT_DELAY;

    // Read current button states for edge detection
    const currentButtons: boolean[] = [];
    for (let i = 0; i < 16; i++) {
      const button = pad.buttons[i];
      currentButtons[i] = button ? button.pressed : false;
    }

    // D-pad navigation (with repeat delay)
    if (canRepeat) {
      const stickX = pad.leftStick.x;
      const stickY = pad.leftStick.y;

      if (currentButtons[GAMEPAD_DPAD_DOWN] || stickY > STICK_NAV_THRESHOLD) {
        this.navigate(0, 1);
        this.lastNavTime = now;
      } else if (currentButtons[GAMEPAD_DPAD_UP] || stickY < -STICK_NAV_THRESHOLD) {
        this.navigate(0, -1);
        this.lastNavTime = now;
      } else if (this.columns > 1 && (currentButtons[GAMEPAD_DPAD_RIGHT] || stickX > STICK_NAV_THRESHOLD)) {
        this.navigate(1, 0);
        this.lastNavTime = now;
      } else if (this.columns > 1 && (currentButtons[GAMEPAD_DPAD_LEFT] || stickX < -STICK_NAV_THRESHOLD)) {
        this.navigate(-1, 0);
        this.lastNavTime = now;
      }
    }

    // A button — activate (edge-detected: only on press, not hold)
    if (currentButtons[GAMEPAD_BUTTON_A] && !this.previousGamepadButtons[GAMEPAD_BUTTON_A]) {
      this.activate();
    }

    // B button — cancel (edge-detected)
    if (currentButtons[GAMEPAD_BUTTON_B] && !this.previousGamepadButtons[GAMEPAD_BUTTON_B]) {
      this.cancel();
    }

    // Update previous state
    for (let i = 0; i < 16; i++) {
      this.previousGamepadButtons[i] = currentButtons[i];
    }
  }

  /**
   * Navigate by delta in x/y grid coordinates.
   * For vertical lists (columns=1), only dy matters.
   */
  private navigate(dx: number, dy: number): void {
    if (this.items.length === 0) return;

    const columns = this.columns;
    const totalItems = this.items.length;

    // Calculate current row/col
    const currentCol = this.selectedIndex % columns;
    const currentRow = Math.floor(this.selectedIndex / columns);
    const totalRows = Math.ceil(totalItems / columns);

    let newCol = currentCol + dx;
    let newRow = currentRow + dy;

    if (this.wrap) {
      newCol = ((newCol % columns) + columns) % columns;
      newRow = ((newRow % totalRows) + totalRows) % totalRows;
    } else {
      newCol = Math.max(0, Math.min(columns - 1, newCol));
      newRow = Math.max(0, Math.min(totalRows - 1, newRow));
    }

    let newIndex = newRow * columns + newCol;

    // Clamp to valid range (last row may not be full)
    if (newIndex >= totalItems) {
      newIndex = totalItems - 1;
    }

    if (newIndex !== this.selectedIndex) {
      this.selectIndex(newIndex);
    }
  }

  private activate(): void {
    if (this.items.length > 0 && this.selectedIndex < this.items.length) {
      this.items[this.selectedIndex].onActivate();
    }
  }

  private cancel(): void {
    if (this.onCancel) {
      this.onCancel();
    }
  }

  /**
   * Programmatically change the selected index.
   */
  selectIndex(index: number): void {
    if (index < 0 || index >= this.items.length) return;

    // Blur previous
    if (this.selectedIndex >= 0 && this.selectedIndex < this.items.length) {
      this.items[this.selectedIndex].onBlur();
    }

    this.selectedIndex = index;

    // Focus new
    this.items[this.selectedIndex].onFocus();
  }

  /**
   * Get the current selected index.
   */
  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /**
   * Replace the items list (e.g., when switching shop tabs).
   * Resets selection to 0 (or provided index).
   */
  setItems(items: NavigableItem[], initialIndex?: number): void {
    // Blur current
    if (this.items.length > 0 && this.selectedIndex < this.items.length) {
      this.items[this.selectedIndex].onBlur();
    }

    this.items = items;
    this.selectedIndex = initialIndex ?? 0;

    // Focus new
    if (this.items.length > 0 && this.selectedIndex < this.items.length) {
      this.items[this.selectedIndex].onFocus();
    }
  }

  /**
   * Update the number of columns (e.g., when grid layout changes).
   */
  setColumns(columns: number): void {
    this.columns = columns;
  }

  /**
   * Clean up keyboard listener and gamepad polling timer.
   */
  destroy(): void {
    if (this.keydownHandler) {
      this.scene.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.gamepadPollTimer) {
      this.gamepadPollTimer.remove();
      this.gamepadPollTimer = null;
    }
  }
}
