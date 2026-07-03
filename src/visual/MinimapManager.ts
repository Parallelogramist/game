import Phaser from 'phaser';
import { computeHudScale } from '../utils/HudScale';
import { getSettingsManager } from '../settings';
import { OverlayDepths } from './DepthLayers';
import {
  projectToRadar,
  blipStyle,
  MINIMAP_WORLD_RANGE,
  type MinimapBlipKind,
} from './minimapProjection';

/** Radar disc radius (px) at HUD scale 1.0. */
const BASE_RADAR_RADIUS = 56;
/** Inset from the screen edge (px) at HUD scale 1.0. */
const BASE_EDGE_PADDING = 16;
/** Above gameplay and the HUD, just below the off-screen enemy arrows. */
const MINIMAP_DEPTH = OverlayDepths.MINIMAP;

/** Ascending draw priority — bosses paint over the enemy swarm. */
const DRAW_ORDER: MinimapBlipKind[] = ['enemy', 'pickup', 'elite', 'miniboss', 'boss'];

/** A single radar contact fed per-frame from GameScene. */
export interface MinimapEntry {
  worldX: number;
  worldY: number;
  kind: MinimapBlipKind;
}

/**
 * MinimapManager — a player-centered tactical radar disc anchored at the
 * mid-right screen edge. Bosses, minibosses, elites, the enemy swarm and
 * valuable pickups appear as colored blips; off-radar contacts clamp to the rim
 * so distant threats still register. The projection maths live in the pure
 * minimapProjection module; this owns only the Phaser drawing.
 *
 * Static background (disc + ring + crosshair) is drawn once; blips are redrawn
 * each frame into a single pooled Graphics (one draw call). A faint rotating
 * sweep adds radar feel and is suppressed under reduced motion.
 */
export class MinimapManager {
  private background: Phaser.GameObjects.Graphics;
  private sweep: Phaser.GameObjects.Graphics;
  private blips: Phaser.GameObjects.Graphics;

  private centerX = 0;
  private centerY = 0;
  private radarRadius = BASE_RADAR_RADIUS;
  private enabled = true;
  private sweepAngle = 0;

  constructor(scene: Phaser.Scene) {
    const hudScale = computeHudScale(scene.scale.width, scene.scale.height, getSettingsManager().getUiScale());
    this.radarRadius = BASE_RADAR_RADIUS * hudScale;
    const padding = BASE_EDGE_PADDING * hudScale;
    // Mid-right edge — the only HUD zone free of the pause/stats row (top-right),
    // the touch action buttons (bottom-right) and the combo readouts (center).
    this.centerX = scene.scale.width - padding - this.radarRadius;
    this.centerY = scene.scale.height / 2;

    this.background = scene.add.graphics();
    this.background.setScrollFactor(0).setDepth(MINIMAP_DEPTH);
    this.sweep = scene.add.graphics();
    this.sweep.setScrollFactor(0).setDepth(MINIMAP_DEPTH + 1);
    this.blips = scene.add.graphics();
    this.blips.setScrollFactor(0).setDepth(MINIMAP_DEPTH + 2);

    this.drawBackground();
    this.drawSweepWedge();

    this.setEnabled(getSettingsManager().isMinimapEnabled());
  }

  /** Draw the static radar chrome once: disc, ring, crosshair, center dot. */
  private drawBackground(): void {
    const radius = this.radarRadius;
    const graphics = this.background;
    graphics.clear();
    graphics.setPosition(this.centerX, this.centerY);

    // Soft outer glow — three widening halos in the HUD accent, drawn once.
    graphics.fillStyle(0x66bbff, 0.03);
    graphics.fillCircle(0, 0, radius + 14);
    graphics.fillStyle(0x66bbff, 0.06);
    graphics.fillCircle(0, 0, radius + 8);
    graphics.fillStyle(0x66bbff, 0.1);
    graphics.fillCircle(0, 0, radius + 3);

    // Dark glass backing under the disc — matches the HUD panel language.
    graphics.fillStyle(0x0a1020, 0.55);
    graphics.fillCircle(0, 0, radius + 2);

    // Translucent disc.
    graphics.fillStyle(0x05101a, 0.55);
    graphics.fillCircle(0, 0, radius);

    // Hairline outer accent ring over the glass edge, radar rings inside.
    graphics.lineStyle(1.5, 0x66bbff, 0.5);
    graphics.strokeCircle(0, 0, radius + 2);
    graphics.lineStyle(1, 0x33ffff, 0.35);
    graphics.strokeCircle(0, 0, radius);
    graphics.lineStyle(1, 0x33ffff, 0.15);
    graphics.strokeCircle(0, 0, radius * 0.5);

    // Crosshair.
    graphics.lineStyle(1, 0x33ffff, 0.12);
    graphics.beginPath();
    graphics.moveTo(-radius, 0);
    graphics.lineTo(radius, 0);
    graphics.moveTo(0, -radius);
    graphics.lineTo(0, radius);
    graphics.strokePath();

    // Player dot at center.
    graphics.fillStyle(0xffffff, 0.95);
    graphics.fillCircle(0, 0, Math.max(1.5, radius * 0.04));
  }

  /** Draw the rotating sweep wedge once; rotation is applied per-frame. */
  private drawSweepWedge(): void {
    const radius = this.radarRadius;
    const graphics = this.sweep;
    graphics.clear();
    graphics.setPosition(this.centerX, this.centerY);
    graphics.fillStyle(0x33ffff, 0.10);
    graphics.slice(0, 0, radius, Phaser.Math.DegToRad(-12), Phaser.Math.DegToRad(12), false);
    graphics.fillPath();
  }

  /** Show or hide the whole radar (driven by the settings toggle). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.background.setVisible(enabled);
    this.sweep.setVisible(enabled);
    this.blips.setVisible(enabled);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Re-project and redraw all contacts for this frame.
   * @param entries reusable buffer of contacts (only the first `entryCount` are read)
   */
  update(
    playerX: number,
    playerY: number,
    entries: ReadonlyArray<MinimapEntry>,
    entryCount: number,
    deltaSeconds: number
  ): void {
    if (!this.enabled) return;

    const reducedMotion = getSettingsManager().isReducedMotionEnabled();
    if (reducedMotion) {
      this.sweep.setVisible(false);
    } else {
      this.sweep.setVisible(true);
      this.sweepAngle += deltaSeconds * 1.4;
      this.sweep.setRotation(this.sweepAngle);
    }

    const graphics = this.blips;
    graphics.clear();
    graphics.setPosition(this.centerX, this.centerY);

    const radius = this.radarRadius;
    const count = Math.min(entryCount, entries.length);

    // Draw in ascending threat priority so bigger threats land on top.
    for (let orderIndex = 0; orderIndex < DRAW_ORDER.length; orderIndex++) {
      const drawKind = DRAW_ORDER[orderIndex];
      for (let i = 0; i < count; i++) {
        const entry = entries[i];
        if (entry.kind !== drawKind) continue;
        const projected = projectToRadar(entry.worldX - playerX, entry.worldY - playerY, radius, MINIMAP_WORLD_RANGE);
        const style = blipStyle(drawKind);
        // Rim contacts (off-radar) draw dimmer so on-radar threats pop, and
        // blips ease down toward the disc edge (blips are stateless per-frame
        // redraws, so the falloff stands in for a per-blip fade-out).
        let alpha = projected.atRim ? 0.6 : 0.95;
        const edgeDistance = Math.sqrt(projected.x * projected.x + projected.y * projected.y) / radius;
        if (!projected.atRim && edgeDistance > 0.85) {
          alpha *= 1 - ((edgeDistance - 0.85) / 0.15) * 0.45;
        }
        graphics.fillStyle(style.color, alpha);
        graphics.fillCircle(projected.x, projected.y, style.radius);
      }
    }
  }

  destroy(): void {
    this.background.destroy();
    this.sweep.destroy();
    this.blips.destroy();
  }
}
