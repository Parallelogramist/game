/**
 * Sentry lifecycle core — the pure model for the Sentry Turret weapon.
 *
 * Every other weapon fires from (or orbits/returns to) the player. The sentry is
 * the arsenal's only *deployed* weapon: a placement drops a stationary turret at
 * the player's current position, and that turret then lives on its own — auto-
 * targeting and firing where it stands until it expires. The novel, testable
 * behaviour is therefore not a trajectory but a *lifecycle*: how long a sentry
 * lasts and how its fire cadence is gated. That is what this module owns.
 *
 * Firing is deliberately target-gated: a sentry only spends a shot when an enemy
 * is actually in range (`hasTarget`). With no target the fire timer is held at
 * "ready" (never accumulated into a burst), so the instant a target walks into
 * range the sentry fires immediately, then resumes its interval. This keeps a
 * gun line's uptime honest — idle turrets don't bank shots.
 *
 * Phaser-free by design (mirrors `boomerangMotion`): the weapon class drives
 * targeting, pooling, projectiles, and rendering around this core.
 */

export interface SentryState {
  x: number;
  y: number;
  /** Seconds the sentry has been deployed (clamped growth; expires at lifetime). */
  age: number;
  /** Seconds until the next shot is ready (counts down; held at 0 while idle). */
  fireTimer: number;
}

export interface SentryParams {
  /** Seconds a sentry survives after deployment. */
  lifetime: number;
  /** Seconds between shots while a target is in range. */
  fireInterval: number;
}

export interface SentryStep {
  state: SentryState;
  /** The sentry reached its lifetime this frame and should be retired (no shot). */
  expired: boolean;
  /** The sentry fired a shot this frame (had a target and its timer was ready). */
  fired: boolean;
}

/** Fresh sentry at the deploy point, ready to fire on its first frame with a target. */
export function createSentryState(x: number, y: number): SentryState {
  return { x, y, age: 0, fireTimer: 0 };
}

/**
 * Advance a sentry by one frame. Expiry is checked first: the frame that reaches
 * `lifetime` retires the sentry and never also fires. Otherwise the fire timer
 * decrements, and a shot is spent only when a target is present and the timer is
 * ready — the timer then advances by one interval (phase-preserving, clamped so a
 * large dt can't bank a burst). With no target the timer is pinned at ready.
 */
export function stepSentry(
  state: SentryState,
  params: SentryParams,
  dt: number,
  hasTarget: boolean
): SentryStep {
  const age = state.age + dt;
  if (age >= params.lifetime) {
    return { state: { x: state.x, y: state.y, age, fireTimer: state.fireTimer }, expired: true, fired: false };
  }

  let fireTimer = state.fireTimer - dt;
  let fired = false;
  if (hasTarget && fireTimer <= 0) {
    fired = true;
    fireTimer += params.fireInterval;
    if (fireTimer < 0) fireTimer = 0;
  } else if (fireTimer < 0) {
    fireTimer = 0;
  }

  return { state: { x: state.x, y: state.y, age, fireTimer }, expired: false, fired };
}
