import Phaser from 'phaser';
import { RunModifier, getModifierById } from '../../data/RunModifiers';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import type { DirectorStrategy } from '../../systems/DirectorSystem';

/**
 * Data threaded through from ThreatSelectScene. `modifierChoiceIds` is the fixed
 * set of candidate modifiers rolled ONCE at the Threat -> draft transition; the
 * scene renders them and forwards the 2 the player picks to GameScene as
 * `modifierIds` (the existing run-modifier consumption path). Passing the
 * candidates as launch data (not rolling them here) is what makes an
 * orientation-flip re-render the SAME cards instead of re-rolling them.
 */
export interface ModifierDraftSceneData {
  restore?: boolean;
  startingWeapon: string;
  shipId?: string;
  stageId?: string;
  pactIds?: string[];
  gauntletMode?: boolean;
  directorStrategy?: DirectorStrategy;
  threatLevel?: number;
  modifierChoiceIds: string[];
}

/**
 * What the scene is actually started with. `relayout` is set only by main.ts's
 * orientation watcher; init() strips it back out so it can never reach GameScene.
 */
interface ModifierDraftLaunchData extends ModifierDraftSceneData {
  relayout?: boolean;
}

interface ModifierCard {
  modifier: RunModifier;
  container: Phaser.GameObjects.Container;
  border: Phaser.GameObjects.Rectangle;
  bg: Phaser.GameObjects.Rectangle;
  selectedBadge: Phaser.GameObjects.Text;
}

const CATEGORY_COLOR: Record<string, string> = {
  offense: '#ff6655',
  defense: '#5599ff',
  resources: '#ffcc44',
  chaos: '#cc66ff',
};

const CATEGORY_LABEL: Record<string, string> = {
  offense: 'OFFENSE',
  defense: 'DEFENSE',
  resources: 'RESOURCES',
  chaos: 'CHAOS',
};

/**
 * Pre-run modifier draft (FEAT-MODIFIER-DRAFT). The funnel's final pre-run step:
 * the player picks EXACTLY 2 of the offered run modifiers (each a double-edged
 * trade-off). Picking exactly 2 keeps parity with the old auto-rolled count, so
 * only WHICH 2 is a new choice, not how many. Inserted between ThreatSelectScene
 * and GameScene; every other GameScene-start path (daily/restore/replay/practice)
 * is deliberately excluded (see plan) and never reaches this scene.
 */
export class ModifierDraftScene extends Phaser.Scene {
  private passthrough: ModifierDraftSceneData = { startingWeapon: 'projectile', modifierChoiceIds: [] };
  private choices: RunModifier[] = [];
  private requiredPicks: number = 2;
  private selectedIds: Set<string> = new Set();
  private cards: ModifierCard[] = [];
  private counterText: Phaser.GameObjects.Text | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private isStarting: boolean = false;

  constructor() {
    super({ key: 'ModifierDraftScene' });
  }

  init(data?: ModifierDraftLaunchData): void {
    // A flip restarts this scene to re-fit the new canvas; the candidate set
    // (launch data) and the picks so far are the player's composed input and must
    // survive it. A fresh entry still starts with no picks. `relayout` is
    // destructured off so it can never ride along to GameScene via passthrough.
    const { relayout, ...launch }: ModifierDraftLaunchData =
      data ?? { startingWeapon: 'projectile', modifierChoiceIds: [] };
    this.passthrough = launch;
    this.choices = (launch.modifierChoiceIds ?? [])
      .map((id) => getModifierById(id))
      .filter((modifier): modifier is RunModifier => modifier !== undefined);
    this.requiredPicks = Math.min(2, this.choices.length);
    if (relayout !== true) this.selectedIds = new Set();
    this.cards = [];
    this.menuNavigator = null;
    this.isStarting = false;
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor('#0a0a14');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    // Degenerate guard: with fewer than 2 valid candidates there is nothing to
    // draft (impossible on the real funnel, which always offers 6) — skip
    // straight into the run rather than showing a screen that can never START.
    if (this.choices.length < 2) {
      this.startRun([...this.choices.map((modifier) => modifier.id)]);
      return;
    }

    this.add.text(width / 2, 54, 'TUNE YOUR RUN', {
      fontSize: '44px',
      color: '#66ccff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setLetterSpacing(3);

    this.add.text(width / 2, 102, `Draft ${this.requiredPicks} run modifiers — each is a double-edged trade-off.`, {
      fontSize: '17px',
      color: '#9999bb',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    this.counterText = this.add.text(width / 2, 132, '', {
      fontSize: '15px',
      color: '#66ff99',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setLetterSpacing(1);
    this.updateCounter();

    // Modifier cards in centered rows; narrow (portrait) viewports wrap the row.
    const cardWidth = 220;
    const cardHeight = 210;
    const gap = 18;
    const count = this.choices.length;
    const perRow = Math.min(count, Math.max(1, Math.floor((width - 16 + gap) / (cardWidth + gap))));
    const rowCount = Math.ceil(count / perRow);
    const rowSpacing = cardHeight + 24;
    const totalGridHeight = rowCount * cardHeight + (rowCount - 1) * 24;
    const firstRowY = Math.min(
      height / 2 - 10 - totalGridHeight / 2 + cardHeight / 2,
      height - 90 - 12 - cardHeight / 2 - (rowCount - 1) * rowSpacing,
    );

    this.choices.forEach((modifier, index) => {
      const rowIndex = Math.floor(index / perRow);
      const cardsInRow = Math.min(perRow, count - rowIndex * perRow);
      const rowWidth = cardsInRow * cardWidth + (cardsInRow - 1) * gap;
      const cardX = (width - rowWidth) / 2 + cardWidth / 2 + (index % perRow) * (cardWidth + gap);
      const cardY = firstRowY + rowIndex * rowSpacing;
      this.cards.push(this.createCard(modifier, cardX, cardY, cardWidth, cardHeight, index));
    });

    const startButton = this.add.rectangle(width / 2, height - 64, 260, 52, 0x223322)
      .setStrokeStyle(3, 0x66ff99)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height - 64, 'START RUN', {
      fontSize: '22px',
      color: '#88ffaa',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    startButton.on('pointerover', () => this.menuNavigator?.selectIndex(count));
    startButton.on('pointerup', () => this.beginRun());

    const navigableItems: NavigableItem[] = this.cards.map((card, index) => ({
      onFocus: () => this.setCardFocus(card, true),
      onBlur: () => this.setCardFocus(card, false),
      onActivate: () => this.toggleModifier(index),
    }));
    navigableItems.push({
      onFocus: () => startButton.setFillStyle(0x2e4a2e),
      onBlur: () => startButton.setFillStyle(0x223322),
      onActivate: () => this.beginRun(),
    });
    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: perRow,
      wrap: true,
      // Escape/B cannot skip — exactly `requiredPicks` modifiers are mandatory.
      onCancel: () => this.flashRequirement(),
    });

    this.keydownHandler = (event: KeyboardEvent) => {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= count) this.toggleModifier(num - 1);
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
  }

  /**
   * Keyboard/gamepad focus ring — a THIN WHITE outline, deliberately unlike the
   * thick green SELECTED treatment (mirrors PactSelectScene).
   */
  private setCardFocus(card: ModifierCard, focused: boolean): void {
    if (focused) {
      card.bg.setStrokeStyle(2, 0xffffff, 0.8);
    } else {
      card.bg.setStrokeStyle(2, 0x333344);
    }
  }

  /**
   * The SELECTED treatment, in one place. A re-layout restart rebuilds every card
   * from scratch, so the rebuild and a tap must paint identically — otherwise a
   * preserved pick shows as an unselected card. Touches bg's FILL only; its stroke
   * is the focus ring (setCardFocus).
   */
  private paintCardSelection(card: ModifierCard, selected: boolean): void {
    card.border.setVisible(selected);
    card.selectedBadge.setVisible(selected);
    card.bg.setFillStyle(selected ? 0x18251c : 0x14141f);
    card.container.setScale(selected ? 1.04 : 1);
  }

  private updateCounter(): void {
    if (!this.counterText) return;
    const count = this.selectedIds.size;
    const ready = count === this.requiredPicks;
    this.counterText.setText(
      ready ? `${count} / ${this.requiredPicks} — READY TO START` : `${count} / ${this.requiredPicks} SELECTED`,
    );
    this.counterText.setColor(ready ? '#66ff99' : '#778899');
  }

  /** Requirement feedback — flash the counter instead of silently ignoring. */
  private flashRequirement(): void {
    if (!this.counterText) return;
    const counter = this.counterText;
    this.tweens.killTweensOf(counter);
    counter.setColor('#ff6666');
    counter.setText(`PICK EXACTLY ${this.requiredPicks}`);
    this.time.delayedCall(700, () => this.updateCounter());
  }

  private createCard(modifier: RunModifier, x: number, y: number, w: number, h: number, index: number): ModifierCard {
    const container = this.add.container(x, y);
    const accent = CATEGORY_COLOR[modifier.category] ?? '#cfd6e6';

    const bg = this.add.rectangle(0, 0, w, h, 0x14141f).setStrokeStyle(2, 0x333344);
    const border = this.add.rectangle(0, 0, w, h).setStrokeStyle(4, 0x66ff99).setVisible(false);

    const name = this.add.text(0, -h / 2 + 26, modifier.name.toUpperCase(), {
      fontSize: '18px',
      color: accent,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 20 },
    }).setOrigin(0.5, 0);

    const categoryTag = this.add.text(0, -h / 2 + 56, CATEGORY_LABEL[modifier.category] ?? modifier.category.toUpperCase(), {
      fontSize: '12px',
      color: accent,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setLetterSpacing(2);

    const description = this.add.text(0, 6, modifier.description, {
      fontSize: '16px',
      color: '#cfd6e6',
      fontFamily: 'Arial',
      align: 'center',
      wordWrap: { width: w - 28 },
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

    container.add([bg, border, name, categoryTag, description, keyHint, selectedBadge]);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) this.menuNavigator?.selectIndex(index);
    });
    bg.on('pointerup', () => this.toggleModifier(index));

    const card: ModifierCard = { modifier, container, border, bg, selectedBadge };
    this.paintCardSelection(card, this.selectedIds.has(modifier.id));
    return card;
  }

  private toggleModifier(index: number): void {
    const card = this.cards[index];
    if (!card) return;
    const id = card.modifier.id;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      this.paintCardSelection(card, false);
    } else {
      if (this.selectedIds.size >= this.requiredPicks) {
        this.flashRequirement();
        return;
      }
      this.selectedIds.add(id);
      this.paintCardSelection(card, true);
    }
    this.updateCounter();
  }

  private beginRun(): void {
    if (this.isStarting) return; // guard against a second click during the fade
    if (this.selectedIds.size !== this.requiredPicks) {
      this.flashRequirement();
      return;
    }
    this.startRun([...this.selectedIds]);
  }

  private startRun(modifierIds: string[]): void {
    if (this.isStarting) return;
    this.isStarting = true;
    this.input.keyboard?.removeAllListeners();
    this.cameras.main.fadeOut(150, 0, 0, 0);
    this.time.delayedCall(160, () => {
      this.scene.start('GameScene', {
        restore: false,
        startingWeapon: this.passthrough.startingWeapon,
        shipId: this.passthrough.shipId,
        stageId: this.passthrough.stageId,
        modifierIds,
        pactIds: this.passthrough.pactIds ?? [],
        gauntletMode: this.passthrough.gauntletMode === true,
        directorStrategy: this.passthrough.directorStrategy,
        threatLevel: this.passthrough.threatLevel,
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
