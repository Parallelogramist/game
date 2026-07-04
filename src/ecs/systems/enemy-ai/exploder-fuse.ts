/**
 * Pure fuse bookkeeping for the Exploder's death explosion
 * (BALANCE-EXPLODER-FUSE). Instead of detonating the same frame it dies, an
 * Exploder arms a short fuse at its death position — GameScene shows the
 * matching telegraph ring (`exploderFuseTelegraph` in ./telegraphs.ts), ticks
 * the fuse list from its gated update loop with gameplay delta, and fires the
 * same `handleExplosion(x, y, EXPLODER_BLAST_RADIUS, EXPLODER_BLAST_DAMAGE)`
 * when a fuse elapses.
 *
 * Deliberately NOT here: VOLATILE elite affix detonations stay instant
 * (parked in BACKLOG.md), and teardown safety is the caller's job (GameScene
 * clears its fuse array in resetInRunFeatureState and only ticks while the
 * run is live).
 */

/** Seconds between an Exploder's death and its detonation. */
export const EXPLODER_FUSE_SECONDS = 0.4;
/** Blast radius — unchanged from the pre-fuse instant explosion. */
export const EXPLODER_BLAST_RADIUS = 60;
/** Blast damage — unchanged from the pre-fuse instant explosion. */
export const EXPLODER_BLAST_DAMAGE = 20;

/**
 * Accumulated frame deltas carry float error (0.3 + 0.1 sums past 0.4 by
 * ~3e-17), which would push detonation one frame late. Well below one frame,
 * far above accumulated drift.
 */
const FUSE_EPSILON = 1e-9;

export interface ExploderFuse {
  x: number;
  y: number;
  /** Gameplay seconds until detonation. */
  remaining: number;
}

/** Arms a fresh, independent fuse at a death position. */
export function armExploderFuse(fuses: ExploderFuse[], x: number, y: number): void {
  fuses.push({ x, y, remaining: EXPLODER_FUSE_SECONDS });
}

/**
 * Advances every fuse by `deltaSeconds` and detonates the expired ones (in
 * arm order). Expired fuses are removed BEFORE `detonate` runs, so a callback
 * may safely arm new fuses on the same array (they just append).
 */
export function tickExploderFuses(
  fuses: ExploderFuse[],
  deltaSeconds: number,
  detonate: (x: number, y: number) => void
): void {
  if (fuses.length === 0) return;

  const expired: ExploderFuse[] = [];
  for (let i = fuses.length - 1; i >= 0; i--) {
    const fuse = fuses[i];
    fuse.remaining -= deltaSeconds;
    if (fuse.remaining <= FUSE_EPSILON) {
      expired.unshift(fuse); // reverse iteration → unshift restores arm order
      fuses.splice(i, 1);
    }
  }
  for (const fuse of expired) {
    detonate(fuse.x, fuse.y);
  }
}
