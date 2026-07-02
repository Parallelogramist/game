/**
 * CreditsScene — two-card credits panel.
 */

import Phaser from 'phaser';
import { fadeIn, fadeOut } from '../../utils/SceneTransition';
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

    fadeIn(this, 200);

    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (time, delta) => {
      this.menuBackground?.update(delta);
      const seconds = time / 1000;
      for (const card of this.cards) card.tickIdle(seconds);
      this.backButton?.tickIdle(seconds);
    };
    this.events.on('update', this.bgUpdateHandler);

    // Title heading.
    makeDisplayText(this, centerX, 60, 'CREDITS', {
      fontSize: 44,
      color: ACCENT_COLORS_STR.gold,
      strokeWidth: 6,
      letterSpacing: 4,
    });

    const cardWidth = 360;
    const cardHeight = 360;
    const cardY = screenHeight / 2 + 10;
    const leftCardX = screenWidth * 0.32;
    const rightCardX = screenWidth * 0.68;

    this.buildCreditCard(leftCardX, cardY, cardWidth, cardHeight, 'CREDITS', 'gold', [
      { header: 'DEVELOPED BY', body: 'George' },
      { header: 'BUILT WITH', body: 'Phaser 3 — Game Framework\nbitECS — Entity Component System' },
    ]);

    this.buildCreditCard(rightCardX, cardY, cardWidth, cardHeight, 'ASSETS', 'magenta', [
      { header: 'SOUND EFFECTS', body: 'Kenney.nl\nCC0 License' },
      { header: 'ICONS', body: 'game-icons.net\nCC BY 3.0' },
    ]);

    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: screenHeight - 38,
      width: 220,
      height: 44,
      label: '← BACK',
      variant: 'neutral',
      fontSize: 16,
      onActivate: () => this.returnToMenu(),
    });
    this.backButton.card.hitZone.on('pointerover', () => this.backButton.setHoverState(true));
    this.backButton.card.hitZone.on('pointerout', () => this.backButton.setHoverState(false));

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: [
        {
          onFocus: () => this.backButton.setFocusState(true),
          onBlur: () => this.backButton.setFocusState(false),
          onActivate: () => this.returnToMenu(),
        },
      ],
      onCancel: () => this.returnToMenu(),
    });

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
    fadeOut(this, 150, () => this.scene.start('BootScene'));
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
