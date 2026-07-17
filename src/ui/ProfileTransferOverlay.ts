import { copyTextToClipboard } from '../utils/Clipboard';
import {
  applyProfilePayload, decodeProfileBlob, describeProfile, exportProfileBlob, saveLastExportAt,
} from '../storage';
import type { ProfilePayload } from '../storage';

const COLOR_PRIMARY = '#66bbff';
const COLOR_MUTED_TEXT = '#a0a8b8';
const COLOR_DANGER = '#ff5566';
const COLOR_MUTED_BORDER = '#4a5468';
const TITLE_FONT = '"Rajdhani", "Atkinson Hyperlegible", Arial, sans-serif';
const BODY_FONT = '"Atkinson Hyperlegible", Arial, sans-serif';

function buildBackdrop(): HTMLDivElement {
  const backdrop = document.createElement('div');
  backdrop.style.position = 'fixed';
  backdrop.style.inset = '0';
  backdrop.style.zIndex = '150';
  backdrop.style.background = 'rgba(0, 0, 0, 0.85)';
  backdrop.style.display = 'flex';
  backdrop.style.alignItems = 'center';
  backdrop.style.justifyContent = 'center';
  return backdrop;
}

function buildPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '12px';
  panel.style.maxWidth = '420px';
  panel.style.width = '90%';
  panel.style.padding = '20px';
  panel.style.boxSizing = 'border-box';
  panel.style.background = 'rgba(0, 0, 8, 0.94)';
  panel.style.border = `1.5px solid ${COLOR_MUTED_BORDER}`;
  panel.style.borderRadius = '8px';
  panel.style.color = '#f2f6ff';
  return panel;
}

function buildTitle(text: string, color: string): HTMLDivElement {
  const title = document.createElement('div');
  title.textContent = text;
  title.style.fontFamily = TITLE_FONT;
  title.style.fontWeight = '700';
  title.style.fontSize = '18px';
  title.style.letterSpacing = '2px';
  title.style.color = color;
  return title;
}

function buildBody(text: string): HTMLDivElement {
  const body = document.createElement('div');
  body.textContent = text;
  body.style.fontFamily = BODY_FONT;
  body.style.fontSize = '13px';
  body.style.color = COLOR_MUTED_TEXT;
  return body;
}

function buildTextarea(readonly: boolean, placeholder?: string): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.readOnly = readonly;
  if (placeholder) textarea.placeholder = placeholder;
  textarea.style.width = '100%';
  textarea.style.height = '120px';
  textarea.style.fontFamily = 'monospace';
  textarea.style.fontSize = '11px';
  textarea.style.boxSizing = 'border-box';
  textarea.style.background = 'rgba(255, 255, 255, 0.05)';
  textarea.style.color = '#f2f6ff';
  textarea.style.border = `1.5px solid ${COLOR_MUTED_BORDER}`;
  textarea.style.borderRadius = '6px';
  textarea.style.padding = '8px';
  textarea.style.resize = 'none';
  return textarea;
}

function buildButton(label: string, variant: 'primary' | 'muted' | 'danger'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.fontFamily = TITLE_FONT;
  button.style.fontWeight = '700';
  button.style.fontSize = '14px';
  button.style.letterSpacing = '2px';
  button.style.borderRadius = '6px';
  button.style.padding = '10px 16px';
  button.style.cursor = 'pointer';
  button.style.background = 'none';
  if (variant === 'primary') {
    button.style.color = COLOR_PRIMARY;
    button.style.border = `1.5px solid ${COLOR_PRIMARY}`;
  } else if (variant === 'danger') {
    button.style.color = COLOR_DANGER;
    button.style.border = `1.5px solid ${COLOR_DANGER}`;
  } else {
    button.style.color = COLOR_MUTED_TEXT;
    button.style.border = `1.5px solid ${COLOR_MUTED_BORDER}`;
  }
  return button;
}

function buildButtonRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '10px';
  row.style.flexWrap = 'wrap';
  return row;
}

function renderExportPanel(panel: HTMLDivElement, opts: {
  blobText: string;
  onExported: () => void;
  teardown: () => void;
  onClose: () => void;
}): void {
  panel.replaceChildren();
  panel.appendChild(buildTitle('PROFILE EXPORT', COLOR_PRIMARY));
  panel.appendChild(buildBody('Save this code somewhere safe. It restores your progress on any device.'));

  const textarea = buildTextarea(true);
  textarea.value = opts.blobText;
  textarea.onfocus = () => textarea.select();
  panel.appendChild(textarea);

  const row = buildButtonRow();

  const downloadButton = buildButton('DOWNLOAD FILE', 'primary');
  downloadButton.addEventListener('click', () => {
    const blob = new Blob([opts.blobText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pew-pew-survivor-profile-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    opts.onExported();
  });
  row.appendChild(downloadButton);

  const copyButton = buildButton('COPY', 'muted');
  copyButton.addEventListener('click', async () => {
    const copied = await copyTextToClipboard(opts.blobText);
    copyButton.textContent = copied ? 'COPIED' : 'COPY FAILED';
    // A failed copy is not a backup.
    if (copied) opts.onExported();
    setTimeout(() => {
      copyButton.textContent = 'COPY';
    }, 2000);
  });
  row.appendChild(copyButton);

  const closeButton = buildButton('CLOSE', 'muted');
  closeButton.addEventListener('click', () => {
    opts.teardown();
    opts.onClose();
  });
  row.appendChild(closeButton);

  panel.appendChild(row);
}

export function showProfileExportOverlay(opts: {
  blobText: string;
  onExported: () => void;
  onClose: () => void;
}): () => void {
  const backdrop = buildBackdrop();
  const panel = buildPanel();

  const teardown = (): void => {
    if (backdrop.isConnected) backdrop.remove();
  };

  renderExportPanel(panel, {
    blobText: opts.blobText,
    onExported: opts.onExported,
    teardown,
    onClose: opts.onClose,
  });

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  return teardown;
}

export function showBackupReminderOverlay(opts: {
  runsCompleted: number;
  onClose: () => void;
}): () => void {
  const backdrop = buildBackdrop();
  const panel = buildPanel();

  const teardown = (): void => {
    if (backdrop.isConnected) backdrop.remove();
  };

  panel.appendChild(buildTitle('BACK UP YOUR PROGRESS', COLOR_DANGER));
  panel.appendChild(buildBody(
    `${opts.runsCompleted} runs of progress live only in this browser's storage. `
    + 'Clearing site data — or leaving the game unopened for a week on iPhone — can erase it for good. '
    + 'A backup takes one tap and restores on any device.',
  ));

  const row = buildButtonRow();

  const backUpButton = buildButton('BACK UP NOW', 'primary');
  backUpButton.addEventListener('click', async () => {
    backUpButton.disabled = true;
    const exportedAt = Date.now();
    const blobText = await exportProfileBlob(exportedAt);
    renderExportPanel(panel, {
      blobText,
      onExported: () => saveLastExportAt(exportedAt),
      teardown,
      onClose: opts.onClose,
    });
  });
  row.appendChild(backUpButton);

  const laterButton = buildButton('NOT NOW', 'muted');
  laterButton.addEventListener('click', () => {
    teardown();
    opts.onClose();
  });
  row.appendChild(laterButton);

  panel.appendChild(row);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  return teardown;
}

export function showProfileImportOverlay(onImported: () => void, onClose: () => void): () => void {
  const backdrop = buildBackdrop();
  const panel = buildPanel();

  const teardown = (): void => {
    if (backdrop.isConnected) backdrop.remove();
  };

  let pastedText = '';

  function renderPasteState(): void {
    panel.replaceChildren();
    panel.appendChild(buildTitle('PROFILE IMPORT', COLOR_PRIMARY));
    panel.appendChild(buildBody('Paste your profile code, or load it from a file.'));

    const textarea = buildTextarea(false, 'PEWSAVE1:...');
    textarea.value = pastedText;
    textarea.addEventListener('input', () => {
      pastedText = textarea.value;
    });
    panel.appendChild(textarea);

    const statusLine = document.createElement('div');
    statusLine.style.fontFamily = BODY_FONT;
    statusLine.style.fontSize = '12px';
    statusLine.style.color = COLOR_DANGER;
    statusLine.style.minHeight = '16px';
    panel.appendChild(statusLine);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt,text/plain';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      pastedText = await file.text();
      textarea.value = pastedText;
    });
    panel.appendChild(fileInput);

    const row = buildButtonRow();

    const chooseFileButton = buildButton('CHOOSE FILE', 'muted');
    chooseFileButton.addEventListener('click', () => fileInput.click());
    row.appendChild(chooseFileButton);

    const continueButton = buildButton('CONTINUE', 'primary');
    continueButton.addEventListener('click', async () => {
      continueButton.disabled = true;
      const result = await decodeProfileBlob(textarea.value);
      if (result.ok) {
        renderConfirmState(result.payload);
        return;
      }
      statusLine.textContent = result.error;
      continueButton.disabled = false;
    });
    row.appendChild(continueButton);

    const cancelButton = buildButton('CANCEL', 'muted');
    cancelButton.addEventListener('click', () => {
      teardown();
      onClose();
    });
    row.appendChild(cancelButton);

    panel.appendChild(row);
  }

  function renderConfirmState(payload: ProfilePayload): void {
    panel.replaceChildren();
    panel.appendChild(buildTitle('OVERWRITE THIS DEVICE?', COLOR_DANGER));

    const summary = document.createElement('div');
    summary.textContent = describeProfile(payload);
    summary.style.fontFamily = BODY_FONT;
    summary.style.fontSize = '13px';
    summary.style.color = COLOR_PRIMARY;
    panel.appendChild(summary);

    panel.appendChild(buildBody(
      'This replaces ALL progress on this device — gold, upgrades, unlocks, achievements and settings. This cannot be undone.',
    ));

    const row = buildButtonRow();

    const overwriteButton = buildButton('OVERWRITE', 'danger');
    overwriteButton.addEventListener('click', async () => {
      overwriteButton.disabled = true;
      await applyProfilePayload(payload);
      onImported();
    });
    row.appendChild(overwriteButton);

    const cancelButton = buildButton('CANCEL', 'muted');
    cancelButton.addEventListener('click', () => renderPasteState());
    row.appendChild(cancelButton);

    panel.appendChild(row);
  }

  renderPasteState();
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  return teardown;
}
