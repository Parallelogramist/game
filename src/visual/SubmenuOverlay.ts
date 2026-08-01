/**
 * SubmenuOverlay — a modal card list that groups menu destinations behind one
 * entry, so a scene can carry a handful of top-level cards instead of a dozen.
 *
 * Owns its own MenuNavigator, dim layer, entrance and per-frame idle tick: the
 * caller pauses its own navigator, opens this, and rebuilds its navigator in
 * onClose. Built on MenuCard (hover/focus/press for free) rather than the DOM
 * OverlayKit, which has no keyboard or gamepad navigation.
 */

import Phaser from 'phaser';
import { getSettingsManager } from '../settings';
import { MenuNavigator } from '../input/MenuNavigator';
import { createIcon } from '../utils/IconRenderer';
import {
  computeHudScale,
  computeMenuFontScale,
  computeMenuFontScalePortrait,
  scaledFontPx,
  scaledInt,
} from '../utils/HudScale';
import { staggerEntrance } from '../utils/SceneTransition';
import { createMenuCard, MenuCard } from './MenuCard';
import { makeDisplayText } from './DisplayText';
import { MENU_COLORS as COLORS, MENU_FONT, roleColors, RoleColorKey } from './MenuStyle';
import { computeSubmenuGrid } from './submenuGrid';

/** Below the confirmation dialog's 100 so a confirm can still open over a submenu. */
const SUBMENU_DEPTH = 90;
const DIM_ALPHA = 0.72;

export interface SubmenuEntry {
  label: string;
  iconKey: string;
  badge?: string;
  accentRole: RoleColorKey;
  iconTint?: number;
  action: () => void;
}

export interface SubmenuOverlayOptions {
  scene: Phaser.Scene;
  title: string;
  entries: SubmenuEntry[];
  onClose: () => void;
}

export interface SubmenuOverlay {
  destroy(): void;
}

export function createSubmenuOverlay(options: SubmenuOverlayOptions): SubmenuOverlay {
  const { scene, title, entries, onClose } = options;

  const viewportWidth = scene.scale.width;
  const viewportHeight = scene.scale.height;
  const portrait = viewportHeight > viewportWidth;
  const uiScale = getSettingsManager().getUiScale();
  const hudScale = computeHudScale(viewportWidth, viewportHeight, uiScale);
  const fontScale = portrait
    ? computeMenuFontScalePortrait(viewportWidth, viewportHeight, uiScale)
    : computeMenuFontScale(viewportWidth, viewportHeight, uiScale);

  const titleFontSize = scaledInt(fontScale, 22);
  const hintFontSize = scaledInt(fontScale, 11);
  const titleBlockHeight = titleFontSize * 3;
  const hintBlockHeight = hintFontSize * 3;

  const grid = computeSubmenuGrid({
    entryCount: entries.length,
    viewportWidth,
    viewportHeight,
    hudScale,
    reservedHeight: titleBlockHeight + hintBlockHeight,
  });

  const container = scene.add.container(0, 0).setDepth(SUBMENU_DEPTH);

  const dim = scene.add.rectangle(
    viewportWidth / 2, viewportHeight / 2, viewportWidth, viewportHeight, 0x050810, DIM_ALPHA,
  );
  dim.setInteractive();
  dim.on('pointerdown', () => onClose());
  container.add(dim);

  const centerX = viewportWidth / 2;
  const stackHeight = titleBlockHeight + grid.gridHeight + hintBlockHeight;
  const stackTopY = Math.max(
    scaledInt(hudScale, 16),
    Math.round((viewportHeight - stackHeight) / 2),
  );

  const titleText = makeDisplayText(
    scene, centerX, stackTopY + titleBlockHeight / 2, title,
    { fontSize: titleFontSize, color: COLORS.headingWhite, letterSpacing: 4 },
  );
  container.add(titleText);

  const gridTopY = stackTopY + titleBlockHeight;
  const gridLeftX = centerX - grid.gridWidth / 2;
  const iconSize = Math.round(grid.rowHeight * 0.52);
  const innerPad = scaledInt(hudScale, 14);
  const cards: MenuCard[] = [];

  // Declared before the loop: a row's pointerover closure moves navigator focus.
  let menuNavigator: MenuNavigator | null = null;

  entries.forEach((entry, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const cardX = gridLeftX + column * (grid.cardWidth + grid.columnGap) + grid.cardWidth / 2;
    const cardY = gridTopY + row * (grid.rowHeight + grid.rowGap) + grid.rowHeight / 2;
    const role = roleColors(entry.accentRole);

    const card = createMenuCard(scene, {
      x: cardX,
      y: cardY,
      width: grid.cardWidth,
      height: grid.rowHeight,
      pulseSeed: index * 0.71,
      bodyFillColor: role.body,
      accentColor: role.accent,
      shadowOffsetY: scaledInt(hudScale, 4),
    });
    cards.push(card);
    container.add(card.container);

    const icon = createIcon(scene, {
      x: -grid.cardWidth / 2 + innerPad + iconSize / 2,
      y: 0,
      iconKey: entry.iconKey,
      size: iconSize,
      tint: entry.iconTint ?? 0xffffff,
    });
    card.frame.add(icon);

    const label = makeDisplayText(
      scene, -grid.cardWidth / 2 + innerPad * 2 + iconSize, 0, entry.label,
      { fontSize: scaledInt(fontScale, 16), color: COLORS.headingWhite, letterSpacing: 3 },
    ).setOrigin(0, 0.5);
    card.frame.add(label);

    if (entry.badge) {
      const badge = scene.add.text(grid.cardWidth / 2 - innerPad, 0, entry.badge, {
        fontSize: scaledFontPx(fontScale, 12),
        color: role.accentStr,
        fontFamily: MENU_FONT,
        fontStyle: 'bold',
        letterSpacing: 1,
      }).setOrigin(1, 0.5);
      card.frame.add(badge);
    }

    card.hitZone.on('pointerover', () => {
      card.setHoverState(true);
      menuNavigator?.selectIndex(index);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerdown', () => entry.action());
  });

  const hint = scene.add.text(
    centerX, gridTopY + grid.gridHeight + hintBlockHeight / 2,
    'ESC or B closes  ·  arrows to move  ·  Enter to open',
    { fontSize: scaledFontPx(fontScale, 11), color: COLORS.textDim, fontFamily: MENU_FONT },
  ).setOrigin(0.5);
  container.add(hint);

  menuNavigator = new MenuNavigator({
    scene,
    columns: grid.columns,
    wrap: true,
    items: entries.map((entry, index) => ({
      onFocus: () => cards[index].setFocusState(true),
      onBlur: () => cards[index].setFocusState(false),
      onActivate: () => entry.action(),
    })),
    onCancel: () => onClose(),
  });

  const updateHandler = (time: number) => {
    const seconds = time / 1000;
    for (const card of cards) card.tickIdle(seconds);
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, updateHandler);

  staggerEntrance(scene, cards.map((card) => card.container), {
    baseDelayMs: 0, stepMs: 26, riseDistance: 10, durationMs: 180,
  });

  return {
    destroy(): void {
      scene.events.off(Phaser.Scenes.Events.UPDATE, updateHandler);
      menuNavigator?.destroy();
      menuNavigator = null;
      // Kill the entrance tweens first: they hold alpha/y targets on containers
      // this is about to destroy.
      for (const card of cards) {
        scene.tweens.killTweensOf(card.container);
        card.destroy();
      }
      cards.length = 0;
      container.destroy(true);
    },
  };
}
