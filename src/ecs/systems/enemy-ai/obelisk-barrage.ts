/**
 * The Obelisk (boss) — pure barrage planning. One attack geometry: a full-arena
 * "wall" of overlapping ground strikes spanning one axis, with a single safe
 * lane, doubled (or tripled) into offset rows whose gaps shift so the player
 * threads one lane then slides to the next as the rows land in sequence.
 *
 * Expressed as a flat list of ground-strike points + per-strike impact delays,
 * so the AI handler only telegraphs each point and fires `groundSlamCallback`
 * when its delay elapses. Deterministic and unit-tested.
 *
 * Mirrors pulsar-barrage.ts. Strike count is bounded by design (few, wide,
 * large-radius blasts make a solid wall) so a full barrage never exhausts the
 * 32-slot telegraph pool — see obelisk-barrage.test.ts. Walls are ARENA-relative
 * (fixed to the 1280×720 field the player is clamped to), not boss-relative.
 */

export interface ObeliskStrike {
  x: number;
  y: number;
  /** Seconds from barrage windup start until this strike lands. */
  impactDelay: number;
}

export type WallOrientation = 'horizontal' | 'vertical';

/** Damage footprint of one Obelisk strike (handleGroundSlam radius). Large so a
 *  sparse row of blasts reads as a solid wall. */
export const OBELISK_BLAST_RADIUS = 88;

// Arena the walls span. The player is clamped to 0..1280 × 0..720 (GameConfig,
// EXPAND mode), so arena-relative coverage always threatens them.
const ARENA_W = 1280;
const ARENA_H = 720;
const WALL_EDGE = 60; // strikes span [EDGE, dimension - EDGE]

// Strikes per row along the span axis. Horizontal walls span the wide axis
// (more columns); vertical walls span the short axis (fewer). With EDGE=60 the
// column step is ~193px (h) / 150px (v); GAP_HALF=140 leaves neighbours in place
// so exactly one column (the gap) is omitted per row.
const SPAN_COUNT_H = 7;
const SPAN_COUNT_V = 5;
const GAP_HALF = 140;       // px; columns within this of the row's gap centre are omitted
const GAP_ROW_SHIFT = 3;    // each successive row shifts its gap this many columns
const ROW_STEP = 150;       // px between adjacent rows along the cross axis
const ROW_DELAY = 0.5;      // s; each successive row lands this much later (the wall marches)

/** Rows per wall, scaled by boss HP phase (1-3): 2, 2, 3. */
export function wallRowsForPhase(phase: number): number {
  return phase >= 3 ? 3 : 2;
}

/** Per-strike damage, scaled by boss HP phase (1-3): 23, 28, 33. */
export function obeliskStrikeDamage(phase: number): number {
  return 18 + phase * 5;
}

/** Fuse (= telegraph time) on the leading row; tightens by phase.
 *  1.27 (p1) / 1.14 (p2) / 1.01 (p3). */
export function wallFuseForPhase(phase: number): number {
  return 1.4 - phase * 0.13;
}

/**
 * Wall barrage: `rowCount` parallel rows (from phase) spanning one arena axis
 * and straddling the arena centre on the cross axis; each row omits a single
 * safe lane, and successive rows shift their lane by `GAP_ROW_SHIFT` columns and
 * land `ROW_DELAY` later — the player threads lane 0, then slides to lane 1 as
 * it advances. Deterministic given `orientation` and `gapIndex`.
 */
export function planWallBarrage(
  orientation: WallOrientation,
  gapIndex: number,
  phase: number,
): ObeliskStrike[] {
  const rowCount = wallRowsForPhase(phase);
  const spanCount = orientation === 'horizontal' ? SPAN_COUNT_H : SPAN_COUNT_V;
  const spanLength = orientation === 'horizontal' ? ARENA_W : ARENA_H;
  const crossCentre = orientation === 'horizontal' ? ARENA_H / 2 : ARENA_W / 2;
  const fuse = wallFuseForPhase(phase);
  const step = (spanLength - 2 * WALL_EDGE) / (spanCount - 1);
  const strikes: ObeliskStrike[] = [];

  for (let row = 0; row < rowCount; row++) {
    const rowGapIndex = (((gapIndex + row * GAP_ROW_SHIFT) % spanCount) + spanCount) % spanCount;
    const gapCentrePos = WALL_EDGE + rowGapIndex * step;
    const crossPos = crossCentre + (row - (rowCount - 1) / 2) * ROW_STEP;
    for (let col = 0; col < spanCount; col++) {
      const spanPos = WALL_EDGE + col * step;
      if (Math.abs(spanPos - gapCentrePos) <= GAP_HALF) continue; // safe lane
      const x = orientation === 'horizontal' ? spanPos : crossPos;
      const y = orientation === 'horizontal' ? crossPos : spanPos;
      strikes.push({ x, y, impactDelay: fuse + row * ROW_DELAY });
    }
  }
  return strikes;
}
