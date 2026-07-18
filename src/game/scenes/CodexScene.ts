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
import { WEAPON_SYNERGIES, WeaponSynergy } from '../../data/WeaponSynergies';
import { RELICS, Relic, getRelicRarityColor } from '../../data/Relics';
import { RUN_MODIFIERS, RunModifier } from '../../data/RunModifiers';
import { PACTS, Pact } from '../../data/Pacts';
import { weaponEvolutionDefinitions, WeaponEvolution } from '../../data/WeaponEvolutions';
import { createUpgrades } from '../../data/Upgrades';
import { ENEMY_TYPES, EnemyTypeDefinition } from '../../enemies/EnemyTypes';
import { SHIP_CHARACTERS, ShipCharacter, getShipById } from '../../data/ShipCharacters';
import { getUltimateForShip } from '../../data/ShipUltimates';
import { SHIP_NEON_PALETTES } from '../../visual/NeonColors';
import { transitionToScene, sweepIn, staggerEntrance } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { ACCENT_COLORS_STR, TEXT_COLORS } from '../../visual/MenuStyle';
import { getRunHistory, RunSummary } from '../../meta/RunHistoryManager';
import { getGradeColor } from '../../utils/PerformanceGrade';
import { getAchievementManager } from '../../achievements';

type FocusZone = 'tabs' | 'grid' | 'back';

interface CodexCardElements {
  container: Phaser.GameObjects.Container;
  cardBg: Phaser.GameObjects.Rectangle;
}

const FONT_FAMILY = '"Atkinson Hyperlegible", Arial, sans-serif';
const MODIFIER_CATEGORY_COLOR: Record<RunModifier['category'], number> = {
  offense: 0xff6644,
  defense: 0x44aaff,
  resources: 0xffcc22,
  chaos: 0xaa44ff,
};
const MODIFIER_CATEGORY_ICON: Record<RunModifier['category'], string> = {
  offense: 'sword',
  defense: 'shield',
  resources: 'coins',
  chaos: 'dice',
};
const MODIFIER_CATEGORY_LABEL: Record<RunModifier['category'], string> = {
  offense: 'OFFENSE',
  defense: 'DEFENSE',
  resources: 'RESOURCES',
  chaos: 'CHAOS',
};

export class CodexScene extends Phaser.Scene {
  private currentCategory: CodexCategory = 'weapons';
  private categoryTabs: Map<CodexCategory, Phaser.GameObjects.Container> = new Map();
  private contentContainer!: Phaser.GameObjects.Container;
  private scrollY: number = 0;
  private maxScrollY: number = 0;
  private codexCards: CodexCardElements[] = [];
  private menuBackground: MenuBackground | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private backButton: MenuButton | null = null;

  // Grid constants
  private readonly cardWidth = 340;
  private readonly cardHeight = 95;
  private readonly cardSpacing = 14;
  private readonly columns = 2;

  // Keyboard navigation state
  private focusZone: FocusZone = 'tabs';
  private selectedTabIndex: number = 0;
  private selectedCardIndex: number = 0;
  private menuNavigator: MenuNavigator | null = null;
  private soundManager!: SoundManager;

  constructor() {
    super({ key: 'CodexScene' });
  }

  create(): void {
    const centerX = this.scale.width / 2;

    this.soundManager = new SoundManager(this);

    // Reset state
    this.categoryTabs.clear();
    this.codexCards = [];
    this.scrollY = 0;
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;

    // Menu backdrop.
    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (time, delta) => {
      this.menuBackground?.update(delta);
      this.backButton?.tickIdle(time / 1000);
    };
    this.events.on('update', this.bgUpdateHandler);

    // Title heading.
    const title = makeDisplayText(this, centerX, 36, 'CODEX', {
      fontSize: 32,
      color: ACCENT_COLORS_STR.primary,
      strokeWidth: 5,
      letterSpacing: 4,
    });

    // Completion percentage display (top right).
    const codexManager = getCodexManager();
    const completionPercent = codexManager.getCompletionPercent();
    const weaponCount = codexManager.getDiscoveredWeaponCount();
    const totalWeapons = codexManager.getTotalWeaponCount();
    const enemyCount = codexManager.getDiscoveredEnemyCount();
    const totalEnemies = codexManager.getTotalEnemyCount();

    const completionLabel = makeBodyText(this, this.scale.width - 20, 18, 'COMPLETION', {
      fontSize: 11,
      color: TEXT_COLORS.muted,
    });
    completionLabel.setOrigin(1, 0);

    const completionValue = makeDisplayText(this, this.scale.width - 20, 36,
      `${completionPercent}%`, {
        fontSize: 18,
        color: ACCENT_COLORS_STR.primary,
        letterSpacing: 1,
      });
    completionValue.setOrigin(1, 0.5);

    const subStats = makeBodyText(this, this.scale.width - 20, 56,
      `${weaponCount}/${totalWeapons} weapons   ·   ${enemyCount}/${totalEnemies} enemies`, {
        fontSize: 11,
        color: TEXT_COLORS.muted,
      });
    subStats.setOrigin(1, 0);

    // Create category tabs
    this.createCategoryTabs();

    // Create scrollable content container with mask
    this.createContentContainer();

    // Display content for default category
    this.displayCategoryContent(this.currentCategory);

    // Back button.
    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: this.scale.height - 36,
      width: 220,
      height: 44,
      label: '← BACK TO MENU',
      variant: 'neutral',
      fontSize: 14,
      onActivate: () => {
        this.soundManager.playUIClick();
        transitionToScene(this, 'BootScene');
      },
    });
    this.backButton.card.hitZone.on('pointerover', () => {
      this.focusZone = 'back';
      this.updateFocusVisuals();
      this.backButton!.setHoverState(true);
    });
    this.backButton.card.hitZone.on('pointerout', () => {
      this.backButton!.setHoverState(false);
      this.updateFocusVisuals();
    });


    // Setup scroll input
    this.setupScrollInput();

    // Setup keyboard + gamepad navigation via MenuNavigator
    // (replaces the old setupKeyboardNavigation for full keyboard + gamepad support)
    this.buildMenuNavigator();

    // Initial focus visuals
    this.updateFocusVisuals();

    // Entrance choreography: title + completion first, tabs next, then the
    // content list rises in as one block (rows scroll inside the mask).
    staggerEntrance(this, [
      title,
      completionLabel,
      completionValue,
      subStats,
      ...this.categoryTabs.values(),
      this.contentContainer,
      this.backButton.container,
    ]);
    sweepIn(this);

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);
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
        fontFamily: FONT_FAMILY,
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
      } else if (category.id === 'synergies') {
        countLabel = `${codexManager.getDiscoveredSynergyCount()}/${codexManager.getTotalSynergyCount()}`;
      } else if (category.id === 'relics') {
        countLabel = `${RELICS.length}`;
      } else if (category.id === 'evolutions') {
        countLabel = `${codexManager.getDiscoveredEvolutionCount()}/${codexManager.getTotalEvolutionCount()}`;
      } else if (category.id === 'ships') {
        countLabel = `${SHIP_CHARACTERS.length}`;
      } else if (category.id === 'modifiers') {
        countLabel = `${RUN_MODIFIERS.length}`;
      } else if (category.id === 'pacts') {
        countLabel = `${PACTS.length}`;
      } else if (category.id === 'runs') {
        countLabel = `${getRunHistory().length}`;
      }

      if (countLabel) {
        const countText = this.add.text(tabWidth - 8, tabHeight / 2, countLabel, {
          fontSize: '11px',
          color: isSelected ? '#88aaff' : '#666666',
          fontFamily: FONT_FAMILY,
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
      case 'synergies':
        this.displaySynergies();
        break;
      case 'relics':
        this.displayRelics();
        break;
      case 'evolutions':
        this.displayEvolutions();
        break;
      case 'ships':
        this.displayShips();
        break;
      case 'modifiers':
        this.displayModifiers();
        break;
      case 'pacts':
        this.displayPacts();
        break;
      case 'statistics':
        this.displayStatistics();
        break;
      case 'runs':
        this.displayRuns();
        break;
    }
  }

  /**
   * Lays out cards in a 2-column grid and updates maxScrollY. `render` builds
   * one card at the given (x,y) position.
   */
  private layoutCardGrid<T>(items: T[], cardHeight: number, render: (item: T, x: number, y: number) => void): void {
    const startX = (this.scale.width - this.cardWidth * 2 - this.cardSpacing) / 2;
    const startY = 10;

    items.forEach((item, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (cardHeight + this.cardSpacing);
      render(item, x, y);
    });

    const totalRows = Math.ceil(items.length / this.columns);
    const contentHeight = totalRows * (cardHeight + this.cardSpacing);
    const viewHeight = this.scale.height - 180;
    this.maxScrollY = Math.max(0, contentHeight - viewHeight);
  }

  private displayWeapons(): void {
    const codexManager = getCodexManager();
    const weaponInfoList = getWeaponInfoList();
    this.layoutCardGrid(weaponInfoList, this.cardHeight, (weaponInfo, x, y) => {
      const entry = codexManager.getWeaponEntry(weaponInfo.id);
      this.createWeaponCard(weaponInfo, entry, x, y);
    });
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
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
      });
      container.add(nameText);

      // Description
      const descText = this.add.text(75, 38, weaponInfo.description, {
        fontSize: '12px',
        color: '#aaaaaa',
        fontFamily: FONT_FAMILY,
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
            fontFamily: FONT_FAMILY,
          }
        );
        statsText.setOrigin(1, 0.5);
        container.add(statsText);
      }
    } else {
      this.addUnknownPlaceholder(container, iconCenterX, iconCenterY, 'Unknown Weapon');
    }

    this.codexCards.push({ container, cardBg });
  }

  /** Adds "?" icon-disc + "Unknown ..." label for undiscovered entries. */
  private addUnknownPlaceholder(
    container: Phaser.GameObjects.Container,
    iconCenterX: number,
    iconCenterY: number,
    labelText: string,
  ): void {
    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x111122);
    iconDisc.setStrokeStyle(2, 0x2a2a3a);
    container.add(iconDisc);

    const unknownIcon = this.add.text(iconCenterX, iconCenterY, '?', {
      fontSize: '28px',
      color: '#333344',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    unknownIcon.setOrigin(0.5);
    container.add(unknownIcon);

    const unknownLabel = this.add.text(this.cardWidth / 2 + 20, this.cardHeight / 2, labelText, {
      fontSize: '16px',
      color: '#333344',
      fontFamily: FONT_FAMILY,
      fontStyle: 'italic',
    });
    unknownLabel.setOrigin(0.5);
    container.add(unknownLabel);
  }

  private displayEnemies(): void {
    const codexManager = getCodexManager();
    const enemyTypes = Object.values(ENEMY_TYPES);
    this.layoutCardGrid(enemyTypes, this.cardHeight, (enemyType, x, y) => {
      const entry = codexManager.getEnemyEntry(enemyType.id);
      this.createEnemyCard(enemyType, entry, x, y);
    });
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
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
      });
      container.add(nameText);

      // Stats line
      const statsStr = `HP: ${enemyType.baseHealth}  DMG: ${enemyType.baseDamage}  XP: ${enemyType.xpValue}`;
      const statsText = this.add.text(75, 40, statsStr, {
        fontSize: '12px',
        color: '#aaaaaa',
        fontFamily: FONT_FAMILY,
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
            fontFamily: FONT_FAMILY,
          }
        );
        killText.setOrigin(1, 0.5);
        container.add(killText);
      }
    } else {
      this.addUnknownPlaceholder(container, iconCenterX, iconCenterY, 'Unknown Enemy');
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
          fontFamily: FONT_FAMILY,
          align: 'center',
        }
      );
      noDataText.setOrigin(0.5, 0);
      this.contentContainer.add(noDataText);
      this.maxScrollY = 0;
      return;
    }

    const upgradeCardHeight = 60;

    this.layoutCardGrid(upgradeEntries, upgradeCardHeight, (entry, x, y) => {
      const container = this.add.container(x, y);
      this.contentContainer.add(container);

      const cardBg = this.add.rectangle(
        this.cardWidth / 2,
        upgradeCardHeight / 2,
        this.cardWidth,
        upgradeCardHeight,
        0x2a2a4a
      );
      cardBg.setStrokeStyle(2, 0x4a4a7a);
      container.add(cardBg);

      const nameText = this.add.text(16, upgradeCardHeight / 2, entry.id, {
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
      });
      nameText.setOrigin(0, 0.5);
      container.add(nameText);

      const countText = this.add.text(
        this.cardWidth - 16,
        upgradeCardHeight / 2,
        `Selected ${entry.timesSelected}x`,
        {
          fontSize: '13px',
          color: '#88aaff',
          fontFamily: FONT_FAMILY,
        }
      );
      countText.setOrigin(1, 0.5);
      container.add(countText);

      this.codexCards.push({ container, cardBg });
    });
  }

  private displaySynergies(): void {
    const codexManager = getCodexManager();
    const weaponInfoById = new Map<string, WeaponInfo>();
    for (const info of getWeaponInfoList()) {
      weaponInfoById.set(info.id, info);
    }

    const synergyCardHeight = 108;

    this.layoutCardGrid([...WEAPON_SYNERGIES], synergyCardHeight, (synergy, x, y) => {
      this.createSynergyCard(
        synergy,
        weaponInfoById,
        codexManager.isSynergyDiscovered(synergy),
        x,
        y,
        synergyCardHeight,
      );
    });
  }

  private createSynergyCard(
    synergy: WeaponSynergy,
    weaponInfoById: Map<string, WeaponInfo>,
    discovered: boolean,
    x: number,
    y: number,
    cardHeight: number,
  ): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    // Border matches the else-branch restore color in updateFocusVisuals (0x4a4a7a),
    // so focus in/out needs no special-casing for this always-visible category.
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      cardHeight / 2,
      this.cardWidth,
      cardHeight,
      discovered ? 0x2a3a5a : 0x1e1e34,
    );
    cardBg.setStrokeStyle(2, 0x4a4a7a);
    container.add(cardBg);

    // Left gutter: the two weapon icons that trigger the synergy, joined by "+".
    const infoA = weaponInfoById.get(synergy.weaponA);
    const infoB = weaponInfoById.get(synergy.weaponB);
    const iconY = Math.floor(cardHeight / 2);
    this.addSynergyWeaponIcon(container, infoA, 34, iconY);
    const plusSign = this.add.text(58, iconY, '+', {
      fontSize: '16px',
      color: '#ffcc66',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    plusSign.setOrigin(0.5);
    container.add(plusSign);
    this.addSynergyWeaponIcon(container, infoB, 82, iconY);

    const textX = 112;

    const nameText = this.add.text(textX, 12, synergy.name, {
      fontSize: '15px',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const pairLabel = `${infoA?.name ?? synergy.weaponA} + ${infoB?.name ?? synergy.weaponB}`;
    const pairText = this.add.text(textX, 36, pairLabel, {
      fontSize: '11px',
      color: '#8899bb',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - textX - 12 },
    });
    container.add(pairText);

    const bonusText = this.add.text(textX, 56, this.formatSynergyBonusLine(synergy), {
      fontSize: '12px',
      color: '#ffcc66',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(bonusText);

    const descText = this.add.text(textX, 76, synergy.description, {
      fontSize: '11px',
      color: '#999999',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - textX - 12 },
    });
    container.add(descText);

    this.codexCards.push({ container, cardBg });
  }

  private addSynergyWeaponIcon(
    container: Phaser.GameObjects.Container,
    info: WeaponInfo | undefined,
    iconX: number,
    iconY: number,
  ): void {
    const iconDisc = this.add.circle(iconX, iconY, 16, 0x1a2a4a);
    iconDisc.setStrokeStyle(2, 0x4a4a7a);
    container.add(iconDisc);
    if (!info) return;
    try {
      const icon = createIcon(this, {
        x: iconX,
        y: iconY,
        iconKey: info.icon,
        size: 20,
        tint: 0xffcc66,
      });
      container.add(icon);
    } catch {
      const fallback = this.add.circle(iconX, iconY, 9, 0xffcc66);
      container.add(fallback);
    }
  }

  private formatSynergyBonusLine(synergy: WeaponSynergy): string {
    const parts: string[] = [];
    if (synergy.damageMultiplier > 1) {
      parts.push(`+${Math.round((synergy.damageMultiplier - 1) * 100)}% dmg`);
    }
    if (synergy.cooldownMultiplier < 1) {
      parts.push(`+${Math.round((1 - synergy.cooldownMultiplier) * 100)}% atk spd`);
    }
    return parts.length > 0 ? parts.join('  ·  ') : 'Passive bonus';
  }

  private displayRelics(): void {
    const relicCardHeight = 96;

    this.layoutCardGrid([...RELICS], relicCardHeight, (relic, x, y) => {
      this.createRelicCard(relic, x, y, relicCardHeight);
    });
  }

  private createRelicCard(relic: Relic, x: number, y: number, cardHeight: number): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    // Border stays 0x4a4a7a — the exact color updateFocusVisuals restores for a
    // non-weapon/non-enemy category — so focus in/out needs no special-casing.
    // Rarity is signalled by the icon tint and rarity label, never the border.
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      cardHeight / 2,
      this.cardWidth,
      cardHeight,
      0x2a2a4a,
    );
    cardBg.setStrokeStyle(2, 0x4a4a7a);
    container.add(cardBg);

    const rarityColor = getRelicRarityColor(relic.rarity);
    const rarityHex = '#' + rarityColor.toString(16).padStart(6, '0');

    const iconCenterX = 38;
    const iconCenterY = Math.floor(cardHeight / 2);

    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x1a2a4a);
    iconDisc.setStrokeStyle(2, rarityColor);
    container.add(iconDisc);
    try {
      const icon = createIcon(this, {
        x: iconCenterX,
        y: iconCenterY,
        iconKey: relic.icon,
        size: 28,
        tint: rarityColor,
      });
      container.add(icon);
    } catch {
      const fallback = this.add.circle(iconCenterX, iconCenterY, 12, rarityColor);
      container.add(fallback);
    }

    const textX = 75;

    const nameText = this.add.text(textX, 14, relic.name, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const rarityText = this.add.text(textX, 38, relic.rarity.toUpperCase(), {
      fontSize: '11px',
      color: rarityHex,
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(rarityText);

    const descText = this.add.text(textX, 56, relic.description, {
      fontSize: '12px',
      color: '#aaaaaa',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - textX - 14 },
    });
    container.add(descText);

    this.codexCards.push({ container, cardBg });
  }

  private displayModifiers(): void {
    const modifierCardHeight = 96;

    this.layoutCardGrid([...RUN_MODIFIERS], modifierCardHeight, (modifier, x, y) => {
      this.createModifierCard(modifier, x, y, modifierCardHeight);
    });
  }

  private createModifierCard(modifier: RunModifier, x: number, y: number, cardHeight: number): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    // Border stays 0x4a4a7a — the exact color updateFocusVisuals restores for a
    // non-weapon/non-enemy category — so focus in/out needs no special-casing.
    // Category is signalled by the icon tint and category label, never the border.
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      cardHeight / 2,
      this.cardWidth,
      cardHeight,
      0x2a2a4a,
    );
    cardBg.setStrokeStyle(2, 0x4a4a7a);
    container.add(cardBg);

    const categoryColor = MODIFIER_CATEGORY_COLOR[modifier.category];
    const categoryHex = '#' + categoryColor.toString(16).padStart(6, '0');

    const iconCenterX = 38;
    const iconCenterY = Math.floor(cardHeight / 2);

    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x1a2a4a);
    iconDisc.setStrokeStyle(2, categoryColor);
    container.add(iconDisc);
    try {
      const icon = createIcon(this, {
        x: iconCenterX,
        y: iconCenterY,
        iconKey: MODIFIER_CATEGORY_ICON[modifier.category],
        size: 28,
        tint: categoryColor,
      });
      container.add(icon);
    } catch {
      const fallback = this.add.circle(iconCenterX, iconCenterY, 12, categoryColor);
      container.add(fallback);
    }

    const textX = 75;

    const nameText = this.add.text(textX, 14, modifier.name, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const categoryText = this.add.text(textX, 38, MODIFIER_CATEGORY_LABEL[modifier.category], {
      fontSize: '11px',
      color: categoryHex,
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(categoryText);

    const descText = this.add.text(textX, 56, modifier.description, {
      fontSize: '12px',
      color: '#aaaaaa',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - textX - 14 },
    });
    container.add(descText);

    this.codexCards.push({ container, cardBg });
  }

  private displayRuns(): void {
    const runs = getRunHistory();

    if (runs.length === 0) {
      const emptyText = this.add.text(
        this.scale.width / 2,
        60,
        'No runs recorded yet.\nFinish a run to start your history.',
        {
          fontSize: '16px',
          color: '#8888aa',
          fontFamily: FONT_FAMILY,
          align: 'center',
        },
      );
      emptyText.setOrigin(0.5, 0);
      this.contentContainer.add(emptyText);
      this.maxScrollY = 0;
      return;
    }

    const runCardHeight = 112;
    this.layoutCardGrid(runs, runCardHeight, (run, x, y) => {
      this.createRunCard(run, x, y, runCardHeight);
    });
  }

  private createRunCard(run: RunSummary, x: number, y: number, cardHeight: number): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    // Border stays 0x4a4a7a — the color updateFocusVisuals restores for a
    // non-weapon/non-enemy category — so focus in/out needs no special-casing.
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      cardHeight / 2,
      this.cardWidth,
      cardHeight,
      0x2a2a4a,
    );
    cardBg.setStrokeStyle(2, 0x4a4a7a);
    container.add(cardBg);

    const gradeColor = getGradeColor(run.grade);
    const discCenterX = 40;
    const discCenterY = Math.floor(cardHeight / 2);

    const gradeDisc = this.add.circle(discCenterX, discCenterY, 26, 0x1a2a4a);
    gradeDisc.setStrokeStyle(3, Phaser.Display.Color.HexStringToColor(gradeColor).color);
    container.add(gradeDisc);

    const gradeText = this.add.text(discCenterX, discCenterY, run.grade, {
      fontSize: '22px',
      color: gradeColor,
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    gradeText.setOrigin(0.5);
    container.add(gradeText);

    const textX = 82;

    const weaponNames = new Map(getWeaponInfoList().map((weapon) => [weapon.id, weapon.name]));
    const weaponLabel =
      typeof run.startingWeapon === 'string' ? weaponNames.get(run.startingWeapon) ?? run.startingWeapon : '—';

    const nameText = this.add.text(textX, 12, weaponLabel, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const scoreText = this.add.text(this.cardWidth - 14, 13, run.score.toLocaleString(), {
      fontSize: '14px',
      color: '#ffd24a',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    scoreText.setOrigin(1, 0);
    container.add(scoreText);

    const shipLabel = run.shipId ? getShipById(run.shipId)?.name ?? '—' : '—';
    const threatTier = typeof run.threatLevel === 'number' ? run.threatLevel : 0;
    const modeLabel =
      run.mode === 'gauntlet' ? ' · GAUNTLET'
      : run.mode === 'daily' ? ' · DAILY'
      : run.mode === 'endless' ? ' · ENDLESS'
      : '';
    const pactCount = Array.isArray(run.pactIds) ? run.pactIds.length : 0;
    const pactLabel = pactCount > 0 ? ` · ${pactCount} pact${pactCount > 1 ? 's' : ''}` : '';
    const buildText = this.add.text(
      textX,
      40,
      `${shipLabel} · T${threatTier}${modeLabel}${pactLabel}`,
      {
        fontSize: '12px',
        color: '#9aabd0',
        fontFamily: FONT_FAMILY,
        wordWrap: { width: this.cardWidth - textX - 14 },
      },
    );
    container.add(buildText);

    const outcomeText = this.add.text(textX, 76, run.victory ? 'WIN' : 'LOSS', {
      fontSize: '13px',
      color: run.victory ? '#66ff99' : '#ff6666',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(outcomeText);

    const detailText = this.add.text(
      textX + outcomeText.width + 8,
      78,
      `· ${this.formatTime(run.durationSeconds)} · Lv${run.level} · ${run.kills.toLocaleString()} kills`,
      {
        fontSize: '12px',
        color: '#aaaaaa',
        fontFamily: FONT_FAMILY,
      },
    );
    container.add(detailText);

    this.codexCards.push({ container, cardBg });
  }

  private displayPacts(): void {
    const pactCardHeight = 96;

    this.layoutCardGrid([...PACTS], pactCardHeight, (pact, x, y) => {
      this.createPactCard(pact, x, y, pactCardHeight);
    });
  }

  private createPactCard(pact: Pact, x: number, y: number, cardHeight: number): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    // Border stays 0x4a4a7a — the exact color updateFocusVisuals restores for a
    // non-weapon/non-enemy category — so focus in/out needs no special-casing.
    // The pact is signalled by the icon tint, never the border.
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      cardHeight / 2,
      this.cardWidth,
      cardHeight,
      0x2a2a4a,
    );
    cardBg.setStrokeStyle(2, 0x4a4a7a);
    container.add(cardBg);

    const iconCenterX = 38;
    const iconCenterY = Math.floor(cardHeight / 2);

    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x1a2a4a);
    iconDisc.setStrokeStyle(2, pact.color);
    container.add(iconDisc);
    try {
      const icon = createIcon(this, {
        x: iconCenterX,
        y: iconCenterY,
        iconKey: 'devil',
        size: 28,
        tint: pact.color,
      });
      container.add(icon);
    } catch {
      const fallback = this.add.circle(iconCenterX, iconCenterY, 12, pact.color);
      container.add(fallback);
    }

    const textX = 75;

    const nameText = this.add.text(textX, 14, pact.name, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const rewardText = this.add.text(textX, 38, pact.reward, {
      fontSize: '12px',
      color: '#ffdd66',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(rewardText);

    const downsideText = this.add.text(textX, 56, pact.description, {
      fontSize: '12px',
      color: '#cc8899',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - textX - 14 },
    });
    container.add(downsideText);

    this.codexCards.push({ container, cardBg });
  }

  private displayEvolutions(): void {
    const codexManager = getCodexManager();
    const weaponInfoById = new Map<string, WeaponInfo>();
    for (const info of getWeaponInfoList()) {
      weaponInfoById.set(info.id, info);
    }

    const statNameById = new Map<string, string>();
    for (const upgrade of createUpgrades()) {
      statNameById.set(upgrade.id, upgrade.name);
    }

    const evolutionCardHeight = 120;

    this.layoutCardGrid([...weaponEvolutionDefinitions], evolutionCardHeight, (evolution, x, y) => {
      this.createEvolutionCard(
        evolution,
        weaponInfoById,
        statNameById,
        codexManager.isEvolutionDiscovered(evolution),
        x,
        y,
        evolutionCardHeight,
      );
    });
  }

  private createEvolutionCard(
    evolution: WeaponEvolution,
    weaponInfoById: Map<string, WeaponInfo>,
    statNameById: Map<string, string>,
    discovered: boolean,
    x: number,
    y: number,
    cardHeight: number,
  ): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    // Border stays 0x4a4a7a — the exact color updateFocusVisuals restores for a
    // non-weapon/non-enemy category — so focus in/out needs no special-casing.
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      cardHeight / 2,
      this.cardWidth,
      cardHeight,
      discovered ? 0x2a3a5a : 0x1e1e34,
    );
    cardBg.setStrokeStyle(2, 0x4a4a7a);
    container.add(cardBg);

    const evolutionAccent = 0xffbb33;

    // Left gutter: the base weapon's icon, tinted the evolution accent.
    const iconCenterX = 38;
    const iconCenterY = Math.floor(cardHeight / 2);
    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 24, 0x1a2a4a);
    iconDisc.setStrokeStyle(2, evolutionAccent);
    container.add(iconDisc);
    const baseInfo = weaponInfoById.get(evolution.weaponId);
    try {
      const icon = createIcon(this, {
        x: iconCenterX,
        y: iconCenterY,
        iconKey: baseInfo?.icon ?? evolution.weaponId,
        size: 28,
        tint: evolutionAccent,
      });
      container.add(icon);
    } catch {
      const fallback = this.add.circle(iconCenterX, iconCenterY, 12, evolutionAccent);
      container.add(fallback);
    }

    const textX = 75;
    const baseName = baseInfo?.name ?? evolution.weaponId;
    const statName = statNameById.get(evolution.requiredStatId)
      ?? evolution.requiredStatId.charAt(0).toUpperCase() + evolution.requiredStatId.slice(1);

    const nameText = this.add.text(textX, 10, evolution.evolvedName, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const recipeText = this.add.text(
      textX,
      34,
      `${baseName} Lv${evolution.requiredWeaponLevel}   +   ${statName} Lv${evolution.requiredStatLevel}`,
      {
        fontSize: '12px',
        color: '#ffbb33',
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
      },
    );
    container.add(recipeText);

    const gainsText = this.add.text(textX, 56, this.formatEvolutionGains(evolution), {
      fontSize: '12px',
      color: '#66dd99',
      fontFamily: FONT_FAMILY,
    });
    container.add(gainsText);

    const descText = this.add.text(textX, 78, evolution.evolvedDescription, {
      fontSize: '11px',
      color: '#999999',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - textX - 12 },
    });
    container.add(descText);

    this.codexCards.push({ container, cardBg });
  }

  private formatEvolutionGains(evolution: WeaponEvolution): string {
    const parts: string[] = [];
    const multipliers = evolution.statMultipliers;
    if (multipliers.damage !== undefined && multipliers.damage !== 1) {
      parts.push(`+${Math.round((multipliers.damage - 1) * 100)}% dmg`);
    }
    if (multipliers.count !== undefined && multipliers.count !== 0) {
      parts.push(`+${multipliers.count} proj`);
    }
    if (multipliers.piercing !== undefined && multipliers.piercing !== 0) {
      parts.push(`+${multipliers.piercing} pierce`);
    }
    if (multipliers.cooldown !== undefined && multipliers.cooldown !== 1) {
      parts.push(`${Math.round((1 - multipliers.cooldown) * 100)}% faster`);
    }
    if (multipliers.range !== undefined && multipliers.range !== 1) {
      parts.push(`+${Math.round((multipliers.range - 1) * 100)}% range`);
    }
    if (multipliers.size !== undefined && multipliers.size !== 1) {
      parts.push(`+${Math.round((multipliers.size - 1) * 100)}% size`);
    }
    if (multipliers.speed !== undefined && multipliers.speed !== 1) {
      parts.push(`+${Math.round((multipliers.speed - 1) * 100)}% proj spd`);
    }
    return parts.length > 0 ? parts.join('   ·   ') : 'Enhanced form';
  }

  private displayShips(): void {
    const shipCardHeight = 134;

    this.layoutCardGrid([...SHIP_CHARACTERS], shipCardHeight, (ship, x, y) => {
      this.createShipCard(ship, x, y, shipCardHeight);
    });
  }

  private createShipCard(ship: ShipCharacter, x: number, y: number, cardHeight: number): void {
    const container = this.add.container(x, y);
    this.contentContainer.add(container);

    // Border stays 0x4a4a7a — the exact color updateFocusVisuals restores for a
    // non-weapon/non-enemy category — so focus in/out needs no special-casing.
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      cardHeight / 2,
      this.cardWidth,
      cardHeight,
      0x2a2a4a,
    );
    cardBg.setStrokeStyle(2, 0x4a4a7a);
    container.add(cardBg);

    const shipTint = SHIP_NEON_PALETTES[ship.neonColorId]?.core ?? SHIP_NEON_PALETTES.cyan.core;

    // Left gutter: a ship glyph tinted the ship's own neon color (each ship's hull is
    // procedural, so the roster shares one icon differentiated by tint + name).
    const iconCenterX = 32;
    const iconCenterY = Math.floor(cardHeight / 2);
    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 22, 0x1a2a4a);
    iconDisc.setStrokeStyle(2, shipTint);
    container.add(iconDisc);
    try {
      const icon = createIcon(this, {
        x: iconCenterX,
        y: iconCenterY,
        iconKey: 'rocket',
        size: 26,
        tint: shipTint,
      });
      container.add(icon);
    } catch {
      const fallback = this.add.circle(iconCenterX, iconCenterY, 11, shipTint);
      container.add(fallback);
    }

    const textX = 62;
    const wrapWidth = this.cardWidth - textX - 12;

    const nameText = this.add.text(textX, 8, ship.name, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const descText = this.add.text(textX, 30, ship.description, {
      fontSize: '11px',
      color: '#99aacc',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: wrapWidth },
    });
    container.add(descText);

    const ultimate = getUltimateForShip(ship);

    const ultimateNameText = this.add.text(textX, 84, `Ultimate: ${ultimate.name}`, {
      fontSize: '12px',
      color: '#ffcc66',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(ultimateNameText);

    const ultimateDescText = this.add.text(textX, 104, ultimate.description, {
      fontSize: '11px',
      color: '#999999',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: wrapWidth },
    });
    container.add(ultimateDescText);

    this.codexCards.push({ container, cardBg });
  }

  private displayStatistics(): void {
    const codexManager = getCodexManager();
    const stats = codexManager.getStatistics();
    const lifetime = getAchievementManager().getLifetimeStats();

    const startX = this.scale.width / 2;
    const startY = 20;
    const lineHeight = 42;

    type StatRow = { header: string } | { label: string; value: string };

    const rows: StatRow[] = [
      { header: 'TOTALS' },
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
      { header: 'RECORDS' },
      { label: 'Bosses Slain', value: lifetime.totalBossesKilled.toLocaleString() },
      { label: 'Most Kills (Run)', value: lifetime.mostKillsInRun.toLocaleString() },
      { label: 'Best Combo (Run)', value: lifetime.highestComboInRun.toLocaleString() },
      { label: 'Longest Survival', value: lifetime.longestSurvivalSeconds > 0 ? this.formatTime(lifetime.longestSurvivalSeconds) : '--:--' },
      { label: 'Flawless Wins', value: lifetime.perfectRuns.toLocaleString() },
      { label: 'Speed Wins (<8m)', value: lifetime.speedRuns.toLocaleString() },
      { label: 'Critical Hits', value: lifetime.totalCriticalHits.toLocaleString() },
    ];

    const rowWidth = this.scale.width - 80;
    let zebra = 0;

    rows.forEach((row, index) => {
      const y = startY + index * lineHeight;

      if ('header' in row) {
        const headerText = this.add.text(this.scale.width / 2, y + 12, row.header, {
          fontSize: '15px',
          color: ACCENT_COLORS_STR.gold,
          fontFamily: FONT_FAMILY,
          fontStyle: 'bold',
        });
        headerText.setLetterSpacing(3);
        headerText.setOrigin(0.5, 0);
        this.contentContainer.add(headerText);
        return;
      }

      const rowBg = this.add.rectangle(
        this.scale.width / 2,
        y + lineHeight / 2 - 4,
        rowWidth,
        lineHeight - 4,
        zebra % 2 === 0 ? 0x222244 : 0x1a1a2e
      );
      this.contentContainer.add(rowBg);
      zebra++;

      const labelText = this.add.text(startX - 20, y + 8, row.label, {
        fontSize: '16px',
        color: '#888888',
        fontFamily: FONT_FAMILY,
      });
      labelText.setOrigin(1, 0);
      this.contentContainer.add(labelText);

      const valueText = this.add.text(startX + 20, y + 6, row.value, {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
      });
      valueText.setOrigin(0, 0);
      this.contentContainer.add(valueText);
    });

    const contentBottom = startY + rows.length * lineHeight;
    const viewHeight = this.scale.height - 180;
    this.maxScrollY = Math.max(0, contentBottom - viewHeight);
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
        transitionToScene(this, 'BootScene');
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
        transitionToScene(this, 'BootScene');
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

    // Update back button focus pop.
    this.backButton?.setFocusState(this.focusZone === 'back');
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    if (this.bgUpdateHandler) {
      this.events.off('update', this.bgUpdateHandler);
      this.bgUpdateHandler = null;
    }
    this.menuBackground?.destroy();
    this.menuBackground = null;
    this.backButton?.destroy();
    this.backButton = null;
    this.tweens.killAll();
  }
}
