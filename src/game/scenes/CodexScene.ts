/**
 * CodexScene - UI for viewing discovered weapons, enemies, and upgrades.
 * Features category tabs and collection tracking.
 */

import Phaser from 'phaser';
import {
  getCodexManager,
  CodexCategory,
  CODEX_CATEGORIES,
  WeaponCodexEntry,
  EnemyCodexEntry,
} from '../../codex';
import { GAME_WIDTH, GAME_HEIGHT } from '../../GameConfig';
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';
import { getWeaponInfoList, WeaponInfo } from '../../weapons';
import { ENEMY_TYPES, EnemyTypeDefinition } from '../../enemies/EnemyTypes';

export class CodexScene extends Phaser.Scene {
  private currentCategory: CodexCategory = 'weapons';
  private categoryTabs: Map<CodexCategory, Phaser.GameObjects.Container> = new Map();
  private contentContainer!: Phaser.GameObjects.Container;
  private scrollY: number = 0;
  private maxScrollY: number = 0;

  // Grid constants
  private readonly cardWidth = 280;
  private readonly cardHeight = 80;
  private readonly cardSpacing = 10;

  constructor() {
    super({ key: 'CodexScene' });
  }

  create(): void {
    const centerX = GAME_WIDTH / 2;

    // Reset state
    this.categoryTabs.clear();
    this.scrollY = 0;

    // Dark background
    this.add.rectangle(centerX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a1a2e);

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
      .text(GAME_WIDTH - 20, 15, `CODEX ${completionPercent}% COMPLETE`, {
        fontSize: '12px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    this.add
      .text(GAME_WIDTH - 20, 30, `${weaponCount}/${totalWeapons} Weapons`, {
        fontSize: '14px',
        color: '#88aaff',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    this.add
      .text(GAME_WIDTH - 20, 48, `${enemyCount}/${totalEnemies} Enemies`, {
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
    const backButton = this.add
      .text(centerX, GAME_HEIGHT - 30, '[ Back to Menu ]', {
        fontSize: '20px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backButton.on('pointerover', () => backButton.setColor('#ffffff'));
    backButton.on('pointerout', () => backButton.setColor('#888888'));
    backButton.on('pointerdown', () => {
      this.scene.start('BootScene');
    });

    // Setup scroll input
    this.setupScrollInput();

    // ESC key to go back
    this.input.keyboard?.on('keydown-ESC', () => {
      this.scene.start('BootScene');
    });
  }

  private createCategoryTabs(): void {
    const tabY = 70;
    const tabHeight = 36;
    const tabSpacing = 8;
    const totalTabs = CODEX_CATEGORIES.length;
    const tabWidth = Math.floor((GAME_WIDTH - 40 - (totalTabs - 1) * tabSpacing) / totalTabs);
    const startX = 20;

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
      const tabText = this.add.text(tabWidth / 2 + 6, tabHeight / 2, category.name, {
        fontSize: '14px',
        color: isSelected ? '#ffffff' : '#888888',
        fontFamily: 'Arial',
      });
      tabText.setOrigin(0.5);

      tabContainer.add([tabBg, tabIcon, tabText]);
      this.categoryTabs.set(category.id, tabContainer);

      // Click handler
      tabBg.on('pointerdown', () => {
        if (category.id !== this.currentCategory) {
          this.currentCategory = category.id;
          this.updateTabVisuals();
          this.displayCategoryContent(category.id);
        }
      });
    });
  }

  private updateTabVisuals(): void {
    CODEX_CATEGORIES.forEach((category) => {
      const container = this.categoryTabs.get(category.id);
      if (!container) return;

      const isSelected = category.id === this.currentCategory;
      const tabBg = container.list[0] as Phaser.GameObjects.Rectangle;
      const tabIcon = container.list[1] as Phaser.GameObjects.Image;
      const tabText = container.list[2] as Phaser.GameObjects.Text;

      tabBg.setFillStyle(isSelected ? 0x3a4a6a : 0x2a2a4a);
      tabBg.setStrokeStyle(2, isSelected ? 0x88aaff : 0x3a3a5a);
      tabIcon.setTint(isSelected ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED);
      tabText.setColor(isSelected ? '#ffffff' : '#888888');
    });
  }

  private createContentContainer(): void {
    const containerY = 120;
    const containerHeight = GAME_HEIGHT - 180;

    // Create container for content
    this.contentContainer = this.add.container(0, containerY);

    // Create mask for scrolling
    const maskGraphics = this.make.graphics({ x: 0, y: 0 });
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, containerY, GAME_WIDTH, containerHeight);
    const mask = maskGraphics.createGeometryMask();
    this.contentContainer.setMask(mask);
  }

  private displayCategoryContent(category: CodexCategory): void {
    // Clear existing content
    this.contentContainer.removeAll(true);
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

    const startX = (GAME_WIDTH - this.cardWidth * 2 - this.cardSpacing) / 2;
    const startY = 10;
    const columns = 2;

    weaponInfoList.forEach((weaponInfo, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (this.cardHeight + this.cardSpacing);

      const entry = codexManager.getWeaponEntry(weaponInfo.id);
      this.createWeaponCard(weaponInfo, entry, x, y);
    });

    // Calculate max scroll
    const totalRows = Math.ceil(weaponInfoList.length / columns);
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing);
    const viewHeight = GAME_HEIGHT - 180;
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

    if (isDiscovered) {
      // Icon
      try {
        const icon = createIcon(this, {
          x: 30,
          y: this.cardHeight / 2,
          iconKey: weaponInfo.icon,
          size: 32,
          tint: 0x88aaff,
        });
        container.add(icon);
      } catch {
        const fallback = this.add.circle(30, this.cardHeight / 2, 16, 0x88aaff);
        container.add(fallback);
      }

      // Weapon name
      const nameText = this.add.text(60, 15, weaponInfo.name, {
        fontSize: '16px',
        color: '#ffffff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      container.add(nameText);

      // Description
      const descText = this.add.text(60, 35, weaponInfo.description, {
        fontSize: '11px',
        color: '#aaaaaa',
        fontFamily: 'Arial',
        wordWrap: { width: this.cardWidth - 80 },
      });
      container.add(descText);

      // Stats
      if (entry) {
        const statsText = this.add.text(
          this.cardWidth - 10,
          this.cardHeight - 15,
          `Used: ${entry.timesUsed} | Kills: ${entry.totalKills}`,
          {
            fontSize: '10px',
            color: '#666666',
            fontFamily: 'Arial',
          }
        );
        statsText.setOrigin(1, 0.5);
        container.add(statsText);
      }
    } else {
      // Undiscovered - show silhouette
      const unknownIcon = this.add.text(30, this.cardHeight / 2, '?', {
        fontSize: '32px',
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
  }

  private displayEnemies(): void {
    const codexManager = getCodexManager();
    const enemyTypes = Object.values(ENEMY_TYPES);

    const startX = (GAME_WIDTH - this.cardWidth * 2 - this.cardSpacing) / 2;
    const startY = 10;
    const columns = 2;

    enemyTypes.forEach((enemyType, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (this.cardHeight + this.cardSpacing);

      const entry = codexManager.getEnemyEntry(enemyType.id);
      this.createEnemyCard(enemyType, entry, x, y);
    });

    // Calculate max scroll
    const totalRows = Math.ceil(enemyTypes.length / columns);
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing);
    const viewHeight = GAME_HEIGHT - 180;
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

    if (isDiscovered) {
      // Enemy shape representation
      const shapeX = 30;
      const shapeY = this.cardHeight / 2;
      const shapeSize = 20 * (enemyType.size || 1);

      let shape: Phaser.GameObjects.Shape;
      switch (enemyType.shape) {
        case 'circle':
          shape = this.add.circle(shapeX, shapeY, shapeSize / 2, enemyType.color);
          break;
        case 'triangle':
          shape = this.add.triangle(shapeX, shapeY, 0, shapeSize, shapeSize / 2, 0, shapeSize, shapeSize, enemyType.color);
          break;
        case 'diamond':
          shape = this.add.polygon(shapeX, shapeY, [0, -shapeSize / 2, shapeSize / 2, 0, 0, shapeSize / 2, -shapeSize / 2, 0], enemyType.color);
          break;
        default:
          shape = this.add.rectangle(shapeX, shapeY, shapeSize, shapeSize, enemyType.color);
      }
      container.add(shape);

      // Enemy name
      const nameText = this.add.text(60, 15, enemyType.name, {
        fontSize: '16px',
        color: '#ffffff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      container.add(nameText);

      // Stats
      const statsStr = `HP: ${enemyType.baseHealth} | DMG: ${enemyType.baseDamage} | XP: ${enemyType.xpValue}`;
      const statsText = this.add.text(60, 35, statsStr, {
        fontSize: '11px',
        color: '#aaaaaa',
        fontFamily: 'Arial',
      });
      container.add(statsText);

      // Kill count
      if (entry) {
        const killText = this.add.text(
          this.cardWidth - 10,
          this.cardHeight - 15,
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
      const unknownIcon = this.add.text(30, this.cardHeight / 2, '?', {
        fontSize: '32px',
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
  }

  private displayUpgrades(): void {
    const codexManager = getCodexManager();
    const upgradeEntries = codexManager.getAllUpgradeEntries();

    if (upgradeEntries.length === 0) {
      const noDataText = this.add.text(
        GAME_WIDTH / 2,
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

    const startX = 20;
    const startY = 10;
    const lineHeight = 30;

    upgradeEntries.forEach((entry, index) => {
      const y = startY + index * lineHeight;

      const text = this.add.text(
        startX,
        y,
        `${entry.id} - Selected ${entry.timesSelected} time${entry.timesSelected !== 1 ? 's' : ''}`,
        {
          fontSize: '14px',
          color: '#aaaaaa',
          fontFamily: 'Arial',
        }
      );
      this.contentContainer.add(text);
    });

    const contentHeight = upgradeEntries.length * lineHeight + startY * 2;
    const viewHeight = GAME_HEIGHT - 180;
    this.maxScrollY = Math.max(0, contentHeight - viewHeight);
  }

  private displayStatistics(): void {
    const codexManager = getCodexManager();
    const stats = codexManager.getStatistics();

    const startX = GAME_WIDTH / 2;
    const startY = 20;
    const lineHeight = 35;

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

    statLines.forEach((stat, index) => {
      const y = startY + index * lineHeight;

      // Label
      const labelText = this.add.text(startX - 20, y, stat.label, {
        fontSize: '16px',
        color: '#888888',
        fontFamily: 'Arial',
      });
      labelText.setOrigin(1, 0);
      this.contentContainer.add(labelText);

      // Value
      const valueText = this.add.text(startX + 20, y, stat.value, {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      });
      valueText.setOrigin(0, 0);
      this.contentContainer.add(valueText);
    });

    this.maxScrollY = 0; // Stats fit on one screen
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
    // Mouse wheel scrolling
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY * 0.5, 0, this.maxScrollY);
      this.contentContainer.y = 120 - this.scrollY;
    });

    // Touch/drag scrolling
    let lastY = 0;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      lastY = pointer.y;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.y > 120 && pointer.y < GAME_HEIGHT - 60) {
        const deltaY = lastY - pointer.y;
        this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY, 0, this.maxScrollY);
        this.contentContainer.y = 120 - this.scrollY;
        lastY = pointer.y;
      }
    });
  }
}
