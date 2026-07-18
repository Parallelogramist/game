import Phaser from 'phaser';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { THREAT_TIERS, clampThreatTier, type ThreatTier } from '../../data/ThreatTiers';
import { loadThreatBest, loadThreatLastSelected, saveThreatLastSelected } from '../../meta/ThreatProgress';
import { saveLastLoadout } from '../../meta/LastLoadout';
import type { DirectorStrategy } from '../../systems/DirectorSystem';
import { rollModifierChoices } from '../../data/RunModifiers';

/**
 * Data threaded through from DirectorSelectScene; forwarded verbatim to GameScene
 * with the chosen threatLevel appended.
 */
export interface ThreatSelectSceneData {
  restore?: boolean;
  startingWeapon: string;
  shipId?: string;
  stageId?: string;
  modifierIds?: string[];
  pactIds?: string[];
  gauntletMode?: boolean;
  directorStrategy?: DirectorStrategy;
}

interface ThreatSelectLaunchData extends ThreatSelectSceneData {
  relayout?: boolean;
}

interface ThreatCard {
  tier: ThreatTier;
  container: Phaser.GameObjects.Container;
  border: Phaser.GameObjects.Rectangle;
  bg: Phaser.GameObjects.Rectangle;
  selectedBadge: Phaser.GameObjects.Text;
}

/**
 * Pre-run Threat Level picker — single-select. Scales enemy HP/damage and gold
 * reward for the run (tier 0 = unchanged). Inserted between DirectorSelectScene
 * and GameScene; the final pre-run gate.
 */
export class ThreatSelectScene extends Phaser.Scene {
  private passthrough: ThreatSelectSceneData = { startingWeapon: 'projectile' };
  private selectedIndex: number = 0;
  private cards: ThreatCard[] = [];
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private isStarting: boolean = false;

  constructor() {
    super({ key: 'ThreatSelectScene' });
  }

  init(data?: ThreatSelectLaunchData): void {
    // A flip restarts this scene to re-fit the new canvas; the tier already chosen
    // is the player's input and must survive it. A fresh entry defaults to the last
    // tier played. `relayout` is destructured off here so it can never ride along to
    // GameScene via passthrough.
    const { relayout, ...launch }: ThreatSelectLaunchData = data ?? { startingWeapon: 'projectile' };
    this.passthrough = launch;
    if (relayout !== true) this.selectedIndex = clampThreatTier(loadThreatLastSelected());
    this.cards = [];
    this.menuNavigator = null;
    this.isStarting = false;
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor('#140a0a');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    this.add.text(width / 2, 54, 'SET THREAT LEVEL', {
      fontSize: '44px',
      color: '#ff6644',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setLetterSpacing(3);

    this.add.text(width / 2, 100, 'Raise the stakes — tougher enemies, richer rewards.', {
      fontSize: '17px',
      color: '#bb9999',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    const best = loadThreatBest();
    this.add.text(width / 2, 126, best > 0 ? `Highest cleared: THREAT ${best}` : 'Highest cleared: none yet', {
      fontSize: '15px',
      color: '#ffcc66',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Threat cards in centered rows; narrow (portrait) viewports wrap the row.
    const cardWidth = 210;
    const cardHeight = 200;
    const gap = 18;
    const count = THREAT_TIERS.length;
    const perRow = Math.min(count, Math.max(1, Math.floor((width - 16 + gap) / (cardWidth + gap))));
    const rowCount = Math.ceil(count / perRow);
    const rowSpacing = cardHeight + 24;
    const totalGridHeight = rowCount * cardHeight + (rowCount - 1) * 24;
    // Center rows on the anchor; keep the last row clear of the BEGIN button
    // (top edge at height - 90).
    const firstRowY = Math.min(
      height / 2 + 4 - totalGridHeight / 2 + cardHeight / 2,
      height - 90 - 12 - cardHeight / 2 - (rowCount - 1) * rowSpacing,
    );

    THREAT_TIERS.forEach((tier, index) => {
      const rowIndex = Math.floor(index / perRow);
      const cardsInRow = Math.min(perRow, count - rowIndex * perRow);
      const rowWidth = cardsInRow * cardWidth + (cardsInRow - 1) * gap;
      const cardX = (width - rowWidth) / 2 + cardWidth / 2 + (index % perRow) * (cardWidth + gap);
      const cardY = firstRowY + rowIndex * rowSpacing;
      this.cards.push(this.createCard(tier, cardX, cardY, cardWidth, cardHeight, index, best));
    });

    // Begin button.
    const beginButton = this.add.rectangle(width / 2, height - 64, 260, 52, 0x223322)
      .setStrokeStyle(3, 0x66ff99)
      .setInteractive({ useHandCursor: true });
    const beginLabel = this.add.text(width / 2, height - 64, 'BEGIN RUN', {
      fontSize: '22px',
      color: '#88ffaa',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    beginButton.on('pointerover', () => this.menuNavigator?.selectIndex(count));
    beginButton.on('pointerup', () => this.beginRun());
    void beginLabel;

    // Keyboard + gamepad navigation: tier cards in a row, BEGIN RUN below.
    // Enter/Space/A activates the focused element; Escape/B begins with the
    // current selection.
    const navigableItems: NavigableItem[] = this.cards.map((card, index) => ({
      onFocus: () => this.setCardFocus(card, true),
      onBlur: () => this.setCardFocus(card, false),
      onActivate: () => this.selectTier(index),
    }));
    navigableItems.push({
      onFocus: () => beginButton.setFillStyle(0x2e4a2e),
      onBlur: () => beginButton.setFillStyle(0x223322),
      onActivate: () => this.beginRun(),
    });
    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: perRow,
      wrap: true,
      onCancel: () => this.beginRun(),
    });
    // Focus the remembered tier so the keyboard/pad ring and the painted selection
    // start in agreement (the sticky default may be non-zero).
    this.menuNavigator.selectIndex(this.selectedIndex);

    // Number keys 1-6 stay as quick-select shortcuts; the navigator owns the rest.
    this.keydownHandler = (event: KeyboardEvent) => {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= count) this.selectTier(num - 1);
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
  }

  /**
   * Keyboard/gamepad focus ring — a THIN WHITE outline, deliberately unlike the
   * thick green SELECTED treatment (mirrors DirectorSelectScene: the focus ring
   * must never read as a stuck selection, especially on touch where nothing blurs
   * it).
   */
  private setCardFocus(card: ThreatCard, focused: boolean): void {
    if (focused) {
      card.bg.setStrokeStyle(2, 0xffffff, 0.8);
    } else {
      card.bg.setStrokeStyle(2, 0x333344);
    }
  }

  /**
   * The SELECTED treatment, in one place. A re-layout restart rebuilds every card
   * from scratch, so the rebuild and a tap must paint identically. Single-select:
   * exactly one tier is chosen at a time. Touches bg's FILL only; its stroke is the
   * focus ring (setCardFocus).
   */
  private paintCardSelection(card: ThreatCard, selected: boolean): void {
    card.border.setVisible(selected);
    card.selectedBadge.setVisible(selected);
    card.bg.setFillStyle(selected ? 0x251818 : 0x14141f);
    card.container.setScale(selected ? 1.04 : 1);
  }

  private createCard(tier: ThreatTier, x: number, y: number, w: number, h: number, index: number, best: number): ThreatCard {
    const container = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, w, h, 0x14141f).setStrokeStyle(2, 0x333344);
    // Selection treatment is UNIFORM green; the per-tier accent color stays on the
    // name text only, so "selected" always looks the same card to card.
    const border = this.add.rectangle(0, 0, w, h).setStrokeStyle(4, 0x66ff99).setVisible(false);

    const name = this.add.text(0, -h / 2 + 30, tier.name, {
      fontSize: '22px',
      color: `#${tier.color.toString(16).padStart(6, '0')}`,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 20 },
    }).setOrigin(0.5, 0);

    const description = this.add.text(0, -6, tier.description, {
      fontSize: '14px',
      color: '#dcc4c4',
      fontFamily: 'Arial',
      align: 'center',
      wordWrap: { width: w - 28 },
    }).setOrigin(0.5);

    const reward = this.add.text(0, h / 2 - 52, tier.reward, {
      fontSize: '15px',
      color: '#ffdd66',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 24 },
    }).setOrigin(0.5);

    const keyHint = this.add.text(0, h / 2 - 18, `[ ${index + 1} ]`, {
      fontSize: '13px', color: '#666688', fontFamily: 'monospace',
    }).setOrigin(0.5);

    const selectedBadge = this.add.text(0, -h / 2 + 8, '✓ SELECTED', {
      fontSize: '12px',
      color: '#0a140d',
      backgroundColor: '#66ff99',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      padding: { x: 8, y: 2 },
    }).setOrigin(0.5, 1).setVisible(false);

    container.add([bg, border, name, description, reward, keyHint, selectedBadge]);

    // Chase marker: a static gold tag on the tier equal to the persisted best
    // cleared (tier 0 never shows it — clearing "normal" is not a chase rung).
    if (tier.tier > 0 && tier.tier === best) {
      const clearedTag = this.add.text(0, h / 2 - 2, '◆ CLEARED', {
        fontSize: '11px', color: '#ffcc66', fontFamily: 'monospace',
      }).setOrigin(0.5, 1);
      container.add(clearedTag);
    }

    bg.setInteractive({ useHandCursor: true });
    // Hover-follows-mouse only: on touch, a tap fires pointerover with no pointerout
    // ever following, which would strand the focus ring on the last card tapped.
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) this.menuNavigator?.selectIndex(index);
    });
    bg.on('pointerup', () => this.selectTier(index));

    const card: ThreatCard = { tier, container, border, bg, selectedBadge };
    this.paintCardSelection(card, index === this.selectedIndex);
    return card;
  }

  private selectTier(index: number): void {
    if (index < 0 || index >= this.cards.length) return;
    this.selectedIndex = index;
    this.cards.forEach((card, cardIndex) => this.paintCardSelection(card, cardIndex === index));
  }

  private beginRun(): void {
    if (this.isStarting) return; // guard against a second click during the fade
    this.isStarting = true;
    this.input.keyboard?.removeAllListeners();
    const tier = THREAT_TIERS[this.selectedIndex]?.tier ?? 0;
    saveThreatLastSelected(tier);
    saveLastLoadout({
      startingWeapon: this.passthrough.startingWeapon,
      shipId: this.passthrough.shipId,
      stageId: this.passthrough.stageId,
      pactIds: this.passthrough.pactIds ?? [],
      directorStrategy: this.passthrough.directorStrategy,
      threatLevel: tier,
      gauntletMode: this.passthrough.gauntletMode === true,
    });
    this.cameras.main.fadeOut(150, 0, 0, 0);
    this.time.delayedCall(160, () => {
      // FEAT-MODIFIER-DRAFT: the funnel's final step is now the modifier draft,
      // which produces the run's modifierIds. The 2 modifiers WeaponSelectScene
      // rolled into `this.passthrough.modifierIds` are moot on the funnel path and
      // are intentionally NOT forwarded — the draft rolls 6 fresh candidates and
      // the player picks 2.
      this.scene.start('ModifierDraftScene', {
        restore: false,
        startingWeapon: this.passthrough.startingWeapon,
        shipId: this.passthrough.shipId,
        stageId: this.passthrough.stageId,
        pactIds: this.passthrough.pactIds ?? [],
        gauntletMode: this.passthrough.gauntletMode === true,
        directorStrategy: this.passthrough.directorStrategy,
        threatLevel: tier,
        modifierChoiceIds: rollModifierChoices(6).map((modifier) => modifier.id),
      });
    });
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.tweens.killAll();
  }
}
