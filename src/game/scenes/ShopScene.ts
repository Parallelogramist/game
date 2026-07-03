/**
 * ShopScene — permanent upgrade shop.
 *
 * Tab strip across the top, card grid below, buy + refund pill buttons on
 * each card, MenuButton back/ascend in the chrome. All logic (purchase,
 * refund, ascension, scroll, tooltips, focus zones, gamepad nav) preserved
 * from the original; only the visual primitives changed.
 */

import Phaser from 'phaser';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import {
  PermanentUpgrade,
  PERMANENT_UPGRADES,
  calculateUpgradeCost,
  getPermanentUpgradeById,
  getUpgradesByCategory,
  UPGRADE_CATEGORIES,
  UpgradeCategory,
} from '../../data/PermanentUpgrades';
import { getShipModTracks, getShipModCost, ShipModTrack } from '../../data/ShipMods';
import { getShipModManager } from '../../meta/ShipModManager';
import { SHIP_CHARACTERS, ShipCharacter } from '../../data/ShipCharacters';
import { isUnlockRequirementMet, UnlockGateContext } from '../../data/UnlockGates';
import { getHiddenUnlockManager } from '../../meta/HiddenUnlocks';
import { createIcon, ICON_TINTS } from '../../utils/IconRenderer';
import { transitionToScene, sweepIn, staggerEntrance } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { getToastManager, ToastManager } from '../../ui';
import { getTutorialHintDef } from '../../tutorial/TutorialHints';
import { getTutorialHintManager } from '../../tutorial/TutorialHintManager';
import { TooltipManager } from '../../ui/TooltipManager';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { createMenuTabs, MenuTabs } from '../../visual/MenuTab';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import {
  ACCENT_COLORS,
  ACCENT_COLORS_STR,
  BODY_COLORS,
  MENU_FONT,
  RoleColorKey,
  TEXT_COLORS,
} from '../../visual/MenuStyle';

type FocusZone = 'tabs' | 'grid' | 'back';

/** Extra shop tab (after the upgrade categories) hosting per-ship mod tracks. */
const HANGAR_TAB_ID = 'hangar' as const;
type ShopTabId = UpgradeCategory | typeof HANGAR_TAB_ID;

interface UpgradeCardElements {
  card: MenuCard;
  levelText: Phaser.GameObjects.Text;
  effectText: Phaser.GameObjects.Text;
  buyButton: MenuButton;
  refundButton?: MenuButton;
  upgrade: PermanentUpgrade;
  lockOverlay?: Phaser.GameObjects.Rectangle;
  lockText?: Phaser.GameObjects.Text;
  isUnlocked: boolean;
  isMaxed: boolean;
  affordableStar?: Phaser.GameObjects.Text;
  cardIndex: number;
}

/**
 * A HANGAR-tab card: one per (unlocked ship × mod track), plus at most one
 * trailing teaser card for locked ships (no buy button, no track).
 */
interface HangarCardElements {
  card: MenuCard;
  buyButton?: MenuButton;
  shipId?: string;
  track?: ShipModTrack;
  isTeaser: boolean;
  isMaxed: boolean;
  affordableStar?: Phaser.GameObjects.Text;
  cardIndex: number;
}

interface TabBadgeElements {
  background: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  container: Phaser.GameObjects.Container;
}

const CATEGORY_ROLES: Record<UpgradeCategory, RoleColorKey> = {
  offense: 'magenta',
  defense: 'teal',
  movement: 'primary',
  resources: 'gold',
  utility: 'neutral',
  elemental: 'magenta',
  mastery: 'gold',
};

/**
 * Compact tab labels for narrow viewports. With the HANGAR tab the strip is
 * 8 tabs wide; at 720px that's 82px per tab — too tight for 'RESOURCES' /
 * 'ELEMENTAL' at full length, so below ~85px per tab we swap to these.
 */
const TAB_SHORT_LABELS: Record<ShopTabId, string> = {
  offense: 'ATK',
  defense: 'DEF',
  movement: 'SPD',
  resources: 'GOLD',
  utility: 'UTIL',
  elemental: 'ELEM',
  mastery: 'MSTRY',
  hangar: 'HANGAR',
};

interface ShopTabSpec {
  id: ShopTabId;
  label: string;
  accentRole: RoleColorKey;
}

/** Upgrade category tabs + the trailing HANGAR tab, in navigation order. */
const SHOP_TABS: ShopTabSpec[] = [
  ...UPGRADE_CATEGORIES.map((category) => ({
    id: category.id as ShopTabId,
    label: category.name.toUpperCase(),
    accentRole: CATEGORY_ROLES[category.id] ?? 'neutral',
  })),
  { id: HANGAR_TAB_ID, label: 'HANGAR', accentRole: 'primary' },
];

export class ShopScene extends Phaser.Scene {
  private goldText!: Phaser.GameObjects.Text;
  private accountLevelText!: Phaser.GameObjects.Text;
  private upgradeCards: UpgradeCardElements[] = [];
  private hangarCards: HangarCardElements[] = [];
  private currentCategory: ShopTabId = 'offense';
  private menuTabs: MenuTabs | null = null;
  private upgradeContainer!: Phaser.GameObjects.Container;
  private scrollY: number = 0;
  private maxScrollY: number = 0;
  private isDragging: boolean = false;
  private lastPointerY: number = 0;

  private focusZone: FocusZone = 'tabs';
  private selectedTabIndex: number = 0;
  private selectedCardIndex: number = 0;
  private menuNavigator: MenuNavigator | null = null;

  private tooltipManager!: TooltipManager;
  private soundManager!: SoundManager;
  private toastManager!: ToastManager;
  private goldTween: Phaser.Tweens.Tween | null = null;

  private menuBackground: MenuBackground | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private chromeButtons: MenuButton[] = [];
  private backButton!: MenuButton;
  private ascendButton: MenuButton | null = null;

  private tabBadges: Map<ShopTabId, TabBadgeElements> = new Map();
  private affordableOnlyFilter: boolean = false;
  private filterButton: MenuButton | null = null;
  private buyClickIgnoreUntil: number = 0;

  private accountProgressBarBg: Phaser.GameObjects.Graphics | null = null;
  private accountProgressBarFill: Phaser.GameObjects.Graphics | null = null;
  private accountNextUnlockText: Phaser.GameObjects.Text | null = null;

  private emptyStateText: Phaser.GameObjects.Text | null = null;

  private columns = 4;
  private readonly cardWidth = 220;
  private readonly cardHeight = 220;
  private readonly accountChipWidth = 200;

  constructor() {
    super({ key: 'ShopScene' });
  }

  create(): void {
    const centerX = this.scale.width / 2;

    // Portrait / narrow viewports: as many 220px columns as fit with margins
    // (720-wide portrait → 2). Grid layout, navigator rows, and
    // ensureCardVisible all derive from this.columns, so one assignment at
    // create keeps them consistent.
    this.columns = Math.max(1, Math.min(4, Math.floor((this.scale.width - 32) / (this.cardWidth + 24))));

    this.soundManager = new SoundManager(this);
    this.toastManager = getToastManager(this);

    this.upgradeCards = [];
    this.hangarCards = [];
    this.chromeButtons = [];
    this.tabBadges = new Map();
    this.focusZone = 'tabs';
    this.selectedTabIndex = 0;
    this.selectedCardIndex = 0;
    this.scrollY = 0;

    // Menu backdrop.
    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (time, delta) => {
      this.menuBackground?.update(delta);
      const seconds = time / 1000;
      this.menuTabs?.tickIdle(seconds);
      for (const btn of this.chromeButtons) btn.tickIdle(seconds);
      this.filterButton?.tickIdle(seconds);
      for (const card of this.upgradeCards) {
        card.card.tickIdle(seconds);
        card.buyButton.tickIdle(seconds);
        card.refundButton?.tickIdle(seconds);
        if (card.affordableStar) {
          const pulse = 0.55 + 0.45 * Math.sin(seconds * 3.2 + card.cardIndex * 0.7);
          card.affordableStar.setAlpha(pulse);
        }
      }
      for (const card of this.hangarCards) {
        card.card.tickIdle(seconds);
        card.buyButton?.tickIdle(seconds);
        if (card.affordableStar) {
          const pulse = 0.55 + 0.45 * Math.sin(seconds * 3.2 + card.cardIndex * 0.7);
          card.affordableStar.setAlpha(pulse);
        }
      }
    };
    this.events.on('update', this.bgUpdateHandler);

    // Title heading.
    const title = makeDisplayText(this, centerX, 32, 'SHOP', {
      fontSize: 36,
      color: ACCENT_COLORS_STR.gold,
      strokeWidth: 5,
      letterSpacing: 3,
    });
    title.setDepth(2);

    this.tooltipManager = new TooltipManager(this);

    // Account level chip (top-left).
    const metaManager = getMetaProgressionManager();
    const accountLevelChip = createMenuCard(this, {
      x: 110,
      y: 38,
      width: this.accountChipWidth,
      height: 50,
      bodyFillColor: BODY_COLORS.primary,
      accentColor: ACCENT_COLORS.primary,
      bannerHeight: 0,
      borderWidth: 2,
      borderColor: ACCENT_COLORS.primary,
      cornerRadius: 6,
      interactive: true,
      shadowOffsetY: 5,
      shadowAlpha: 0.4,
    });
    accountLevelChip.container.setDepth(2);

    const accountLabel = makeBodyText(this, -85, -10, 'ACCOUNT LV', {
      fontSize: 11,
      color: TEXT_COLORS.muted,
      align: 'left',
    });
    accountLabel.setOrigin(0, 0.5);
    accountLevelChip.frame.add(accountLabel);
    this.accountLevelText = makeDisplayText(this, -85, 8, `${metaManager.getAccountLevel()}`, {
      fontSize: 22,
      color: ACCENT_COLORS_STR.primary,
      letterSpacing: 1,
    });
    this.accountLevelText.setOrigin(0, 0.5);
    accountLevelChip.frame.add(this.accountLevelText);

    // Next-unlock hint + progress bar (right side of chip).
    this.accountNextUnlockText = makeDisplayText(this, 85, 0, '', {
      fontSize: 13,
      color: ACCENT_COLORS_STR.gold,
      letterSpacing: 0.5,
    });
    this.accountNextUnlockText.setOrigin(1, 0.5);
    accountLevelChip.frame.add(this.accountNextUnlockText);

    this.accountProgressBarBg = this.add.graphics();
    this.accountProgressBarFill = this.add.graphics();
    accountLevelChip.frame.add(this.accountProgressBarBg);
    accountLevelChip.frame.add(this.accountProgressBarFill);

    this.refreshAccountLevelProgress();

    this.tooltipManager.attach(
      accountLevelChip.hitZone,
      'Your Account Level is the sum of all shop upgrade levels. Higher account levels unlock more powerful upgrades. The bar shows your progress to the next unlock tier.',
    );

    // Gold chip (top-right).
    const goldChip = createMenuCard(this, {
      x: this.scale.width - 130,
      y: 38,
      width: 200,
      height: 50,
      bodyFillColor: BODY_COLORS.gold,
      accentColor: ACCENT_COLORS.gold,
      bannerHeight: 0,
      borderWidth: 2,
      borderColor: ACCENT_COLORS.gold,
      cornerRadius: 6,
      interactive: true,
      shadowOffsetY: 5,
      shadowAlpha: 0.4,
    });
    goldChip.container.setDepth(2);
    const goldLabel = makeBodyText(this, -85, -8, 'GOLD', {
      fontSize: 11,
      color: TEXT_COLORS.muted,
      align: 'left',
    });
    goldLabel.setOrigin(0, 0.5);
    goldChip.frame.add(goldLabel);
    this.goldText = makeDisplayText(this, -85, 12, '0', {
      fontSize: 22,
      color: ACCENT_COLORS_STR.gold,
      letterSpacing: 1,
    });
    this.goldText.setOrigin(0, 0.5);
    goldChip.frame.add(this.goldText);
    this.tooltipManager.attach(
      goldChip.hitZone,
      'Gold is earned after each run based on kills, time survived, and level. Spend it here on permanent upgrades.',
    );
    this.updateGoldDisplay();

    // Ascension chip / button.
    const ascensionManager = getAscensionManager();
    const ascensionLevel = ascensionManager.getLevel();
    const canAscend = ascensionManager.canAscend(metaManager.getAccountLevel());

    if (ascensionLevel > 0) {
      const statBonus = Math.round((ascensionManager.getStatMultiplier() - 1) * 100);
      const goldBonus = Math.round((ascensionManager.getGoldMultiplier() - 1) * 100);
      const ascText = makeBodyText(this, centerX, 56,
        `Asc. ${ascensionLevel}  ·  +${statBonus}% stats  ·  +${goldBonus}% gold`, {
          fontSize: 11,
          color: ACCENT_COLORS_STR.magenta,
        });
      ascText.setDepth(2);
      this.tooltipManager.attach(
        ascText,
        'Ascension is a prestige system. Each ascension resets your shop upgrades (refunding all gold) but grants permanent stat and gold bonuses.',
      );
    }

    if (canAscend) {
      const nextLevel = ascensionLevel + 1;
      const nextStatBonus = nextLevel * 10;
      const nextGoldBonus = nextLevel * 15;

      this.ascendButton = createMenuButton({
        scene: this,
        x: centerX,
        y: 78,
        width: 200,
        height: 36,
        label: '✦ ASCEND ✦',
        variant: 'magenta',
        fontSize: 14,
        onActivate: () => {
          this.soundManager.playUIClick();
          this.showAscensionConfirmation(nextLevel, nextStatBonus, nextGoldBonus);
        },
      });
      this.ascendButton.card.hitZone.on('pointerover', () => this.ascendButton!.setHoverState(true));
      this.ascendButton.card.hitZone.on('pointerout', () => this.ascendButton!.setHoverState(false));
      this.ascendButton.container.setDepth(3);
      this.chromeButtons.push(this.ascendButton);
    }

    this.createCategoryTabs();
    this.createFilterButton();
    this.createUpgradeContainer();
    this.displayActiveTab();
    this.refreshTabBadges();

    // Back button.
    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: this.scale.height - 32,
      width: 220,
      height: 40,
      label: '← BACK TO MENU',
      variant: 'neutral',
      fontSize: 14,
      onActivate: () => {
        this.soundManager.playUIClick();
        transitionToScene(this, 'BootScene');
      },
    });
    this.backButton.container.setDepth(3);
    this.backButton.card.hitZone.on('pointerover', () => {
      this.focusZone = 'back';
      this.updateFocusVisuals();
      this.backButton.setHoverState(true);
    });
    this.backButton.card.hitZone.on('pointerout', () => {
      this.backButton.setHoverState(false);
      this.updateFocusVisuals();
    });
    this.chromeButtons.push(this.backButton);

    this.setupScrollInput();
    this.buildMenuNavigator();
    this.updateFocusVisuals();

    // Entrance choreography: title + chrome chips first, then tabs and the
    // card grid rise into place.
    const entranceItems = [title, accountLevelChip.container, goldChip.container];
    if (this.ascendButton) entranceItems.push(this.ascendButton.container);
    if (this.menuTabs) entranceItems.push(this.menuTabs.container);
    if (this.filterButton) entranceItems.push(this.filterButton.container);
    entranceItems.push(this.upgradeContainer, this.backButton.container);
    staggerEntrance(this, entranceItems);
    sweepIn(this);

    // One-time shop hint via the per-hint flag. Previously this read AND set
    // the global `tutorialSeen` flag, so visiting the shop before a first run
    // silently killed the first-run coach marks in GameScene.
    if (getTutorialHintManager().maybeShow('shop')) {
      const shopHint = getTutorialHintDef('shop');
      this.time.delayedCall(800, () => {
        this.toastManager.showToast({
          title: shopHint.title,
          description: shopHint.description,
          icon: shopHint.icon,
          color: shopHint.color,
          duration: shopHint.duration,
        });
      });
    }

    this.events.once('shutdown', this.shutdown, this);
  }

  private createCategoryTabs(): void {
    const tabY = 130;
    const tabHeight = 38;
    const totalTabs = SHOP_TABS.length;
    const desiredWidth = Math.floor((this.scale.width - 60) / totalTabs);
    const tabWidth = Math.min(desiredWidth, 180);
    // 8 tabs at 720px → 82px each: full category names no longer fit, so
    // swap to the compact label set rather than letting text overflow.
    const useShortLabels = tabWidth < 85;

    this.menuTabs = createMenuTabs({
      scene: this,
      x: this.scale.width / 2,
      y: tabY,
      tabs: SHOP_TABS.map((tab) => ({
        id: tab.id,
        label: useShortLabels ? TAB_SHORT_LABELS[tab.id] : tab.label,
        accentRole: tab.accentRole,
      })),
      tabWidth,
      tabHeight,
      spacing: 8,
      fontSize: 12,
      initialActiveId: this.currentCategory,
      onChange: (id) => {
        const idx = SHOP_TABS.findIndex((tab) => tab.id === id);
        if (idx >= 0) {
          this.selectedTabIndex = idx;
          this.selectCategory(SHOP_TABS[idx].id);
        }
      },
    });
    this.menuTabs.container.setDepth(3);
  }

  private createFilterButton(): void {
    const buttonWidth = 200;
    const buttonHeight = 28;
    const buttonX = this.scale.width - 130;
    const buttonY = 92;

    this.filterButton = createMenuButton({
      scene: this,
      x: buttonX,
      y: buttonY,
      width: buttonWidth,
      height: buttonHeight,
      label: this.affordableOnlyFilter ? '✓ AFFORDABLE ONLY' : '◯ AFFORDABLE ONLY',
      variant: this.affordableOnlyFilter ? 'safe' : 'neutral',
      fontSize: 11,
      onActivate: () => {
        this.soundManager.playUIClick();
        this.toggleAffordableFilter();
      },
    });
    this.filterButton.container.setDepth(3);
    this.filterButton.card.hitZone.on('pointerover', () => this.filterButton?.setHoverState(true));
    this.filterButton.card.hitZone.on('pointerout', () => this.filterButton?.setHoverState(false));
    this.tooltipManager.attach(
      this.filterButton.card.hitZone,
      'Hide locked, maxed, and unaffordable upgrades. Helps you focus on what you can buy right now.',
    );
  }

  private toggleAffordableFilter(): void {
    this.affordableOnlyFilter = !this.affordableOnlyFilter;
    // Recreate the filter button so its label/variant reflect the new state.
    this.filterButton?.destroy();
    this.filterButton = null;
    this.createFilterButton();
    this.scrollY = 0;
    this.upgradeContainer.y = 0;
    this.selectedCardIndex = 0;
    this.displayActiveTab();
    this.refreshTabBadges();
    this.buildMenuNavigator();
    this.updateFocusVisuals();
  }

  private getAffordableCountForCategory(category: UpgradeCategory): number {
    const meta = getMetaProgressionManager();
    const accountLevel = meta.getAccountLevel();
    const gold = meta.getGold();
    let count = 0;
    for (const upgrade of getUpgradesByCategory(category)) {
      if (accountLevel < upgrade.unlockLevel) continue;
      const level = meta.getUpgradeLevel(upgrade.id);
      if (level >= upgrade.maxLevel) continue;
      if (gold < calculateUpgradeCost(upgrade, level)) continue;
      count++;
    }
    return count;
  }

  /**
   * Number of hangar mod-track levels the player could buy right now,
   * mirroring getAffordableCountForCategory for the HANGAR tab badge.
   */
  private getAffordableHangarCount(): number {
    const gateContext = this.buildUnlockGateContext();
    const gold = getMetaProgressionManager().getGold();
    const shipModManager = getShipModManager();
    let count = 0;
    for (const ship of SHIP_CHARACTERS) {
      if (!isUnlockRequirementMet(ship.unlockRequirement, gateContext)) continue;
      for (const track of getShipModTracks(ship.id)) {
        const level = shipModManager.getLevel(ship.id, track.id);
        if (level >= track.maxLevel) continue;
        if (gold >= getShipModCost(track, level)) count++;
      }
    }
    return count;
  }

  private refreshTabBadges(): void {
    if (!this.menuTabs) return;

    for (const tab of SHOP_TABS) {
      const button = this.menuTabs.getButton(tab.id);
      if (!button) continue;

      const count = tab.id === HANGAR_TAB_ID
        ? this.getAffordableHangarCount()
        : this.getAffordableCountForCategory(tab.id);
      let badge = this.tabBadges.get(tab.id);

      if (count <= 0) {
        if (badge) {
          badge.container.setVisible(false);
        }
        continue;
      }

      if (!badge) {
        const container = this.add.container(0, 0);
        const background = this.add.graphics();
        const text = makeDisplayText(this, 0, 0, '', {
          fontSize: 11,
          color: '#0a1018',
          letterSpacing: 0.5,
        });
        text.setOrigin(0.5);
        container.add(background);
        container.add(text);
        container.setDepth(4);
        button.card.frame.add(container);
        badge = { background, text, container };
        this.tabBadges.set(tab.id, badge);
      }

      badge.text.setText(String(count));
      const labelWidth = badge.text.width;
      const padding = 6;
      const badgeWidth = Math.max(18, labelWidth + padding * 2);
      const badgeHeight = 16;

      // Pin badge to the top-right corner of the tab button.
      const tabHalfWidth = button.card.width / 2;
      const tabHalfHeight = button.card.height / 2;
      badge.container.setPosition(tabHalfWidth - 6, -tabHalfHeight + 2);
      badge.container.setVisible(true);

      badge.background.clear();
      badge.background.fillStyle(ACCENT_COLORS.gold, 1);
      badge.background.fillRoundedRect(-badgeWidth / 2, -badgeHeight / 2, badgeWidth, badgeHeight, 7);
      badge.background.lineStyle(1.5, 0x0a1018, 1);
      badge.background.strokeRoundedRect(-badgeWidth / 2, -badgeHeight / 2, badgeWidth, badgeHeight, 7);
    }
  }

  private selectCategory(categoryId: ShopTabId): void {
    if (categoryId === this.currentCategory) return;

    this.currentCategory = categoryId;
    this.menuTabs?.setActive(categoryId);
    this.scrollY = 0;
    this.upgradeContainer.y = 0;
    this.selectedCardIndex = 0;
    this.displayActiveTab();
    this.buildMenuNavigator();
    this.updateFocusVisuals();
  }

  /** Render the active tab's card grid — upgrade category or the HANGAR tab. */
  private displayActiveTab(): void {
    if (this.currentCategory === HANGAR_TAB_ID) {
      this.displayHangarMods();
    } else {
      this.displayCategoryUpgrades(this.currentCategory);
    }
  }

  /** Same ship-availability rule as WeaponSelectScene.buildUnlockGateContext. */
  private buildUnlockGateContext(): UnlockGateContext {
    const metaManager = getMetaProgressionManager();
    return {
      unlockedConditionIds: getHiddenUnlockManager().getUnlockedConditionIds(),
      worldLevel: metaManager.getWorldLevel(),
      accountLevel: metaManager.getAccountLevel(),
    };
  }

  private createUpgradeContainer(): void {
    this.upgradeContainer = this.add.container(0, 0);
    this.upgradeContainer.setDepth(2);

    const maskY = 170;
    const maskHeight = this.scale.height - 230;
    const maskGraphics = this.add.graphics();
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(0, maskY, this.scale.width, maskHeight);

    this.upgradeContainer.setMask(maskGraphics.createGeometryMask());
    maskGraphics.setVisible(false);
  }

  /**
   * Tear down the current card grid (upgrade cards AND hangar cards — only
   * one set is ever populated, but both are cleared so tab switches never
   * leak). Cards/buttons aren't normal display objects so we have to destroy
   * them explicitly.
   */
  private clearCardGrid(): void {
    for (const card of this.upgradeCards) {
      card.buyButton.destroy();
      card.refundButton?.destroy();
      card.card.destroy();
    }
    this.upgradeCards = [];
    for (const card of this.hangarCards) {
      card.buyButton?.destroy();
      card.card.destroy();
    }
    this.hangarCards = [];
    this.upgradeContainer.removeAll(true);
    if (this.emptyStateText) {
      this.emptyStateText.destroy();
      this.emptyStateText = null;
    }
  }

  private displayCategoryUpgrades(category: UpgradeCategory): void {
    this.clearCardGrid();

    const meta = getMetaProgressionManager();
    const accountLevel = meta.getAccountLevel();
    const gold = meta.getGold();

    let upgrades = getUpgradesByCategory(category);
    if (this.affordableOnlyFilter) {
      upgrades = upgrades.filter((upgrade) => {
        if (accountLevel < upgrade.unlockLevel) return false;
        const level = meta.getUpgradeLevel(upgrade.id);
        if (level >= upgrade.maxLevel) return false;
        return gold >= calculateUpgradeCost(upgrade, level);
      });
    }

    if (upgrades.length === 0) {
      const message = this.affordableOnlyFilter
        ? 'No affordable upgrades in this category.\nEarn more gold or toggle the filter off.'
        : 'No upgrades available.';
      this.emptyStateText = this.add.text(this.scale.width / 2, 320, message, {
        fontSize: '16px',
        fontFamily: MENU_FONT,
        color: TEXT_COLORS.muted,
        align: 'center',
        lineSpacing: 6,
      });
      this.emptyStateText.setOrigin(0.5);
      this.emptyStateText.setDepth(2);
      this.maxScrollY = 0;
      return;
    }

    const startY = 188;
    const horizontalSpacing = 24;
    const verticalSpacing = 18;

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

    const rows = Math.ceil(upgrades.length / this.columns);
    const contentHeight = rows * (this.cardHeight + verticalSpacing);
    const visibleHeight = this.scale.height - 230;
    this.maxScrollY = Math.max(0, contentHeight - visibleHeight + 30);
  }

  private createUpgradeCard(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    upgrade: PermanentUpgrade,
    isUnlocked: boolean,
    cardIndex: number,
  ): void {
    const metaManager = getMetaProgressionManager();
    const currentLevel = metaManager.getUpgradeLevel(upgrade.id);
    const isMaxed = currentLevel >= upgrade.maxLevel;
    const cost = calculateUpgradeCost(upgrade, currentLevel);
    const canAfford = metaManager.getGold() >= cost;

    const role: RoleColorKey = isUnlocked ? CATEGORY_ROLES[upgrade.category] ?? 'neutral' : 'neutral';
    const bodyColor = role === 'neutral' ? BODY_COLORS.neutral : BODY_COLORS[role as keyof typeof BODY_COLORS] ?? BODY_COLORS.neutral;
    const accent = role === 'neutral' ? ACCENT_COLORS.neutral : ACCENT_COLORS[role as keyof typeof ACCENT_COLORS] ?? ACCENT_COLORS.neutral;


    const card = createMenuCard(this, {
      x: positionX,
      y: positionY,
      width,
      height,
      pulseSeed: cardIndex * 0.6 + 0.2,
      bodyFillColor: isUnlocked ? bodyColor : BODY_COLORS.neutral,
      accentColor: isUnlocked ? accent : ACCENT_COLORS.neutral,
      bannerHeight: 36,
      borderWidth: 3,
      borderColor: isUnlocked ? accent : ACCENT_COLORS.neutral,
      cornerRadius: 8,
    });

    if (!isUnlocked) card.container.setAlpha(0.7);
    this.upgradeContainer.add(card.container);

    // Banner label.
    const nameText = makeDisplayText(this, 0, card.bannerTopY + 18, upgrade.name.toUpperCase(), {
      fontSize: 14,
      color: TEXT_COLORS.heading,
      letterSpacing: 1.5,
    });
    card.frame.add(nameText);

    // Icon.
    const iconY = -height / 2 + 70;
    card.frame.add(
      createIcon(this, {
        x: 0,
        y: iconY,
        iconKey: upgrade.icon,
        size: 28,
        tint: isUnlocked ? ICON_TINTS.DEFAULT : ICON_TINTS.DISABLED,
      }),
    );

    // Description.
    const descriptionText = this.add.text(0, iconY + 30, upgrade.description, {
      fontSize: '11px',
      fontFamily: MENU_FONT,
      color: isUnlocked ? TEXT_COLORS.body : TEXT_COLORS.dim,
      wordWrap: { width: width - 24 },
      align: 'center',
    });
    descriptionText.setOrigin(0.5);
    card.frame.add(descriptionText);

    // Level pill.
    const levelText = makeBodyText(this, 0, 18, `Level ${currentLevel} / ${upgrade.maxLevel}`, {
      fontSize: 12,
      color: isUnlocked ? ACCENT_COLORS_STR.primary : TEXT_COLORS.dim,
    });
    card.frame.add(levelText);

    // Effect.
    const effectText = this.add.text(0, 38, upgrade.getEffect(currentLevel), {
      fontSize: '11px',
      fontFamily: MENU_FONT,
      color: isUnlocked ? ACCENT_COLORS_STR.safe : TEXT_COLORS.dim,
      wordWrap: { width: width - 24 },
      align: 'center',
    });
    effectText.setOrigin(0.5);
    card.frame.add(effectText);

    // Buy button + optional refund button at the card's foot.
    const buttonY = height / 2 - 28;
    const hasRefund = currentLevel > 0;
    const buttonHeight = 36;
    const buyWidth = hasRefund ? width - 84 : width - 28;
    const refundWidth = 64;

    const buyState = this.resolveBuyButtonVariant(isUnlocked, isMaxed, canAfford);
    const buyLabel = !isUnlocked
      ? `Lv.${upgrade.unlockLevel}`
      : isMaxed
        ? 'MAXED'
        : `${cost}g`;

    const buyButton = createMenuButton({
      scene: this,
      x: hasRefund ? -(width - 28) / 2 + buyWidth / 2 : 0,
      y: buttonY,
      width: buyWidth,
      height: buttonHeight,
      label: buyLabel,
      variant: buyState,
      fontSize: 13,
      // No-op onActivate — the actual buy logic runs in the custom pointerup
      // handler below so we can inspect the shift key on the underlying event.
      onActivate: () => {},
    });
    buyButton.setEnabled(isUnlocked && !isMaxed);
    card.frame.add(buyButton.container);

    if (isUnlocked && !isMaxed) {
      buyButton.card.hitZone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (this.time.now < this.buyClickIgnoreUntil) return;
        if (pointer.event.shiftKey) {
          this.purchaseUpgradeMax(upgrade.id);
        } else {
          this.purchaseUpgrade(upgrade.id);
        }
      });
      this.tooltipManager.attach(
        buyButton.card.hitZone,
        `${upgrade.name} — Click to buy 1 level. Shift+Click to buy as many as you can afford.`,
      );
    }

    let refundButton: MenuButton | undefined;
    if (hasRefund) {
      const refundAmount = metaManager.getRefundAmount(upgrade.id);
      const refundX = (width - 28) / 2 - refundWidth / 2;
      refundButton = createMenuButton({
        scene: this,
        x: refundX,
        y: buttonY,
        width: refundWidth,
        height: buttonHeight,
        label: `↩${refundAmount}`,
        variant: 'gold',
        fontSize: 12,
        onActivate: () => this.refundUpgrade(upgrade.id, false),
      });
      refundButton.card.hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        // Shift+click for full refund — onActivate already runs single-level path,
        // so override with shift detection here.
        if (pointer.event.shiftKey) {
          this.refundUpgrade(upgrade.id, true);
        }
      });
      refundButton.card.hitZone.on('pointerover', () => refundButton!.setHoverState(true));
      refundButton.card.hitZone.on('pointerout', () => refundButton!.setHoverState(false));
      card.frame.add(refundButton.container);
    }

    // Lock overlay.
    let lockOverlay: Phaser.GameObjects.Rectangle | undefined;
    let lockText: Phaser.GameObjects.Text | undefined;
    if (!isUnlocked) {
      lockOverlay = this.add.rectangle(0, 0, width - 8, height - 8, 0x000000, 0.45);
      card.frame.add(lockOverlay);
      const accountLevel = metaManager.getAccountLevel();
      lockText = makeDisplayText(
        this,
        0,
        0,
        `🔒 LV. ${upgrade.unlockLevel}\n( ${accountLevel} / ${upgrade.unlockLevel} )`,
        {
          fontSize: 13,
          color: ACCENT_COLORS_STR.danger,
          letterSpacing: 1,
        },
      );
      lockText.setLineSpacing(4);
      card.frame.add(lockText);
    }

    // Affordable signal — pulsing gold sparkle in the top-right card corner
    // for upgrades the player can buy *right now*. Cuts scan time when
    // hopping across categories with a full purse.
    let affordableStar: Phaser.GameObjects.Text | undefined;
    if (isUnlocked && !isMaxed && canAfford) {
      affordableStar = makeDisplayText(this, width / 2 - 16, -height / 2 + 16, '✦', {
        fontSize: 18,
        color: ACCENT_COLORS_STR.gold,
        letterSpacing: 0,
      });
      affordableStar.setOrigin(0.5);
      card.frame.add(affordableStar);
    }

    this.upgradeCards.push({
      card,
      levelText,
      effectText,
      buyButton,
      refundButton,
      upgrade,
      lockOverlay,
      lockText,
      isUnlocked,
      isMaxed,
      affordableStar,
      cardIndex,
    });

    // Pointer routing — hover focuses the cell, clicking the body activates buy.
    card.hitZone.on('pointerover', () => {
      this.selectedCardIndex = cardIndex;
      this.focusZone = 'grid';
      this.updateFocusVisuals();
      card.setHoverState(true);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!isUnlocked || isMaxed) return;
      if (this.time.now < this.buyClickIgnoreUntil) return;
      if (pointer.event.shiftKey) {
        this.purchaseUpgradeMax(upgrade.id);
      } else {
        this.purchaseUpgrade(upgrade.id);
      }
    });

    buyButton.card.hitZone.on('pointerover', () => {
      buyButton.setHoverState(true);
      this.selectedCardIndex = cardIndex;
      this.focusZone = 'grid';
      this.updateFocusVisuals();
    });
    buyButton.card.hitZone.on('pointerout', () => buyButton.setHoverState(false));
  }

  private resolveBuyButtonVariant(isUnlocked: boolean, isMaxed: boolean, canAfford: boolean): 'safe' | 'neutral' | 'danger' {
    if (!isUnlocked || isMaxed) return 'neutral';
    return canAfford ? 'safe' : 'danger';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HANGAR tab — per-ship mod tracks (FEAT-SHIP-MODS-1)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Render the HANGAR tab: one card per mod track of every unlocked ship
   * (availability rule shared with WeaponSelectScene), plus a single trailing
   * teaser card when at least one ship is still locked. Reuses the upgrade
   * grid's geometry, scroll math, and card visual language.
   */
  private displayHangarMods(): void {
    this.clearCardGrid();

    const gateContext = this.buildUnlockGateContext();
    const unlockedShips = SHIP_CHARACTERS.filter((ship) =>
      isUnlockRequirementMet(ship.unlockRequirement, gateContext),
    );
    const lockedShipCount = SHIP_CHARACTERS.length - unlockedShips.length;

    const shipModManager = getShipModManager();
    const gold = getMetaProgressionManager().getGold();

    let entries: { ship: ShipCharacter; track: ShipModTrack }[] = [];
    for (const ship of unlockedShips) {
      for (const track of getShipModTracks(ship.id)) {
        entries.push({ ship, track });
      }
    }

    if (this.affordableOnlyFilter) {
      entries = entries.filter(({ ship, track }) => {
        const level = shipModManager.getLevel(ship.id, track.id);
        if (level >= track.maxLevel) return false;
        return gold >= getShipModCost(track, level);
      });
    }

    // The teaser is "locked content", so the affordable-only filter hides it,
    // matching how locked upgrades are filtered out of the categories.
    const includeTeaser = lockedShipCount > 0 && !this.affordableOnlyFilter;
    const totalCards = entries.length + (includeTeaser ? 1 : 0);

    if (totalCards === 0) {
      const message = this.affordableOnlyFilter
        ? 'No affordable ship mods.\nEarn more gold or toggle the filter off.'
        : 'No ship mods available.';
      this.emptyStateText = this.add.text(this.scale.width / 2, 320, message, {
        fontSize: '16px',
        fontFamily: MENU_FONT,
        color: TEXT_COLORS.muted,
        align: 'center',
        lineSpacing: 6,
      });
      this.emptyStateText.setOrigin(0.5);
      this.emptyStateText.setDepth(2);
      this.maxScrollY = 0;
      return;
    }

    const startY = 188;
    const horizontalSpacing = 24;
    const verticalSpacing = 18;

    const totalRowWidth = this.columns * this.cardWidth + (this.columns - 1) * horizontalSpacing;
    const startX = (this.scale.width - totalRowWidth) / 2 + this.cardWidth / 2;

    const positionAt = (index: number): { x: number; y: number } => {
      const col = index % this.columns;
      const row = Math.floor(index / this.columns);
      return {
        x: startX + col * (this.cardWidth + horizontalSpacing),
        y: startY + row * (this.cardHeight + verticalSpacing) + this.cardHeight / 2,
      };
    };

    entries.forEach(({ ship, track }, index) => {
      const { x, y } = positionAt(index);
      this.createShipModCard(x, y, this.cardWidth, this.cardHeight, ship, track, index);
    });

    if (includeTeaser) {
      const { x, y } = positionAt(entries.length);
      this.createHangarTeaserCard(x, y, this.cardWidth, this.cardHeight, lockedShipCount, entries.length);
    }

    const rows = Math.ceil(totalCards / this.columns);
    const contentHeight = rows * (this.cardHeight + verticalSpacing);
    const visibleHeight = this.scale.height - 230;
    this.maxScrollY = Math.max(0, contentHeight - visibleHeight + 30);
  }

  private createShipModCard(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    ship: ShipCharacter,
    track: ShipModTrack,
    cardIndex: number,
  ): void {
    const metaManager = getMetaProgressionManager();
    const shipModManager = getShipModManager();
    const currentLevel = shipModManager.getLevel(ship.id, track.id);
    const isMaxed = currentLevel >= track.maxLevel;
    const cost = getShipModCost(track, currentLevel);
    const canAfford = !isMaxed && metaManager.getGold() >= cost;

    const accent = isMaxed ? ACCENT_COLORS.gold : ACCENT_COLORS.primary;
    const card = createMenuCard(this, {
      x: positionX,
      y: positionY,
      width,
      height,
      pulseSeed: cardIndex * 0.6 + 0.2,
      bodyFillColor: BODY_COLORS.primary,
      accentColor: accent,
      bannerHeight: 36,
      borderWidth: 3,
      borderColor: accent,
      cornerRadius: 8,
    });
    this.upgradeContainer.add(card.container);

    // Banner: track name.
    const nameText = makeDisplayText(this, 0, card.bannerTopY + 18, track.name.toUpperCase(), {
      fontSize: 13,
      color: TEXT_COLORS.heading,
      letterSpacing: 1,
    });
    card.frame.add(nameText);

    // Kicker: which ship this track belongs to.
    const kickerText = makeDisplayText(this, 0, -height / 2 + 52, ship.name.toUpperCase(), {
      fontSize: 10,
      color: TEXT_COLORS.muted,
      letterSpacing: 2.5,
    });
    card.frame.add(kickerText);

    // Description: the per-level effect.
    const descriptionText = this.add.text(0, -14, track.description, {
      fontSize: '11px',
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.body,
      wordWrap: { width: width - 24 },
      align: 'center',
    });
    descriptionText.setOrigin(0.5);
    card.frame.add(descriptionText);

    // Level pips + LV readout ('◆ ◆ ◇' / 'LV 2/3', gold when maxed).
    const pips = Array.from({ length: track.maxLevel }, (_v, i) => (i < currentLevel ? '◆' : '◇')).join(' ');
    const pipsText = makeDisplayText(this, 0, 18, pips, {
      fontSize: 15,
      color: isMaxed ? ACCENT_COLORS_STR.gold : ACCENT_COLORS_STR.primary,
      letterSpacing: 2,
    });
    card.frame.add(pipsText);
    const levelText = makeBodyText(
      this,
      0,
      40,
      isMaxed ? 'MAXED' : `LV ${currentLevel}/${track.maxLevel}`,
      {
        fontSize: 12,
        color: isMaxed ? ACCENT_COLORS_STR.gold : ACCENT_COLORS_STR.primary,
      },
    );
    card.frame.add(levelText);

    // Buy button at the card's foot (no refund path for mods).
    const buttonY = height / 2 - 28;
    const buyButton = createMenuButton({
      scene: this,
      x: 0,
      y: buttonY,
      width: width - 28,
      height: 36,
      label: isMaxed ? 'MAXED' : `${cost}g`,
      variant: this.resolveBuyButtonVariant(true, isMaxed, canAfford),
      fontSize: 13,
      onActivate: () => {},
    });
    buyButton.setEnabled(!isMaxed);
    card.frame.add(buyButton.container);

    if (!isMaxed) {
      buyButton.card.hitZone.on('pointerup', () => {
        if (this.time.now < this.buyClickIgnoreUntil) return;
        this.purchaseShipMod(ship.id, track);
      });
      this.tooltipManager.attach(
        buyButton.card.hitZone,
        `${ship.name} — ${track.name}: ${track.description} Mods apply only when flying the ${ship.name}.`,
      );
    }

    // Affordable signal — same pulsing gold sparkle as the upgrade cards.
    let affordableStar: Phaser.GameObjects.Text | undefined;
    if (canAfford) {
      affordableStar = makeDisplayText(this, width / 2 - 16, -height / 2 + 16, '✦', {
        fontSize: 18,
        color: ACCENT_COLORS_STR.gold,
        letterSpacing: 0,
      });
      affordableStar.setOrigin(0.5);
      card.frame.add(affordableStar);
    }

    this.hangarCards.push({
      card,
      buyButton,
      shipId: ship.id,
      track,
      isTeaser: false,
      isMaxed,
      affordableStar,
      cardIndex,
    });

    // Pointer routing — hover focuses the cell, clicking the body buys.
    card.hitZone.on('pointerover', () => {
      this.selectedCardIndex = cardIndex;
      this.focusZone = 'grid';
      this.updateFocusVisuals();
      card.setHoverState(true);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerdown', () => {
      if (isMaxed) return;
      if (this.time.now < this.buyClickIgnoreUntil) return;
      this.purchaseShipMod(ship.id, track);
    });

    buyButton.card.hitZone.on('pointerover', () => {
      buyButton.setHoverState(true);
      this.selectedCardIndex = cardIndex;
      this.focusZone = 'grid';
      this.updateFocusVisuals();
    });
    buyButton.card.hitZone.on('pointerout', () => buyButton.setHoverState(false));
  }

  /** Single trailing card teasing that locked ships expand the hangar. */
  private createHangarTeaserCard(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    lockedShipCount: number,
    cardIndex: number,
  ): void {
    const card = createMenuCard(this, {
      x: positionX,
      y: positionY,
      width,
      height,
      pulseSeed: cardIndex * 0.6 + 0.2,
      bodyFillColor: BODY_COLORS.neutral,
      accentColor: ACCENT_COLORS.neutral,
      bannerHeight: 36,
      borderWidth: 3,
      borderColor: ACCENT_COLORS.neutral,
      cornerRadius: 8,
    });
    card.container.setAlpha(0.7);
    this.upgradeContainer.add(card.container);

    const nameText = makeDisplayText(this, 0, card.bannerTopY + 18, 'LOCKED', {
      fontSize: 14,
      color: TEXT_COLORS.heading,
      letterSpacing: 1.5,
    });
    card.frame.add(nameText);

    const lockGlyph = makeDisplayText(this, 0, -32, '🔒', {
      fontSize: 26,
      color: ACCENT_COLORS_STR.neutral,
      letterSpacing: 0,
    });
    card.frame.add(lockGlyph);

    const teaserText = this.add.text(0, 16, 'Unlock more ships to expand the hangar.', {
      fontSize: '12px',
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.body,
      wordWrap: { width: width - 32 },
      align: 'center',
    });
    teaserText.setOrigin(0.5);
    card.frame.add(teaserText);

    const countText = makeBodyText(
      this,
      0,
      56,
      `${lockedShipCount} ${lockedShipCount === 1 ? 'SHIP' : 'SHIPS'} UNDISCOVERED`,
      {
        fontSize: 11,
        color: TEXT_COLORS.dim,
      },
    );
    card.frame.add(countText);

    this.hangarCards.push({
      card,
      isTeaser: true,
      isMaxed: false,
      cardIndex,
    });

    card.hitZone.on('pointerover', () => {
      this.selectedCardIndex = cardIndex;
      this.focusZone = 'grid';
      this.updateFocusVisuals();
      card.setHoverState(true);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));
  }

  /**
   * Buy the next level of a ship mod track. Mirrors purchaseUpgrade's flow:
   * gold guard (error sound + deficit toast) → spendGold → purchase → purchase
   * sound + rebuild the tab, gold readout, badges, navigator, focus, pulse.
   * The manager spends nothing itself, so gold is spent first and refunded on
   * the (guard-prevented) purchase failure path so gold can never vanish.
   */
  private purchaseShipMod(shipId: string, track: ShipModTrack): void {
    const metaManager = getMetaProgressionManager();
    const shipModManager = getShipModManager();

    const currentLevel = shipModManager.getLevel(shipId, track.id);
    if (currentLevel >= track.maxLevel) return;
    const cost = getShipModCost(track, currentLevel);
    if (!Number.isFinite(cost)) return;

    if (metaManager.getGold() < cost) {
      this.soundManager.playError();
      const deficit = cost - metaManager.getGold();
      this.toastManager.showToast({
        title: 'Not Enough Gold',
        description: `Need ${deficit} more gold`,
        icon: 'coins',
        color: 0xff6644,
        duration: 2000,
      });
      return;
    }

    if (!metaManager.spendGold(cost)) {
      this.soundManager.playError();
      return;
    }
    if (!shipModManager.purchase(shipId, track.id)) {
      metaManager.addGold(cost);
      this.soundManager.playError();
      return;
    }

    this.soundManager.playPurchase();
    this.updateGoldDisplay();
    this.displayHangarMods();
    this.clampSelectedCardIndex();
    this.refreshTabBadges();
    this.buildMenuNavigator();
    this.updateFocusVisuals();
    this.pulseHangarCard(shipId, track.id);
  }

  private pulseHangarCard(shipId: string, trackId: string): void {
    const card = this.hangarCards.find((c) => c.shipId === shipId && c.track?.id === trackId);
    if (!card) return;
    this.tweens.add({
      targets: card.card.container,
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 110,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  private setupScrollInput(): void {
    this.input.on(
      'wheel',
      (_pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
        this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY * 0.5, 0, this.maxScrollY);
        this.upgradeContainer.y = -this.scrollY;
      },
    );

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > 170 && pointer.y < this.scale.height - 80) {
        this.isDragging = true;
        this.lastPointerY = pointer.y;
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      const deltaY = this.lastPointerY - pointer.y;
      this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY, 0, this.maxScrollY);
      this.upgradeContainer.y = -this.scrollY;
      this.lastPointerY = pointer.y;
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
    });
  }

  private buildMenuNavigator(): void {
    this.menuNavigator?.destroy();

    const navigableItems: NavigableItem[] = [];

    SHOP_TABS.forEach((_tab, tabIndex) => {
      navigableItems.push({
        onFocus: () => {
          this.focusZone = 'tabs';
          this.selectedTabIndex = tabIndex;
          this.selectTabByIndex(tabIndex);
          this.updateFocusVisuals();
        },
        onBlur: () => this.updateFocusVisuals(),
        onActivate: () => this.selectTabByIndex(tabIndex),
      });
    });

    const activeCardCount = this.getActiveCardCount();
    for (let cardIndex = 0; cardIndex < activeCardCount; cardIndex++) {
      navigableItems.push({
        onFocus: () => {
          this.focusZone = 'grid';
          this.selectedCardIndex = cardIndex;
          this.ensureCardVisible();
          this.updateFocusVisuals();
        },
        onBlur: () => this.updateFocusVisuals(),
        onActivate: () => {
          this.focusZone = 'grid';
          this.selectedCardIndex = cardIndex;
          this.activateCurrentSelection();
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

    const totalTabCount = SHOP_TABS.length;
    const navigatorColumns = Math.max(totalTabCount, this.columns);

    let initialIndex: number;
    if (this.focusZone === 'tabs') initialIndex = this.selectedTabIndex;
    else if (this.focusZone === 'grid') initialIndex = totalTabCount + this.selectedCardIndex;
    else initialIndex = navigableItems.length - 1;

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: navigatorColumns,
      wrap: true,
      onCancel: () => {
        transitionToScene(this, 'BootScene');
      },
      initialIndex,
    });
  }

  private selectTabByIndex(index: number): void {
    const tab = SHOP_TABS[index];
    if (tab) this.selectCategory(tab.id);
  }

  /** Card count of whichever grid (upgrades or hangar) the active tab shows. */
  private getActiveCardCount(): number {
    return this.currentCategory === HANGAR_TAB_ID ? this.hangarCards.length : this.upgradeCards.length;
  }

  private activateCurrentSelection(): void {
    if (this.focusZone === 'grid') {
      if (this.currentCategory === HANGAR_TAB_ID) {
        const card = this.hangarCards[this.selectedCardIndex];
        if (!card || card.isTeaser || !card.shipId || !card.track) return;
        const currentLevel = getShipModManager().getLevel(card.shipId, card.track.id);
        if (currentLevel < card.track.maxLevel) this.purchaseShipMod(card.shipId, card.track);
        return;
      }

      const card = this.upgradeCards[this.selectedCardIndex];
      if (!card) return;

      const metaManager = getMetaProgressionManager();
      const currentLevel = metaManager.getUpgradeLevel(card.upgrade.id);
      const isMaxed = currentLevel >= card.upgrade.maxLevel;
      const isUnlocked = metaManager.getAccountLevel() >= card.upgrade.unlockLevel;

      if (isUnlocked && !isMaxed) this.purchaseUpgrade(card.upgrade.id);
    } else if (this.focusZone === 'back') {
      transitionToScene(this, 'BootScene');
    }
  }

  private ensureCardVisible(): void {
    const row = Math.floor(this.selectedCardIndex / this.columns);
    const cardY = 188 + row * (this.cardHeight + 18) + this.cardHeight / 2;
    const visibleTop = this.scrollY + 170;
    const visibleBottom = this.scrollY + this.scale.height - 80;

    if (cardY - this.cardHeight / 2 < visibleTop) {
      this.scrollY = Math.max(0, cardY - this.cardHeight / 2 - 170);
    } else if (cardY + this.cardHeight / 2 > visibleBottom) {
      this.scrollY = Math.min(this.maxScrollY, cardY + this.cardHeight / 2 - (this.scale.height - 80));
    }

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScrollY);
    this.upgradeContainer.y = -this.scrollY;
  }

  private updateFocusVisuals(): void {
    // Card focus pop — MenuCard's setFocusState handles the lift. Only one
    // of the two card lists is populated at a time (per active tab).
    this.upgradeCards.forEach((card, index) => {
      const isFocused = this.focusZone === 'grid' && this.selectedCardIndex === index;
      card.card.setFocusState(isFocused);
    });
    this.hangarCards.forEach((card, index) => {
      const isFocused = this.focusZone === 'grid' && this.selectedCardIndex === index;
      card.card.setFocusState(isFocused);
    });

    // Back button highlight.
    this.backButton.setFocusState(this.focusZone === 'back');
  }

  private purchaseUpgrade(upgradeId: string): void {
    const metaManager = getMetaProgressionManager();
    const success = metaManager.purchaseUpgrade(upgradeId);

    if (success) {
      this.soundManager.playPurchase();
      this.updateGoldDisplay();
      this.updateAccountLevelDisplay();
      this.displayActiveTab();
      this.clampSelectedCardIndex();
      this.refreshTabBadges();
      this.buildMenuNavigator();
      this.updateFocusVisuals();
      this.pulseCardForUpgrade(upgradeId);
      return;
    }

    this.soundManager.playError();

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

  /**
   * Buy as many levels of the given upgrade as gold allows. Stops when out of
   * gold, at max level, or when the upgrade re-locks (account level can drop
   * if refunds are happening concurrently — defensive). The 99-iteration
   * safety cap matches the largest realistic maxLevel × 10 headroom.
   */
  private purchaseUpgradeMax(upgradeId: string): void {
    const metaManager = getMetaProgressionManager();
    let bought = 0;
    const safetyLimit = 99;
    while (bought < safetyLimit && metaManager.purchaseUpgrade(upgradeId)) {
      bought++;
    }

    // Lock the next ~120ms of buy clicks so the pointerup that triggered this
    // shift+click can't queue a second purchase on the rebuilt card.
    this.buyClickIgnoreUntil = this.time.now + 120;

    if (bought <= 0) {
      this.soundManager.playError();
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
      return;
    }

    this.soundManager.playPurchase();
    this.updateGoldDisplay();
    this.updateAccountLevelDisplay();
    this.displayActiveTab();
    this.clampSelectedCardIndex();
    this.refreshTabBadges();
    this.buildMenuNavigator();
    this.updateFocusVisuals();
    this.pulseCardForUpgrade(upgradeId);

    if (bought > 1) {
      const upgradeName = getPermanentUpgradeById(upgradeId)?.name ?? 'Upgrade';
      this.toastManager.showToast({
        title: `+${bought} ${upgradeName}`,
        description: 'Bought max levels',
        icon: 'coins',
        color: 0xffd166,
        duration: 1800,
      });
    }
  }

  private pulseCardForUpgrade(upgradeId: string): void {
    const card = this.upgradeCards.find((c) => c.upgrade.id === upgradeId);
    if (!card) return;
    this.tweens.add({
      targets: card.card.container,
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 110,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  private refundUpgrade(upgradeId: string, fullRefund: boolean): void {
    const metaManager = getMetaProgressionManager();
    const refunded = fullRefund
      ? metaManager.refundUpgradeFully(upgradeId)
      : metaManager.refundUpgradeLevel(upgradeId);

    if (refunded <= 0) return;

    this.soundManager.playUIClick();
    this.updateGoldDisplay();
    this.updateAccountLevelDisplay();
    this.displayActiveTab();
    this.clampSelectedCardIndex();
    this.refreshTabBadges();
    this.buildMenuNavigator();
    this.updateFocusVisuals();
  }

  private clampSelectedCardIndex(): void {
    const cardCount = this.getActiveCardCount();
    if (cardCount === 0) {
      this.selectedCardIndex = 0;
      return;
    }
    if (this.selectedCardIndex >= cardCount) {
      this.selectedCardIndex = cardCount - 1;
    }
    if (this.selectedCardIndex < 0) this.selectedCardIndex = 0;
  }

  private updateGoldDisplay(): void {
    const newGold = getMetaProgressionManager().getGold();
    const currentDisplayed = parseInt(this.goldText.text) || 0;

    if (currentDisplayed === newGold) return;

    this.goldTween?.remove();
    this.goldTween = null;

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
    this.accountLevelText.setText(`${getMetaProgressionManager().getAccountLevel()}`);
    this.refreshAccountLevelProgress();
  }

  /**
   * Find the smallest unlock-level tier strictly above the current account
   * level. Returns null when every upgrade tier is already unlocked.
   */
  private getNextUnlockTier(currentAccountLevel: number): number | null {
    let nextTier: number | null = null;
    for (const upgrade of PERMANENT_UPGRADES) {
      if (upgrade.unlockLevel > currentAccountLevel) {
        if (nextTier === null || upgrade.unlockLevel < nextTier) {
          nextTier = upgrade.unlockLevel;
        }
      }
    }
    return nextTier;
  }

  /**
   * Find the highest unlock-level tier at or below the current account level,
   * used as the lower bound for progress-bar fill.
   */
  private getPreviousUnlockTier(currentAccountLevel: number): number {
    let prevTier = 0;
    for (const upgrade of PERMANENT_UPGRADES) {
      if (upgrade.unlockLevel <= currentAccountLevel && upgrade.unlockLevel > prevTier) {
        prevTier = upgrade.unlockLevel;
      }
    }
    return prevTier;
  }

  private refreshAccountLevelProgress(): void {
    if (!this.accountProgressBarBg || !this.accountProgressBarFill || !this.accountNextUnlockText) return;

    const accountLevel = getMetaProgressionManager().getAccountLevel();
    const nextTier = this.getNextUnlockTier(accountLevel);

    // Bar geometry — sits at the bottom of the chip's interior.
    const barWidth = this.accountChipWidth - 24;
    const barHeight = 4;
    const barLeftX = -barWidth / 2;
    const barY = 19;

    this.accountProgressBarBg.clear();
    this.accountProgressBarFill.clear();

    if (nextTier === null) {
      this.accountNextUnlockText.setText('ALL\nUNLOCKED');
      this.accountNextUnlockText.setFontSize(10);
      this.accountNextUnlockText.setLineSpacing(0);
      // Full-bar gold cap to signal "done".
      this.accountProgressBarBg.fillStyle(0x000000, 0.45);
      this.accountProgressBarBg.fillRoundedRect(barLeftX, barY, barWidth, barHeight, 2);
      this.accountProgressBarFill.fillStyle(ACCENT_COLORS.gold, 1);
      this.accountProgressBarFill.fillRoundedRect(barLeftX, barY, barWidth, barHeight, 2);
      return;
    }

    const prevTier = this.getPreviousUnlockTier(accountLevel);
    const span = Math.max(1, nextTier - prevTier);
    const progress = Phaser.Math.Clamp((accountLevel - prevTier) / span, 0, 1);

    this.accountNextUnlockText.setText(`▶ Lv.${nextTier}`);
    this.accountNextUnlockText.setFontSize(13);
    this.accountNextUnlockText.setLineSpacing(0);

    // Background track.
    this.accountProgressBarBg.fillStyle(0x000000, 0.45);
    this.accountProgressBarBg.fillRoundedRect(barLeftX, barY, barWidth, barHeight, 2);

    // Filled portion in primary cyan, capped in gold at the right edge.
    const fillWidth = Math.max(0, barWidth * progress);
    if (fillWidth > 0) {
      this.accountProgressBarFill.fillStyle(ACCENT_COLORS.primary, 1);
      this.accountProgressBarFill.fillRoundedRect(barLeftX, barY, fillWidth, barHeight, 2);
    }
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    this.tooltipManager.destroy();
    if (this.bgUpdateHandler) {
      this.events.off('update', this.bgUpdateHandler);
      this.bgUpdateHandler = null;
    }
    this.menuBackground?.destroy();
    this.menuBackground = null;
    // Tabs own their button containers; the badges live inside those buttons
    // and get destroyed transitively. Just clear our tracking map.
    this.menuTabs?.destroy();
    this.menuTabs = null;
    this.tabBadges.clear();
    this.filterButton?.destroy();
    this.filterButton = null;
    this.accountProgressBarBg?.destroy();
    this.accountProgressBarBg = null;
    this.accountProgressBarFill?.destroy();
    this.accountProgressBarFill = null;
    this.accountNextUnlockText = null;
    this.emptyStateText?.destroy();
    this.emptyStateText = null;
    for (const btn of this.chromeButtons) btn.destroy();
    this.chromeButtons = [];
    for (const card of this.upgradeCards) {
      card.buyButton.destroy();
      card.refundButton?.destroy();
      card.card.destroy();
    }
    this.upgradeCards = [];
    for (const card of this.hangarCards) {
      card.buyButton?.destroy();
      card.card.destroy();
    }
    this.hangarCards = [];
    this.tweens.killAll();
  }

  private showAscensionConfirmation(nextLevel: number, statBonus: number, goldBonus: number): void {
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    const overlay = this.add
      .rectangle(centerX, centerY, this.scale.width, this.scale.height, 0x000000, 0.85)
      .setDepth(100)
      .setInteractive();

    const confirmCard = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width: 460,
      height: 360,
      bodyFillColor: BODY_COLORS.magenta,
      accentColor: ACCENT_COLORS.magenta,
      bannerHeight: 48,
      borderWidth: 4,
      borderColor: ACCENT_COLORS.magenta,
      cornerRadius: 8,
      interactive: false,
    });
    confirmCard.container.setDepth(101);

    const banner = makeDisplayText(this, 0, confirmCard.bannerTopY + 24, `ASCEND TO LEVEL ${nextLevel}`, {
      fontSize: 20,
      color: TEXT_COLORS.heading,
      letterSpacing: 2,
    });
    confirmCard.frame.add(banner);

    const descLines = [
      'All shop upgrades will be reset to 0.',
      'All spent gold will be refunded.',
      '',
      'You will gain permanently:',
      `  +${statBonus}% to all stats`,
      `  +${goldBonus}% gold earned`,
    ];
    if (nextLevel >= 2) descLines.push('  +1 weapon slot');
    if (nextLevel >= 3) descLines.push('  +1 starting level');
    if (nextLevel >= 4) descLines.push('  2x XP gem value');

    const descText = this.add.text(0, -20, descLines.join('\n'), {
      fontSize: '15px',
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.body,
      align: 'center',
      lineSpacing: 4,
    });
    descText.setOrigin(0.5);
    confirmCard.frame.add(descText);

    const confirmButton = createMenuButton({
      scene: this,
      x: centerX - 80,
      y: centerY + 130,
      width: 140,
      height: 44,
      label: '✦ ASCEND ✦',
      variant: 'magenta',
      fontSize: 15,
      onActivate: () => {
        this.soundManager.playUIClick();
        cleanup();
        this.performAscension();
      },
    });
    confirmButton.container.setDepth(102);
    confirmButton.card.hitZone.on('pointerover', () => confirmButton.setHoverState(true));
    confirmButton.card.hitZone.on('pointerout', () => confirmButton.setHoverState(false));

    const cancelButton = createMenuButton({
      scene: this,
      x: centerX + 80,
      y: centerY + 130,
      width: 140,
      height: 44,
      label: 'Cancel',
      variant: 'neutral',
      fontSize: 15,
      onActivate: () => {
        this.soundManager.playUIClick();
        cleanup();
      },
    });
    cancelButton.container.setDepth(102);
    cancelButton.card.hitZone.on('pointerover', () => cancelButton.setHoverState(true));
    cancelButton.card.hitZone.on('pointerout', () => cancelButton.setHoverState(false));

    const cleanup = () => {
      overlay.destroy();
      confirmCard.destroy();
      confirmButton.destroy();
      cancelButton.destroy();
    };
  }

  private performAscension(): void {
    const metaManager = getMetaProgressionManager();
    const ascensionManager = getAscensionManager();

    const accountLevel = metaManager.getAccountLevel();
    if (!ascensionManager.performAscension(accountLevel)) return;

    metaManager.resetAllUpgradesAndRefund();
    this.scene.restart();
  }
}
