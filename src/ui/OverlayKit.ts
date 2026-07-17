/**
 * Shared DOM overlay chrome. These overlays sit above the Phaser canvas
 * (profile transfer, backup nudge, install hint) and must read as one surface.
 */

export const COLOR_PRIMARY = '#66bbff';
export const COLOR_MUTED_TEXT = '#a0a8b8';
export const COLOR_DANGER = '#ff5566';
export const COLOR_MUTED_BORDER = '#4a5468';
export const TITLE_FONT = '"Rajdhani", "Atkinson Hyperlegible", Arial, sans-serif';
export const BODY_FONT = '"Atkinson Hyperlegible", Arial, sans-serif';

export function buildBackdrop(): HTMLDivElement {
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

export function buildPanel(): HTMLDivElement {
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

export function buildTitle(text: string, color: string): HTMLDivElement {
  const title = document.createElement('div');
  title.textContent = text;
  title.style.fontFamily = TITLE_FONT;
  title.style.fontWeight = '700';
  title.style.fontSize = '18px';
  title.style.letterSpacing = '2px';
  title.style.color = color;
  return title;
}

export function buildBody(text: string): HTMLDivElement {
  const body = document.createElement('div');
  body.textContent = text;
  body.style.fontFamily = BODY_FONT;
  body.style.fontSize = '13px';
  body.style.color = COLOR_MUTED_TEXT;
  return body;
}

export function buildButton(label: string, variant: 'primary' | 'muted' | 'danger'): HTMLButtonElement {
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

export function buildButtonRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '10px';
  row.style.flexWrap = 'wrap';
  return row;
}
