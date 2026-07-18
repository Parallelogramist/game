/**
 * The Diviner (boss) — pure barrage planning. One attack geometry: a SCRYING CAGE
 * AIMED at the player. A barrage fires one strike ON the player's sampled position
 * (the bullseye — punishes standing still) plus a ring of DIVINER_RING_SLOTS evenly
 * spaced strikes enclosing it at DIVINER_INNER_RADIUS, minus a contiguous GAP of
 * gap slots (the eye's blind spot) the player flees through. Phase 2+ adds a
 * concentric OUTER ring at DIVINER_INNER_RADIUS + DIVINER_RING_SPACING with the SAME
 * gap slots, so the whole disc is lethal and the escape corridor lengthens. The gap
 * start slot rotates each barrage (DIVINER_GAP_ROTATION_SLOTS, coprime with 16), so
 * the blind spot keeps shifting.
 *
 * Strikes whose centre falls outside the 1280×720 arena are dropped — a ring near a
 * wall is partial, which is never unfair since the dropped side is through-the-wall
 * and unreachable. Expressed as a flat list of ground-strike points sharing one
 * impact delay (the cage snaps shut at once), so the AI only telegraphs each point
 * and fires groundSlamCallback when the fuse elapses. Deterministic and unit-tested.
 * Mirrors tremor-barrage.ts. Max strikes = 1 + 2×(16−3) = 27, under the 32-slot
 * telegraph pool (see diviner-barrage.test.ts). The cage is PLAYER-relative (aimed),
 * not arena- or boss-relative — this is the first aimed boss.
 */

export interface DivinerStrike {
  x: number;
  y: number;
  /** Seconds from barrage windup start until this strike lands. */
  impactDelay: number;
}

const ARENA_W = 1280;
const ARENA_H = 720;

/** Evenly-spaced angular positions on each cage ring. */
export const DIVINER_RING_SLOTS = 16;
/** Inner ring radius (px) from the player bullseye. */
export const DIVINER_INNER_RADIUS = 160;
/** Radial gap between the inner and (phase 2+) outer ring. */
export const DIVINER_RING_SPACING = 95;
/** Slots the gap start rotates by each barrage (coprime with 16 → full 16-cycle). */
export const DIVINER_GAP_ROTATION_SLOTS = 5;

/** Damage footprint of one Diviner strike (handleGroundSlam radius). Well under the
 *  gap's perpendicular clearance (160·sin45° ≈ 113 at the tightest 3-slot gap), so a
 *  player fleeing down the blind-spot corridor stays clear (pinned in the test). */
export const DIVINER_BLAST_RADIUS = 88;

/** Contiguous ring slots left empty (the blind spot): a wider 4-slot gap in phase 1,
 *  tightening to 3 from phase 2. Never below 3 — the fairness floor. */
export function divinerGapSlotsForPhase(phase: number): number {
  return phase >= 2 ? 3 : 4;
}

/** Per-strike damage, scaled by boss HP phase (1-3): 21, 27, 33. */
export function divinerStrikeDamage(phase: number): number {
  return 15 + phase * 6;
}

/** Fuse (= telegraph time) before the cage snaps shut; tightens by phase.
 *  1.0 (p1) / 0.85 (p2) / 0.7 (p3). */
export function divinerFuseForPhase(phase: number): number {
  return 1.15 - phase * 0.15;
}

function inArena(x: number, y: number): boolean {
  return x >= 0 && x <= ARENA_W && y >= 0 && y <= ARENA_H;
}

/**
 * Scrying-cage barrage centred on (centerX, centerY) = the player's sampled
 * position. Fires the bullseye strike + 1 ring (phase 1) or 2 concentric rings
 * (phase 2+), each missing `gapSlots` contiguous slots starting at gapStartSlot.
 * All strikes share impactDelay = the phase fuse. Off-arena strikes are dropped.
 * Deterministic given (centerX, centerY, gapStartSlot, phase).
 */
export function planDivinerBarrage(
  centerX: number,
  centerY: number,
  gapStartSlot: number,
  phase: number,
): DivinerStrike[] {
  const fuse = divinerFuseForPhase(phase);
  const gapSlots = divinerGapSlotsForPhase(phase);
  const strikes: DivinerStrike[] = [];

  // The bullseye — punishes standing on the sampled spot. Always in-arena (the
  // player is clamped to the field), so it is never dropped.
  strikes.push({ x: centerX, y: centerY, impactDelay: fuse });

  const radii =
    phase >= 2
      ? [DIVINER_INNER_RADIUS, DIVINER_INNER_RADIUS + DIVINER_RING_SPACING]
      : [DIVINER_INNER_RADIUS];

  for (const radius of radii) {
    for (let slot = 0; slot < DIVINER_RING_SLOTS; slot++) {
      // Skip the contiguous gap slots (wrapping).
      const rel =
        (((slot - gapStartSlot) % DIVINER_RING_SLOTS) + DIVINER_RING_SLOTS) %
        DIVINER_RING_SLOTS;
      if (rel < gapSlots) continue;
      const angle = (slot / DIVINER_RING_SLOTS) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (!inArena(x, y)) continue;
      strikes.push({ x, y, impactDelay: fuse });
    }
  }
  return strikes;
}
