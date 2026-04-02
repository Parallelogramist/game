import Phaser from 'phaser';
import { Upgrade, getBlockingGate, getBlockingUpgrades } from '../../data/Upgrades';
import { createIcon } from '../../utils/IconRenderer';
import { SoundManager } from '../../audio/SoundManager';
import { TooltipManager } from '../../ui/TooltipManager';
import { addButtonInteraction } from '../../utils/SceneTransition';

/**
 * Data passed to UpgradeScene for initialization.
 */
export interface UpgradeSceneData {
  upgrades: Upgrade[];
  onSelect: (upgrade: Upgrade) => void;
  rerollsRemaining: number;
  skipsRemaining: number;
  banishesRemaining: number;
  onReroll: () => void;
  onSkip: () => void;
  onBanish: (upgrade: Upgrade) => void;
  // Weapon slot system
  isLastWeaponSlot?: boolean;
  weaponSlotsInfo?: { current: number; max: number };
  // All stat upgrades for break gate checking
  allStatUpgrades?: Upgrade[];
  // Current player level for milestone indicator
  playerLevel?: number;
}

/**
 * UpgradeScene displays upgrade choices when the player levels up.
 * Launched as an overlay on top of GameScene.
 */
export class UpgradeScene extends Phaser.Scene {
  private upgrades: Upgrade[] = [];
  private onSelectCallback: ((upgrade: Upgrade) => void) | null = null;
  private upgradeCards: Phaser.GameObjects.Container[] = [];
  private cardBackgrounds: Phaser.GameObjects.Rectangle[] = [];
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private cardScaleFactor: number = 1;
  private soundManager!: SoundManager;
  private tooltipManager!: TooltipManager;

  // Utility tracking
  private rerollsRemaining: number = 0;
  private skipsRemaining: number = 0;
  private banishesRemaining: number = 0;
  private onRerollCallback: (() => void) | null = null;
  private onSkipCallback: (() => void) | null = null;
  private onBanishCallback: ((upgrade: Upgrade) => void) | null = null;

  // Banish mode state
  private isBanishMode: boolean = false;
  private banishModeText: Phaser.GameObjects.Text | null = null;
  private banishConfirmElements: Phaser.GameObjects.GameObject[] = [];

  // Weapon slot tracking
  private isLastWeaponSlot: boolean = false;
  private weaponSlotsInfo: { current: number; max: number } | null = null;
  private allStatUpgrades: Upgrade[] = [];
  private playerLevel: number = 0;

  constructor() {
    super({ key: 'UpgradeScene' });
  }

  /**
   * Initialize with upgrade choices and callbacks.
   */
  init(data: UpgradeSceneData): void {
    this.upgrades = data.upgrades;
    this.onSelectCallback = data.onSelect;
    this.rerollsRemaining = data.rerollsRemaining ?? 0;
    this.skipsRemaining = data.skipsRemaining ?? 0;
    this.banishesRemaining = data.banishesRemaining ?? 0;
    this.onRerollCallback = data.onReroll ?? null;
    this.onSkipCallback = data.onSkip ?? null;
    this.onBanishCallback = data.onBanish ?? null;
    this.isBanishMode = false;
    // Weapon slot system
    this.isLastWeaponSlot = data.isLastWeaponSlot ?? false;
    this.weaponSlotsInfo = data.weaponSlotsInfo ?? null;
    this.allStatUpgrades = data.allStatUpgrades ?? [];
    this.playerLevel = data.playerLevel ?? 0;
  }

  create(): void {
    // Clear arrays from previous invocations
    this.upgradeCards = [];
    this.cardBackgrounds = [];
    this.cardScaleFactor = 1;
    this.soundManager = new SoundManager(this);
    this.tooltipManager = new TooltipManager(this);

    // Semi-transparent dark overlay
    const overlay = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x000000,
      0.7
    );
    overlay.setDepth(0);

    // Title — weapon milestone levels get special treatment
    const isWeaponMilestone = this.playerLevel > 0 && this.playerLevel % 5 === 0;
    const titleString = isWeaponMilestone ? 'WEAPON MILESTONE!' : 'LEVEL UP!';
    const titleColor = isWeaponMilestone ? '#88aaff' : '#ffdd44';
    const title = this.add.text(this.scale.width / 2, 80, titleString, {
      fontSize: '48px',
      fontFamily: 'Arial',
      color: titleColor,
      stroke: '#000000',
      strokeThickness: 4,
    });
    title.setOrigin(0.5);
    title.setDepth(1);

    // Subtitle
    const subtitleText = isWeaponMilestone ? 'Pick a new weapon!' : 'Choose an upgrade';
    const subtitle = this.add.text(this.scale.width / 2, 130, subtitleText, {
      fontSize: '24px',
      fontFamily: 'Arial',
      color: isWeaponMilestone ? '#88aaff' : '#aaaaaa',
    });
    subtitle.setOrigin(0.5);
    subtitle.setDepth(1);

    // Final weapon slot warning banner
    if (this.isLastWeaponSlot) {
      // Warning background
      const warningBg = this.add.rectangle(this.scale.width / 2, 165, 400, 36, 0x442200, 0.9);
      warningBg.setStrokeStyle(2, 0xffaa00);
      warningBg.setDepth(1);

      // Warning text
      const warningText = this.add.text(
        this.scale.width / 2,
        165,
        '⚠ FINAL WEAPON SLOT - Choose wisely!',
        {
          fontSize: '18px',
          fontFamily: 'Arial',
          color: '#ffaa00',
        }
      );
      warningText.setOrigin(0.5);
      warningText.setDepth(2);

      // Weapon slot counter
      if (this.weaponSlotsInfo) {
        const slotText = this.add.text(
          this.scale.width / 2,
          188,
          `Weapons: ${this.weaponSlotsInfo.current}/${this.weaponSlotsInfo.max}`,
          {
            fontSize: '14px',
            fontFamily: 'Arial',
            color: '#888888',
          }
        );
        slotText.setOrigin(0.5);
        slotText.setDepth(2);
      }
    }

    // Create upgrade cards
    this.createUpgradeCards();

    // Create utility buttons (reroll, skip, banish)
    this.createUtilityButtons();

    // Single keyboard listener for all cards (prevents listener accumulation)
    this.keydownHandler = (event: KeyboardEvent) => {
      // Block all input while banish confirmation is open
      if (this.banishConfirmElements.length > 0) {
        if (event.key === 'Escape') {
          this.destroyBanishConfirmation();
        }
        return;
      }

      const keyNumber = parseInt(event.key, 10);
      if (keyNumber >= 1 && keyNumber <= this.upgrades.length) {
        if (this.isBanishMode) {
          this.banishUpgrade(this.upgrades[keyNumber - 1]);
        } else {
          this.selectUpgrade(this.upgrades[keyNumber - 1]);
        }
      }
      // R for reroll
      if (event.key.toLowerCase() === 'r' && this.rerollsRemaining > 0) {
        this.handleReroll();
      }
      // X for skip
      if (event.key.toLowerCase() === 'x' && this.skipsRemaining > 0) {
        this.handleSkip();
      }
      // B for banish mode toggle
      if (event.key.toLowerCase() === 'b' && this.banishesRemaining > 0) {
        this.toggleBanishMode();
      }
      // Escape to cancel banish mode
      if (event.key === 'Escape' && this.isBanishMode) {
        this.toggleBanishMode();
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);

    // Animate entrance
    this.animateEntrance();
  }

  /**
   * Creates the reroll, skip, and banish buttons at the bottom of the screen.
   */
  private createUtilityButtons(): void {
    const buttonY = this.scale.height - 60;
    const buttonSpacing = 180;
    const startX = this.scale.width / 2 - buttonSpacing;

    // Reroll button
    if (this.rerollsRemaining > 0 || true) { // Always show, but disabled if 0
      this.createUtilityButton(
        startX,
        buttonY,
        `Reroll (${this.rerollsRemaining})`,
        'R',
        this.rerollsRemaining > 0,
        () => this.handleReroll(),
        'Shuffle the upgrade choices. You get a limited number per run.'
      );
    }

    // Skip button
    this.createUtilityButton(
      startX + buttonSpacing,
      buttonY,
      `Skip (${this.skipsRemaining})`,
      'X',
      this.skipsRemaining > 0,
      () => this.handleSkip(),
      'Skip this level-up entirely. The upgrades go back into the pool.'
    );

    // Banish button
    this.createUtilityButton(
      startX + buttonSpacing * 2,
      buttonY,
      `Banish (${this.banishesRemaining})`,
      'B',
      this.banishesRemaining > 0,
      () => this.toggleBanishMode(),
      'Permanently remove an upgrade from this run\'s pool. Click a card to banish it.'
    );
  }

  /**
   * Creates a single utility button.
   */
  private createUtilityButton(
    x: number,
    y: number,
    label: string,
    hotkey: string,
    enabled: boolean,
    onClick: () => void,
    tooltip?: string
  ): void {
    const buttonWidth = 140;
    const buttonHeight = 40;

    const background = this.add.rectangle(
      x,
      y,
      buttonWidth,
      buttonHeight,
      enabled ? 0x3a3a6a : 0x1a1a2a
    );
    background.setStrokeStyle(2, enabled ? 0x7a7aaa : 0x2a2a3a);
    background.setDepth(10);
    background.setAlpha(enabled ? 1.0 : 0.4);

    const text = this.add.text(x, y, label, {
      fontSize: '14px',
      fontFamily: 'Arial',
      color: enabled ? '#ffffff' : '#444444',
    });
    text.setOrigin(0.5);
    text.setDepth(11);
    text.setAlpha(enabled ? 1.0 : 0.4);

    const hotkeyText = this.add.text(x + buttonWidth / 2 - 8, y - buttonHeight / 2 + 8, hotkey, {
      fontSize: '10px',
      fontFamily: 'Arial',
      color: enabled ? '#aaaaff' : '#333355',
    });
    hotkeyText.setOrigin(0.5);
    hotkeyText.setDepth(11);
    hotkeyText.setAlpha(enabled ? 1.0 : 0.4);

    if (enabled) {
      background.setInteractive({ useHandCursor: true });
      background.on('pointerover', () => {
        background.setFillStyle(0x4a4a7a);
      });
      background.on('pointerout', () => {
        background.setFillStyle(0x3a3a6a);
      });
      background.on('pointerdown', onClick);
      addButtonInteraction(this, background);
    }

    if (tooltip) {
      this.tooltipManager.attach(background, tooltip);
    }
  }

  /**
   * Handles the reroll action.
   */
  private handleReroll(): void {
    if (this.rerollsRemaining <= 0 || !this.onRerollCallback) return;
    this.soundManager.playUIClick();

    // Close scene and trigger reroll
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 150,
      onComplete: () => {
        this.onRerollCallback?.();
        this.scene.stop();
      },
    });
  }

  /**
   * Handles the skip action.
   */
  private handleSkip(): void {
    if (this.skipsRemaining <= 0 || !this.onSkipCallback) return;
    this.soundManager.playUIClick();

    // Close scene and trigger skip
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 150,
      onComplete: () => {
        this.onSkipCallback?.();
        this.scene.stop();
      },
    });
  }

  /**
   * Toggles banish mode on/off.
   */
  private toggleBanishMode(): void {
    if (this.banishesRemaining <= 0 && !this.isBanishMode) return;
    this.soundManager.playUIClick();

    this.isBanishMode = !this.isBanishMode;

    if (this.isBanishMode) {
      // Show banish mode indicator
      this.banishModeText = this.add.text(
        this.scale.width / 2,
        160,
        '🚫 BANISH MODE - Click an upgrade to remove it permanently',
        {
          fontSize: '18px',
          fontFamily: 'Arial',
          color: '#ff6666',
          backgroundColor: '#330000',
          padding: { x: 16, y: 8 },
        }
      );
      this.banishModeText.setOrigin(0.5);
      this.banishModeText.setDepth(20);

      // Update card borders to red
      this.cardBackgrounds.forEach((bg) => {
        bg.setStrokeStyle(3, 0xff4444);
      });
    } else {
      // Remove banish mode indicator
      this.banishModeText?.destroy();
      this.banishModeText = null;

      // Reset card borders
      this.cardBackgrounds.forEach((bg) => {
        bg.setStrokeStyle(3, 0x4a4a7a);
      });
    }
  }

  /**
   * Banishes an upgrade (removes from pool permanently).
   * Shows a confirmation dialog first since this is irreversible.
   */
  private banishUpgrade(upgrade: Upgrade): void {
    if (!this.isBanishMode || this.banishesRemaining <= 0 || !this.onBanishCallback) return;

    this.showBanishConfirmation(upgrade, () => {
      const selectedIndex = this.upgrades.indexOf(upgrade);
      if (selectedIndex >= 0 && this.upgradeCards[selectedIndex]) {
        const card = this.upgradeCards[selectedIndex];
        this.tweens.add({
          targets: card,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: 300,
          ease: 'Back.easeIn',
          onComplete: () => {
            this.onBanishCallback?.(upgrade);
            this.scene.stop();
          },
        });
      }
    });
  }

  /**
   * Shows a confirmation dialog before banishing an upgrade.
   */
  private showBanishConfirmation(upgrade: Upgrade, onConfirm: () => void): void {
    // Dim existing UI
    const dimOverlay = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height,
      0x000000, 0.5
    ).setDepth(30);
    this.banishConfirmElements.push(dimOverlay);

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    // Panel background
    const panel = this.add.rectangle(centerX, centerY, 340, 150, 0x1a1a2e)
      .setStrokeStyle(2, 0xff4444).setDepth(31);
    this.banishConfirmElements.push(panel);

    // Warning text
    const warningText = this.add.text(centerX, centerY - 40,
      `Permanently remove\n"${upgrade.name}"?`, {
        fontSize: '16px', fontFamily: 'Arial', color: '#ff6666', align: 'center',
      }).setOrigin(0.5).setDepth(31);
    this.banishConfirmElements.push(warningText);

    const subText = this.add.text(centerX, centerY - 5,
      'This cannot be undone.', {
        fontSize: '12px', fontFamily: 'Arial', color: '#888888',
      }).setOrigin(0.5).setDepth(31);
    this.banishConfirmElements.push(subText);

    // Confirm button
    const confirmBg = this.add.rectangle(centerX - 60, centerY + 40, 100, 34, 0x661111)
      .setStrokeStyle(1, 0xff4444).setDepth(31).setInteractive({ useHandCursor: true });
    const confirmText = this.add.text(centerX - 60, centerY + 40, 'Banish', {
      fontSize: '14px', fontFamily: 'Arial', color: '#ff6666',
    }).setOrigin(0.5).setDepth(31);
    this.banishConfirmElements.push(confirmBg, confirmText);

    confirmBg.on('pointerover', () => confirmBg.setFillStyle(0x882222));
    confirmBg.on('pointerout', () => confirmBg.setFillStyle(0x661111));
    confirmBg.on('pointerdown', () => {
      this.destroyBanishConfirmation();
      onConfirm();
    });
    addButtonInteraction(this, confirmBg);

    // Cancel button
    const cancelBg = this.add.rectangle(centerX + 60, centerY + 40, 100, 34, 0x2a2a4a)
      .setStrokeStyle(1, 0x6a6a8a).setDepth(31).setInteractive({ useHandCursor: true });
    const cancelText = this.add.text(centerX + 60, centerY + 40, 'Cancel', {
      fontSize: '14px', fontFamily: 'Arial', color: '#aaaacc',
    }).setOrigin(0.5).setDepth(31);
    this.banishConfirmElements.push(cancelBg, cancelText);

    cancelBg.on('pointerover', () => cancelBg.setFillStyle(0x3a3a5a));
    cancelBg.on('pointerout', () => cancelBg.setFillStyle(0x2a2a4a));
    cancelBg.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.destroyBanishConfirmation();
    });
    addButtonInteraction(this, cancelBg);
  }

  private destroyBanishConfirmation(): void {
    this.banishConfirmElements.forEach(el => el.destroy());
    this.banishConfirmElements = [];
  }

  /**
   * Clean up event listeners and tweens when scene shuts down.
   * Critical for preventing memory leaks and performance degradation.
   */
  shutdown(): void {
    this.tooltipManager.destroy();
    // Remove keyboard listener
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    // Remove all pointer listeners from card backgrounds
    for (const cardBackground of this.cardBackgrounds) {
      cardBackground.removeAllListeners();
    }

    // Clean up banish confirmation if open
    this.destroyBanishConfirmation();

    // Kill all active tweens to prevent them from continuing
    this.tweens.killAll();

    // Clear arrays
    this.upgradeCards = [];
    this.cardBackgrounds = [];
  }

  private createUpgradeCards(): void {
    const baseCardWidth = 280;
    const baseCardHeight = 320;
    const baseCardSpacing = 40;
    const baseRowSpacing = 30;
    const horizontalMargin = 60;

    // Split upgrades into rows with balanced distribution
    const numCards = this.upgrades.length;
    const rows: Upgrade[][] = [];

    if (numCards <= 4) {
      // Single row for 4 or fewer cards
      rows.push(this.upgrades.slice());
    } else {
      // Two rows with balanced split: ceil(n/2) on first row, floor(n/2) on second
      const firstRowCount = Math.ceil(numCards / 2);
      rows.push(this.upgrades.slice(0, firstRowCount));
      rows.push(this.upgrades.slice(firstRowCount));
    }

    const numRows = rows.length;

    // Calculate scale factor based on the widest row
    const maxCardsInAnyRow = Math.max(...rows.map(row => row.length));
    const baseMaxRowWidth = maxCardsInAnyRow * baseCardWidth + (maxCardsInAnyRow - 1) * baseCardSpacing;
    const availableWidth = this.scale.width - (horizontalMargin * 2);
    let scaleFactor = Math.min(1, availableWidth / baseMaxRowWidth);

    // For 2 rows, also constrain by vertical space (leave room for title and utility buttons)
    if (numRows > 1) {
      const verticalMarginTop = 180; // Below title/subtitle
      const verticalMarginBottom = 100; // Above utility buttons
      const availableHeight = this.scale.height - verticalMarginTop - verticalMarginBottom;
      const baseTotalHeight = numRows * baseCardHeight + (numRows - 1) * baseRowSpacing;
      const verticalScaleFactor = availableHeight / baseTotalHeight;
      scaleFactor = Math.min(scaleFactor, verticalScaleFactor);
    }

    this.cardScaleFactor = scaleFactor;

    // Calculate scaled dimensions
    const cardWidth = baseCardWidth * scaleFactor;
    const cardHeight = baseCardHeight * scaleFactor;
    const cardSpacing = baseCardSpacing * scaleFactor;
    const rowSpacing = baseRowSpacing * scaleFactor;

    // Calculate vertical positioning for all rows
    const totalRowsHeight = numRows * cardHeight + (numRows - 1) * rowSpacing;
    const startY = (this.scale.height / 2) - (totalRowsHeight / 2) + (cardHeight / 2) + 20;

    // Track global index for keybinds
    let globalIndex = 0;

    rows.forEach((rowUpgrades, rowIndex) => {
      // Calculate horizontal positioning for this row (centered)
      const rowWidth = rowUpgrades.length * cardWidth + (rowUpgrades.length - 1) * cardSpacing;
      const rowStartX = (this.scale.width - rowWidth) / 2 + cardWidth / 2;
      const rowY = startY + rowIndex * (cardHeight + rowSpacing);

      rowUpgrades.forEach((upgrade, columnIndex) => {
        const cardX = rowStartX + columnIndex * (cardWidth + cardSpacing);
        const card = this.createCard(cardX, rowY, baseCardWidth, baseCardHeight, upgrade, globalIndex);
        card.setScale(scaleFactor);
        this.upgradeCards.push(card);
        globalIndex++;
      });
    });
  }

  private createCard(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    upgrade: Upgrade,
    index: number
  ): Phaser.GameObjects.Container {
    const container = this.add.container(positionX, positionY);
    container.setDepth(2);

    // Calculate text scale boost to compensate for card scaling (capped to avoid overflow)
    // Lower cap (1.2) prevents text from becoming too large and wrapping excessively
    const textBoost = Math.min(1.2, 1 / this.cardScaleFactor);

    // Card background
    const cardBackground = this.add.rectangle(0, 0, width, height, 0x2a2a4a);
    cardBackground.setStrokeStyle(3, 0x4a4a7a);
    container.add(cardBackground);

    // 8px grid spacing: icon at -96, then elements with consistent gaps
    const maxTextWidth = width - 48; // 24px padding on each side

    // Icon background circle
    const iconBackground = this.add.circle(0, -96, 40, 0x3a3a5a);
    container.add(iconBackground);

    // Icon (sprite from atlas)
    const icon = createIcon(this, {
      x: 0,
      y: -96,
      iconKey: upgrade.icon,
      size: 48,
    });
    container.add(icon);

    // Upgrade name (56px below icon center)
    const nameText = this.add.text(0, -40, upgrade.name, {
      fontSize: `${Math.round(24 * textBoost)}px`,
      fontFamily: 'Arial',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    nameText.setOrigin(0.5);
    container.add(nameText);

    // Current level indicator - graphics-based progress bar for perfect alignment
    const levelIndicator = this.createLevelProgressBar(upgrade, textBoost);
    levelIndicator.setPosition(0, 4); // Centered between name (-40) and description (32)
    container.add(levelIndicator);

    // Description below level indicator
    // WordWrap scales with textBoost since font is larger, but capped to card width
    const wrapWidth = Math.min(maxTextWidth * textBoost, width - 24);
    // Strip [MASTERY] prefix when ★ MASTERED ★ indicator is already shown
    let descriptionString = upgrade.getDescription(upgrade.currentLevel);
    const isMastered = upgrade.currentLevel + 1 >= upgrade.maxLevel && upgrade.maxLevel > 1;
    if (isMastered) {
      descriptionString = descriptionString.replace(/^\[MASTERY\]\s*/i, '');
    }
    const descriptionY = isMastered ? 58 : 32;
    const descriptionFontSize = isMastered ? 16 : 18;
    const descriptionText = this.add.text(0, descriptionY, descriptionString, {
      fontSize: `${Math.round(descriptionFontSize * textBoost)}px`,
      fontFamily: 'Arial',
      color: '#88ff88',
      wordWrap: { width: wrapWidth },
      align: 'center',
    });
    descriptionText.setOrigin(0.5);
    container.add(descriptionText);

    // Break level gate warning for stat upgrades
    let gateWarningHeight = 0;
    if (upgrade.isStatUpgrade && this.allStatUpgrades.length > 0) {
      const blockingGate = getBlockingGate(upgrade.currentLevel, this.allStatUpgrades);
      if (blockingGate !== null) {
        const blockingUpgrades = getBlockingUpgrades(blockingGate, this.allStatUpgrades);
        const blockingNames = blockingUpgrades.map(u => u.name).slice(0, 3).join(', ');
        const gateText = this.add.text(0, descriptionY + descriptionText.height / 2 + 8,
          `Gate Lv.${blockingGate} - Level up: ${blockingNames}`, {
            fontSize: `${Math.round(12 * textBoost)}px`,
            fontFamily: 'Arial',
            color: '#ff8844',
            wordWrap: { width: wrapWidth },
            align: 'center',
          });
        gateText.setOrigin(0.5);
        container.add(gateText);
        gateWarningHeight = gateText.height + 8;
      }
    }

    // Flavor text — positioned dynamically below description to avoid overlap
    const flavorText = this.add.text(0, 0, upgrade.description, {
      fontSize: `${Math.round(14 * textBoost)}px`,
      fontFamily: 'Arial',
      color: '#888888',
      fontStyle: 'italic',
      wordWrap: { width: wrapWidth },
      align: 'center',
    });
    flavorText.setOrigin(0.5);
    const flavorY = descriptionY + descriptionText.height / 2 + flavorText.height / 2 + 8 + gateWarningHeight;
    flavorText.setY(flavorY);
    container.add(flavorText);

    // Keybind hint — positioned dynamically below flavor text
    const keybindY = flavorY + flavorText.height / 2 + 16;
    const keybindText = this.add.text(0, keybindY, `Press ${index + 1}`, {
      fontSize: `${Math.round(16 * textBoost)}px`,
      fontFamily: 'Arial',
      color: '#666666',
    });
    keybindText.setOrigin(0.5);
    container.add(keybindText);

    // Make interactive
    cardBackground.setInteractive({ useHandCursor: true });

    // Hover effects (scale relative to cardScaleFactor)
    cardBackground.on('pointerover', () => {
      this.soundManager.playUIClick();
      cardBackground.setFillStyle(0x3a3a6a);
      cardBackground.setStrokeStyle(3, 0x88aaff);
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        scaleX: this.cardScaleFactor * 1.05,
        scaleY: this.cardScaleFactor * 1.05,
        duration: 100,
        ease: 'Back.easeOut',
      });
    });

    cardBackground.on('pointerout', () => {
      cardBackground.setFillStyle(0x2a2a4a);
      cardBackground.setStrokeStyle(3, 0x4a4a7a);
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        scaleX: this.cardScaleFactor,
        scaleY: this.cardScaleFactor,
        duration: 80,
        ease: 'Quad.easeOut',
      });
    });

    cardBackground.on('pointerdown', () => {
      this.selectUpgrade(upgrade);
    });

    // Store reference for cleanup
    this.cardBackgrounds.push(cardBackground);

    return container;
  }

  /**
   * Creates a graphics-based level progress bar for perfect alignment.
   * Returns either a container with rectangles or a text for mastered state.
   */
  private createLevelProgressBar(upgrade: Upgrade, textBoost: number): Phaser.GameObjects.Container | Phaser.GameObjects.Text {
    const filled = upgrade.currentLevel + 1; // Show level AFTER selecting this upgrade
    const total = upgrade.maxLevel;

    // Special display for mastered skills - use text
    if (filled >= total && total > 1) {
      const masteredText = this.add.text(0, 0, '★ MASTERED ★', {
        fontSize: `${Math.round(14 * textBoost)}px`,
        fontFamily: 'Arial',
        color: '#ffdd44',
      });
      masteredText.setOrigin(0.5);
      return masteredText;
    }

    // Graphics-based progress bar with parallelogram segments (slanted right)
    const barContainer = this.add.container(0, 0);
    const segmentWidth = 12 * textBoost;
    const segmentHeight = 8 * textBoost;
    const segmentGap = 3 * textBoost;
    const skew = 3 * textBoost; // Slant amount for parallelogram effect

    // Account for skew in total width calculation
    const totalWidth = total * (segmentWidth + skew) + (total - 1) * segmentGap;
    const startX = -totalWidth / 2;

    const previewIndex = filled - 1; // The segment that will fill if this upgrade is chosen

    for (let i = 0; i < total; i++) {
      const isFilled = i < filled;
      const isPreview = i === previewIndex && previewIndex >= 0;
      const x = startX + i * (segmentWidth + skew + segmentGap);

      // Parallelogram points: top edge shifted right by skew
      const points = [
        skew, -segmentHeight / 2,                    // top-left
        segmentWidth + skew, -segmentHeight / 2,     // top-right
        segmentWidth, segmentHeight / 2,             // bottom-right
        0, segmentHeight / 2                         // bottom-left
      ];

      if (isPreview) {
        // Preview segment: outline only (green border indicates next level)
        const segment = this.add.polygon(
          x + segmentWidth / 2,
          0,
          points,
          0x3a3a5a
        );
        segment.setStrokeStyle(1.5, 0x88ff88);
        barContainer.add(segment);
      } else {
        const segment = this.add.polygon(
          x + segmentWidth / 2,
          0,
          points,
          isFilled ? 0x88ff88 : 0x3a3a5a
        );

        if (!isFilled) {
          segment.setStrokeStyle(1, 0x5a5a7a);
        }
        barContainer.add(segment);
      }
    }

    return barContainer;
  }

  private selectUpgrade(upgrade: Upgrade): void {
    this.soundManager.playUpgradeSelect();
    // Prevent double selection
    this.input.keyboard?.removeAllListeners();
    this.upgradeCards.forEach((card) => {
      card.getAll().forEach((child) => {
        if (child instanceof Phaser.GameObjects.Rectangle) {
          child.removeAllListeners();
        }
      });
    });

    const selectedIndex = this.upgrades.indexOf(upgrade);
    if (selectedIndex >= 0 && this.upgradeCards[selectedIndex]) {
      const selectedCard = this.upgradeCards[selectedIndex];

      // Fade out unselected cards
      this.upgradeCards.forEach((card, cardIndex) => {
        if (cardIndex !== selectedIndex) {
          this.tweens.add({
            targets: card,
            alpha: 0,
            scaleX: this.cardScaleFactor * 0.9,
            scaleY: this.cardScaleFactor * 0.9,
            duration: 150,
            ease: 'Quad.easeIn',
          });
        }
      });

      // Flash card background white on selection
      const cardBg = selectedCard.getAt(0);
      if (cardBg instanceof Phaser.GameObjects.Rectangle) {
        const originalFill = cardBg.fillColor;
        cardBg.setFillStyle(0xffffff);
        this.time.delayedCall(80, () => {
          cardBg.setFillStyle(0x5a5aaa);
          this.time.delayedCall(120, () => {
            cardBg.setFillStyle(originalFill);
          });
        });
      }

      // Pulse selected card with bigger punch, then close
      this.tweens.add({
        targets: selectedCard,
        scaleX: this.cardScaleFactor * 1.12,
        scaleY: this.cardScaleFactor * 1.12,
        duration: 150,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: selectedCard,
            scaleX: this.cardScaleFactor * 1.05,
            scaleY: this.cardScaleFactor * 1.05,
            duration: 100,
            ease: 'Quad.easeOut',
            onComplete: () => {
              this.closeAndApply(upgrade);
            },
          });
        },
      });
    } else {
      this.closeAndApply(upgrade);
    }
  }

  private closeAndApply(upgrade: Upgrade): void {
    // Fade out
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 20,
      onComplete: () => {
        if (this.onSelectCallback) {
          this.onSelectCallback(upgrade);
        }
        this.scene.stop();
      },
    });
  }

  private animateEntrance(): void {
    // Animate cards sliding up
    this.upgradeCards.forEach((card, index) => {
      const targetY = card.y;
      card.y = this.scale.height + 200;
      card.alpha = 0;

      this.tweens.add({
        targets: card,
        y: targetY,
        alpha: 1,
        duration: 400,
        delay: index * 100,
        ease: 'Back.easeOut',
      });
    });
  }
}
