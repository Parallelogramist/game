import { describe, test, expect } from 'vitest';
import {
  createSentryState,
  stepSentry,
  type SentryParams,
  type SentryState,
} from './sentryLogic';

// A canonical turret: lives 6s, fires every 0.5s while a target is in range.
function params(overrides: Partial<SentryParams> = {}): SentryParams {
  return { lifetime: 6, fireInterval: 0.5, ...overrides };
}

/** Simulate a sentry at fixed dt, returning shots fired and the frame it expired. */
function simulate(
  state: SentryState,
  p: SentryParams,
  dt: number,
  hasTargetAt: (frame: number) => boolean,
  maxFrames: number
): { shots: number; expiredFrame: number; state: SentryState } {
  let s = state;
  let shots = 0;
  for (let frame = 1; frame <= maxFrames; frame++) {
    const step = stepSentry(s, p, dt, hasTargetAt(frame));
    s = step.state;
    if (step.fired) shots++;
    if (step.expired) return { shots, expiredFrame: frame, state: s };
  }
  return { shots, expiredFrame: -1, state: s };
}

describe('createSentryState', () => {
  test('starts at the deploy point, ready to fire', () => {
    const state = createSentryState(120, 80);
    expect(state.x).toBe(120);
    expect(state.y).toBe(80);
    expect(state.age).toBe(0);
    expect(state.fireTimer).toBe(0);
  });
});

describe('stepSentry — firing cadence', () => {
  test('fires immediately on the first frame with a target', () => {
    const step = stepSentry(createSentryState(0, 0), params(), 1 / 60, true);
    expect(step.fired).toBe(true);
    expect(step.expired).toBe(false);
    expect(step.state.fireTimer).toBeGreaterThan(0);
  });

  test('does not fire without a target, and holds the timer at ready', () => {
    const step = stepSentry(createSentryState(0, 0), params(), 1 / 60, false);
    expect(step.fired).toBe(false);
    expect(step.state.fireTimer).toBe(0);
  });

  test('fires the instant a target appears after an idle stretch (no banked burst)', () => {
    // 2s idle (no target), then a target appears: exactly one shot that frame.
    const dt = 1 / 60;
    let s = createSentryState(0, 0);
    for (let i = 0; i < 120; i++) s = stepSentry(s, params(), dt, false).state;
    const step = stepSentry(s, params(), dt, true);
    expect(step.fired).toBe(true);
    // Next frame must NOT fire again (interval now enforced).
    expect(stepSentry(step.state, params(), dt, true).fired).toBe(false);
  });

  test('shot count over a full lifetime matches the interval (continuous target)', () => {
    // Ready at t=0, then every 0.5s while alive (6s / 0.5s → ~12 shots at
    // 0, 0.5, ... 5.5). Band tolerates the frame the expiry lands on.
    const { shots, expiredFrame } = simulate(
      createSentryState(0, 0), params(), 1 / 60, () => true, 10_000
    );
    expect(shots).toBeGreaterThanOrEqual(11);
    expect(shots).toBeLessThanOrEqual(13);
    expect(expiredFrame).toBeGreaterThan(0);
  });
});

describe('stepSentry — expiry', () => {
  test('expires exactly when age reaches lifetime and does not fire that frame', () => {
    const dt = 0.5;
    let s = createSentryState(0, 0);
    let lastFired = false;
    let expiredAtAge = -1;
    for (let i = 0; i < 100; i++) {
      const step = stepSentry(s, params({ lifetime: 2, fireInterval: 0.5 }), dt, true);
      s = step.state;
      if (step.expired) { lastFired = step.fired; expiredAtAge = s.age; break; }
    }
    expect(expiredAtAge).toBeCloseTo(2, 5);
    expect(lastFired).toBe(false);
  });

  test('a large dt still expires cleanly (age overshoots lifetime, no fire)', () => {
    const step = stepSentry(createSentryState(0, 0), params({ lifetime: 1 }), 5, true);
    expect(step.expired).toBe(true);
    expect(step.fired).toBe(false);
  });
});
