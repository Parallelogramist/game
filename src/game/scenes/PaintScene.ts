import Phaser from 'phaser';
import { SoundManager } from '../../audio/SoundManager';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { BODY_COLORS, ACCENT_COLORS, TEXT_COLORS, ACCENT_COLORS_STR } from '../../visual/MenuStyle';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { transitionToScene, sweepIn, staggerEntrance } from '../../utils/SceneTransition';
import { SHIP_PAINTS, ShipPaint, resolveActivePaint, SHIP_DEFAULT_PAINT_CHOICE } from '../../data/ShipPaints';
import { HIDDEN_UNLOCKS, getHiddenUnlockManager } from '../../meta/HiddenUnlocks';
import { getShipPaintManager } from '../../storage/ShipPaintManager';

const CARD_WIDTH = 180;
const CARD_HEIGHT = 150;
const CARD_SPACING = 16;
const MAX_COLUMNS = 4;

export class PaintScene extends Phaser.Scene {
  private soundManager!: SoundManager;
  private menuBackground: MenuBackground | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private contentContainer: Phaser.GameObjects.Container | null = null;
  private backButton: MenuButton | null = null;
  private paintCards: MenuCard[] = [];
  private selectHandlers: Array<() => void> = [];

  constructor() {
    super({ key: 'PaintScene' });
  }

  create(): void {
    this.soundManager = new SoundManager(this);
    const centerX = this.scale.width / 2;

    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (time, delta) => {
      this.menuBackground?.update(delta);
      this.backButton?.tickIdle(time / 1000);
    };
    this.events.on('update', this.bgUpdateHandler);

    const title = makeDisplayText(this, centerX, 40, 'SHIP PAINT', {
      fontSize: 32, color: ACCENT_COLORS_STR.primary, strokeWidth: 5, letterSpacing: 4,
    });
    const subtitle = makeBodyText(this, centerX, 72, 'Choose your hull colour — or revert to the ship default', {
      fontSize: 13, color: TEXT_COLORS.muted,
    });

    this.buildGrid();

    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: this.scale.height - 36,
      width: 220, height: 44,
      label: '← BACK TO MENU',
      variant: 'neutral',
      fontSize: 14,
      onActivate: () => {
        this.soundManager.playUIClick();
        transitionToScene(this, 'BootScene');
      },
    });
    this.backButton.card.hitZone.on('pointerover', () => this.backButton?.setHoverState(true));
    this.backButton.card.hitZone.on('pointerout', () => this.backButton?.setHoverState(false));
    this.backButton.card.hitZone.on('pointerup', () => {
      this.soundManager.playUIClick();
      transitionToScene(this, 'BootScene');
    });

    this.buildNavigator();

    staggerEntrance(this, [title, subtitle, ...(this.contentContainer ? [this.contentContainer] : []), this.backButton.container]);
    sweepIn(this);

    this.events.once('shutdown', this.shutdown, this);
  }

  // Grid geometry — mirrors WeaponSelectScene.computeGridLayout (responsive columns).
  private computeGridLayout(count: number, yOffset: number) {
    const centerX = this.scale.width / 2;
    const fitColumns = Math.max(1, Math.floor((this.scale.width - 32) / (CARD_WIDTH + CARD_SPACING)));
    const columns = Math.min(count, MAX_COLUMNS, fitColumns);
    const rows = Math.ceil(count / columns);
    const totalGridWidth = columns * CARD_WIDTH + (columns - 1) * CARD_SPACING;
    const totalGridHeight = rows * CARD_HEIGHT + (rows - 1) * CARD_SPACING;
    const startX = centerX - totalGridWidth / 2 + CARD_WIDTH / 2;
    const startY = this.scale.height / 2 - totalGridHeight / 2 + yOffset;
    return {
      columns,
      positionAt: (index: number) => ({
        x: startX + (index % columns) * (CARD_WIDTH + CARD_SPACING),
        y: startY + Math.floor(index / columns) * (CARD_HEIGHT + CARD_SPACING),
      }),
    };
  }

  private buildGrid(): void {
    this.contentContainer?.destroy();
    this.paintCards = [];
    this.selectHandlers = [];
    this.contentContainer = this.add.container(0, 0);

    const unlockedIds = getHiddenUnlockManager().getUnlockedTargetIds();
    const storedChoice = getShipPaintManager().getSelectedPaintId();
    const activePaint = resolveActivePaint(unlockedIds, storedChoice);
    const defaultEquipped = activePaint === null;

    // Selectable cards first (grid indices 0..k-1) so the navigator's grid math
    // is contiguous; locked cards drawn after. Mirrors FEAT-SHIP-CHASE.
    const unlockedPaints = SHIP_PAINTS.filter((p) => unlockedIds.includes(p.unlockId));
    const lockedPaints = SHIP_PAINTS.filter((p) => !unlockedIds.includes(p.unlockId));

    // total for layout = 1 (ship default) + unlocked + locked
    const total = 1 + unlockedPaints.length + lockedPaints.length;
    const layout = this.computeGridLayout(total, 20);

    // index 0 — SHIP DEFAULT (always selectable opt-out)
    const defPos = layout.positionAt(0);
    this.renderSelectableCard({
      gridIndex: 0, x: defPos.x, y: defPos.y,
      label: 'SHIP DEFAULT', description: "The ship's own signature colour",
      swatchCore: 0x8898b0, swatchGlow: 0xb8c4d8,
      equipped: defaultEquipped,
      onSelect: () => this.choose(SHIP_DEFAULT_PAINT_CHOICE),
    });

    // indices 1..k — unlocked paints
    unlockedPaints.forEach((paint, i) => {
      const gridIndex = 1 + i;
      const pos = layout.positionAt(gridIndex);
      this.renderSelectableCard({
        gridIndex, x: pos.x, y: pos.y,
        label: paint.name.toUpperCase(), description: '',
        swatchCore: paint.color.core, swatchGlow: paint.color.glow,
        equipped: activePaint?.unlockId === paint.unlockId,
        onSelect: () => this.choose(paint.unlockId),
      });
    });

    // remaining indices — locked paints (non-interactive, with unlock hint)
    lockedPaints.forEach((paint, i) => {
      const gridIndex = 1 + unlockedPaints.length + i;
      const pos = layout.positionAt(gridIndex);
      this.renderLockedCard(paint, gridIndex, pos.x, pos.y);
    });
  }

  private renderSelectableCard(opts: {
    gridIndex: number; x: number; y: number; label: string; description: string;
    swatchCore: number; swatchGlow: number; equipped: boolean; onSelect: () => void;
  }): void {
    const accent = opts.equipped ? ACCENT_COLORS.safe : ACCENT_COLORS.primary;
    const body = opts.equipped ? BODY_COLORS.safe : BODY_COLORS.primary;
    const card = createMenuCard(this, {
      x: opts.x, y: opts.y, width: CARD_WIDTH, height: CARD_HEIGHT,
      pulseSeed: opts.gridIndex * 0.9,
      bodyFillColor: body, accentColor: accent,
      bannerHeight: 40, borderWidth: 3, borderColor: accent, cornerRadius: 8,
      interactive: true,
    });
    this.contentContainer!.add(card.container);
    this.paintCards.push(card);
    this.selectHandlers[opts.gridIndex] = opts.onSelect;

    const name = makeDisplayText(this, 0, card.bannerTopY + 20, opts.label, {
      fontSize: 14, color: TEXT_COLORS.heading, letterSpacing: 1.5,
    });
    card.frame.add(name);

    this.addSwatch(card, opts.swatchCore, opts.swatchGlow, -6);

    if (opts.equipped) {
      const tag = makeDisplayText(this, 0, CARD_HEIGHT / 2 - 18, 'EQUIPPED', {
        fontSize: 12, color: ACCENT_COLORS_STR.safe, letterSpacing: 2,
      });
      card.frame.add(tag);
    } else if (opts.description) {
      const desc = makeBodyText(this, 0, CARD_HEIGHT / 2 - 18, opts.description, {
        fontSize: 10, color: TEXT_COLORS.muted, wordWrapWidth: CARD_WIDTH - 20,
      });
      card.frame.add(desc);
    }

    card.hitZone.on('pointerover', () => card.setHoverState(true));
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerup', opts.onSelect);
  }

  private renderLockedCard(paint: ShipPaint, gridIndex: number, x: number, y: number): void {
    const card = createMenuCard(this, {
      x, y, width: CARD_WIDTH, height: CARD_HEIGHT,
      pulseSeed: gridIndex * 0.9 + 0.3,
      bodyFillColor: BODY_COLORS.neutral, accentColor: ACCENT_COLORS.neutral,
      bannerHeight: 40, borderWidth: 3, borderColor: ACCENT_COLORS.neutral, cornerRadius: 8,
      interactive: false,
    });
    this.contentContainer!.add(card.container);
    this.paintCards.push(card);

    const name = makeDisplayText(this, 0, card.bannerTopY + 20, paint.name.toUpperCase(), {
      fontSize: 14, color: TEXT_COLORS.dim, letterSpacing: 1.5,
    });
    card.frame.add(name);

    // dim swatch preview so the player sees what they're chasing
    this.addSwatch(card, paint.color.core, paint.color.glow, -10, 0.5);

    const lockTag = makeDisplayText(this, 0, 6, 'LOCKED', {
      fontSize: 11, color: TEXT_COLORS.headingGold, letterSpacing: 2,
    });
    card.frame.add(lockTag);

    const hintText = HIDDEN_UNLOCKS.find((u) => u.unlockId === paint.unlockId)?.hintText ?? '';
    const hint = makeBodyText(this, 0, CARD_HEIGHT / 2 - 20, `UNLOCK: ${hintText}`, {
      fontSize: 10, color: TEXT_COLORS.muted, wordWrapWidth: CARD_WIDTH - 20,
    });
    card.frame.add(hint);
  }

  private addSwatch(card: MenuCard, core: number, glow: number, offsetY: number, alpha = 1): void {
    const swatchY = offsetY;
    const g = this.add.graphics();
    g.fillStyle(glow, 0.35 * alpha); g.fillCircle(0, swatchY, 26);
    g.fillStyle(core, alpha); g.fillCircle(0, swatchY, 16);
    g.lineStyle(2, glow, 0.9 * alpha); g.strokeCircle(0, swatchY, 16);
    card.frame.add(g);
  }

  private choose(paintId: string): void {
    this.soundManager.playUIClick();
    getShipPaintManager().setSelectedPaintId(paintId);
    this.menuNavigator?.destroy();
    this.menuNavigator = null;
    this.buildGrid();
    this.buildNavigator();
  }

  private buildNavigator(): void {
    // Only the selectable cards are in paintCards[0..k-1] followed by locked cards.
    // Selectable = those created with interactive:true. Recompute the selectable
    // count from the unlocked set so we register exactly the interactive cards.
    const unlockedIds = getHiddenUnlockManager().getUnlockedTargetIds();
    const selectableCount = 1 + SHIP_PAINTS.filter((p) => unlockedIds.includes(p.unlockId)).length;

    const layout = this.computeGridLayout(this.paintCards.length, 20);
    const items: NavigableItem[] = [];
    for (let i = 0; i < selectableCount; i++) {
      const card = this.paintCards[i];
      items.push({
        onFocus: () => card.setFocusState(true),
        onBlur: () => card.setFocusState(false),
        onActivate: () => this.selectHandlers[i]?.(),
      });
    }
    if (this.backButton) {
      const back = this.backButton;
      items.push({
        onFocus: () => back.setFocusState(true),
        onBlur: () => back.setFocusState(false),
        onActivate: () => { this.soundManager.playUIClick(); transitionToScene(this, 'BootScene'); },
      });
    }

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items,
      columns: layout.columns,
      wrap: true,
      onCancel: () => transitionToScene(this, 'BootScene'),
    });
  }

  shutdown(): void {
    if (this.menuNavigator) { this.menuNavigator.destroy(); this.menuNavigator = null; }
    if (this.bgUpdateHandler) { this.events.off('update', this.bgUpdateHandler); this.bgUpdateHandler = null; }
    this.menuBackground?.destroy(); this.menuBackground = null;
    this.backButton?.destroy(); this.backButton = null;
    this.contentContainer?.destroy(); this.contentContainer = null;
    this.paintCards = [];
    this.tweens.killAll();
  }
}
