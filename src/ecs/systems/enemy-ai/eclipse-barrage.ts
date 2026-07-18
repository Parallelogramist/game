/**
 * The Eclipse (boss) — pure barrage planning. One attack geometry: a REPEATING
 * full-floor pulse across a COLS×ROWS tile grid of the 1280×720 arena. Each pulse
 * blasts EVERY tile EXCEPT the tiles under a single circular "umbra" (the safe disc)
 * whose centre drifts across the arena from pulse to pulse. The un-telegraphed hole
 * is the only safe ground, and it moves, so the player must continuously follow the
 * drifting umbra. The first pulse's umbra is centred on the channel start (the AI
 * seeds it on the player for a fair start); it then drifts toward a capped end point.
 *
 * Expressed as a flat list of ground-strike points, each carrying a telegraphDelay
 * (when its warning ring appears) and an impactDelay (when it lands), both measured
 * from channel start. The AI spawns each strike's telegraph when its telegraphDelay
 * elapses and fires groundSlamCallback when its impactDelay elapses. Deterministic
 * and unit-tested. Mirrors tremor-barrage.ts / diviner-barrage.ts. Tiles are
 * ARENA-relative (fixed to the field the player is clamped to), not boss-relative.
 *
 * Pool safety: pulseInterval > fuse for every phase, so a pulse's telegraphs resolve
 * before the next pulse's spawn — at most one pulse's worth (< 24) is ever live at
 * once, well under the 32-slot telegraph pool (see eclipse-barrage.test.ts).
 */

export interface EclipseStrike {
  x: number;
  y: number;
  /** Seconds from channel start until this strike's telegraph ring appears. */
  telegraphDelay: number;
  /** Seconds from channel start until this strike lands. */
  impactDelay: number;
}

/** Damage footprint of one Eclipse tile strike (handleGroundSlam radius). Stays
 *  under the 180px minimum neighbour-centre spacing so the safe core is real. */
export const ECLIPSE_BLAST_RADIUS = 120;

/** Max distance the umbra drifts across a channel — capped so per-pulse
 *  displacement stays followable no matter where the player seeds it. */
export const ECLIPSE_MAX_DRIFT = 420;

const ARENA_W = 1280;
const ARENA_H = 720;
const COLS = 6;
const ROWS = 4;
const TILE_W = ARENA_W / COLS; // 213.33
const TILE_H = ARENA_H / ROWS; // 180

/** Anchor points the umbra drifts toward, cycled by barrage step (quadrant centres). */
export const ECLIPSE_ANCHORS: readonly { x: number; y: number }[] = [
  { x: 320, y: 180 },
  { x: 960, y: 180 },
  { x: 960, y: 540 },
  { x: 320, y: 540 },
];

/** Per-strike damage by boss HP phase (1-3): 18 / 23 / 28. */
export function eclipseStrikeDamage(phase: number): number {
  return 13 + phase * 5;
}

/** Telegraph/fuse warning per pulse; tightens by phase: 0.9 / 0.8 / 0.7. */
export function eclipseFuseForPhase(phase: number): number {
  return 1.0 - phase * 0.1;
}

/** Seconds between pulses; tightens by phase: 1.15 / 1.0 / 0.9. ALWAYS > fuse (pool-safe). */
export function eclipsePulseIntervalForPhase(phase: number): number {
  return phase <= 1 ? 1.15 : phase === 2 ? 1.0 : 0.9;
}

/** Number of pulses in a channel; grows by phase: 4 / 5 / 6. */
export function eclipsePulseCountForPhase(phase: number): number {
  return 3 + phase;
}

/** Radius of the spared umbra; shrinks by phase: 220 / 190 / 170. ALWAYS > blast
 *  (a genuine safe core exists) and > a tile's half-diagonal (≥1 tile always spared). */
export function eclipseSafeRadiusForPhase(phase: number): number {
  return phase <= 1 ? 220 : phase === 2 ? 190 : 170;
}

/**
 * The umbra's drift end point: from (startX,startY) toward (anchorX,anchorY), capped
 * at ECLIPSE_MAX_DRIFT so per-pulse displacement stays followable from any start.
 */
export function eclipseChannelEnd(
  startX: number,
  startY: number,
  anchorX: number,
  anchorY: number,
): { x: number; y: number } {
  const dx = anchorX - startX;
  const dy = anchorY - startY;
  const dist = Math.hypot(dx, dy) || 1;
  const drift = Math.min(dist, ECLIPSE_MAX_DRIFT);
  return { x: startX + (dx / dist) * drift, y: startY + (dy / dist) * drift };
}

/**
 * Full pulse-train barrage: for each of `pulseCount` pulses, EVERY tile whose centre
 * is OUTSIDE the umbra (distance > safeRadius from the umbra centre at that pulse)
 * fires one ground strike. The umbra centre is lerped from (startX,startY) at pulse 0
 * to (endX,endY) at the last pulse. Deterministic given (start, end, phase).
 */
export function planEclipseChannel(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  phase: number,
): EclipseStrike[] {
  const fuse = eclipseFuseForPhase(phase);
  const interval = eclipsePulseIntervalForPhase(phase);
  const pulseCount = eclipsePulseCountForPhase(phase);
  const safeRadius = eclipseSafeRadiusForPhase(phase);
  const strikes: EclipseStrike[] = [];
  for (let pulse = 0; pulse < pulseCount; pulse++) {
    const t = pulseCount === 1 ? 0 : pulse / (pulseCount - 1);
    const centreX = startX + (endX - startX) * t;
    const centreY = startY + (endY - startY) * t;
    const fireDelay = pulse * interval;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * TILE_W + TILE_W / 2;
        const y = row * TILE_H + TILE_H / 2;
        if (Math.hypot(x - centreX, y - centreY) > safeRadius) {
          strikes.push({ x, y, telegraphDelay: fireDelay, impactDelay: fireDelay + fuse });
        }
      }
    }
  }
  return strikes;
}
