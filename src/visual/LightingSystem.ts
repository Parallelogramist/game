/**
 * LightingSystem — dynamic 2D lighting via a multiply-blend darkness overlay.
 *
 * Renders a dark overlay across the screen, then punches additive "light" circles
 * at each glowing entity (player, projectiles, explosions, gems). The overlay is
 * rendered with MULTIPLY blend mode, creating pools of light and shadow.
 *
 * This is cheap (one RenderTexture + simple circle fills) and dramatically
 * enhances the cyberpunk atmosphere.
 */
import Phaser from 'phaser';

interface LightSource {
  x: number;
  y: number;
  radius: number;
  intensity: number;  // 0-1
  color: number;
}

export class LightingSystem {
  private scene: Phaser.Scene;
  private lightTexture: Phaser.GameObjects.RenderTexture;
  private lightGraphics: Phaser.GameObjects.Graphics;
  private sources: LightSource[] = [];
  private enabled: boolean = true;

  // Ambient darkness level (0 = no effect, 1 = pitch black before lights)
  private ambientDarkness: number = 0.35;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Create a RenderTexture for the light map
    this.lightTexture = scene.add.renderTexture(
      0, 0,
      scene.scale.width,
      scene.scale.height
    );
    this.lightTexture.setOrigin(0, 0);
    this.lightTexture.setScrollFactor(0);
    this.lightTexture.setDepth(1999); // Just below UI
    this.lightTexture.setBlendMode(Phaser.BlendModes.MULTIPLY);

    // Graphics used to draw light circles onto the render texture
    this.lightGraphics = scene.add.graphics();
    this.lightGraphics.setVisible(false); // Not rendered directly
  }

  /**
   * Clear all light sources (call at start of each frame).
   */
  clearLights(): void {
    this.sources.length = 0;
  }

  /**
   * Add a light source for the current frame.
   */
  addLight(x: number, y: number, radius: number, intensity: number = 1.0, color: number = 0xffffff): void {
    this.sources.push({ x, y, radius, intensity, color });
  }

  /**
   * Render the light map. Call once at the end of each frame's update.
   */
  update(): void {
    if (!this.enabled || this.sources.length === 0) {
      this.lightTexture.setAlpha(0);
      return;
    }

    this.lightTexture.setAlpha(1);

    // Fill with darkness
    this.lightGraphics.clear();
    this.lightGraphics.fillStyle(0x000000, 1);
    this.lightGraphics.fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);

    // Punch holes with light sources (additive white circles = light)
    for (const source of this.sources) {
      // Convert world coords to screen coords
      const camera = this.scene.cameras.main;
      const screenX = source.x - camera.scrollX;
      const screenY = source.y - camera.scrollY;

      // Outer glow (soft, wide)
      this.lightGraphics.fillStyle(0xffffff, source.intensity * 0.3);
      this.lightGraphics.fillCircle(screenX, screenY, source.radius * 1.5);

      // Core light (bright, tight)
      this.lightGraphics.fillStyle(0xffffff, source.intensity * 0.7);
      this.lightGraphics.fillCircle(screenX, screenY, source.radius);

      // Center hotspot
      this.lightGraphics.fillStyle(0xffffff, source.intensity);
      this.lightGraphics.fillCircle(screenX, screenY, source.radius * 0.4);
    }

    // Draw the light graphics onto the render texture
    this.lightTexture.clear();
    this.lightTexture.draw(this.lightGraphics, 0, 0);

    // Set overall darkness level
    this.lightTexture.setAlpha(this.ambientDarkness);
  }

  /**
   * Set the ambient darkness level (0 = no effect, 1 = very dark).
   */
  setAmbientDarkness(darkness: number): void {
    this.ambientDarkness = Math.max(0, Math.min(1, darkness));
  }

  /**
   * Enable or disable the lighting system.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.lightTexture.setAlpha(0);
    }
  }

  /**
   * Handle resize events.
   */
  resize(width: number, height: number): void {
    this.lightTexture.resize(width, height);
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.lightTexture.destroy();
    this.lightGraphics.destroy();
  }
}
