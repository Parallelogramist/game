import { describe, it, expect } from 'vitest';
import { createWakeEmitter, stepWakeEmitter } from './wakeLogic';

const SPACING = 10;

describe('wakeLogic — distance-gated segment emission', () => {
  it('the first sample only seeds the origin (no segment)', () => {
    const emitter = createWakeEmitter();
    const step = stepWakeEmitter(emitter, 100, 200, SPACING);
    expect(step.emitPoints).toHaveLength(0);
    expect(step.state.initialized).toBe(true);
    expect(step.state.lastX).toBe(100);
    expect(step.state.lastY).toBe(200);
  });

  it('moving less than spacing emits nothing but accumulates distance', () => {
    let s = stepWakeEmitter(createWakeEmitter(), 0, 0, SPACING).state;
    const step = stepWakeEmitter(s, 6, 0, SPACING);
    expect(step.emitPoints).toHaveLength(0);
    expect(step.state.distanceSinceEmit).toBeCloseTo(6);
  });

  it('moving exactly one spacing drops one segment at the end point', () => {
    let s = stepWakeEmitter(createWakeEmitter(), 0, 0, SPACING).state;
    const step = stepWakeEmitter(s, SPACING, 0, SPACING);
    expect(step.emitPoints).toHaveLength(1);
    expect(step.emitPoints[0].x).toBeCloseTo(SPACING);
    expect(step.emitPoints[0].y).toBeCloseTo(0);
    expect(step.state.distanceSinceEmit).toBeCloseTo(0);
  });

  it('a single long step (low FPS / dash) drops every segment it passed over', () => {
    let s = stepWakeEmitter(createWakeEmitter(), 0, 0, SPACING).state;
    const step = stepWakeEmitter(s, 25, 0, SPACING); // 2.5× spacing in one frame
    expect(step.emitPoints).toHaveLength(2);
    expect(step.emitPoints[0].x).toBeCloseTo(10);
    expect(step.emitPoints[1].x).toBeCloseTo(20);
    expect(step.state.distanceSinceEmit).toBeCloseTo(5); // remainder carries
  });

  it('accumulates carried distance across frames and emits at the crossing point', () => {
    let s = stepWakeEmitter(createWakeEmitter(), 0, 0, SPACING).state;
    s = stepWakeEmitter(s, 8, 0, SPACING).state; // carry 8
    const step = stepWakeEmitter(s, 12, 0, SPACING); // +4 → crosses 10 at x=10
    expect(step.emitPoints).toHaveLength(1);
    expect(step.emitPoints[0].x).toBeCloseTo(10);
    expect(step.state.distanceSinceEmit).toBeCloseTo(2);
  });

  it('places segments on the diagonal at the correct arc length', () => {
    let s = stepWakeEmitter(createWakeEmitter(), 0, 0, SPACING).state;
    // Move (30,40): length 50 → 5 segments at 10px spacing along the (0.6,0.8) dir.
    const step = stepWakeEmitter(s, 30, 40, SPACING);
    expect(step.emitPoints).toHaveLength(5);
    expect(step.emitPoints[0].x).toBeCloseTo(6);
    expect(step.emitPoints[0].y).toBeCloseTo(8);
    expect(step.emitPoints[4].x).toBeCloseTo(30);
    expect(step.emitPoints[4].y).toBeCloseTo(40);
    expect(step.state.distanceSinceEmit).toBeCloseTo(0);
  });

  it('standing still emits nothing and never produces NaN', () => {
    let s = stepWakeEmitter(createWakeEmitter(), 50, 50, SPACING).state;
    const step = stepWakeEmitter(s, 50, 50, SPACING);
    expect(step.emitPoints).toHaveLength(0);
    expect(Number.isNaN(step.state.distanceSinceEmit)).toBe(false);
    expect(step.state.distanceSinceEmit).toBeCloseTo(0);
  });

  it('a non-positive spacing is inert (guards against divide-by-zero)', () => {
    let s = stepWakeEmitter(createWakeEmitter(), 0, 0, 0).state;
    const step = stepWakeEmitter(s, 100, 0, 0);
    expect(step.emitPoints).toHaveLength(0);
    expect(step.state.lastX).toBe(100);
  });
});
