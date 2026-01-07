/**
 * ToastManager.ts
 *
 * Manages toast notifications that slide in from the right side of the screen.
 * Used for milestone completions and other in-game notifications.
 */

import Phaser from 'phaser';
import { ToastConfig } from '../achievements/AchievementTypes';
import { createIcon } from '../utils/IconRenderer';

// Toast configuration
const TOAST_WIDTH = 280;
const TOAST_HEIGHT = 70;
const TOAST_MARGIN = 16;
const TOAST_PADDING = 12;
const SLIDE_DURATION = 300;
const DEFAULT_DISPLAY_DURATION = 3000;

// Visual styling
const TOAST_BG_COLOR = 0x1a1a2e;
const TOAST_BORDER_COLOR = 0x4a4a7a;
const TOAST_TITLE_COLOR = '#ffdd44';
const TOAST_DESC_COLOR = '#aaaacc';

export class ToastManager {
  private scene: Phaser.Scene;
  private toastQueue: ToastConfig[] = [];
  private activeToast: Phaser.GameObjects.Container | null = null;
  private isAnimating: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
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
      playSound: true,
    });
  }

  /**
   * Show an achievement unlock toast with special styling.
   */
  showAchievementToast(name: string, description: string, icon: string): void {
    this.showToast({
      title: `🏆 ${name}`,
      description,
      icon,
      color: 0x44ff88, // Green for achievements
      duration: 4000, // Slightly longer for achievements
      playSound: true,
    });
  }

  private displayNextToast(): void {
    if (this.toastQueue.length === 0 || this.isAnimating) {
      this.activeToast = null;
      return;
    }

    const config = this.toastQueue.shift()!;
    this.isAnimating = true;

    // Create toast container
    const container = this.scene.add.container(0, 0);
    container.setDepth(1000); // Above most game elements

    // Position off-screen to the right
    const screenWidth = this.scene.cameras.main.width;
    const startX = screenWidth + TOAST_WIDTH;
    const endX = screenWidth - TOAST_WIDTH - TOAST_MARGIN;
    const y = TOAST_MARGIN + TOAST_HEIGHT / 2;

    container.setPosition(startX, y);

    // Background
    const bg = this.scene.add.graphics();
    bg.fillStyle(TOAST_BG_COLOR, 0.95);
    bg.lineStyle(2, config.color || TOAST_BORDER_COLOR, 1);
    bg.fillRoundedRect(
      -TOAST_WIDTH / 2,
      -TOAST_HEIGHT / 2,
      TOAST_WIDTH,
      TOAST_HEIGHT,
      8
    );
    bg.strokeRoundedRect(
      -TOAST_WIDTH / 2,
      -TOAST_HEIGHT / 2,
      TOAST_WIDTH,
      TOAST_HEIGHT,
      8
    );
    container.add(bg);

    // Accent line on left
    const accent = this.scene.add.graphics();
    accent.fillStyle(config.color || 0xffdd44, 1);
    accent.fillRoundedRect(
      -TOAST_WIDTH / 2,
      -TOAST_HEIGHT / 2,
      4,
      TOAST_HEIGHT,
      { tl: 8, bl: 8, tr: 0, br: 0 }
    );
    container.add(accent);

    // Icon (if icon system is available)
    const iconX = -TOAST_WIDTH / 2 + TOAST_PADDING + 20;
    const iconY = 0;

    try {
      const iconImage = createIcon(this.scene, {
        x: iconX,
        y: iconY,
        iconKey: config.icon,
        size: 32,
        tint: config.color,
      });
      container.add(iconImage);
    } catch {
      // Fallback: simple colored circle if icon rendering fails
      const fallbackIcon = this.scene.add.circle(iconX, iconY, 16, config.color || 0xffdd44);
      container.add(fallbackIcon);
    }

    // Title text (create first to measure height)
    const textX = -TOAST_WIDTH / 2 + TOAST_PADDING + 48;
    const title = this.scene.add.text(textX, 0, config.title, {
      fontSize: '14px',
      color: TOAST_TITLE_COLOR,
      fontFamily: 'Arial',
      fontStyle: 'bold',
    });

    // Description text (can be multi-line)
    const desc = this.scene.add.text(textX, 0, config.description, {
      fontSize: '11px',
      color: TOAST_DESC_COLOR,
      fontFamily: 'Arial',
      wordWrap: { width: TOAST_WIDTH - 80 },
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

    // Play sound if requested
    if (config.playSound) {
      try {
        // Try to play the level-up sound for milestone notifications
        this.scene.sound.play('levelup', { volume: 0.5 });
      } catch {
        // Sound may not be loaded, ignore
      }
    }

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

    this.scene.tweens.add({
      targets: container,
      x: screenWidth + TOAST_WIDTH,
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
