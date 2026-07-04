/**
 * ToastManager.ts
 *
 * Manages toast notifications that slide in from the right side of the screen.
 * Used for milestone completions and other in-game notifications.
 */

import Phaser from 'phaser';
import { ToastConfig } from '../achievements/AchievementTypes';
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

const TOAST_BG_COLOR = BODY_COLORS.primary;
const TOAST_BORDER_COLOR = ACCENT_COLORS.neutral;
const TOAST_TITLE_COLOR = MENU_COLORS.headingWhite;
const TOAST_DESC_COLOR = MENU_COLORS.textBody;

export class ToastManager {
  private scene: Phaser.Scene;
  private toastQueue: ToastConfig[] = [];
  private activeToast: Phaser.GameObjects.Container | null = null;
  private isAnimating: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Compute HUD scale factor for mobile screens. */
  private getHudScale(): number {
    return computeHudScale(this.scene.scale.width, this.scene.scale.height, getSettingsManager().getUiScale());
  }

  /**
   * Queue a toast notification to display.
   * If no toast is currently showing, displays immediately.
   */
  showToast(config: ToastConfig): void {
    this.toastQueue.push(config);
    if (!this.activeToast && !this.isAnimating) {
      this.displayNextToast();
    }
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
    const toastHeight = Math.round(BASE_TOAST_HEIGHT * hudScale);
    const toastPadding = Math.round(BASE_TOAST_PADDING * hudScale);

    // Create toast container
    const container = this.scene.add.container(0, 0);
    container.setDepth(OverlayDepths.HUD); // Toasts share the HUD band — above most game elements

    // Slide in from the right to a right-aligned rest (center = right edge
    // minus margin minus half width — the panel's RIGHT edge is flush).
    const startX = screenWidth + toastWidth;
    const endX = screenWidth - toastMargin - toastWidth / 2;
    const y = toastMargin + toastHeight / 2;

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

    // Title — display style.
    const textX = -toastWidth / 2 + toastPadding + Math.round(48 * hudScale);
    const title = this.scene.add.text(textX, 0, config.title, {
      fontSize: `${Math.round(15 * hudScale)}px`,
      color: TOAST_TITLE_COLOR,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    title.setLetterSpacing(1.5);

    // Description text (can be multi-line).
    const desc = this.scene.add.text(textX, 0, config.description, {
      fontSize: `${Math.round(11 * hudScale)}px`,
      color: TOAST_DESC_COLOR,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      wordWrap: { width: toastWidth - Math.round(80 * hudScale) },
    });

    // Calculate vertical centering based on actual text heights
    const gap = 4;
    const totalHeight = title.height + gap + desc.height;
    const blockTop = -totalHeight / 2;

    // Position title and description with vertical centering origin
    title.setOrigin(0, 0.5);
    title.setY(blockTop + title.height / 2);

    desc.setOrigin(0, 0.5);
    desc.setY(blockTop + title.height + gap + desc.height / 2);

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
        this.scene.time.delayedCall(config.duration || DEFAULT_DISPLAY_DURATION, () => {
          this.slideOutToast(container);
        });
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
