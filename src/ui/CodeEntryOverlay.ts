/**
 * A typed code field over the Phaser canvas. Share codes reach the game through the clipboard and
 * nothing else, so a code read off another screen, a screenshot or a printed page could not be
 * entered at all. Same OverlayKit chrome as the profile-transfer overlays so the two read as one
 * surface.
 */

import {
  BODY_FONT, COLOR_DANGER, COLOR_MUTED_BORDER, COLOR_PRIMARY,
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

/**
 * Returns an idempotent teardown. The overlay removes itself before it calls onSubmit or onClose,
 * so a caller's teardown handle is safe to fire again from a scene shutdown.
 */
export function showCodeEntryOverlay<T>(opts: CodeEntryOverlayOptions<T>): () => void {
  const backdrop = buildBackdrop();
  const panel = buildPanel();

  const teardown = (): void => {
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

  const row = buildButtonRow();

  const submitButton = buildButton(opts.submitLabel, 'primary');
  submitButton.addEventListener('click', submit);
  row.appendChild(submitButton);

  const cancelButton = buildButton('CANCEL', 'muted');
  cancelButton.addEventListener('click', cancel);
  row.appendChild(cancelButton);

  panel.appendChild(row);

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

  return teardown;
}
