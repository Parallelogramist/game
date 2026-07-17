import Phaser from 'phaser';
import { UNLOCKABLE_WEAPONS } from '../../data/Upgrades';
import { createWeapon } from '../../weapons';
import { getEvolutionForWeapon } from '../../data/WeaponEvolutions';
import { setPracticeSession } from '../../utils/practiceSession';
import { SHIP_CHARACTERS, getDefaultShip } from '../../data/ShipCharacters';
import { getUltimateForShip } from '../../data/ShipUltimates';
import { createIcon } from '../../utils/IconRenderer';
import { transitionToScene, sweepIn, fadeOut, addButtonInteraction } from '../../utils/SceneTransition';
import {
  computeMenuLayoutScale,
  computeMenuLayoutScalePortrait,
  computeMenuFontScale,
  computeMenuFontScalePortrait,
  computePracticeControlLayout,
  scaledInt,
  PRACTICE_START_HEIGHT,
} from '../../utils/HudScale';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { createMenuOverlay, MenuOverlay } from '../../visual/MenuOverlay';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { ACCENT_COLORS_STR, BODY_COLORS, ACCENT_COLORS, TEXT_COLORS } from '../../visual/MenuStyle';

/** All 21 weapons — the default projectile plus every unlockable. */
const PRACTICE_WEAPON_IDS: string[] = ['projectile', ...UNLOCKABLE_WEAPONS.map((w) => w.id)];

interface PracticeWeaponEntry {
  id: string;
  name: string;
  icon: string;
  maxLevel: number;
}

interface WeaponCardRef {
  card: MenuCard;
  iconSprite: Phaser.GameObjects.Image;
  entry: PracticeWeaponEntry;
}

/** Launch payload. `relayout` is set only by main.ts's orientation watcher. */
interface PracticeSceneData {
  relayout?: boolean;
}

/**
 * PRACTICE — pick any weapon, any level, evolved or not, and spawn straight
 * into a real run. Non-persistent: SecureStorage blocks writes for the whole
 * session (see practiceSession.ts); this scene only sets the flag on START.
 */
export class PracticeScene extends Phaser.Scene {
  private soundManager!: SoundManager;
  private menuNavigator: MenuNavigator | null = null;
  private menuOverlay: MenuOverlay | null = null;
  private updateHandler: ((time: number, delta: number) => void) | null = null;

  private entries: PracticeWeaponEntry[] = [];
  private weaponCardRefs: WeaponCardRef[] = [];
  private pressedCardId: string | null = null;

  private sceneObjects: Phaser.GameObjects.GameObject[] = [];
  private controlObjects: Phaser.GameObjects.GameObject[] = [];
  private controlButtons: MenuButton[] = [];

  private selectedWeaponId: string = 'projectile';
  private selectedLevel: number = 1;
  private evolvedEnabled: boolean = false;
  private selectedShipIndex: number = 0;
  private relayoutOnly: boolean = false;

  constructor() {
    super({ key: 'PracticeScene' });
  }

  init(data?: PracticeSceneData): void {
    this.relayoutOnly = data?.relayout === true;
  }

  create(): void {
    this.events.once('shutdown', this.shutdown, this);
    this.soundManager = new SoundManager(this);

    this.entries = PRACTICE_WEAPON_IDS
      .map((id) => {
        const weapon = createWeapon(id);
        return weapon
          ? { id, name: weapon.name, icon: weapon.icon, maxLevel: weapon.maxLevel }
          : undefined;
      })
      .filter((entry): entry is PracticeWeaponEntry => entry !== undefined);

    this.menuOverlay = createMenuOverlay(this, { dim: 0.85, drifterCount: 4 });
    this.updateHandler = (_time, delta) => {
      this.menuOverlay?.update(delta);
      for (const ref of this.weaponCardRefs) ref.card.tickIdle(_time / 1000);
      for (const btn of this.controlButtons) btn.tickIdle(_time / 1000);
    };
    this.events.on('update', this.updateHandler);

    sweepIn(this);

    // A flip restarts this scene to re-fit the new canvas; the picks are the
    // player's composed input and must survive it. A fresh MAIN MENU entry
    // still resets.
    if (!this.relayoutOnly) {
      this.selectedWeaponId = this.entries[0]?.id ?? 'projectile';
      this.selectedLevel = this.entries[0]?.maxLevel ?? 1;
      this.evolvedEnabled = false;
      this.selectedShipIndex = 0;
    }

    this.renderHeader();
    this.renderWeaponGrid();
    this.renderControls();
  }

  /**
   * Portrait opts into the orientation-matched 720×1280 fit, like BootScene: the
   * weapon grid and the centered control column both fit 720 units of width at full
   * size, whereas the landscape fit resolves to 0.5625 in portrait — which squashed
   * the whole menu and pushed START clean off the bottom of the canvas.
   */
  private computeScales(): { layoutScale: number; fontScale: number } {
    const portrait = this.scale.height > this.scale.width;
    return {
      layoutScale: portrait
        ? computeMenuLayoutScalePortrait(this.scale.width, this.scale.height)
        : computeMenuLayoutScale(this.scale.width, this.scale.height),
      fontScale: portrait
        ? computeMenuFontScalePortrait(this.scale.width, this.scale.height)
        : computeMenuFontScale(this.scale.width, this.scale.height),
    };
  }

  private renderHeader(): void {
    const { layoutScale, fontScale } = this.computeScales();
    const centerX = this.scale.width / 2;

    const title = makeDisplayText(this, centerX, scaledInt(layoutScale, 60), 'PRACTICE', {
      fontSize: scaledInt(fontScale, 36),
      color: ACCENT_COLORS_STR.gold,
      strokeWidth: 5,
      letterSpacing: 3,
    });
    this.sceneObjects.push(title);

    const subtitle = makeBodyText(
      this,
      centerX,
      scaledInt(layoutScale, 96),
      'Nothing here is saved — no gold, no unlocks, no records.',
      { fontSize: scaledInt(fontScale, 14), color: TEXT_COLORS.muted },
    );
    this.sceneObjects.push(subtitle);

    const backButton = createMenuButton({
      scene: this,
      x: scaledInt(layoutScale, 80),
      y: scaledInt(layoutScale, 32),
      width: scaledInt(layoutScale, 130),
      height: scaledInt(layoutScale, 34),
      label: '← MAIN MENU',
      variant: 'neutral',
      fontSize: scaledInt(fontScale, 12),
      onActivate: () => this.goBack(),
    });
    addButtonInteraction(this, backButton.container);
    backButton.card.hitZone.on('pointerover', () => backButton.setHoverState(true));
    backButton.card.hitZone.on('pointerout', () => backButton.setHoverState(false));
    this.controlButtons.push(backButton);
  }

  private goBack(): void {
    this.soundManager.playUIClick();
    this.destroyMenuNavigator();
    this.input.keyboard?.removeAllListeners();
    transitionToScene(this, 'BootScene');
  }

  private computeGridLayout(
    count: number,
    cardWidth: number,
    cardHeight: number,
    cardSpacing: number,
    maxColumns: number,
    yOffset: number,
  ) {
    const centerX = this.scale.width / 2;
    const fitColumns = Math.max(1, Math.floor((this.scale.width - 32) / (cardWidth + cardSpacing)));
    const columns = Math.min(count, maxColumns, fitColumns);
    const rows = Math.ceil(count / columns);
    const totalGridWidth = columns * cardWidth + (columns - 1) * cardSpacing;
    const totalGridHeight = rows * cardHeight + (rows - 1) * cardSpacing;
    const startX = centerX - totalGridWidth / 2 + cardWidth / 2;
    const startY = this.scale.height / 2 - totalGridHeight / 2 + yOffset;

    return {
      columns,
      totalGridWidth,
      totalGridHeight,
      startY,
      positionAt: (index: number) => ({
        x: startX + (index % columns) * (cardWidth + cardSpacing),
        y: startY + Math.floor(index / columns) * (cardHeight + cardSpacing),
      }),
    };
  }

  private renderWeaponGrid(): void {
    this.input.on('pointerup', this.clearPressedCard, this);
    this.input.on('pointerupoutside', this.clearPressedCard, this);

    const cardWidth = 110;
    const cardHeight = 110;
    const cardSpacing = 12;
    const layout = this.computeGridLayout(this.entries.length, cardWidth, cardHeight, cardSpacing, 8, -80);

    this.weaponCardRefs = [];
    const focusable: { onFocus: () => void; onBlur: () => void; onActivate: () => void }[] = [];

    this.entries.forEach((entry, index) => {
      const { x, y } = layout.positionAt(index);
      const card = createMenuCard(this, {
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        pulseSeed: index * 0.6,
        bodyFillColor: BODY_COLORS.gold,
        accentColor: ACCENT_COLORS.gold,
        bannerHeight: 0,
        borderWidth: 3,
        borderColor: ACCENT_COLORS.gold,
        cornerRadius: 6,
      });

      const iconSprite = createIcon(this, { x: 0, y: -18, iconKey: entry.icon, size: 40, tint: 0xffffff });
      card.frame.add(iconSprite);

      const nameText = makeDisplayText(this, 0, cardHeight / 2 - 20, entry.name.toUpperCase(), {
        fontSize: 10,
        color: TEXT_COLORS.heading,
        letterSpacing: 0.5,
      });
      nameText.setWordWrapWidth(cardWidth - 10);
      card.frame.add(nameText);

      const cardRef: WeaponCardRef = { card, iconSprite, entry };
      this.weaponCardRefs.push(cardRef);

      card.hitZone.on('pointerdown', () => {
        this.soundManager.playUIClick();
        this.pressedCardId = entry.id;
        card.setHoverState(true);
      });
      card.hitZone.on('pointerup', () => {
        const wasPressedHere = this.pressedCardId === entry.id;
        this.pressedCardId = null;
        if (!wasPressedHere) return;
        this.soundManager.playUIClick();
        this.selectWeapon(entry.id);
      });
      card.hitZone.on('pointerover', () => {
        this.soundManager.playUIClick();
        card.setHoverState(true);
        const cardIndex = this.weaponCardRefs.indexOf(cardRef);
        if (cardIndex >= 0 && this.menuNavigator) this.menuNavigator.selectIndex(cardIndex);
      });
      card.hitZone.on('pointerout', () => card.setHoverState(false));

      focusable.push({
        onFocus: () => card.setFocusState(true),
        onBlur: () => card.setFocusState(false),
        onActivate: () => {
          this.soundManager.playUIClick();
          this.selectWeapon(entry.id);
        },
      });
    });

    this.destroyMenuNavigator();
    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: focusable,
      columns: layout.columns,
      wrap: true,
      onCancel: () => this.goBack(),
    });

    this.refreshSelectedCardVisuals();
  }

  private clearPressedCard(): void {
    this.pressedCardId = null;
  }

  private refreshSelectedCardVisuals(): void {
    for (const ref of this.weaponCardRefs) {
      ref.card.setFocusState(ref.entry.id === this.selectedWeaponId);
    }
  }

  private selectWeapon(weaponId: string): void {
    this.selectedWeaponId = weaponId;
    const entry = this.entries.find((e) => e.id === weaponId);
    this.selectedLevel = Math.min(this.selectedLevel, entry?.maxLevel ?? 1);
    if (this.selectedLevel < 1) this.selectedLevel = entry?.maxLevel ?? 1;
    this.evolvedEnabled = this.evolvedEnabled && this.isEvolveAvailable();
    this.refreshSelectedCardVisuals();
    this.renderControls();
  }

  private getSelectedEntry(): PracticeWeaponEntry | undefined {
    return this.entries.find((e) => e.id === this.selectedWeaponId);
  }

  private isEvolveAvailable(): boolean {
    const evolution = getEvolutionForWeapon(this.selectedWeaponId);
    if (!evolution) return false;
    return this.selectedLevel >= evolution.requiredWeaponLevel;
  }

  private renderControls(): void {
    for (const obj of this.controlObjects) obj.destroy();
    this.controlObjects = [];
    for (const btn of this.controlButtons) {
      if (btn !== this.controlButtons[0]) btn.destroy();
    }
    this.controlButtons = this.controlButtons.slice(0, 1); // keep the back button

    const { layoutScale, fontScale } = this.computeScales();
    const centerX = this.scale.width / 2;
    const { shipY, stepperY, evolveY, startY } = computePracticeControlLayout(
      this.scale.height,
      layoutScale,
    );

    const entry = this.getSelectedEntry();
    const maxLevel = entry?.maxLevel ?? 1;

    // Ship cycle — every ship, unlocked or not. The sandbox already ignores unlock
    // gating on its weapon grid (PRACTICE_WEAPON_IDS offers all 19), nothing here
    // persists (practiceSession blocks SecureStorage writes), and 9 of the 11 ships
    // are hidden-gated — so gating this would strand the sandbox on Sparrow, which is
    // the limit this row exists to remove. The ship's own startingWeaponId stays
    // suppressed in practice (GameScene's !practiceModeActive guard): the grid wins.
    const ship = SHIP_CHARACTERS[this.selectedShipIndex] ?? getDefaultShip();

    const shipLabel = makeDisplayText(this, centerX - 160, shipY, 'SHIP', {
      fontSize: scaledInt(fontScale, 14),
      color: TEXT_COLORS.heading,
      letterSpacing: 1.5,
    });
    this.controlObjects.push(shipLabel);

    const shipButton = createMenuButton({
      scene: this,
      x: centerX,
      y: shipY,
      width: 220,
      height: 36,
      label: ship.name.toUpperCase(),
      variant: this.selectedShipIndex === 0 ? 'neutral' : 'magenta',
      fontSize: scaledInt(fontScale, 13),
      onActivate: () => {
        this.selectedShipIndex = (this.selectedShipIndex + 1) % SHIP_CHARACTERS.length;
        this.renderControls();
      },
    });
    addButtonInteraction(this, shipButton.container);
    this.controlButtons.push(shipButton);

    const shipDesc = makeBodyText(this, centerX, shipY + 34, ship.description, {
      fontSize: scaledInt(fontScale, 12),
      color: TEXT_COLORS.muted,
    });
    this.controlObjects.push(shipDesc);

    const shipUltimate = getUltimateForShip(ship);
    const shipUltimateText = makeBodyText(
      this,
      centerX,
      shipY + 56,
      `ULT — ${shipUltimate.name}: ${shipUltimate.description}`,
      { fontSize: scaledInt(fontScale, 11), color: TEXT_COLORS.dim },
    );
    this.controlObjects.push(shipUltimateText);

    // Level stepper.
    const levelLabel = makeDisplayText(this, centerX - 160, stepperY, 'LEVEL', {
      fontSize: scaledInt(fontScale, 14),
      color: TEXT_COLORS.heading,
      letterSpacing: 1.5,
    });
    this.controlObjects.push(levelLabel);

    const levelValue = makeDisplayText(this, centerX, stepperY, `${this.selectedLevel}`, {
      fontSize: scaledInt(fontScale, 20),
      color: ACCENT_COLORS_STR.gold,
      letterSpacing: 1,
    });
    this.controlObjects.push(levelValue);

    const decButton = createMenuButton({
      scene: this,
      x: centerX - 60,
      y: stepperY,
      width: 36,
      height: 36,
      label: '◀',
      variant: 'neutral',
      fontSize: scaledInt(fontScale, 16),
      onActivate: () => {
        if (this.selectedLevel > 1) {
          this.selectedLevel -= 1;
          this.evolvedEnabled = this.evolvedEnabled && this.isEvolveAvailable();
          this.renderControls();
        }
      },
    });
    addButtonInteraction(this, decButton.container);
    this.controlButtons.push(decButton);

    const incButton = createMenuButton({
      scene: this,
      x: centerX + 60,
      y: stepperY,
      width: 36,
      height: 36,
      label: '▶',
      variant: 'neutral',
      fontSize: scaledInt(fontScale, 16),
      onActivate: () => {
        if (this.selectedLevel < maxLevel) {
          this.selectedLevel += 1;
          this.renderControls();
        }
      },
    });
    addButtonInteraction(this, incButton.container);
    this.controlButtons.push(incButton);

    // Evolve toggle.
    const evolveAvailable = this.isEvolveAvailable();
    const evolveButton = createMenuButton({
      scene: this,
      x: centerX,
      y: evolveY,
      width: 220,
      height: 36,
      label: `EVOLVED: ${this.evolvedEnabled ? 'ON' : 'OFF'}`,
      variant: this.evolvedEnabled ? 'magenta' : 'neutral',
      fontSize: scaledInt(fontScale, 13),
      onActivate: () => {
        if (!evolveAvailable) return;
        this.evolvedEnabled = !this.evolvedEnabled;
        this.renderControls();
      },
    });
    evolveButton.setEnabled(evolveAvailable);
    addButtonInteraction(this, evolveButton.container);
    this.controlButtons.push(evolveButton);

    // START.
    const startButton = createMenuButton({
      scene: this,
      x: centerX,
      y: startY,
      width: 220,
      height: PRACTICE_START_HEIGHT,
      label: 'START',
      variant: 'gold',
      fontSize: scaledInt(fontScale, 18),
      onActivate: () => this.startPractice(),
    });
    addButtonInteraction(this, startButton.container);
    this.controlButtons.push(startButton);
  }

  private startPractice(): void {
    this.soundManager.playUIClick();
    this.destroyMenuNavigator();
    this.input.keyboard?.removeAllListeners();
    this.input.removeAllListeners();

    setPracticeSession(true);
    fadeOut(this, 200, () => {
      this.scene.start('GameScene', {
        startingWeapon: this.selectedWeaponId,
        practiceMode: true,
        practiceWeaponLevel: this.selectedLevel,
        practiceEvolved: this.evolvedEnabled,
        stageId: 'stage_deep_void',
        shipId: (SHIP_CHARACTERS[this.selectedShipIndex] ?? getDefaultShip()).id,
      });
    });
  }

  private destroyMenuNavigator(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
  }

  shutdown(): void {
    this.destroyMenuNavigator();
    this.input.keyboard?.removeAllListeners();
    this.input.off('pointerup', this.clearPressedCard, this);
    this.input.off('pointerupoutside', this.clearPressedCard, this);
    this.tweens.killAll();
    if (this.updateHandler) {
      this.events.off('update', this.updateHandler);
      this.updateHandler = null;
    }
    this.menuOverlay?.destroy();
    this.menuOverlay = null;
    for (const obj of this.sceneObjects) obj.destroy();
    this.sceneObjects = [];
    for (const obj of this.controlObjects) obj.destroy();
    this.controlObjects = [];
    for (const btn of this.controlButtons) btn.destroy();
    this.controlButtons = [];
    for (const ref of this.weaponCardRefs) ref.card.destroy();
    this.weaponCardRefs = [];
  }
}
