/**
 * TooltipManager — reusable tooltip system for game menus.
 *
 * Supports two modes:
 * - **Hover**: Shows tooltip immediately on pointerover, hides on pointerout
 * - **Keyboard focus**: Shows tooltip after a delay when navigated to via keyboard
 *
 * Usage:
 *   const tooltip = new TooltipManager(scene);
 *   tooltip.attach(textObject, 'This explains what this element does');
 *   // Call tooltip.destroy() in scene shutdown
 */
import Phaser from 'phaser';

const TOOLTIP_DEPTH = 2000;
const KEYBOARD_DELAY_MS = 2000;
const TOOLTIP_MAX_WIDTH = 280;
const TOOLTIP_PADDING = 10;
const TOOLTIP_OFFSET_Y = 12;
const TOOLTIP_BG_COLOR = 0x111122;
const TOOLTIP_BG_ALPHA = 0.95;
const TOOLTIP_BORDER_COLOR = 0x4488ff;
const TOOLTIP_BORDER_ALPHA = 0.6;

interface TooltipBinding {
  target: Phaser.GameObjects.GameObject;
  text: string;
  overHandler: () => void;
  outHandler: () => void;
}

export class TooltipManager {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private background: Phaser.GameObjects.Graphics | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  private bindings: TooltipBinding[] = [];
  private keyboardTimer: Phaser.Time.TimerEvent | null = null;
  private currentTarget: Phaser.GameObjects.GameObject | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Attach a tooltip to a game object. The object must be interactive (setInteractive).
   * For keyboard focus, call showForTarget/hideTooltip manually from the navigation system.
   */
  attach(target: Phaser.GameObjects.GameObject, tooltipText: string): void {
    if (!target.input) {
      (target as Phaser.GameObjects.Text).setInteractive({ useHandCursor: false });
    }

    const overHandler = () => {
      this.showAtPointer(tooltipText);
      this.currentTarget = target;
    };

    const outHandler = () => {
      if (this.currentTarget === target) {
        this.hideTooltip();
      }
    };

    target.on('pointerover', overHandler);
    target.on('pointerout', outHandler);

    this.bindings.push({ target, text: tooltipText, overHandler, outHandler });
  }

  /**
   * Show tooltip for a specific target after the keyboard delay.
   * Call this from keyboard navigation when focus changes.
   */
  showForTarget(target: Phaser.GameObjects.GameObject): void {
    this.hideTooltip();
    this.currentTarget = target;

    const binding = this.bindings.find(b => b.target === target);
    if (!binding) return;

    this.keyboardTimer = this.scene.time.delayedCall(KEYBOARD_DELAY_MS, () => {
      if (this.currentTarget !== target) return;
      this.showNearTarget(target, binding.text);
    });
  }

  /**
   * Cancel any pending keyboard tooltip and hide current tooltip.
   */
  hideTooltip(): void {
    if (this.keyboardTimer) {
      this.keyboardTimer.destroy();
      this.keyboardTimer = null;
    }
    this.currentTarget = null;
    if (this.container) {
      this.container.destroy();
      this.container = null;
      this.background = null;
      this.label = null;
    }
  }

  /**
   * Show tooltip at current pointer position.
   */
  private showAtPointer(text: string): void {
    const pointer = this.scene.input.activePointer;
    this.createTooltip(text, pointer.x, pointer.y - TOOLTIP_OFFSET_Y);
  }

  /**
   * Show tooltip near a target game object (for keyboard navigation).
   */
  private showNearTarget(target: Phaser.GameObjects.GameObject, text: string): void {
    const bounds = (target as unknown as Phaser.GameObjects.Components.GetBounds).getBounds?.();
    if (bounds) {
      this.createTooltip(text, bounds.centerX, bounds.top - TOOLTIP_OFFSET_Y);
    }
  }

  /**
   * Create and display the tooltip at given coordinates.
   */
  private createTooltip(text: string, x: number, y: number): void {
    // Remove any existing tooltip
    if (this.container) {
      this.container.destroy();
    }

    this.label = this.scene.add.text(0, 0, text, {
      fontSize: '13px',
      fontFamily: 'Arial',
      color: '#ccddff',
      wordWrap: { width: TOOLTIP_MAX_WIDTH - TOOLTIP_PADDING * 2 },
      lineSpacing: 3,
    });

    const textWidth = this.label.width;
    const textHeight = this.label.height;
    const boxWidth = textWidth + TOOLTIP_PADDING * 2;
    const boxHeight = textHeight + TOOLTIP_PADDING * 2;

    this.background = this.scene.add.graphics();
    // Border
    this.background.lineStyle(1, TOOLTIP_BORDER_COLOR, TOOLTIP_BORDER_ALPHA);
    this.background.fillStyle(TOOLTIP_BG_COLOR, TOOLTIP_BG_ALPHA);
    this.background.fillRoundedRect(0, 0, boxWidth, boxHeight, 4);
    this.background.strokeRoundedRect(0, 0, boxWidth, boxHeight, 4);

    this.label.setPosition(TOOLTIP_PADDING, TOOLTIP_PADDING);

    this.container = this.scene.add.container(0, 0, [this.background, this.label]);
    this.container.setDepth(TOOLTIP_DEPTH);
    this.container.setScrollFactor(0);

    // Position: center above the point, clamped to screen
    const screenWidth = this.scene.scale.width;
    const screenHeight = this.scene.scale.height;
    let tooltipX = x - boxWidth / 2;
    let tooltipY = y - boxHeight;

    // Clamp to screen edges
    tooltipX = Math.max(4, Math.min(tooltipX, screenWidth - boxWidth - 4));
    if (tooltipY < 4) {
      tooltipY = y + TOOLTIP_OFFSET_Y * 2; // Show below if no room above
    }
    tooltipY = Math.min(tooltipY, screenHeight - boxHeight - 4);

    this.container.setPosition(tooltipX, tooltipY);
  }

  /**
   * Clean up all bindings and the tooltip. Call in scene shutdown.
   */
  destroy(): void {
    this.hideTooltip();
    for (const binding of this.bindings) {
      binding.target.off('pointerover', binding.overHandler);
      binding.target.off('pointerout', binding.outHandler);
    }
    this.bindings = [];
  }
}
