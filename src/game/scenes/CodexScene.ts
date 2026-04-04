/**
 * CodexScene - UI for viewing discovered weapons, enemies, and upgrades.
 * Features category tabs, collection tracking, and full keyboard navigation.
 */

import Phaser from 'phaser';
import {
  getCodexManager,
  CodexCategory,
  CODEX_CATEGORIES,
  WeaponCodexEntry,
  EnemyCodexEntry,
} from '../../codex';
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';
import { getWeaponInfoList, WeaponInfo } from '../../weapons';
import { ENEMY_TYPES, EnemyTypeDefinition } from '../../enemies/EnemyTypes';
import { fadeIn, fadeOut, addButtonInteraction } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';

type FocusZone = 'tabs' | 'grid' | 'back';

interface CodexCardElements {
  container: Phaser.GameObjects.Container;
  cardBg: Phaser.GameObjects.Rectangle;
}

export class CodexScene extends Phaser.Scene {
  private currentCategory: CodexCategory = 'weapons';
  private categoryTabs: Map<CodexCategory, Phaser.GameObjects.Container> = new Map();
  private contentContainer!: Phaser.GameObjects.Container;
  private scrollY: number = 0;
  private maxScrollY: number = 0;
  private backButton!: Phaser.GameObjects.Text;
  private codexCards: CodexCardElements[] = [];

  // Grid constants
  private readonly cardWidth = 340;
  private readonly cardHeight = 95;
  private readonly cardSpacing = 14;
  private readonly columns = 2;

  // Keyboard navigation state
  private focusZone: FocusZone = 'tabs';
  private selectedTabIndex: number = 0;
  private selectedCardIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private soundManager!: SoundManager;

  constructor() {
    super({ key: 'CodexScene' });
  }

  create(): void {
    const centerX = this.scale.width / 2;

    fadeIn(this, 200);
    this.soundManager = new SoundManager(this);

    // Reset state
    this.categoryTabs.clear();
    this.codexCards = [];
    this.scrollY = 0;
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;

    // Dark background
    this.add.rectangle(centerX, this.scale.height / 2, this.scale.width, this.scale.height, 0x1a1a2e);

    // Title
    this.add
      .text(centerX, 30, 'CODEX', {
        fontSize: '36px',
        color: '#88aaff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Completion percentage display (top right)
    const codexManager = getCodexManager();
    const completionPercent = codexManager.getCompletionPercent();
    const weaponCount = codexManager.getDiscoveredWeaponCount();
    const totalWeapons = codexManager.getTotalWeaponCount();
    const enemyCount = codexManager.getDiscoveredEnemyCount();
    const totalEnemies = codexManager.getTotalEnemyCount();

    this.add
      .text(this.scale.width - 20, 15, `CODEX ${completionPercent}% COMPLETE`, {
        fontSize: '12px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    this.add
      .text(this.scale.width - 20, 30, `${weaponCount}/${totalWeapons} Weapons`, {
        fontSize: '14px',
        color: '#88aaff',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    this.add
      .text(this.scale.width - 20, 48, `${enemyCount}/${totalEnemies} Enemies`, {
        fontSize: '14px',
        color: '#ff8888',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    // Create category tabs
    this.createCategoryTabs();

    // Create scrollable content container with mask
    this.createContentContainer();

    // Display content for default category
    this.displayCategoryContent(this.currentCategory);

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

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);
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

  private createCategoryTabs(): void {
    const tabY = 70;
    const tabHeight = 36;
    const tabSpacing = 8;
    const totalTabs = CODEX_CATEGORIES.length;
    const tabWidth = Math.floor((this.scale.width - 40 - (totalTabs - 1) * tabSpacing) / totalTabs);
    const startX = 20;

    const codexManager = getCodexManager();

    CODEX_CATEGORIES.forEach((category, index) => {
      const tabX = startX + index * (tabWidth + tabSpacing);
      const isSelected = category.id === this.currentCategory;

      const tabContainer = this.add.container(tabX, tabY);

      // Tab background
      const tabBg = this.add.rectangle(
        tabWidth / 2,
        tabHeight / 2,
        tabWidth,
        tabHeight,
        isSelected ? 0x3a4a6a : 0x2a2a4a
      );
      tabBg.setStrokeStyle(2, isSelected ? 0x88aaff : 0x3a3a5a);
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
      const tabText = this.add.text((tabWidth + 28) / 2, tabHeight / 2, category.name, {
        fontSize: '14px',
        color: isSelected ? '#ffffff' : '#888888',
        fontFamily: 'Arial',
      });
      tabText.setOrigin(0.5);

      // Count text (discovered/total)
      let countLabel = '';
      if (category.id === 'weapons') {
        countLabel = `${codexManager.getDiscoveredWeaponCount()}/${codexManager.getTotalWeaponCount()}`;
      } else if (category.id === 'enemies') {
        countLabel = `${codexManager.getDiscoveredEnemyCount()}/${codexManager.getTotalEnemyCount()}`;
      } else if (category.id === 'upgrades') {
        const upgradeEntries = codexManager.getAllUpgradeEntries();
        countLabel = `${upgradeEntries.length}`;
      }

      if (countLabel) {
        const countText = this.add.text(tabWidth - 8, tabHeight / 2, countLabel, {
          fontSize: '11px',
          color: isSelected ? '#88aaff' : '#666666',
          fontFamily: 'Arial',
        });
        countText.setOrigin(1, 0.5);
        tabContainer.add([tabBg, tabIcon, tabText, countText]);
      } else {
        tabContainer.add([tabBg, tabIcon, tabText]);
      }

      this.categoryTabs.set(category.id, tabContainer);

      // Click handler
      tabBg.on('pointerdown', () => {
        if (category.id !== this.currentCategory) {
          this.soundManager.playUIClick();
          this.selectedTabIndex = index;
          this.selectCategory(category.id);
        }
      });

      tabBg.on('pointerover', () => {
        this.selectedTabIndex = index;
        this.focusZone = 'tabs';
        this.updateFocusVisuals();
      });
    });
  }

  private selectCategory(categoryId: CodexCategory): void {
    if (categoryId === this.currentCategory) return;
    this.currentCategory = categoryId;
    this.selectedCardIndex = 0;
    this.scrollY = 0;
    this.updateTabVisuals();
    this.displayCategoryContent(categoryId);
    this.buildMenuNavigator();
    this.updateFocusVisuals();
  }

  private updateTabVisuals(): void {
    CODEX_CATEGORIES.forEach((category, index) => {
      const container = this.categoryTabs.get(category.id);
      if (!container) return;

      const isSelected = category.id === this.currentCategory;
      const isFocused = this.focusZone === 'tabs' && this.selectedTabIndex === index;
      const tabBg = container.list[0] as Phaser.GameObjects.Rectangle;
      const tabIcon = container.list[1] as Phaser.GameObjects.Image;
      const tabText = container.list[2] as Phaser.GameObjects.Text;

      if (isFocused) {
        tabBg.setFillStyle(0x4a5a8a);
        tabBg.setStrokeStyle(3, 0xffdd44);
      } else if (isSelected) {
        tabBg.setFillStyle(0x3a4a6a);
        tabBg.setStrokeStyle(2, 0x88aaff);
      } else {
        tabBg.setFillStyle(0x2a2a4a);
        tabBg.setStrokeStyle(2, 0x3a3a5a);
      }

      tabIcon.setTint(isSelected || isFocused ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED);
      tabText.setColor(isSelected || isFocused ? '#ffffff' : '#888888');

      // Update count text color if present
      if (container.list.length > 3) {
        const countText = container.list[3] as Phaser.GameObjects.Text;
        countText.setColor(isSelected ? '#88aaff' : '#666666');
      }
    });
  }

  private createContentContainer(): void {
    const containerY = 120;
    const containerHeight = this.scale.height - 180;

    this.contentContainer = this.add.container(0, containerY);

    const maskGraphics = this.make.graphics({ x: 0, y: 0 });
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, containerY, this.scale.width, containerHeight);
    const mask = maskGraphics.createGeometryMask();
    this.contentContainer.setMask(mask);
  }

  private displayCategoryContent(category: CodexCategory): void {
    this.contentContainer.removeAll(true);
    this.codexCards = [];
    this.scrollY = 0;
    this.contentContainer.y = 120;

    switch (category) {
      case 'weapons':
        this.displayWeapons();
        break;
      case 'enemies':
        this.displayEnemies();
        break;
      case 'upgrades':
        this.displayUpgrades();
        break;
      case 'statistics':
        this.displayStatistics();
        break;
    }
  }

  private displayWeapons(): void {
    const codexManager = getCodexManager();
    const weaponInfoList = getWeaponInfoList();

    const startX = (this.scale.width - this.cardWidth * 2 - this.cardSpacing) / 2;
    const startY = 10;

    weaponInfoList.forEach((weaponInfo, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (this.cardHeight + this.cardSpacing);

      const entry = codexManager.getWeaponEntry(weaponInfo.id);
      this.createWeaponCard(weaponInfo, entry, x, y);
    });

    const totalRows = Math.ceil(weaponInfoList.length / this.columns);
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing);
    const viewHeight = this.scale.height - 180;
    this.maxScrollY = Math.max(0, contentHeight - viewHeight);
  }

  private createWeaponCard(weaponInfo: WeaponInfo, entry: WeaponCodexEntry | undefined, x: number, y: number): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    const isDiscovered = entry?.discovered ?? false;

    // Card background
    const bgColor = isDiscovered ? 0x2a3a5a : 0x1a1a2a;
    const borderColor = isDiscovered ? 0x88aaff : 0x2a2a3a;
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      this.cardHeight / 2,
      this.cardWidth,
      this.cardHeight,
      bgColor
    );
    cardBg.setStrokeStyle(2, borderColor);
    container.add(cardBg);

    // Icon area
    const iconCenterX = 38;
    const iconCenterY = this.cardHeight / 2;

    if (isDiscovered) {
      // Icon background disc
      const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x1a2a4a);
      iconDisc.setStrokeStyle(2, 0x88aaff);
      container.add(iconDisc);

      try {
        const icon = createIcon(this, {
          x: iconCenterX,
          y: iconCenterY,
          iconKey: weaponInfo.icon,
          size: 28,
          tint: 0x88aaff,
        });
        container.add(icon);
      } catch {
        const fallback = this.add.circle(iconCenterX, iconCenterY, 14, 0x88aaff);
        container.add(fallback);
      }

      // Weapon name
      const nameText = this.add.text(75, 16, weaponInfo.name, {
        fontSize: '16px',
        color: '#ffffff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      container.add(nameText);

      // Description
      const descText = this.add.text(75, 38, weaponInfo.description, {
        fontSize: '12px',
        color: '#aaaaaa',
        fontFamily: 'Arial',
        wordWrap: { width: this.cardWidth - 90 },
      });
      container.add(descText);

      // Stats
      if (entry) {
        const statsText = this.add.text(
          this.cardWidth - 12,
          this.cardHeight - 16,
          `Used: ${entry.timesUsed} | Kills: ${entry.totalKills}`,
          {
            fontSize: '10px',
            color: '#666688',
            fontFamily: 'Arial',
          }
        );
        statsText.setOrigin(1, 0.5);
        container.add(statsText);
      }
    } else {
      // Undiscovered — question mark in disc
      const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x111122);
      iconDisc.setStrokeStyle(2, 0x2a2a3a);
      container.add(iconDisc);

      const unknownIcon = this.add.text(iconCenterX, iconCenterY, '?', {
        fontSize: '28px',
        color: '#333344',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      unknownIcon.setOrigin(0.5);
      container.add(unknownIcon);

      const unknownText = this.add.text(this.cardWidth / 2 + 20, this.cardHeight / 2, 'Unknown Weapon', {
        fontSize: '16px',
        color: '#333344',
        fontFamily: 'Arial',
        fontStyle: 'italic',
      });
      unknownText.setOrigin(0.5);
      container.add(unknownText);
    }

    this.codexCards.push({ container, cardBg });
  }

  private displayEnemies(): void {
    const codexManager = getCodexManager();
    const enemyTypes = Object.values(ENEMY_TYPES);

    const startX = (this.scale.width - this.cardWidth * 2 - this.cardSpacing) / 2;
    const startY = 10;

    enemyTypes.forEach((enemyType, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (this.cardHeight + this.cardSpacing);

      const entry = codexManager.getEnemyEntry(enemyType.id);
      this.createEnemyCard(enemyType, entry, x, y);
    });

    const totalRows = Math.ceil(enemyTypes.length / this.columns);
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing);
    const viewHeight = this.scale.height - 180;
    this.maxScrollY = Math.max(0, contentHeight - viewHeight);
  }

  private createEnemyCard(enemyType: EnemyTypeDefinition, entry: EnemyCodexEntry | undefined, x: number, y: number): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    const isDiscovered = entry?.discovered ?? false;

    // Card background
    const bgColor = isDiscovered ? 0x3a2a2a : 0x1a1a2a;
    const borderColor = isDiscovered ? 0xff8888 : 0x2a2a3a;
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      this.cardHeight / 2,
      this.cardWidth,
      this.cardHeight,
      bgColor
    );
    cardBg.setStrokeStyle(2, borderColor);
    container.add(cardBg);

    const iconCenterX = 38;
    const iconCenterY = this.cardHeight / 2;

    if (isDiscovered) {
      // Shape background disc
      const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x2a1a1a);
      iconDisc.setStrokeStyle(2, 0xff8888);
      container.add(iconDisc);

      // Enemy shape representation
      const shapeSize = Math.min(20 * (enemyType.size || 1), 30);

      let shape: Phaser.GameObjects.Shape;
      switch (enemyType.shape) {
        case 'circle':
          shape = this.add.circle(iconCenterX, iconCenterY, shapeSize / 2, enemyType.color);
          break;
        case 'triangle':
          shape = this.add.triangle(iconCenterX, iconCenterY, 0, shapeSize, shapeSize / 2, 0, shapeSize, shapeSize, enemyType.color);
          break;
        case 'diamond':
          shape = this.add.polygon(iconCenterX, iconCenterY, [0, -shapeSize / 2, shapeSize / 2, 0, 0, shapeSize / 2, -shapeSize / 2, 0], enemyType.color);
          break;
        default:
          shape = this.add.rectangle(iconCenterX, iconCenterY, shapeSize, shapeSize, enemyType.color);
      }
      container.add(shape);

      // Enemy name
      const nameText = this.add.text(75, 16, enemyType.name, {
        fontSize: '16px',
        color: '#ffffff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      container.add(nameText);

      // Stats line
      const statsStr = `HP: ${enemyType.baseHealth}  DMG: ${enemyType.baseDamage}  XP: ${enemyType.xpValue}`;
      const statsText = this.add.text(75, 40, statsStr, {
        fontSize: '12px',
        color: '#aaaaaa',
        fontFamily: 'Arial',
      });
      container.add(statsText);

      // Kill count
      if (entry) {
        const killText = this.add.text(
          this.cardWidth - 12,
          this.cardHeight - 16,
          `Killed: ${entry.timesKilled}`,
          {
            fontSize: '10px',
            color: '#666666',
            fontFamily: 'Arial',
          }
        );
        killText.setOrigin(1, 0.5);
        container.add(killText);
      }
    } else {
      // Undiscovered
      const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x111122);
      iconDisc.setStrokeStyle(2, 0x2a2a3a);
      container.add(iconDisc);

      const unknownIcon = this.add.text(iconCenterX, iconCenterY, '?', {
        fontSize: '28px',
        color: '#333344',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      unknownIcon.setOrigin(0.5);
      container.add(unknownIcon);

      const unknownText = this.add.text(this.cardWidth / 2 + 20, this.cardHeight / 2, 'Unknown Enemy', {
        fontSize: '16px',
        color: '#333344',
        fontFamily: 'Arial',
        fontStyle: 'italic',
      });
      unknownText.setOrigin(0.5);
      container.add(unknownText);
    }

    this.codexCards.push({ container, cardBg });
  }

  private displayUpgrades(): void {
    const codexManager = getCodexManager();
    const upgradeEntries = codexManager.getAllUpgradeEntries();

    if (upgradeEntries.length === 0) {
      const noDataText = this.add.text(
        this.scale.width / 2,
        100,
        'No upgrades discovered yet.\nPlay more runs to discover upgrades!',
        {
          fontSize: '18px',
          color: '#666666',
          fontFamily: 'Arial',
          align: 'center',
        }
      );
      noDataText.setOrigin(0.5, 0);
      this.contentContainer.add(noDataText);
      this.maxScrollY = 0;
      return;
    }

    const startX = (this.scale.width - this.cardWidth * 2 - this.cardSpacing) / 2;
    const startY = 10;
    const upgradeCardHeight = 60;

    upgradeEntries.forEach((entry, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (upgradeCardHeight + this.cardSpacing);

      const container = this.add.container(x, y);
      this.contentContainer.add(container);

      // Card background
      const cardBg = this.add.rectangle(
        this.cardWidth / 2,
        upgradeCardHeight / 2,
        this.cardWidth,
        upgradeCardHeight,
        0x2a2a4a
      );
      cardBg.setStrokeStyle(2, 0x4a4a7a);
      container.add(cardBg);

      // Upgrade name
      const nameText = this.add.text(16, upgradeCardHeight / 2, entry.id, {
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      nameText.setOrigin(0, 0.5);
      container.add(nameText);

      // Times selected
      const countText = this.add.text(
        this.cardWidth - 16,
        upgradeCardHeight / 2,
        `Selected ${entry.timesSelected}x`,
        {
          fontSize: '13px',
          color: '#88aaff',
          fontFamily: 'Arial',
        }
      );
      countText.setOrigin(1, 0.5);
      container.add(countText);

      this.codexCards.push({ container, cardBg });
    });

    const totalRows = Math.ceil(upgradeEntries.length / this.columns);
    const contentHeight = totalRows * (upgradeCardHeight + this.cardSpacing);
    const viewHeight = this.scale.height - 180;
    this.maxScrollY = Math.max(0, contentHeight - viewHeight);
  }

  private displayStatistics(): void {
    const codexManager = getCodexManager();
    const stats = codexManager.getStatistics();

    const startX = this.scale.width / 2;
    const startY = 20;
    const lineHeight = 42;

    const statLines = [
      { label: 'Total Runs', value: stats.totalRunsPlayed.toString() },
      { label: 'Total Victories', value: stats.totalVictories.toString() },
      { label: 'Win Rate', value: stats.totalRunsPlayed > 0 ? `${Math.round((stats.totalVictories / stats.totalRunsPlayed) * 100)}%` : '0%' },
      { label: 'Total Play Time', value: this.formatTime(stats.totalPlayTimeSeconds) },
      { label: 'Total Kills', value: stats.totalKills.toLocaleString() },
      { label: 'Total Damage Dealt', value: stats.totalDamageDealt.toLocaleString() },
      { label: 'Total Gold Earned', value: stats.totalGoldEarned.toLocaleString() },
      { label: 'Fastest Victory', value: stats.fastestVictorySeconds < Infinity ? this.formatTime(stats.fastestVictorySeconds) : '--:--' },
      { label: 'Highest World Level', value: stats.highestWorldLevel.toString() },
      { label: 'Highest Player Level', value: stats.highestPlayerLevel.toString() },
    ];

    const rowWidth = this.scale.width - 80;

    statLines.forEach((stat, index) => {
      const y = startY + index * lineHeight;

      // Row background (alternating)
      const rowBg = this.add.rectangle(
        this.scale.width / 2,
        y + lineHeight / 2 - 4,
        rowWidth,
        lineHeight - 4,
        index % 2 === 0 ? 0x222244 : 0x1a1a2e
      );
      this.contentContainer.add(rowBg);

      // Label
      const labelText = this.add.text(startX - 20, y + 8, stat.label, {
        fontSize: '16px',
        color: '#888888',
        fontFamily: 'Arial',
      });
      labelText.setOrigin(1, 0);
      this.contentContainer.add(labelText);

      // Value
      const valueText = this.add.text(startX + 20, y + 6, stat.value, {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      valueText.setOrigin(0, 0);
      this.contentContainer.add(valueText);
    });

    this.maxScrollY = 0;
  }

  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  private setupScrollInput(): void {
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY * 0.5, 0, this.maxScrollY);
      this.contentContainer.y = 120 - this.scrollY;
    });

    let lastY = 0;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      lastY = pointer.y;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.y > 120 && pointer.y < this.scale.height - 60) {
        const deltaY = lastY - pointer.y;
        this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY, 0, this.maxScrollY);
        this.contentContainer.y = 120 - this.scrollY;
        lastY = pointer.y;
      }
    });
  }

  /**
   * Builds a MenuNavigator that mirrors the zone-based focus system
   * to provide gamepad D-pad/stick/A/B button support.
   * Items map to: [tabs...] + [grid cards...] + [back button].
   */
  private buildMenuNavigator(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
    }

    const navigableItems: NavigableItem[] = [];

    // Add tab items
    CODEX_CATEGORIES.forEach((_category, tabIndex) => {
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

    // Add grid card items (codex cards are read-only, no activate action)
    this.codexCards.forEach((_card, cardIndex) => {
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
          // Codex cards are informational only, no action on activate
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

    const totalTabCount = CODEX_CATEGORIES.length;
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

  private selectCategoryByIndex(tabIndex: number): void {
    const category = CODEX_CATEGORIES[tabIndex];
    if (category) {
      this.selectCategory(category.id);
    }
  }

  private ensureCardVisible(): void {
    if (this.codexCards.length === 0) return;

    // Determine card height based on category (upgrades use smaller cards)
    const currentCardHeight = this.currentCategory === 'upgrades' ? 60 : this.cardHeight;
    const row = Math.floor(this.selectedCardIndex / this.columns);
    const cardTopInContainer = 10 + row * (currentCardHeight + this.cardSpacing);
    const cardBottomInContainer = cardTopInContainer + currentCardHeight;
    const viewHeight = this.scale.height - 180;

    if (cardTopInContainer < this.scrollY) {
      this.scrollY = cardTopInContainer;
    } else if (cardBottomInContainer > this.scrollY + viewHeight) {
      this.scrollY = cardBottomInContainer - viewHeight;
    }

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScrollY);
    this.contentContainer.y = 120 - this.scrollY;
  }

  private updateFocusVisuals(): void {
    // Update tab visuals
    this.updateTabVisuals();

    // Update card visuals
    this.codexCards.forEach((card, index) => {
      const isFocused = this.focusZone === 'grid' && this.selectedCardIndex === index;

      if (isFocused) {
        card.cardBg.setStrokeStyle(3, 0xffdd44);
      } else {
        // Restore original border based on category
        const isWeaponOrEnemy = this.currentCategory === 'weapons' || this.currentCategory === 'enemies';
        if (isWeaponOrEnemy) {
          // Check if discovered by looking at bg color
          const bgColor = card.cardBg.fillColor;
          const isDiscovered = bgColor !== 0x1a1a2a;
          if (this.currentCategory === 'weapons') {
            card.cardBg.setStrokeStyle(2, isDiscovered ? 0x88aaff : 0x2a2a3a);
          } else {
            card.cardBg.setStrokeStyle(2, isDiscovered ? 0xff8888 : 0x2a2a3a);
          }
        } else {
          card.cardBg.setStrokeStyle(2, 0x4a4a7a);
        }
      }
    });

    // Update back button
    this.backButton.setColor(this.focusZone === 'back' ? '#ffdd44' : '#888888');
  }
}
