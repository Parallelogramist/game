/**
 * StickerText — Balatro-style sticker label.
 *
 * Bold sans-serif with a tight black outline. Reads as a punchy banner label
 * without sacrificing legibility. Deliberately does NOT pull in the
 * Bangers/comic display font; that face mangles short glyphs (W, S, M) at
 * the small banner sizes used here.
 *
 * Originally inlined in BootScene as `makeStickerText`; extracted so
 * UpgradeScene, ShopScene, PauseMenu, etc. share the exact same look.
 */

import Phaser from 'phaser';
import { MENU_FONT, MENU_COLORS } from './MenuStyle';

export interface StickerTextOptions {
  fontSize: number;
  color?: string;
  strokeWidth?: number;
  letterSpacing?: number;
  fontStyle?: string;
}

/** Create a new sticker-styled text object centered at (x, y). */
export function makeStickerText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: StickerTextOptions,
): Phaser.GameObjects.Text {
  const stroke = opts.strokeWidth ?? Math.max(2, Math.round(opts.fontSize * 0.08));
  return scene.add
    .text(x, y, text, {
      fontSize: `${opts.fontSize}px`,
      color: opts.color ?? MENU_COLORS.stickerWhite,
      fontFamily: MENU_FONT,
      fontStyle: opts.fontStyle ?? 'bold',
      stroke: MENU_COLORS.stickerBlack,
      strokeThickness: stroke,
      letterSpacing: opts.letterSpacing ?? 1.5,
    })
    .setOrigin(0.5);
}

/** Apply sticker styling to an existing text object (in-place). */
export function applyStickerStyle(
  textObj: Phaser.GameObjects.Text,
  opts: StickerTextOptions,
): void {
  const stroke = opts.strokeWidth ?? Math.max(2, Math.round(opts.fontSize * 0.08));
  textObj.setStyle({
    fontSize: `${opts.fontSize}px`,
    color: opts.color ?? MENU_COLORS.stickerWhite,
    fontFamily: MENU_FONT,
    fontStyle: opts.fontStyle ?? 'bold',
    stroke: MENU_COLORS.stickerBlack,
    strokeThickness: stroke,
    letterSpacing: opts.letterSpacing ?? 1.5,
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
