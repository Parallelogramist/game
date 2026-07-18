import Phaser from 'phaser';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import type { DirectorStrategy } from '../../systems/DirectorSystem';

/**
 * Data threaded through from PactSelectScene; forwarded verbatim to GameScene
 * with the chosen directorStrategy appended.
 */
export interface DirectorSelectSceneData {
  restore?: boolean;
  startingWeapon: string;
  shipId?: string;
  stageId?: string;
  modifierIds?: string[];
  pactIds?: string[];
  gauntletMode?: boolean;
}

/**
 * What the scene is actually started with. `relayout` is set only by main.ts's
 * orientation watcher; init() strips it back out so it can never reach GameScene.
 */
interface DirectorSelectLaunchData extends DirectorSelectSceneData {
  relayout?: boolean;
}

interface DirectiveOption {
  /** null = let the director roll a random strategy (the classic experience). */
  readonly strategy: DirectorStrategy | null;
  readonly name: string;
  readonly description: string;
  readonly color: number;
}

const DIRECTIVE_OPTIONS: readonly DirectiveOption[] = [
  { strategy: null,       name: 'Random',   description: 'The director rolls a strategy at random. The classic experience.', color: 0xaaaaaa },
  { strategy: 'swarm',    name: 'Swarm',    description: 'Endless waves of weak enemies. Very few elites.',                   color: 0xff8844 },
  { strategy: 'elite',    name: 'Elite',    description: 'Fewer enemies, but far more elites and heavy hitters.',            color: 0xff4466 },
  { strategy: 'balanced', name: 'Balanced', description: 'A steady, even mix of weak and elite enemies.',                    color: 0x66ccff },
  { strategy: 'chaos',    name: 'Chaos',    description: 'Unpredictable — heavy on both swarms and elites at once.',         color: 0xaa44ff },
];

interface DirectiveCard {
  option: DirectiveOption;
  container: Phaser.GameObjects.Container;
  border: Phaser.GameObjects.Rectangle;
  bg: Phaser.GameObjects.Rectangle;
  selectedBadge: Phaser.GameObjects.Text;
}

/**
 * Pre-run directive picker — single-select. Chooses how the difficulty director
 * shapes enemy composition for the run (or leaves it random). Inserted between
 * PactSelectScene and GameScene.
 */
export class DirectorSelectScene extends Phaser.Scene {
  private passthrough: DirectorSelectSceneData = { startingWeapon: 'projectile' };
  private selectedIndex: number = 0;
  private cards: DirectiveCard[] = [];
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private isStarting: boolean = false;

  constructor() {
    super({ key: 'DirectorSelectScene' });
  }

  init(data?: DirectorSelectLaunchData): void {
    // A flip restarts this scene to re-fit the new canvas; the directive already
    // chosen is the player's input and must survive it. A fresh entry defaults to
    // Random (index 0). `relayout` is destructured off here so the flag can never
    // ride along to GameScene via passthrough.
    const { relayout, ...launch }: DirectorSelectLaunchData = data ?? { startingWeapon: 'projectile' };
    this.passthrough = launch;
    if (relayout !== true) this.selectedIndex = 0;
    this.cards = [];
    this.menuNavigator = null;
    this.isStarting = false;
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor('#0a0a14');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    this.add.text(width / 2, 54, 'CHOOSE DIRECTIVE', {
      fontSize: '44px',
      color: '#66ccff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setLetterSpacing(3);

    this.add.text(width / 2, 102, 'Shape how enemies are thrown at you this run.', {
      fontSize: '17px',
      color: '#9999bb',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // Directive cards in centered rows; narrow (portrait) viewports wrap the row.
    const cardWidth = 210;
    const cardHeight = 210;
    const gap = 18;
    const count = DIRECTIVE_OPTIONS.length;
    const perRow = Math.min(count, Math.max(1, Math.floor((width - 16 + gap) / (cardWidth + gap))));
    const rowCount = Math.ceil(count / perRow);
    const rowSpacing = cardHeight + 24;
    const totalGridHeight = rowCount * cardHeight + (rowCount - 1) * 24;
    // Center rows on the legacy single-row anchor; keep the last row clear of
    // the BEGIN button (top edge at height - 90).
    const firstRowY = Math.min(
      height / 2 - 10 - totalGridHeight / 2 + cardHeight / 2,
      height - 90 - 12 - cardHeight / 2 - (rowCount - 1) * rowSpacing,
    );

    DIRECTIVE_OPTIONS.forEach((option, index) => {
      const rowIndex = Math.floor(index / perRow);
      const cardsInRow = Math.min(perRow, count - rowIndex * perRow);
      const rowWidth = cardsInRow * cardWidth + (cardsInRow - 1) * gap;
      const cardX = (width - rowWidth) / 2 + cardWidth / 2 + (index % perRow) * (cardWidth + gap);
      const cardY = firstRowY + rowIndex * rowSpacing;
      this.cards.push(this.createCard(option, cardX, cardY, cardWidth, cardHeight, index));
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

    // Keyboard + gamepad navigation: directive cards in a row, BEGIN RUN below.
    // Enter/Space/A activates the focused element; Escape/B begins with the
    // current selection.
    const navigableItems: NavigableItem[] = this.cards.map((card, index) => ({
      onFocus: () => this.setCardFocus(card, true),
      onBlur: () => this.setCardFocus(card, false),
      onActivate: () => this.selectDirective(index),
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

    // Number keys 1-5 stay as quick-select shortcuts; the navigator owns the rest.
    this.keydownHandler = (event: KeyboardEvent) => {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= count) this.selectDirective(num - 1);
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
  }

  /**
   * Keyboard/gamepad focus ring — a THIN WHITE outline, deliberately unlike the
   * thick green SELECTED treatment (mirrors PactSelectScene: the focus ring must
   * never read as a stuck selection, especially on touch where nothing blurs it).
   */
  private setCardFocus(card: DirectiveCard, focused: boolean): void {
    if (focused) {
      card.bg.setStrokeStyle(2, 0xffffff, 0.8);
    } else {
      card.bg.setStrokeStyle(2, 0x333344);
    }
  }

  /**
   * The SELECTED treatment, in one place. A re-layout restart rebuilds every card
   * from scratch, so the rebuild and a tap must paint identically. Single-select:
   * exactly one directive is chosen at a time. Touches bg's FILL only; its stroke
   * is the focus ring (setCardFocus).
   */
  private paintCardSelection(card: DirectiveCard, selected: boolean): void {
    card.border.setVisible(selected);
    card.selectedBadge.setVisible(selected);
    card.bg.setFillStyle(selected ? 0x18251c : 0x14141f);
    card.container.setScale(selected ? 1.04 : 1);
  }

  private createCard(option: DirectiveOption, x: number, y: number, w: number, h: number, index: number): DirectiveCard {
    const container = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, w, h, 0x14141f).setStrokeStyle(2, 0x333344);
    // Selection treatment is UNIFORM green; the per-directive accent color stays
    // on the name text only, so "selected" always looks the same card to card.
    const border = this.add.rectangle(0, 0, w, h).setStrokeStyle(4, 0x66ff99).setVisible(false);

    const name = this.add.text(0, -h / 2 + 30, option.name.toUpperCase(), {
      fontSize: '22px',
      color: `#${option.color.toString(16).padStart(6, '0')}`,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 20 },
    }).setOrigin(0.5, 0);

    const description = this.add.text(0, 6, option.description, {
      fontSize: '14px',
      color: '#bfc4dd',
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

    container.add([bg, border, name, description, keyHint, selectedBadge]);

    bg.setInteractive({ useHandCursor: true });
    // Hover-follows-mouse only: on touch, a tap fires pointerover with no
    // pointerout ever following, which would strand the focus ring on the last
    // card tapped.
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) this.menuNavigator?.selectIndex(index);
    });
    bg.on('pointerup', () => this.selectDirective(index));

    const card: DirectiveCard = { option, container, border, bg, selectedBadge };
    this.paintCardSelection(card, index === this.selectedIndex);
    return card;
  }

  private selectDirective(index: number): void {
    if (index < 0 || index >= this.cards.length) return;
    this.selectedIndex = index;
    this.cards.forEach((card, cardIndex) => this.paintCardSelection(card, cardIndex === index));
  }

  private beginRun(): void {
    if (this.isStarting) return; // guard against a second click during the fade
    this.isStarting = true;
    this.input.keyboard?.removeAllListeners();
    const strategy = DIRECTIVE_OPTIONS[this.selectedIndex]?.strategy ?? null;
    this.cameras.main.fadeOut(150, 0, 0, 0);
    this.time.delayedCall(160, () => {
      this.scene.start('GameScene', {
        restore: false,
        startingWeapon: this.passthrough.startingWeapon,
        shipId: this.passthrough.shipId,
        stageId: this.passthrough.stageId,
        modifierIds: this.passthrough.modifierIds ?? [],
        pactIds: this.passthrough.pactIds ?? [],
        gauntletMode: this.passthrough.gauntletMode === true,
        directorStrategy: strategy ?? undefined,
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
