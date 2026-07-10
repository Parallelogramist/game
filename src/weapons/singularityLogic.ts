/**
 * Singularity lifecycle + pull core — the pure model for the Singularity weapon.
 *
 * Every other weapon in the arsenal either damages enemies where they stand or
 * kills them outright; none *reposition* the horde. The Singularity is the first
 * weapon whose primary job is crowd control by displacement: a lobbed gravity
 * well lands on a cluster, spends a short window yanking nearby enemies toward
 * its core (clumping them), then collapses in an area burst. Clumped enemies make
 * every other AOE weapon land harder — that's the build-crafting value.
 *
 * Two pure, testable pieces live here (mirrors `sentryLogic` / `boomerangMotion`):
 *   1. The lifecycle: `travel` (the lob) → `pull` (the hold) → `done` (collapsed).
 *      The collapse burst is a one-frame event flagged on the pull→done edge.
 *   2. The per-enemy pull displacement: a capped, gravity-shaped inward tug. It is
 *      deliberately a *position* nudge, not a velocity impulse — capped per frame
 *      so it reads as a steady tug rather than a teleport, gravity-shaped so the
 *      pull strengthens toward the core, and clamped so an enemy never overshoots
 *      the well's center.
 *
 * Phaser-free by design: the weapon class drives targeting, the ECS Transform
 * writes, pooling, damage, and rendering around this core.
 */

export type SingularityPhase = 'travel' | 'pull' | 'done';

export interface SingularityState {
  /** Current well position (interpolated during travel, fixed once pulling). */
  x: number;
  y: number;
  /** Lob origin — where the well was launched from. */
  startX: number;
  startY: number;
  /** Lob destination — where the well lands and begins pulling. */
  targetX: number;
  targetY: number;
  phase: SingularityPhase;
  /** Seconds elapsed within the current phase. */
  timer: number;
}

export interface SingularityParams {
  /** Seconds the lob takes to travel from origin to target. */
  travelTime: number;
  /** Seconds the well holds at its target, pulling enemies in. */
  pullDuration: number;
  /** Radius of gravitational influence (px). */
  pullRadius: number;
  /** Inward tug speed at full strength (px/sec), before falloff and the cap. */
  pullStrength: number;
  /** Maximum px an enemy may be displaced in a single frame (tug, not teleport). */
  maxTugPerFrame: number;
}

export interface SingularityStep {
  state: SingularityState;
  /** The lob reached its target this frame — the pull phase begins. */
  arrived: boolean;
  /** The pull ended this frame — trigger the collapse burst now. */
  collapsed: boolean;
}

/** Fresh well launched from (startX, startY) toward (targetX, targetY). */
export function createSingularityState(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number
): SingularityState {
  return {
    x: startX,
    y: startY,
    startX,
    startY,
    targetX,
    targetY,
    phase: 'travel',
    timer: 0,
  };
}

/**
 * Advance a well by one frame.
 *
 * During `travel` the position lerps origin→target; the frame that reaches
 * `travelTime` snaps to the target and flips to `pull` (arrived). During `pull`
 * the well holds fixed; the frame that reaches `pullDuration` flips to `done`
 * and flags `collapsed` so the caller fires the burst exactly once. `done` is
 * terminal and idempotent.
 */
export function stepSingularity(
  state: SingularityState,
  params: SingularityParams,
  dt: number
): SingularityStep {
  if (state.phase === 'done') {
    return { state, arrived: false, collapsed: false };
  }

  const timer = state.timer + dt;

  if (state.phase === 'travel') {
    if (timer >= params.travelTime) {
      return {
        state: { ...state, x: state.targetX, y: state.targetY, phase: 'pull', timer: 0 },
        arrived: true,
        collapsed: false,
      };
    }
    const progress = params.travelTime > 0 ? timer / params.travelTime : 1;
    return {
      state: {
        ...state,
        x: state.startX + (state.targetX - state.startX) * progress,
        y: state.startY + (state.targetY - state.startY) * progress,
        timer,
      },
      arrived: false,
      collapsed: false,
    };
  }

  // phase === 'pull'
  if (timer >= params.pullDuration) {
    return { state: { ...state, phase: 'done', timer }, arrived: false, collapsed: true };
  }
  return { state: { ...state, timer }, arrived: false, collapsed: false };
}

/**
 * The inward displacement to apply to one enemy this frame.
 *
 * Returns {0,0} for enemies outside `pullRadius` (or exactly at the core). Inside,
 * the pull is gravity-shaped — stronger the closer the enemy is to the core — then
 * capped at `maxTugPerFrame` and clamped to the remaining distance so the tug can
 * neither teleport an enemy across the field nor overshoot the well's center.
 */
export function computePullDisplacement(
  wellX: number,
  wellY: number,
  enemyX: number,
  enemyY: number,
  params: SingularityParams,
  dt: number
): { dx: number; dy: number } {
  const deltaX = wellX - enemyX;
  const deltaY = wellY - enemyY;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  if (distance > params.pullRadius || distance < 0.0001) {
    return { dx: 0, dy: 0 };
  }

  // Gravity falloff: 0.35 at the rim rising to 1.0 at the core.
  const falloff = 0.35 + 0.65 * (1 - distance / params.pullRadius);
  let travel = params.pullStrength * falloff * dt;
  if (travel > params.maxTugPerFrame) travel = params.maxTugPerFrame;
  if (travel > distance) travel = distance;

  const inverseDistance = 1 / distance;
  return { dx: deltaX * inverseDistance * travel, dy: deltaY * inverseDistance * travel };
}
