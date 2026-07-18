import Phaser from 'phaser';
import { Blessing, getBlessingById } from '../../data/Blessings';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import type { DirectorStrategy } from '../../systems/DirectorSystem';

/**
 * Data threaded through from ModifierDraftScene. `blessingChoiceIds` is the fixed
 * candidate set rolled ONCE at the modifier-draft -> blessing-draft transition; the
 * scene renders them and forwards the ones the player picks to GameScene as
 * `blessingIds` (a new fresh-path consumption path, mirroring `modifierIds`).
 * Passing the candidates as launch data (not rolling them here) is what makes an
 * orientation-flip re-render the SAME cards instead of re-rolling them.
 */
export interface BlessingDraftSceneData {
  restore?: boolean;
  startingWeapon: string;
  shipId?: string;
  stageId?: string;
  modifierIds?: string[];
  pactIds?: string[];
  gauntletMode?: boolean;
  directorStrategy?: DirectorStrategy;
  threatLevel?: number;
  blessingChoiceIds: string[];
  blessingPicks: number;
}

interface BlessingDraftLaunchData extends BlessingDraftSceneData {
  relayout?: boolean;
}

interface BlessingCard {
  blessing: Blessing;
  container: Phaser.GameObjects.Container;
  border: Phaser.GameObjects.Rectangle;
  bg: Phaser.GameObjects.Rectangle;
  selectedBadge: Phaser.GameObjects.Text;
}

const hexColor = (value: number): string => '#' + value.toString(16).padStart(6, '0');

/**
 * Pre-run blessing draft (FEAT-BLESSING-DRAFT). The funnel's new final pre-run step,
 * inserted between ModifierDraftScene and GameScene ONLY when the profile's
 * `blessingLevel` shop upgrade grants >=1 run-start blessing. The player picks EXACTLY
 * that many pure-upside gifts from a wider candidate set (pickCount + 3). Every other
 * GameScene-start path (daily/weekly/restore/replay/surprise/practice) bypasses the
 * funnel and never reaches this scene, so those keep auto-rolling blessings as before.
 */
export class BlessingDraftScene extends Phaser.Scene {
  private passthrough: BlessingDraftSceneData = { startingWeapon: 'projectile', blessingChoiceIds: [], blessingPicks: 0 };
  private choices: Blessing[] = [];
  private requiredPicks: number = 1;
  private selectedIds: Set<string> = new Set();
  private cards: BlessingCard[] = [];
  private counterText: Phaser.GameObjects.Text | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private isStarting: boolean = false;

  constructor() {
    super({ key: 'BlessingDraftScene' });
  }

  init(data?: BlessingDraftLaunchData): void {
    const { relayout, ...launch }: BlessingDraftLaunchData =
      data ?? { startingWeapon: 'projectile', blessingChoiceIds: [], blessingPicks: 0 };
    this.passthrough = launch;
    this.choices = (launch.blessingChoiceIds ?? [])
      .map((id) => getBlessingById(id))
      .filter((blessing): blessing is Blessing => blessing !== undefined);
    this.requiredPicks = Math.max(1, Math.min(launch.blessingPicks ?? 1, this.choices.length));
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

    // Degenerate guard: with no real choice (candidates <= picks) there is nothing to
    // draft — take all offered and start the run rather than showing a dead screen.
    // (Impossible on the real funnel: rollBlessingChoices always returns picks + 3.)
    if (this.choices.length <= this.requiredPicks) {
      this.startRun(this.choices.map((blessing) => blessing.id));
      return;
    }

    this.add.text(width / 2, 54, 'CLAIM YOUR BLESSINGS', {
      fontSize: '44px',
      color: '#66ccff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setLetterSpacing(3);

    this.add.text(width / 2, 102,
      `Choose ${this.requiredPicks} run-start ${this.requiredPicks === 1 ? 'blessing' : 'blessings'} — each is a pure bonus.`, {
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

    this.choices.forEach((blessing, index) => {
      const rowIndex = Math.floor(index / perRow);
      const cardsInRow = Math.min(perRow, count - rowIndex * perRow);
      const rowWidth = cardsInRow * cardWidth + (cardsInRow - 1) * gap;
      const cardX = (width - rowWidth) / 2 + cardWidth / 2 + (index % perRow) * (cardWidth + gap);
      const cardY = firstRowY + rowIndex * rowSpacing;
      this.cards.push(this.createCard(blessing, cardX, cardY, cardWidth, cardHeight, index));
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
      onActivate: () => this.toggleBlessing(index),
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
      onCancel: () => this.flashRequirement(),
    });

    this.keydownHandler = (event: KeyboardEvent) => {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= count) this.toggleBlessing(num - 1);
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
  }

  private setCardFocus(card: BlessingCard, focused: boolean): void {
    if (focused) {
      card.bg.setStrokeStyle(2, 0xffffff, 0.8);
    } else {
      card.bg.setStrokeStyle(2, 0x333344);
    }
  }

  private paintCardSelection(card: BlessingCard, selected: boolean): void {
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

  private flashRequirement(): void {
    if (!this.counterText) return;
    const counter = this.counterText;
    this.tweens.killTweensOf(counter);
    counter.setColor('#ff6666');
    counter.setText(`PICK EXACTLY ${this.requiredPicks}`);
    this.time.delayedCall(700, () => this.updateCounter());
  }

  private createCard(blessing: Blessing, x: number, y: number, w: number, h: number, index: number): BlessingCard {
    const container = this.add.container(x, y);
    const accent = hexColor(blessing.color);

    const bg = this.add.rectangle(0, 0, w, h, 0x14141f).setStrokeStyle(2, 0x333344);
    const border = this.add.rectangle(0, 0, w, h).setStrokeStyle(4, 0x66ff99).setVisible(false);

    const name = this.add.text(0, -h / 2 + 30, blessing.name.toUpperCase(), {
      fontSize: '20px',
      color: accent,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: w - 20 },
    }).setOrigin(0.5, 0);

    const description = this.add.text(0, 6, blessing.description, {
      fontSize: '16px',
      color: '#cfd6e6',
      fontFamily: 'Arial',
      align: 'center',
      wordWrap: { width: w - 28 },
    }).setOrigin(0.5);

    const keyHint = this.add.text(0, h / 2 - 18, `[ ${index + 1} ]`, {
      fontSize: '13px', color: '#666688', fontFamily: 'monospace',
    }).setOrigin(0.5);

    const selectedBadge = this.add.text(0, -h / 2 + 8, '✓ CHOSEN', {
      fontSize: '12px',
      color: '#0a140d',
      backgroundColor: '#66ff99',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      padding: { x: 8, y: 2 },
    }).setOrigin(0.5, 1).setVisible(false);

    container.add([bg, border, name, description, keyHint, selectedBadge]);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) this.menuNavigator?.selectIndex(index);
    });
    bg.on('pointerup', () => this.toggleBlessing(index));

    const card: BlessingCard = { blessing, container, border, bg, selectedBadge };
    this.paintCardSelection(card, this.selectedIds.has(blessing.id));
    return card;
  }

  private toggleBlessing(index: number): void {
    const card = this.cards[index];
    if (!card) return;
    const id = card.blessing.id;
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
    if (this.isStarting) return;
    if (this.selectedIds.size !== this.requiredPicks) {
      this.flashRequirement();
      return;
    }
    this.startRun([...this.selectedIds]);
  }

  private startRun(blessingIds: string[]): void {
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
        modifierIds: this.passthrough.modifierIds ?? [],
        pactIds: this.passthrough.pactIds ?? [],
        gauntletMode: this.passthrough.gauntletMode === true,
        directorStrategy: this.passthrough.directorStrategy,
        threatLevel: this.passthrough.threatLevel,
        blessingIds,
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
