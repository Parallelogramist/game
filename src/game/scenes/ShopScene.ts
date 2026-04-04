/**
 * ShopScene - UI for purchasing permanent upgrades with gold.
 * Features category tabs, scrolling, and progressive unlocking.
 * Full keyboard navigation support with zone-based focus system.
 */

import Phaser from 'phaser';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import {
  PermanentUpgrade,
  calculateUpgradeCost,
  getUpgradesByCategory,
  UPGRADE_CATEGORIES,
  UpgradeCategory,
} from '../../data/PermanentUpgrades';
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';
import { fadeIn, fadeOut, addButtonInteraction } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { getToastManager, ToastManager } from '../../ui';
import { getSettingsManager } from '../../settings';
import { TooltipManager } from '../../ui/TooltipManager';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';

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
  private menuNavigator: MenuNavigator | null = null;

  // Tooltip system
  private tooltipManager!: TooltipManager;

  // Audio
  private soundManager!: SoundManager;
  private toastManager!: ToastManager;
  private goldTween: Phaser.Tweens.Tween | null = null;

  // Grid constants
  private readonly columns = 4;
  private readonly cardWidth = 200;
  private readonly cardHeight = 190;

  constructor() {
    super({ key: 'ShopScene' });
  }

  create(): void {
    const centerX = this.scale.width / 2;

    // Fade in
    fadeIn(this, 200);

    // Sound manager for UI sounds
    this.soundManager = new SoundManager(this);
    this.toastManager = getToastManager(this);

    // Reset state
    this.upgradeCards = [];
    this.categoryTabs.clear();
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;
    this.scrollY = 0;

    // Dark background
    this.add.rectangle(centerX, this.scale.height / 2, this.scale.width, this.scale.height, 0x1a1a2e);

    // Title
    this.add
      .text(centerX, 30, 'SHOP', {
        fontSize: '36px',
        color: '#ffdd44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Initialize tooltip system
    this.tooltipManager = new TooltipManager(this);

    // Account level display (top left)
    const metaManager = getMetaProgressionManager();
    const accountLevelLabel = this.add
      .text(20, 20, 'Account Level:', {
        fontSize: '14px',
        color: '#888888',
        fontFamily: 'Arial',
      });

    this.tooltipManager.attach(accountLevelLabel,
      'Your Account Level is the sum of all shop upgrade levels. Higher account levels unlock more powerful upgrades.');

    this.accountLevelText = this.add
      .text(20, 38, `${metaManager.getAccountLevel()}`, {
        fontSize: '24px',
        color: '#88aaff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });

    // Gold display (top right)
    const goldLabel = this.add
      .text(this.scale.width - 20, 20, 'GOLD:', {
        fontSize: '14px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    this.tooltipManager.attach(goldLabel,
      'Gold is earned after each run based on kills, time survived, and level. Spend it here on permanent upgrades.');

    this.goldText = this.add
      .text(this.scale.width - 20, 38, '', {
        fontSize: '24px',
        color: '#ffcc00',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);
    this.updateGoldDisplay();

    // Ascension display / button
    const ascensionManager = getAscensionManager();
    const ascensionLevel = ascensionManager.getLevel();
    const canAscend = ascensionManager.canAscend(metaManager.getAccountLevel());

    if (ascensionLevel > 0) {
      const statBonus = Math.round((ascensionManager.getStatMultiplier() - 1) * 100);
      const goldBonus = Math.round((ascensionManager.getGoldMultiplier() - 1) * 100);
      const ascLabel = this.add.text(110, 44, `Asc. ${ascensionLevel} (+${statBonus}% stats, +${goldBonus}% gold)`, {
        fontSize: '11px',
        color: '#cc88cc',
        fontFamily: 'Arial',
      });
      this.tooltipManager.attach(ascLabel,
        'Ascension is a prestige system. Each ascension resets your shop upgrades (refunding all gold) but grants permanent stat and gold bonuses.');
    }

    if (canAscend) {
      const ascendButton = this.add.text(centerX + 140, 30, '[ ASCEND ]', {
        fontSize: '14px',
        color: '#ff44ff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        stroke: '#440044',
        strokeThickness: 2,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      const nextLevel = ascensionLevel + 1;
      const nextStatBonus = nextLevel * 10;
      const nextGoldBonus = nextLevel * 15;

      ascendButton.on('pointerover', () => ascendButton.setColor('#ff88ff'));
      ascendButton.on('pointerout', () => ascendButton.setColor('#ff44ff'));
      ascendButton.on('pointerdown', () => {
        this.soundManager.playUIClick();
        this.showAscensionConfirmation(nextLevel, nextStatBonus, nextGoldBonus);
      });
      addButtonInteraction(this, ascendButton);
    }

    // Create category tabs
    this.createCategoryTabs();

    // Create scrollable upgrade container with mask
    this.createUpgradeContainer();

    // Display upgrades for default category
    this.displayCategoryUpgrades(this.currentCategory);

    // Back button
    this.backButton = this.add
      .text(centerX, this.scale.height - 30, '[ Back to Menu ]', {
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
      this.soundManager.playUIClick();
      fadeOut(this, 150, () => this.scene.start('BootScene'));
    });
    addButtonInteraction(this, this.backButton);

    // Setup scroll input
    this.setupScrollInput();

    // Setup keyboard + gamepad navigation via MenuNavigator
    // (replaces the old setupKeyboardNavigation for full keyboard + gamepad support)
    this.buildMenuNavigator();

    // Initial focus visuals
    this.updateFocusVisuals();

    // Tutorial toast on first shop visit
    if (!getSettingsManager().isTutorialSeen()) {
      this.time.delayedCall(800, () => {
        this.toastManager.showToast({
          title: 'Shop',
          description: 'Spend gold on permanent upgrades',
          icon: 'coins',
          color: 0x44aaff,
          duration: 3000,
        });
      });
      getSettingsManager().setTutorialSeen(true);
    }

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);
  }

  private createCategoryTabs(): void {
    const tabY = 70;
    const tabHeight = 36;
    const tabSpacing = 4;
    const totalTabs = UPGRADE_CATEGORIES.length;
    const tabWidth = Math.floor((this.scale.width - 40 - (totalTabs - 1) * tabSpacing) / totalTabs);
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
        (tabWidth + 28) / 2,
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
        this.soundManager.playUIClick();
        this.selectedTabIndex = index;
        this.selectCategory(category.id);
      });

      tabBg.on('pointerover', () => {
        this.selectedTabIndex = index;
        this.focusZone = 'tabs';
        this.updateFocusVisuals();
      });

      addButtonInteraction(this, tabBg);
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
    this.buildMenuNavigator();
    this.updateFocusVisuals();
  }

  private createUpgradeContainer(): void {
    // Create container for upgrades
    this.upgradeContainer = this.add.container(0, 0);

    // Create mask for scrolling area
    const maskY = 115;
    const maskHeight = this.scale.height - 170;
    const maskGraphics = this.add.graphics();
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, maskY, this.scale.width, maskHeight);

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
    const startX = (this.scale.width - totalRowWidth) / 2 + this.cardWidth / 2;

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
    const visibleHeight = this.scale.height - 170;
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
      y: -70,
      iconKey: upgrade.icon,
      size: 28,
      tint: isUnlocked ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED,
    });
    cardContainer.add(icon);

    // Name
    const nameText = this.add
      .text(0, -42, upgrade.name, {
        fontSize: '16px',
        color: isUnlocked ? '#ffffff' : '#666666',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    cardContainer.add(nameText);

    // Description with word wrap
    const descText = this.add
      .text(0, -20, upgrade.description, {
        fontSize: '11px',
        color: isUnlocked ? '#888888' : '#444444',
        fontFamily: 'Arial',
        wordWrap: { width: width - 20 },
        align: 'center',
      })
      .setOrigin(0.5);
    cardContainer.add(descText);

    // Level indicator
    const levelText = this.add
      .text(0, 12, `Level ${currentLevel}/${upgrade.maxLevel}`, {
        fontSize: '12px',
        color: isUnlocked ? '#88aaff' : '#445566',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);
    cardContainer.add(levelText);

    // Effect text
    const effectText = this.add
      .text(0, 30, upgrade.getEffect(currentLevel), {
        fontSize: '11px',
        color: isUnlocked ? '#88ff88' : '#446644',
        fontFamily: 'Arial',
        wordWrap: { width: width - 20 },
        align: 'center',
      })
      .setOrigin(0.5);
    cardContainer.add(effectText);

    // Buy button (and optional refund button)
    const buttonY = 68;
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
      addButtonInteraction(this, refundButton);
    }

    // Add lock overlay for locked cards with unlock requirement
    let lockOverlay: Phaser.GameObjects.Rectangle | undefined;
    let lockText: Phaser.GameObjects.Text | undefined;
    if (!isUnlocked) {
      lockOverlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.4);
      cardContainer.add(lockOverlay);

      const accountLevel = metaManager.getAccountLevel();
      lockText = this.add.text(0, 0, `Requires\nAccount Lv. ${upgrade.unlockLevel}\n(${accountLevel}/${upgrade.unlockLevel})`, {
        fontSize: '13px',
        fontFamily: 'Arial',
        color: '#ff8844',
        align: 'center',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5);
      cardContainer.add(lockText);
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
      lockOverlay,
      lockText,
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
      addButtonInteraction(this, buyButton);
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
      if (pointer.y > 110 && pointer.y < this.scale.height - 60) {
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
   * Builds a MenuNavigator that mirrors the existing zone-based focus system
   * to provide gamepad D-pad/stick/A/B button support.
   * The navigator items map to: [tabs...] + [grid cards...] + [back button].
   * Zone transitions (tabs -> grid -> back) are handled by re-building items
   * when the focus zone changes.
   */
  private buildMenuNavigator(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
    }

    const navigableItems: NavigableItem[] = [];

    // Add tab items
    UPGRADE_CATEGORIES.forEach((_category, tabIndex) => {
      navigableItems.push({
        onFocus: () => {
          this.focusZone = 'tabs';
          this.selectedTabIndex = tabIndex;
          this.selectCategoryByIndex(tabIndex);
          this.updateFocusVisuals();
        },
        onBlur: () => {
          this.updateFocusVisuals();
        },
        onActivate: () => {
          this.selectCategoryByIndex(tabIndex);
        },
      });
    });

    // Add grid card items
    this.upgradeCards.forEach((_card, cardIndex) => {
      navigableItems.push({
        onFocus: () => {
          this.focusZone = 'grid';
          this.selectedCardIndex = cardIndex;
          this.ensureCardVisible();
          this.updateFocusVisuals();
        },
        onBlur: () => {
          this.updateFocusVisuals();
        },
        onActivate: () => {
          this.focusZone = 'grid';
          this.selectedCardIndex = cardIndex;
          this.activateCurrentSelection();
        },
      });
    });

    // Add back button
    navigableItems.push({
      onFocus: () => {
        this.focusZone = 'back';
        this.updateFocusVisuals();
      },
      onBlur: () => {
        this.updateFocusVisuals();
      },
      onActivate: () => {
        this.soundManager.playUIClick();
        fadeOut(this, 150, () => this.scene.start('BootScene'));
      },
    });

    // The layout is: tabs (1 row) + grid (N rows of `columns` cols) + back (1 row).
    // Use the grid column count so left/right navigation works within the grid.
    // Tabs are a single row at the top, back is a single item at the bottom.
    // We use the shop's column count to set up grid navigation.
    const totalTabCount = UPGRADE_CATEGORIES.length;
    const navigatorColumns = Math.max(totalTabCount, this.columns);

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: navigatorColumns,
      wrap: true,
      onCancel: () => {
        fadeOut(this, 150, () => this.scene.start('BootScene'));
      },
      initialIndex: this.focusZone === 'tabs'
        ? this.selectedTabIndex
        : this.focusZone === 'grid'
          ? totalTabCount + this.selectedCardIndex
          : navigableItems.length - 1,
    });
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
    const visibleBottom = this.scrollY + this.scale.height - 55;

    if (cardY - this.cardHeight / 2 < visibleTop) {
      this.scrollY = Math.max(0, cardY - this.cardHeight / 2 - 115);
    } else if (cardY + this.cardHeight / 2 > visibleBottom) {
      this.scrollY = Math.min(this.maxScrollY, cardY + this.cardHeight / 2 - (this.scale.height - 55));
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
      this.soundManager.playPurchase();
      this.updateGoldDisplay();
      this.updateAccountLevelDisplay();
      this.updateAllCards();
      // Refresh category to show newly unlocked upgrades
      this.displayCategoryUpgrades(this.currentCategory);
      this.buildMenuNavigator();
      this.updateFocusVisuals();

      // Purchase pop animation on the selected card
      const card = this.upgradeCards[this.selectedCardIndex];
      if (card) {
        card.cardBg.setFillStyle(0xffffff);
        this.tweens.add({
          targets: card.container,
          scaleX: 1.05,
          scaleY: 1.05,
          duration: 100,
          yoyo: true,
          ease: 'Sine.easeOut',
          onComplete: () => {
            this.updateCardAppearance(this.selectedCardIndex);
          },
        });
      }
    } else {
      // Insufficient gold feedback
      this.soundManager.playError();
      const card = this.upgradeCards[this.selectedCardIndex];
      if (card) {
        card.cardBg.setFillStyle(0x662222);
        this.time.delayedCall(120, () => {
          this.updateCardAppearance(this.selectedCardIndex);
        });
      }

      // Show deficit toast
      const cost = metaManager.getUpgradeCost(upgradeId);
      const deficit = cost - metaManager.getGold();
      if (deficit > 0) {
        this.toastManager.showToast({
          title: 'Not Enough Gold',
          description: `Need ${deficit} more gold`,
          icon: 'coins',
          color: 0xff6644,
          duration: 2000,
        });
      }
    }
  }

  private refundUpgrade(upgradeId: string, fullRefund: boolean): void {
    const metaManager = getMetaProgressionManager();
    const refunded = fullRefund
      ? metaManager.refundUpgradeFully(upgradeId)
      : metaManager.refundUpgradeLevel(upgradeId);

    if (refunded > 0) {
      this.soundManager.playUIClick();
      this.updateGoldDisplay();
      this.updateAccountLevelDisplay();
      this.updateAllCards();
      // Refresh category to show newly unlocked upgrades (or re-lock if account level dropped)
      this.displayCategoryUpgrades(this.currentCategory);
      this.buildMenuNavigator();
      this.updateFocusVisuals();
    }
  }

  private updateGoldDisplay(): void {
    const metaManager = getMetaProgressionManager();
    const newGold = metaManager.getGold();
    const currentDisplayed = parseInt(this.goldText.text) || 0;

    if (currentDisplayed === newGold) return;

    // Kill previous tween to prevent stacking
    if (this.goldTween) {
      this.goldTween.remove();
      this.goldTween = null;
    }

    this.goldTween = this.tweens.addCounter({
      from: currentDisplayed,
      to: newGold,
      duration: 400,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        this.goldText.setText(String(Math.floor(tween.getValue() ?? 0)));
      },
      onComplete: () => {
        this.goldText.setText(String(newGold));
        this.goldTween = null;
      },
    });
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

    // Subtle red tint on unaffordable cards
    if (isUnlocked && !isMaxed && !canAfford) {
      card.cardBg.setFillStyle(0x2a1a1a);
    } else if (isUnlocked) {
      card.cardBg.setFillStyle(0x2a2a4a); // Normal unlocked bg
    } else {
      card.cardBg.setFillStyle(0x1a1a2a); // Locked bg
    }
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
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    this.tooltipManager.destroy();
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.tweens.killAll();
  }

  /**
   * Show a confirmation dialog for ascension.
   */
  private showAscensionConfirmation(nextLevel: number, statBonus: number, goldBonus: number): void {
    const overlay = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0.9
    ).setDepth(100).setInteractive();

    const titleText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 120, `ASCEND TO LEVEL ${nextLevel}`, {
      fontSize: '32px',
      color: '#ff88ff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(101);

    const descLines = [
      'All shop upgrades will be reset to 0.',
      'All spent gold will be refunded.',
      '',
      `You will gain permanently:`,
      `  +${statBonus}% to all stats`,
      `  +${goldBonus}% gold earned`,
    ];
    if (nextLevel >= 2) descLines.push('  +1 weapon slot');
    if (nextLevel >= 3) descLines.push('  +1 starting level');
    if (nextLevel >= 4) descLines.push('  2x XP gem value');

    const descText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 30, descLines.join('\n'), {
      fontSize: '16px',
      color: '#ccaacc',
      fontFamily: 'Arial',
      align: 'center',
      lineSpacing: 4,
    }).setOrigin(0.5).setDepth(101);

    const confirmButton = this.add.text(this.scale.width / 2 - 80, this.scale.height / 2 + 100, '[ ASCEND ]', {
      fontSize: '24px',
      color: '#ff44ff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(101).setInteractive({ useHandCursor: true });

    const cancelButton = this.add.text(this.scale.width / 2 + 80, this.scale.height / 2 + 100, '[ Cancel ]', {
      fontSize: '24px',
      color: '#888888',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(101).setInteractive({ useHandCursor: true });

    const cleanup = () => {
      overlay.destroy();
      titleText.destroy();
      descText.destroy();
      confirmButton.destroy();
      cancelButton.destroy();
    };

    confirmButton.on('pointerover', () => confirmButton.setColor('#ff88ff'));
    confirmButton.on('pointerout', () => confirmButton.setColor('#ff44ff'));
    confirmButton.on('pointerdown', () => {
      this.soundManager.playUIClick();
      cleanup();
      this.performAscension();
    });
    addButtonInteraction(this, confirmButton);

    cancelButton.on('pointerover', () => cancelButton.setColor('#ffffff'));
    cancelButton.on('pointerout', () => cancelButton.setColor('#888888'));
    cancelButton.on('pointerdown', () => {
      this.soundManager.playUIClick();
      cleanup();
    });
    addButtonInteraction(this, cancelButton);
  }

  /**
   * Execute the ascension: refund gold, reset upgrades, increment ascension level.
   */
  private performAscension(): void {
    const metaManager = getMetaProgressionManager();
    const ascensionManager = getAscensionManager();

    const accountLevel = metaManager.getAccountLevel();
    if (!ascensionManager.performAscension(accountLevel)) return;

    // Refund all upgrade gold and reset levels
    metaManager.resetAllUpgradesAndRefund();

    // Restart shop scene to reflect changes
    this.scene.restart();
  }
}
