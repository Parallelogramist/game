/**
 * The Helix (boss) — pure barrage planning. One attack geometry: spiral
 * (Archimedean) arms of telegraphed ground strikes sweeping outward from the
 * arena centre. Strike k on an arm sits at radius R_START + k·R_STEP and angle
 * baseAngle + armOffset + k·ANGLE_STEP, so each arm curves; strikes land
 * inner-first (impactDelay grows with k) so the spiral unfurls outward — a
 * rotating pinwheel, distinct from Pulsar's simultaneous straight spokes and
 * Obelisk's linear marching walls.
 *
 * Expressed as a flat list of ground-strike points + per-strike impact delays,
 * so the AI handler only telegraphs each point and fires groundSlamCallback when
 * its delay elapses. Deterministic and unit-tested. Strikes whose centre would
 * fall outside the arena are dropped (the arm ends at the wall); STRIKES_PER_ARM
 * × max arms (9 × 3 = 27) stays under the 32-slot telegraph pool. Arms are
 * ARENA-relative (fixed to the 1280×720 field), not boss-relative.
 *
 * Mirrors pulsar-barrage.ts / obelisk-barrage.ts.
 */

export interface HelixStrike {
  x: number;
  y: number;
  /** Seconds from barrage windup start until this strike lands. */
  impactDelay: number;
}

/** Damage footprint of one Helix strike (handleGroundSlam radius). */
export const HELIX_BLAST_RADIUS = 60;

const ARENA_W = 1280;
const ARENA_H = 720;
const CENTRE_X = 640;
const CENTRE_Y = 360;
const EDGE = 60;               // strike centres must stay within [EDGE, dim - EDGE]
const R_START = 66;            // innermost strike radius
const R_STEP = 52;             // radius growth per strike along an arm
const STRIKES_PER_ARM = 9;     // max strikes per arm (outer ones dropped at the wall)
const ANGLE_STEP = 0.42;       // rad; angle advance per strike → the spiral curvature
const ARM_UNFURL_DELAY = 0.14; // s; each strike further out lands this much later

/** Arms per barrage, by boss HP phase (1-3): 2, 3, 3. */
export function spiralArmsForPhase(phase: number): number {
  return phase >= 2 ? 3 : 2;
}

/** Per-strike damage, by boss HP phase (1-3): 22, 26, 30. */
export function helixStrikeDamage(phase: number): number {
  return 18 + phase * 4;
}

/** Fuse (= telegraph time) on the innermost strike; tightens by phase:
 *  1.23 (p1) / 1.11 (p2) / 0.99 (p3). */
export function helixFuseForPhase(phase: number): number {
  return 1.35 - phase * 0.12;
}

/**
 * Spiral barrage: `armCount` Archimedean arms sweeping outward from the arena
 * centre, offset by 2π/armCount. Deterministic given `baseAngle` and `phase`.
 */
export function planSpiralBarrage(baseAngle: number, phase: number): HelixStrike[] {
  const armCount = spiralArmsForPhase(phase);
  const fuse = helixFuseForPhase(phase);
  const strikes: HelixStrike[] = [];

  for (let arm = 0; arm < armCount; arm++) {
    const armOffset = (Math.PI * 2 / armCount) * arm;
    for (let k = 0; k < STRIKES_PER_ARM; k++) {
      const radius = R_START + k * R_STEP;
      const angle = baseAngle + armOffset + k * ANGLE_STEP;
      const x = CENTRE_X + Math.cos(angle) * radius;
      const y = CENTRE_Y + Math.sin(angle) * radius;
      if (x < EDGE || x > ARENA_W - EDGE || y < EDGE || y > ARENA_H - EDGE) continue;
      strikes.push({ x, y, impactDelay: fuse + k * ARM_UNFURL_DELAY });
    }
  }
  return strikes;
}
