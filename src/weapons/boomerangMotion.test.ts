import { describe, test, expect } from 'vitest';
import {
  createBoomerangState,
  maxOutboundDistance,
  stepBoomerang,
  type BoomerangParams,
  type BoomerangState,
} from './boomerangMotion';

// A canonical glaive: launched straight along +x, peak 300 px/s, turns around
// after 1s (so apex is 150px out), returns at 360 px/s, caught within 20px.
function params(overrides: Partial<BoomerangParams> = {}): BoomerangParams {
  return {
    outboundDuration: 1,
    outboundSpeed: 300,
    returnSpeed: 360,
    catchRadius: 20,
    ...overrides,
  };
}

/** Run stepBoomerang repeatedly until caught or a frame budget is exhausted. */
function simulate(
  state: BoomerangState,
  p: BoomerangParams,
  playerAt: () => { x: number; y: number },
  dt: number,
  maxFrames: number
): { state: BoomerangState; caught: boolean; frames: number } {
  let s = state;
  for (let frame = 1; frame <= maxFrames; frame++) {
    const player = playerAt();
    const result = stepBoomerang(s, p, player.x, player.y, dt);
    s = result.state;
    if (result.caught) return { state: s, caught: true, frames: frame };
  }
  return { state: s, caught: false, frames: maxFrames };
}

describe('createBoomerangState', () => {
  test('starts at the origin, outbound, with zero elapsed', () => {
    const s = createBoomerangState(100, 200, Math.PI / 2);
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
    expect(s.phase).toBe('outbound');
    expect(s.outboundElapsed).toBe(0);
  });
});

describe('maxOutboundDistance', () => {
  test('equals the area under a linear deceleration ramp: speed * duration / 2', () => {
    expect(maxOutboundDistance(params())).toBeCloseTo(150, 6);
    expect(maxOutboundDistance(params({ outboundSpeed: 400, outboundDuration: 2 }))).toBeCloseTo(400, 6);
  });
});

describe('stepBoomerang — outbound leg', () => {
  test('travels along the launch angle only (angle 0 → pure +x)', () => {
    const s0 = createBoomerangState(0, 0, 0);
    const { state } = stepBoomerang(s0, params(), 0, 0, 0.1);
    expect(state.x).toBeGreaterThan(0);
    expect(state.y).toBeCloseTo(0, 9);
    expect(state.phase).toBe('outbound');
  });

  test('launched along +y moves in +y only', () => {
    const s0 = createBoomerangState(0, 0, Math.PI / 2);
    const { state } = stepBoomerang(s0, params(), 0, 0, 0.1);
    expect(state.y).toBeGreaterThan(0);
    expect(state.x).toBeCloseTo(0, 9);
  });

  test('distance covered increases monotonically while outbound', () => {
    let s = createBoomerangState(0, 0, 0);
    const p = params();
    let prevX = -1;
    for (let i = 0; i < 5; i++) {
      s = stepBoomerang(s, p, 0, 0, 0.1).state;
      if (s.phase !== 'outbound') break;
      expect(s.x).toBeGreaterThan(prevX);
      prevX = s.x;
    }
  });

  test('decelerates: a later equal-length step covers less ground than an earlier one', () => {
    const p = params();
    let s = createBoomerangState(0, 0, 0);
    const before1 = s.x;
    s = stepBoomerang(s, p, 0, 0, 0.2).state;
    const firstStep = s.x - before1;
    const before2 = s.x;
    s = stepBoomerang(s, p, 0, 0, 0.2).state;
    const secondStep = s.x - before2;
    expect(secondStep).toBeLessThan(firstStep);
    expect(secondStep).toBeGreaterThan(0);
  });

  test('reaches very close to maxOutboundDistance by the time it turns around', () => {
    const p = params();
    let s = createBoomerangState(0, 0, 0);
    // Step in fine increments until it flips to returning.
    for (let i = 0; i < 1000 && s.phase === 'outbound'; i++) {
      s = stepBoomerang(s, p, 0, 0, 0.01).state;
    }
    expect(s.phase).toBe('returning');
    expect(s.x).toBeCloseTo(maxOutboundDistance(p), 1);
  });

  test('flips to returning on the step that crosses outboundDuration', () => {
    const p = params({ outboundDuration: 0.5 });
    let s = createBoomerangState(0, 0, 0);
    s = stepBoomerang(s, p, 0, 0, 0.3).state; // elapsed 0.3 < 0.5
    expect(s.phase).toBe('outbound');
    s = stepBoomerang(s, p, 0, 0, 0.3).state; // elapsed would be 0.6 > 0.5 → flip
    expect(s.phase).toBe('returning');
  });
});

describe('stepBoomerang — return leg', () => {
  test('a returning glaive moves toward the player, reducing the gap each frame', () => {
    // Place a returning glaive far to the right; player at origin.
    const s: BoomerangState = { x: 200, y: 0, angle: 0, phase: 'returning', outboundElapsed: 1 };
    const p = params();
    const distBefore = Math.hypot(s.x - 0, s.y - 0);
    const next = stepBoomerang(s, p, 0, 0, 0.1).state;
    const distAfter = Math.hypot(next.x - 0, next.y - 0);
    expect(distAfter).toBeLessThan(distBefore);
  });

  test('homes to the player and reports caught within catchRadius', () => {
    const s = createBoomerangState(0, 0, 0);
    const result = simulate(s, params(), () => ({ x: 0, y: 0 }), 1 / 60, 600);
    expect(result.caught).toBe(true);
  });

  test('tracks a MOVED player on the return leg (returns to where the player is now, not launch origin)', () => {
    // Player has walked far away from the launch origin; the glaive must chase it.
    const s = createBoomerangState(0, 0, 0);
    const result = simulate(s, params(), () => ({ x: 400, y: 300 }), 1 / 60, 1200);
    expect(result.caught).toBe(true);
    expect(result.state.x).toBeCloseTo(400, 0);
    expect(result.state.y).toBeCloseTo(300, 0);
  });

  test('never overshoots the player even with a huge dt (clamps the return step to the gap)', () => {
    const s: BoomerangState = { x: 50, y: 0, angle: 0, phase: 'returning', outboundElapsed: 1 };
    const p = params({ catchRadius: 1 });
    // returnSpeed * dt = 360 * 10 = 3600 px, far past the 50px gap.
    const { state, caught } = stepBoomerang(s, p, 0, 0, 10);
    expect(caught).toBe(true);
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
  });

  test('does not produce NaN when the glaive is exactly on the player (zero-distance guard)', () => {
    const s: BoomerangState = { x: 0, y: 0, angle: 0, phase: 'returning', outboundElapsed: 1 };
    const { state, caught } = stepBoomerang(s, params(), 0, 0, 0.1);
    expect(caught).toBe(true);
    expect(Number.isNaN(state.x)).toBe(false);
    expect(Number.isNaN(state.y)).toBe(false);
  });
});
