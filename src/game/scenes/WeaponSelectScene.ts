import Phaser from 'phaser';
import { getCodexManager } from '../../codex';
import { getWeaponInfoList, WeaponInfo } from '../../weapons';
import { createIcon } from '../../utils/IconRenderer';
import { fadeIn, fadeOut } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { selectRunModifiers } from '../../data/RunModifiers';
import { MenuNavigator } from '../../input/MenuNavigator';
import { SHIP_CHARACTERS, ShipCharacter } from '../../data/ShipCharacters';
import { getHiddenUnlockManager } from '../../meta/HiddenUnlocks';
import { STAGES, StageDefinition } from '../../data/Stages';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { isUnlockRequirementMet, UnlockGateContext } from '../../data/UnlockGates';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { getShipTierGeometry, getHullBounds, Point2D } from '../../visual/shipHullGeometry';
import { SHIP_NEON_PALETTES, lightenColor, darkenColor } from '../../visual/NeonColors';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeStickerText, makeBodyText } from '../../visual/StickerText';
import {
  ACCENT_COLORS,
  ACCENT_COLORS_STR,
  BODY_COLORS,
  CARD_TILT_PRESETS,
  MENU_FONT,
  TEXT_COLORS,
} from '../../visual/MenuStyle';

interface WeaponCardRef {
  card: MenuCard;
  nameText: Phaser.GameObjects.Text;
  iconSprite: Phaser.GameObjects.Image;
  weaponId: string;
}

type WeaponSelectStep = 'stage' | 'ship' | 'weapon';

/**
 * Pre-run picker — Balatro-style 3-step card flow:
 * stage → ship → weapon. Each step is a card grid with role-coded accents.
 * Steps with only one option auto-skip; back-nav respects skipped steps.
 */
export class WeaponSelectScene extends Phaser.Scene {
  private soundManager!: SoundManager;
  private menuNavigator: MenuNavigator | null = null;
  private weaponCardRefs: WeaponCardRef[] = [];
  private selectedShipId: string = 'ship_default';
  private selectedStageId: string = 'stage_deep_void';
  private discoveredWeaponsCache: WeaponInfo[] = [];
  private stepCards: MenuCard[] = [];
  private stepButtons: MenuButton[] = [];
  private stepObjects: Phaser.GameObjects.GameObject[] = [];
  private currentStep: WeaponSelectStep = 'stage';
  private availableSteps: WeaponSelectStep[] = [];
  private weaponStepKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  private menuBackground: MenuBackground | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;

  constructor() {
    super({ key: 'WeaponSelectScene' });
  }

  create(): void {
    this.events.once('shutdown', this.shutdown, this);
    this.soundManager = new SoundManager(this);

    const codexManager = getCodexManager();
    const allWeapons = getWeaponInfoList();
    this.discoveredWeaponsCache = allWeapons.filter((w) => codexManager.isWeaponDiscovered(w.id));

    // Balatro backdrop.
    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (time, delta) => {
      this.menuBackground?.update(delta);
      const seconds = time / 1000;
      for (const card of this.stepCards) card.tickIdle(seconds);
      for (const btn of this.stepButtons) btn.tickIdle(seconds);
    };
    this.events.on('update', this.bgUpdateHandler);

    fadeIn(this, 200);

    this.availableSteps = [];
    const availableStages = this.getAvailableStages();
    if (availableStages.length > 1) this.availableSteps.push('stage');
    if (this.getAvailableShips().length > 1) this.availableSteps.push('ship');
    this.availableSteps.push('weapon');

    if (availableStages.length > 1) {
      this.renderStageSelectionStep(availableStages);
    } else {
      this.selectedStageId = 'stage_deep_void';
      this.proceedToShipStep();
    }
  }

  private goBack(): void {
    const currentIndex = this.availableSteps.indexOf(this.currentStep);
    if (currentIndex <= 0) {
      this.soundManager.playUIClick();
      this.destroyMenuNavigator();
      this.input.keyboard?.removeAllListeners();
      fadeOut(this, 150, () => this.scene.start('BootScene'));
      return;
    }
    this.soundManager.playUIClick();
    if (this.weaponStepKeyHandler) {
      this.input.keyboard?.off('keydown', this.weaponStepKeyHandler);
      this.weaponStepKeyHandler = null;
    }
    const previousStep = this.availableSteps[currentIndex - 1];
    if (previousStep === 'stage') {
      this.clearStepUI();
      this.destroyMenuNavigator();
      this.currentStep = 'stage';
      this.renderStageSelectionStep(this.getAvailableStages());
    } else if (previousStep === 'ship') {
      this.clearStepUI();
      this.destroyMenuNavigator();
      this.currentStep = 'ship';
      this.renderShipSelectionStep(this.getAvailableShips());
    }
  }

  /** Breadcrumb chip strip + back button at the top. */
  private renderStepHeader(): void {
    const stepIndex = this.availableSteps.indexOf(this.currentStep);
    const totalSteps = this.availableSteps.length;
    const currentIndex = stepIndex >= 0 ? stepIndex : 0;
    const crumbLabels: Record<WeaponSelectStep, string> = {
      stage: 'STAGE',
      ship: 'SHIP',
      weapon: 'WEAPON',
    };

    const chipWidth = 110;
    const chipHeight = 34;
    const spacing = 12;
    const totalWidth = this.availableSteps.length * chipWidth + (this.availableSteps.length - 1) * spacing;
    const startX = this.scale.width / 2 - totalWidth / 2 + chipWidth / 2;

    this.availableSteps.forEach((step, index) => {
      const cx = startX + index * (chipWidth + spacing);
      const isActive = index === currentIndex;
      const button = createMenuButton({
        scene: this,
        x: cx,
        y: 28,
        width: chipWidth,
        height: chipHeight,
        label: crumbLabels[step],
        variant: isActive ? 'primary' : 'neutral',
        fontSize: 13,
      });
      if (!isActive) button.container.setAlpha(0.65);
      this.stepButtons.push(button);
    });

    const counter = makeBodyText(this, this.scale.width / 2, 56, `${currentIndex + 1} / ${totalSteps}`, {
      fontSize: 11,
      color: TEXT_COLORS.dim,
    });
    this.stepObjects.push(counter);

    const isFirstStep = currentIndex === 0;
    const backButton = createMenuButton({
      scene: this,
      x: 80,
      y: 28,
      width: 130,
      height: chipHeight,
      label: isFirstStep ? '← MAIN MENU' : '← BACK',
      variant: 'neutral',
      fontSize: 12,
      onActivate: () => this.goBack(),
    });
    backButton.card.hitZone.on('pointerover', () => backButton.setHoverState(true));
    backButton.card.hitZone.on('pointerout', () => backButton.setHoverState(false));
    this.stepButtons.push(backButton);
  }

  private buildUnlockGateContext(): UnlockGateContext {
    const metaManager = getMetaProgressionManager();
    return {
      unlockedConditionIds: getHiddenUnlockManager().getUnlockedConditionIds(),
      worldLevel: metaManager.getWorldLevel(),
      accountLevel: metaManager.getAccountLevel(),
    };
  }

  private getAvailableStages(): StageDefinition[] {
    const gateContext = this.buildUnlockGateContext();
    return STAGES.filter((stage) => isUnlockRequirementMet(stage.unlockRequirement, gateContext));
  }

  private renderStageSelectionStep(stages: StageDefinition[]): void {
    this.clearStepUI();
    this.currentStep = 'stage';
    this.renderStepHeader();
    this.renderStepTitle('CHOOSE YOUR STAGE', 'Each stage changes visuals, difficulty, and rewards', ACCENT_COLORS_STR.magenta);

    const cardWidth = 220;
    const cardHeight = 160;
    const cardSpacing = 24;
    const layout = this.computeGridLayout(stages.length, cardWidth, cardHeight, cardSpacing, 4, 30);

    const focusable: { card: MenuCard; nameText: Phaser.GameObjects.Text; stage: StageDefinition }[] = [];
    stages.forEach((stage, index) => {
      const { x: cardX, y: cardY } = layout.positionAt(index);
      const tilt = (index % 2 === 0 ? CARD_TILT_PRESETS.leftLean : CARD_TILT_PRESETS.rightLean) * 0.6;

      const card = createMenuCard(this, {
        x: cardX,
        y: cardY,
        width: cardWidth,
        height: cardHeight,
        tilt,
        wobbleSeed: index * 0.7,
        bodyFillColor: BODY_COLORS.magenta,
        accentColor: stage.gridLineColor,
        bannerHeight: 40,
        borderWidth: 3,
        borderColor: stage.gridLineColor,
        cornerRadius: 14,
      });

      const nameText = makeStickerText(this, 0, card.bannerTopY + 20, stage.name.toUpperCase(), {
        fontSize: 16,
        color: TEXT_COLORS.sticker,
        letterSpacing: 1.5,
      });
      card.frame.add(nameText);

      const description = makeBodyText(this, 0, 18, stage.description, {
        fontSize: 13,
        color: TEXT_COLORS.body,
        wordWrapWidth: cardWidth - 28,
      });
      description.setLineSpacing(2);
      card.frame.add(description);

      this.stepCards.push(card);
      focusable.push({ card, nameText, stage });

      card.hitZone.on('pointerdown', () => {
        this.soundManager.playUIClick();
        this.selectedStageId = stage.id;
        this.proceedToShipStep();
      });
      card.hitZone.on('pointerover', () => {
        this.soundManager.playUIClick();
        card.setHoverState(true);
      });
      card.hitZone.on('pointerout', () => card.setHoverState(false));
    });

    this.destroyMenuNavigator();
    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: focusable.map((entry) => ({
        onFocus: () => entry.card.setFocusState(true),
        onBlur: () => entry.card.setFocusState(false),
        onActivate: () => {
          this.soundManager.playUIClick();
          this.selectedStageId = entry.stage.id;
          this.proceedToShipStep();
        },
      })),
      columns: layout.columns,
      wrap: true,
      onCancel: () => this.goBack(),
    });
  }

  private proceedToShipStep(): void {
    this.clearStepUI();
    this.destroyMenuNavigator();
    const availableShips = this.getAvailableShips();
    if (availableShips.length > 1) {
      this.renderShipSelectionStep(availableShips);
    } else {
      this.selectedShipId = 'ship_default';
      this.proceedToWeaponStep();
    }
  }

  private getAvailableShips(): ShipCharacter[] {
    const gateContext = this.buildUnlockGateContext();
    return SHIP_CHARACTERS.filter((ship) => isUnlockRequirementMet(ship.unlockRequirement, gateContext));
  }

  private renderShipSelectionStep(ships: ShipCharacter[]): void {
    this.clearStepUI();
    this.currentStep = 'ship';
    this.renderStepHeader();
    this.renderStepTitle('CHOOSE YOUR SHIP', 'Each ship grants unique starting gear and stat tradeoffs', ACCENT_COLORS_STR.primary);

    const cardWidth = 200;
    const cardHeight = 160;
    const cardSpacing = 22;
    const layout = this.computeGridLayout(ships.length, cardWidth, cardHeight, cardSpacing, 4, 30);

    const focusable: { card: MenuCard; ship: ShipCharacter }[] = [];
    ships.forEach((ship, index) => {
      const { x: cardX, y: cardY } = layout.positionAt(index);
      const tilt = (index % 2 === 0 ? CARD_TILT_PRESETS.leftLean : CARD_TILT_PRESETS.rightLean) * 0.5;

      const card = createMenuCard(this, {
        x: cardX,
        y: cardY,
        width: cardWidth,
        height: cardHeight,
        tilt,
        wobbleSeed: index * 0.9 + 0.3,
        bodyFillColor: BODY_COLORS.primary,
        accentColor: ACCENT_COLORS.primary,
        bannerHeight: 40,
        borderWidth: 3,
        borderColor: ACCENT_COLORS.primary,
        cornerRadius: 14,
      });

      const nameText = makeStickerText(this, 0, card.bannerTopY + 20, ship.name.toUpperCase(), {
        fontSize: 15,
        color: TEXT_COLORS.sticker,
        letterSpacing: 1.5,
      });
      card.frame.add(nameText);

      // The ship's actual hull silhouette (unique per ship), nose-up.
      const hullPreview = this.drawShipHullPreview(ship, 58);
      hullPreview.setPosition(0, -8);
      card.frame.add(hullPreview);

      const description = makeBodyText(this, 0, 46, ship.description, {
        fontSize: 11,
        color: TEXT_COLORS.body,
        wordWrapWidth: cardWidth - 26,
      });
      description.setLineSpacing(2);
      card.frame.add(description);

      this.stepCards.push(card);
      focusable.push({ card, ship });

      card.hitZone.on('pointerover', () => {
        this.soundManager.playUIClick();
        card.setHoverState(true);
      });
      card.hitZone.on('pointerout', () => card.setHoverState(false));
      card.hitZone.on('pointerdown', () => {
        this.soundManager.playUIClick();
        this.selectedShipId = ship.id;
        this.proceedToWeaponStep();
      });
    });

    this.destroyMenuNavigator();
    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: focusable.map((entry) => ({
        onFocus: () => entry.card.setFocusState(true),
        onBlur: () => entry.card.setFocusState(false),
        onActivate: () => {
          this.soundManager.playUIClick();
          this.selectedShipId = entry.ship.id;
          this.proceedToWeaponStep();
        },
      })),
      columns: layout.columns,
      wrap: true,
      onCancel: () => this.goBack(),
    });
  }

  /**
   * Draws a ship's real hull silhouette (its unique per-ship geometry, shown
   * at mid-evolution tier) nose-up, mirroring PlayerSpaceship's neon style:
   * soft glow, dark hull fill, bright edge stroke, cockpit, engines, accents.
   * The returned Graphics is meant to be added to a card frame container.
   */
  private drawShipHullPreview(ship: ShipCharacter, targetSize: number): Phaser.GameObjects.Graphics {
    const graphics = this.add.graphics();
    const geometry = getShipTierGeometry(ship.hullId, 4); // mid-evolution (Warbird) form
    const palette = SHIP_NEON_PALETTES[ship.neonColorId] ?? SHIP_NEON_PALETTES.cyan;
    const color = palette.core;

    const bounds = getHullBounds(geometry.hullOutline);
    const extent = Math.max(bounds.maxX, -bounds.minX, bounds.maxY, -bounds.minY) * 2;
    const scale = targetSize / extent;

    // Ship geometry faces +x; rotate -90° so the nose points up on the card.
    const project = (point: Point2D, inflate: number = 1): Point2D => ({
      x: point.y * scale * inflate,
      y: -point.x * scale * inflate,
    });
    const tracePolygon = (points: Point2D[], inflate: number = 1): void => {
      graphics.beginPath();
      points.forEach((point, index) => {
        const projected = project(point, inflate);
        if (index === 0) graphics.moveTo(projected.x, projected.y);
        else graphics.lineTo(projected.x, projected.y);
      });
      graphics.closePath();
    };

    // Soft glow halo behind the hull.
    graphics.fillStyle(lightenColor(color, 0.35), 0.14);
    tracePolygon(geometry.hullOutline, 1.18);
    graphics.fillPath();

    // Dark hull fill + neon edge (the Tron look).
    graphics.fillStyle(darkenColor(color, 0.85), 0.95);
    tracePolygon(geometry.hullOutline);
    graphics.fillPath();
    graphics.lineStyle(2.5, lightenColor(color, 0.3), 0.2);
    tracePolygon(geometry.hullOutline);
    graphics.strokePath();
    graphics.lineStyle(1.4, color, 1.0);
    tracePolygon(geometry.hullOutline);
    graphics.strokePath();

    // Cockpit.
    graphics.fillStyle(darkenColor(color, 0.9), 0.9);
    tracePolygon(geometry.cockpit);
    graphics.fillPath();
    graphics.lineStyle(0.9, color, 0.9);
    tracePolygon(geometry.cockpit);
    graphics.strokePath();

    // Engine nozzles.
    for (const nozzle of geometry.engineNozzles) {
      const projected = project(nozzle);
      graphics.fillStyle(darkenColor(color, 0.8), 0.8);
      graphics.fillCircle(projected.x, projected.y, geometry.engineNozzleRadius * scale);
      graphics.lineStyle(0.6, color, 0.7);
      graphics.strokeCircle(projected.x, projected.y, geometry.engineNozzleRadius * scale);
    }

    // Wing-tip accent lights.
    const accentColor = lightenColor(color, 0.6);
    for (const accent of geometry.wingTipAccents) {
      const projected = project(accent);
      graphics.fillStyle(accentColor, 0.9);
      graphics.fillCircle(projected.x, projected.y, Math.max(1.2, geometry.wingTipAccentRadius * scale));
    }

    return graphics;
  }

  private clearStepUI(): void {
    for (const card of this.stepCards) card.destroy();
    this.stepCards = [];
    for (const btn of this.stepButtons) btn.destroy();
    this.stepButtons = [];
    for (const obj of this.stepObjects) obj.destroy();
    this.stepObjects = [];
    this.weaponCardRefs = [];
  }

  private destroyMenuNavigator(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
  }

  private renderStepTitle(title: string, subtitle: string, titleColor: string): void {
    const centerX = this.scale.width / 2;
    const titleText = makeStickerText(this, centerX, 90, title, {
      fontSize: 36,
      color: titleColor,
      strokeWidth: 5,
      letterSpacing: 3,
    });
    this.stepObjects.push(titleText);

    const subtitleText = makeBodyText(this, centerX, 130, subtitle, {
      fontSize: 14,
      color: TEXT_COLORS.muted,
    });
    this.stepObjects.push(subtitleText);
  }

  private computeGridLayout(
    count: number,
    cardWidth: number,
    cardHeight: number,
    cardSpacing: number,
    maxColumns: number,
    yOffset: number = 0,
  ) {
    const centerX = this.scale.width / 2;
    const columns = Math.min(count, maxColumns);
    const rows = Math.ceil(count / columns);
    const totalGridWidth = columns * cardWidth + (columns - 1) * cardSpacing;
    const totalGridHeight = rows * cardHeight + (rows - 1) * cardSpacing;
    const startX = centerX - totalGridWidth / 2 + cardWidth / 2;
    const startY = this.scale.height / 2 - totalGridHeight / 2 + yOffset;

    return {
      columns,
      positionAt: (index: number) => ({
        x: startX + (index % columns) * (cardWidth + cardSpacing),
        y: startY + Math.floor(index / columns) * (cardHeight + cardSpacing),
      }),
    };
  }

  private proceedToWeaponStep(): void {
    this.clearStepUI();
    this.destroyMenuNavigator();

    if (this.discoveredWeaponsCache.length <= 1) {
      const selectedModifiers = selectRunModifiers(2);
      this.scene.start('PactSelectScene', {
        startingWeapon: 'projectile',
        shipId: this.selectedShipId,
        stageId: this.selectedStageId,
        modifierIds: selectedModifiers.map((m) => m.id),
      });
      return;
    }

    this.renderWeaponSelectionStep(this.discoveredWeaponsCache);
  }

  private renderWeaponSelectionStep(discoveredWeapons: WeaponInfo[]): void {
    this.currentStep = 'weapon';
    this.renderStepHeader();
    this.renderStepTitle('CHOOSE YOUR WEAPON', 'Select the weapon you want to start your run with', ACCENT_COLORS_STR.gold);

    this.weaponCardRefs = [];
    this.buildWeaponCards(discoveredWeapons);

    const centerX = this.scale.width / 2;
    const randomButtonY = this.scale.height - 60;
    const randomButton = createMenuButton({
      scene: this,
      x: centerX,
      y: randomButtonY,
      width: 200,
      height: 48,
      label: '🎲 RANDOM',
      variant: 'gold',
      fontSize: 18,
    });
    randomButton.card.hitZone.on('pointerover', () => randomButton.setHoverState(true));
    randomButton.card.hitZone.on('pointerout', () => randomButton.setHoverState(false));
    const pickRandom = () => {
      const randomWeapon = discoveredWeapons[Math.floor(Math.random() * discoveredWeapons.length)];
      this.selectWeapon(randomWeapon.id);
    };
    randomButton.card.hitZone.on('pointerdown', pickRandom);
    this.stepButtons.push(randomButton);

    const hint = makeBodyText(this, centerX, this.scale.height - 22,
      'Press 1-9 to quick select  |  R for random', {
        fontSize: 11,
        color: TEXT_COLORS.dim,
      });
    this.stepObjects.push(hint);

    const gridColumns = Math.min(discoveredWeapons.length, 7);
    const navigableItems: { onFocus: () => void; onBlur: () => void; onActivate: () => void }[] = this.weaponCardRefs.map((cardRef) => ({
      onFocus: () => this.focusWeaponCard(cardRef),
      onBlur: () => this.blurWeaponCard(cardRef),
      onActivate: () => {
        this.soundManager.playUIClick();
        this.selectWeapon(cardRef.weaponId);
      },
    }));

    navigableItems.push({
      onFocus: () => randomButton.setFocusState(true),
      onBlur: () => randomButton.setFocusState(false),
      onActivate: pickRandom,
    });

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: gridColumns,
      wrap: true,
      onCancel: () => this.goBack(),
    });

    if (this.weaponStepKeyHandler) {
      this.input.keyboard?.off('keydown', this.weaponStepKeyHandler);
      this.weaponStepKeyHandler = null;
    }
    this.weaponStepKeyHandler = (event: KeyboardEvent) => {
      const keyNumber = parseInt(event.key);
      if (keyNumber >= 1 && keyNumber <= discoveredWeapons.length) {
        this.selectWeapon(discoveredWeapons[keyNumber - 1].id);
      }
      if (event.key === 'r' || event.key === 'R') pickRandom();
    };
    this.input.keyboard?.on('keydown', this.weaponStepKeyHandler);
  }

  private buildWeaponCards(weapons: WeaponInfo[]): void {
    const cardWidth = 150;
    const cardHeight = 180;
    const cardSpacing = 14;
    const layout = this.computeGridLayout(weapons.length, cardWidth, cardHeight, cardSpacing, 7, 30);

    weapons.forEach((weaponInfo, index) => {
      const { x: cardX, y: cardY } = layout.positionAt(index);
      this.createWeaponCard(weaponInfo, cardX, cardY, cardWidth, cardHeight, index + 1);
    });
  }

  private focusWeaponCard(cardRef: WeaponCardRef): void {
    cardRef.card.setFocusState(true);
    const iconBaseScale = 40 / 64;
    cardRef.iconSprite.setScale(iconBaseScale * 1.12);
  }

  private blurWeaponCard(cardRef: WeaponCardRef): void {
    cardRef.card.setFocusState(false);
    const iconBaseScale = 40 / 64;
    cardRef.iconSprite.setScale(iconBaseScale);
  }

  private createWeaponCard(
    weaponInfo: WeaponInfo,
    x: number,
    y: number,
    width: number,
    height: number,
    keyNumber: number,
  ): void {
    const tiltOptions = [
      CARD_TILT_PRESETS.leftLean,
      CARD_TILT_PRESETS.hero,
      CARD_TILT_PRESETS.rightLean,
      CARD_TILT_PRESETS.rest,
    ];
    const baseTilt = tiltOptions[keyNumber % tiltOptions.length] * 0.6;

    const card = createMenuCard(this, {
      x,
      y,
      width,
      height,
      tilt: baseTilt,
      wobbleSeed: keyNumber * 0.5 + 0.1,
      bodyFillColor: BODY_COLORS.gold,
      accentColor: ACCENT_COLORS.gold,
      bannerHeight: 32,
      borderWidth: 3,
      borderColor: ACCENT_COLORS.gold,
      cornerRadius: 12,
    });

    const nameText = makeStickerText(this, 0, card.bannerTopY + 16, weaponInfo.name.toUpperCase(), {
      fontSize: 12,
      color: TEXT_COLORS.sticker,
      letterSpacing: 1,
    });
    card.frame.add(nameText);

    const iconY = -height / 2 + 70;
    const iconSprite = createIcon(this, { x: 0, y: iconY, iconKey: weaponInfo.icon, size: 40, tint: 0xffffff });
    card.frame.add(iconSprite);

    const descriptionText = this.add.text(0, iconY + 36, weaponInfo.description, {
      fontSize: '10px',
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.body,
      align: 'center',
      wordWrap: { width: width - 14 },
    });
    descriptionText.setOrigin(0.5);
    card.frame.add(descriptionText);

    if (keyNumber <= 9) {
      const keyChip = makeStickerText(this, 0, height / 2 - 16, `[ ${keyNumber} ]`, {
        fontSize: 11,
        color: TEXT_COLORS.muted,
        letterSpacing: 1,
      });
      card.frame.add(keyChip);
    }

    const cardRef: WeaponCardRef = { card, nameText, iconSprite, weaponId: weaponInfo.id };
    this.weaponCardRefs.push(cardRef);
    this.stepCards.push(card);

    card.hitZone.on('pointerover', () => {
      this.soundManager.playUIClick();
      this.focusWeaponCard(cardRef);
      const cardIndex = this.weaponCardRefs.indexOf(cardRef);
      if (cardIndex >= 0 && this.menuNavigator) {
        this.menuNavigator.selectIndex(cardIndex);
      }
    });
    card.hitZone.on('pointerout', () => this.blurWeaponCard(cardRef));
    card.hitZone.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.selectWeapon(weaponInfo.id);
    });
  }

  private selectWeapon(weaponId: string): void {
    this.input.keyboard?.removeAllListeners();
    this.input.removeAllListeners();

    const selectedModifiers = selectRunModifiers(2);
    fadeOut(this, 150, () => {
      this.scene.start('PactSelectScene', {
        startingWeapon: weaponId,
        shipId: this.selectedShipId,
        stageId: this.selectedStageId,
        modifierIds: selectedModifiers.map((m) => m.id),
      });
    });
  }

  shutdown(): void {
    this.destroyMenuNavigator();
    this.input.keyboard?.removeAllListeners();
    this.tweens.killAll();
    if (this.bgUpdateHandler) {
      this.events.off('update', this.bgUpdateHandler);
      this.bgUpdateHandler = null;
    }
    this.menuBackground?.destroy();
    this.menuBackground = null;
    this.clearStepUI();
  }
}
