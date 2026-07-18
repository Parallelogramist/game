/**
 * The Stalker (miniboss) — pure predictive-volley planning. A volley is a flat list
 * of ground-strike points + per-strike impact delays, so the AI handler only has to
 * telegraph each point and fire `groundSlamCallback` when its delay elapses.
 * Deterministic and unit-tested.
 *
 * The signature is PREDICTION: given the player's current heading, the strikes march
 * in a line racing AHEAD along that heading, so straight-line flight runs into the
 * barrage and the safe move is a perpendicular juke. When the player is (near-)
 * stationary there is no heading to lead, so the volley falls back to a tight ring
 * bracketing the player's spot — still escapable (walk off the spot), never a trap.
 *
 * Mirrors bombard-barrage.ts. The strike count is capped (STALKER_MAX_STRIKES) so a
 * volley never exhausts the 32-slot telegraph pool — an untelegraphed strike would be
 * an unfair hit. See stalker-barrage.test.ts.
 */

export interface StalkerStrike {
  x: number;
  y: number;
  /** Seconds from volley start until this strike lands (= its telegraph time). */
  impactDelay: number;
}

/** Damage footprint of one Stalker strike (handleGroundSlam radius). */
export const STALKER_BLAST_RADIUS = 58;

/** Below this player speed (px/s) there is no heading to lead — use the ring fallback. */
export const STALKER_MOVING_THRESHOLD = 35;

const STALKER_STRIKE_COUNT = 5;
const STALKER_STEP = 92;              // px between consecutive strikes marching along the heading
const STALKER_BASE_FUSE = 0.9;        // first strike lands (fair reaction window)
const STALKER_STEP_FUSE = 0.16;       // each later strike lands this much after the previous
const STALKER_STATIONARY_SPREAD = 74; // ring radius bracketing a (near-)stationary player

/** Max strikes a single volley can produce (telegraph-pool safety cap). */
export const STALKER_MAX_STRIKES = STALKER_STRIKE_COUNT;

/**
 * Plan a predictive volley. `headingX`/`headingY` must be a UNIT vector of the player's
 * current heading, or (0, 0) when the player is (near-)stationary. Moving: a line of
 * STALKER_STRIKE_COUNT strikes marching from the player's position along the heading,
 * each landing slightly later. Stationary: a ring of the same count around the player.
 * Deterministic given inputs.
 */
export function planStalkerVolley(
  playerX: number,
  playerY: number,
  headingX: number,
  headingY: number
): StalkerStrike[] {
  const moving = headingX !== 0 || headingY !== 0;
  const strikes: StalkerStrike[] = [];
  for (let i = 0; i < STALKER_STRIKE_COUNT; i++) {
    let strikeX: number;
    let strikeY: number;
    if (moving) {
      strikeX = playerX + headingX * STALKER_STEP * i;
      strikeY = playerY + headingY * STALKER_STEP * i;
    } else {
      const angle = (i * Math.PI * 2) / STALKER_STRIKE_COUNT;
      strikeX = playerX + Math.cos(angle) * STALKER_STATIONARY_SPREAD;
      strikeY = playerY + Math.sin(angle) * STALKER_STATIONARY_SPREAD;
    }
    strikes.push({ x: strikeX, y: strikeY, impactDelay: STALKER_BASE_FUSE + STALKER_STEP_FUSE * i });
  }
  return strikes;
}
