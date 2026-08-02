/**
 * A pad-driven focus ring over a DOM overlay panel's buttons.
 *
 * Every caller of these overlays stands its own input down while one is up (BootScene and
 * SettingsScene both call `menuNavigator.setEnabled(false)`), and the overlays themselves bind
 * nothing but `click`. A pad-only player therefore met a full-screen backdrop with no reachable
 * control and no way back to the menu. Keyboard players were never stuck: a bare <button> is
 * natively tabbable and answers Enter.
 *
 * Two invariants this leans on, both true of every panel built from OverlayKit:
 *  - every <button> inside the panel is one of the row's actions, so the ring can just query for
 *    them and needs no registration. CodeEntryOverlay's 54-key grid is why that overlay drives its
 *    own poll instead of this one.
 *  - the panel's dismissing action carries `markPadCancel`, so B is bound without positional magic
 *    and survives the panels that re-render themselves.
 */

import {
  GAMEPAD_BUTTON_A, GAMEPAD_BUTTON_B,
  GAMEPAD_DPAD_DOWN, GAMEPAD_DPAD_LEFT, GAMEPAD_DPAD_RIGHT, GAMEPAD_DPAD_UP,
} from '../input/GamepadManager';
import { BODY_FONT, COLOR_MUTED_TEXT, COLOR_PRIMARY } from './OverlayKit';

type PadStep = 'previous' | 'next';

const PAD_BUTTON_COUNT = 16;
const PAD_STICK_THRESHOLD = 0.5;
const PAD_REPEAT_DELAY_MS = 400;
const PAD_REPEAT_INTERVAL_MS = 110;

/** Marks the button B presses and the button the ring opens on. Returns it, so it can wrap a
 *  `buildButton` call in place. */
export function markPadCancel(button: HTMLButtonElement): HTMLButtonElement {
  button.dataset.padCancel = '1';
  return button;
}

function connectedPad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const candidate of pads) {
    if (candidate && candidate.connected) return candidate;
  }
  return null;
}

function stepIndex(index: number, step: PadStep, length: number): number {
  return step === 'previous' ? (index + length - 1) % length : (index + 1) % length;
}

/**
 * Returns an idempotent detach. The overlay's own teardown must call it: the ring holds a
 * requestAnimationFrame loop that would otherwise outlive the panel.
 */
export function attachOverlayPadFocus(panel: HTMLElement): () => void {
  let ringVisible = false;
  let focusedIndex = 0;
  let paintedButton: HTMLButtonElement | null = null;
  let lastFirstButton: HTMLButtonElement | null = null;
  let heldStep: PadStep | null = null;
  let nextRepeatAt = 0;
  let pollHandle = 0;
  const previousButtons: boolean[] = new Array<boolean>(PAD_BUTTON_COUNT).fill(false);

  const hint = document.createElement('div');
  hint.style.fontFamily = BODY_FONT;
  hint.style.fontSize = '11px';
  hint.style.letterSpacing = '1px';
  hint.style.color = COLOR_MUTED_TEXT;
  hint.textContent = 'A SELECT   B BACK';

  const liveButtons = (): HTMLButtonElement[] =>
    [...panel.querySelectorAll('button')].filter((button) => !button.disabled);

  const applyFocusStyle = (button: HTMLButtonElement): void => {
    // An outline rather than a border colour, so the primary/muted/danger variant stays readable.
    button.style.outline = `2px solid ${COLOR_PRIMARY}`;
    button.style.outlineOffset = '2px';
    button.style.background = 'rgba(102, 187, 255, 0.18)';
  };

  const clearFocusStyle = (button: HTMLButtonElement): void => {
    button.style.outline = '';
    button.style.outlineOffset = '';
    // buildButton's own value, so restoring is exact rather than remembered per variant.
    button.style.background = 'none';
  };

  const paint = (button: HTMLButtonElement | null): void => {
    if (paintedButton === button) return;
    if (paintedButton !== null && paintedButton.isConnected) clearFocusStyle(paintedButton);
    if (button !== null) applyFocusStyle(button);
    paintedButton = button;
  };

  const openingIndex = (buttons: readonly HTMLButtonElement[]): number => {
    // The ring opens on the safe exit: these modals raise themselves, and one of them is an
    // OVERWRITE that erases the profile.
    const cancelIndex = buttons.findIndex((button) => button.dataset.padCancel === '1');
    return cancelIndex === -1 ? 0 : cancelIndex;
  };

  const detach = (): void => {
    if (pollHandle !== 0) {
      cancelAnimationFrame(pollHandle);
      pollHandle = 0;
    }
    paint(null);
    if (hint.isConnected) hint.remove();
  };

  const pollPad = (): void => {
    pollHandle = requestAnimationFrame(pollPad);
    if (!panel.isConnected) return;

    const pad = connectedPad();
    if (pad === null) {
      previousButtons.fill(false);
      heldStep = null;
      return;
    }

    const isDown = (index: number): boolean => pad.buttons[index]?.pressed === true;
    const justPressed = (index: number): boolean => isDown(index) && !previousButtons[index];
    const snapshot = (): void => {
      for (let index = 0; index < PAD_BUTTON_COUNT; index++) previousButtons[index] = isDown(index);
    };

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    let step: PadStep | null = null;
    if (isDown(GAMEPAD_DPAD_LEFT) || isDown(GAMEPAD_DPAD_UP)
      || axisX <= -PAD_STICK_THRESHOLD || axisY <= -PAD_STICK_THRESHOLD) {
      step = 'previous';
    } else if (isDown(GAMEPAD_DPAD_RIGHT) || isDown(GAMEPAD_DPAD_DOWN)
      || axisX >= PAD_STICK_THRESHOLD || axisY >= PAD_STICK_THRESHOLD) {
      step = 'next';
    }

    const buttons = liveButtons();
    if (buttons.length === 0) {
      paint(null);
      snapshot();
      return;
    }
    // Two of these panels replace their own children (the export panel, the import confirmation),
    // so a changed first button is the re-render, and the ring reopens on the safe exit.
    if (buttons[0] !== lastFirstButton) {
      lastFirstButton = buttons[0];
      focusedIndex = openingIndex(buttons);
    }
    if (focusedIndex >= buttons.length) focusedIndex = buttons.length - 1;

    if (!ringVisible) {
      // The input that reveals the ring is consumed: pressing A to find out whether the pad does
      // anything here must not also fire a button.
      if (step !== null || justPressed(GAMEPAD_BUTTON_A) || justPressed(GAMEPAD_BUTTON_B)) {
        ringVisible = true;
        heldStep = step;
        nextRepeatAt = performance.now() + PAD_REPEAT_DELAY_MS;
        paint(buttons[focusedIndex]);
        snapshot();
      }
      return;
    }

    if (!hint.isConnected) panel.appendChild(hint);

    const now = performance.now();
    if (step === null) {
      heldStep = null;
    } else if (step !== heldStep) {
      heldStep = step;
      nextRepeatAt = now + PAD_REPEAT_DELAY_MS;
      focusedIndex = stepIndex(focusedIndex, step, buttons.length);
    } else if (now >= nextRepeatAt) {
      nextRepeatAt = now + PAD_REPEAT_INTERVAL_MS;
      focusedIndex = stepIndex(focusedIndex, step, buttons.length);
    }
    paint(buttons[focusedIndex]);

    // A click can tear this overlay down synchronously, so the snapshot is taken first and nothing
    // touches local state after the click.
    if (justPressed(GAMEPAD_BUTTON_B)) {
      const cancelButton = panel.querySelector<HTMLButtonElement>('button[data-pad-cancel]');
      snapshot();
      if (cancelButton !== null && !cancelButton.disabled) cancelButton.click();
      return;
    }
    if (justPressed(GAMEPAD_BUTTON_A)) {
      const chosen = buttons[focusedIndex];
      snapshot();
      chosen.click();
      return;
    }

    snapshot();
  };

  pollHandle = requestAnimationFrame(pollPad);
  return detach;
}
