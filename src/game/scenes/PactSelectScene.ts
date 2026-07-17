import Phaser from 'phaser';
import { PACTS, MAX_PACTS, Pact } from '../../data/Pacts';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';

/**
 * Data threaded through from WeaponSelectScene; forwarded verbatim to GameScene
 * with the chosen pactIds appended.
 */
export interface PactSelectSceneData {
  startingWeapon: string;
  shipId?: string;
  stageId?: string;
  modifierIds?: string[];
  gauntletMode?: boolean;
}

/**
 * What the scene is actually started with. `relayout` is set only by main.ts's
 * orientation watcher; init() strips it back out so it can never reach GameScene.
 */
interface PactSelectLaunchData extends PactSelectSceneData {
  relayout?: boolean;
}

interface PactCard {
  pact: Pact;
  container: Phaser.GameObjects.Container;
  border: Phaser.GameObjects.Rectangle;
  bg: Phaser.GameObjects.Rectangle;
  selectedBadge: Phaser.GameObjects.Text;
}

/**
 * Pre-run pact picker. Optional — the player can begin with zero pacts. Each
 * selected pact stacks its curse + reward. Inserted between WeaponSelectScene
 * and GameScene.
 */
export class PactSelectScene extends Phaser.Scene {
  private passthrough: PactSelectSceneData = { startingWeapon: 'projectile' };
  private selectedIds: Set<string> = new Set();
  private cards: PactCard[] = [];
  private counterText: Phaser.GameObjects.Text | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private isStarting: boolean = false;

  constructor() {
    super({ key: 'PactSelectScene' });
  }

  init(data?: PactSelectLaunchData): void {
    // A flip restarts this scene to re-fit the new canvas; the pacts already
    // chosen are the player's composed input and must survive it. A fresh entry
    // still starts empty. `relayout` is destructured off here so the flag can
    // never ride along to GameScene via passthrough.
    const { relayout, ...launch }: PactSelectLaunchData = data ?? { startingWeapon: 'projectile' };
    this.passthrough = launch;
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

    this.add.text(width / 2, 54, 'FORGE A PACT', {
      fontSize: '44px',
      color: '#ff5577',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setLetterSpacing(3);

    this.add.text(width / 2, 102, `Optional — accept curses for greater rewards (up to ${MAX_PACTS}).`, {
      fontSize: '17px',
      color: '#9999bb',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // Live selection counter — makes "zero is fine" explicit and shows the
    // cap without the player having to count green borders.
    this.counterText = this.add.text(width / 2, 132, '', {
      fontSize: '15px',
      color: '#66ff99',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setLetterSpacing(1);
    this.updateCounter();

    // Pact cards in centered rows; narrow (portrait) viewports wrap the row.
    const cardWidth = 218;
    const cardHeight = 230;
    const gap = 18;
    const perRow = Math.min(PACTS.length, Math.max(1, Math.floor((width - 16 + gap) / (cardWidth + gap))));
    const rowCount = Math.ceil(PACTS.length / perRow);
    const rowSpacing = cardHeight + 24;
    const totalGridHeight = rowCount * cardHeight + (rowCount - 1) * 24;
    // Center rows on the legacy single-row anchor; keep the last row clear of
    // the BEGIN button (top edge at height - 90).
    const firstRowY = Math.min(
      height / 2 - 10 - totalGridHeight / 2 + cardHeight / 2,
      height - 90 - 12 - cardHeight / 2 - (rowCount - 1) * rowSpacing,
    );

    PACTS.forEach((pact, index) => {
      const rowIndex = Math.floor(index / perRow);
      const cardsInRow = Math.min(perRow, PACTS.length - rowIndex * perRow);
      const rowWidth = cardsInRow * cardWidth + (cardsInRow - 1) * gap;
      const cardX = (width - rowWidth) / 2 + cardWidth / 2 + (index % perRow) * (cardWidth + gap);
      const cardY = firstRowY + rowIndex * rowSpacing;
      this.cards.push(this.createCard(pact, cardX, cardY, cardWidth, cardHeight, index));
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
    beginButton.on('pointerover', () => this.menuNavigator?.selectIndex(PACTS.length));
    beginButton.on('pointerup', () => this.beginRun());
    void beginLabel;

    // Keyboard + gamepad navigation: pact cards in a row, BEGIN RUN below.
    // Enter/Space/A activates the focused element; Escape/B skips pacts.
    const navigableItems: NavigableItem[] = this.cards.map((card, index) => ({
      onFocus: () => this.setCardFocus(card, true),
      onBlur: () => this.setCardFocus(card, false),
      onActivate: () => this.togglePact(index),
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
      onCancel: () => { this.selectedIds.clear(); this.beginRun(); },
    });

    // Number keys stay as quick-toggle shortcuts; the navigator owns the rest.
    this.keydownHandler = (event: KeyboardEvent) => {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= PACTS.length) this.togglePact(num - 1);
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
  }

  /**
   * Keyboard/gamepad focus ring — a THIN WHITE outline, deliberately unlike
   * the thick green SELECTED treatment (the old gold ring read as a stuck
   * selection, especially on touch where nothing ever blurs it).
   */
  private setCardFocus(card: PactCard, focused: boolean): void {
    if (focused) {
      card.bg.setStrokeStyle(2, 0xffffff, 0.8);
    } else {
      card.bg.setStrokeStyle(2, 0x333344);
    }
  }

  /**
   * The SELECTED treatment, in one place. A re-layout restart rebuilds every card
   * from scratch, so the rebuild and a tap must paint identically — otherwise
   * preserved selections show as unselected cards, which reads worse than losing
   * them. Touches bg's FILL only; its stroke is the focus ring (setCardFocus).
   */
  private paintCardSelection(card: PactCard, selected: boolean): void {
    card.border.setVisible(selected);
    card.selectedBadge.setVisible(selected);
    card.bg.setFillStyle(selected ? 0x18251c : 0x14141f);
    card.container.setScale(selected ? 1.04 : 1);
  }

  private updateCounter(): void {
    if (!this.counterText) return;
    const count = this.selectedIds.size;
    this.counterText.setText(
      count === 0 ? 'NONE SELECTED — READY TO BEGIN' : `${count} / ${MAX_PACTS} PACTS SELECTED`,
    );
    this.counterText.setColor(count === 0 ? '#778899' : '#66ff99');
  }

  /** Cap feedback — flash the counter red instead of silently ignoring. */
  private flashCap(): void {
    if (!this.counterText) return;
    const counter = this.counterText;
    this.tweens.killTweensOf(counter);
    counter.setColor('#ff6666');
    counter.setText(`MAX ${MAX_PACTS} PACTS`);
    this.time.delayedCall(700, () => this.updateCounter());
  }

  private createCard(pact: Pact, x: number, y: number, w: number, h: number, index: number): PactCard {
    const container = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, w, h, 0x14141f).setStrokeStyle(2, 0x333344);
    // Selection treatment is UNIFORM green across all pacts — the per-pact
    // accent colors stay on the name text only, so "selected" always looks
    // the same regardless of which card it is.
    const border = this.add.rectangle(0, 0, w, h).setStrokeStyle(4, 0x66ff99).setVisible(false);

    const name = this.add.text(0, -h / 2 + 26, pact.name.toUpperCase(), {
      fontSize: '18px',
      color: `#${pact.color.toString(16).padStart(6, '0')}`,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 20 },
    }).setOrigin(0.5, 0);

    const downside = this.add.text(0, -10, pact.description, {
      fontSize: '14px',
      color: '#cc8899',
      fontFamily: 'Arial',
      align: 'center',
      wordWrap: { width: w - 28 },
    }).setOrigin(0.5);

    const reward = this.add.text(0, h / 2 - 52, pact.reward, {
      fontSize: '15px',
      color: '#ffdd66',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 20 },
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

    container.add([bg, border, name, downside, reward, keyHint, selectedBadge]);

    bg.setInteractive({ useHandCursor: true });
    // Hover-follows-mouse only: on touch, a tap fires pointerover with no
    // pointerout ever following, which stranded the focus ring on the last
    // card tapped — the "stuck selection border" bug.
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) this.menuNavigator?.selectIndex(index);
    });
    bg.on('pointerup', () => this.togglePact(index));

    const card: PactCard = { pact, container, border, bg, selectedBadge };
    this.paintCardSelection(card, this.selectedIds.has(pact.id));
    return card;
  }

  private togglePact(index: number): void {
    const card = this.cards[index];
    if (!card) return;
    const id = card.pact.id;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      this.paintCardSelection(card, false);
    } else {
      if (this.selectedIds.size >= MAX_PACTS) {
        this.flashCap();
        return;
      }
      this.selectedIds.add(id);
      this.paintCardSelection(card, true);
    }
    this.updateCounter();
  }

  private beginRun(): void {
    if (this.isStarting) return; // guard against a second click during the fade
    this.isStarting = true;
    this.input.keyboard?.removeAllListeners();
    const pactIds = [...this.selectedIds];
    this.cameras.main.fadeOut(150, 0, 0, 0);
    this.time.delayedCall(160, () => {
      this.scene.start('GameScene', {
        restore: false,
        startingWeapon: this.passthrough.startingWeapon,
        shipId: this.passthrough.shipId,
        stageId: this.passthrough.stageId,
        modifierIds: this.passthrough.modifierIds ?? [],
        pactIds,
        gauntletMode: this.passthrough.gauntletMode === true,
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
