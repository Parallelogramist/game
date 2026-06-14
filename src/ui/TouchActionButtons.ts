/**
 * TouchActionButtons.ts
 *
 * Floating action buttons for touch users: dash and fullscreen toggle.
 * Only visible when the player is using touch input (controlMode === 'joystick').
 */

import Phaser from 'phaser';

const BUTTON_DEPTH = 999; // Same depth level as joystick
const MIN_TOUCH_SIZE = 44;

export interface TouchActionButtonsOptions {
  onDash: () => void;
  onUltimate: () => void;
  hudScale: number;
}

export class TouchActionButtons {
  private scene: Phaser.Scene;
  private options: TouchActionButtonsOptions;

  // Dash button elements
  private dashContainer: Phaser.GameObjects.Container | null = null;
  private dashCooldownArc: Phaser.GameObjects.Graphics | null = null;
  private dashButtonRadius: number = 30;

  // Fullscreen button elements
  private fullscreenContainer: Phaser.GameObjects.Container | null = null;

  // Ultimate button elements
  private ultimateContainer: Phaser.GameObjects.Container | null = null;
  private ultimateBody: Phaser.GameObjects.Arc | null = null;
  private ultimateButtonRadius: number = 30;
  private ultimateReady: boolean = false;

  private enabled: boolean = true;

  constructor(scene: Phaser.Scene, options: TouchActionButtonsOptions) {
    this.scene = scene;
    this.options = options;
    this.createDashButton();
    this.createUltimateButton();
    this.createFullscreenButton();
    this.setVisible(false);
  }

  private createDashButton(): void {
    const scaledRadius = Math.max(30 * this.options.hudScale, MIN_TOUCH_SIZE / 2);
    this.dashButtonRadius = scaledRadius;

    this.dashContainer = this.scene.add.container(0, 0);
    this.dashContainer.setDepth(BUTTON_DEPTH);
    this.dashContainer.setScrollFactor(0);

    // Black ink silhouette behind body — Balatro cel-shading depth.
    const inkSilhouette = this.scene.add.circle(3, 4, scaledRadius + 4, 0x000000, 0.55);
    this.dashContainer.add(inkSilhouette);

    // Body — deep navy with bright accent border.
    const backgroundCircle = this.scene.add.circle(0, 0, scaledRadius, 0x1c2a4a, 0.85);
    backgroundCircle.setStrokeStyle(4, 0x66bbff, 0.95);
    this.dashContainer.add(backgroundCircle);

    // Top highlight stripe — Balatro banner feel.
    const dashHighlight = this.scene.add.graphics();
    dashHighlight.fillStyle(0x66bbff, 0.45);
    dashHighlight.fillEllipse(0, -scaledRadius * 0.7, scaledRadius * 1.1, 6);
    this.dashContainer.add(dashHighlight);

    // Cooldown arc overlay (drawn dynamically).
    this.dashCooldownArc = this.scene.add.graphics();
    this.dashCooldownArc.setScrollFactor(0);
    this.dashCooldownArc.setDepth(BUTTON_DEPTH + 1);

    // Dash icon — a simple arrow/bolt symbol
    const dashIcon = this.scene.add.text(0, 0, '\u21E8', {
      fontSize: `${Math.round(scaledRadius * 1.1)}px`,
      color: '#ffdd44',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
    });
    dashIcon.setOrigin(0.5);
    this.dashContainer.add(dashIcon);

    // Interactive hit area
    const hitArea = new Phaser.Geom.Circle(0, 0, scaledRadius);
    this.dashContainer.setInteractive(hitArea, Phaser.Geom.Circle.Contains);
    this.dashContainer.setName('dashButton');

    this.dashContainer.on('pointerdown', () => {
      if (!this.enabled) return;
      this.options.onDash();
      // Press feedback
      this.scene.tweens.add({
        targets: this.dashContainer,
        scaleX: 0.85,
        scaleY: 0.85,
        duration: 50,
        yoyo: true,
      });
    });

    this.positionDashButton();
  }

  private createUltimateButton(): void {
    const scaledRadius = Math.max(30 * this.options.hudScale, MIN_TOUCH_SIZE / 2);
    this.ultimateButtonRadius = scaledRadius;

    this.ultimateContainer = this.scene.add.container(0, 0);
    this.ultimateContainer.setDepth(BUTTON_DEPTH);
    this.ultimateContainer.setScrollFactor(0);

    // Black ink silhouette behind body — Balatro cel-shading depth.
    const inkSilhouette = this.scene.add.circle(3, 4, scaledRadius + 4, 0x000000, 0.55);
    this.ultimateContainer.add(inkSilhouette);

    // Body — deep navy with a gold accent border (matches the HUD ult meter).
    this.ultimateBody = this.scene.add.circle(0, 0, scaledRadius, 0x2a2410, 0.85);
    this.ultimateBody.setStrokeStyle(4, 0xffcc33, 0.95);
    this.ultimateContainer.add(this.ultimateBody);

    // Top highlight stripe — Balatro banner feel.
    const ultHighlight = this.scene.add.graphics();
    ultHighlight.fillStyle(0xffcc33, 0.45);
    ultHighlight.fillEllipse(0, -scaledRadius * 0.7, scaledRadius * 1.1, 6);
    this.ultimateContainer.add(ultHighlight);

    // Ultimate icon — a star/burst symbol.
    const ultIcon = this.scene.add.text(0, 0, '❖', {
      fontSize: `${Math.round(scaledRadius * 1.0)}px`,
      color: '#ffe9a8',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
    });
    ultIcon.setOrigin(0.5);
    this.ultimateContainer.add(ultIcon);

    // Interactive hit area
    const hitArea = new Phaser.Geom.Circle(0, 0, scaledRadius);
    this.ultimateContainer.setInteractive(hitArea, Phaser.Geom.Circle.Contains);
    this.ultimateContainer.setName('ultimateButton');

    this.ultimateContainer.on('pointerdown', () => {
      if (!this.enabled) return;
      this.options.onUltimate();
      this.scene.tweens.add({
        targets: this.ultimateContainer,
        scaleX: 0.85,
        scaleY: 0.85,
        duration: 50,
        yoyo: true,
      });
    });

    // Starts dimmed until charged.
    this.ultimateContainer.setAlpha(0.45);
    this.positionUltimateButton();
  }

  private createFullscreenButton(): void {
    // Only show fullscreen on devices that support it
    if (!document.fullscreenEnabled) return;

    const buttonSize = Math.max(22 * this.options.hudScale, MIN_TOUCH_SIZE / 2);

    this.fullscreenContainer = this.scene.add.container(0, 0);
    this.fullscreenContainer.setDepth(BUTTON_DEPTH);
    this.fullscreenContainer.setScrollFactor(0);

    // Black ink silhouette under panel (Balatro cel-shading depth).
    const fsInkLayer = this.scene.add.graphics();
    fsInkLayer.fillStyle(0x000000, 0.55);
    fsInkLayer.fillRoundedRect(-buttonSize + 2, -buttonSize + 3, buttonSize * 2, buttonSize * 2, 8);
    this.fullscreenContainer.add(fsInkLayer);

    // Body: deep navy with bright accent border.
    const backgroundRect = this.scene.add.rectangle(0, 0, buttonSize * 2, buttonSize * 2, 0x1c2a4a, 0.85);
    backgroundRect.setStrokeStyle(3, 0x8898b0, 0.85);
    this.fullscreenContainer.add(backgroundRect);

    // Fullscreen icon — expand brackets
    const fsIcon = this.scene.add.text(0, 0, '\u26F6', {
      fontSize: `${Math.round(buttonSize * 1.2)}px`,
      color: '#f0eedf',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    fsIcon.setOrigin(0.5);
    this.fullscreenContainer.add(fsIcon);

    // Interactive
    const hitArea = new Phaser.Geom.Rectangle(
      -buttonSize, -buttonSize, buttonSize * 2, buttonSize * 2
    );
    this.fullscreenContainer.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    this.fullscreenContainer.setName('fullscreenButton');

    this.fullscreenContainer.on('pointerdown', () => {
      if (this.scene.scale.isFullscreen) {
        this.scene.scale.stopFullscreen();
      } else {
        this.scene.scale.startFullscreen();
      }
    });

    this.positionFullscreenButton();
  }

  private positionDashButton(): void {
    if (!this.dashContainer) return;
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const padding = Math.max(20 * this.options.hudScale, 16);
    // Bottom-right, inset from edge
    this.dashContainer.setPosition(
      width - padding - this.dashButtonRadius,
      height - padding - this.dashButtonRadius - 60 * this.options.hudScale
    );
    if (this.dashCooldownArc) {
      this.dashCooldownArc.setPosition(
        this.dashContainer.x,
        this.dashContainer.y
      );
    }
  }

  private positionUltimateButton(): void {
    if (!this.ultimateContainer) return;
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const padding = Math.max(20 * this.options.hudScale, 16);
    // Bottom-right, stacked above the dash button.
    this.ultimateContainer.setPosition(
      width - padding - this.ultimateButtonRadius,
      height - padding - this.ultimateButtonRadius - (60 + 78) * this.options.hudScale
    );
  }

  /**
   * Update the ultimate button's charge visual: dimmed while filling, fully
   * bright once ready. Pulses on the transition into the ready state.
   */
  updateUltimateCharge(ratio: number, ready: boolean): void {
    if (!this.ultimateContainer) return;
    if (ready) {
      this.ultimateContainer.setAlpha(1);
      if (!this.ultimateReady) {
        // One-shot pop the moment it becomes ready.
        this.scene.tweens.killTweensOf(this.ultimateContainer);
        this.ultimateContainer.setScale(1.25);
        this.scene.tweens.add({
          targets: this.ultimateContainer,
          scale: 1.0,
          duration: 220,
          ease: 'Back.easeOut',
        });
      }
    } else {
      // Fade in as the meter fills (0.4 empty → ~0.85 nearly full).
      this.ultimateContainer.setAlpha(0.4 + Phaser.Math.Clamp(ratio, 0, 1) * 0.45);
    }
    this.ultimateReady = ready;
  }

  private positionFullscreenButton(): void {
    if (!this.fullscreenContainer) return;
    const width = this.scene.scale.width;
    const padding = Math.max(16 * this.options.hudScale, 12);
    const buttonSize = Math.max(22 * this.options.hudScale, MIN_TOUCH_SIZE / 2);
    // Top-right, to the left of the pause button area
    this.fullscreenContainer.setPosition(
      width - padding - buttonSize - 50 * this.options.hudScale,
      padding + buttonSize
    );
  }

  /**
   * Update the dash button cooldown visual.
   * remaining=0 means ready, remaining>0 shows a sweep arc.
   */
  updateDashCooldown(remaining: number, total: number): void {
    if (!this.dashCooldownArc || !this.dashContainer) return;

    this.dashCooldownArc.clear();

    if (remaining <= 0 || total <= 0) return;

    const progress = remaining / total; // 1.0 = full cooldown, 0.0 = ready
    const endAngle = -90 + (360 * progress);

    this.dashCooldownArc.fillStyle(0x000000, 0.5);
    this.dashCooldownArc.slice(
      this.dashContainer.x,
      this.dashContainer.y,
      this.dashButtonRadius,
      Phaser.Math.DegToRad(-90),
      Phaser.Math.DegToRad(endAngle),
      true // counter-clockwise: sweep reduces as cooldown expires
    );
    this.dashCooldownArc.fillPath();
  }

  /**
   * Show or hide the touch buttons.
   */
  setVisible(isVisible: boolean): void {
    if (this.dashContainer) this.dashContainer.setVisible(isVisible);
    if (this.dashCooldownArc) this.dashCooldownArc.setVisible(isVisible);
    if (this.ultimateContainer) this.ultimateContainer.setVisible(isVisible);
    if (this.fullscreenContainer) this.fullscreenContainer.setVisible(isVisible);
  }

  /**
   * Enable or disable button interactions (e.g., during pause).
   */
  setEnabled(isEnabled: boolean): void {
    this.enabled = isEnabled;
  }

  /**
   * Reposition buttons on screen resize.
   */
  handleResize(_width: number, _height: number): void {
    this.positionDashButton();
    this.positionUltimateButton();
    this.positionFullscreenButton();
  }

  /**
   * Returns true if the given screen point falls inside the dash button's touch
   * area — with an expanded buffer so finger roll-in to the joystick doesn't
   * accidentally press dash. Used by JoystickManager to skip spawning there.
   */
  isPointInDashButton(pointerX: number, pointerY: number): boolean {
    if (!this.dashContainer || !this.dashContainer.visible) return false;
    const buffer = this.dashButtonRadius * 0.5;
    const dx = pointerX - this.dashContainer.x;
    const dy = pointerY - this.dashContainer.y;
    const radius = this.dashButtonRadius + buffer;
    return dx * dx + dy * dy <= radius * radius;
  }

  /**
   * Returns true if the given screen point falls inside the ultimate button's
   * touch area (with the same finger-roll buffer as the dash button). Used by
   * JoystickManager to skip spawning a joystick there.
   */
  isPointInUltimateButton(pointerX: number, pointerY: number): boolean {
    if (!this.ultimateContainer || !this.ultimateContainer.visible) return false;
    const buffer = this.ultimateButtonRadius * 0.5;
    const dx = pointerX - this.ultimateContainer.x;
    const dy = pointerY - this.ultimateContainer.y;
    const radius = this.ultimateButtonRadius + buffer;
    return dx * dx + dy * dy <= radius * radius;
  }

  /**
   * Clean up all game objects.
   */
  destroy(): void {
    if (this.dashContainer) {
      this.dashContainer.destroy();
      this.dashContainer = null;
    }
    if (this.dashCooldownArc) {
      this.dashCooldownArc.destroy();
      this.dashCooldownArc = null;
    }
    if (this.ultimateContainer) {
      this.ultimateContainer.destroy();
      this.ultimateContainer = null;
      this.ultimateBody = null;
    }
    if (this.fullscreenContainer) {
      this.fullscreenContainer.destroy();
      this.fullscreenContainer = null;
    }
  }
}
