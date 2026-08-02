import Phaser from 'phaser';
import { Relic, getRelicRarityColor } from '../../data/Relics';
import { createIcon } from '../../utils/IconRenderer';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuOverlay, MenuOverlay } from '../../visual/MenuOverlay';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { ACCENT_COLORS_STR, MENU_FONT, TEXT_COLORS } from '../../visual/MenuStyle';
import { computeCardGridInBand, fitTextWidth, resolveMenuFontScale, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';

/** Data passed to RelicDraftScene by GameScene.processRelicChoiceQueue(). */
export interface RelicDraftSceneData {
  choices: Relic[];
  onSelect: (relic: Relic) => void;
  /** Header override. Defaults to the standard new-relic draft copy. */
  title?: string;
  subtitle?: string;
  /** Per-relic-id tag rendered under the rarity tag (reinforce rounds only). */
  rankLabels?: Record<string, string>;
}

interface RelicCardEntry {
  card: MenuCard;
  relic: Relic;
  index: number;
}

const RARITY_LABEL: Record<string, string> = {
  common: 'COMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY',
};

const RELIC_CARD_WIDTH = 264;
const RELIC_CARD_HEIGHT = 320;
const RELIC_CARD_SPACING = 34;
const RELIC_MAX_COLUMNS = 3;
/** Total horizontal margin the card row keeps off the two canvas edges (the legacy 60 per side). */
const RELIC_EDGE_MARGIN = 120;
/** Design-space units the title and subtitle occupy above the card band (subtitle baseline 134 plus half its 22px line, plus clearance). */
const RELIC_HEADER_RESERVE = 150;
/** Design-space units kept clear below it. The draft has no footer button: this is breathing room only. */
const RELIC_FOOTER_RESERVE = 40;
/**
 * `computeCardGridInBand`'s anchorOffset is measured against a grid TOP edge while the row was
 * composed as a centre at `height / 2 + 20`, so the offset carries half a card. For a single row
 * the half-card cancels and the anchor resolves to exactly `canvasHeight / 2 + 20 * scale`.
 */
const RELIC_ROW_ANCHOR_OFFSET = 20 + RELIC_CARD_HEIGHT / 2;

/**
 * RelicDraftScene — in-run 1-of-N relic pick (FEAT-RELIC-DRAFT).
 *
 * Launched as an overlay over a paused GameScene (GameScene.isPaused freezes
 * gameplay; this scene is NOT a full-screen replacement). A relic is pure
 * upside, so the pick is forced: no reroll/skip/banish/lock and no cancel path.
 * Cards are rarity-colored; select punches + fades, calls onSelect, then stops.
 */
export class RelicDraftScene extends Phaser.Scene {
  private choices: Relic[] = [];
  private titleText: string = 'CHOOSE A RELIC';
  private subtitleText: string = 'Pick one to add to your build';
  private rankLabels: Record<string, string> = {};
  private onSelectCallback: ((relic: Relic) => void) | null = null;
  private cardEntries: RelicCardEntry[] = [];
  private cardNavigator: MenuNavigator | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private soundManager!: SoundManager;
  private menuOverlay: MenuOverlay | null = null;
  private overlayUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private cardScaleFactor: number = 1;
  private menuScale: number = 1;
  private gridColumns: number = 1;
  private entranceComplete: boolean = false;
  private selectionMade: boolean = false;

  constructor() {
    super({ key: 'RelicDraftScene' });
  }

  init(data: RelicDraftSceneData): void {
    this.choices = data.choices ?? [];
    this.onSelectCallback = data.onSelect ?? null;
    this.selectionMade = false;
    this.entranceComplete = false;
    this.titleText = data.title ?? 'CHOOSE A RELIC';
    this.subtitleText = data.subtitle ?? 'Pick one to add to your build';
    this.rankLabels = data.rankLabels ?? {};
  }

  create(): void {
    this.cardEntries = [];
    this.cardScaleFactor = 1;
    this.gridColumns = 1;
    this.menuScale = resolveMenuFontScale(
      this.scale.width, this.scale.height, getSettingsManager().getUiScale(),
    );
    this.soundManager = new SoundManager(this);
    this.input.setTopOnly(true);

    // Semi-transparent backdrop — gameplay bleeds through but cards pop.
    this.menuOverlay = createMenuOverlay(this, { dim: 0.7, drifterCount: 4 });
    this.overlayUpdateHandler = (time, delta) => {
      this.menuOverlay?.update(delta);
      const seconds = time / 1000;
      for (const entry of this.cardEntries) entry.card.tickIdle(seconds);
    };
    this.events.on('update', this.overlayUpdateHandler);

    const title = makeDisplayText(
      this, this.scale.width / 2, scaledInt(this.menuScale, 84), this.titleText, {
        fontSize: scaledInt(this.menuScale, 48),
        color: ACCENT_COLORS_STR.focus,
        strokeWidth: scaledInt(this.menuScale, 6),
        letterSpacing: 3 * this.menuScale,
      },
    );
    title.setDepth(1);
    fitTextWidth(title, this.scale.width - 24);

    const subtitle = makeBodyText(
      this, this.scale.width / 2, scaledInt(this.menuScale, 134), this.subtitleText, {
        fontSize: scaledInt(this.menuScale, 22),
        color: TEXT_COLORS.muted,
      },
    );
    subtitle.setDepth(1);
    fitTextWidth(subtitle, this.scale.width - 24);

    this.createRelicCards();

    this.cardNavigator = new MenuNavigator({
      scene: this,
      columns: Math.max(1, this.gridColumns),
      items: this.cardEntries.map((entry) => ({
        onFocus: () => this.applyCardHover(entry.index, true),
        onBlur: () => this.applyCardHover(entry.index, false),
        onActivate: () => this.selectRelic(entry.relic),
      })),
    });

    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.entranceComplete) return;
      const keyNumber = parseInt(event.key, 10);
      if (keyNumber >= 1 && keyNumber <= this.cardEntries.length) {
        this.selectRelic(this.cardEntries[keyNumber - 1].relic);
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
    this.animateEntrance();
  }

  private applyCardHover(index: number, hovered: boolean): void {
    if (!this.entranceComplete) return;
    const entry = this.cardEntries[index];
    if (!entry) return;
    entry.card.setHoverState(hovered);
  }

  private createRelicCards(): void {
    const count = Math.max(1, this.choices.length);
    const grid = computeCardGridInBand({
      count,
      cardWidth: RELIC_CARD_WIDTH,
      cardHeight: RELIC_CARD_HEIGHT,
      cardSpacing: RELIC_CARD_SPACING,
      maxColumns: RELIC_MAX_COLUMNS,
      canvasWidth: this.scale.width,
      canvasHeight: this.scale.height,
      edgeMargin: RELIC_EDGE_MARGIN,
      topReserve: RELIC_HEADER_RESERVE,
      bottomReserve: RELIC_FOOTER_RESERVE,
      menuScale: this.menuScale,
      anchorOffset: RELIC_ROW_ANCHOR_OFFSET,
    });
    this.cardScaleFactor = grid.scale;
    this.gridColumns = grid.columns;

    this.choices.forEach((relic, index) => {
      const rowIndex = Math.floor(index / grid.columns);
      const cardsInRow = Math.min(grid.columns, count - rowIndex * grid.columns);
      // A short last row would otherwise sit left-aligned under a full one.
      const rowInset = ((grid.columns - cardsInRow) * grid.columnPitch) / 2;
      const cardX = grid.firstColumnX + rowInset + (index % grid.columns) * grid.columnPitch;
      const cardY = grid.firstRowY + rowIndex * grid.rowPitch;
      const entry = this.createCardEntry(
        cardX, cardY, RELIC_CARD_WIDTH, RELIC_CARD_HEIGHT, relic, index,
      );
      entry.card.container.setScale(grid.scale);
      this.cardEntries.push(entry);
    });
  }

  private createCardEntry(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    relic: Relic,
    index: number,
  ): RelicCardEntry {
    const accent = getRelicRarityColor(relic.rarity);
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

    const halfH = height / 2;

    const bannerLabel = makeDisplayText(this, 0, card.bannerTopY + 22, relic.name.toUpperCase(), {
      fontSize: 18,
      color: TEXT_COLORS.heading,
      letterSpacing: 1,
    });
    card.frame.add(bannerLabel);

    const iconY = -halfH + 92;
    const iconBackground = this.add.circle(0, iconY, 38, 0x000000, 0.35);
    iconBackground.setStrokeStyle(2, accent);
    card.frame.add(iconBackground);
    const icon = createIcon(this, { x: 0, y: iconY, iconKey: relic.icon, size: 48 });
    card.frame.add(icon);

    const rarityTag = makeDisplayText(
      this,
      0,
      iconY + 58,
      RARITY_LABEL[relic.rarity] ?? relic.rarity.toUpperCase(),
      {
        fontSize: 13,
        color: `#${accent.toString(16).padStart(6, '0')}`,
        letterSpacing: 2,
      },
    );
    card.frame.add(rarityTag);

    const rankLabel = this.rankLabels[relic.id];
    if (rankLabel) {
      const rankTag = makeDisplayText(this, 0, iconY + 80, rankLabel, {
        fontSize: 14,
        color: TEXT_COLORS.heading,
        letterSpacing: 2,
      });
      card.frame.add(rankTag);
    }

    const descriptionText = this.add.text(0, iconY + (rankLabel ? 126 : 108), relic.description, {
      fontSize: '16px',
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.body,
      wordWrap: { width: width - 36 },
      align: 'center',
    });
    descriptionText.setOrigin(0.5);
    card.frame.add(descriptionText);

    const keybindText = makeDisplayText(this, 0, halfH - 20, `[ ${index + 1} ]`, {
      fontSize: 13,
      color: TEXT_COLORS.muted,
      letterSpacing: 1,
    });
    card.frame.add(keybindText);

    card.hitZone.on('pointerover', () => {
      if (!this.entranceComplete) return;
      this.soundManager.playUIClick();
      card.setHoverState(true);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerdown', () => {
      if (!this.entranceComplete) return;
      this.selectRelic(relic);
    });

    return { card, relic, index };
  }

  private selectRelic(relic: Relic): void {
    if (!this.entranceComplete || this.selectionMade) return;
    this.selectionMade = true;
    this.soundManager.playUpgradeSelect();
    this.input.keyboard?.removeAllListeners();
    for (const entry of this.cardEntries) entry.card.hitZone.removeAllListeners();

    const selectedIndex = this.choices.indexOf(relic);
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
        onComplete: () => this.closeAndApply(relic),
      });
    } else {
      this.closeAndApply(relic);
    }
  }

  private closeAndApply(relic: Relic): void {
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 120,
      onComplete: () => {
        this.onSelectCallback?.(relic);
        this.scene.stop();
      },
    });
  }

  private animateEntrance(): void {
    this.time.delayedCall(80, () => {
      this.entranceComplete = true;
    });

    if (getSettingsManager().isReducedMotionEnabled()) return;

    this.cardEntries.forEach((entry, index) => {
      const targetY = entry.card.container.y;
      entry.card.container.y = this.scale.height + 200;
      entry.card.container.alpha = 0;
      this.tweens.add({
        targets: entry.card.container,
        y: targetY,
        alpha: 1,
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
    this.tweens.killAll();
  }
}
