import { triggerInstallPrompt } from '../pwa/InstallHint';
import {
  BODY_FONT, COLOR_MUTED_TEXT, COLOR_PRIMARY,
  buildBackdrop, buildBody, buildButton, buildButtonRow, buildPanel, buildTitle,
} from './OverlayKit';

// Drawn, not emoji: every rendered glyph in this game is a drawn shape, and a
// system-font emoji would render differently (or not at all) per platform.
const SHARE_ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/><path d="M12 15V3"/><path d="M8.5 6.5 12 3l3.5 3.5"/></svg>';
const ADD_ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>';

const HINT_BODY = 'Install the game and it launches full-screen from your home screen — and plays a full run with no network at all.';

function buildStep(iconSvg: string, text: string): HTMLDivElement {
  const step = document.createElement('div');
  step.style.display = 'flex';
  step.style.alignItems = 'center';
  step.style.gap = '8px';
  step.style.fontFamily = BODY_FONT;
  step.style.fontSize = '13px';
  step.style.color = COLOR_MUTED_TEXT;

  const icon = document.createElement('span');
  icon.style.flex = '0 0 auto';
  icon.style.display = 'inline-flex';
  icon.style.color = COLOR_PRIMARY;
  icon.innerHTML = iconSvg;
  step.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = text;
  step.appendChild(label);

  return step;
}

export function showInstallHintOverlay(opts: {
  platform: 'prompt' | 'ios';
  onClose: () => void;
}): () => void {
  const backdrop = buildBackdrop();
  const panel = buildPanel();

  const teardown = (): void => {
    if (backdrop.isConnected) backdrop.remove();
  };
  const close = (): void => {
    teardown();
    opts.onClose();
  };

  if (opts.platform === 'ios') {
    panel.appendChild(buildTitle('ADD TO HOME SCREEN', COLOR_PRIMARY));
    panel.appendChild(buildBody(HINT_BODY));
    panel.appendChild(buildStep(SHARE_ICON_SVG, '1. Tap Share in the Safari toolbar.'));
    panel.appendChild(buildStep(ADD_ICON_SVG, '2. Choose "Add to Home Screen", then Add.'));

    const row = buildButtonRow();
    const gotItButton = buildButton('GOT IT', 'muted');
    gotItButton.addEventListener('click', close);
    row.appendChild(gotItButton);
    panel.appendChild(row);
  } else {
    panel.appendChild(buildTitle('INSTALL THE GAME', COLOR_PRIMARY));
    panel.appendChild(buildBody(HINT_BODY));

    const row = buildButtonRow();
    const installButton = buildButton('INSTALL', 'primary');
    installButton.addEventListener('click', async () => {
      installButton.disabled = true;
      await triggerInstallPrompt();
      close();
    });
    row.appendChild(installButton);

    const laterButton = buildButton('NOT NOW', 'muted');
    laterButton.addEventListener('click', close);
    row.appendChild(laterButton);
    panel.appendChild(row);
  }

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  return teardown;
}
