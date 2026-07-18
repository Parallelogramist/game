/**
 * The Bombard (miniboss) — pure mortar-cluster planning. A salvo is a flat list
 * of ground-strike points + per-strike impact delays, so the AI handler only has
 * to telegraph each point and fire `groundSlamCallback` when its delay elapses.
 * Deterministic and unit-tested.
 *
 * Mirrors pulsar-barrage.ts. The strike count is capped (BOMBARD_MAX_STRIKES) so a
 * salvo never exhausts the 32-slot telegraph pool — an untelegraphed strike would
 * be an unfair hit. See bombard-barrage.test.ts.
 */

export interface BombardStrike {
  x: number;
  y: number;
  /** Seconds from salvo start until this strike lands (= its telegraph time). */
  impactDelay: number;
}

/** Damage footprint of one Bombard strike (handleGroundSlam radius). */
export const BOMBARD_BLAST_RADIUS = 62;

const SATELLITE_COUNT = 5;
const SATELLITE_RADIUS = 95;   // ring of satellite strikes around the center
const CENTER_FUSE = 1.1;       // center strike lands first (fair dodge window)
const SATELLITE_FUSE = 1.35;   // satellites bloom outward, land ~0.25s later

/** Max strikes a single salvo can produce (telegraph-pool safety cap). */
export const BOMBARD_MAX_STRIKES = 1 + SATELLITE_COUNT;

/**
 * Plan a mortar cluster centered on (targetX, targetY): one central strike plus a
 * ring of SATELLITE_COUNT satellites, the ring rotated by `ringRotation` so
 * consecutive salvos don't perfectly overlap. Center lands first, satellites bloom
 * outward. Deterministic given inputs.
 */
export function planMortarCluster(
  targetX: number,
  targetY: number,
  ringRotation: number
): BombardStrike[] {
  const strikes: BombardStrike[] = [
    { x: targetX, y: targetY, impactDelay: CENTER_FUSE },
  ];
  for (let i = 0; i < SATELLITE_COUNT; i++) {
    const angle = ringRotation + (i * Math.PI * 2) / SATELLITE_COUNT;
    strikes.push({
      x: targetX + Math.cos(angle) * SATELLITE_RADIUS,
      y: targetY + Math.sin(angle) * SATELLITE_RADIUS,
      impactDelay: SATELLITE_FUSE,
    });
  }
  return strikes;
}
