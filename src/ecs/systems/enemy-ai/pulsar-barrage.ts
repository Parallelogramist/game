/**
 * The Pulsar (boss) — pure barrage planning. Two attack geometries, both
 * expressed as a flat list of ground-strike points + per-strike impact delays,
 * so the AI handler only has to telegraph each point and fire
 * `groundSlamCallback` when its delay elapses. Deterministic and unit-tested.
 *
 * Mirrors bastion-barrage.ts. Strike counts are deliberately capped so a full
 * barrage never exhausts the 32-slot telegraph pool (an untelegraphed strike
 * would be an unfair hit) — see pulsar-barrage.test.ts.
 */

export interface PulsarStrike {
  x: number;
  y: number;
  /** Seconds from barrage windup start until this strike lands. */
  impactDelay: number;
}

/** Damage footprint of one Pulsar strike (handleGroundSlam radius). */
export const PULSAR_BLAST_RADIUS = 60;

// ── Spoke barrage (all phases) ───────────────────────────────────────────
const SPOKE_INNER_RADIUS = 110;
const SPOKE_RADIUS_STEP = 90; // strike radii along an arm: 110, 200
const SPOKE_STRIKES_PER_ARM = 2;
const SPOKE_BASE_FUSE = 1.2;
const SPOKE_OUTWARD_STEP = 0.22; // inner strike lands first, outer 0.22s later

/** Radial arms per spoke barrage, scaled by boss HP phase (1-3): 4, 5, 6. */
export function spokeCountForPhase(phase: number): number {
  return 3 + phase;
}

/** Per-strike damage, scaled by boss HP phase (1-3): 21, 26, 31. */
export function pulsarStrikeDamage(phase: number): number {
  return 16 + phase * 5;
}

/** Fuse (= telegraph time) on the inner strike of each arm; tightens by phase.
 *  Never below ~0.87s: 1.09 (p1) / 0.98 (p2) / 0.87 (p3). */
export function spokeFuseForPhase(phase: number): number {
  return SPOKE_BASE_FUSE - phase * 0.11;
}

/**
 * Spoke barrage: N evenly-spaced arms radiating from the boss, offset by
 * `rotationAngle`; along each arm a short line of strikes at growing radius,
 * impacts staggered outward so the wave visibly travels out. Wide safe wedges
 * sit between arms — the player orbits and threads. Deterministic.
 */
export function planSpokeBarrage(
  bossX: number,
  bossY: number,
  rotationAngle: number,
  phase: number
): PulsarStrike[] {
  const armCount = spokeCountForPhase(phase);
  const fuse = spokeFuseForPhase(phase);
  const strikes: PulsarStrike[] = [];
  for (let arm = 0; arm < armCount; arm++) {
    const angle = rotationAngle + (arm * Math.PI * 2) / armCount;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let step = 0; step < SPOKE_STRIKES_PER_ARM; step++) {
      const radius = SPOKE_INNER_RADIUS + step * SPOKE_RADIUS_STEP;
      strikes.push({
        x: bossX + cos * radius,
        y: bossY + sin * radius,
        impactDelay: fuse + step * SPOKE_OUTWARD_STEP,
      });
    }
  }
  return strikes;
}

// ── Collapse barrage (phase 2+) ──────────────────────────────────────────
const COLLAPSE_RING_RADII = [240, 150] as const; // outer -> inner
const COLLAPSE_SLOTS = [9, 6] as const; // angular slots per ring (index-matched)
const COLLAPSE_GAP_HALF_ANGLE = 0.7; // rad; slots within this of gap center are omitted (escape lane)
const COLLAPSE_GAP_ROTATE = 0.9; // gap center rotates this much per inward ring
const COLLAPSE_BASE_FUSE = 1.25;
const COLLAPSE_RING_DELAY = 0.4; // each inward ring lands this much later

/** Outer-ring fuse; tightens by phase: 1.25 (p2) / 1.10 (p3). */
export function collapseFuseForPhase(phase: number): number {
  return COLLAPSE_BASE_FUSE - (phase - 2) * 0.15;
}

/** Shortest angular distance between two angles, robust to any real input. */
function angularDistance(a: number, b: number): number {
  const twoPi = Math.PI * 2;
  const d = (((a - b) % twoPi) + twoPi) % twoPi;
  return d > Math.PI ? twoPi - d : d;
}

/**
 * Collapse barrage: concentric rings centered on the player; the outer ring
 * lands first and inner rings later (the safe zone shrinks inward). Each ring
 * omits a rotating gap sector (an escape lane) so it is always dodgeable.
 * Deterministic given `gapStartAngle`.
 */
export function planCollapseBarrage(
  centerX: number,
  centerY: number,
  phase: number,
  gapStartAngle: number
): PulsarStrike[] {
  const fuse = collapseFuseForPhase(phase);
  const strikes: PulsarStrike[] = [];
  for (let ringIndex = 0; ringIndex < COLLAPSE_RING_RADII.length; ringIndex++) {
    const radius = COLLAPSE_RING_RADII[ringIndex];
    const slots = COLLAPSE_SLOTS[ringIndex];
    const gapCenter = gapStartAngle + ringIndex * COLLAPSE_GAP_ROTATE;
    for (let slot = 0; slot < slots; slot++) {
      const angle = (slot * Math.PI * 2) / slots;
      if (angularDistance(angle, gapCenter) < COLLAPSE_GAP_HALF_ANGLE) continue;
      strikes.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        impactDelay: fuse + ringIndex * COLLAPSE_RING_DELAY,
      });
    }
  }
  return strikes;
}
