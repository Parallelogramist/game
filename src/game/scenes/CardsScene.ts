/**
 * CardsScene — the CARD ARCHIVE collection screen + Scanner lottery.
 *
 * Grid of the 24 collectible cards (landscape: 6 columns with the Scanner
 * panel as a right-hand column; portrait: 4 columns with a compact Scanner
 * bar below). Undiscovered slots are dark with a rarity-colored hairline
 * frame and a "?" glyph; discovered slots are mini MenuCards with icon,
 * name banner, bonus line, and rarity tag. The Scanner shows gold reserve,
 * pity hint, and the DECRYPT button (spends gold via MetaProgressionManager,
 * then rolls via CardCollectionManager.scan()). A successful scan flips the
 * revealed tile on with a rarity glow pulse (reduced motion: instant fade).
 *
 * Spec: docs/superpowers/specs/2026-07-03-card-collection-meta-design.md
 */

import Phaser from 'phaser';
import {
  ALL_CARDS,
  CardDefinition,
  formatCardBonusSummary,
  getCardRarityColor,
} from '../../data/Cards';
import { getAchievementManager, AchievementDefinition } from '../../achievements';
import {
  getCardCollectionManager,
  SCAN_COST,
} from '../../meta/CardCollectionManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { createIcon } from '../../utils/IconRenderer';
import { transitionToScene, sweepIn, staggerEntrance } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { getSettingsManager } from '../../settings';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { MENU_COLORS as COLORS, TEXT_COLORS, DISPLAY_FONT } from '../../visual/MenuStyle';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';

type FocusZone = 'grid' | 'scanner' | 'back';

interface TileEntry {
  card: MenuCard;
  def: CardDefinition;
  discovered: boolean;
}

// ─── Grid geometry — two fixed design spaces, centered in the live viewport ─
// The game scales with Phaser.Scale.EXPAND and an orientation-aware base:
// landscape guarantees ≥1280×720, portrait ≥720×1280. Each orientation gets
// its own fixed composition (landscape: 6-col grid + scanner column at right;
// portrait: 4-col grid with a compact scanner bar below), centered via
// per-axis offsets like the sibling collection screens. The spec sketches
// ~150×190 tiles, but 4 rows of 190px cannot fit a 720px viewport alongside
// the header and detail line without scrolling — a fixed 24-card archive
// reads better as one screen, so tiles are 148×134.
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const PORTRAIT_DESIGN_WIDTH = 720;
const PORTRAIT_DESIGN_HEIGHT = 1280;
const TILE_WIDTH = 148;
const TILE_HEIGHT = 134;
const TILE_GAP_X = 10;
const TILE_GAP_Y = 10;

/** Rarity color as a '#rrggbb' string for text styling. */
function rarityColorStr(rarity: CardDefinition['rarity']): string {
  return `#${getCardRarityColor(rarity).toString(16).padStart(6, '0')}`;
}

/**
 * Blend `color` toward `background` — MenuCard borders draw at full alpha,
 * so the spec's "rarity hairline at 40% alpha" is pre-mixed into the color.
 */
function fadeToward(color: number, background: number, keep: number): number {
  const r = Math.round(((color >> 16) & 0xff) * keep + ((background >> 16) & 0xff) * (1 - keep));
  const g = Math.round(((color >> 8) & 0xff) * keep + ((background >> 8) & 0xff) * (1 - keep));
  const b = Math.round((color & 0xff) * keep + (background & 0xff) * (1 - keep));
  return (r << 16) | (g << 8) | b;
}

export class CardsScene extends Phaser.Scene {
  private soundManager!: SoundManager;
  private menuBackground: MenuBackground | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private updateHandler: ((time: number, delta: number) => void) | null = null;

  private tiles: TileEntry[] = [];
  private scannerPanel: MenuCard | null = null;
  private decryptButton: MenuButton | null = null;
  private backButton: MenuButton | null = null;

  private counterText: Phaser.GameObjects.Text | null = null;
  private goldText: Phaser.GameObjects.Text | null = null;
  private pityText: Phaser.GameObjects.Text | null = null;
  private costText: Phaser.GameObjects.Text | null = null;
  private resultText: Phaser.GameObjects.Text | null = null;
  private detailText: Phaser.GameObjects.Text | null = null;

  private focusZone: FocusZone = 'grid';
  private selectedTileIndex = 0;

  /** Viewport-centering offsets for the active design space (EXPAND scale). */
  private offsetX = 0;
  private offsetY = 0;

  // Orientation-dependent geometry, resolved once in create(). Landscape
  // values match the original fixed 1280×720 composition exactly.
  private portrait = false;
  private gridColumns = 6;
  private gridLeft = 24;
  private gridTop = 78;
  private gridCenterX = 493;
  private titleY = 40;
  private counterX = 1120;
  private counterY = 40;
  private detailY = 672;
  private scannerX = 1120;
  private scannerY = 291;
  private scannerW = 296;
  private scannerH = 330;
  private decryptX = 1120;
  private decryptY = 316;
  private backY = 640;
  private bannerY = 62;

  private decryptW = 240;
  private decryptH = 50;
  private decryptFontSize = 16;
  private detailWrap = 920;

  constructor() {
    super({ key: 'CardsScene' });
  }

  /**
   * Resolve the orientation's design space and composition geometry. The
   * landscape branch reproduces the original fixed 1280×720 layout exactly;
   * portrait re-arranges into a 720×1280 space: 4-column grid (622 wide,
   * rows 84…938), detail line, then a compact full-width scanner bar
   * (1012…1168) and the back button at 1226 — all inside the guaranteed
   * 1280-unit portrait height, centered on taller viewports via offsetY.
   */
  private computeLayout(): void {
    this.portrait = this.scale.width < DESIGN_WIDTH;

    if (!this.portrait) {
      this.offsetX = Math.max(0, (this.scale.width - DESIGN_WIDTH) / 2);
      this.offsetY = Math.max(0, (this.scale.height - DESIGN_HEIGHT) / 2);
      this.gridColumns = 6;
      this.gridLeft = 24;
      this.gridTop = 78;
      this.gridCenterX = this.gridLeft + (6 * TILE_WIDTH + 5 * TILE_GAP_X) / 2;
      this.titleY = 40;
      this.counterX = 1120;
      this.counterY = 40;
      this.detailY = 672;
      this.detailWrap = 920;
      this.scannerX = 1120;
      this.scannerY = 291;
      this.scannerW = 296;
      this.scannerH = 330;
      this.decryptX = 1120;
      this.decryptY = 316;
      this.decryptW = 240;
      this.decryptH = 50;
      this.decryptFontSize = 16;
      this.backY = 640;
      this.bannerY = 62;
      return;
    }

    this.offsetX = Math.max(0, (this.scale.width - PORTRAIT_DESIGN_WIDTH) / 2);
    this.offsetY = Math.max(0, (this.scale.height - PORTRAIT_DESIGN_HEIGHT) / 2);
    this.gridColumns = 4;
    const gridWidth = 4 * TILE_WIDTH + 3 * TILE_GAP_X; // 622
    this.gridLeft = (PORTRAIT_DESIGN_WIDTH - gridWidth) / 2;
    this.gridTop = 84;
    this.gridCenterX = PORTRAIT_DESIGN_WIDTH / 2;
    this.titleY = 30;
    this.counterX = this.gridCenterX;
    this.counterY = 62;
    this.detailY = 964; // grid bottom = 84 + 6×(134+10) − 10 = 938
    this.detailWrap = 660;
    this.scannerW = gridWidth;
    this.scannerH = 156;
    this.scannerX = this.gridCenterX;
    this.scannerY = 1012 + this.scannerH / 2;
    this.decryptX = this.scannerX + 200;
    this.decryptY = this.scannerY - 20;
    this.decryptW = 180;
    this.decryptH = 46;
    this.decryptFontSize = 14;
    this.backY = 1226;
    // Transient achievement toast — overlays mid-grid; the header rows are
    // occupied by the title + counter in portrait.
    this.bannerY = this.gridTop + 260;
  }

  create(): void {
    this.soundManager = new SoundManager(this);
    this.tiles = [];
    this.focusZone = 'grid';
    this.selectedTileIndex = 0;

    this.computeLayout();

    this.menuBackground = createMenuBackground(this);

    const cardManager = getCardCollectionManager();

    // ─── header ─────────────────────────────────────────────────────────
    const title = makeDisplayText(this, this.gridCenterX + this.offsetX, this.titleY + this.offsetY, 'CARD ARCHIVE', {
      fontSize: 30,
      color: COLORS.accentPrimaryStr,
      strokeWidth: 4,
      letterSpacing: 4,
    });

    this.counterText = makeDisplayText(this, this.counterX + this.offsetX, this.counterY + this.offsetY, '', {
      fontSize: 16,
      color: COLORS.accentGoldStr,
      letterSpacing: 2,
    });
    this.updateCounter();

    // ─── card grid ──────────────────────────────────────────────────────
    ALL_CARDS.forEach((def, index) => {
      this.tiles.push(this.createTile(index, def, cardManager.isDiscovered(def.id)));
    });

    // ─── detail line (fixed under the grid — hover/focus target info) ───
    this.detailText = makeBodyText(this, this.gridCenterX + this.offsetX, this.detailY + this.offsetY, '', {
      fontSize: 13,
      color: TEXT_COLORS.muted,
      wordWrapWidth: this.detailWrap,
    });
    this.showDefaultDetail();

    // ─── scanner panel + buttons ────────────────────────────────────────
    this.createScannerPanel();

    this.backButton = createMenuButton({
      scene: this,
      x: (this.portrait ? this.gridCenterX : this.scannerX) + this.offsetX,
      y: this.backY + this.offsetY,
      width: 240,
      height: 44,
      label: '← BACK TO MENU',
      variant: 'neutral',
      fontSize: 14,
      onActivate: () => this.goBack(),
    });
    this.backButton.card.hitZone.on('pointerover', () => this.backButton?.setHoverState(true));
    this.backButton.card.hitZone.on('pointerout', () => this.backButton?.setHoverState(false));

    this.updateScannerState();

    // Collection achievements can unlock from a Scanner decrypt. The manager
    // auto-claims rewards only when a callback is wired to deliver them, so
    // wire delivery here (mirroring GameScene) for the menu context; shutdown
    // detaches it. GameScene re-wires its own on every run start.
    getAchievementManager().setAchievementUnlockCallback((achievement) => {
      this.deliverAchievement(achievement);
    });
    // Sync the collection milestones with the persisted archive — covers
    // discoveries made before the milestones shipped (progress catches up and
    // any crossed tier unlocks right here, where delivery is wired).
    getAchievementManager().recordCardsDiscovered(cardManager.getDiscoveredIds().size);

    // ─── per-frame idle driver (background shimmer + card hover pulses) ─
    this.updateHandler = (time: number, delta: number) => {
      const seconds = time / 1000;
      this.menuBackground?.update(delta);
      for (const tile of this.tiles) tile.card.tickIdle(seconds);
      this.scannerPanel?.tickIdle(seconds);
      this.decryptButton?.tickIdle(seconds);
      this.backButton?.tickIdle(seconds);
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, this.updateHandler);

    // ─── keyboard / gamepad navigation ──────────────────────────────────
    this.buildMenuNavigator();

    // ─── entrance choreography ──────────────────────────────────────────
    staggerEntrance(this, [
      title,
      this.counterText,
      ...this.tiles.map((tile) => tile.card.container),
      this.scannerPanel!.container,
      this.decryptButton!.container,
      this.backButton.container,
      this.detailText,
    ]);
    sweepIn(this);

    this.events.once('shutdown', this.shutdown, this);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Grid tiles
  // ═══════════════════════════════════════════════════════════════════════

  private tilePosition(index: number): { x: number; y: number } {
    const col = index % this.gridColumns;
    const row = Math.floor(index / this.gridColumns);
    return {
      x: this.gridLeft + TILE_WIDTH / 2 + col * (TILE_WIDTH + TILE_GAP_X) + this.offsetX,
      y: this.gridTop + TILE_HEIGHT / 2 + row * (TILE_HEIGHT + TILE_GAP_Y) + this.offsetY,
    };
  }

  private createTile(index: number, def: CardDefinition, discovered: boolean): TileEntry {
    const { x, y } = this.tilePosition(index);
    const rarityColor = getCardRarityColor(def.rarity);

    let card: MenuCard;
    if (discovered) {
      card = createMenuCard(this, {
        x,
        y,
        width: TILE_WIDTH,
        height: TILE_HEIGHT,
        pulseSeed: index * 0.7,
        bodyFillColor: COLORS.bodyNeutral,
        accentColor: rarityColor,
        bannerHeight: 20,
        shadowOffsetY: 4,
        shadowOffsetX: 0,
      });

      // Name rides the rarity banner.
      const name = makeDisplayText(this, 0, -TILE_HEIGHT / 2 + 10, def.name.toUpperCase(), {
        fontSize: 10,
        color: COLORS.headingWhite,
        strokeWidth: 2,
        letterSpacing: 1,
      });
      card.frame.add(name);

      // Icon — createIcon falls back internally on unknown keys, but a
      // missing atlas texture still throws; mirror AchievementScene's
      // glyph fallback so a bad key can never break the archive.
      try {
        const icon = createIcon(this, {
          x: 0,
          y: -16,
          iconKey: def.icon,
          size: 40,
          tint: 0xffffff,
        });
        card.frame.add(icon);
      } catch {
        const fallback = makeDisplayText(this, 0, -16, '◆', {
          fontSize: 30,
          color: rarityColorStr(def.rarity),
        });
        card.frame.add(fallback);
      }

      // Bonus line.
      const bonus = makeBodyText(this, 0, 20, def.description, {
        fontSize: 10,
        color: TEXT_COLORS.body,
        wordWrapWidth: TILE_WIDTH - 16,
      });
      card.frame.add(bonus);

      // Rarity tag.
      const tag = makeDisplayText(this, 0, TILE_HEIGHT / 2 - 14, def.rarity.toUpperCase(), {
        fontSize: 9,
        color: rarityColorStr(def.rarity),
        strokeWidth: 1,
        letterSpacing: 2,
      });
      card.frame.add(tag);
    } else {
      card = createMenuCard(this, {
        x,
        y,
        width: TILE_WIDTH,
        height: TILE_HEIGHT,
        pulseSeed: index * 0.7,
        bodyFillColor: COLORS.bodyNeutral,
        accentColor: rarityColor,
        bannerHeight: 0,
        borderWidth: 1,
        borderColor: fadeToward(rarityColor, 0x0a0e18, 0.4),
        shadowOffsetY: 4,
        shadowOffsetX: 0,
      });

      const glyph = this.add.text(0, -4, '?', {
        fontSize: '44px',
        color: TEXT_COLORS.dim,
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      card.frame.add(glyph);
    }

    card.hitZone.on('pointerover', () => {
      card.setHoverState(true);
      this.showDetail(index);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));

    return { card, def, discovered };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Detail line
  // ═══════════════════════════════════════════════════════════════════════

  private showDetail(index: number): void {
    const tile = this.tiles[index];
    if (!tile || !this.detailText) return;
    if (tile.discovered) {
      this.detailText.setText(
        `${tile.def.name.toUpperCase()} — ${tile.def.description}  ·  ${tile.def.rarity.toUpperCase()}`,
      );
      this.detailText.setColor(rarityColorStr(tile.def.rarity));
    } else {
      this.detailText.setText('ENCRYPTED — recover data caches in-run, or DECRYPT with the Scanner');
      this.detailText.setColor(TEXT_COLORS.muted);
    }
  }

  private showDefaultDetail(): void {
    if (!this.detailText) return;
    // The idle detail line doubles as the spec's aggregate bonus summary —
    // recomputed on every call, so it picks up new discoveries for free.
    const summary = formatCardBonusSummary(getCardCollectionManager().getAggregatedBonuses());
    if (summary) {
      this.detailText.setText(`ARCHIVE BONUS · ${summary}`);
      this.detailText.setColor(TEXT_COLORS.muted);
    } else {
      this.detailText.setText('Recover cards to earn permanent bonuses — hover a slot for details');
      this.detailText.setColor(TEXT_COLORS.dim);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Scanner panel
  // ═══════════════════════════════════════════════════════════════════════

  private createScannerPanel(): void {
    this.scannerPanel = createMenuCard(this, {
      x: this.scannerX + this.offsetX,
      y: this.scannerY + this.offsetY,
      width: this.scannerW,
      height: this.scannerH,
      pulseSeed: 5,
      bodyFillColor: COLORS.bodyGold,
      accentColor: COLORS.accentGold,
      bannerHeight: 30,
      shadowOffsetY: 8,
      shadowOffsetX: 0,
      interactive: false,
    });
    const frame = this.scannerPanel.frame;
    const halfH = this.scannerH / 2;

    // Landscape: tall side column, elements stacked top-to-bottom.
    // Portrait: compact full-width bar — gold readout left, pity/cost middle,
    // DECRYPT right, result line along the bottom.
    const banner = makeDisplayText(this, 0, -halfH + 15, 'SCANNER', {
      fontSize: 15,
      color: COLORS.headingWhite,
      strokeWidth: 2,
      letterSpacing: 4,
    });
    frame.add(banner);

    const goldLabelPos = this.portrait ? { x: -190, y: -34 } : { x: 0, y: -halfH + 52 };
    const goldLabel = makeBodyText(this, goldLabelPos.x, goldLabelPos.y, 'GOLD RESERVE', {
      fontSize: 11,
      color: TEXT_COLORS.muted,
    });
    frame.add(goldLabel);

    const goldPos = this.portrait ? { x: -190, y: -8 } : { x: 0, y: -halfH + 76 };
    this.goldText = makeDisplayText(this, goldPos.x, goldPos.y, '', {
      fontSize: this.portrait ? 20 : 22,
      color: COLORS.headingGold,
      strokeWidth: 2,
      letterSpacing: 1,
    });
    frame.add(this.goldText);

    const pityPos = this.portrait ? { x: -30, y: -34 } : { x: 0, y: -halfH + 108 };
    this.pityText = makeBodyText(this, pityPos.x, pityPos.y, '', {
      fontSize: 12,
      color: TEXT_COLORS.muted,
      wordWrapWidth: this.portrait ? 220 : this.scannerW - 36,
    });
    frame.add(this.pityText);

    const costPos = this.portrait ? { x: -30, y: -6 } : { x: 0, y: -halfH + 136 };
    this.costText = makeBodyText(this, costPos.x, costPos.y, `DECRYPT COST · ${SCAN_COST} GOLD`, {
      fontSize: this.portrait ? 11 : 13,
      color: TEXT_COLORS.body,
      fontStyle: 'bold',
    });
    frame.add(this.costText);

    // Result banner — one line per reveal ("HULL PATCH RECOVERED · RARE").
    const resultPos = this.portrait ? { x: 0, y: halfH - 22 } : { x: 0, y: halfH - 60 };
    this.resultText = makeBodyText(this, resultPos.x, resultPos.y, 'Decrypt to recover a lost card', {
      fontSize: 12,
      color: TEXT_COLORS.dim,
      wordWrapWidth: this.portrait ? 560 : this.scannerW - 36,
    });
    frame.add(this.resultText);

    // DECRYPT button sits over the panel as its own object (MenuButton owns
    // an absolute-positioned card; embedding in frame would double-offset).
    this.decryptButton = createMenuButton({
      scene: this,
      x: this.decryptX + this.offsetX,
      y: this.decryptY + this.offsetY,
      width: this.decryptW,
      height: this.decryptH,
      label: `DECRYPT · ${SCAN_COST} G`,
      variant: 'gold',
      fontSize: this.decryptFontSize,
      onActivate: () => this.attemptDecrypt(),
    });
    this.decryptButton.card.hitZone.on('pointerover', () => this.decryptButton?.setHoverState(true));
    this.decryptButton.card.hitZone.on('pointerout', () => this.decryptButton?.setHoverState(false));
  }

  /** Refresh gold readout, pity hint, counter, and DECRYPT enabled state. */
  private updateScannerState(): void {
    const cardManager = getCardCollectionManager();
    const metaManager = getMetaProgressionManager();
    const complete = cardManager.getDiscoveredIds().size >= ALL_CARDS.length;

    this.goldText?.setText(metaManager.getGold().toLocaleString());
    this.updateCounter();

    if (complete) {
      this.pityText?.setText('ARCHIVE COMPLETE');
      this.pityText?.setColor(COLORS.accentGoldStr);
      this.costText?.setVisible(false);
      if (this.decryptButton) {
        // Clear focus glow BEFORE disabling — setFocusState no-ops once disabled.
        this.decryptButton.setFocusState(false);
        this.decryptButton.setLabel('ARCHIVE COMPLETE');
        this.decryptButton.setEnabled(false);
      }
      return;
    }

    const scansUntilPity = cardManager.getScansUntilPity();
    if (scansUntilPity <= 1) {
      this.pityText?.setText('EPIC+ GUARANTEED NEXT SCAN');
      this.pityText?.setColor(rarityColorStr('epic'));
    } else {
      this.pityText?.setText(`EPIC+ GUARANTEED IN ${scansUntilPity} SCANS`);
      this.pityText?.setColor(TEXT_COLORS.muted);
    }
  }

  private updateCounter(): void {
    const discoveredCount = getCardCollectionManager().getDiscoveredIds().size;
    this.counterText?.setText(`${discoveredCount} / ${ALL_CARDS.length} RECOVERED`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Decrypt (scanner lottery)
  // ═══════════════════════════════════════════════════════════════════════

  private attemptDecrypt(): void {
    const cardManager = getCardCollectionManager();
    const metaManager = getMetaProgressionManager();
    if (cardManager.getDiscoveredIds().size >= ALL_CARDS.length) return;

    if (metaManager.getGold() < SCAN_COST || !metaManager.spendGold(SCAN_COST)) {
      this.flashCostLine();
      return;
    }
    this.soundManager.playUIClick();

    const { card, pityUsed } = cardManager.scan();
    if (!card) {
      // Archive completed between the guard and the roll — refund, no reveal.
      metaManager.addGold(SCAN_COST);
      this.updateScannerState();
      return;
    }

    this.revealTile(card);

    if (this.resultText) {
      this.resultText.setText(
        `✦ ${card.name.toUpperCase()} RECOVERED · ${card.rarity.toUpperCase()}${pityUsed ? ' (PITY)' : ''}`,
      );
      this.resultText.setColor(rarityColorStr(card.rarity));
    }
    // Feed the collection milestones (may fire an unlock → deliverAchievement),
    // THEN refresh the readouts so the gold line includes any reward.
    getAchievementManager().recordCardsDiscovered(cardManager.getDiscoveredIds().size);
    this.updateScannerState();
  }

  /**
   * Menu-context achievement delivery — same reward semantics as GameScene's
   * unlock callback (gold + optional stat bonus), with a transient banner in
   * place of the in-run toast.
   */
  private deliverAchievement(achievement: AchievementDefinition): void {
    const metaManager = getMetaProgressionManager();
    const rewardParts: string[] = [];

    if (achievement.reward.type === 'gold') {
      metaManager.addGold(achievement.reward.value);
      rewardParts.push(achievement.reward.description);
    } else if (achievement.reward.type === 'stat_bonus' && achievement.reward.statBonusId) {
      metaManager.addAchievementBonus(achievement.reward.statBonusId, achievement.reward.value);
      rewardParts.push(achievement.reward.description);
    }
    if (achievement.bonusReward) {
      if (achievement.bonusReward.type === 'gold') {
        metaManager.addGold(achievement.bonusReward.value);
      } else if (achievement.bonusReward.type === 'stat_bonus' && achievement.bonusReward.statBonusId) {
        metaManager.addAchievementBonus(achievement.bonusReward.statBonusId, achievement.bonusReward.value);
      }
      rewardParts.push(achievement.bonusReward.description);
    }

    this.soundManager.playAchievementUnlock();
    this.updateScannerState();
    this.showAchievementBanner(achievement.name, rewardParts.join(' + '));
  }

  /** Transient gold banner between the title and the grid; self-destroys. */
  private showAchievementBanner(name: string, rewardText: string): void {
    const banner = makeDisplayText(
      this,
      this.gridCenterX + this.offsetX,
      this.bannerY + this.offsetY,
      `ACHIEVEMENT · ${name.toUpperCase()}${rewardText ? `  —  ${rewardText}` : ''}`,
      {
        fontSize: 13,
        color: COLORS.accentGoldStr,
        strokeWidth: 2,
        letterSpacing: 2,
      },
    );
    banner.setDepth(60);
    if (getSettingsManager().isReducedMotionEnabled()) {
      this.time.delayedCall(2800, () => banner.destroy());
      return;
    }
    banner.setAlpha(0);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 220,
      hold: 2400,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => banner.destroy(),
    });
  }

  /** Insufficient gold: flash the cost line danger-red. No purchase. */
  private flashCostLine(): void {
    if (!this.costText) return;
    const costText = this.costText;
    this.tweens.killTweensOf(costText);
    costText.setAlpha(1);
    costText.setColor(COLORS.danger);
    if (getSettingsManager().isReducedMotionEnabled()) {
      // Static signal — color only, restored after a beat.
      this.time.delayedCall(800, () => costText.setColor(COLORS.textBody));
      return;
    }
    this.tweens.add({
      targets: costText,
      alpha: 0.25,
      duration: 90,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        costText.setAlpha(1);
        costText.setColor(COLORS.textBody);
      },
    });
  }

  /** Replace the undiscovered slot with the revealed card and play the flip. */
  private revealTile(def: CardDefinition): void {
    const index = ALL_CARDS.findIndex((card) => card.id === def.id);
    if (index < 0) return;

    this.tiles[index]?.card.destroy();
    const entry = this.createTile(index, def, true);
    this.tiles[index] = entry;

    const { x, y } = this.tilePosition(index);
    const rarityColor = getCardRarityColor(def.rarity);
    const glow = this.add.graphics();
    glow.fillStyle(rarityColor, 0.18);
    glow.fillRoundedRect(-TILE_WIDTH / 2 - 8, -TILE_HEIGHT / 2 - 8, TILE_WIDTH + 16, TILE_HEIGHT + 16, 10);
    glow.lineStyle(3, rarityColor, 0.9);
    glow.strokeRoundedRect(-TILE_WIDTH / 2 - 3, -TILE_HEIGHT / 2 - 3, TILE_WIDTH + 6, TILE_HEIGHT + 6, 8);
    glow.setPosition(x, y);

    if (this.focusZone === 'grid' && this.selectedTileIndex === index) {
      entry.card.setFocusState(true);
    }
    this.showDetail(index);
    // Discovery flourish — distinct from the achievement chime so a scan that
    // also crosses a collection milestone doesn't double the same sound.
    this.soundManager.playWeaponEvolution();

    if (getSettingsManager().isReducedMotionEnabled()) {
      // Instant reveal + static glow that simply goes away — no flip, no pulse.
      glow.setAlpha(0.55);
      this.time.delayedCall(900, () => glow.destroy());
      return;
    }

    // Card-flip: the tile scales on from a vertical sliver while the rarity
    // glow pulses up and back down around it.
    entry.card.container.setScale(0, 1);
    this.tweens.add({
      targets: entry.card.container,
      scaleX: 1,
      duration: 280,
      ease: 'Back.easeOut',
      easeParams: [1.2],
    });
    glow.setAlpha(0);
    this.tweens.add({
      targets: glow,
      alpha: 0.8,
      duration: 200,
      yoyo: true,
      hold: 140,
      ease: 'Sine.Out',
      onComplete: () => glow.destroy(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Keyboard / gamepad navigation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Vertical item list mirroring the layout (AchievementScene pattern):
   * one item per grid row (left/right steps within the row), then the
   * DECRYPT button, then BACK. B / Escape returns to the menu.
   */
  private buildMenuNavigator(): void {
    this.menuNavigator?.destroy();

    const items: NavigableItem[] = [];
    const totalTiles = this.tiles.length;
    const totalRows = Math.ceil(totalTiles / this.gridColumns);

    for (let row = 0; row < totalRows; row++) {
      const rowStart = row * this.gridColumns;
      const rowEnd = Math.min(rowStart + this.gridColumns - 1, totalTiles - 1);
      items.push({
        onFocus: () => {
          this.focusZone = 'grid';
          const preferredCol = this.selectedTileIndex % this.gridColumns;
          this.selectedTileIndex = Math.min(rowStart + preferredCol, rowEnd);
          this.updateFocusVisuals();
        },
        onBlur: () => this.updateFocusVisuals(),
        onActivate: () => {
          // Tiles are informational — the detail line already shows on focus.
        },
        onLeft: () => {
          const col = this.selectedTileIndex % this.gridColumns;
          this.selectedTileIndex = col > 0 ? this.selectedTileIndex - 1 : rowEnd;
          this.updateFocusVisuals();
        },
        onRight: () => {
          const col = this.selectedTileIndex % this.gridColumns;
          this.selectedTileIndex =
            col < this.gridColumns - 1 && this.selectedTileIndex < rowEnd
              ? this.selectedTileIndex + 1
              : rowStart;
          this.updateFocusVisuals();
        },
      });
    }

    items.push({
      onFocus: () => {
        this.focusZone = 'scanner';
        this.updateFocusVisuals();
      },
      onBlur: () => this.updateFocusVisuals(),
      onActivate: () => this.attemptDecrypt(),
    });

    items.push({
      onFocus: () => {
        this.focusZone = 'back';
        this.updateFocusVisuals();
      },
      onBlur: () => this.updateFocusVisuals(),
      onActivate: () => this.goBack(),
    });

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items,
      columns: 1,
      wrap: true,
      onCancel: () => this.goBack(),
    });
  }

  private updateFocusVisuals(): void {
    this.tiles.forEach((tile, index) => {
      tile.card.setFocusState(this.focusZone === 'grid' && this.selectedTileIndex === index);
    });
    this.decryptButton?.setFocusState(this.focusZone === 'scanner');
    this.backButton?.setFocusState(this.focusZone === 'back');

    if (this.focusZone === 'grid') {
      this.showDetail(this.selectedTileIndex);
    } else {
      this.showDefaultDetail();
    }
  }

  private goBack(): void {
    this.soundManager.playUIClick();
    transitionToScene(this, 'BootScene');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Shutdown
  // ═══════════════════════════════════════════════════════════════════════

  shutdown(): void {
    // Detach the menu-context delivery closure — a dead scene must not receive
    // unlocks. GameScene re-wires its own callback at run start.
    getAchievementManager().setAchievementUnlockCallback(null);
    if (this.updateHandler) {
      this.events.off(Phaser.Scenes.Events.UPDATE, this.updateHandler);
      this.updateHandler = null;
    }
    this.menuNavigator?.destroy();
    this.menuNavigator = null;

    for (const tile of this.tiles) tile.card.destroy();
    this.tiles = [];
    this.scannerPanel?.destroy();
    this.scannerPanel = null;
    this.decryptButton?.destroy();
    this.decryptButton = null;
    this.backButton?.destroy();
    this.backButton = null;

    this.menuBackground?.destroy();
    this.menuBackground = null;

    this.counterText = null;
    this.goldText = null;
    this.pityText = null;
    this.costText = null;
    this.resultText = null;
    this.detailText = null;

    // Tiles can die mid-flip (reveal tween) — kill everything.
    this.tweens.killAll();
  }
}
