/**
 * AchievementScene - UI for viewing persistent achievement progress.
 * Features category tabs, progress bars, and reward claiming.
 */

import Phaser from 'phaser';
import {
  getAchievementManager,
  ACHIEVEMENTS,
  getAchievementsByCategory,
  AchievementDefinition,
  AchievementCategory,
} from '../../achievements';
import { GAME_WIDTH, GAME_HEIGHT } from '../../GameConfig';
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';
import { fadeIn, fadeOut, addButtonInteraction } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';

// Achievement categories with display names and icons
const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; name: string; icon: string }[] = [
  { id: 'combat', name: 'Combat', icon: 'sword' },
  { id: 'survival', name: 'Survival', icon: 'heart' },
  { id: 'progression', name: 'Progression', icon: 'star' },
  { id: 'challenge', name: 'Challenge', icon: 'trophy' },
];

type FocusZone = 'tabs' | 'grid' | 'back';

interface AchievementCardElements {
  container: Phaser.GameObjects.Container;
  cardBg: Phaser.GameObjects.Rectangle;
  progressBar: Phaser.GameObjects.Rectangle;
  progressBg: Phaser.GameObjects.Rectangle;
  statusText: Phaser.GameObjects.Text;
  achievement: AchievementDefinition;
}

export class AchievementScene extends Phaser.Scene {
  private achievementCards: AchievementCardElements[] = [];
  private currentCategory: AchievementCategory = 'combat';
  private categoryTabs: Map<AchievementCategory, Phaser.GameObjects.Container> = new Map();
  private achievementContainer!: Phaser.GameObjects.Container;
  private scrollY: number = 0;
  private maxScrollY: number = 0;
  private backButton!: Phaser.GameObjects.Text;

  // Grid constants
  private readonly cardWidth = 300;
  private readonly cardHeight = 100;
  private readonly cardSpacing = 12;
  private readonly columns = 2;

  // Keyboard navigation state
  private focusZone: FocusZone = 'tabs';
  private selectedTabIndex: number = 0;
  private selectedCardIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private soundManager!: SoundManager;

  constructor() {
    super({ key: 'AchievementScene' });
  }

  create(): void {
    const centerX = GAME_WIDTH / 2;

    fadeIn(this, 200);
    this.soundManager = new SoundManager(this);

    // Reset state
    this.achievementCards = [];
    this.categoryTabs.clear();
    this.scrollY = 0;
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;

    // Dark background
    this.add.rectangle(centerX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a1a2e);

    // Title
    this.add
      .text(centerX, 30, 'ACHIEVEMENTS', {
        fontSize: '36px',
        color: '#44ff88',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Completion percentage display (top right)
    const achievementManager = getAchievementManager();
    const completionPercent = achievementManager.getAchievementCompletionPercent();
    const unlockedCount = achievementManager.getUnlockedAchievements().length;
    const totalCount = ACHIEVEMENTS.length;

    this.add
      .text(GAME_WIDTH - 20, 20, 'COMPLETION:', {
        fontSize: '14px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(1, 0);

    this.add
      .text(GAME_WIDTH - 20, 38, `${unlockedCount}/${totalCount} (${completionPercent}%)`, {
        fontSize: '20px',
        color: '#44ff88',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);

    // Create category tabs
    this.createCategoryTabs();

    // Create scrollable achievement container with mask
    this.createAchievementContainer();

    // Display achievements for default category
    this.displayCategoryAchievements(this.currentCategory);

    // Back button
    this.backButton = this.add
      .text(centerX, GAME_HEIGHT - 30, '[ Back to Menu ]', {
        fontSize: '20px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.backButton.on('pointerover', () => this.backButton.setColor('#ffffff'));
    this.backButton.on('pointerout', () => {
      this.backButton.setColor(this.focusZone === 'back' ? '#ffdd44' : '#888888');
    });
    this.backButton.on('pointerdown', () => {
      this.soundManager.playUIClick();
      fadeOut(this, 150, () => this.scene.start('BootScene'));
    });
    addButtonInteraction(this, this.backButton);

    // Setup scroll input
    this.setupScrollInput();

    // Setup keyboard navigation
    this.setupKeyboardNavigation();

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);
  }

  private createCategoryTabs(): void {
    const tabY = 70;
    const tabHeight = 36;
    const tabSpacing = 8;
    const totalTabs = ACHIEVEMENT_CATEGORIES.length;
    const tabWidth = Math.floor((GAME_WIDTH - 40 - (totalTabs - 1) * tabSpacing) / totalTabs);
    const startX = 20;

    ACHIEVEMENT_CATEGORIES.forEach((category, index) => {
      const tabX = startX + index * (tabWidth + tabSpacing);
      const isSelected = category.id === this.currentCategory;

      const tabContainer = this.add.container(tabX, tabY);

      // Tab background
      const tabBg = this.add.rectangle(
        tabWidth / 2,
        tabHeight / 2,
        tabWidth,
        tabHeight,
        isSelected ? 0x2a5a2a : 0x2a2a4a
      );
      tabBg.setStrokeStyle(2, isSelected ? 0x44ff88 : 0x3a3a5a);
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

      // Count text (showing unlocked/total)
      const categoryAchievements = getAchievementsByCategory(category.id);
      const unlockedInCategory = categoryAchievements.filter(
        (a) => getAchievementManager().getAchievementProgress(a.id)?.isUnlocked
      ).length;
      const countText = this.add.text(
        tabWidth - 8,
        tabHeight / 2,
        `${unlockedInCategory}/${categoryAchievements.length}`,
        {
          fontSize: '12px',
          color: isSelected ? '#44ff88' : '#666666',
          fontFamily: 'Arial',
        }
      );
      countText.setOrigin(1, 0.5);

      tabContainer.add([tabBg, tabIcon, tabText, countText]);
      this.categoryTabs.set(category.id, tabContainer);

      // Click handler
      tabBg.on('pointerdown', () => {
        if (category.id !== this.currentCategory) {
          this.soundManager.playUIClick();
          this.currentCategory = category.id;
          this.selectedTabIndex = index;
          this.selectedCardIndex = 0;
          this.updateTabVisuals();
          this.displayCategoryAchievements(category.id);
        }
      });
    });
  }

  private updateTabVisuals(): void {
    ACHIEVEMENT_CATEGORIES.forEach((category, index) => {
      const container = this.categoryTabs.get(category.id);
      if (!container) return;

      const isSelected = category.id === this.currentCategory;
      const isFocused = this.focusZone === 'tabs' && this.selectedTabIndex === index;
      const tabBg = container.list[0] as Phaser.GameObjects.Rectangle;
      const tabIcon = container.list[1] as Phaser.GameObjects.Image;
      const tabText = container.list[2] as Phaser.GameObjects.Text;
      const countText = container.list[3] as Phaser.GameObjects.Text;

      tabBg.setFillStyle(isSelected ? 0x2a5a2a : 0x2a2a4a);
      if (isFocused) {
        tabBg.setStrokeStyle(3, 0xffdd44);
      } else {
        tabBg.setStrokeStyle(2, isSelected ? 0x44ff88 : 0x3a3a5a);
      }
      tabIcon.setTint(isSelected || isFocused ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED);
      tabText.setColor(isSelected || isFocused ? '#ffffff' : '#888888');
      countText.setColor(isSelected ? '#44ff88' : '#666666');
    });
  }

  private createAchievementContainer(): void {
    const containerY = 120;
    const containerHeight = GAME_HEIGHT - 180;

    // Create container for achievements
    this.achievementContainer = this.add.container(0, containerY);

    // Create mask for scrolling
    const maskGraphics = this.make.graphics({ x: 0, y: 0 });
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, containerY, GAME_WIDTH, containerHeight);
    const mask = maskGraphics.createGeometryMask();
    this.achievementContainer.setMask(mask);
  }

  private displayCategoryAchievements(category: AchievementCategory): void {
    // Clear existing cards
    this.achievementCards.forEach((card) => card.container.destroy());
    this.achievementCards = [];
    this.scrollY = 0;

    const achievements = getAchievementsByCategory(category);

    const startX = (GAME_WIDTH - this.cardWidth * 2 - this.cardSpacing) / 2;
    const startY = 10;

    achievements.forEach((achievement, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (this.cardHeight + this.cardSpacing);

      const card = this.createAchievementCard(achievement, x, y);
      this.achievementCards.push(card);
    });

    // Calculate max scroll
    const totalRows = Math.ceil(achievements.length / this.columns);
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing);
    const viewHeight = GAME_HEIGHT - 180;
    this.maxScrollY = Math.max(0, contentHeight - viewHeight);

    // Update container scroll position
    this.achievementContainer.y = 120 - this.scrollY;
  }

  private createAchievementCard(
    achievement: AchievementDefinition,
    x: number,
    y: number
  ): AchievementCardElements {
    const container = this.add.container(x, y);
    this.achievementContainer.add(container);

    const achievementManager = getAchievementManager();
    const progress = achievementManager.getAchievementProgress(achievement.id);
    const isUnlocked = progress?.isUnlocked ?? false;
    const currentValue = progress?.currentValue ?? 0;
    const progressPercent = Math.min(1, currentValue / achievement.targetValue);

    // Card background
    const bgColor = isUnlocked ? 0x2a5a2a : 0x2a2a4a;
    const borderColor = isUnlocked ? 0x44ff88 : 0x3a3a5a;
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      this.cardHeight / 2,
      this.cardWidth,
      this.cardHeight,
      bgColor
    );
    cardBg.setStrokeStyle(2, borderColor);
    container.add(cardBg);

    // Icon
    try {
      const icon = createIcon(this, {
        x: 30,
        y: this.cardHeight / 2 - 10,
        iconKey: achievement.icon,
        size: 32,
        tint: isUnlocked ? 0x44ff88 : 0x666666,
      });
      container.add(icon);
    } catch {
      // Fallback circle if icon fails
      const fallback = this.add.circle(30, this.cardHeight / 2 - 10, 16, isUnlocked ? 0x44ff88 : 0x666666);
      container.add(fallback);
    }

    // Achievement name
    const nameText = this.add.text(60, 12, achievement.name, {
      fontSize: '16px',
      color: isUnlocked ? '#44ff88' : '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    });
    container.add(nameText);

    // Achievement description
    const descText = this.add.text(60, 32, achievement.description, {
      fontSize: '12px',
      color: '#aaaaaa',
      fontFamily: 'Arial',
      wordWrap: { width: this.cardWidth - 80 },
    });
    container.add(descText);

    // Progress bar background
    const barWidth = this.cardWidth - 80;
    const barHeight = 12;
    const barX = 60;
    const barY = this.cardHeight - 28;

    const progressBg = this.add.rectangle(
      barX + barWidth / 2,
      barY,
      barWidth,
      barHeight,
      0x1a1a2e
    );
    progressBg.setStrokeStyle(1, 0x3a3a5a);
    container.add(progressBg);

    // Progress bar fill
    const fillWidth = Math.max(2, barWidth * progressPercent);
    const progressBar = this.add.rectangle(
      barX + fillWidth / 2,
      barY,
      fillWidth,
      barHeight - 4,
      isUnlocked ? 0x44ff88 : 0x4488ff
    );
    container.add(progressBar);

    // Progress text — right-aligned to stay within card boundary
    const statusText = this.add.text(
      this.cardWidth - 10,
      barY,
      isUnlocked ? '✓' : `${currentValue}/${achievement.targetValue}`,
      {
        fontSize: '11px',
        color: isUnlocked ? '#44ff88' : '#888888',
        fontFamily: 'Arial',
      }
    );
    statusText.setOrigin(1, 0.5);
    container.add(statusText);

    // Reward display
    const rewardText = this.add.text(
      this.cardWidth - 10,
      12,
      this.formatReward(achievement),
      {
        fontSize: '11px',
        color: '#ffcc00',
        fontFamily: 'Arial',
      }
    );
    rewardText.setOrigin(1, 0);
    container.add(rewardText);

    // Secret achievement blur effect (if hidden and not unlocked)
    if (achievement.isSecret && !isUnlocked) {
      const blurOverlay = this.add.rectangle(
        this.cardWidth / 2,
        this.cardHeight / 2,
        this.cardWidth - 4,
        this.cardHeight - 4,
        0x1a1a2e,
        0.9
      );
      container.add(blurOverlay);

      const secretText = this.add.text(this.cardWidth / 2, this.cardHeight / 2, '? SECRET ?', {
        fontSize: '16px',
        color: '#666666',
        fontFamily: 'Arial',
        fontStyle: 'italic',
      });
      secretText.setOrigin(0.5);
      container.add(secretText);
    }

    return {
      container,
      cardBg,
      progressBar,
      progressBg,
      statusText,
      achievement,
    };
  }

  private formatReward(achievement: AchievementDefinition): string {
    const reward = achievement.reward;
    switch (reward.type) {
      case 'gold':
        return `🪙 ${reward.value}`;
      case 'unlock':
        return `🔓 ${reward.description}`;
      default:
        return '';
    }
  }

  private setupScrollInput(): void {
    // Mouse wheel scrolling
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY * 0.5, 0, this.maxScrollY);
      this.achievementContainer.y = 120 - this.scrollY;
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
        this.achievementContainer.y = 120 - this.scrollY;
        lastY = pointer.y;
      }
    });
  }

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

  private navigateDown(): void {
    if (this.focusZone === 'tabs') {
      if (this.achievementCards.length > 0) {
        this.focusZone = 'grid';
        this.selectedCardIndex = 0;
        this.ensureCardVisible();
      } else {
        this.focusZone = 'back';
      }
    } else if (this.focusZone === 'grid') {
      const totalCards = this.achievementCards.length;
      const currentRow = Math.floor(this.selectedCardIndex / this.columns);
      const totalRows = Math.ceil(totalCards / this.columns);

      if (currentRow < totalRows - 1) {
        const newIndex = this.selectedCardIndex + this.columns;
        this.selectedCardIndex = Math.min(newIndex, totalCards - 1);
        this.ensureCardVisible();
      } else {
        this.focusZone = 'back';
      }
    } else if (this.focusZone === 'back') {
      this.focusZone = 'tabs';
    }
    this.updateFocusVisuals();
  }

  private navigateUp(): void {
    if (this.focusZone === 'tabs') {
      this.focusZone = 'back';
    } else if (this.focusZone === 'grid') {
      const currentRow = Math.floor(this.selectedCardIndex / this.columns);

      if (currentRow > 0) {
        this.selectedCardIndex -= this.columns;
        this.ensureCardVisible();
      } else {
        this.focusZone = 'tabs';
      }
    } else if (this.focusZone === 'back') {
      if (this.achievementCards.length > 0) {
        this.focusZone = 'grid';
        const totalCards = this.achievementCards.length;
        const totalRows = Math.ceil(totalCards / this.columns);
        const lastRowStart = (totalRows - 1) * this.columns;
        this.selectedCardIndex = Math.min(lastRowStart, totalCards - 1);
        this.ensureCardVisible();
      } else {
        this.focusZone = 'tabs';
      }
    }
    this.updateFocusVisuals();
  }

  private navigateLeft(): void {
    if (this.focusZone === 'tabs') {
      this.selectedTabIndex = Math.max(0, this.selectedTabIndex - 1);
      this.selectCategoryByIndex(this.selectedTabIndex);
    } else if (this.focusZone === 'grid') {
      const currentCol = this.selectedCardIndex % this.columns;
      if (currentCol > 0) {
        this.selectedCardIndex--;
      } else {
        const currentRow = Math.floor(this.selectedCardIndex / this.columns);
        const rowEnd = Math.min((currentRow + 1) * this.columns - 1, this.achievementCards.length - 1);
        this.selectedCardIndex = rowEnd;
      }
    }
    this.updateFocusVisuals();
  }

  private navigateRight(): void {
    if (this.focusZone === 'tabs') {
      this.selectedTabIndex = Math.min(ACHIEVEMENT_CATEGORIES.length - 1, this.selectedTabIndex + 1);
      this.selectCategoryByIndex(this.selectedTabIndex);
    } else if (this.focusZone === 'grid') {
      const currentCol = this.selectedCardIndex % this.columns;
      const currentRow = Math.floor(this.selectedCardIndex / this.columns);
      const rowStart = currentRow * this.columns;

      if (currentCol < this.columns - 1 && this.selectedCardIndex < this.achievementCards.length - 1) {
        this.selectedCardIndex++;
      } else {
        this.selectedCardIndex = rowStart;
      }
    }
    this.updateFocusVisuals();
  }

  private selectCategoryByIndex(tabIndex: number): void {
    const category = ACHIEVEMENT_CATEGORIES[tabIndex];
    if (category && category.id !== this.currentCategory) {
      this.currentCategory = category.id;
      this.selectedCardIndex = 0;
      this.displayCategoryAchievements(category.id);
    }
  }

  private activateCurrentSelection(): void {
    if (this.focusZone === 'tabs') {
      this.selectCategoryByIndex(this.selectedTabIndex);
      this.updateFocusVisuals();
    } else if (this.focusZone === 'back') {
      this.scene.start('BootScene');
    }
  }

  private ensureCardVisible(): void {
    const row = Math.floor(this.selectedCardIndex / this.columns);
    const cardTopInContainer = 10 + row * (this.cardHeight + this.cardSpacing);
    const cardBottomInContainer = cardTopInContainer + this.cardHeight;
    const viewHeight = GAME_HEIGHT - 180;

    if (cardTopInContainer < this.scrollY) {
      this.scrollY = cardTopInContainer;
    } else if (cardBottomInContainer > this.scrollY + viewHeight) {
      this.scrollY = cardBottomInContainer - viewHeight;
    }

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScrollY);
    this.achievementContainer.y = 120 - this.scrollY;
  }

  private updateFocusVisuals(): void {
    // Update tab visuals (handles both selected and focus states)
    this.updateTabVisuals();

    // Update card visuals
    this.achievementCards.forEach((card, index) => {
      const isFocused = this.focusZone === 'grid' && this.selectedCardIndex === index;
      const isUnlocked = getAchievementManager().getAchievementProgress(card.achievement.id)?.isUnlocked ?? false;

      if (isFocused) {
        card.cardBg.setStrokeStyle(3, 0xffdd44);
      } else {
        card.cardBg.setStrokeStyle(2, isUnlocked ? 0x44ff88 : 0x3a3a5a);
      }
    });

    // Update back button
    this.backButton.setColor(this.focusZone === 'back' ? '#ffdd44' : '#888888');
  }

  shutdown(): void {
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.tweens.killAll();
  }
}
