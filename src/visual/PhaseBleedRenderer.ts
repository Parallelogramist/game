import Phaser from 'phaser';
import { DepthLayers } from './DepthLayers';
import { ENEMY_COLORS } from './NeonColors';
import { TILE_SIZE } from '../world/worldTypes';
import type { PhaseBleedTile } from '../world/phaseBleed';

const FILL_ALPHA_MIN = 0.10;
const FILL_ALPHA_MAX = 0.26;
const EDGE_ALPHA_MIN = 0.30;
const EDGE_ALPHA_MAX = 0.65;
const EDGE_WIDTH = 2;
const EDGE_INSET = 1;

/**
 * The wall tell for a phased Wraith: the rock it is standing in glows in the Wraith's own
 * palette, so the enemy that ignores cover is legible through it. One Graphics for every
 * phased wraith on screen, cleared and refilled each frame.
 */
export class PhaseBleedRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(DepthLayers.WRAITH_BLEED);
  }

  /** `pulse` is 0..1 and the caller owns the clock, so the reduced-motion setting can pin it
   *  flat at 1 without this class reading settings. */
  draw(tiles: readonly PhaseBleedTile[], count: number, pulse: number): void {
    this.graphics.clear();
    if (count <= 0) return;
    const clamped = Math.min(Math.max(pulse, 0), 1);
    const fillAlpha = FILL_ALPHA_MIN + (FILL_ALPHA_MAX - FILL_ALPHA_MIN) * clamped;
    const edgeAlpha = EDGE_ALPHA_MIN + (EDGE_ALPHA_MAX - EDGE_ALPHA_MIN) * clamped;
    this.graphics.fillStyle(ENEMY_COLORS.phasing.core, fillAlpha);
    this.graphics.lineStyle(EDGE_WIDTH, ENEMY_COLORS.phasing.glow, edgeAlpha);
    for (let index = 0; index < count; index++) {
      const tile = tiles[index];
      this.graphics.fillRect(tile.x, tile.y, TILE_SIZE, TILE_SIZE);
      this.graphics.strokeRect(
        tile.x + EDGE_INSET, tile.y + EDGE_INSET,
        TILE_SIZE - EDGE_INSET * 2, TILE_SIZE - EDGE_INSET * 2,
      );
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
