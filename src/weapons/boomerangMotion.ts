/**
 * Boomerang trajectory core — the pure motion model for the Boomerang Glaive.
 *
 * A glaive is thrown along its `angle`, decelerating linearly from
 * `outboundSpeed` to a standstill over `outboundDuration` seconds (so its apex
 * sits `outboundSpeed * outboundDuration / 2` px from the throw point — see
 * {@link maxOutboundDistance}). It then flips to the *return* leg, homing back to
 * the player's CURRENT position (not the launch origin, so it chases a player who
 * has walked away) until it is caught within `catchRadius`.
 *
 * `angle` lives on the per-glaive state because a single volley throws several
 * glaives at different spread angles but shares one stat-derived `params` object.
 *
 * This module is deliberately Phaser-free: it is the new, testable behaviour that
 * distinguishes the boomerang from every other weapon (all of which fire and
 * forget). The weapon class drives collision, pooling, and rendering around it.
 */

export type BoomerangPhase = 'outbound' | 'returning';

export interface BoomerangState {
  x: number;
  y: number;
  /** Launch direction in radians (fixed for the glaive's life). */
  angle: number;
  phase: BoomerangPhase;
  /** Seconds spent on the outbound leg so far (clamped to outboundDuration). */
  outboundElapsed: number;
}

export interface BoomerangParams {
  /** Seconds before the glaive turns around. */
  outboundDuration: number;
  /** Peak px/s speed at launch; decelerates linearly to 0 over outboundDuration. */
  outboundSpeed: number;
  /** px/s speed on the return leg. */
  returnSpeed: number;
  /** Distance to the player at which the glaive is considered caught. */
  catchRadius: number;
}

/** Fresh glaive at the throw point, beginning its outbound leg. */
export function createBoomerangState(originX: number, originY: number, angle: number): BoomerangState {
  return { x: originX, y: originY, angle, phase: 'outbound', outboundElapsed: 0 };
}

/**
 * Apex distance from the throw point: the area under the linear deceleration
 * ramp (a triangle of height `outboundSpeed` and base `outboundDuration`).
 */
export function maxOutboundDistance(params: BoomerangParams): number {
  return (params.outboundSpeed * params.outboundDuration) / 2;
}

/** Instantaneous outbound speed at a given elapsed time on the decel ramp. */
function outboundSpeedAt(params: BoomerangParams, elapsed: number): number {
  const fraction = Math.min(1, Math.max(0, elapsed / params.outboundDuration));
  return params.outboundSpeed * (1 - fraction);
}

/**
 * Advance a glaive by one frame. Returns the next state and whether it was caught
 * (the caller should then retire it). One leg is processed per call: the frame
 * that crosses `outboundDuration` flips to returning and does not also home that
 * same step, which keeps the integration deterministic and easy to reason about.
 */
export function stepBoomerang(
  state: BoomerangState,
  params: BoomerangParams,
  playerX: number,
  playerY: number,
  dt: number
): { state: BoomerangState; caught: boolean } {
  if (state.phase === 'outbound') {
    const elapsed = state.outboundElapsed;
    const newElapsed = elapsed + dt;

    if (newElapsed >= params.outboundDuration) {
      // Cross the apex: integrate only the slice up to outboundDuration, then flip.
      const remaining = Math.max(0, params.outboundDuration - elapsed);
      const avgSpeed = (outboundSpeedAt(params, elapsed) + 0) / 2; // speed at duration is 0
      const dist = avgSpeed * remaining;
      return {
        state: {
          x: state.x + Math.cos(state.angle) * dist,
          y: state.y + Math.sin(state.angle) * dist,
          angle: state.angle,
          phase: 'returning',
          outboundElapsed: params.outboundDuration,
        },
        caught: false,
      };
    }

    // Trapezoidal step across the decel ramp (decel-accurate, not flat Euler).
    const avgSpeed = (outboundSpeedAt(params, elapsed) + outboundSpeedAt(params, newElapsed)) / 2;
    const dist = avgSpeed * dt;
    return {
      state: {
        x: state.x + Math.cos(state.angle) * dist,
        y: state.y + Math.sin(state.angle) * dist,
        angle: state.angle,
        phase: 'outbound',
        outboundElapsed: newElapsed,
      },
      caught: false,
    };
  }

  // Returning leg: home to the player's current position.
  const dx = playerX - state.x;
  const dy = playerY - state.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= params.catchRadius) {
    // Already within reach. Snap onto the player; also guards dist === 0 (no NaN).
    return {
      state: { x: playerX, y: playerY, angle: state.angle, phase: 'returning', outboundElapsed: state.outboundElapsed },
      caught: true,
    };
  }

  // Clamp the step to the remaining gap so the glaive never overshoots.
  const step = Math.min(dist, params.returnSpeed * dt);
  const remainingGap = dist - step;
  if (remainingGap <= params.catchRadius) {
    // The step closes (or reaches) the gap — catch this frame, snapping to player.
    return {
      state: { x: playerX, y: playerY, angle: state.angle, phase: 'returning', outboundElapsed: state.outboundElapsed },
      caught: true,
    };
  }

  return {
    state: {
      x: state.x + (dx / dist) * step,
      y: state.y + (dy / dist) * step,
      angle: state.angle,
      phase: 'returning',
      outboundElapsed: state.outboundElapsed,
    },
    caught: false,
  };
}
