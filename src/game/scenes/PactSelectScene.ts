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
}

interface PactCard {
  pact: Pact;
  container: Phaser.GameObjects.Container;
  border: Phaser.GameObjects.Rectangle;
  bg: Phaser.GameObjects.Rectangle;
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
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private isStarting: boolean = false;

  constructor() {
    super({ key: 'PactSelectScene' });
  }

  init(data: PactSelectSceneData): void {
    this.passthrough = data ?? { startingWeapon: 'projectile' };
    this.selectedIds = new Set();
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

    // Pact cards in a centered row.
    const cardWidth = 218;
    const cardHeight = 230;
    const gap = 18;
    const totalWidth = PACTS.length * cardWidth + (PACTS.length - 1) * gap;
    const startX = (width - totalWidth) / 2 + cardWidth / 2;
    const cardY = height / 2 - 10;

    PACTS.forEach((pact, index) => {
      const cardX = startX + index * (cardWidth + gap);
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
      columns: PACTS.length,
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

  private setCardFocus(card: PactCard, focused: boolean): void {
    if (focused) {
      card.bg.setStrokeStyle(3, 0xffdd44);
    } else {
      card.bg.setStrokeStyle(2, 0x333344);
    }
  }

  private createCard(pact: Pact, x: number, y: number, w: number, h: number, index: number): PactCard {
    const container = this.add.container(x, y);

    const bg = this.add.rectangle(0, 0, w, h, 0x14141f).setStrokeStyle(2, 0x333344);
    const border = this.add.rectangle(0, 0, w, h).setStrokeStyle(3, pact.color).setVisible(false);

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

    container.add([bg, border, name, downside, reward, keyHint]);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => this.menuNavigator?.selectIndex(index));
    bg.on('pointerup', () => this.togglePact(index));

    return { pact, container, border, bg };
  }

  private togglePact(index: number): void {
    const card = this.cards[index];
    if (!card) return;
    const id = card.pact.id;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      card.border.setVisible(false);
      card.container.setScale(1);
    } else {
      if (this.selectedIds.size >= MAX_PACTS) return; // cap reached
      this.selectedIds.add(id);
      card.border.setVisible(true);
      card.container.setScale(1.04);
    }
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
