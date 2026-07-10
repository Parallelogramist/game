/**
 * The Bastion (boss) — pure mortar-barrage planning. Given the battlefield
 * snapshot at windup start, produces the full strike plan (impact points +
 * per-shell impact delays) so the AI handler only has to telegraph each point
 * and fire `groundSlamCallback` when its delay elapses. Pure and
 * deterministic under an injected RNG (unit-tested).
 */

export interface MortarStrike {
  x: number;
  y: number;
  /** Seconds from barrage windup start until this shell lands. */
  impactDelay: number;
}

/** Damage footprint of one mortar shell (handleGroundSlam radius). */
export const MORTAR_BLAST_RADIUS = 70;

/** Scatter shells land this close/far from the aim point (ring band). */
export const SCATTER_RING_MIN = 70;
export const SCATTER_RING_MAX = 170;

/** Drumroll spacing between scatter shell impacts. */
const SCATTER_IMPACT_STAGGER = 0.12;

/** Rolling barrage: spacing between successive line strikes. */
const ROLLING_IMPACT_STEP = 0.18;

/** Rolling barrage: fuse on the first strike of the line. Never below the
 * 0.9s dodge floor (scatterFuseForPhase(3)) — the near-player strikes land
 * even later since delays grow along the march. */
const ROLLING_BASE_FUSE = 0.9;

/** Rolling barrage: the line starts this fraction along boss→player. */
const ROLLING_START_FRACTION = 0.35;

/** Rolling barrage: the line overshoots the player by this many px. */
const ROLLING_OVERSHOOT = 120;

/** Rolling barrage: max perpendicular jitter per strike. */
export const ROLLING_JITTER = 24;

/** Per-shell damage, scaled by boss HP phase (1-3). */
export function mortarDamageForPhase(phase: number): number {
  return 22 + phase * 6;
}

/** Shells per scatter barrage, scaled by boss HP phase (1-3). */
export function scatterCountForPhase(phase: number): number {
  return 2 + phase;
}

/** Fuse (= telegraph time) on scatter shells; tightens in later phases. */
export function scatterFuseForPhase(phase: number): number {
  return 1.35 - phase * 0.15;
}

/**
 * Scatter barrage: the opening shell drops dead-on the aim point, the rest
 * land in a ring band around it, impacts staggered into a drumroll.
 */
export function planScatterBarrage(
  aimX: number,
  aimY: number,
  phase: number,
  random: () => number = Math.random
): MortarStrike[] {
  const shellCount = scatterCountForPhase(phase);
  const fuse = scatterFuseForPhase(phase);
  const strikes: MortarStrike[] = [{ x: aimX, y: aimY, impactDelay: fuse }];
  for (let shellIndex = 1; shellIndex < shellCount; shellIndex++) {
    const angle = random() * Math.PI * 2;
    const ringDistance = SCATTER_RING_MIN + random() * (SCATTER_RING_MAX - SCATTER_RING_MIN);
    strikes.push({
      x: aimX + Math.cos(angle) * ringDistance,
      y: aimY + Math.sin(angle) * ringDistance,
      impactDelay: fuse + shellIndex * SCATTER_IMPACT_STAGGER,
    });
  }
  return strikes;
}

/** Strikes in a rolling barrage line, scaled by boss HP phase (2-3). */
export function rollingCountForPhase(phase: number): number {
  return 4 + phase;
}

/**
 * Rolling barrage: a line of strikes marching from partway along the
 * boss→player axis to just past the player, landing in sequence — forces a
 * lateral dodge instead of a point dodge.
 */
export function planRollingBarrage(
  bossX: number,
  bossY: number,
  playerX: number,
  playerY: number,
  phase: number,
  random: () => number = Math.random
): MortarStrike[] {
  const dx = playerX - bossX;
  const dy = playerY - bossY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  // Boss on top of the player: march the line along +X so the barrage still fires.
  const dirX = distance < 1 ? 1 : dx / distance;
  const dirY = distance < 1 ? 0 : dy / distance;
  const perpX = -dirY;
  const perpY = dirX;

  const strikeCount = rollingCountForPhase(phase);
  const marchStart = distance * ROLLING_START_FRACTION;
  const marchEnd = distance + ROLLING_OVERSHOOT;
  const strikes: MortarStrike[] = [];
  for (let strikeIndex = 0; strikeIndex < strikeCount; strikeIndex++) {
    const marchFraction = strikeCount === 1 ? 0 : strikeIndex / (strikeCount - 1);
    const alongDistance = marchStart + (marchEnd - marchStart) * marchFraction;
    const jitter = (random() * 2 - 1) * ROLLING_JITTER;
    strikes.push({
      x: bossX + dirX * alongDistance + perpX * jitter,
      y: bossY + dirY * alongDistance + perpY * jitter,
      impactDelay: ROLLING_BASE_FUSE + strikeIndex * ROLLING_IMPACT_STEP,
    });
  }
  return strikes;
}
