import Phaser from 'phaser';
import { NeonColorPair } from './NeonColors';
import { ICON_ATLAS_KEY } from '../utils/IconRenderer';
import { getIconFrame } from '../utils/IconMap';

/**
 * Shield Barrier neon colors - cyan theme
 */
const SHIELD_NEON: NeonColorPair = {
  core: 0x44ffff,  // Bright cyan
  glow: 0x22aaaa,  // Darker cyan glow
};

const SHIELD_DOT_FILLED = 0x44ffff;   // Cyan for filled charges
const SHIELD_DOT_EMPTY = 0x224444;    // Dark cyan for empty slots
const SHIELD_DOT_RECHARGING = 0x66ddff; // Lighter cyan for recharging

/**
 * ShieldBarrierVisual - Manages honeycomb shield display and charge indicators
 *
 * Visual Elements:
 * 1. Honeycomb pattern (7 hexagons) - shown when shields > 0
 * 2. Charge dots - arc of dots showing current/max charges
 * 3. Recharge progress - pulsing dot for next charge
 */
export class ShieldBarrierVisual {
  private scene: Phaser.Scene;

  // Honeycomb shield (active protection visual)
  private honeycombContainer: Phaser.GameObjects.Container | null = null;
  private hexagonGraphics: Phaser.GameObjects.Graphics[] = [];
  private rotationAngle: number = 0;

  // Charge indicators (shield icons showing charges)
  private chargeDotsContainer: Phaser.GameObjects.Container | null = null;
  private chargeDots: Phaser.GameObjects.Image[] = [];
  private currentMaxCharges: number = 0;

  // Recharge circle (draws progressively as shield recharges)
  private rechargeCircleGraphics: Phaser.GameObjects.Graphics | null = null;

  // State tracking
  private isVisible: boolean = false;

  // Configuration
  private readonly HONEYCOMB_RADIUS = 28;      // Distance from player center
  private readonly HEXAGON_SIZE = 8;           // Size of each hexagon
  private readonly ROTATION_SPEED = 0.3;       // Radians per second
  private readonly SHIELD_ICON_SIZE = 16;      // Shield icon display size (atlas is 64px)
  private readonly DOT_ARC_RADIUS = 38;        // Distance for dot arc
  private readonly DOT_ARC_SPREAD = Math.PI * 0.8; // 144 degrees total spread
  private readonly RECHARGE_CIRCLE_RADIUS = 45; // Radius of recharge progress circle

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Update the shield visual each frame.
   */
  update(
    playerX: number,
    playerY: number,
    charges: number,
    maxCharges: number,
    rechargeProgress: number
  ): void {
    // Handle visibility based on whether shield system is active
    const shouldBeVisible = maxCharges > 0;

    if (shouldBeVisible && !this.isVisible) {
      this.createVisuals(maxCharges);
      this.isVisible = true;
    } else if (!shouldBeVisible && this.isVisible) {
      this.destroyVisuals();
      this.isVisible = false;
      return;
    }

    if (!this.isVisible) return;

    // Recreate charge dots if max charges changed
    if (maxCharges !== this.currentMaxCharges) {
      this.recreateChargeDots(maxCharges);
    }

    // Update positions
    if (this.honeycombContainer) {
      this.honeycombContainer.setPosition(playerX, playerY);

      // Rotate honeycomb slowly
      this.rotationAngle += this.ROTATION_SPEED * (1 / 60); // Assuming ~60fps
      this.honeycombContainer.setRotation(this.rotationAngle);

      // Show/hide honeycomb based on charges
      this.honeycombContainer.setVisible(charges > 0);
      this.honeycombContainer.setAlpha(charges > 0 ? 0.5 : 0);
    }

    if (this.chargeDotsContainer) {
      this.chargeDotsContainer.setPosition(playerX, playerY);
    }

    // Update charge dot states
    this.updateChargeDots(charges, maxCharges, rechargeProgress);

    // Update recharge circle animation
    this.updateRechargeCircle(playerX, playerY, charges, maxCharges, rechargeProgress);
  }

  /**
   * Called when a shield charge is consumed by blocking damage.
   */
  onHit(): void {
    if (!this.honeycombContainer) return;

    // Flash white briefly
    this.honeycombContainer.setAlpha(1);

    // Quick scale pulse
    this.scene.tweens.add({
      targets: this.honeycombContainer,
      scaleX: 1.3,
      scaleY: 1.3,
      alpha: 0.5,
      duration: 100,
      ease: 'Power2',
      yoyo: true,
      onComplete: () => {
        if (this.honeycombContainer) {
          this.honeycombContainer.setScale(1);
        }
      },
    });
  }

  /**
   * Called when a shield charge finishes recharging.
   */
  onChargeGained(): void {
    if (!this.honeycombContainer) return;

    // Pop-in animation for honeycomb
    this.honeycombContainer.setScale(0.8);
    this.scene.tweens.add({
      targets: this.honeycombContainer,
      scaleX: 1,
      scaleY: 1,
      duration: 200,
      ease: 'Back.easeOut',
    });
  }

  /**
   * Create all visual elements.
   */
  private createVisuals(maxCharges: number): void {
    this.createHoneycomb();
    this.createChargeDots(maxCharges);
    this.createRechargeCircle();
  }

  /**
   * Create the recharge circle graphics object.
   */
  private createRechargeCircle(): void {
    this.rechargeCircleGraphics = this.scene.add.graphics();
    this.rechargeCircleGraphics.setDepth(92); // Above charge dots
  }

  /**
   * Destroy all visual elements.
   */
  private destroyVisuals(): void {
    if (this.honeycombContainer) {
      this.honeycombContainer.destroy();
      this.honeycombContainer = null;
    }
    this.hexagonGraphics = [];

    if (this.chargeDotsContainer) {
      this.chargeDotsContainer.destroy();
      this.chargeDotsContainer = null;
    }
    this.chargeDots = [];
    this.currentMaxCharges = 0;

    if (this.rechargeCircleGraphics) {
      this.rechargeCircleGraphics.destroy();
      this.rechargeCircleGraphics = null;
    }
  }

  /**
   * Create the honeycomb pattern (7 hexagons in flower arrangement).
   */
  private createHoneycomb(): void {
    this.honeycombContainer = this.scene.add.container(0, 0);
    this.honeycombContainer.setDepth(90); // Below player but visible
    this.hexagonGraphics = [];

    // Center hexagon
    const centerHex = this.createSingleHexagon();
    this.honeycombContainer.add(centerHex);
    this.hexagonGraphics.push(centerHex);

    // 6 surrounding hexagons at 60-degree intervals
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2; // Start from top
      const hexX = Math.cos(angle) * this.HONEYCOMB_RADIUS * 0.7;
      const hexY = Math.sin(angle) * this.HONEYCOMB_RADIUS * 0.7;

      const hex = this.createSingleHexagon();
      hex.setPosition(hexX, hexY);
      this.honeycombContainer.add(hex);
      this.hexagonGraphics.push(hex);
    }
  }

  /**
   * Create a single hexagon graphic.
   */
  private createSingleHexagon(): Phaser.GameObjects.Graphics {
    const graphics = this.scene.add.graphics();

    // Draw glow layer
    graphics.fillStyle(SHIELD_NEON.glow, 0.3);
    this.drawHexagonPath(graphics, this.HEXAGON_SIZE * 1.3);
    graphics.fillPath();

    // Draw core hexagon
    graphics.fillStyle(SHIELD_NEON.core, 0.4);
    graphics.lineStyle(1.5, 0xffffff, 0.6);
    this.drawHexagonPath(graphics, this.HEXAGON_SIZE);
    graphics.fillPath();
    graphics.strokePath();

    return graphics;
  }

  /**
   * Draw a hexagon path on a graphics object.
   */
  private drawHexagonPath(graphics: Phaser.GameObjects.Graphics, size: number): void {
    graphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2; // Start from top
      const px = Math.cos(angle) * size;
      const py = Math.sin(angle) * size;
      if (i === 0) {
        graphics.moveTo(px, py);
      } else {
        graphics.lineTo(px, py);
      }
    }
    graphics.closePath();
  }

  /**
   * Create charge indicator dots.
   */
  private createChargeDots(maxCharges: number): void {
    this.chargeDotsContainer = this.scene.add.container(0, 0);
    this.chargeDotsContainer.setDepth(91); // Above honeycomb
    this.chargeDots = [];
    this.currentMaxCharges = maxCharges;

    if (maxCharges === 0) return;

    // Calculate positions for dots in an arc above player
    const startAngle = -Math.PI / 2 - this.DOT_ARC_SPREAD / 2;
    const angleStep = maxCharges > 1 ? this.DOT_ARC_SPREAD / (maxCharges - 1) : 0;

    const frameName = getIconFrame('shield');
    const iconScale = this.SHIELD_ICON_SIZE / 64; // Atlas icons are 64px

    for (let i = 0; i < maxCharges; i++) {
      const angle = maxCharges === 1 ? -Math.PI / 2 : startAngle + angleStep * i;
      const dotX = Math.cos(angle) * this.DOT_ARC_RADIUS;
      const dotY = Math.sin(angle) * this.DOT_ARC_RADIUS;

      const icon = this.scene.add.image(dotX, dotY, ICON_ATLAS_KEY, frameName);
      icon.setScale(iconScale);
      icon.setTint(SHIELD_DOT_EMPTY);
      icon.setAlpha(0.5);
      this.chargeDotsContainer.add(icon);
      this.chargeDots.push(icon);
    }
  }

  /**
   * Recreate charge dots when max charges changes.
   */
  private recreateChargeDots(maxCharges: number): void {
    // Destroy existing dots
    if (this.chargeDotsContainer) {
      this.chargeDotsContainer.destroy();
      this.chargeDotsContainer = null;
    }
    this.chargeDots = [];

    // Create new dots
    this.createChargeDots(maxCharges);
  }

  /**
   * Update charge dot visuals based on current state.
   */
  private updateChargeDots(
    charges: number,
    maxCharges: number,
    rechargeProgress: number
  ): void {
    const now = Date.now();
    const baseScale = this.SHIELD_ICON_SIZE / 64;

    for (let i = 0; i < this.chargeDots.length; i++) {
      const icon = this.chargeDots[i];

      if (i < charges) {
        // Filled charge - bright cyan
        icon.setTint(SHIELD_DOT_FILLED);
        icon.setAlpha(1);
        icon.setScale(baseScale);
      } else if (i === charges && charges < maxCharges) {
        // Recharging charge - pulsing
        const pulseAlpha = 0.4 + rechargeProgress * 0.6;
        const pulseScale = baseScale * (0.9 + rechargeProgress * 0.2);

        // Add a subtle pulse animation
        const pulse = 0.1 * Math.sin(now * 0.008);

        icon.setTint(SHIELD_DOT_RECHARGING);
        icon.setAlpha(Math.min(1, pulseAlpha + pulse));
        icon.setScale(pulseScale);
      } else {
        // Empty slot - dark
        icon.setTint(SHIELD_DOT_EMPTY);
        icon.setAlpha(0.4);
        icon.setScale(baseScale);
      }
    }
  }

  /**
   * Update the recharge circle visual based on progress.
   * Draws a circular arc that fills clockwise from the top as the shield recharges.
   */
  private updateRechargeCircle(
    playerX: number,
    playerY: number,
    charges: number,
    maxCharges: number,
    rechargeProgress: number
  ): void {
    if (!this.rechargeCircleGraphics) return;

    // Clear previous frame's drawing
    this.rechargeCircleGraphics.clear();

    // Only draw if actively recharging
    if (charges >= maxCharges || rechargeProgress <= 0) return;

    const startAngle = -Math.PI / 2; // Top (12 o'clock)
    const endAngle = startAngle + rechargeProgress * Math.PI * 2; // Clockwise progress

    // Draw glow layer (thicker, lower alpha)
    this.rechargeCircleGraphics.lineStyle(6, SHIELD_NEON.glow, 0.4);
    this.rechargeCircleGraphics.beginPath();
    this.rechargeCircleGraphics.arc(
      playerX,
      playerY,
      this.RECHARGE_CIRCLE_RADIUS,
      startAngle,
      endAngle,
      false // clockwise
    );
    this.rechargeCircleGraphics.strokePath();

    // Draw core line (thinner, full opacity)
    this.rechargeCircleGraphics.lineStyle(2, SHIELD_NEON.core, 0.9);
    this.rechargeCircleGraphics.beginPath();
    this.rechargeCircleGraphics.arc(
      playerX,
      playerY,
      this.RECHARGE_CIRCLE_RADIUS,
      startAngle,
      endAngle,
      false // clockwise
    );
    this.rechargeCircleGraphics.strokePath();
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.destroyVisuals();
  }
}
