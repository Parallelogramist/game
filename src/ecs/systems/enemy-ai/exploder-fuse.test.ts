import { describe, test, expect } from 'vitest';
import {
  EXPLODER_FUSE_SECONDS,
  EXPLODER_BLAST_RADIUS,
  EXPLODER_BLAST_DAMAGE,
  armExploderFuse,
  tickExploderFuses,
  type ExploderFuse,
} from './exploder-fuse';

/**
 * Pure fuse bookkeeping for the Exploder death explosion
 * (BALANCE-EXPLODER-FUSE). GameScene owns the array and the detonate
 * callback; this module owns arming and time-based expiry. The contract:
 * every armed fuse detonates exactly once at its own death position after
 * exactly EXPLODER_FUSE_SECONDS of *gameplay* time (the caller feeds the
 * pause/slow-time-scaled delta), and fuses armed at different moments
 * expire independently.
 */

interface Blast { x: number; y: number }

function collectDetonations(fuses: ExploderFuse[], dt: number): Blast[] {
  const blasts: Blast[] = [];
  tickExploderFuses(fuses, dt, (x, y) => blasts.push({ x, y }));
  return blasts;
}

describe('constants — fuse matches the approved balance change', () => {
  test('fuse is the approved 0.4s arming delay', () => {
    expect(EXPLODER_FUSE_SECONDS).toBe(0.4);
  });

  test('blast geometry matches the pre-change instant explosion (60, 20)', () => {
    expect(EXPLODER_BLAST_RADIUS).toBe(60);
    expect(EXPLODER_BLAST_DAMAGE).toBe(20);
  });
});

describe('armExploderFuse', () => {
  test('arms a full fuse at the death position', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 120, -45);
    expect(fuses).toEqual([{ x: 120, y: -45, remaining: EXPLODER_FUSE_SECONDS }]);
  });

  test('each death arms its own independent fuse', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 1, 2);
    armExploderFuse(fuses, 3, 4);
    expect(fuses).toHaveLength(2);
    expect(fuses[0]).not.toBe(fuses[1]);
  });
});

describe('tickExploderFuses — expiry', () => {
  test('does not detonate before the fuse elapses', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 10, 20);
    expect(collectDetonations(fuses, EXPLODER_FUSE_SECONDS - 0.01)).toEqual([]);
    expect(fuses).toHaveLength(1);
  });

  test('detonates at the death position once the fuse elapses, and is removed', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 10, 20);
    expect(collectDetonations(fuses, EXPLODER_FUSE_SECONDS)).toEqual([{ x: 10, y: 20 }]);
    expect(fuses).toHaveLength(0);
  });

  test('detonates exactly once — later ticks are no-ops', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 5, 5);
    expect(collectDetonations(fuses, 1.0)).toHaveLength(1);
    expect(collectDetonations(fuses, 1.0)).toHaveLength(0);
  });

  test('accumulates across small frames (60fps-style deltas)', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 0, 0);
    const dt = 1 / 60;
    let blasts: Blast[] = [];
    let frames = 0;
    while (blasts.length === 0 && frames < 120) {
      blasts = collectDetonations(fuses, dt);
      frames++;
    }
    expect(blasts).toEqual([{ x: 0, y: 0 }]);
    // 0.4s at 60fps is 24 frames; exact frame count tolerates float drift.
    expect(frames).toBeGreaterThanOrEqual(24);
    expect(frames).toBeLessThanOrEqual(25);
  });

  test('an Exploder killed during the fuse of another keeps its own fuse', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 1, 1); // first death
    tickExploderFuses(fuses, 0.3, () => { throw new Error('too early'); });
    armExploderFuse(fuses, 2, 2); // second death 0.3s later, mid-fuse

    // 0.1s later: only the first detonates (its 0.4s is up; the second has 0.3s left).
    expect(collectDetonations(fuses, 0.1)).toEqual([{ x: 1, y: 1 }]);
    expect(fuses).toHaveLength(1);

    // 0.3s later: the second detonates on its own schedule.
    expect(collectDetonations(fuses, 0.3)).toEqual([{ x: 2, y: 2 }]);
    expect(fuses).toHaveLength(0);
  });

  test('simultaneous deaths detonate together, in arm order', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 1, 1);
    armExploderFuse(fuses, 2, 2);
    expect(collectDetonations(fuses, EXPLODER_FUSE_SECONDS)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test('a detonation callback that arms a new fuse does not disturb the tick', () => {
    const fuses: ExploderFuse[] = [];
    armExploderFuse(fuses, 1, 1);
    const blasts: Blast[] = [];
    tickExploderFuses(fuses, EXPLODER_FUSE_SECONDS, (x, y) => {
      blasts.push({ x, y });
      // e.g. the blast's knockback shoves the player into killing another Exploder
      armExploderFuse(fuses, 9, 9);
    });
    expect(blasts).toEqual([{ x: 1, y: 1 }]);
    expect(fuses).toEqual([{ x: 9, y: 9, remaining: EXPLODER_FUSE_SECONDS }]);
  });

  test('empty list and zero delta are safe no-ops', () => {
    const fuses: ExploderFuse[] = [];
    expect(() => tickExploderFuses(fuses, 0.016, () => { throw new Error('no fuses'); })).not.toThrow();
    armExploderFuse(fuses, 0, 0);
    expect(collectDetonations(fuses, 0)).toEqual([]);
    expect(fuses).toHaveLength(1);
  });
});
