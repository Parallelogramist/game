/**
 * A typed code field over the Phaser canvas. Share codes reach the game through the clipboard and
 * nothing else, so a code read off another screen, a screenshot or a printed page could not be
 * entered at all. Same OverlayKit chrome as the profile-transfer overlays so the two read as one
 * surface.
 *
 * Every caller stands its own input down while this is up (BootScene and LoadoutScene disable their
 * MenuNavigator, MapScene returns early from update), so a pad-only player could open the field and
 * then reach neither it nor the buttons. The on-screen keyboard below is that player's only way in;
 * it stays hidden until a pad is actually used, so a mouse or keyboard player sees the overlay
 * exactly as it was.
 */

import {
  GAMEPAD_BUTTON_A, GAMEPAD_BUTTON_B, GAMEPAD_BUTTON_START, GAMEPAD_BUTTON_X, GAMEPAD_BUTTON_Y,
  GAMEPAD_DPAD_DOWN, GAMEPAD_DPAD_LEFT, GAMEPAD_DPAD_RIGHT, GAMEPAD_DPAD_UP,
} from '../input/GamepadManager';
import {
  BODY_FONT, COLOR_DANGER, COLOR_MUTED_BORDER, COLOR_MUTED_TEXT, COLOR_PRIMARY, TITLE_FONT,
  buildBackdrop, buildBody, buildButton, buildButtonRow, buildPanel, buildTitle,
} from './OverlayKit';

export type CodeEntryResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CodeEntryOverlayOptions<T> {
  title: string;
  body: string;
  placeholder: string;
  submitLabel: string;
  /**
   * A build code is base64 and case-sensitive, so a phone shifting to caps would corrupt it; the
   * base36 world code is uppercased by its own decoder and reads better in caps.
   */
  autocapitalize: 'off' | 'characters';
  decode: (typed: string) => CodeEntryResult<T>;
  onSubmit: (value: T) => void;
  onClose: () => void;
}

type PadDirection = 'up' | 'down' | 'left' | 'right';

interface PadKey {
  readonly label: string;
  /** Present on a character key; the uppercase form, lowercased when SHIFT is off. */
  readonly insert?: string;
  readonly action?: 'space' | 'shift' | 'backspace' | 'submit';
}

const KEY_COLUMNS = 10;

/** The symbols are exactly what the three consumers decode: `-` for both share-code prefixes,
 *  `+ / =` for the build code's base64, and the rest for a sector note's prose. */
const PAD_CHARACTER_ROWS: readonly string[] = [
  '1234567890',
  'QWERTYUIOP',
  'ASDFGHJKL-',
  'ZXCVBNM.,+',
  "/='!?:",
];

const PAD_ACTION_KEYS: readonly PadKey[] = [
  { label: 'SPC', action: 'space' },
  { label: 'SHIFT', action: 'shift' },
  { label: 'DEL', action: 'backspace' },
  { label: 'GO', action: 'submit' },
];

const PAD_KEYS: readonly PadKey[] = [
  ...PAD_CHARACTER_ROWS.flatMap((row) => [...row].map((char) => ({ label: char, insert: char }))),
  ...PAD_ACTION_KEYS,
];

const KEY_ROWS = PAD_KEYS.length / KEY_COLUMNS;
const SHIFT_KEY_INDEX = PAD_KEYS.findIndex((key) => key.action === 'shift');
const BACKSPACE_KEY_INDEX = PAD_KEYS.findIndex((key) => key.action === 'backspace');

const PAD_ACTED_BUTTONS: readonly number[] = [
  GAMEPAD_BUTTON_A, GAMEPAD_BUTTON_B, GAMEPAD_BUTTON_X, GAMEPAD_BUTTON_Y, GAMEPAD_BUTTON_START,
];

const PAD_BUTTON_COUNT = 16;
const PAD_STICK_THRESHOLD = 0.5;
const PAD_REPEAT_DELAY_MS = 400;
const PAD_REPEAT_INTERVAL_MS = 110;

/**
 * Returns an idempotent teardown. The overlay removes itself before it calls onSubmit or onClose,
 * so a caller's teardown handle is safe to fire again from a scene shutdown.
 */
export function showCodeEntryOverlay<T>(opts: CodeEntryOverlayOptions<T>): () => void {
  const backdrop = buildBackdrop();
  const panel = buildPanel();

  let padVisible = false;
  let shifted = opts.autocapitalize === 'characters';
  let focusedKeyIndex = KEY_COLUMNS;
  let heldDirection: PadDirection | null = null;
  let nextRepeatAt = 0;
  let pollHandle = 0;
  const previousButtons: boolean[] = new Array<boolean>(PAD_BUTTON_COUNT).fill(false);

  const teardown = (): void => {
    if (pollHandle !== 0) {
      cancelAnimationFrame(pollHandle);
      pollHandle = 0;
    }
    if (backdrop.isConnected) backdrop.remove();
  };

  panel.appendChild(buildTitle(opts.title, COLOR_PRIMARY));
  panel.appendChild(buildBody(opts.body));

  const field = document.createElement('input');
  field.type = 'text';
  field.placeholder = opts.placeholder;
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.setAttribute('autocapitalize', opts.autocapitalize);
  field.setAttribute('autocorrect', 'off');
  field.setAttribute('enterkeyhint', 'go');
  field.style.width = '100%';
  field.style.fontFamily = 'monospace';
  // 16px is the floor below which iOS Safari zooms the viewport when a field takes focus.
  field.style.fontSize = '16px';
  field.style.boxSizing = 'border-box';
  field.style.background = 'rgba(255, 255, 255, 0.05)';
  field.style.color = '#f2f6ff';
  field.style.border = `1.5px solid ${COLOR_MUTED_BORDER}`;
  field.style.borderRadius = '6px';
  field.style.padding = '10px';
  panel.appendChild(field);

  const statusLine = document.createElement('div');
  statusLine.style.fontFamily = BODY_FONT;
  statusLine.style.fontSize = '12px';
  statusLine.style.color = COLOR_DANGER;
  statusLine.style.minHeight = '16px';
  panel.appendChild(statusLine);

  const cancel = (): void => {
    teardown();
    opts.onClose();
  };

  const submit = (): void => {
    const result = opts.decode(field.value);
    if (!result.ok) {
      statusLine.textContent = result.error;
      return;
    }
    teardown();
    opts.onSubmit(result.value);
  };

  const insertText = (text: string): void => {
    field.value += text;
    field.setSelectionRange(field.value.length, field.value.length);
  };

  const pressKey = (index: number): void => {
    const key = PAD_KEYS[index];
    if (key.insert !== undefined) {
      insertText(shifted ? key.insert : key.insert.toLowerCase());
      return;
    }
    if (key.action === 'space') {
      insertText(' ');
      return;
    }
    if (key.action === 'backspace') {
      field.value = field.value.slice(0, -1);
      field.setSelectionRange(field.value.length, field.value.length);
      return;
    }
    if (key.action === 'shift') {
      shifted = !shifted;
      paintKeyLabels();
      return;
    }
    submit();
  };

  const row = buildButtonRow();

  const submitButton = buildButton(opts.submitLabel, 'primary');
  submitButton.addEventListener('click', submit);
  row.appendChild(submitButton);

  const cancelButton = buildButton('CANCEL', 'muted');
  cancelButton.addEventListener('click', cancel);
  row.appendChild(cancelButton);

  panel.appendChild(row);

  const keyboard = document.createElement('div');
  keyboard.style.display = 'none';
  keyboard.style.gridTemplateColumns = `repeat(${KEY_COLUMNS}, 1fr)`;
  keyboard.style.gap = '4px';

  const keyButtons: HTMLButtonElement[] = PAD_KEYS.map((key, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    // The field must keep focus or a physical keyboard stops typing into it mid-code, so the keys
    // are untabbable and swallow the mousedown that would otherwise take it.
    button.tabIndex = -1;
    button.textContent = key.label;
    button.style.fontFamily = TITLE_FONT;
    button.style.fontWeight = '700';
    button.style.fontSize = key.insert === undefined ? '10px' : '13px';
    button.style.padding = '8px 0';
    button.style.borderRadius = '4px';
    button.style.borderWidth = '1.5px';
    button.style.borderStyle = 'solid';
    button.style.cursor = 'pointer';
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      focusedKeyIndex = index;
      paintKeyFocus();
      pressKey(index);
    });
    keyboard.appendChild(button);
    return button;
  });

  const padHint = document.createElement('div');
  padHint.style.display = 'none';
  padHint.style.fontFamily = BODY_FONT;
  padHint.style.fontSize = '11px';
  padHint.style.letterSpacing = '1px';
  padHint.style.color = COLOR_MUTED_TEXT;
  padHint.textContent = `A TYPE   B CANCEL   X DELETE   Y SHIFT   START ${opts.submitLabel}`;

  panel.appendChild(keyboard);
  panel.appendChild(padHint);

  function paintKeyFocus(): void {
    keyButtons.forEach((button, index) => {
      const focused = index === focusedKeyIndex;
      button.style.borderColor = focused ? COLOR_PRIMARY : COLOR_MUTED_BORDER;
      button.style.background = focused ? 'rgba(102, 187, 255, 0.22)' : 'rgba(255, 255, 255, 0.04)';
      button.style.color = focused ? '#f2f6ff' : COLOR_MUTED_TEXT;
    });
  }

  function paintKeyLabels(): void {
    keyButtons.forEach((button, index) => {
      const key = PAD_KEYS[index];
      if (key.insert !== undefined) {
        button.textContent = shifted ? key.insert : key.insert.toLowerCase();
        return;
      }
      if (key.action === 'shift') button.textContent = shifted ? 'ABC' : 'abc';
    });
  }

  const revealKeyboard = (): void => {
    padVisible = true;
    keyboard.style.display = 'grid';
    padHint.style.display = 'block';
    paintKeyLabels();
    paintKeyFocus();
  };

  const moveFocus = (direction: PadDirection): void => {
    const column = focusedKeyIndex % KEY_COLUMNS;
    const rowIndex = Math.floor(focusedKeyIndex / KEY_COLUMNS);
    if (direction === 'left') {
      focusedKeyIndex = rowIndex * KEY_COLUMNS + (column + KEY_COLUMNS - 1) % KEY_COLUMNS;
    } else if (direction === 'right') {
      focusedKeyIndex = rowIndex * KEY_COLUMNS + (column + 1) % KEY_COLUMNS;
    } else if (direction === 'up') {
      focusedKeyIndex = ((rowIndex + KEY_ROWS - 1) % KEY_ROWS) * KEY_COLUMNS + column;
    } else {
      focusedKeyIndex = ((rowIndex + 1) % KEY_ROWS) * KEY_COLUMNS + column;
    }
    paintKeyFocus();
  };

  const pollPad = (): void => {
    pollHandle = requestAnimationFrame(pollPad);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }
    if (!pad) {
      previousButtons.fill(false);
      heldDirection = null;
      return;
    }

    const isDown = (index: number): boolean => pad.buttons[index]?.pressed === true;
    const justPressed = (index: number): boolean => isDown(index) && !previousButtons[index];
    const snapshot = (): void => {
      for (let index = 0; index < PAD_BUTTON_COUNT; index++) previousButtons[index] = isDown(index);
    };

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    let direction: PadDirection | null = null;
    if (isDown(GAMEPAD_DPAD_UP) || axisY <= -PAD_STICK_THRESHOLD) direction = 'up';
    else if (isDown(GAMEPAD_DPAD_DOWN) || axisY >= PAD_STICK_THRESHOLD) direction = 'down';
    else if (isDown(GAMEPAD_DPAD_LEFT) || axisX <= -PAD_STICK_THRESHOLD) direction = 'left';
    else if (isDown(GAMEPAD_DPAD_RIGHT) || axisX >= PAD_STICK_THRESHOLD) direction = 'right';

    if (!padVisible) {
      // The input that reveals the keyboard is consumed: pressing A to find out whether the pad
      // does anything here must not also type a character.
      if (direction !== null || PAD_ACTED_BUTTONS.some(justPressed)) {
        revealKeyboard();
        heldDirection = direction;
        nextRepeatAt = performance.now() + PAD_REPEAT_DELAY_MS;
        snapshot();
      }
      return;
    }

    const now = performance.now();
    if (direction === null) {
      heldDirection = null;
    } else if (direction !== heldDirection) {
      heldDirection = direction;
      nextRepeatAt = now + PAD_REPEAT_DELAY_MS;
      moveFocus(direction);
    } else if (now >= nextRepeatAt) {
      nextRepeatAt = now + PAD_REPEAT_INTERVAL_MS;
      moveFocus(direction);
    }

    if (justPressed(GAMEPAD_BUTTON_B)) {
      cancel();
      return;
    }
    if (justPressed(GAMEPAD_BUTTON_START)) {
      submit();
      return;
    }
    if (justPressed(GAMEPAD_BUTTON_A)) pressKey(focusedKeyIndex);
    else if (justPressed(GAMEPAD_BUTTON_X)) pressKey(BACKSPACE_KEY_INDEX);
    else if (justPressed(GAMEPAD_BUTTON_Y)) pressKey(SHIFT_KEY_INDEX);

    snapshot();
  };

  // The caller disables its MenuNavigator while this is up, so without these Enter and Escape do
  // nothing at all rather than falling through to the menu behind.
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  field.focus();
  pollHandle = requestAnimationFrame(pollPad);

  return teardown;
}
