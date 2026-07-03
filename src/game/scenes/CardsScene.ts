/**
 * CardsScene — the CARD ARCHIVE collection screen + Scanner lottery.
 *
 * Left: 6-column grid of the 24 collectible cards. Undiscovered slots are
 * dark with a rarity-colored hairline frame and a "?" glyph; discovered
 * slots are mini MenuCards with icon, name banner, bonus line, and rarity
 * tag. Right: the Scanner panel — gold readout, pity hint, and the DECRYPT
 * button (spends gold via MetaProgressionManager, then rolls via
 * CardCollectionManager.scan()). A successful scan flips the revealed tile
 * on with a rarity glow pulse (reduced motion: instant + static glow).
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

// ─── Grid geometry (1280×720 design space, centered in the live viewport) ──
// The game scales with Phaser.Scale.EXPAND, so the real scale.width/height can
// exceed the base on one axis; create() computes per-axis offsets that center
// this fixed composition (sibling scenes re-anchor to scale.width/height the
// same way). The spec sketches ~150×190 tiles, but 4 rows of 190px cannot fit
// a 720px viewport alongside the header and detail line without scrolling — a
// fixed 24-card archive reads better as one screen, so tiles are 148×134.
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const GRID_COLUMNS = 6;
const TILE_WIDTH = 148;
const TILE_HEIGHT = 134;
const TILE_GAP_X = 10;
const TILE_GAP_Y = 10;
const GRID_LEFT = 24;
const GRID_TOP = 78;
/** Horizontal center of the grid block — title + detail line align to it. */
const GRID_CENTER_X =
  GRID_LEFT + (GRID_COLUMNS * TILE_WIDTH + (GRID_COLUMNS - 1) * TILE_GAP_X) / 2;

// ─── Scanner column ─────────────────────────────────────────────────────────
const SCANNER_X = 1120;
const SCANNER_PANEL_Y = 291;
const SCANNER_PANEL_WIDTH = 296;
const SCANNER_PANEL_HEIGHT = 330;
const DECRYPT_BUTTON_Y = 316;
const BACK_BUTTON_Y = 640;

const DETAIL_LINE_Y = 672;

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

  /** Viewport-centering offsets for the 1280×720 design space (EXPAND scale). */
  private offsetX = 0;
  private offsetY = 0;

  constructor() {
    super({ key: 'CardsScene' });
  }

  create(): void {
    this.soundManager = new SoundManager(this);
    this.tiles = [];
    this.focusZone = 'grid';
    this.selectedTileIndex = 0;

    // EXPAND keeps one axis at the base size and grows the other — these are
    // never negative, they just center the composition on the grown axis.
    this.offsetX = Math.max(0, (this.scale.width - DESIGN_WIDTH) / 2);
    this.offsetY = Math.max(0, (this.scale.height - DESIGN_HEIGHT) / 2);

    this.menuBackground = createMenuBackground(this);

    const cardManager = getCardCollectionManager();

    // ─── header ─────────────────────────────────────────────────────────
    const title = makeDisplayText(this, GRID_CENTER_X + this.offsetX, 40 + this.offsetY, 'CARD ARCHIVE', {
      fontSize: 30,
      color: COLORS.accentPrimaryStr,
      strokeWidth: 4,
      letterSpacing: 4,
    });

    this.counterText = makeDisplayText(this, SCANNER_X + this.offsetX, 40 + this.offsetY, '', {
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
    this.detailText = makeBodyText(this, GRID_CENTER_X + this.offsetX, DETAIL_LINE_Y + this.offsetY, '', {
      fontSize: 13,
      color: TEXT_COLORS.muted,
      wordWrapWidth: 920,
    });
    this.showDefaultDetail();

    // ─── scanner panel + buttons ────────────────────────────────────────
    this.createScannerPanel();

    this.backButton = createMenuButton({
      scene: this,
      x: SCANNER_X + this.offsetX,
      y: BACK_BUTTON_Y + this.offsetY,
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
    const col = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    return {
      x: GRID_LEFT + TILE_WIDTH / 2 + col * (TILE_WIDTH + TILE_GAP_X) + this.offsetX,
      y: GRID_TOP + TILE_HEIGHT / 2 + row * (TILE_HEIGHT + TILE_GAP_Y) + this.offsetY,
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
      x: SCANNER_X + this.offsetX,
      y: SCANNER_PANEL_Y + this.offsetY,
      width: SCANNER_PANEL_WIDTH,
      height: SCANNER_PANEL_HEIGHT,
      pulseSeed: 5,
      bodyFillColor: COLORS.bodyGold,
      accentColor: COLORS.accentGold,
      bannerHeight: 30,
      shadowOffsetY: 8,
      shadowOffsetX: 0,
      interactive: false,
    });
    const frame = this.scannerPanel.frame;
    const halfH = SCANNER_PANEL_HEIGHT / 2;

    const banner = makeDisplayText(this, 0, -halfH + 15, 'SCANNER', {
      fontSize: 15,
      color: COLORS.headingWhite,
      strokeWidth: 2,
      letterSpacing: 4,
    });
    frame.add(banner);

    const goldLabel = makeBodyText(this, 0, -halfH + 52, 'GOLD RESERVE', {
      fontSize: 11,
      color: TEXT_COLORS.muted,
    });
    frame.add(goldLabel);

    this.goldText = makeDisplayText(this, 0, -halfH + 76, '', {
      fontSize: 22,
      color: COLORS.headingGold,
      strokeWidth: 2,
      letterSpacing: 1,
    });
    frame.add(this.goldText);

    this.pityText = makeBodyText(this, 0, -halfH + 108, '', {
      fontSize: 12,
      color: TEXT_COLORS.muted,
      wordWrapWidth: SCANNER_PANEL_WIDTH - 36,
    });
    frame.add(this.pityText);

    this.costText = makeBodyText(this, 0, -halfH + 136, `DECRYPT COST · ${SCAN_COST} GOLD`, {
      fontSize: 13,
      color: TEXT_COLORS.body,
      fontStyle: 'bold',
    });
    frame.add(this.costText);

    // Result banner — one line per reveal ("HULL PATCH RECOVERED · RARE").
    this.resultText = makeBodyText(this, 0, halfH - 60, 'Decrypt to recover a lost card', {
      fontSize: 12,
      color: TEXT_COLORS.dim,
      wordWrapWidth: SCANNER_PANEL_WIDTH - 36,
    });
    frame.add(this.resultText);

    // DECRYPT button sits over the panel as its own object (MenuButton owns
    // an absolute-positioned card; embedding in frame would double-offset).
    this.decryptButton = createMenuButton({
      scene: this,
      x: SCANNER_X + this.offsetX,
      y: DECRYPT_BUTTON_Y + this.offsetY,
      width: 240,
      height: 50,
      label: `DECRYPT · ${SCAN_COST} G`,
      variant: 'gold',
      fontSize: 16,
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
      GRID_CENTER_X + this.offsetX,
      62 + this.offsetY,
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
    const totalRows = Math.ceil(totalTiles / GRID_COLUMNS);

    for (let row = 0; row < totalRows; row++) {
      const rowStart = row * GRID_COLUMNS;
      const rowEnd = Math.min(rowStart + GRID_COLUMNS - 1, totalTiles - 1);
      items.push({
        onFocus: () => {
          this.focusZone = 'grid';
          const preferredCol = this.selectedTileIndex % GRID_COLUMNS;
          this.selectedTileIndex = Math.min(rowStart + preferredCol, rowEnd);
          this.updateFocusVisuals();
        },
        onBlur: () => this.updateFocusVisuals(),
        onActivate: () => {
          // Tiles are informational — the detail line already shows on focus.
        },
        onLeft: () => {
          const col = this.selectedTileIndex % GRID_COLUMNS;
          this.selectedTileIndex = col > 0 ? this.selectedTileIndex - 1 : rowEnd;
          this.updateFocusVisuals();
        },
        onRight: () => {
          const col = this.selectedTileIndex % GRID_COLUMNS;
          this.selectedTileIndex =
            col < GRID_COLUMNS - 1 && this.selectedTileIndex < rowEnd
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
