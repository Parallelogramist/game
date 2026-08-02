/**
 * CreditsScene — two-card credits panel.
 */

import Phaser from 'phaser';
import { transitionToScene, sweepIn, staggerEntrance } from '../../utils/SceneTransition';
import { MenuNavigator } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import {
  ACCENT_COLORS,
  ACCENT_COLORS_STR,
  BODY_COLORS,
  TEXT_COLORS,
} from '../../visual/MenuStyle';
import { fitMenuScale, fitTextWidth, resolveMenuFontScale, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';

/** Title centre (60) plus half its 44px face, plus clearance. */
const CREDITS_TOP_RESERVE = 92;
/** The first link row sits 112 above the canvas bottom; this covers it plus clearance. */
const CREDITS_BOTTOM_RESERVE = 130;
/** Gap between the two cards when the viewport is too narrow to seat them side by side. */
const CREDITS_STACK_GAP = 28;

export class CreditsScene extends Phaser.Scene {
  private menuNavigator: MenuNavigator | null = null;
  private menuBackground: MenuBackground | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private cards: MenuCard[] = [];
  private backButton!: MenuButton;

  constructor() {
    super({ key: 'CreditsScene' });
  }

  create(): void {
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;
    const centerX = this.cameras.main.centerX;

    const cardWidth = 360;
    const cardHeight = 360;
    // Two 360-wide cards need ~780px of width to sit side by side; portrait
    // (720) stacks them vertically instead — height is abundant there.
    // Measured unscaled on purpose: the stacking decision must not depend on
    // the scale that depends on it.
    const stacked = screenWidth < cardWidth * 2 + 60;
    const blockHeight = stacked ? cardHeight * 2 + CREDITS_STACK_GAP : cardHeight;
    const menuScale = resolveMenuFontScale(
      screenWidth, screenHeight, getSettingsManager().getUiScale(),
    );
    const scale = fitMenuScale(
      fitMenuScale(
        menuScale, screenHeight, CREDITS_TOP_RESERVE + blockHeight + CREDITS_BOTTOM_RESERVE,
      ),
      stacked ? screenWidth - 32 : screenWidth * 0.36,
      cardWidth,
    );

    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (time, delta) => {
      this.menuBackground?.update(delta);
      const seconds = time / 1000;
      for (const card of this.cards) card.tickIdle(seconds);
      this.backButton?.tickIdle(seconds);
    };
    this.events.on('update', this.bgUpdateHandler);

    // Title heading.
    const title = makeDisplayText(this, centerX, scaledInt(scale, 60), 'CREDITS', {
      fontSize: scaledInt(scale, 44),
      color: ACCENT_COLORS_STR.gold,
      strokeWidth: scaledInt(scale, 6),
      letterSpacing: 4 * scale,
    });
    fitTextWidth(title, screenWidth - 32);

    // The composed anchor is height/2 + 10, honored whenever the block still fits between the
    // title and the link rows; a density-scaled block is clamped into that band instead.
    const halfBlock = (blockHeight * scale) / 2;
    const highestCardY = CREDITS_TOP_RESERVE * scale + halfBlock;
    const lowestCardY = screenHeight - CREDITS_BOTTOM_RESERVE * scale - halfBlock;
    const cardY = Phaser.Math.Clamp(
      screenHeight / 2 + 10 * scale,
      Math.min(highestCardY, lowestCardY),
      Math.max(highestCardY, lowestCardY),
    );
    const leftCardX = stacked ? centerX : screenWidth * 0.32;
    const rightCardX = stacked ? centerX : screenWidth * 0.68;
    const stackOffset = ((cardHeight + CREDITS_STACK_GAP) / 2) * scale;
    const firstCardY = stacked ? cardY - stackOffset : cardY;
    const secondCardY = stacked ? cardY + stackOffset : cardY;

    this.buildCreditCard(leftCardX, firstCardY, cardWidth, cardHeight, 'CREDITS', 'gold', [
      { header: 'DEVELOPED BY', body: 'Parallelogramist' },
      { header: 'BUILT WITH', body: 'Phaser 3 — Game Framework\nbitECS — Entity Component System' },
    ], scale);

    this.buildCreditCard(rightCardX, secondCardY, cardWidth, cardHeight, 'ASSETS', 'magenta', [
      { header: 'SOUND EFFECTS', body: 'Kenney.nl\nCC0 License' },
      { header: 'ICONS', body: 'game-icons.net\nCC BY 3.0' },
    ], scale);

    // The main-menu footer no longer carries these; they live here as rows.
    const externalLinks: Array<{ label: string; url: string }> = [
      { label: 'PARALLELOGRAMIST', url: 'https://parallelogramist.com' },
      { label: 'LEGAL', url: '/legal.html' },
    ];
    const linkTexts = externalLinks.map((link, index) => {
      const text = makeBodyText(
        this,
        centerX,
        screenHeight - scaledInt(scale, 112) + index * scaledInt(scale, 28),
        link.label,
        { fontSize: scaledInt(scale, 16), color: TEXT_COLORS.muted, fontStyle: 'bold' },
      ).setInteractive({ useHandCursor: true });
      text.on('pointerover', () => this.menuNavigator?.selectIndex(index));
      text.on('pointerdown', () => window.open(link.url, '_blank'));
      return text;
    });

    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: screenHeight - scaledInt(scale, 38),
      width: scaledInt(scale, 220),
      height: scaledInt(scale, 44),
      label: '← BACK',
      variant: 'neutral',
      fontSize: scaledInt(scale, 16),
      onActivate: () => this.returnToMenu(),
    });
    this.backButton.card.hitZone.on('pointerover', () => this.backButton.setHoverState(true));
    this.backButton.card.hitZone.on('pointerout', () => this.backButton.setHoverState(false));

    this.menuNavigator = new MenuNavigator({
      scene: this,
      initialIndex: externalLinks.length,
      items: [
        ...externalLinks.map((link, index) => ({
          onFocus: () => {
            linkTexts[index].setColor(ACCENT_COLORS_STR.focus);
            linkTexts[index].setShadow(0, 0, ACCENT_COLORS_STR.focus, 6, false, true);
          },
          onBlur: () => {
            linkTexts[index].setColor(TEXT_COLORS.muted);
            linkTexts[index].setShadow(0, 0, 'transparent', 0);
          },
          onActivate: () => window.open(link.url, '_blank'),
        })),
        {
          onFocus: () => this.backButton.setFocusState(true),
          onBlur: () => this.backButton.setFocusState(false),
          onActivate: () => this.returnToMenu(),
        },
      ],
      onCancel: () => this.returnToMenu(),
    });

    // Entrance choreography: title, then the two cards, then the back button.
    staggerEntrance(this, [
      title,
      ...this.cards.map((c) => c.container),
      ...linkTexts,
      this.backButton.container,
    ]);
    sweepIn(this);

    this.events.once('shutdown', this.shutdown, this);
  }

  private buildCreditCard(
    x: number,
    y: number,
    width: number,
    height: number,
    bannerLabel: string,
    role: 'gold' | 'magenta',
    sections: { header: string; body: string }[],
    scale: number,
  ): void {
    const card = createMenuCard(this, {
      x,
      y,
      width,
      height,
      bodyFillColor: role === 'gold' ? BODY_COLORS.gold : BODY_COLORS.magenta,
      accentColor: role === 'gold' ? ACCENT_COLORS.gold : ACCENT_COLORS.magenta,
      bannerHeight: 50,
      borderWidth: 3,
      borderColor: role === 'gold' ? ACCENT_COLORS.gold : ACCENT_COLORS.magenta,
      cornerRadius: 8,
    });
    card.container.setScale(scale);

    const banner = makeDisplayText(this, 0, card.bannerTopY + 25, bannerLabel, {
      fontSize: 22,
      color: TEXT_COLORS.heading,
      letterSpacing: 3,
    });
    card.frame.add(banner);

    let yOffset = -height / 2 + 75;
    for (const section of sections) {
      const header = makeDisplayText(this, 0, yOffset, section.header, {
        fontSize: 14,
        color: role === 'gold' ? ACCENT_COLORS_STR.gold : ACCENT_COLORS_STR.magenta,
        letterSpacing: 2,
      });
      card.frame.add(header);
      yOffset += 26;

      const body = makeBodyText(this, 0, yOffset, section.body, {
        fontSize: 14,
        color: TEXT_COLORS.body,
        wordWrapWidth: width - 32,
      });
      body.setLineSpacing(4);
      card.frame.add(body);
      yOffset += body.height + 22;
    }

    this.cards.push(card);
  }

  private returnToMenu(): void {
    transitionToScene(this, 'BootScene');
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    if (this.bgUpdateHandler) {
      this.events.off('update', this.bgUpdateHandler);
      this.bgUpdateHandler = null;
    }
    this.menuBackground?.destroy();
    this.menuBackground = null;
    for (const card of this.cards) card.destroy();
    this.cards = [];
    this.backButton?.destroy();
    this.tweens.killAll();
  }
}
