/**
 * DisplayText — sharp heading/label text for the neon-tech UI.
 *
 * Technical display face (Rajdhani) with wide tracking and a hairline dark
 * stroke — enough contrast to sit over gameplay or busy panels while keeping
 * the letterforms crisp. Shared by every menu scene so headings, banners,
 * and button labels render identically.
 */

import Phaser from 'phaser';
import { DISPLAY_FONT, MENU_FONT, MENU_COLORS } from './MenuStyle';

export interface DisplayTextOptions {
  fontSize: number;
  color?: string;
  strokeWidth?: number;
  letterSpacing?: number;
  fontStyle?: string;
}

/** Create a new display-styled text object centered at (x, y). */
export function makeDisplayText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: DisplayTextOptions,
): Phaser.GameObjects.Text {
  const stroke = opts.strokeWidth ?? Math.max(1, Math.round(opts.fontSize * 0.04));
  return scene.add
    .text(x, y, text, {
      fontSize: `${opts.fontSize}px`,
      color: opts.color ?? MENU_COLORS.headingWhite,
      fontFamily: DISPLAY_FONT,
      fontStyle: opts.fontStyle ?? 'bold',
      stroke: MENU_COLORS.outline,
      strokeThickness: stroke,
      letterSpacing: opts.letterSpacing ?? 2,
    })
    .setOrigin(0.5);
}

/** Apply display styling to an existing text object (in-place). */
export function applyDisplayStyle(
  textObj: Phaser.GameObjects.Text,
  opts: DisplayTextOptions,
): void {
  const stroke = opts.strokeWidth ?? Math.max(1, Math.round(opts.fontSize * 0.04));
  textObj.setStyle({
    fontSize: `${opts.fontSize}px`,
    color: opts.color ?? MENU_COLORS.headingWhite,
    fontFamily: DISPLAY_FONT,
    fontStyle: opts.fontStyle ?? 'bold',
    stroke: MENU_COLORS.outline,
    strokeThickness: stroke,
    letterSpacing: opts.letterSpacing ?? 2,
  });
}

/** Create a body-text style (no stroke), used for descriptions inside cards. */
export function makeBodyText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { fontSize: number; color?: string; fontStyle?: string; align?: 'left' | 'center' | 'right'; wordWrapWidth?: number },
): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, {
    fontSize: `${opts.fontSize}px`,
    color: opts.color ?? MENU_COLORS.textBody,
    fontFamily: MENU_FONT,
    fontStyle: opts.fontStyle ?? 'normal',
    align: opts.align ?? 'center',
    wordWrap: opts.wordWrapWidth ? { width: opts.wordWrapWidth, useAdvancedWrap: true } : undefined,
  });
  return t.setOrigin(opts.align === 'left' ? 0 : opts.align === 'right' ? 1 : 0.5, 0.5);
}
