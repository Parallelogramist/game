import Phaser from 'phaser';
import { MarketOfferId, MarketOfferView } from '../../data/MarketOffers';
import { createIcon } from '../../utils/IconRenderer';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { createMenuOverlay, MenuOverlay } from '../../visual/MenuOverlay';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { ACCENT_COLORS_STR, MENU_FONT, TEXT_COLORS } from '../../visual/MenuStyle';
import { getSettingsManager } from '../../settings';

/** Data passed to MarketScene by GameScene.openMarket(). */
export interface MarketSceneData {
  offers: MarketOfferView[];
  /** Wallet balance at open — display only; GameScene does the deduction. */
  gold: number;
  /** Called exactly once: the bought offer id, or null if the player left. */
  onClose: (purchased: MarketOfferId | null) => void;
}

interface MarketCardEntry {
  card: MenuCard;
  offer: MarketOfferView;
  index: number;
}

const LOCKED_CARD_ALPHA = 0.45;
const BASE_CARD_WIDTH = 264;
const BASE_CARD_HEIGHT = 320;
const BASE_CARD_SPACING = 34;
const CARD_ROW_EDGE_MARGIN = 60;
const LEAVE_BUTTON_GAP = 56;

/**
 * MarketScene — the Black Market's 1-of-3 priced overlay (FEAT-MARKET).
 *
 * Launched over a paused GameScene exactly like RelicDraftScene, but the pick
 * is never forced: gold is the player's to keep, so LEAVE is always live and
 * an offer that cannot be taken is dimmed with the reason instead of hidden.
 * onClose fires exactly once on both paths — GameScene releases its pause there.
 */
export class MarketScene extends Phaser.Scene {
  private offers: MarketOfferView[] = [];
  private gold: number = 0;
  private onCloseCallback: ((purchased: MarketOfferId | null) => void) | null = null;
  private cardEntries: MarketCardEntry[] = [];
  private cardNavigator: MenuNavigator | null = null;
  private leaveButton: MenuButton | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private soundManager!: SoundManager;
  private menuOverlay: MenuOverlay | null = null;
  private overlayUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private cardScaleFactor: number = 1;
  private cardRowBottomY: number = 0;
  private headerTexts: Phaser.GameObjects.Text[] = [];
  private entranceComplete: boolean = false;
  private resolved: boolean = false;

  constructor() {
    super({ key: 'MarketScene' });
  }

  init(data: MarketSceneData): void {
    this.offers = data.offers ?? [];
    this.gold = data.gold ?? 0;
    this.onCloseCallback = data.onClose ?? null;
    this.resolved = false;
    this.entranceComplete = false;
  }

  create(): void {
    this.cardEntries = [];
    this.cardScaleFactor = 1;
    this.headerTexts = [];
    this.soundManager = new SoundManager(this);
    this.input.setTopOnly(true);

    this.menuOverlay = createMenuOverlay(this, { dim: 0.7, drifterCount: 4 });
    this.overlayUpdateHandler = (time, delta) => {
      this.menuOverlay?.update(delta);
      const seconds = time / 1000;
      for (const entry of this.cardEntries) entry.card.tickIdle(seconds);
      this.leaveButton?.tickIdle(seconds);
    };
    this.events.on('update', this.overlayUpdateHandler);

    const title = makeDisplayText(this, this.scale.width / 2, 84, 'THE BLACK MARKET', {
      fontSize: 48,
      color: ACCENT_COLORS_STR.focus,
      strokeWidth: 6,
      letterSpacing: 3,
    });
    title.setDepth(1);

    const subtitle = makeBodyText(this, this.scale.width / 2, 134, 'Spend banked gold — or walk away', {
      fontSize: 22,
      color: TEXT_COLORS.muted,
    });
    subtitle.setDepth(1);

    const walletText = makeBodyText(this, this.scale.width / 2, 166, `YOUR GOLD: ${this.gold.toLocaleString('en-US')}`, {
      fontSize: 22,
      color: ACCENT_COLORS_STR.gold,
    });
    walletText.setDepth(1);

    this.headerTexts = [title, subtitle, walletText];

    this.createOfferCards();

    this.leaveButton = createMenuButton({
      scene: this,
      x: this.scale.width / 2,
      y: this.cardRowBottomY + LEAVE_BUTTON_GAP,
      width: 220,
      height: 52,
      label: 'LEAVE',
      variant: 'neutral',
      onActivate: () => this.leave(),
    });
    this.leaveButton.container.setDepth(2);

    // LEAVE stays out of the navigator grid: as a 4th item it would wrap onto a
    // ragged second row. B/Escape reaches it through onCancel instead.
    this.cardNavigator = new MenuNavigator({
      scene: this,
      columns: Math.max(1, this.cardEntries.length),
      items: this.cardEntries.map((entry) => ({
        onFocus: () => this.applyCardHover(entry.index, true),
        onBlur: () => this.applyCardHover(entry.index, false),
        onActivate: () => this.buyOffer(entry.offer),
      })),
      onCancel: () => this.leave(),
    });

    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.entranceComplete) return;
      const keyNumber = parseInt(event.key, 10);
      if (keyNumber >= 1 && keyNumber <= this.cardEntries.length) {
        this.buyOffer(this.cardEntries[keyNumber - 1].offer);
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
    this.animateEntrance();
  }

  private applyCardHover(index: number, hovered: boolean): void {
    if (!this.entranceComplete) return;
    const entry = this.cardEntries[index];
    if (!entry || entry.offer.locked) return;
    entry.card.setHoverState(hovered);
  }

  private computeOfferRowGeometry(): {
    scaleFactor: number;
    startX: number;
    rowY: number;
    pitch: number;
  } {
    const count = Math.max(1, this.offers.length);
    const baseRowWidth = count * BASE_CARD_WIDTH + (count - 1) * BASE_CARD_SPACING;
    const availableWidth = this.scale.width - CARD_ROW_EDGE_MARGIN * 2;
    const scaleFactor = Math.min(1, availableWidth / baseRowWidth);
    const cardWidth = BASE_CARD_WIDTH * scaleFactor;
    const cardSpacing = BASE_CARD_SPACING * scaleFactor;
    const rowWidth = this.offers.length * cardWidth + (this.offers.length - 1) * cardSpacing;
    return {
      scaleFactor,
      startX: (this.scale.width - rowWidth) / 2 + cardWidth / 2,
      rowY: this.scale.height / 2 + 20,
      pitch: cardWidth + cardSpacing,
    };
  }

  private createOfferCards(): void {
    const geometry = this.computeOfferRowGeometry();
    this.cardScaleFactor = geometry.scaleFactor;
    this.cardRowBottomY = geometry.rowY + (BASE_CARD_HEIGHT * geometry.scaleFactor) / 2;

    this.offers.forEach((offer, index) => {
      const cardX = geometry.startX + index * geometry.pitch;
      const entry = this.createCardEntry(
        cardX, geometry.rowY, BASE_CARD_WIDTH, BASE_CARD_HEIGHT, offer, index,
      );
      entry.card.container.setScale(geometry.scaleFactor);
      this.cardEntries.push(entry);
    });
  }

  private createCardEntry(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    offer: MarketOfferView,
    index: number,
  ): MarketCardEntry {
    const accent = offer.color;
    const card = createMenuCard(this, {
      x: positionX,
      y: positionY,
      width,
      height,
      pulseSeed: index * 0.7,
      bodyFillColor: 0x161428,
      accentColor: accent,
      bannerHeight: 44,
      borderWidth: 3,
      borderColor: accent,
      cornerRadius: 8,
    });
    card.container.setDepth(2);

    const textBoost = Math.min(1.2, 1 / this.cardScaleFactor);
    const halfH = height / 2;

    const bannerLabel = makeDisplayText(this, 0, card.bannerTopY + 22, offer.name.toUpperCase(), {
      fontSize: Math.round(18 * textBoost),
      color: TEXT_COLORS.heading,
      letterSpacing: 1,
    });
    card.frame.add(bannerLabel);

    const iconY = -halfH + 92;
    const iconBackground = this.add.circle(0, iconY, 38, 0x000000, 0.35);
    iconBackground.setStrokeStyle(2, accent);
    card.frame.add(iconBackground);
    const icon = createIcon(this, { x: 0, y: iconY, iconKey: offer.icon, size: 48 });
    card.frame.add(icon);

    const priceTag = makeDisplayText(
      this,
      0,
      iconY + 58,
      offer.locked ? offer.lockLabel : `${offer.price.toLocaleString('en-US')} G`,
      {
        fontSize: Math.round(13 * textBoost),
        color: offer.locked ? TEXT_COLORS.muted : ACCENT_COLORS_STR.gold,
        letterSpacing: 2,
      },
    );
    card.frame.add(priceTag);

    const descriptionText = this.add.text(0, iconY + 108, offer.description, {
      fontSize: `${Math.round(16 * textBoost)}px`,
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.body,
      wordWrap: { width: width - 36 },
      align: 'center',
    });
    descriptionText.setOrigin(0.5);
    card.frame.add(descriptionText);

    if (!offer.locked) {
      const keybindText = makeDisplayText(this, 0, halfH - 20, `[ ${index + 1} ]`, {
        fontSize: Math.round(13 * textBoost),
        color: TEXT_COLORS.muted,
        letterSpacing: 1,
      });
      card.frame.add(keybindText);
    }

    card.hitZone.on('pointerover', () => {
      if (!this.entranceComplete || offer.locked) return;
      this.soundManager.playUIClick();
      card.setHoverState(true);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerdown', () => {
      if (!this.entranceComplete) return;
      this.buyOffer(offer);
    });

    return { card, offer, index };
  }

  /**
   * Re-place the offer row on the live canvas. Positions and card scale only: the text inside
   * a card was sized against the scale factor it was created at and is not re-rendered.
   */
  handleResize(): void {
    if (this.resolved) return;

    this.menuOverlay?.destroy();
    this.menuOverlay = createMenuOverlay(this, { dim: 0.7, drifterCount: 4 });

    const centerX = this.scale.width / 2;
    for (const text of this.headerTexts) text.setX(centerX);

    const geometry = this.computeOfferRowGeometry();
    this.cardScaleFactor = geometry.scaleFactor;
    this.cardRowBottomY = geometry.rowY + (BASE_CARD_HEIGHT * geometry.scaleFactor) / 2;

    this.cardEntries.forEach((entry, index) => {
      // A resize mid-entrance would otherwise let the slide-in tween drag the card back to
      // its pre-resize target y, so the entrance is settled here rather than replayed.
      this.tweens.killTweensOf(entry.card.container);
      entry.card.container.setPosition(geometry.startX + index * geometry.pitch, geometry.rowY);
      entry.card.container.setScale(geometry.scaleFactor);
      entry.card.container.setAlpha(entry.offer.locked ? LOCKED_CARD_ALPHA : 1);
    });
    this.entranceComplete = true;

    this.leaveButton?.container.setPosition(centerX, this.cardRowBottomY + LEAVE_BUTTON_GAP);
  }

  private buyOffer(offer: MarketOfferView): void {
    if (!this.entranceComplete || this.resolved) return;
    if (offer.locked) {
      this.soundManager.playError();
      return;
    }
    this.resolved = true;
    this.soundManager.playPurchase();
    this.input.keyboard?.removeAllListeners();
    for (const entry of this.cardEntries) entry.card.hitZone.removeAllListeners();

    const selectedIndex = this.cardEntries.findIndex((entry) => entry.offer.id === offer.id);
    const selectedEntry = this.cardEntries[selectedIndex];

    this.cardEntries.forEach((entry, idx) => {
      if (idx !== selectedIndex) {
        this.tweens.add({
          targets: entry.card.container,
          alpha: 0,
          scaleX: this.cardScaleFactor * 0.9,
          scaleY: this.cardScaleFactor * 0.9,
          duration: 150,
          ease: 'Quad.easeIn',
        });
      }
    });

    if (selectedEntry) {
      this.tweens.add({
        targets: selectedEntry.card.container,
        scaleX: this.cardScaleFactor * 1.12,
        scaleY: this.cardScaleFactor * 1.12,
        duration: 150,
        ease: 'Back.easeOut',
        onComplete: () => this.finish(offer.id),
      });
    } else {
      this.finish(offer.id);
    }
  }

  private leave(): void {
    if (!this.entranceComplete || this.resolved) return;
    this.resolved = true;
    this.soundManager.playUIClick();
    this.finish(null);
  }

  private finish(result: MarketOfferId | null): void {
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 120,
      onComplete: () => {
        this.onCloseCallback?.(result);
        this.scene.stop();
      },
    });
  }

  private animateEntrance(): void {
    this.time.delayedCall(80, () => {
      this.entranceComplete = true;
    });

    if (getSettingsManager().isReducedMotionEnabled()) {
      // The entrance tween is also the only thing that dims a locked offer, so
      // skipping it has to apply that alpha directly or locked reads as buyable.
      for (const entry of this.cardEntries) {
        if (entry.offer.locked) entry.card.container.alpha = LOCKED_CARD_ALPHA;
      }
      return;
    }

    this.cardEntries.forEach((entry, index) => {
      const targetY = entry.card.container.y;
      const targetAlpha = entry.offer.locked ? LOCKED_CARD_ALPHA : 1;
      entry.card.container.y = this.scale.height + 200;
      entry.card.container.alpha = 0;
      this.tweens.add({
        targets: entry.card.container,
        y: targetY,
        alpha: targetAlpha,
        duration: 400,
        delay: index * 90,
        ease: 'Back.easeOut',
      });
    });
  }

  shutdown(): void {
    if (this.overlayUpdateHandler) {
      this.events.off('update', this.overlayUpdateHandler);
      this.overlayUpdateHandler = null;
    }
    this.menuOverlay?.destroy();
    this.menuOverlay = null;
    if (this.cardNavigator) {
      this.cardNavigator.destroy();
      this.cardNavigator = null;
    }
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    for (const entry of this.cardEntries) entry.card.destroy();
    this.cardEntries = [];
    this.leaveButton?.destroy();
    this.leaveButton = null;
    this.tweens.killAll();
  }
}
