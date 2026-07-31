import Phaser from 'phaser';
import { computeHudScale } from '../utils/HudScale';
import { getSettingsManager } from '../settings';
import { OverlayDepths } from './DepthLayers';
import { WORLD_GEOMETRY_COLORS } from './NeonColors';
import { makeBodyText } from './DisplayText';
import { drawGateGlyph, strokeDashedLine } from './SectorMapRenderer';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from '../world/worldSpace';
import { TileKind } from '../world/worldTypes';
import type { EdgeKind } from '../world/worldTypes';
import type { WallSegment } from '../world/sectorWallSegments';
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
const DRAW_ORDER: MinimapBlipKind[] = ['enemy', 'pickup', 'secret', 'elite', 'miniboss', 'boss'];

/** Alpha the biome wash gets under the wall lines. Line work reads first; the wash only
 *  says "this room is charted". */
const UNDERLAY_WASH_ALPHA = 0.12;
const UNDERLAY_WALL_ALPHA = 0.6;
/** Seconds the "+N NEW" pill stays up after a reveal, and the rim ring's expand time. */
const PULSE_PILL_SECONDS = 2.5;
const PULSE_RING_SECONDS = 0.6;
const PULSE_COLOR = 0x9dffb0;

/** The map screen's unvisited-outline blue, so a stub toward a charted-but-unentered
 *  neighbour reads the same on both surfaces. */
const UNVISITED_STUB = 0x3b4d6b;

/** Hint tier 1 draws in the breakable amber a cache itself is drawn in, so the radar hint
 *  and the thing it hints at read as one language rather than two. */
const SECRET_PING_COLOR = WORLD_GEOMETRY_COLORS.breakable.stroke;
/** Per-second rate the drawn shimmer eases toward the fed intensity. Easing rather than
 *  snapping is what keeps crossing the ping radius from popping. */
const SECRET_PING_EASE_PER_SECOND = 3;
/** Below this the shimmer is skipped entirely, so an out-of-range frame costs nothing. */
const SECRET_PING_EPSILON = 0.01;

/** Blocking tile kinds the underlay can draw, in a fixed order so lineStyle is set once
 *  per kind rather than once per segment. */
const UNDERLAY_WALL_KINDS: ReadonlyArray<TileKind> = [
  TileKind.Solid, TileKind.Breakable, TileKind.GateClosed,
];

function underlayStrokeFor(kind: TileKind): number {
  if (kind === TileKind.Breakable) return WORLD_GEOMETRY_COLORS.breakable.stroke;
  if (kind === TileKind.GateClosed) return WORLD_GEOMETRY_COLORS.gate.stroke;
  return WORLD_GEOMETRY_COLORS.solid.stroke;
}

/** A single radar contact fed per-frame from GameScene. */
export interface MinimapEntry {
  worldX: number;
  worldY: number;
  kind: MinimapBlipKind;
}

/** One border of the current sector, ready to draw: the map-screen glyph plus whether
 *  there is anything charted on the far side to stub toward. */
export interface MinimapUnderlayDoor {
  localX: number;
  localY: number;
  outwardX: number;
  outwardY: number;
  kind: EdgeKind;
  horizontalWall: boolean;
  discoveredBeyond: boolean;
}

/** The current sector as the radar draws it. Assembled by GameScene, which owns the
 *  discovery state; this module owns only the drawing. */
export interface MinimapSectorUnderlay {
  /** World coords of the sector's top-left corner. */
  originX: number;
  originY: number;
  segments: ReadonlyArray<WallSegment>;
  doors: ReadonlyArray<MinimapUnderlayDoor>;
  biomeTint: number;
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
  private underlay: Phaser.GameObjects.Graphics;
  private underlayMaskShape: Phaser.GameObjects.Graphics;
  private pulseText: Phaser.GameObjects.Text;

  private centerX = 0;
  private centerY = 0;
  private radarRadius = BASE_RADAR_RADIUS;
  private enabled = true;
  private sweepAngle = 0;
  private activeUnderlay: MinimapSectorUnderlay | null = null;
  private underlayDrawn = false;
  private underlayRebuilds = 0;
  private pillRemaining = 0;
  private ringRemaining = 0;
  private secretPingTarget = 0;
  private secretPingLevel = 0;
  private secretPingPhase = 0;

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
    this.underlay = scene.add.graphics();
    this.underlay.setScrollFactor(0).setDepth(MINIMAP_DEPTH + 1);
    this.sweep = scene.add.graphics();
    this.sweep.setScrollFactor(0).setDepth(MINIMAP_DEPTH + 2);
    this.blips = scene.add.graphics();
    this.blips.setScrollFactor(0).setDepth(MINIMAP_DEPTH + 3);

    // GameScene's camera scrolls, and a GeometryMask is rendered through that camera, so the
    // mask shape needs the same scroll factor as the thing it masks or the disc's clip would
    // drift away from the disc.
    this.underlayMaskShape = scene.add.graphics();
    this.underlayMaskShape.setScrollFactor(0);
    this.underlayMaskShape.fillStyle(0xffffff, 1);
    this.underlayMaskShape.fillCircle(this.centerX, this.centerY, this.radarRadius);
    this.underlayMaskShape.setVisible(false);
    this.underlay.setMask(this.underlayMaskShape.createGeometryMask());

    this.pulseText = makeBodyText(
      scene, this.centerX, this.centerY - this.radarRadius - 14 * hudScale, '',
      { fontSize: Math.round(12 * hudScale), color: '#9dffb0' },
    );
    this.pulseText.setOrigin(0.5).setScrollFactor(0).setDepth(MINIMAP_DEPTH + 4).setVisible(false);

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

  /**
   * Draws the sector once in radar-scaled sector-local coordinates. Per frame the Graphics is
   * only translated, so a rebuild has to happen no more often than the sector, the discovery
   * revision or the tile grid changes: the caller owns that gate, and the counter in the log
   * line is how a browser session proves it is holding.
   */
  private rebuildUnderlay(): void {
    const underlay = this.activeUnderlay;
    if (!underlay) return;
    const scale = this.radarRadius / MINIMAP_WORLD_RANGE;
    const graphics = this.underlay;
    graphics.clear();

    graphics.fillStyle(underlay.biomeTint, UNDERLAY_WASH_ALPHA);
    graphics.fillRect(0, 0, SECTOR_WIDTH * scale, SECTOR_HEIGHT * scale);

    for (const kind of UNDERLAY_WALL_KINDS) {
      graphics.lineStyle(1.5, underlayStrokeFor(kind), UNDERLAY_WALL_ALPHA);
      for (const segment of underlay.segments) {
        if (segment.kind !== kind) continue;
        graphics.lineBetween(
          segment.x1 * scale, segment.y1 * scale, segment.x2 * scale, segment.y2 * scale,
        );
      }
    }

    const glyphSize = Math.max(4, this.radarRadius * 0.12);
    const stubStart = this.radarRadius * 0.06;
    const stubEnd = this.radarRadius * 0.2;
    for (const door of underlay.doors) {
      const doorX = door.localX * scale;
      const doorY = door.localY * scale;
      if (door.discoveredBeyond) {
        // A charted neighbour gets a dashed stub past the door; an uncharted one gets
        // nothing, and the wall simply ending is itself the tell that something is unmapped.
        graphics.lineStyle(1, UNVISITED_STUB, 0.7);
        strokeDashedLine(
          graphics,
          doorX + door.outwardX * stubStart, doorY + door.outwardY * stubStart,
          doorX + door.outwardX * stubEnd, doorY + door.outwardY * stubEnd,
        );
      }
      drawGateGlyph(graphics, door.kind, doorX, doorY, door.horizontalWall, glyphSize);
    }

    this.underlayDrawn = true;
    this.underlayRebuilds++;
    console.log(`[minimap] underlay rebuild #${this.underlayRebuilds} origin ${underlay.originX},${underlay.originY}`);
  }

  /** Show or hide the whole radar (driven by the settings toggle). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.background.setVisible(enabled);
    this.sweep.setVisible(enabled);
    this.blips.setVisible(enabled);
    this.underlay.setVisible(enabled);
    if (!enabled) {
      this.pillRemaining = 0;
      this.ringRemaining = 0;
      this.secretPingTarget = 0;
      this.secretPingLevel = 0;
      this.pulseText.setVisible(false);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Hand the radar the sector to draw under the blips, or null to clear it (arena mode, and
   * any frame with no live player). Rebuilding is deferred to the next update() so a caller
   * can set this as often as it likes without paying for a redraw it will overwrite.
   */
  setSectorUnderlay(underlay: MinimapSectorUnderlay | null): void {
    this.activeUnderlay = underlay;
    this.underlayDrawn = false;
  }

  /** A reveal just put new sectors on the map: ping the rim and raise a "+N NEW" pill. */
  notifyDiscoveryPulse(newSectorCount: number): void {
    if (newSectorCount <= 0 || !this.enabled) return;
    this.pulseText.setText(`+${newSectorCount} NEW`);
    this.pulseText.setAlpha(1);
    this.pulseText.setVisible(true);
    this.pillRemaining = PULSE_PILL_SECONDS;
    this.ringRemaining = getSettingsManager().isReducedMotionEnabled() ? 0 : PULSE_RING_SECONDS;
  }

  /**
   * Ambient hint tier 1: how strongly the nearest unfound secret should shimmer this frame,
   * 0 meaning nothing is in range. Fed every frame by GameScene; the radar eases toward the
   * value rather than snapping to it, and never learns which secret or where it is.
   */
  setSecretPing(intensity: number): void {
    this.secretPingTarget = Number.isFinite(intensity)
      ? Phaser.Math.Clamp(intensity, 0, 1)
      : 0;
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

    if (!getSettingsManager().isMinimapUnderlayEnabled() || !this.activeUnderlay) {
      this.underlay.setVisible(false);
    } else {
      if (!this.underlayDrawn) this.rebuildUnderlay();
      const underlayScale = this.radarRadius / MINIMAP_WORLD_RANGE;
      this.underlay.setVisible(true);
      this.underlay.setPosition(
        this.centerX + (this.activeUnderlay.originX - playerX) * underlayScale,
        this.centerY + (this.activeUnderlay.originY - playerY) * underlayScale,
      );
    }

    const graphics = this.blips;
    graphics.clear();
    graphics.setPosition(this.centerX, this.centerY);

    const radius = this.radarRadius;
    const count = Math.min(entryCount, entries.length);

    const easeStep = deltaSeconds * SECRET_PING_EASE_PER_SECOND;
    if (this.secretPingLevel < this.secretPingTarget) {
      this.secretPingLevel = Math.min(this.secretPingTarget, this.secretPingLevel + easeStep);
    } else if (this.secretPingLevel > this.secretPingTarget) {
      this.secretPingLevel = Math.max(this.secretPingTarget, this.secretPingLevel - easeStep);
    }
    if (this.secretPingLevel > SECRET_PING_EPSILON) {
      this.secretPingPhase += deltaSeconds;
      // Reduced motion holds the shimmer at steady brightness: the hint stays, the breathing
      // goes, exactly how the discovery pill degrades a few lines down.
      const breath = reducedMotion ? 1 : 0.75 + Math.sin(this.secretPingPhase * 3.1) * 0.25;
      const pingAlpha = this.secretPingLevel * breath;
      graphics.fillStyle(SECRET_PING_COLOR, pingAlpha * 0.1);
      graphics.fillCircle(0, 0, radius);
      graphics.lineStyle(2, SECRET_PING_COLOR, pingAlpha * 0.55);
      graphics.strokeCircle(0, 0, radius * 0.86);
    }

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

    if (this.ringRemaining > 0) {
      this.ringRemaining = Math.max(0, this.ringRemaining - deltaSeconds);
      const progress = 1 - this.ringRemaining / PULSE_RING_SECONDS;
      graphics.lineStyle(2, PULSE_COLOR, 0.5 * (1 - progress));
      graphics.strokeCircle(0, 0, radius * (0.55 + 0.45 * progress));
    }

    if (this.pillRemaining > 0) {
      this.pillRemaining = Math.max(0, this.pillRemaining - deltaSeconds);
      if (this.pillRemaining <= 0) {
        this.pulseText.setVisible(false);
      } else if (!reducedMotion) {
        // Reduced motion keeps the pill at full alpha for its whole life and simply hides it:
        // the information stays, the animation goes.
        this.pulseText.setAlpha(Math.min(1, this.pillRemaining / 0.5));
      }
    }
  }

  destroy(): void {
    this.background.destroy();
    this.sweep.destroy();
    this.blips.destroy();
    this.underlay.clearMask(true);
    this.underlay.destroy();
    this.underlayMaskShape.destroy();
    this.pulseText.destroy();
  }
}
