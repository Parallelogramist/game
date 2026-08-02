/**
 * ToastManager.ts
 *
 * Manages toast notifications that slide in from the right side of the screen.
 * Used for milestone completions and other in-game notifications.
 */

import Phaser from 'phaser';
import { ToastConfig, SuppressedToast } from '../achievements/AchievementTypes';
import { createToastGateState, decideToast, ToastGateState } from './toastGate';
import { createIcon } from '../utils/IconRenderer';
import { computeHudScale } from '../utils/HudScale';
import { getSettingsManager } from '../settings';
import { ACCENT_COLORS, BODY_COLORS, MENU_COLORS } from '../visual/MenuStyle';
import { OverlayDepths } from '../visual/DepthLayers';

// Base toast dimensions (scaled by hudScale on small screens).
const BASE_TOAST_WIDTH = 300;
const BASE_TOAST_HEIGHT = 78;
const BASE_TOAST_MARGIN = 16;
const BASE_TOAST_PADDING = 14;
const SLIDE_DURATION = 300;
const DEFAULT_DISPLAY_DURATION = 3000;
const MAX_SUPPRESSED_TOASTS = 40;

const TOAST_BG_COLOR = BODY_COLORS.primary;
const TOAST_BORDER_COLOR = ACCENT_COLORS.neutral;
const TOAST_TITLE_COLOR = MENU_COLORS.headingWhite;
const TOAST_DESC_COLOR = MENU_COLORS.textBody;

/**
 * Top-right HUD objects a toast must not cover, by scene name. Ordered top to
 * bottom for readability only: the anchor takes the lowest bottom edge of
 * whichever ones the host scene actually built, so menus and the shop (which
 * build none of them) keep the old top-margin rest position.
 */
const RIGHT_RAIL_HUD_NAMES = [
  'pauseButtonBg',
  'killCountText',
  'goldPreviewText',
  'paceDeltaText',
  'relicStripContainer',
] as const;

type BoundedGameObject = Phaser.GameObjects.GameObject & { getBounds(): Phaser.Geom.Rectangle };

export class ToastManager {
  private scene: Phaser.Scene;
  private toastQueue: ToastConfig[] = [];
  private activeToast: Phaser.GameObjects.Container | null = null;
  private isAnimating: boolean = false;
  private gateState: ToastGateState = createToastGateState();
  private suppressed: SuppressedToast[] = [];
  private ungated: boolean = false;
  /** Kept so clearAll can cancel it: a stale hide timer used to null out a newer toast. */
  private hideTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Compute HUD scale factor for mobile screens. */
  private getHudScale(): number {
    return computeHudScale(this.scene.scale.width, this.scene.scale.height, getSettingsManager().getUiScale());
  }

  /**
   * Vertical center of the toast's rest pose. Toasts used to rest at the top
   * margin, which is exactly where the pause button and the kills/gold/pace
   * stack live, so every toast covered the only touch route into the pause
   * menu. These objects all carry scrollFactor 0, so their bounds are already
   * screen coordinates.
   */
  private computeRestCenterY(toastHeight: number, toastMargin: number): number {
    let railBottom = 0;
    for (const name of RIGHT_RAIL_HUD_NAMES) {
      const node = this.scene.children.getByName(name);
      if (!node || typeof (node as Partial<BoundedGameObject>).getBounds !== 'function') continue;
      const bounds = (node as BoundedGameObject).getBounds();
      if (bounds.bottom > railBottom) railBottom = bounds.bottom;
    }
    const restTop = railBottom > 0 ? railBottom + toastMargin : toastMargin;
    const lowestTop = this.scene.cameras.main.height - toastMargin - toastHeight;
    return Math.max(toastMargin, Math.min(restTop, lowestTop)) + toastHeight / 2;
  }

  /**
   * Queue a toast notification to display, if its tier earns the screen.
   * If no toast is currently showing, displays immediately.
   */
  showToast(config: ToastConfig): void {
    if (!this.ungated) {
      const verdict = decideToast(
        this.gateState,
        config.tier ?? 'notable',
        config.title,
        this.scene.time.now,
      );
      if (verdict === 'drop') return;
      if (verdict === 'suppress') {
        this.recordSuppressed(config);
        return;
      }
    }
    this.toastQueue.push(config);
    if (!this.activeToast && !this.isAnimating) {
      this.displayNextToast();
    }
  }

  private recordSuppressed(config: ToastConfig): void {
    this.suppressed.push({
      title: config.title,
      description: config.description,
      icon: config.icon,
      color: config.color,
      tier: config.tier ?? 'notable',
    });
    if (this.suppressed.length > MAX_SUPPRESSED_TOASTS) this.suppressed.shift();
  }

  /** Everything the gate refused to draw this session, oldest first. */
  getSuppressed(): SuppressedToast[] {
    return [...this.suppressed];
  }

  /** Menu scenes opt out of the diet: their toasts answer a tap the player just made. */
  setUngated(ungated: boolean): void {
    this.ungated = ungated;
  }

  /** New run: the rare budget and the critical cooldowns start over. */
  resetSession(): void {
    this.clearAll();
    this.gateState = createToastGateState();
    this.suppressed = [];
  }

  /**
   * Show a milestone completion toast with standard styling.
   */
  showMilestoneToast(
    name: string,
    description: string,
    icon: string,
    rewardText: string
  ): void {
    this.showToast({
      title: name,
      description: `${description}\n${rewardText}`,
      icon,
      color: 0xffdd44, // Gold for milestones
      duration: DEFAULT_DISPLAY_DURATION,
      tier: 'rare',
    });
  }

  /**
   * Show an achievement unlock toast with special styling.
   */
  showAchievementToast(name: string, description: string, icon: string): void {
    this.showToast({
      title: `Achievement: ${name}`,
      description,
      icon,
      color: 0x44ff88, // Green for achievements
      duration: 4000, // Slightly longer for achievements
      tier: 'rare',
    });
  }

  private displayNextToast(): void {
    if (this.toastQueue.length === 0 || this.isAnimating) {
      this.activeToast = null;
      return;
    }

    const config = this.toastQueue.shift()!;
    this.isAnimating = true;

    // Scale dimensions for mobile screens
    const hudScale = this.getHudScale();
    const screenWidth = this.scene.cameras.main.width;
    const toastMargin = Math.round(BASE_TOAST_MARGIN * hudScale);
    // Cap the panel to the viewport — at phone HUD scale the base width
    // exceeds a portrait screen, and the old right-anchor math (center at
    // width − toastWidth − margin) then shoved half the panel OFF-SCREEN
    // LEFT, covering the HP/XP bars.
    const toastWidth = Math.min(
      Math.round(BASE_TOAST_WIDTH * hudScale),
      screenWidth - toastMargin * 2,
    );
    const toastPadding = Math.round(BASE_TOAST_PADDING * hudScale);
    const textX = -toastWidth / 2 + toastPadding + Math.round(48 * hudScale);

    // Text is built before the panel, because the panel is sized from it: the
    // body used to be a fixed 78 units and any description of 3 lines or more
    // spilled straight out of it.
    const title = this.scene.add.text(textX, 0, config.title, {
      fontSize: `${Math.round(15 * hudScale)}px`,
      color: TOAST_TITLE_COLOR,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    title.setLetterSpacing(1.5);

    const desc = this.scene.add.text(textX, 0, config.description, {
      fontSize: `${Math.round(11 * hudScale)}px`,
      color: TOAST_DESC_COLOR,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      wordWrap: { width: toastWidth - Math.round(80 * hudScale) },
    });

    const titleDescGap = 4;
    const textBlockHeight = title.height + titleDescGap + desc.height;
    const toastHeight = Math.max(
      Math.round(BASE_TOAST_HEIGHT * hudScale),
      Math.round(textBlockHeight + toastPadding * 2),
    );

    // Create toast container
    const container = this.scene.add.container(0, 0);
    container.setDepth(OverlayDepths.HUD).setScrollFactor(0); // Toasts share the HUD band — above most game elements

    // Slide in from the right to a right-aligned rest (center = right edge
    // minus margin minus half width — the panel's RIGHT edge is flush).
    const startX = screenWidth + toastWidth;
    const endX = screenWidth - toastMargin - toastWidth / 2;
    const y = this.computeRestCenterY(toastHeight, toastMargin);

    container.setPosition(startX, y);

    // Panel: soft shadow + accent border + dark body + top accent line.
    const accentColor = config.color || TOAST_BORDER_COLOR;
    const bg = this.scene.add.graphics();
    const halfW = toastWidth / 2;
    const halfH = toastHeight / 2;
    const radius = 6;
    // Soft drop shadow.
    bg.fillStyle(0x000000, 0.4);
    bg.fillRoundedRect(-halfW, -halfH + 3, toastWidth, toastHeight, radius);
    // Accent ink border layer.
    bg.fillStyle(accentColor, 1);
    bg.fillRoundedRect(-halfW - 2, -halfH - 2, toastWidth + 4, toastHeight + 4, radius);
    // Body fill.
    bg.fillStyle(TOAST_BG_COLOR, 0.95);
    bg.fillRoundedRect(-halfW, -halfH, toastWidth, toastHeight, radius);
    // Hairline top accent.
    bg.fillStyle(accentColor, 0.65);
    bg.fillRect(-halfW + 4, -halfH + 2, toastWidth - 8, 2);
    // Bottom inner shadow.
    bg.fillStyle(0x000000, 0.22);
    bg.fillRect(-halfW + 4, halfH - 3, toastWidth - 8, 2);
    container.add(bg);

    // Wide accent strip down the left edge — color-channel identifier.
    const accent = this.scene.add.graphics();
    accent.fillStyle(accentColor, 1);
    accent.fillRoundedRect(
      -halfW,
      -halfH,
      6,
      toastHeight,
      { tl: radius, bl: radius, tr: 0, br: 0 },
    );
    container.add(accent);

    // Icon (if icon system is available)
    const iconSize = Math.round(32 * hudScale);
    const iconX = -toastWidth / 2 + toastPadding + Math.round(20 * hudScale);
    const iconY = 0;

    try {
      const iconImage = createIcon(this.scene, {
        x: iconX,
        y: iconY,
        iconKey: config.icon,
        size: iconSize,
        tint: config.color,
      });
      container.add(iconImage);
    } catch {
      // Fallback: simple colored circle if icon rendering fails
      const fallbackIcon = this.scene.add.circle(iconX, iconY, Math.round(16 * hudScale), config.color || 0xffdd44);
      container.add(fallbackIcon);
    }

    // Vertically center the measured block inside the panel it just sized.
    const blockTop = -textBlockHeight / 2;

    title.setOrigin(0, 0.5);
    title.setY(blockTop + title.height / 2);

    desc.setOrigin(0, 0.5);
    desc.setY(blockTop + title.height + titleDescGap + desc.height / 2);

    container.add(title);
    container.add(desc);

    this.activeToast = container;

    // Sound is now handled by the caller via SoundManager
    // (playAchievementUnlock in GameScene milestone/achievement callbacks)

    // Slide in animation
    this.scene.tweens.add({
      targets: container,
      x: endX,
      duration: SLIDE_DURATION,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Wait for display duration, then slide out
        this.hideTimer = this.scene.time.delayedCall(
          config.duration || DEFAULT_DISPLAY_DURATION,
          () => {
            this.hideTimer = null;
            this.slideOutToast(container);
          },
        );
      },
    });
  }

  private slideOutToast(container: Phaser.GameObjects.Container): void {
    const screenWidth = this.scene.cameras.main.width;
    const toastWidth = Math.round(BASE_TOAST_WIDTH * this.getHudScale());

    this.scene.tweens.add({
      targets: container,
      x: screenWidth + toastWidth,
      duration: SLIDE_DURATION,
      ease: 'Back.easeIn',
      onComplete: () => {
        container.destroy();
        this.activeToast = null;
        this.isAnimating = false;

        // Display next toast in queue if any
        if (this.toastQueue.length > 0) {
          this.displayNextToast();
        }
      },
    });
  }

  /**
   * Clear all pending toasts and hide current toast.
   */
  clearAll(): void {
    this.hideTimer?.remove();
    this.hideTimer = null;
    this.toastQueue = [];
    if (this.activeToast) {
      this.scene.tweens.killTweensOf(this.activeToast);
      this.activeToast.destroy();
      this.activeToast = null;
    }
    this.isAnimating = false;
  }

  /**
   * Get the number of pending toasts.
   */
  getPendingCount(): number {
    return this.toastQueue.length;
  }

  /**
   * Check if a toast is currently being displayed.
   */
  isActive(): boolean {
    return this.activeToast !== null || this.isAnimating;
  }

  /**
   * Destroy the manager and clean up all resources.
   */
  destroy(): void {
    this.clearAll();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE-LEVEL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// Store toast manager per scene (not a global singleton since it's scene-specific)
const sceneToastManagers = new WeakMap<Phaser.Scene, ToastManager>();

/**
 * Get or create a ToastManager for a specific scene.
 */
export function getToastManager(scene: Phaser.Scene): ToastManager {
  let manager = sceneToastManagers.get(scene);
  if (!manager) {
    manager = new ToastManager(scene);
    sceneToastManagers.set(scene, manager);
  }
  return manager;
}
