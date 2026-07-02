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
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';
import { transitionToScene, sweepIn, staggerEntrance } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { ACCENT_COLORS_STR, TEXT_COLORS } from '../../visual/MenuStyle';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';

// Achievement categories with display names and icons
const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; name: string; icon: string }[] = [
  { id: 'combat', name: 'Combat', icon: 'sword' },
  { id: 'survival', name: 'Survival', icon: 'heart' },
  { id: 'progression', name: 'Progression', icon: 'star' },
  { id: 'challenge', name: 'Challenge', icon: 'trophy' },
];

const FONT_FAMILY = '"Atkinson Hyperlegible", Arial, sans-serif';

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

  // Grid constants
  private readonly cardWidth = 360;
  private readonly cardHeight = 115;
  private readonly cardSpacing = 14;
  private readonly columns = 2;

  // Keyboard + gamepad navigation state
  private focusZone: FocusZone = 'tabs';
  private selectedTabIndex: number = 0;
  private selectedCardIndex: number = 0;
  private menuNavigator: MenuNavigator | null = null;
  private soundManager!: SoundManager;
  private menuBackground: MenuBackground | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private backButton: MenuButton | null = null;

  constructor() {
    super({ key: 'AchievementScene' });
  }

  create(): void {
    const centerX = this.scale.width / 2;

    this.soundManager = new SoundManager(this);

    // Reset state
    this.achievementCards = [];
    this.categoryTabs.clear();
    this.scrollY = 0;
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;

    // Retroactively claim any unlocked-but-unclaimed achievement rewards
    const unclaimedAchievements = getAchievementManager().getUnclaimedRewards();
    if (unclaimedAchievements.length > 0) {
      let totalGoldClaimed = 0;
      const metaManager = getMetaProgressionManager();
      for (const achievement of unclaimedAchievements) {
        const reward = getAchievementManager().claimAchievementReward(achievement.id);
        if (reward) {
          if (reward.type === 'gold') {
            totalGoldClaimed += reward.value;
            metaManager.addGold(reward.value);
          } else if (reward.type === 'stat_bonus' && reward.statBonusId) {
            metaManager.addAchievementBonus(reward.statBonusId, reward.value);
          }
        }
        // Also claim bonus reward if present
        if (achievement.bonusReward) {
          if (achievement.bonusReward.type === 'stat_bonus' && achievement.bonusReward.statBonusId) {
            metaManager.addAchievementBonus(achievement.bonusReward.statBonusId, achievement.bonusReward.value);
          }
        }
      }
      if (totalGoldClaimed > 0) {
        // Show brief notification about retroactive claims (will be visible at top of scene)
        console.log(`Retroactively claimed ${totalGoldClaimed} gold from ${unclaimedAchievements.length} achievements`);
      }
    }

    // Menu backdrop.
    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (_time, delta) => {
      this.menuBackground?.update(delta);
      this.backButton?.tickIdle(_time / 1000);
    };
    this.events.on('update', this.bgUpdateHandler);

    // Title heading.
    const title = makeDisplayText(this, centerX, 36, 'ACHIEVEMENTS', {
      fontSize: 32,
      color: ACCENT_COLORS_STR.safe,
      strokeWidth: 5,
      letterSpacing: 4,
    });

    // Completion percentage display (top right).
    const achievementManager = getAchievementManager();
    const completionPercent = achievementManager.getAchievementCompletionPercent();
    const unlockedCount = achievementManager.getUnlockedAchievements().length;
    const totalCount = ACHIEVEMENTS.length;

    const completionLabel = makeBodyText(this, this.scale.width - 20, 22, 'COMPLETION', {
      fontSize: 11,
      color: TEXT_COLORS.muted,
    });
    completionLabel.setOrigin(1, 0);

    const completionValue = makeDisplayText(this, this.scale.width - 20, 44,
      `${unlockedCount} / ${totalCount}  ·  ${completionPercent}%`, {
        fontSize: 16,
        color: ACCENT_COLORS_STR.safe,
        letterSpacing: 1,
      });
    completionValue.setOrigin(1, 0.5);

    // Create category tabs
    this.createCategoryTabs();

    // Create scrollable achievement container with mask
    this.createAchievementContainer();

    // Display achievements for default category
    this.displayCategoryAchievements(this.currentCategory);

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
    this.backButton.card.hitZone.on('pointerover', () => this.backButton!.setHoverState(true));
    this.backButton.card.hitZone.on('pointerout', () => this.backButton!.setHoverState(false));


    // Setup scroll input
    this.setupScrollInput();

    // Setup keyboard + gamepad navigation
    this.buildMenuNavigator();

    // Entrance choreography: title + completion first, tabs next, then the
    // card list rises in as one block (rows scroll inside the mask).
    staggerEntrance(this, [
      title,
      completionLabel,
      completionValue,
      ...this.categoryTabs.values(),
      this.achievementContainer,
      this.backButton.container,
    ]);
    sweepIn(this);

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);
  }

  /**
   * Keyboard + gamepad navigation. The vertical item list mirrors the visual
   * layout: [tabs row (left/right moves between categories)] +
   * [one item per card row (left/right moves within the row)] + [back].
   * Rebuilt whenever the category changes (card count differs).
   */
  private buildMenuNavigator(): void {
    this.menuNavigator?.destroy();

    const navigableItems: NavigableItem[] = [];

    navigableItems.push({
      onFocus: () => {
        this.focusZone = 'tabs';
        this.updateFocusVisuals();
      },
      onBlur: () => this.updateFocusVisuals(),
      onActivate: () => {
        this.selectCategoryByIndex(this.selectedTabIndex);
        this.updateFocusVisuals();
      },
      onLeft: () => {
        this.selectedTabIndex = Math.max(0, this.selectedTabIndex - 1);
        this.selectCategoryByIndex(this.selectedTabIndex);
        this.updateFocusVisuals();
      },
      onRight: () => {
        this.selectedTabIndex = Math.min(ACHIEVEMENT_CATEGORIES.length - 1, this.selectedTabIndex + 1);
        this.selectCategoryByIndex(this.selectedTabIndex);
        this.updateFocusVisuals();
      },
    });

    const totalCards = this.achievementCards.length;
    const totalRows = Math.ceil(totalCards / this.columns);
    for (let row = 0; row < totalRows; row++) {
      const rowStart = row * this.columns;
      const rowEnd = Math.min(rowStart + this.columns - 1, totalCards - 1);
      navigableItems.push({
        onFocus: () => {
          this.focusZone = 'grid';
          const preferredCol = this.selectedCardIndex % this.columns;
          this.selectedCardIndex = Math.min(rowStart + preferredCol, rowEnd);
          this.ensureCardVisible();
          this.updateFocusVisuals();
        },
        onBlur: () => this.updateFocusVisuals(),
        onActivate: () => {
          // Achievement cards are informational only.
        },
        onLeft: () => {
          const col = this.selectedCardIndex % this.columns;
          this.selectedCardIndex = col > 0 ? this.selectedCardIndex - 1 : rowEnd;
          this.updateFocusVisuals();
        },
        onRight: () => {
          const col = this.selectedCardIndex % this.columns;
          this.selectedCardIndex =
            col < this.columns - 1 && this.selectedCardIndex < rowEnd
              ? this.selectedCardIndex + 1
              : rowStart;
          this.updateFocusVisuals();
        },
      });
    }

    navigableItems.push({
      onFocus: () => {
        this.focusZone = 'back';
        this.updateFocusVisuals();
      },
      onBlur: () => this.updateFocusVisuals(),
      onActivate: () => {
        this.soundManager.playUIClick();
        transitionToScene(this, 'BootScene');
      },
    });

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: 1,
      wrap: true,
      onCancel: () => {
        transitionToScene(this, 'BootScene');
      },
    });
  }

  private createCategoryTabs(): void {
    const tabY = 70;
    const tabHeight = 36;
    const tabSpacing = 8;
    const totalTabs = ACHIEVEMENT_CATEGORIES.length;
    const tabWidth = Math.floor((this.scale.width - 40 - (totalTabs - 1) * tabSpacing) / totalTabs);
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
        fontFamily: FONT_FAMILY,
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
          fontFamily: FONT_FAMILY,
        }
      );
      countText.setOrigin(1, 0.5);

      tabContainer.add([tabBg, tabIcon, tabText, countText]);
      this.categoryTabs.set(category.id, tabContainer);

      // Click handler
      tabBg.on('pointerdown', () => {
        if (category.id !== this.currentCategory) {
          this.soundManager.playUIClick();
          this.selectedTabIndex = index;
          this.selectCategoryByIndex(index);
          this.updateTabVisuals();
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
    const containerHeight = this.scale.height - 180;

    // Create container for achievements
    this.achievementContainer = this.add.container(0, containerY);

    // Create mask for scrolling
    const maskGraphics = this.make.graphics({ x: 0, y: 0 });
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, containerY, this.scale.width, containerHeight);
    const mask = maskGraphics.createGeometryMask();
    this.achievementContainer.setMask(mask);
  }

  private displayCategoryAchievements(category: AchievementCategory): void {
    // Clear existing cards
    this.achievementCards.forEach((card) => card.container.destroy());
    this.achievementCards = [];
    this.scrollY = 0;

    const achievements = getAchievementsByCategory(category);

    const startX = (this.scale.width - this.cardWidth * 2 - this.cardSpacing) / 2;
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
    const viewHeight = this.scale.height - 180;
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

    // Icon background disc
    const iconCenterX = 35;
    const iconCenterY = this.cardHeight / 2 - 8;
    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 22, isUnlocked ? 0x1a4a2a : 0x1a1a3a);
    iconDisc.setStrokeStyle(2, isUnlocked ? 0x44ff88 : 0x3a3a5a);
    container.add(iconDisc);

    // Icon
    try {
      const icon = createIcon(this, {
        x: iconCenterX,
        y: iconCenterY,
        iconKey: achievement.icon,
        size: 28,
        tint: isUnlocked ? 0x44ff88 : 0x666666,
      });
      container.add(icon);
    } catch {
      const fallback = this.add.circle(iconCenterX, iconCenterY, 14, isUnlocked ? 0x44ff88 : 0x666666);
      container.add(fallback);
    }

    // Achievement name
    const nameText = this.add.text(70, 14, achievement.name, {
      fontSize: '16px',
      color: isUnlocked ? '#44ff88' : '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    // Achievement description
    const descText = this.add.text(70, 36, achievement.description, {
      fontSize: '13px',
      color: '#aaaaaa',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - 90 },
    });
    container.add(descText);

    // Progress bar background
    const barWidth = this.cardWidth - 90;
    const barHeight = 16;
    const barX = 70;
    const barY = this.cardHeight - 28;

    const progressBg = this.add.rectangle(
      barX + barWidth / 2,
      barY,
      barWidth,
      barHeight,
      0x111122
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

    // Progress text — right-aligned within the bar area
    const progressLabel = isUnlocked
      ? 'COMPLETE'
      : `${currentValue}/${achievement.targetValue}`;
    const statusText = this.add.text(
      barX + barWidth - 6,
      barY,
      progressLabel,
      {
        fontSize: '10px',
        color: isUnlocked ? '#ffffff' : '#aaaaaa',
        fontFamily: FONT_FAMILY,
        fontStyle: isUnlocked ? 'bold' : 'normal',
      }
    );
    statusText.setOrigin(1, 0.5);
    container.add(statusText);

    // Reward display with gold coin icon + background pill
    const rewardValue = this.getRewardValue(achievement);
    const rewardLabel = rewardValue.text;
    const rewardText = this.add.text(0, 0, rewardLabel, {
      fontSize: '12px',
      color: '#ffcc00',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    const coinSize = 14;
    const coinGap = 4;
    const rewardPillWidth = coinSize + coinGap + rewardText.width + 14;
    const rewardPillHeight = 22;
    const rewardPillX = this.cardWidth - 10 - rewardPillWidth / 2;
    const rewardPillY = 16;
    const rewardPill = this.add.rectangle(
      rewardPillX,
      rewardPillY,
      rewardPillWidth,
      rewardPillHeight,
      0x3a3a1a
    );
    rewardPill.setStrokeStyle(1, 0x666622);
    container.add(rewardPill);

    // Gold coin circle
    const coinX = rewardPillX - rewardPillWidth / 2 + 7 + coinSize / 2;
    const coinCircle = this.add.circle(coinX, rewardPillY, coinSize / 2, 0xffcc00);
    coinCircle.setStrokeStyle(1, 0xaa8800);
    container.add(coinCircle);

    rewardText.setPosition(coinX + coinSize / 2 + coinGap, rewardPillY);
    rewardText.setOrigin(0, 0.5);
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
        color: '#99aabb',
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
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

  private getRewardValue(achievement: AchievementDefinition): { text: string; type: string } {
    const reward = achievement.reward;
    switch (reward.type) {
      case 'gold':
        return { text: `${reward.value}`, type: 'gold' };
      case 'unlock':
        return { text: reward.description ?? 'Unlock', type: 'unlock' };
      default:
        return { text: '', type: '' };
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
      if (pointer.isDown && pointer.y > 120 && pointer.y < this.scale.height - 60) {
        const deltaY = lastY - pointer.y;
        this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY, 0, this.maxScrollY);
        this.achievementContainer.y = 120 - this.scrollY;
        lastY = pointer.y;
      }
    });
  }

  private selectCategoryByIndex(tabIndex: number): void {
    const category = ACHIEVEMENT_CATEGORIES[tabIndex];
    if (category && category.id !== this.currentCategory) {
      this.currentCategory = category.id;
      this.selectedCardIndex = 0;
      this.displayCategoryAchievements(category.id);
      // Card-row count changed — rebuild the navigator (focus returns to tabs).
      this.buildMenuNavigator();
    }
  }

  private ensureCardVisible(): void {
    const row = Math.floor(this.selectedCardIndex / this.columns);
    const cardTopInContainer = 10 + row * (this.cardHeight + this.cardSpacing);
    const cardBottomInContainer = cardTopInContainer + this.cardHeight;
    const viewHeight = this.scale.height - 180;

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

    // Back button focus pop.
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
