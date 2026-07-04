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
  GAMEPAD_BUTTON_X,
  GAMEPAD_DPAD_UP,
  GAMEPAD_DPAD_DOWN,
  GAMEPAD_DPAD_LEFT,
  GAMEPAD_DPAD_RIGHT,
} from './GamepadManager';
import { computeNextNavIndex, resolveHorizontalNav } from './menuNavigation';

export interface NavigableItem {
  onFocus: () => void;
  onBlur: () => void;
  onActivate: () => void;
  /**
   * Optional horizontal handlers for single-column lists: when columns is 1,
   * left/right input (arrows, A/D, D-pad, stick) is routed to the focused
   * item instead of grid navigation — segmented pills, volume rows, tab rows.
   */
  onLeft?: () => void;
  onRight?: () => void;
}

export interface MenuNavigatorConfig {
  scene: Phaser.Scene;
  items: NavigableItem[];
  columns?: number;         // >1 for grid/horizontal layout. Default: 1 (vertical)
  wrap?: boolean;            // Wrap around at edges. Default: true
  onCancel?: () => void;     // B button / Escape handler
  onSecondary?: () => void;  // X (West) button — optional secondary action (e.g. lock toggle)
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
  private onSecondary: (() => void) | null;
  private selectedIndex: number;

  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private gamepadPollTimer: Phaser.Time.TimerEvent | null = null;
  private lastNavTime: number = 0;
  private previousGamepadButtons: boolean[] = new Array(16).fill(false);
  private enabled: boolean = true;

  constructor(config: MenuNavigatorConfig) {
    this.scene = config.scene;
    this.items = config.items;
    this.columns = config.columns ?? 1;
    this.wrap = config.wrap ?? true;
    this.onCancel = config.onCancel ?? null;
    this.onSecondary = config.onSecondary ?? null;
    this.selectedIndex = config.initialIndex ?? 0;

    this.setupKeyboard();
    this.setupGamepadPolling();
    this.primeGamepadButtonState();

    // Focus initial item
    if (this.items.length > 0 && this.selectedIndex < this.items.length) {
      this.items[this.selectedIndex].onFocus();
    }
  }

  /**
   * Seed edge detection with the pad's current state so a button still held
   * from the interaction that created this navigator (e.g. the A-press that
   * opened a confirmation dialog) doesn't fire a stale press edge.
   */
  private primeGamepadButtonState(): void {
    const pad = this.scene.input.gamepad?.pad1;
    if (!pad || !pad.connected) return;
    for (let i = 0; i < 16; i++) {
      const button = pad.buttons[i];
      this.previousGamepadButtons[i] = button ? button.pressed : false;
    }
  }

  private setupKeyboard(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.enabled) return;
      const key = event.key.toLowerCase();

      if (event.key === 'ArrowDown' || key === 's') {
        event.preventDefault();
        this.navigate(0, 1);
      } else if (event.key === 'ArrowUp' || key === 'w') {
        event.preventDefault();
        this.navigate(0, -1);
      } else if (event.key === 'ArrowRight' || key === 'd') {
        if (this.handleHorizontal(1)) {
          event.preventDefault();
        }
      } else if (event.key === 'ArrowLeft' || key === 'a') {
        if (this.handleHorizontal(-1)) {
          event.preventDefault();
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

  /**
   * Route a horizontal input: grid navigation in multi-column layouts, the
   * focused item's onLeft/onRight in single-column lists. Returns true when
   * the input was consumed.
   */
  private handleHorizontal(direction: -1 | 1): boolean {
    const currentItem = this.items[this.selectedIndex];
    const handler = direction === 1 ? currentItem?.onRight : currentItem?.onLeft;
    const mode = resolveHorizontalNav(this.columns, handler !== undefined);

    if (mode === 'grid') {
      this.navigate(direction, 0);
      return true;
    }
    if (mode === 'item') {
      handler!();
      return true;
    }
    return false;
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
    if (this.enabled && canRepeat) {
      const stickX = pad.leftStick.x;
      const stickY = pad.leftStick.y;

      if (currentButtons[GAMEPAD_DPAD_DOWN] || stickY > STICK_NAV_THRESHOLD) {
        this.navigate(0, 1);
        this.lastNavTime = now;
      } else if (currentButtons[GAMEPAD_DPAD_UP] || stickY < -STICK_NAV_THRESHOLD) {
        this.navigate(0, -1);
        this.lastNavTime = now;
      } else if (currentButtons[GAMEPAD_DPAD_RIGHT] || stickX > STICK_NAV_THRESHOLD) {
        if (this.handleHorizontal(1)) this.lastNavTime = now;
      } else if (currentButtons[GAMEPAD_DPAD_LEFT] || stickX < -STICK_NAV_THRESHOLD) {
        if (this.handleHorizontal(-1)) this.lastNavTime = now;
      }
    }

    // A button — activate (edge-detected: only on press, not hold)
    if (this.enabled && currentButtons[GAMEPAD_BUTTON_A] && !this.previousGamepadButtons[GAMEPAD_BUTTON_A]) {
      this.activate();
    }

    // B button — cancel (edge-detected)
    if (this.enabled && currentButtons[GAMEPAD_BUTTON_B] && !this.previousGamepadButtons[GAMEPAD_BUTTON_B]) {
      this.cancel();
    }

    // X (West) button — optional secondary action (edge-detected)
    if (this.enabled && currentButtons[GAMEPAD_BUTTON_X] && !this.previousGamepadButtons[GAMEPAD_BUTTON_X]) {
      this.onSecondary?.();
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
    const newIndex = computeNextNavIndex(
      this.selectedIndex, dx, dy, this.items.length, this.columns, this.wrap,
    );
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
   * Suspend / resume all input handling without tearing the navigator down —
   * e.g. while a modal confirmation overlay owns the input. While disabled,
   * gamepad button state keeps polling so re-enabling never fires a stale
   * press edge.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
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
