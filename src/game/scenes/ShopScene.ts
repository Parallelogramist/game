/**
 * ShopScene - UI for purchasing permanent upgrades with gold.
 * Features category tabs, scrolling, and progressive unlocking.
 * Full keyboard navigation support with zone-based focus system.
 */

import Phaser from 'phaser';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import {
  PermanentUpgrade,
  calculateUpgradeCost,
  getUpgradesByCategory,
  UPGRADE_CATEGORIES,
  UpgradeCategory,
} from '../../data/PermanentUpgrades';
import { GAME_WIDTH, GAME_HEIGHT } from '../../GameConfig';
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';

type FocusZone = 'tabs' | 'grid' | 'back';

interface UpgradeCardElements {
  container: Phaser.GameObjects.Container;
  levelText: Phaser.GameObjects.Text;
  effectText: Phaser.GameObjects.Text;
  costText: Phaser.GameObjects.Text;
  buyButton: Phaser.GameObjects.Rectangle;
  cardBg: Phaser.GameObjects.Rectangle;
  upgrade: PermanentUpgrade;
  lockOverlay?: Phaser.GameObjects.Rectangle;
  lockText?: Phaser.GameObjects.Text;
  refundButton?: Phaser.GameObjects.Rectangle;
  refundText?: Phaser.GameObjects.Text;
}

export class ShopScene extends Phaser.Scene {
  private goldText!: Phaser.GameObjects.Text;
  private accountLevelText!: Phaser.GameObjects.Text;
  private upgradeCards: UpgradeCardElements[] = [];
  private currentCategory: UpgradeCategory = 'offense';
  private categoryTabs: Map<UpgradeCategory, Phaser.GameObjects.Container> = new Map();
  private upgradeContainer!: Phaser.GameObjects.Container;
  private scrollY: number = 0;
  private maxScrollY: number = 0;
  private isDragging: boolean = false;
  private lastPointerY: number = 0;
  private backButton!: Phaser.GameObjects.Text;

  // Keyboard navigation state
  private focusZone: FocusZone = 'tabs';
  private selectedTabIndex: number = 0;
  private selectedCardIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  // Grid constants
  private readonly columns = 4;
  private readonly cardWidth = 200;
  private readonly cardHeight = 160;

  constructor() {
    super({ key: 'ShopScene' });
  }

  create(): void {
    const centerX = GAME_WIDTH / 2;

    // Reset state
    this.upgradeCards = [];
    this.categoryTabs.clear();
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;
    this.scrollY = 0;

    // Dark background
    this.add.rectangle(centerX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a1a2e);

    // Title
    this.add
      .text(centerX, 30, 'SHOP', {
        fontSize: '36px',
        color: '#ffdd44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Account level display (top left)
    const metaManager = getMetaProgressionManager();
    this.add
      .text(20, 20, 'Account Level:', {
        fontSize: '14px',
        color: '#888888',
        fontFamily: 'Arial',
      });

    this.accountLevelText = this.add
      .text(20, 38, `${metaManager.getAccountLevel()}`, {
        fontSize: '24px',
        color: '#88aaff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });

    // Gold display (top right)
    this.add
      .text(GAME_WIDTH - 20, 20, 'GOLD:', {
        fontSize: '14px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    this.goldText = this.add
      .text(GAME_WIDTH - 20, 38, '', {
        fontSize: '24px',
        color: '#ffcc00',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);
    this.updateGoldDisplay();

    // Create category tabs
    this.createCategoryTabs();

    // Create scrollable upgrade container with mask
    this.createUpgradeContainer();

    // Display upgrades for default category
    this.displayCategoryUpgrades(this.currentCategory);

    // Back button
    this.backButton = this.add
      .text(centerX, GAME_HEIGHT - 30, '[ Back to Menu ]', {
        fontSize: '20px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.backButton.on('pointerover', () => {
      this.focusZone = 'back';
      this.updateFocusVisuals();
    });
    this.backButton.on('pointerout', () => this.updateFocusVisuals());
    this.backButton.on('pointerdown', () => {
      this.scene.start('BootScene');
    });

    // Setup scroll input
    this.setupScrollInput();

    // Setup keyboard navigation
    this.setupKeyboardNavigation();

    // Initial focus visuals
    this.updateFocusVisuals();
  }

  private createCategoryTabs(): void {
    const tabY = 70;
    const tabHeight = 36;
    const tabSpacing = 4;
    const totalTabs = UPGRADE_CATEGORIES.length;
    const tabWidth = Math.floor((GAME_WIDTH - 40 - (totalTabs - 1) * tabSpacing) / totalTabs);
    const startX = 20;

    UPGRADE_CATEGORIES.forEach((category, index) => {
      const tabX = startX + index * (tabWidth + tabSpacing);
      const isSelected = category.id === this.currentCategory;

      const tabContainer = this.add.container(tabX, tabY);

      // Tab background
      const tabBg = this.add.rectangle(
        tabWidth / 2,
        tabHeight / 2,
        tabWidth,
        tabHeight,
        isSelected ? 0x4a4a7a : 0x2a2a4a
      );
      tabBg.setStrokeStyle(2, isSelected ? 0x6a6aaa : 0x3a3a5a);
      tabBg.setInteractive({ useHandCursor: true });

      // Tab icon
      const tabIcon = createIcon(this, {
        x: 14,
        y: tabHeight / 2,
        iconKey: category.icon,
        size: 16,
        tint: isSelected ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED,
      });

      // Tab text
      const tabText = this.add.text(
        tabWidth / 2 + 6,
        tabHeight / 2,
        category.name,
        {
          fontSize: '12px',
          color: isSelected ? '#ffffff' : '#888888',
          fontFamily: 'Arial',
        }
      );
      tabText.setOrigin(0.5);

      tabContainer.add([tabBg, tabIcon, tabText]);

      // Tab click handler
      tabBg.on('pointerdown', () => {
        this.selectedTabIndex = index;
        this.selectCategory(category.id);
      });

      tabBg.on('pointerover', () => {
        this.selectedTabIndex = index;
        this.focusZone = 'tabs';
        this.updateFocusVisuals();
      });

      this.categoryTabs.set(category.id, tabContainer);
    });
  }

  private selectCategory(categoryId: UpgradeCategory): void {
    if (categoryId === this.currentCategory) return;

    // Update tab visuals
    this.categoryTabs.forEach((container, id) => {
      const tabBg = container.getAt(0) as Phaser.GameObjects.Rectangle;
      const tabIcon = container.getAt(1) as Phaser.GameObjects.Image;
      const tabText = container.getAt(2) as Phaser.GameObjects.Text;
      const isSelected = id === categoryId;

      tabBg.setFillStyle(isSelected ? 0x4a4a7a : 0x2a2a4a);
      tabBg.setStrokeStyle(2, isSelected ? 0x6a6aaa : 0x3a3a5a);
      tabIcon.setTint(isSelected ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED);
      tabText.setColor(isSelected ? '#ffffff' : '#888888');
    });

    this.currentCategory = categoryId;
    this.scrollY = 0;
    this.upgradeContainer.y = 0;
    this.selectedCardIndex = 0;
    this.displayCategoryUpgrades(categoryId);
    this.updateFocusVisuals();
  }

  private createUpgradeContainer(): void {
    // Create container for upgrades
    this.upgradeContainer = this.add.container(0, 0);

    // Create mask for scrolling area
    const maskY = 115;
    const maskHeight = GAME_HEIGHT - 170;
    const maskGraphics = this.add.graphics();
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, maskY, GAME_WIDTH, maskHeight);

    const mask = maskGraphics.createGeometryMask();
    this.upgradeContainer.setMask(mask);
    maskGraphics.setVisible(false);
  }

  private displayCategoryUpgrades(category: UpgradeCategory): void {
    // Clear existing cards
    this.upgradeContainer.removeAll(true);
    this.upgradeCards = [];

    const upgrades = getUpgradesByCategory(category);
    const metaManager = getMetaProgressionManager();
    const accountLevel = metaManager.getAccountLevel();

    // Layout constants
    const startY = 125;
    const horizontalSpacing = 20;
    const verticalSpacing = 15;

    // Calculate starting X to center the grid
    const totalRowWidth = this.columns * this.cardWidth + (this.columns - 1) * horizontalSpacing;
    const startX = (GAME_WIDTH - totalRowWidth) / 2 + this.cardWidth / 2;

    upgrades.forEach((upgrade, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const cardX = startX + col * (this.cardWidth + horizontalSpacing);
      const cardY = startY + row * (this.cardHeight + verticalSpacing) + this.cardHeight / 2;

      const isUnlocked = accountLevel >= upgrade.unlockLevel;
      this.createUpgradeCard(cardX, cardY, this.cardWidth, this.cardHeight, upgrade, isUnlocked, index);
    });

    // Calculate max scroll
    const rows = Math.ceil(upgrades.length / this.columns);
    const contentHeight = rows * (this.cardHeight + verticalSpacing);
    const visibleHeight = GAME_HEIGHT - 170;
    this.maxScrollY = Math.max(0, contentHeight - visibleHeight + 20);
  }

  private createUpgradeCard(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    upgrade: PermanentUpgrade,
    isUnlocked: boolean,
    cardIndex: number
  ): void {
    const metaManager = getMetaProgressionManager();
    const currentLevel = metaManager.getUpgradeLevel(upgrade.id);
    const isMaxed = currentLevel >= upgrade.maxLevel;
    const cost = calculateUpgradeCost(upgrade, currentLevel);
    const canAfford = metaManager.getGold() >= cost;

    const cardContainer = this.add.container(positionX, positionY);

    // Card background
    const bgColor = isUnlocked ? 0x2a2a4a : 0x1a1a2a;
    const cardBg = this.add.rectangle(0, 0, width, height, bgColor);
    cardBg.setStrokeStyle(2, isUnlocked ? 0x4a4a7a : 0x2a2a3a);
    cardContainer.add(cardBg);

    // Icon (sprite from atlas)
    const icon = createIcon(this, {
      x: 0,
      y: -50,
      iconKey: upgrade.icon,
      size: 28,
      tint: isUnlocked ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED,
    });
    cardContainer.add(icon);

    // Name
    const nameText = this.add
      .text(0, -22, upgrade.name, {
        fontSize: '16px',
        color: isUnlocked ? '#ffffff' : '#666666',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    cardContainer.add(nameText);

    // Description (truncated if needed)
    const desc = upgrade.description.length > 25
      ? upgrade.description.substring(0, 22) + '...'
      : upgrade.description;
    const descText = this.add
      .text(0, 0, desc, {
        fontSize: '11px',
        color: isUnlocked ? '#888888' : '#444444',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);
    cardContainer.add(descText);

    // Level indicator
    const levelText = this.add
      .text(0, 20, `Level ${currentLevel}/${upgrade.maxLevel}`, {
        fontSize: '12px',
        color: isUnlocked ? '#88aaff' : '#445566',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);
    cardContainer.add(levelText);

    // Effect text
    const effectText = this.add
      .text(0, 38, upgrade.getEffect(currentLevel), {
        fontSize: '11px',
        color: isUnlocked ? '#88ff88' : '#446644',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);
    cardContainer.add(effectText);

    // Buy button (and optional refund button)
    const buttonY = 60;
    const fullButtonWidth = width - 20;
    const buttonHeight = 26;
    const hasRefund = currentLevel > 0;
    const buttonGap = 4;
    // When refund exists: buy button takes most space, refund button is smaller
    const buyButtonWidth = hasRefund ? fullButtonWidth - 55 - buttonGap : fullButtonWidth;
    const refundButtonWidth = 55;

    let buttonColor = 0x444444;
    let buttonStroke = 0x666666;
    let buttonText = 'LOCKED';

    if (isUnlocked) {
      if (isMaxed) {
        buttonColor = 0x444444;
        buttonStroke = 0x666666;
        buttonText = 'MAXED';
      } else if (canAfford) {
        buttonColor = 0x44aa44;
        buttonStroke = 0x66cc66;
        buttonText = `${cost} gold`;
      } else {
        buttonColor = 0x664444;
        buttonStroke = 0x886666;
        buttonText = `${cost} gold`;
      }
    } else {
      buttonText = `Unlock at Lv.${upgrade.unlockLevel}`;
    }

    // Position buy button (centered when no refund, left-aligned when refund exists)
    const buyButtonX = hasRefund ? -(fullButtonWidth - buyButtonWidth) / 2 : 0;
    const buyButton = this.add.rectangle(buyButtonX, buttonY, buyButtonWidth, buttonHeight, buttonColor);
    buyButton.setStrokeStyle(2, buttonStroke);
    cardContainer.add(buyButton);

    const costText = this.add
      .text(buyButtonX, buttonY, buttonText, {
        fontSize: '12px',
        color: '#ffffff',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);
    cardContainer.add(costText);

    // Create refund button if player has levels in this upgrade
    let refundButton: Phaser.GameObjects.Rectangle | undefined;
    let refundText: Phaser.GameObjects.Text | undefined;
    if (hasRefund) {
      const refundButtonX = (fullButtonWidth - refundButtonWidth) / 2;
      const refundAmount = metaManager.getRefundAmount(upgrade.id);
      refundButton = this.add.rectangle(refundButtonX, buttonY, refundButtonWidth, buttonHeight, 0x997722);
      refundButton.setStrokeStyle(2, 0xbbaa44);
      cardContainer.add(refundButton);

      refundText = this.add
        .text(refundButtonX, buttonY, `↩${refundAmount}`, {
          fontSize: '11px',
          color: '#ffffff',
          fontFamily: 'Arial',
        })
        .setOrigin(0.5);
      cardContainer.add(refundText);

      // Make refund button interactive
      refundButton.setInteractive({ useHandCursor: true });

      refundButton.on('pointerover', () => {
        this.selectedCardIndex = cardIndex;
        this.focusZone = 'grid';
        this.updateFocusVisuals();
        refundButton!.setFillStyle(0xbbaa44);
      });

      refundButton.on('pointerout', () => {
        refundButton!.setFillStyle(0x997722);
      });

      refundButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        // Shift+click for full refund, normal click for single level
        this.refundUpgrade(upgrade.id, pointer.event.shiftKey);
      });
    }

    // Store card elements
    const cardElements: UpgradeCardElements = {
      container: cardContainer,
      levelText,
      effectText,
      costText,
      buyButton,
      cardBg,
      upgrade,
      refundButton,
      refundText,
    };
    this.upgradeCards.push(cardElements);

    // Make card interactive
    cardBg.setInteractive({ useHandCursor: true });

    cardBg.on('pointerover', () => {
      this.selectedCardIndex = cardIndex;
      this.focusZone = 'grid';
      this.updateFocusVisuals();
    });

    cardBg.on('pointerdown', () => {
      if (isUnlocked && !isMaxed) {
        this.purchaseUpgrade(upgrade.id);
      }
    });

    // Also make buy button interactive
    if (isUnlocked && !isMaxed) {
      buyButton.setInteractive({ useHandCursor: true });

      buyButton.on('pointerover', () => {
        this.selectedCardIndex = cardIndex;
        this.focusZone = 'grid';
        this.updateFocusVisuals();
        const currentCost = metaManager.getUpgradeCost(upgrade.id);
        if (metaManager.getGold() >= currentCost) {
          buyButton.setFillStyle(0x55bb55);
        }
      });

      buyButton.on('pointerout', () => {
        this.updateCardAppearance(cardIndex);
      });

      buyButton.on('pointerdown', () => {
        this.purchaseUpgrade(upgrade.id);
      });
    }

    // Add to scrollable container
    this.upgradeContainer.add(cardContainer);
  }

  private setupScrollInput(): void {
    // Mouse wheel scrolling
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY * 0.5, 0, this.maxScrollY);
      this.upgradeContainer.y = -this.scrollY;
    });

    // Touch/drag scrolling
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > 110 && pointer.y < GAME_HEIGHT - 60) {
        this.isDragging = true;
        this.lastPointerY = pointer.y;
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        const deltaY = this.lastPointerY - pointer.y;
        this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY, 0, this.maxScrollY);
        this.upgradeContainer.y = -this.scrollY;
        this.lastPointerY = pointer.y;
      }
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
    });
  }

  /**
   * Sets up keyboard navigation handlers.
   */
  private setupKeyboardNavigation(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
        case 's':
        case 'S':
          event.preventDefault();
          this.navigateDown();
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
          event.preventDefault();
          this.navigateUp();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          event.preventDefault();
          this.navigateLeft();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          event.preventDefault();
          this.navigateRight();
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          this.activateCurrentSelection();
          break;
        case 'Escape':
          event.preventDefault();
          this.scene.start('BootScene');
          break;
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);
  }

  /**
   * Navigate down through zones or within grid.
   */
  private navigateDown(): void {
    if (this.focusZone === 'tabs') {
      // Move to grid
      this.focusZone = 'grid';
      this.selectedCardIndex = 0;
    } else if (this.focusZone === 'grid') {
      const totalCards = this.upgradeCards.length;
      const currentRow = Math.floor(this.selectedCardIndex / this.columns);
      const totalRows = Math.ceil(totalCards / this.columns);

      if (currentRow < totalRows - 1) {
        // Move down within grid
        const newIndex = this.selectedCardIndex + this.columns;
        if (newIndex < totalCards) {
          this.selectedCardIndex = newIndex;
          this.ensureCardVisible();
        }
      } else {
        // Move to back button
        this.focusZone = 'back';
      }
    } else if (this.focusZone === 'back') {
      // Wrap to tabs
      this.focusZone = 'tabs';
    }
    this.updateFocusVisuals();
  }

  /**
   * Navigate up through zones or within grid.
   */
  private navigateUp(): void {
    if (this.focusZone === 'tabs') {
      // Wrap to back button
      this.focusZone = 'back';
    } else if (this.focusZone === 'grid') {
      const currentRow = Math.floor(this.selectedCardIndex / this.columns);

      if (currentRow > 0) {
        // Move up within grid
        this.selectedCardIndex -= this.columns;
        this.ensureCardVisible();
      } else {
        // Move to tabs
        this.focusZone = 'tabs';
      }
    } else if (this.focusZone === 'back') {
      // Move to grid (last row)
      this.focusZone = 'grid';
      const totalCards = this.upgradeCards.length;
      const totalRows = Math.ceil(totalCards / this.columns);
      const lastRowStart = (totalRows - 1) * this.columns;
      this.selectedCardIndex = Math.min(lastRowStart, totalCards - 1);
      this.ensureCardVisible();
    }
    this.updateFocusVisuals();
  }

  /**
   * Navigate left within the current zone.
   */
  private navigateLeft(): void {
    if (this.focusZone === 'tabs') {
      this.selectedTabIndex = Math.max(0, this.selectedTabIndex - 1);
      this.selectCategoryByIndex(this.selectedTabIndex);
    } else if (this.focusZone === 'grid') {
      const currentCol = this.selectedCardIndex % this.columns;
      if (currentCol > 0) {
        this.selectedCardIndex--;
      } else {
        // Wrap to end of row
        const currentRow = Math.floor(this.selectedCardIndex / this.columns);
        const rowEnd = Math.min((currentRow + 1) * this.columns - 1, this.upgradeCards.length - 1);
        this.selectedCardIndex = rowEnd;
      }
    }
    this.updateFocusVisuals();
  }

  /**
   * Navigate right within the current zone.
   */
  private navigateRight(): void {
    if (this.focusZone === 'tabs') {
      this.selectedTabIndex = Math.min(UPGRADE_CATEGORIES.length - 1, this.selectedTabIndex + 1);
      this.selectCategoryByIndex(this.selectedTabIndex);
    } else if (this.focusZone === 'grid') {
      const currentCol = this.selectedCardIndex % this.columns;
      const currentRow = Math.floor(this.selectedCardIndex / this.columns);
      const rowStart = currentRow * this.columns;

      if (currentCol < this.columns - 1 && this.selectedCardIndex < this.upgradeCards.length - 1) {
        this.selectedCardIndex++;
      } else {
        // Wrap to start of row
        this.selectedCardIndex = rowStart;
      }
    }
    this.updateFocusVisuals();
  }

  /**
   * Selects a category by tab index.
   */
  private selectCategoryByIndex(index: number): void {
    const category = UPGRADE_CATEGORIES[index];
    if (category) {
      this.selectCategory(category.id);
    }
  }

  /**
   * Activate the currently selected item.
   */
  private activateCurrentSelection(): void {
    if (this.focusZone === 'tabs') {
      // Already handled by selectCategoryByIndex in navigation
    } else if (this.focusZone === 'grid') {
      const card = this.upgradeCards[this.selectedCardIndex];
      if (card) {
        const metaManager = getMetaProgressionManager();
        const currentLevel = metaManager.getUpgradeLevel(card.upgrade.id);
        const isMaxed = currentLevel >= card.upgrade.maxLevel;
        const isUnlocked = metaManager.getAccountLevel() >= card.upgrade.unlockLevel;

        if (isUnlocked && !isMaxed) {
          this.purchaseUpgrade(card.upgrade.id);
        }
      }
    } else if (this.focusZone === 'back') {
      this.scene.start('BootScene');
    }
  }

  /**
   * Ensures the selected card is visible in the scroll area.
   */
  private ensureCardVisible(): void {
    const row = Math.floor(this.selectedCardIndex / this.columns);
    const cardY = 125 + row * (this.cardHeight + 15) + this.cardHeight / 2;
    const visibleTop = this.scrollY + 115;
    const visibleBottom = this.scrollY + GAME_HEIGHT - 55;

    if (cardY - this.cardHeight / 2 < visibleTop) {
      this.scrollY = Math.max(0, cardY - this.cardHeight / 2 - 115);
    } else if (cardY + this.cardHeight / 2 > visibleBottom) {
      this.scrollY = Math.min(this.maxScrollY, cardY + this.cardHeight / 2 - (GAME_HEIGHT - 55));
    }

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScrollY);
    this.upgradeContainer.y = -this.scrollY;
  }

  /**
   * Updates visual feedback for the current focus state.
   */
  private updateFocusVisuals(): void {
    // Update tab visuals
    UPGRADE_CATEGORIES.forEach((category, index) => {
      const tabContainer = this.categoryTabs.get(category.id);
      if (!tabContainer) return;

      const tabBg = tabContainer.getAt(0) as Phaser.GameObjects.Rectangle;
      const tabIcon = tabContainer.getAt(1) as Phaser.GameObjects.Image;
      const tabText = tabContainer.getAt(2) as Phaser.GameObjects.Text;

      const isSelected = category.id === this.currentCategory;
      const isFocused = this.focusZone === 'tabs' && this.selectedTabIndex === index;

      if (isFocused) {
        tabBg.setFillStyle(0x5a5a9a);
        tabBg.setStrokeStyle(3, 0xffdd44);
      } else if (isSelected) {
        tabBg.setFillStyle(0x4a4a7a);
        tabBg.setStrokeStyle(2, 0x6a6aaa);
      } else {
        tabBg.setFillStyle(0x2a2a4a);
        tabBg.setStrokeStyle(2, 0x3a3a5a);
      }

      tabIcon.setTint(isSelected || isFocused ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED);
      tabText.setColor(isSelected || isFocused ? '#ffffff' : '#888888');
    });

    // Update card visuals
    this.upgradeCards.forEach((card, index) => {
      const isFocused = this.focusZone === 'grid' && this.selectedCardIndex === index;
      const metaManager = getMetaProgressionManager();
      const isUnlocked = metaManager.getAccountLevel() >= card.upgrade.unlockLevel;

      if (isFocused) {
        card.cardBg.setStrokeStyle(3, 0xffdd44);
      } else {
        card.cardBg.setStrokeStyle(2, isUnlocked ? 0x4a4a7a : 0x2a2a3a);
      }
    });

    // Update back button
    this.backButton.setColor(this.focusZone === 'back' ? '#ffdd44' : '#888888');
  }

  private purchaseUpgrade(upgradeId: string): void {
    const metaManager = getMetaProgressionManager();
    const success = metaManager.purchaseUpgrade(upgradeId);

    if (success) {
      this.updateGoldDisplay();
      this.updateAccountLevelDisplay();
      this.updateAllCards();
      // Refresh category to show newly unlocked upgrades
      this.displayCategoryUpgrades(this.currentCategory);
      this.updateFocusVisuals();
    }
  }

  private refundUpgrade(upgradeId: string, fullRefund: boolean): void {
    const metaManager = getMetaProgressionManager();
    const refunded = fullRefund
      ? metaManager.refundUpgradeFully(upgradeId)
      : metaManager.refundUpgradeLevel(upgradeId);

    if (refunded > 0) {
      this.updateGoldDisplay();
      this.updateAccountLevelDisplay();
      this.updateAllCards();
      // Refresh category to show newly unlocked upgrades (or re-lock if account level dropped)
      this.displayCategoryUpgrades(this.currentCategory);
      this.updateFocusVisuals();
    }
  }

  private updateGoldDisplay(): void {
    const metaManager = getMetaProgressionManager();
    this.goldText.setText(String(metaManager.getGold()));
  }

  private updateAccountLevelDisplay(): void {
    const metaManager = getMetaProgressionManager();
    this.accountLevelText.setText(`${metaManager.getAccountLevel()}`);
  }

  private updateCardAppearance(cardIndex: number): void {
    const card = this.upgradeCards[cardIndex];
    if (!card) return;

    const metaManager = getMetaProgressionManager();
    const currentLevel = metaManager.getUpgradeLevel(card.upgrade.id);
    const isMaxed = currentLevel >= card.upgrade.maxLevel;
    const cost = calculateUpgradeCost(card.upgrade, currentLevel);
    const canAfford = metaManager.getGold() >= cost;
    const isUnlocked = metaManager.getAccountLevel() >= card.upgrade.unlockLevel;

    let buttonColor = 0x444444;
    let buttonStroke = 0x666666;

    if (isUnlocked) {
      if (isMaxed) {
        buttonColor = 0x444444;
        buttonStroke = 0x666666;
      } else if (canAfford) {
        buttonColor = 0x44aa44;
        buttonStroke = 0x66cc66;
      } else {
        buttonColor = 0x664444;
        buttonStroke = 0x886666;
      }
    }

    card.buyButton.setFillStyle(buttonColor);
    card.buyButton.setStrokeStyle(2, buttonStroke);
  }

  private updateAllCards(): void {
    const metaManager = getMetaProgressionManager();

    this.upgradeCards.forEach((card, index) => {
      const currentLevel = metaManager.getUpgradeLevel(card.upgrade.id);
      const isMaxed = currentLevel >= card.upgrade.maxLevel;
      const cost = calculateUpgradeCost(card.upgrade, currentLevel);
      const isUnlocked = metaManager.getAccountLevel() >= card.upgrade.unlockLevel;

      // Update text
      card.levelText.setText(`Level ${currentLevel}/${card.upgrade.maxLevel}`);
      card.effectText.setText(card.upgrade.getEffect(currentLevel));

      let buttonText = 'LOCKED';
      if (isUnlocked) {
        buttonText = isMaxed ? 'MAXED' : `${cost} gold`;
      } else {
        buttonText = `Unlock at Lv.${card.upgrade.unlockLevel}`;
      }
      card.costText.setText(buttonText);

      // Update button appearance
      this.updateCardAppearance(index);

      // Disable interaction if maxed
      if (isMaxed) {
        card.buyButton.removeAllListeners();
        card.buyButton.disableInteractive();
      }
    });
  }

  /**
   * Cleanup keyboard handlers when scene shuts down.
   */
  shutdown(): void {
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
}
