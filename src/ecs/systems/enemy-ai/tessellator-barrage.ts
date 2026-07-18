/**
 * The Tessellator (boss) — pure barrage planning. One attack geometry: a
 * checkerboard "tiling" of the arena. The 1280×720 field is a COLS×ROWS grid of
 * tiles; a barrage fires one ground strike at the centre of every tile whose
 * (col + row) parity matches `parity` — exactly half the board — forcing the
 * player onto the other parity's safe tiles. The parity flips each barrage, so
 * the tile you stand on becomes lethal and you must hop to an adjacent one.
 *
 * Phase 2+ lands the tiles in a directional sweep (a wave rolling across the
 * board) via `sweepStep`; phase 1 is a simultaneous slam.
 *
 * Expressed as a flat list of ground-strike points + per-strike impact delays,
 * so the AI handler only telegraphs each point and fires `groundSlamCallback`
 * when its delay elapses. Deterministic and unit-tested. Mirrors
 * obelisk-barrage.ts. Strike count is fixed at 20 (half of 8×5) — well under the
 * 32-slot telegraph pool (see tessellator-barrage.test.ts). Tiles are
 * ARENA-relative (fixed to the field the player is clamped to), not boss-relative.
 */

export interface TessellatorStrike {
  x: number;
  y: number;
  /** Seconds from barrage windup start until this strike lands. */
  impactDelay: number;
}

/** Which way the wave of blasts rolls across the board (phase 2+). */
export type SweepAxis = 'left' | 'right' | 'up' | 'down';

/** Damage footprint of one Tessellator tile strike (handleGroundSlam radius).
 *  Covers a danger tile's corners (~107px) yet leaves the opposite-parity safe
 *  tile centres clear (nearest neighbour centres are 144/160px away). */
export const TESSELLATOR_BLAST_RADIUS = 108;

// Arena the checkerboard tiles. The player is clamped to 0..1280 × 0..720
// (GameConfig, EXPAND mode), so full-board coverage always threatens them.
const ARENA_W = 1280;
const ARENA_H = 720;
const COLS = 8;
const ROWS = 5;
const TILE_W = ARENA_W / COLS; // 160
const TILE_H = ARENA_H / ROWS; // 144

/** Per-strike damage, scaled by boss HP phase (1-3): 22, 27, 32. */
export function tessellatorStrikeDamage(phase: number): number {
  return 17 + phase * 5;
}

/** Fuse (= telegraph time) on the leading tile; tightens by phase.
 *  1.25 (p1) / 1.12 (p2) / 0.99 (p3). */
export function tessellatorFuseForPhase(phase: number): number {
  return 1.38 - phase * 0.13;
}

/** Extra delay per sweep step (tile index along the sweep axis). Phase 1 is a
 *  simultaneous slam (0); later phases roll a wave across the board.
 *  0 (p1) / 0.09 (p2) / 0.18 (p3). */
export function tessellatorSweepStepForPhase(phase: number): number {
  return phase <= 1 ? 0 : 0.09 * (phase - 1);
}

/**
 * Checkerboard barrage: every tile whose (col + row) parity === `parity` fires
 * one ground strike at its centre — half the board (20 of 40 tiles). Tiles land
 * in a directional sweep along `axis` (phase 2+) so a wave of blasts rolls
 * across the alternating tiles; phase 1 lands them all at the same fuse.
 * Deterministic given (parity, axis, phase).
 */
export function planCheckerBarrage(
  parity: 0 | 1,
  axis: SweepAxis,
  phase: number,
): TessellatorStrike[] {
  const fuse = tessellatorFuseForPhase(phase);
  const sweepStep = tessellatorSweepStepForPhase(phase);
  const strikes: TessellatorStrike[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((col + row) % 2 !== parity) continue;
      const x = col * TILE_W + TILE_W / 2;
      const y = row * TILE_H + TILE_H / 2;
      const sweepIndex =
        axis === 'left' ? col :
        axis === 'right' ? (COLS - 1) - col :
        axis === 'up' ? row :
        (ROWS - 1) - row; // 'down'
      strikes.push({ x, y, impactDelay: fuse + sweepIndex * sweepStep });
    }
  }
  return strikes;
}
