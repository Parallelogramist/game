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
import { syncEndgameAchievements } from '../../achievements/endgameSync';
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';
import { transitionToScene, sweepIn, staggerEntrance } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import {
  computeScrollViewMetrics,
  fitTextWidth,
  resolveMenuFontScale,
  scaledFontPx,
  scaledInt,
} from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';
import { ACCENT_COLORS_STR, TEXT_COLORS } from '../../visual/MenuStyle';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import {
  getDailyQuestBoard,
  getDailyQuestCompletionCount,
  claimDailyQuestGold,
} from '../../meta/DailyQuestManager';
import { DAILY_QUEST_COUNT, formatQuestValue, type DailyQuestDefinition } from '../../data/DailyQuests';
import {
  getHiddenUnlockManager,
  type HiddenUnlockTarget,
  type VaultEntry,
} from '../../meta/HiddenUnlocks';

// Achievement categories with display names and icons
const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; name: string; icon: string }[] = [
  { id: 'combat', name: 'Combat', icon: 'sword' },
  { id: 'survival', name: 'Survival', icon: 'heart' },
  { id: 'progression', name: 'Progression', icon: 'star' },
  { id: 'challenge', name: 'Challenge', icon: 'trophy' },
  { id: 'mastery', name: 'Mastery', icon: 'crown' },
];

/** Tab id space = the achievement categories, the daily quest board, and the unlock vault.
 *  Daily and Vault are last so the default landing tab stays 'combat'. */
type TabId = AchievementCategory | 'daily' | 'unlocks';

const TAB_DEFS: { id: TabId; name: string; icon: string }[] = [
  ...ACHIEVEMENT_CATEGORIES,
  { id: 'daily', name: 'Daily', icon: 'clipboard' },
  { id: 'unlocks', name: 'Vault', icon: 'gem' },
];

const FONT_FAMILY = '"Atkinson Hyperlegible", Arial, sans-serif';

const VAULT_TARGET_META: Record<HiddenUnlockTarget, { icon: string; label: string; tint: number }> = {
  weapon: { icon: 'sword', label: 'WEAPON', tint: 0xff8866 },
  ship: { icon: 'rocket', label: 'SHIP', tint: 0x66bbff },
  cosmetic: { icon: 'sparkle', label: 'COSMETIC', tint: 0xcc88ff },
  stage: { icon: 'planet', label: 'STAGE', tint: 0x66ddcc },
};

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
  private currentCategory: TabId = 'combat';
  private categoryTabs: Map<TabId, Phaser.GameObjects.Container> = new Map();
  /** Quest cards live in the same masked container; tracked separately so a tab
   *  switch destroys them and the navigator's grid rows stay achievement-only. */
  private questCards: Phaser.GameObjects.Container[] = [];
  /** Vault cards live in the same masked container as quest cards; the bg is retained so
   *  the navigator can highlight the focused row. */
  private vaultCards: { container: Phaser.GameObjects.Container; cardBg: Phaser.GameObjects.Rectangle; earned: boolean }[] = [];
  private achievementContainer!: Phaser.GameObjects.Container;
  private scrollY: number = 0;
  private maxScrollY: number = 0;

  // Grid constants
  private readonly cardWidth = 360;
  private readonly cardHeight = 115;
  private readonly cardSpacing = 14;
  /** 2 on wide viewports; 1 when two 360px cards can't fit (portrait 720). */
  private columns = 2;
  /** Density compensation for this viewport; exactly 1 on every desktop viewport. */
  private menuScale = 1;
  private scrollBandTop = 0;
  private scrollBandHeight = 0;
  /** The canvas width in the scaled content container's own units. */
  private contentSpaceWidth = 0;

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
    this.menuScale = resolveMenuFontScale(
      this.scale.width, this.scale.height, getSettingsManager().getUiScale(),
    );
    const scrollView = computeScrollViewMetrics(
      this.scale.width, this.scale.height, this.menuScale,
    );
    this.scrollBandTop = scrollView.top;
    this.scrollBandHeight = scrollView.height;
    this.contentSpaceWidth = scrollView.contentWidth;

    // Two-column grid needs 360×2+14 = 734 plus margins, measured in the scaled
    // container's own units; portrait drops to a single centered column — rows
    // scroll, so height is free.
    this.columns = this.contentSpaceWidth < this.cardWidth * 2 + this.cardSpacing + 32 ? 1 : 2;

    this.soundManager = new SoundManager(this);

    // Reset state
    this.achievementCards = [];
    this.questCards = [];
    this.vaultCards = [];
    this.categoryTabs.clear();
    this.scrollY = 0;
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;

    // Replay the endgame records into achievement progress before claiming, so
    // a profile that cleared this content pre-update is credited on this visit.
    // Detaching first is load-bearing: GameScene leaves its run-context unlock
    // closure wired, and a sync unlock must not fire into that dead scene — with
    // no callback the unlock stays unclaimed and the pass below pays it out.
    getAchievementManager().setAchievementUnlockCallback(null);
    syncEndgameAchievements();

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

    // Pay out gold banked by completed daily quests, mirroring the retroactive
    // achievement claim above — the run-end path only records progress.
    const questGold = claimDailyQuestGold();
    if (questGold > 0) {
      getMetaProgressionManager().addGold(questGold);
    }

    // Menu backdrop.
    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (_time, delta) => {
      this.menuBackground?.update(delta);
      this.backButton?.tickIdle(_time / 1000);
    };
    this.events.on('update', this.bgUpdateHandler);

    // Title heading.
    const title = makeDisplayText(this, centerX, scaledInt(this.menuScale, 36), 'ACHIEVEMENTS', {
      fontSize: scaledInt(this.menuScale, 32),
      color: ACCENT_COLORS_STR.safe,
      strokeWidth: scaledInt(this.menuScale, 5),
      letterSpacing: 4 * this.menuScale,
    });
    fitTextWidth(title, this.scale.width - 24);

    // Completion percentage display (top right).
    const achievementManager = getAchievementManager();
    const completionPercent = achievementManager.getAchievementCompletionPercent();
    const unlockedCount = achievementManager.getUnlockedAchievements().length;
    const totalCount = ACHIEVEMENTS.length;

    const completionLabel = makeBodyText(this, this.scale.width - scaledInt(this.menuScale, 20),
      scaledInt(this.menuScale, 22), 'COMPLETION', {
        fontSize: scaledInt(this.menuScale, 11),
        color: TEXT_COLORS.muted,
      });
    completionLabel.setOrigin(1, 0);

    const completionValue = makeDisplayText(this, this.scale.width - scaledInt(this.menuScale, 20),
      scaledInt(this.menuScale, 44),
      `${unlockedCount} / ${totalCount}  ·  ${completionPercent}%`, {
        fontSize: scaledInt(this.menuScale, 16),
        color: ACCENT_COLORS_STR.safe,
        letterSpacing: 1 * this.menuScale,
      });
    completionValue.setOrigin(1, 0.5);

    // Create category tabs
    this.createCategoryTabs();

    // Create scrollable achievement container with mask
    this.createAchievementContainer();

    // Display achievements for default category
    this.displayTab(this.currentCategory);

    // Back button.
    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: this.scale.height - scaledInt(this.menuScale, 36),
      width: scaledInt(this.menuScale, 220),
      height: scaledInt(this.menuScale, 44),
      label: '← BACK TO MENU',
      variant: 'neutral',
      fontSize: scaledInt(this.menuScale, 14),
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
        this.selectedTabIndex = Math.min(TAB_DEFS.length - 1, this.selectedTabIndex + 1);
        this.selectCategoryByIndex(this.selectedTabIndex);
        this.updateFocusVisuals();
      },
    });

    // Exactly one card list is populated per tab; quest cards deliberately register no rows
    // (3 cards never scroll), vault cards do (23 cards scroll past the mask).
    const totalCards = this.achievementCards.length + this.vaultCards.length;
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
    const tabY = scaledInt(this.menuScale, 70);
    const tabHeight = scaledInt(this.menuScale, 36);
    const tabSpacing = scaledInt(this.menuScale, 8);
    const totalTabs = TAB_DEFS.length;
    const tabWidth = Math.floor((this.scale.width - 40 - (totalTabs - 1) * tabSpacing) / totalTabs);
    const startX = 20;
    const tabFontPx = scaledFontPx(this.menuScale, totalTabs >= 6 ? 12 : 14);
    const countFontPx = scaledFontPx(this.menuScale, totalTabs >= 6 ? 10 : 12);

    TAB_DEFS.forEach((category, index) => {
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
        x: scaledInt(this.menuScale, 14),
        y: tabHeight / 2,
        iconKey: category.icon,
        size: scaledInt(this.menuScale, 16),
        tint: isSelected ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED,
      });

      // Tab text
      const tabText = this.add.text(
        (tabWidth + scaledInt(this.menuScale, 28)) / 2, tabHeight / 2, category.name, {
          fontSize: tabFontPx,
          color: isSelected ? '#ffffff' : '#888888',
          fontFamily: FONT_FAMILY,
        });
      tabText.setOrigin(0.5);
      fitTextWidth(tabText, tabWidth - scaledInt(this.menuScale, 28) - 10);

      // Count text (showing unlocked/total)
      let countLabel: string;
      if (category.id === 'daily') {
        countLabel = `${getDailyQuestCompletionCount()}/${DAILY_QUEST_COUNT}`;
      } else if (category.id === 'unlocks') {
        const vaultEntries = getHiddenUnlockManager().getVaultEntries();
        const earnedCount = vaultEntries.filter((entry) => entry.unlockedAt !== null).length;
        countLabel = `${earnedCount}/${vaultEntries.length}`;
      } else {
        const categoryAchievements = getAchievementsByCategory(category.id);
        const unlockedInCategory = categoryAchievements.filter(
          (a) => getAchievementManager().getAchievementProgress(a.id)?.isUnlocked
        ).length;
        countLabel = `${unlockedInCategory}/${categoryAchievements.length}`;
      }
      const countText = this.add.text(
        tabWidth - scaledInt(this.menuScale, 8),
        tabHeight / 2,
        countLabel,
        {
          fontSize: countFontPx,
          color: isSelected ? '#44ff88' : '#666666',
          fontFamily: FONT_FAMILY,
        }
      );
      countText.setOrigin(1, 0.5);

      // 34 = the 28-unit icon gutter the name is centred against, plus a 6-unit gap.
      if (tabText.width + countText.width + scaledInt(this.menuScale, 34) > tabWidth) countText.setVisible(false);

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
    TAB_DEFS.forEach((category, index) => {
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
    this.achievementContainer = this.add.container(0, this.scrollBandTop);
    this.achievementContainer.setScale(this.menuScale);

    const maskGraphics = this.make.graphics({ x: 0, y: 0 });
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, this.scrollBandTop, this.scale.width, this.scrollBandHeight);
    const mask = maskGraphics.createGeometryMask();
    this.achievementContainer.setMask(mask);
  }

  /** Destroys whatever the previous tab rendered and resets the scroll. Every display
   *  method starts here, so a new card kind can never be left behind by a tab switch. */
  private clearTabCards(): void {
    this.achievementCards.forEach((card) => card.container.destroy());
    this.achievementCards = [];
    this.questCards.forEach((card) => card.destroy());
    this.questCards = [];
    this.vaultCards.forEach((card) => card.container.destroy());
    this.vaultCards = [];
    this.scrollY = 0;
  }

  private displayCategoryAchievements(category: AchievementCategory): void {
    this.clearTabCards();

    const achievements = getAchievementsByCategory(category);

    const gridWidth = this.cardWidth * this.columns + this.cardSpacing * (this.columns - 1);
    const startX = (this.contentSpaceWidth - gridWidth) / 2;
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
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing) * this.menuScale;
    this.maxScrollY = Math.max(0, contentHeight - this.scrollBandHeight);
    this.achievementContainer.y = this.scrollBandTop - this.scrollY;
  }

  /**
   * Renders today's quest board into the same masked, scrollable container the
   * achievement grid uses. `achievementCards` is left empty on purpose: quest
   * cards are informational (achievement cards are too — their onActivate is a
   * no-op), so the navigator collapses to [tabs, back] and the scroll/focus code
   * is untouched.
   */
  private displayDailyQuests(): void {
    this.clearTabCards();

    const board = getDailyQuestBoard();
    const gridWidth = this.cardWidth * this.columns + this.cardSpacing * (this.columns - 1);
    const startX = (this.contentSpaceWidth - gridWidth) / 2;
    const startY = 10;

    board.forEach((entry, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (this.cardHeight + this.cardSpacing);
      this.questCards.push(this.createQuestCard(entry.quest, entry.value, entry.complete, x, y));
    });

    const totalRows = Math.ceil(board.length / this.columns);
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing) * this.menuScale;
    this.maxScrollY = Math.max(0, contentHeight - this.scrollBandHeight);
    this.achievementContainer.y = this.scrollBandTop - this.scrollY;
  }

  /**
   * Renders every hidden unlock into the same masked, scrollable container. Unlike the
   * quest tab, these cards DO register navigator rows (see buildMenuNavigator) — 23 entries
   * scroll past the mask, so a keyboard/gamepad player needs row focus to reach the bottom.
   */
  private displayUnlockVault(): void {
    this.clearTabCards();

    const entries = getHiddenUnlockManager().getVaultEntries();
    const gridWidth = this.cardWidth * this.columns + this.cardSpacing * (this.columns - 1);
    const startX = (this.contentSpaceWidth - gridWidth) / 2;
    const startY = 10;

    entries.forEach((entry, index) => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      const x = startX + col * (this.cardWidth + this.cardSpacing);
      const y = startY + row * (this.cardHeight + this.cardSpacing);
      this.vaultCards.push(this.createVaultCard(entry, x, y));
    });

    const totalRows = Math.ceil(entries.length / this.columns);
    const contentHeight = totalRows * (this.cardHeight + this.cardSpacing) * this.menuScale;
    this.maxScrollY = Math.max(0, contentHeight - this.scrollBandHeight);
    this.achievementContainer.y = this.scrollBandTop - this.scrollY;
  }

  private createQuestCard(
    quest: DailyQuestDefinition,
    value: number,
    complete: boolean,
    x: number,
    y: number
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    this.achievementContainer.add(container);

    const bgColor = complete ? 0x2a5a2a : 0x2a2a4a;
    const borderColor = complete ? 0x44ff88 : 0x3a3a5a;
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      this.cardHeight / 2,
      this.cardWidth,
      this.cardHeight,
      bgColor
    );
    cardBg.setStrokeStyle(2, borderColor);
    container.add(cardBg);

    const iconCenterX = 35;
    const iconCenterY = this.cardHeight / 2 - 8;
    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 22, complete ? 0x1a4a2a : 0x1a1a3a);
    iconDisc.setStrokeStyle(2, borderColor);
    container.add(iconDisc);

    try {
      container.add(
        createIcon(this, {
          x: iconCenterX,
          y: iconCenterY,
          iconKey: quest.icon,
          size: 28,
          tint: complete ? 0x44ff88 : 0x666666,
        })
      );
    } catch {
      container.add(this.add.circle(iconCenterX, iconCenterY, 14, complete ? 0x44ff88 : 0x666666));
    }

    const nameText = this.add.text(70, 14, quest.name, {
      fontSize: '16px',
      color: complete ? '#44ff88' : '#ffffff',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const descText = this.add.text(70, 36, quest.description, {
      fontSize: '13px',
      color: '#aaaaaa',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - 90 },
    });
    container.add(descText);

    const barWidth = this.cardWidth - 90;
    const barHeight = 16;
    const barX = 70;
    const barY = this.cardHeight - 28;

    const progressBg = this.add.rectangle(barX + barWidth / 2, barY, barWidth, barHeight, 0x111122);
    progressBg.setStrokeStyle(1, 0x3a3a5a);
    container.add(progressBg);

    const percent = Math.min(1, quest.target > 0 ? value / quest.target : 1);
    const fillWidth = Math.max(2, barWidth * percent);
    container.add(
      this.add.rectangle(
        barX + fillWidth / 2,
        barY,
        fillWidth,
        barHeight - 4,
        complete ? 0x44ff88 : 0x4488ff
      )
    );

    const statusText = this.add.text(
      barX + barWidth - 6,
      barY,
      complete
        ? 'COMPLETE'
        : `${formatQuestValue(quest, value)}/${formatQuestValue(quest, quest.target)}`,
      {
        fontSize: '10px',
        color: complete ? '#ffffff' : '#aaaaaa',
        fontFamily: FONT_FAMILY,
        fontStyle: complete ? 'bold' : 'normal',
      }
    );
    statusText.setOrigin(1, 0.5);
    container.add(statusText);

    const rewardText = this.add.text(this.cardWidth - 10, 16, `+${quest.gold}`, {
      fontSize: '12px',
      color: '#ffcc00',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    rewardText.setOrigin(1, 0.5);
    container.add(rewardText);

    return container;
  }

  private createVaultCard(
    entry: VaultEntry,
    x: number,
    y: number
  ): { container: Phaser.GameObjects.Container; cardBg: Phaser.GameObjects.Rectangle; earned: boolean } {
    const earned = entry.unlockedAt !== null;
    const meta = VAULT_TARGET_META[entry.condition.target];

    const container = this.add.container(x, y);
    this.achievementContainer.add(container);

    const bgColor = earned ? 0x2a5a2a : 0x2a2a4a;
    const borderColor = earned ? 0x44ff88 : 0x3a3a5a;
    const cardBg = this.add.rectangle(
      this.cardWidth / 2,
      this.cardHeight / 2,
      this.cardWidth,
      this.cardHeight,
      bgColor
    );
    cardBg.setStrokeStyle(2, borderColor);
    container.add(cardBg);

    const iconCenterX = 35;
    const iconCenterY = this.cardHeight / 2 - 8;
    const iconDisc = this.add.circle(iconCenterX, iconCenterY, 22, earned ? 0x1a4a2a : 0x1a1a3a);
    iconDisc.setStrokeStyle(2, borderColor);
    container.add(iconDisc);

    try {
      container.add(
        createIcon(this, {
          x: iconCenterX,
          y: iconCenterY,
          iconKey: meta.icon,
          size: 28,
          tint: earned ? meta.tint : 0x666666,
        })
      );
    } catch {
      container.add(this.add.circle(iconCenterX, iconCenterY, 14, earned ? meta.tint : 0x666666));
    }

    const nameText = this.add.text(70, 12, entry.condition.displayName, {
      fontSize: '16px',
      color: earned ? '#44ff88' : '#888888',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    container.add(nameText);

    const targetText = this.add.text(this.cardWidth - 10, 20, meta.label, {
      fontSize: '10px',
      color: earned ? '#ffcc00' : '#666666',
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    });
    targetText.setOrigin(1, 0.5);
    container.add(targetText);

    const hintText = this.add.text(70, 38, entry.condition.hintText, {
      fontSize: '13px',
      color: earned ? '#aaaaaa' : '#777777',
      fontFamily: FONT_FAMILY,
      wordWrap: { width: this.cardWidth - 90 },
    });
    container.add(hintText);

    const statusText = this.add.text(
      70,
      this.cardHeight - 22,
      earned ? `EARNED ${formatUnlockDate(entry.unlockedAt as number)}` : 'LOCKED',
      {
        fontSize: '11px',
        color: earned ? '#44ff88' : '#666666',
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
      }
    );
    container.add(statusText);

    return { container, cardBg, earned };
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
      this.achievementContainer.y = this.scrollBandTop - this.scrollY;
    });

    // Touch/drag scrolling
    let lastY = 0;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      lastY = pointer.y;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.y > this.scrollBandTop
        && pointer.y < this.scrollBandTop + this.scrollBandHeight) {
        const deltaY = lastY - pointer.y;
        this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY, 0, this.maxScrollY);
        this.achievementContainer.y = this.scrollBandTop - this.scrollY;
        lastY = pointer.y;
      }
    });
  }

  private selectCategoryByIndex(tabIndex: number): void {
    const tab = TAB_DEFS[tabIndex];
    if (tab && tab.id !== this.currentCategory) {
      this.currentCategory = tab.id;
      this.selectedCardIndex = 0;
      this.displayTab(tab.id);
      // Card-row count changed — rebuild the navigator (focus returns to tabs).
      this.buildMenuNavigator();
    }
  }

  private displayTab(tab: TabId): void {
    if (tab === 'daily') {
      this.displayDailyQuests();
    } else if (tab === 'unlocks') {
      this.displayUnlockVault();
    } else {
      this.displayCategoryAchievements(tab);
    }
  }

  private ensureCardVisible(): void {
    const row = Math.floor(this.selectedCardIndex / this.columns);
    const cardTopInBand = (10 + row * (this.cardHeight + this.cardSpacing)) * this.menuScale;
    const cardBottomInBand = cardTopInBand + this.cardHeight * this.menuScale;

    if (cardTopInBand < this.scrollY) {
      this.scrollY = cardTopInBand;
    } else if (cardBottomInBand > this.scrollY + this.scrollBandHeight) {
      this.scrollY = cardBottomInBand - this.scrollBandHeight;
    }

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScrollY);
    this.achievementContainer.y = this.scrollBandTop - this.scrollY;
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

    this.vaultCards.forEach((card, index) => {
      const isFocused = this.focusZone === 'grid' && this.selectedCardIndex === index;
      if (isFocused) {
        card.cardBg.setStrokeStyle(3, 0xffdd44);
      } else {
        card.cardBg.setStrokeStyle(2, card.earned ? 0x44ff88 : 0x3a3a5a);
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

function formatUnlockDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
