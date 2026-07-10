import { describe, test, expect } from 'vitest';
import {
  createSingularityState,
  stepSingularity,
  computePullDisplacement,
  type SingularityParams,
} from './singularityLogic';

const PARAMS: SingularityParams = {
  travelTime: 0.4,
  pullDuration: 1.6,
  pullRadius: 150,
  pullStrength: 260,
  maxTugPerFrame: 6,
};

describe('createSingularityState', () => {
  test('starts in travel at the lob origin, remembering both endpoints', () => {
    const state = createSingularityState(10, 20, 100, 200);
    expect(state.phase).toBe('travel');
    expect(state).toMatchObject({ x: 10, y: 20, startX: 10, startY: 20, targetX: 100, targetY: 200, timer: 0 });
  });
});

describe('stepSingularity — lifecycle', () => {
  test('travel lerps the position toward the target', () => {
    const state = createSingularityState(0, 0, 100, 0);
    const step = stepSingularity(state, PARAMS, PARAMS.travelTime / 2); // halfway
    expect(step.arrived).toBe(false);
    expect(step.collapsed).toBe(false);
    expect(step.state.phase).toBe('travel');
    expect(step.state.x).toBeCloseTo(50, 5);
  });

  test('reaching travelTime snaps to the target and enters pull (arrived once)', () => {
    const state = createSingularityState(0, 0, 100, 40);
    const step = stepSingularity(state, PARAMS, PARAMS.travelTime);
    expect(step.arrived).toBe(true);
    expect(step.state.phase).toBe('pull');
    expect(step.state.x).toBe(100);
    expect(step.state.y).toBe(40);
    expect(step.state.timer).toBe(0);
  });

  test('pull holds without collapsing until pullDuration elapses', () => {
    let state = stepSingularity(createSingularityState(0, 0, 0, 0), PARAMS, PARAMS.travelTime).state;
    const mid = stepSingularity(state, PARAMS, PARAMS.pullDuration - 0.1);
    expect(mid.state.phase).toBe('pull');
    expect(mid.collapsed).toBe(false);
    expect(mid.arrived).toBe(false);
  });

  test('reaching pullDuration collapses exactly once and ends in done', () => {
    let state = stepSingularity(createSingularityState(0, 0, 0, 0), PARAMS, PARAMS.travelTime).state;
    const end = stepSingularity(state, PARAMS, PARAMS.pullDuration);
    expect(end.collapsed).toBe(true);
    expect(end.state.phase).toBe('done');
  });

  test('done is terminal — no further collapse or movement', () => {
    let state = stepSingularity(createSingularityState(0, 0, 0, 0), PARAMS, PARAMS.travelTime).state;
    state = stepSingularity(state, PARAMS, PARAMS.pullDuration).state;
    const after = stepSingularity(state, PARAMS, 1.0);
    expect(after.collapsed).toBe(false);
    expect(after.state.phase).toBe('done');
    expect(after.state).toBe(state); // untouched
  });
});

describe('computePullDisplacement', () => {
  test('enemies outside the radius are not pulled', () => {
    const { dx, dy } = computePullDisplacement(0, 0, PARAMS.pullRadius + 1, 0, PARAMS, 0.016);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  test('an enemy at the core is left alone (no divide-by-zero)', () => {
    const { dx, dy } = computePullDisplacement(50, 50, 50, 50, PARAMS, 0.016);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  test('pulls inward — displacement points toward the well', () => {
    const { dx, dy } = computePullDisplacement(0, 0, 40, 30, PARAMS, 0.016);
    expect(dx).toBeLessThan(0); // enemy at +x moves toward well (−x)
    expect(dy).toBeLessThan(0);
    // direction is along the enemy→well line
    expect(dx / dy).toBeCloseTo(40 / 30, 5);
  });

  test('per-frame displacement is capped so it reads as a tug not a teleport', () => {
    // A huge dt would otherwise fling the enemy; the cap holds it to maxTugPerFrame.
    const { dx, dy } = computePullDisplacement(0, 0, 100, 0, PARAMS, 10);
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(PARAMS.maxTugPerFrame + 1e-9);
  });

  test('never overshoots the core — clamped to the remaining distance', () => {
    const closeParams: SingularityParams = { ...PARAMS, maxTugPerFrame: 1000 };
    const { dx, dy } = computePullDisplacement(0, 0, 3, 0, closeParams, 10);
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(3 + 1e-9); // can't pass the center
  });

  test('gravity-shaped — a closer enemy is pulled harder than a distant one', () => {
    // Small dt so the per-frame cap does not bind and the falloff shows through.
    const near = computePullDisplacement(0, 0, 20, 0, PARAMS, 0.001);
    const far = computePullDisplacement(0, 0, 140, 0, PARAMS, 0.001);
    expect(Math.hypot(near.dx, near.dy)).toBeGreaterThan(Math.hypot(far.dx, far.dy));
  });
});
