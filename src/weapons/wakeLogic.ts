/**
 * Wake emission core — the pure model for the Wake weapon.
 *
 * Every other weapon fires on a clock: a cooldown ticks and the weapon attacks,
 * regardless of what the player is doing. The Wake is the arsenal's only
 * *movement-driven* weapon — it lays a lingering caustic trail behind the ship as
 * it travels, and its output is a function of how far you move, not how much time
 * passes. Stand still and the wake stops growing; sprint and you paint a long
 * damaging ribbon the horde has to cross. That rewards mobility/kiting builds the
 * inverse of Guardian's face-tank.
 *
 * The novel, testable behaviour is the *distance-gated* emission cadence: drop a
 * segment every `spacing` px TRAVELLED, placed at an even arc-length along the
 * path — not once per frame. This is what makes the wake uniform whether the ship
 * crawls or sprints, and correct under a low-FPS single-frame jump (it drops every
 * segment the path passed over, not just one). Segment aging/expiry is trivial
 * (age += dt) and lives in the weapon class; this module owns the part that isn't.
 *
 * Phaser-free by design (mirrors `sentryLogic` / `singularityLogic`): the weapon
 * class drives the segment pool, collision, the slow, and rendering around this.
 */

export interface WakeEmitterState {
  /** Last sampled player position — the origin of the next path segment. */
  lastX: number;
  lastY: number;
  /** Arc length travelled since the last segment was dropped (carries across frames). */
  distanceSinceEmit: number;
  /** False until the first sample seeds the origin (no segment on that frame). */
  initialized: boolean;
}

export interface WakePoint {
  x: number;
  y: number;
}

export interface WakeEmitStep {
  state: WakeEmitterState;
  /** Segment points to drop this frame, ordered oldest→newest along the path. */
  emitPoints: WakePoint[];
}

/** Fresh emitter — the first `stepWakeEmitter` call only seeds the origin. */
export function createWakeEmitter(): WakeEmitterState {
  return { lastX: 0, lastY: 0, distanceSinceEmit: 0, initialized: false };
}

/**
 * Advance the emitter by one movement sample.
 *
 * Given the ship's new position and the desired `spacing` (px between segments),
 * returns the next emitter state plus every segment point to drop this frame.
 * Points are placed at an even arc-length spacing ALONG the path travelled since
 * the last emit — so a single long step (low FPS / a dash) drops all the segments
 * it swept over, and the wake stays uniform at any speed. The first sample seeds
 * the origin and emits nothing; emission begins once the ship has moved `spacing`
 * px in total.
 */
export function stepWakeEmitter(
  state: WakeEmitterState,
  x: number,
  y: number,
  spacing: number
): WakeEmitStep {
  if (!state.initialized) {
    return { state: { lastX: x, lastY: y, distanceSinceEmit: 0, initialized: true }, emitPoints: [] };
  }

  const deltaX = x - state.lastX;
  const deltaY = y - state.lastY;
  const stepDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  if (stepDistance < 0.0001 || spacing <= 0) {
    return { state: { ...state, lastX: x, lastY: y }, emitPoints: [] };
  }

  const dirX = deltaX / stepDistance;
  const dirY = deltaY / stepDistance;

  const emitPoints: WakePoint[] = [];
  let cursorX = state.lastX;
  let cursorY = state.lastY;
  let travelled = 0; // arc length of this step already consumed
  let distanceSinceEmit = state.distanceSinceEmit;
  let untilNext = spacing - distanceSinceEmit; // distance from cursor to the next emit point

  while (travelled + untilNext <= stepDistance) {
    cursorX += dirX * untilNext;
    cursorY += dirY * untilNext;
    emitPoints.push({ x: cursorX, y: cursorY });
    travelled += untilNext;
    distanceSinceEmit = 0;
    untilNext = spacing;
  }
  distanceSinceEmit += stepDistance - travelled;

  return {
    state: { lastX: x, lastY: y, distanceSinceEmit, initialized: true },
    emitPoints,
  };
}
