/**
 * The Tremor (boss) — pure barrage planning. One attack geometry: an expanding
 * SEISMIC SHOCKWAVE across a COLS×ROWS tile grid of the 1280×720 arena. A barrage
 * detonates EVERY tile, but each tile's impact is staggered by its Chebyshev
 * ring-distance from the nearest active epicenter, so a solid wavefront of ground
 * strikes ripples outward across the whole floor. The player flees ahead of the
 * wave or shelters on the safe WAKE of already-detonated tiles behind it.
 *
 * Phase 1: one epicenter (a corner) — a single wave washes across the board.
 * Phase 2+: a SECOND epicenter at the opposite corner fires simultaneously — two
 * wavefronts converge and the last-to-detonate middle band collapses, flipping
 * the demand from "flee across" to "tuck into a corner's wake."
 *
 * Expressed as a flat list of ground-strike points + per-strike impact delays, so
 * the AI handler only telegraphs each point and fires `groundSlamCallback` when
 * its delay elapses. Deterministic and unit-tested. Mirrors tessellator-barrage.ts.
 * Strike count is fixed at 24 (the full 6×4 board) — under the 32-slot telegraph
 * pool (see tremor-barrage.test.ts). Tiles are ARENA-relative (fixed to the field
 * the player is clamped to), not boss-relative.
 */

export interface TremorStrike {
  x: number;
  y: number;
  /** Seconds from barrage windup start until this strike lands. */
  impactDelay: number;
}

/** A grid-tile epicenter the shockwave expands from. */
export interface TremorEpicenter {
  col: number;
  row: number;
}

/** Damage footprint of one Tremor tile strike (handleGroundSlam radius). Covers a
 *  tile's corners (~140px half-diagonal of a 213×180 tile) yet stays under the
 *  180px minimum neighbour-centre spacing, so a player standing on a not-yet- or
 *  already-detonated tile centre is clear of the currently-detonating ring. */
export const TREMOR_BLAST_RADIUS = 140;

const ARENA_W = 1280;
const ARENA_H = 720;
const COLS = 6;
const ROWS = 4;
const TILE_W = ARENA_W / COLS; // 213.33
const TILE_H = ARENA_H / ROWS; // 180

/** The four corner epicenters, cycled by barrage step. Ordered around the
 *  rectangle so index+2 (mod 4) is always the diagonal-opposite corner. */
export const TREMOR_EPICENTERS: readonly TremorEpicenter[] = [
  { col: 0, row: 0 },
  { col: COLS - 1, row: 0 },
  { col: COLS - 1, row: ROWS - 1 },
  { col: 0, row: ROWS - 1 },
];

/** Per-strike damage, scaled by boss HP phase (1-3): 20, 26, 32. */
export function tremorStrikeDamage(phase: number): number {
  return 14 + phase * 6;
}

/** Fuse (= telegraph time) on the leading (epicenter) tile; tightens by phase.
 *  0.9 (p1) / 0.8 (p2) / 0.7 (p3). */
export function tremorFuseForPhase(phase: number): number {
  return 1.0 - phase * 0.1;
}

/** Extra delay per Chebyshev ring outward from the epicenter — the wave speed.
 *  Tightens by phase so the shockwave rolls faster: 0.26 (p1) / 0.22 (p2) / 0.18 (p3). */
export function tremorRingStepForPhase(phase: number): number {
  return 0.3 - phase * 0.04;
}

/** Chebyshev (king-move) distance in tiles. */
function ringDistance(colA: number, rowA: number, colB: number, rowB: number): number {
  return Math.max(Math.abs(colA - colB), Math.abs(rowA - rowB));
}

/**
 * Shockwave barrage: EVERY tile fires one ground strike at its centre, its impact
 * delay growing with Chebyshev ring-distance from the NEAREST active epicenter, so
 * a solid wavefront ripples outward. `epicenters` holds 1 entry in phase 1, 2
 * (diagonal-opposite corners) in phase 2+. Deterministic given (epicenters, phase).
 */
export function planTremorBarrage(
  epicenters: readonly TremorEpicenter[],
  phase: number,
): TremorStrike[] {
  const fuse = tremorFuseForPhase(phase);
  const ringStep = tremorRingStepForPhase(phase);
  const strikes: TremorStrike[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let nearestRing = Infinity;
      for (const epi of epicenters) {
        const dist = ringDistance(col, row, epi.col, epi.row);
        if (dist < nearestRing) nearestRing = dist;
      }
      const x = col * TILE_W + TILE_W / 2;
      const y = row * TILE_H + TILE_H / 2;
      strikes.push({ x, y, impactDelay: fuse + nearestRing * ringStep });
    }
  }
  return strikes;
}
