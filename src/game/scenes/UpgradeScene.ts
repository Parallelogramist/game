import Phaser from 'phaser';
import { Upgrade, getBlockingGate, getBlockingUpgrades } from '../../data/Upgrades';
import { getUpgradeRarityCardStyle } from '../../data/UpgradeRarity';
import { lockCapacity, toggleLockedId } from '../../data/upgradeLocks';
import { getEvolutionForWeapon } from '../../data/WeaponEvolutions';
import { createIcon } from '../../utils/IconRenderer';
import { SoundManager } from '../../audio/SoundManager';
import { TooltipManager } from '../../ui/TooltipManager';
import { MenuNavigator } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuOverlay, MenuOverlay } from '../../visual/MenuOverlay';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import {
  ACCENT_COLORS,
  ACCENT_COLORS_STR,
  BODY_COLORS,
  MENU_FONT,
  TEXT_COLORS,
} from '../../visual/MenuStyle';

/**
 * Data passed to UpgradeScene for initialization.
 */
export interface UpgradeSceneData {
  upgrades: Upgrade[];
  onSelect: (upgrade: Upgrade) => void;
  rerollsRemaining: number;
  skipsRemaining: number;
  banishesRemaining: number;
  /** Reroll keeps the locked cards — they are passed back so GameScene pins them. */
  onReroll: (lockedUpgrades: Upgrade[]) => void;
  onSkip: () => void;
  /** Banish refreshes the hand; the surviving locked cards are passed back to pin. */
  onBanish: (upgrade: Upgrade, lockedUpgrades: Upgrade[]) => void;
  isLastWeaponSlot?: boolean;
  weaponSlotsInfo?: { current: number; max: number };
  allStatUpgrades?: Upgrade[];
  playerLevel?: number;
  /** Ids of cards locked in a prior reroll/banish of this same level-up. */
  lockedUpgradeIds?: string[];
}

interface CardEntry {
  card: MenuCard;
  upgrade: Upgrade;
  index: number;
  /** Redraw the card's lock toggle to match the current locked state (if it has one). */
  refreshLock?: () => void;
}

/**
 * UpgradeScene — level-up card pick.
 *
 * Each upgrade is a flat card with a colored body + banner label. Cards
 * light up on hover and slide in from below on entry. Reroll/Skip/
 * Banish are pill buttons in the footer; banish confirmation is a centered
 * card-style dialog.
 *
 * Role coding:
 *  - Weapon level-ups → magenta body / magenta accent (offense flavor)
 *  - Stat upgrades  → teal body / teal accent (defense/utility flavor)
 *  - Weapon unlocks → primary body / primary accent (new toy)
 *  - Mastered upgrade banner → focus accent (golden punch)
 */
export class UpgradeScene extends Phaser.Scene {
  private upgrades: Upgrade[] = [];
  private onSelectCallback: ((upgrade: Upgrade) => void) | null = null;
  private cardEntries: CardEntry[] = [];
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private cardNavigator: MenuNavigator | null = null;
  private cardScaleFactor: number = 1;
  private entranceComplete: boolean = false;
  private cardEntranceDone: boolean[] = [];
  private soundManager!: SoundManager;
  private tooltipManager!: TooltipManager;

  private rerollsRemaining: number = 0;
  private skipsRemaining: number = 0;
  private banishesRemaining: number = 0;
  private onRerollCallback: ((lockedUpgrades: Upgrade[]) => void) | null = null;
  private onSkipCallback: (() => void) | null = null;
  private onBanishCallback: ((upgrade: Upgrade, lockedUpgrades: Upgrade[]) => void) | null = null;

  /** Cards the player has pinned — a reroll keeps these and reshuffles the rest. */
  private lockedUpgradeIds: Set<string> = new Set();

  private isBanishMode: boolean = false;
  private banishModeText: Phaser.GameObjects.Text | null = null;
  private banishConfirmElements: Phaser.GameObjects.GameObject[] = [];

  private isLastWeaponSlot: boolean = false;
  private weaponSlotsInfo: { current: number; max: number } | null = null;
  private allStatUpgrades: Upgrade[] = [];
  private playerLevel: number = 0;

  private menuOverlay: MenuOverlay | null = null;
  private utilityButtons: MenuButton[] = [];
  private overlayUpdateHandler: ((time: number, delta: number) => void) | null = null;

  constructor() {
    super({ key: 'UpgradeScene' });
  }

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
    this.isLastWeaponSlot = data.isLastWeaponSlot ?? false;
    this.weaponSlotsInfo = data.weaponSlotsInfo ?? null;
    this.allStatUpgrades = data.allStatUpgrades ?? [];
    this.playerLevel = data.playerLevel ?? 0;
    // Restore locks pinned in a prior reroll/banish of this same level-up, keeping
    // only ids still present in the (regenerated) hand.
    const presentIds = new Set(this.upgrades.map(u => u.id));
    this.lockedUpgradeIds = new Set((data.lockedUpgradeIds ?? []).filter(id => presentIds.has(id)));
  }

  /** Locking only matters when a reroll is available to pin against. */
  private canLock(): boolean {
    return this.rerollsRemaining > 0;
  }

  create(): void {
    this.cardEntries = [];
    this.utilityButtons = [];
    this.cardScaleFactor = 1;
    this.entranceComplete = false;
    this.soundManager = new SoundManager(this);
    this.tooltipManager = new TooltipManager(this);
    // Lock toggles sit on top of the card hit-zone; topOnly ensures clicking a
    // lock pip never also triggers the card's select underneath.
    this.input.setTopOnly(true);

    // Overlay backdrop — gameplay still bleeds through but cards pop.
    this.menuOverlay = createMenuOverlay(this, { dim: 0.7, drifterCount: 4 });
    this.overlayUpdateHandler = (_time, delta) => {
      this.menuOverlay?.update(delta);
      const seconds = _time / 1000;
      for (const entry of this.cardEntries) entry.card.tickIdle(seconds);
      for (const btn of this.utilityButtons) btn.tickIdle(seconds);
    };
    this.events.on('update', this.overlayUpdateHandler);

    const isWeaponMilestone = this.playerLevel > 0 && this.playerLevel % 5 === 0;
    const titleString = isWeaponMilestone ? 'WEAPON MILESTONE!' : 'LEVEL UP!';
    const titleColor = isWeaponMilestone ? ACCENT_COLORS_STR.primary : ACCENT_COLORS_STR.focus;
    const title = makeDisplayText(this, this.scale.width / 2, 80, titleString, {
      fontSize: 48,
      color: titleColor,
      strokeWidth: 6,
      letterSpacing: 3,
    });
    title.setDepth(1);

    const subtitleText = isWeaponMilestone ? 'Pick a new weapon!' : 'Choose an upgrade';
    const subtitle = makeBodyText(this, this.scale.width / 2, 130, subtitleText, {
      fontSize: 22,
      color: isWeaponMilestone ? ACCENT_COLORS_STR.primary : TEXT_COLORS.muted,
    });
    subtitle.setDepth(1);

    if (this.isLastWeaponSlot) {
      const warningCard = createMenuCard(this, {
        x: this.scale.width / 2,
        y: 175,
        width: 460,
        height: 50,
        bodyFillColor: BODY_COLORS.danger,
        accentColor: ACCENT_COLORS.focus,
        bannerHeight: 0,
        borderWidth: 2,
        borderColor: ACCENT_COLORS.focus,
        cornerRadius: 6,
        interactive: false,
        shadowOffsetY: 6,
        shadowAlpha: 0.4,
      });
      warningCard.container.setDepth(2);
      const warningLabel = makeDisplayText(this, 0, this.weaponSlotsInfo ? -8 : 0,
        '⚠ FINAL WEAPON SLOT — Choose wisely!', {
          fontSize: 16,
          color: ACCENT_COLORS_STR.focus,
        });
      warningCard.frame.add(warningLabel);
      if (this.weaponSlotsInfo) {
        const slotText = makeBodyText(this, 0, 10,
          `Weapons: ${this.weaponSlotsInfo.current}/${this.weaponSlotsInfo.max}`, {
            fontSize: 12,
            color: TEXT_COLORS.muted,
          });
        warningCard.frame.add(slotText);
      }
    }

    this.createUpgradeCards();
    this.createUtilityButtons();

    this.cardNavigator = new MenuNavigator({
      scene: this,
      columns: this.upgrades.length,
      items: this.cardEntries.map((entry) => ({
        onFocus: () => this.applyCardHover(entry.index),
        onBlur: () => this.applyCardUnhover(entry.index),
        onActivate: () => {
          if (!this.entranceComplete) return;
          if (this.banishConfirmElements.length > 0) return;
          if (this.isBanishMode) {
            this.banishUpgrade(entry.upgrade);
          } else {
            this.selectUpgrade(entry.upgrade);
          }
        },
      })),
      onCancel: () => {
        if (this.banishConfirmElements.length > 0) {
          this.destroyBanishConfirmation();
        } else if (this.isBanishMode) {
          this.toggleBanishMode();
        }
      },
      // Gamepad West/X — toggle lock on the focused card.
      onSecondary: () => this.toggleLockAtIndex(this.cardNavigator?.getSelectedIndex() ?? 0),
    });

    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.entranceComplete) return;
      if (this.banishConfirmElements.length > 0) return;

      const keyNumber = parseInt(event.key, 10);
      if (keyNumber >= 1 && keyNumber <= this.upgrades.length) {
        if (this.isBanishMode) {
          this.banishUpgrade(this.upgrades[keyNumber - 1]);
        } else {
          this.selectUpgrade(this.upgrades[keyNumber - 1]);
        }
      }
      if (event.key.toLowerCase() === 'r' && this.rerollsRemaining > 0) this.handleReroll();
      if (event.key.toLowerCase() === 'x' && this.skipsRemaining > 0) this.handleSkip();
      if (event.key.toLowerCase() === 'b' && this.banishesRemaining > 0) this.toggleBanishMode();
      if (event.key.toLowerCase() === 'l') this.toggleLockAtIndex(this.cardNavigator?.getSelectedIndex() ?? 0);
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);

    this.events.once('shutdown', this.shutdown, this);
    this.animateEntrance();
  }

  /** Hover effect — delegated to MenuCard.setFocusState for visual lift. */
  private applyCardHover(index: number): void {
    if (!this.entranceComplete) return;
    const entry = this.cardEntries[index];
    if (!entry) return;
    if (!this.cardEntranceDone[index]) return;
    entry.card.setHoverState(true);
  }

  private applyCardUnhover(index: number): void {
    if (!this.entranceComplete) return;
    const entry = this.cardEntries[index];
    if (!entry) return;
    if (!this.cardEntranceDone[index]) return;
    entry.card.setHoverState(false);
  }

  private fadeOutAndInvoke(callback: (() => void) | null): void {
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 150,
      onComplete: () => {
        callback?.();
        this.scene.stop();
      },
    });
  }

  private createUtilityButtons(): void {
    const buttonY = this.scale.height - 60;
    const buttonSpacing = 200;
    const startX = this.scale.width / 2 - buttonSpacing;

    // Discoverability: locking is only useful when a reroll can pin against it.
    if (this.canLock()) {
      const lockHint = makeBodyText(
        this, this.scale.width / 2, buttonY - 40,
        '🔒 Click a card\'s lock — or [L] / pad ✗ — to keep it on reroll',
        { fontSize: 13, color: TEXT_COLORS.muted },
      );
      lockHint.setDepth(10);
    }

    this.utilityButtons.push(
      this.createUtilityButton(
        startX, buttonY,
        `Reroll (${this.rerollsRemaining})  [R]`,
        'primary',
        this.rerollsRemaining > 0,
        () => this.handleReroll(),
        'Shuffle the upgrade choices. Lock cards first to keep them. Limited per run.',
      ),
    );
    this.utilityButtons.push(
      this.createUtilityButton(
        startX + buttonSpacing, buttonY,
        `Skip (${this.skipsRemaining})  [X]`,
        'neutral',
        this.skipsRemaining > 0,
        () => this.handleSkip(),
        'Skip this level-up entirely. The upgrades go back into the pool.',
      ),
    );
    this.utilityButtons.push(
      this.createUtilityButton(
        startX + buttonSpacing * 2, buttonY,
        `Banish (${this.banishesRemaining})  [B]`,
        this.isBanishMode ? 'danger' : 'magenta',
        this.banishesRemaining > 0,
        () => this.toggleBanishMode(),
        'Permanently remove an upgrade from this run\'s pool. Click a card to banish it.',
      ),
    );
  }

  private createUtilityButton(
    x: number,
    y: number,
    label: string,
    variant: 'primary' | 'neutral' | 'magenta' | 'danger',
    enabled: boolean,
    onClick: () => void,
    tooltip?: string,
  ): MenuButton {
    const button = createMenuButton({
      scene: this,
      x, y,
      width: 180,
      height: 46,
      label,
      variant,
      fontSize: 14,
      onActivate: () => {
        if (enabled) onClick();
      },
    });
    button.setEnabled(enabled);
    button.container.setDepth(10);

    button.card.hitZone.on('pointerover', () => {
      this.soundManager.playUIClick();
      button.setHoverState(true);
    });
    button.card.hitZone.on('pointerout', () => button.setHoverState(false));

    if (tooltip) this.tooltipManager.attach(button.card.hitZone, tooltip);
    return button;
  }

  private handleReroll(): void {
    if (this.rerollsRemaining <= 0 || !this.onRerollCallback) return;
    this.soundManager.playUIClick();
    const locked = this.getLockedUpgrades();
    this.fadeOutAndInvoke(() => this.onRerollCallback?.(locked));
  }

  /** Upgrades currently pinned, in hand order. */
  private getLockedUpgrades(): Upgrade[] {
    return this.upgrades.filter(u => this.lockedUpgradeIds.has(u.id));
  }

  /** Toggle the lock on the card at a navigator/keyboard index. */
  private toggleLockAtIndex(index: number): void {
    const entry = this.cardEntries[index];
    if (!entry) return;
    this.toggleLockForUpgrade(entry.upgrade.id);
  }

  /**
   * Toggle the lock for an upgrade id, respecting the leave-one-rerollable cap.
   * No-op while the entrance animation, banish mode, or banish confirmation is
   * active, or when locking can't help (no rerolls left).
   */
  private toggleLockForUpgrade(upgradeId: string): void {
    if (!this.entranceComplete) return;
    if (!this.canLock()) return;
    if (this.isBanishMode || this.banishConfirmElements.length > 0) return;

    const capacity = lockCapacity(this.upgrades.length);
    const next = toggleLockedId([...this.lockedUpgradeIds], upgradeId, capacity);
    const changed = next.length !== this.lockedUpgradeIds.size || next.some(id => !this.lockedUpgradeIds.has(id));
    if (!changed) return; // blocked by capacity — leave it unlocked, no feedback churn

    this.lockedUpgradeIds = new Set(next);
    this.soundManager.playUIClick();
    this.refreshLockVisuals();
  }

  private refreshLockVisuals(): void {
    for (const entry of this.cardEntries) entry.refreshLock?.();
  }

  private handleSkip(): void {
    if (this.skipsRemaining <= 0 || !this.onSkipCallback) return;
    this.soundManager.playUIClick();
    this.fadeOutAndInvoke(this.onSkipCallback);
  }

  private toggleBanishMode(): void {
    if (this.banishesRemaining <= 0 && !this.isBanishMode) return;
    this.soundManager.playUIClick();
    this.isBanishMode = !this.isBanishMode;

    if (this.isBanishMode) {
      this.banishModeText = makeDisplayText(this, this.scale.width / 2, 215,
        '🚫 BANISH MODE — Click an upgrade to remove it permanently', {
          fontSize: 16,
          color: ACCENT_COLORS_STR.danger,
        });
      this.banishModeText.setDepth(20);
    } else {
      this.banishModeText?.destroy();
      this.banishModeText = null;
    }
  }

  private banishUpgrade(upgrade: Upgrade): void {
    if (!this.isBanishMode || this.banishesRemaining <= 0 || !this.onBanishCallback) return;

    this.showBanishConfirmation(upgrade, () => {
      const selectedIndex = this.upgrades.indexOf(upgrade);
      const entry = this.cardEntries[selectedIndex];
      if (entry) {
        this.tweens.add({
          targets: entry.card.container,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: 300,
          ease: 'Back.easeIn',
          onComplete: () => {
            // The banished card can't survive — pass the other locked cards on.
            const survivingLocks = this.getLockedUpgrades().filter(u => u.id !== upgrade.id);
            this.onBanishCallback?.(upgrade, survivingLocks);
            this.scene.stop();
          },
        });
      }
    });
  }

  private showBanishConfirmation(upgrade: Upgrade, onConfirm: () => void): void {
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    const dimOverlay = this.add.rectangle(
      centerX, centerY, this.scale.width, this.scale.height, 0x000000, 0.6,
    ).setDepth(30);
    this.banishConfirmElements.push(dimOverlay);

    const confirmCard = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width: 380,
      height: 200,
      bodyFillColor: BODY_COLORS.danger,
      accentColor: ACCENT_COLORS.danger,
      bannerHeight: 36,
      borderWidth: 3,
      borderColor: ACCENT_COLORS.danger,
      cornerRadius: 8,
      interactive: false,
    });
    confirmCard.container.setDepth(31);

    const banner = makeDisplayText(this, 0, confirmCard.bannerTopY + 18, 'BANISH UPGRADE', {
      fontSize: 18,
      color: TEXT_COLORS.heading,
      letterSpacing: 2,
    });
    confirmCard.frame.add(banner);

    const warningText = makeBodyText(this, 0, -20, `Permanently remove\n"${upgrade.name}"?`, {
      fontSize: 18,
      color: ACCENT_COLORS_STR.focus,
    });
    warningText.setLineSpacing(4);
    confirmCard.frame.add(warningText);

    const subText = makeBodyText(this, 0, 26, 'This cannot be undone.', {
      fontSize: 12,
      color: TEXT_COLORS.muted,
    });
    confirmCard.frame.add(subText);

    this.banishConfirmElements.push(confirmCard.container);

    const confirmButton = createMenuButton({
      scene: this,
      x: centerX - 70,
      y: centerY + 70,
      width: 130,
      height: 42,
      label: 'Banish',
      variant: 'danger',
      fontSize: 15,
      onActivate: () => {
        this.destroyBanishConfirmation();
        onConfirm();
      },
    });
    confirmButton.container.setDepth(32);
    confirmButton.card.hitZone.on('pointerover', () => confirmButton.setHoverState(true));
    confirmButton.card.hitZone.on('pointerout', () => confirmButton.setHoverState(false));
    this.banishConfirmElements.push(confirmButton.container);

    const cancelButton = createMenuButton({
      scene: this,
      x: centerX + 70,
      y: centerY + 70,
      width: 130,
      height: 42,
      label: 'Cancel',
      variant: 'neutral',
      fontSize: 15,
      onActivate: () => {
        this.soundManager.playUIClick();
        this.destroyBanishConfirmation();
      },
    });
    cancelButton.container.setDepth(32);
    cancelButton.card.hitZone.on('pointerover', () => cancelButton.setHoverState(true));
    cancelButton.card.hitZone.on('pointerout', () => cancelButton.setHoverState(false));
    this.banishConfirmElements.push(cancelButton.container);
  }

  private destroyBanishConfirmation(): void {
    this.banishConfirmElements.forEach((el) => el.destroy());
    this.banishConfirmElements = [];
  }

  shutdown(): void {
    this.tooltipManager.destroy();

    if (this.overlayUpdateHandler) {
      this.events.off('update', this.overlayUpdateHandler);
      this.overlayUpdateHandler = null;
    }
    this.menuOverlay?.destroy();
    this.menuOverlay = null;

    if (this.cardNavigator) {
      this.cardNavigator.destroy();
      this.cardNavigator = null;
    }
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    for (const entry of this.cardEntries) entry.card.destroy();
    for (const btn of this.utilityButtons) btn.destroy();

    this.destroyBanishConfirmation();
    this.tweens.killAll();

    this.cardEntries = [];
    this.utilityButtons = [];
  }

  private createUpgradeCards(): void {
    const baseCardWidth = 280;
    const baseCardHeight = 340;
    const baseCardSpacing = 36;
    const baseRowSpacing = 28;
    const horizontalMargin = 60;

    const numCards = this.upgrades.length;
    const rows: Upgrade[][] = [];

    // Narrow (portrait) viewports wrap earlier: 4 cards on one 720-wide row
    // shrink to ~0.49× (unreadable); 2×2 keeps them at ~0.66× and portrait
    // has the vertical room to spare.
    const singleRowMax = this.scale.width < 800 ? 3 : 4;
    if (numCards <= singleRowMax) {
      rows.push(this.upgrades.slice());
    } else {
      const firstRowCount = Math.ceil(numCards / 2);
      rows.push(this.upgrades.slice(0, firstRowCount));
      rows.push(this.upgrades.slice(firstRowCount));
    }

    const numRows = rows.length;
    const maxCardsInAnyRow = Math.max(...rows.map((row) => row.length));
    const baseMaxRowWidth = maxCardsInAnyRow * baseCardWidth + (maxCardsInAnyRow - 1) * baseCardSpacing;
    const availableWidth = this.scale.width - horizontalMargin * 2;
    let scaleFactor = Math.min(1, availableWidth / baseMaxRowWidth);

    if (numRows > 1) {
      const verticalMarginTop = 200;
      const verticalMarginBottom = 110;
      const availableHeight = this.scale.height - verticalMarginTop - verticalMarginBottom;
      const baseTotalHeight = numRows * baseCardHeight + (numRows - 1) * baseRowSpacing;
      scaleFactor = Math.min(scaleFactor, availableHeight / baseTotalHeight);
    }

    this.cardScaleFactor = scaleFactor;
    const cardWidth = baseCardWidth * scaleFactor;
    const cardHeight = baseCardHeight * scaleFactor;
    const cardSpacing = baseCardSpacing * scaleFactor;
    const rowSpacing = baseRowSpacing * scaleFactor;

    const totalRowsHeight = numRows * cardHeight + (numRows - 1) * rowSpacing;
    const startY = this.scale.height / 2 - totalRowsHeight / 2 + cardHeight / 2 + 30;

    let globalIndex = 0;

    rows.forEach((rowUpgrades, rowIndex) => {
      const rowWidth = rowUpgrades.length * cardWidth + (rowUpgrades.length - 1) * cardSpacing;
      const rowStartX = (this.scale.width - rowWidth) / 2 + cardWidth / 2;
      const rowY = startY + rowIndex * (cardHeight + rowSpacing);

      rowUpgrades.forEach((upgrade, columnIndex) => {
        const cardX = rowStartX + columnIndex * (cardWidth + cardSpacing);
        const entry = this.createCardEntry(cardX, rowY, baseCardWidth, baseCardHeight, upgrade, globalIndex);
        entry.card.container.setScale(scaleFactor);
        this.cardEntries.push(entry);
        globalIndex++;
      });
    });
  }

  /** Pick a body+accent color role for an upgrade based on its type. */
  private resolveUpgradeRole(upgrade: Upgrade): { body: number; accent: number; accentStr: string } {
    const isWeaponLevel = upgrade.id.startsWith('level_');
    const isMastered = upgrade.currentLevel + 1 >= upgrade.maxLevel && upgrade.maxLevel > 1;
    // Limit Break overflow upgrades get the gold treatment to signal late-game power.
    if (upgrade.isOverflow) {
      return { body: BODY_COLORS.gold, accent: ACCENT_COLORS.focus, accentStr: ACCENT_COLORS_STR.focus };
    }
    if (isMastered) {
      return { body: BODY_COLORS.gold, accent: ACCENT_COLORS.focus, accentStr: ACCENT_COLORS_STR.focus };
    }
    // Rare/epic stat upgrades wear their rarity colors (blue/purple, matching
    // the relic rarity language). Weapon entries carry no rarity — unaffected.
    const rarityStyle = getUpgradeRarityCardStyle(upgrade.rarity);
    if (rarityStyle) {
      return { body: rarityStyle.body, accent: rarityStyle.accent, accentStr: rarityStyle.accentStr };
    }
    if (isWeaponLevel) {
      return { body: BODY_COLORS.magenta, accent: ACCENT_COLORS.magenta, accentStr: ACCENT_COLORS_STR.magenta };
    }
    if (upgrade.isStatUpgrade) {
      return { body: BODY_COLORS.teal, accent: ACCENT_COLORS.teal, accentStr: ACCENT_COLORS_STR.teal };
    }
    return { body: BODY_COLORS.primary, accent: ACCENT_COLORS.primary, accentStr: ACCENT_COLORS_STR.primary };
  }

  private createCardEntry(
    positionX: number,
    positionY: number,
    width: number,
    height: number,
    upgrade: Upgrade,
    index: number,
  ): CardEntry {
    const role = this.resolveUpgradeRole(upgrade);
    // Cards sit flat so every line of upgrade text reads cleanly.

    const card = createMenuCard(this, {
      x: positionX,
      y: positionY,
      width,
      height,
      pulseSeed: index * 0.7,
      bodyFillColor: role.body,
      accentColor: role.accent,
      bannerHeight: 44,
      borderWidth: 3,
      borderColor: role.accent,
      cornerRadius: 8,
    });
    card.container.setDepth(2);

    const textBoost = Math.min(1.2, 1 / this.cardScaleFactor);
    const halfH = height / 2;
    const halfW = width / 2;

    // Banner label — upgrade name.
    const bannerLabel = makeDisplayText(this, 0, card.bannerTopY + 22, upgrade.name.toUpperCase(), {
      fontSize: Math.round(18 * textBoost),
      color: TEXT_COLORS.heading,
      letterSpacing: 2,
    });
    card.frame.add(bannerLabel);

    // Icon disc — sits below the banner.
    const iconY = -halfH + 88;
    const iconBackground = this.add.circle(0, iconY, 38, 0x000000, 0.35);
    iconBackground.setStrokeStyle(2, role.accent);
    card.frame.add(iconBackground);

    const icon = createIcon(this, { x: 0, y: iconY, iconKey: upgrade.icon, size: 48 });
    card.frame.add(icon);

    // Level progress bar centered between icon and description.
    const levelIndicator = this.createLevelProgressBar(upgrade, textBoost, role.accent);
    levelIndicator.setPosition(0, iconY + 56);
    card.frame.add(levelIndicator);

    // Description.
    const maxTextWidth = width - 36;
    const wrapWidth = Math.min(maxTextWidth * textBoost, width - 24);
    let descriptionString = upgrade.getDescription(upgrade.currentLevel);
    const isMastered = upgrade.currentLevel + 1 >= upgrade.maxLevel && upgrade.maxLevel > 1;
    if (isMastered) descriptionString = descriptionString.replace(/^\[MASTERY\]\s*/i, '');

    const descriptionY = iconY + (isMastered ? 100 : 88);
    const descriptionFontSize = isMastered ? 15 : 17;
    const descriptionText = this.add.text(0, descriptionY, descriptionString, {
      fontSize: `${Math.round(descriptionFontSize * textBoost)}px`,
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.body,
      wordWrap: { width: wrapWidth },
      align: 'center',
    });
    descriptionText.setOrigin(0.5);
    card.frame.add(descriptionText);

    // Break level gate warning.
    let gateWarningHeight = 0;
    if (upgrade.isStatUpgrade && this.allStatUpgrades.length > 0) {
      const blockingGate = getBlockingGate(upgrade.currentLevel, this.allStatUpgrades);
      if (blockingGate !== null) {
        const blockingUpgrades = getBlockingUpgrades(blockingGate, this.allStatUpgrades);
        const blockingNames = blockingUpgrades.map((u) => u.name).slice(0, 3).join(', ');
        const gateText = this.add.text(
          0,
          descriptionY + descriptionText.height / 2 + 10,
          `Gate Lv.${blockingGate} — Level up: ${blockingNames}`,
          {
            fontSize: `${Math.round(11 * textBoost)}px`,
            fontFamily: MENU_FONT,
            color: TEXT_COLORS.danger,
            wordWrap: { width: wrapWidth },
            align: 'center',
          },
        );
        gateText.setOrigin(0.5);
        card.frame.add(gateText);
        gateWarningHeight = gateText.height + 8;
      }
    }

    // Flavor text.
    const flavorText = this.add.text(0, 0, upgrade.description, {
      fontSize: `${Math.round(13 * textBoost)}px`,
      fontFamily: MENU_FONT,
      color: TEXT_COLORS.dim,
      wordWrap: { width: wrapWidth },
      align: 'center',
    });
    flavorText.setOrigin(0.5);
    const flavorY =
      descriptionY + descriptionText.height / 2 + flavorText.height / 2 + 8 + gateWarningHeight;
    flavorText.setY(flavorY);
    card.frame.add(flavorText);

    // Evolution preview.
    let evolutionHintHeight = 0;
    const evolutionHintY = flavorY + flavorText.height / 2 + 12;
    if (upgrade.id.startsWith('level_') && upgrade.currentLevel >= 2) {
      const targetWeaponId = upgrade.id.slice('level_'.length);
      const evolutionRecipe = getEvolutionForWeapon(targetWeaponId);
      if (evolutionRecipe) {
        const requiredStatName = this.getStatDisplayName(evolutionRecipe.requiredStatId);
        const currentStatLevel = this.findStatLevel(evolutionRecipe.requiredStatId);
        const statReady = currentStatLevel >= evolutionRecipe.requiredStatLevel;
        const weaponWillBeReady = upgrade.currentLevel + 1 >= evolutionRecipe.requiredWeaponLevel;
        const bothReady = statReady && weaponWillBeReady;
        const hintLabel = bothReady
          ? `✦ EVOLUTION READY: ${evolutionRecipe.evolvedName}`
          : `✦ Evolves: Lv${evolutionRecipe.requiredWeaponLevel}  ·  ${requiredStatName} ${currentStatLevel}/${evolutionRecipe.requiredStatLevel}`;
        const evolutionText = bothReady
          ? makeDisplayText(this, 0, evolutionHintY, hintLabel, {
              fontSize: Math.round(13 * textBoost),
              color: ACCENT_COLORS_STR.focus,
              letterSpacing: 1,
            })
          : this.add
              .text(0, evolutionHintY, hintLabel, {
                fontSize: `${Math.round(12 * textBoost)}px`,
                fontFamily: MENU_FONT,
                color: ACCENT_COLORS_STR.primary,
                wordWrap: { width: wrapWidth },
                align: 'center',
              })
              .setOrigin(0.5);
        card.frame.add(evolutionText);
        evolutionHintHeight = evolutionText.height + 8;
      }
    }

    // Rarity tag — small label above the keybind chip on rare/epic cards.
    // Skipped when the gold treatment (overflow / mastered) owns the card.
    const rarityStyle = getUpgradeRarityCardStyle(upgrade.rarity);
    if (rarityStyle && !upgrade.isOverflow && !isMastered) {
      const rarityTag = makeDisplayText(this, 0, halfH - 44, rarityStyle.label, {
        fontSize: Math.round(12 * textBoost),
        color: rarityStyle.accentStr,
        letterSpacing: 1.5,
      });
      card.frame.add(rarityTag);
    }

    // Keybind chip — small pill label at card bottom.
    const keybindY = halfH - 20;
    const keybindText = makeDisplayText(this, 0, keybindY, `[ ${index + 1} ]`, {
      fontSize: Math.round(13 * textBoost),
      color: TEXT_COLORS.muted,
      letterSpacing: 1,
    });
    card.frame.add(keybindText);
    void evolutionHintHeight;
    void halfW;

    // Pointer interactivity — defer to entranceComplete gating.
    card.hitZone.on('pointerover', () => {
      if (!this.entranceComplete) return;
      this.soundManager.playUIClick();
      card.setHoverState(true);
    });
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerdown', () => {
      if (!this.entranceComplete) return;
      if (this.banishConfirmElements.length > 0) return;
      if (this.isBanishMode) {
        this.banishUpgrade(upgrade);
      } else {
        this.selectUpgrade(upgrade);
      }
    });

    // Lock pip (top-right) — only meaningful when a reroll is available to pin against.
    const refreshLock = this.canLock()
      ? this.createLockToggle(card, upgrade, width, height, textBoost)
      : undefined;

    return { card, upgrade, index, refreshLock };
  }

  /**
   * Build the per-card lock pip in the top-right corner. Clicking it pins the
   * card so a reroll keeps it. Sits above the card's hit-zone (topOnly) so it
   * never also triggers select. Returns a redraw closure.
   */
  private createLockToggle(
    card: MenuCard,
    upgrade: Upgrade,
    width: number,
    height: number,
    textBoost: number,
  ): () => void {
    const halfW = width / 2;
    const halfH = height / 2;
    const radius = 16;
    const holder = this.add.container(halfW - radius - 10, -halfH + 64);
    holder.setDepth(5);

    const background = this.add.circle(0, 0, radius, 0x000000, 0.45);
    background.setStrokeStyle(2, 0x6a6a7e);
    background.setInteractive({ useHandCursor: true });
    holder.add(background);

    const padlock = this.add.graphics();
    holder.add(padlock);

    const hint = makeDisplayText(this, 0, radius + 9, 'L', {
      fontSize: Math.round(10 * textBoost),
      color: TEXT_COLORS.muted,
      letterSpacing: 1,
    });
    holder.add(hint);

    card.frame.add(holder);

    const redraw = (): void => {
      const locked = this.lockedUpgradeIds.has(upgrade.id);
      const color = locked ? ACCENT_COLORS.focus : 0x9a9aae;
      background.setStrokeStyle(2.5, locked ? ACCENT_COLORS.focus : 0x6a6a7e);
      background.setFillStyle(0x000000, locked ? 0.6 : 0.4);
      this.drawPadlock(padlock, color, locked);
    };

    background.on('pointerover', () => {
      if (!this.entranceComplete) return;
      background.setScale(1.15);
    });
    background.on('pointerout', () => background.setScale(1));
    background.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event?: Phaser.Types.Input.EventData) => {
        event?.stopPropagation();
        this.toggleLockForUpgrade(upgrade.id);
      },
    );

    redraw();
    return redraw;
  }

  /** Draw a tiny padlock glyph — gold + closed shackle when locked, dim + ajar when not. */
  private drawPadlock(graphics: Phaser.GameObjects.Graphics, color: number, locked: boolean): void {
    graphics.clear();
    const bodyWidth = 13;
    const bodyHeight = 10;
    const bodyTop = -2;
    const shackleRadius = 5;

    // Shackle — top arch (north half, since screen-y points down). Closed when
    // locked; the unlocked one is shifted + cut short so it reads as "open".
    graphics.lineStyle(2.2, color, locked ? 1 : 0.85);
    graphics.beginPath();
    if (locked) {
      graphics.arc(0, bodyTop, shackleRadius, Math.PI, Math.PI * 2, false);
    } else {
      graphics.arc(2, bodyTop, shackleRadius, Math.PI, Math.PI * 1.7, false);
    }
    graphics.strokePath();

    // Body.
    graphics.fillStyle(color, locked ? 1 : 0.45);
    graphics.fillRoundedRect(-bodyWidth / 2, bodyTop, bodyWidth, bodyHeight, 2);

    // Keyhole.
    graphics.fillStyle(0x161620, 0.9);
    graphics.fillCircle(0, bodyTop + bodyHeight / 2, 1.6);
  }

  private getStatDisplayName(statId: string): string {
    const matching = this.allStatUpgrades.find((candidate) => candidate.id === statId);
    if (matching) return matching.name;
    return statId.charAt(0).toUpperCase() + statId.slice(1);
  }

  private findStatLevel(statId: string): number {
    const matching = this.allStatUpgrades.find((candidate) => candidate.id === statId);
    return matching ? matching.currentLevel : 0;
  }

  private createLevelProgressBar(
    upgrade: Upgrade,
    textBoost: number,
    accentColor: number,
  ): Phaser.GameObjects.Container | Phaser.GameObjects.Text {
    const filled = upgrade.currentLevel + 1;
    const total = upgrade.maxLevel;

    // Overflow upgrades stack without a meaningful cap — show the stack count
    // rather than a (potentially huge) segmented bar.
    if (upgrade.isOverflow) {
      return makeDisplayText(this, 0, 0, `LIMIT BREAK · Lv.${filled}`, {
        fontSize: Math.round(14 * textBoost),
        color: ACCENT_COLORS_STR.focus,
        letterSpacing: 1.2,
      });
    }

    if (filled >= total && total > 1) {
      return makeDisplayText(this, 0, 0, '★ MASTERED ★', {
        fontSize: Math.round(15 * textBoost),
        color: ACCENT_COLORS_STR.focus,
        letterSpacing: 1.5,
      });
    }

    const barContainer = this.add.container(0, 0);
    const segmentWidth = 12 * textBoost;
    const segmentHeight = 8 * textBoost;
    const segmentGap = 3 * textBoost;
    const skew = 3 * textBoost;

    const totalWidth = total * (segmentWidth + skew) + (total - 1) * segmentGap;
    const startX = -totalWidth / 2;
    const previewIndex = filled - 1;

    for (let i = 0; i < total; i++) {
      const isFilled = i < filled;
      const isPreview = i === previewIndex && previewIndex >= 0;
      const x = startX + i * (segmentWidth + skew + segmentGap);

      const points = [
        skew, -segmentHeight / 2,
        segmentWidth + skew, -segmentHeight / 2,
        segmentWidth, segmentHeight / 2,
        0, segmentHeight / 2,
      ];

      const fillColor = isFilled ? accentColor : 0x000000;
      const segment = this.add.polygon(x + segmentWidth / 2, 0, points, fillColor, isFilled ? 1 : 0.4);

      if (isPreview) {
        segment.setStrokeStyle(1.5, accentColor);
      } else if (!isFilled) {
        segment.setStrokeStyle(1, 0x5a5a7a);
      }
      barContainer.add(segment);
    }

    return barContainer;
  }

  private selectUpgrade(upgrade: Upgrade): void {
    this.soundManager.playUpgradeSelect();
    this.input.keyboard?.removeAllListeners();
    for (const entry of this.cardEntries) entry.card.hitZone.removeAllListeners();

    const selectedIndex = this.upgrades.indexOf(upgrade);
    const selectedEntry = this.cardEntries[selectedIndex];

    if (selectedEntry) {
      // Fade out unselected cards.
      this.cardEntries.forEach((entry, idx) => {
        if (idx !== selectedIndex) {
          this.tweens.add({
            targets: entry.card.container,
            alpha: 0,
            scaleX: this.cardScaleFactor * 0.9,
            scaleY: this.cardScaleFactor * 0.9,
            duration: 150,
            ease: 'Quad.easeIn',
          });
        }
      });

      // Selected card punch + close.
      this.tweens.add({
        targets: selectedEntry.card.container,
        scaleX: this.cardScaleFactor * 1.12,
        scaleY: this.cardScaleFactor * 1.12,
        duration: 150,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: selectedEntry.card.container,
            scaleX: this.cardScaleFactor * 1.05,
            scaleY: this.cardScaleFactor * 1.05,
            duration: 100,
            ease: 'Quad.easeOut',
            onComplete: () => this.closeAndApply(upgrade),
          });
        },
      });
    } else {
      this.closeAndApply(upgrade);
    }
  }

  private closeAndApply(upgrade: Upgrade): void {
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 20,
      onComplete: () => {
        this.onSelectCallback?.(upgrade);
        this.scene.stop();
      },
    });
  }

  private animateEntrance(): void {
    this.time.delayedCall(80, () => {
      this.entranceComplete = true;
    });

    this.cardEntranceDone = this.cardEntries.map(() => false);

    this.cardEntries.forEach((entry, index) => {
      const targetY = entry.card.container.y;
      entry.card.container.y = this.scale.height + 200;
      entry.card.container.alpha = 0;

      this.tweens.add({
        targets: entry.card.container,
        y: targetY,
        alpha: 1,
        duration: 400,
        delay: index * 90,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.cardEntranceDone[index] = true;
        },
      });
    });
  }
}
