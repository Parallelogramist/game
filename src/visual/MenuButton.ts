/**
 * MenuButton — sharp flat button for menu scenes.
 *
 * Wraps a `MenuCard` with a fixed body color, optional thin banner, and a
 * display-text label. Variants: `primary` (cyan), `confirm` (safe-green),
 * `danger` (red), `neutral` (slate), `gold` (cash-out), `magenta`.
 *
 * Drop-in replacement for the dozens of ad-hoc rect+text buttons across
 * pause / shop / settings / pre-run scenes.
 */

import Phaser from 'phaser';
import { createMenuCard, MenuCard } from './MenuCard';
import { makeDisplayText } from './DisplayText';
import { ACCENT_COLORS, BODY_COLORS, MENU_COLORS, RoleColorKey } from './MenuStyle';

export type MenuButtonVariant = RoleColorKey | 'focus';

export interface MenuButtonOptions {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  variant?: MenuButtonVariant;
  /** Override body color; takes precedence over variant. */
  bodyColor?: number;
  /** Override accent color; takes precedence over variant. */
  accentColor?: number;
  /** Banner thickness (0 = no banner, body fully fills). Default 0 — pill style. */
  bannerHeight?: number;
  fontSize?: number;
  /** Label color override (otherwise heading white). */
  labelColor?: string;
  onActivate?: () => void;
}

export interface MenuButton {
  card: MenuCard;
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setLabel(text: string): void;
  setEnabled(enabled: boolean): void;
  setHoverState(hovered: boolean): void;
  setFocusState(focused: boolean): void;
  setVariant(variant: MenuButtonVariant): void;
  tickIdle(timeSeconds: number): void;
  destroy(): void;
}

export function createMenuButton(opts: MenuButtonOptions): MenuButton {
  const {
    scene,
    x,
    y,
    width,
    height,
    label,
    variant = 'neutral',
    bodyColor,
    accentColor,
    bannerHeight = 0,
    fontSize = Math.max(13, Math.round(height * 0.34)),
    labelColor,
    onActivate,
  } = opts;

  const colors = resolveVariantColors(variant);
  const finalBody = bodyColor ?? colors.body;
  const finalAccent = accentColor ?? colors.accent;

  const card = createMenuCard(scene, {
    x,
    y,
    width,
    height,
    bodyFillColor: finalBody,
    accentColor: finalAccent,
    bannerHeight,
    borderWidth: 2,
    borderColor: finalAccent,
    cornerRadius: Math.min(height * 0.22, 8),
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    shadowAlpha: 0.45,
  });

  const labelText = makeDisplayText(scene, 0, 0, label, {
    fontSize,
    color: labelColor ?? MENU_COLORS.headingWhite,
    letterSpacing: 1.5,
  });
  card.frame.add(labelText);

  let enabled = true;

  if (onActivate) {
    card.hitZone.on('pointerup', () => {
      if (enabled) onActivate();
    });
  }

  const button: MenuButton = {
    card,
    container: card.container,
    label: labelText,
    setLabel(text: string) {
      labelText.setText(text);
    },
    setEnabled(value: boolean) {
      enabled = value;
      card.container.setAlpha(value ? 1 : 0.45);
      if (value) {
        card.hitZone.setInteractive({ useHandCursor: true });
      } else {
        card.hitZone.disableInteractive();
      }
    },
    setHoverState(hovered: boolean) {
      if (!enabled) return;
      card.setHoverState(hovered);
    },
    setFocusState(focused: boolean) {
      if (!enabled) return;
      card.setFocusState(focused);
    },
    setVariant(v: MenuButtonVariant) {
      const nextColors = resolveVariantColors(v);
      card.setColors({
        bodyFillColor: nextColors.body,
        accentColor: nextColors.accent,
        borderColor: nextColors.accent,
      });
    },
    tickIdle(timeSeconds: number) {
      card.tickIdle(timeSeconds);
    },
    destroy() {
      card.destroy();
    },
  };

  return button;
}

function resolveVariantColors(variant: MenuButtonVariant): { body: number; accent: number } {
  switch (variant) {
    case 'primary':
      return { body: BODY_COLORS.primary, accent: ACCENT_COLORS.primary };
    case 'gold':
      return { body: BODY_COLORS.gold, accent: ACCENT_COLORS.gold };
    case 'magenta':
      return { body: BODY_COLORS.magenta, accent: ACCENT_COLORS.magenta };
    case 'teal':
      return { body: BODY_COLORS.teal, accent: ACCENT_COLORS.teal };
    case 'danger':
      return { body: BODY_COLORS.danger, accent: ACCENT_COLORS.danger };
    case 'safe':
      return { body: BODY_COLORS.safe, accent: ACCENT_COLORS.safe };
    case 'focus':
      return { body: BODY_COLORS.neutral, accent: ACCENT_COLORS.focus };
    case 'neutral':
    default:
      return { body: BODY_COLORS.neutral, accent: ACCENT_COLORS.neutral };
  }
}
