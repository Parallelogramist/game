import { describe, test, expect } from 'vitest';
import {
  planScatterBarrage,
  planRollingBarrage,
  scatterCountForPhase,
  scatterFuseForPhase,
  rollingCountForPhase,
  mortarDamageForPhase,
  MORTAR_BLAST_RADIUS,
  SCATTER_RING_MIN,
  SCATTER_RING_MAX,
  ROLLING_JITTER,
} from './bastion-barrage';

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('planScatterBarrage', () => {
  test('shell count scales with phase (3/4/5)', () => {
    for (const phase of [1, 2, 3]) {
      const strikes = planScatterBarrage(400, 300, phase, seededRandom(7));
      expect(strikes).toHaveLength(scatterCountForPhase(phase));
    }
    expect(scatterCountForPhase(1)).toBe(3);
    expect(scatterCountForPhase(3)).toBe(5);
  });

  test('opening shell drops dead-on the aim point at the phase fuse', () => {
    const strikes = planScatterBarrage(512, 384, 2, seededRandom(3));
    expect(strikes[0].x).toBe(512);
    expect(strikes[0].y).toBe(384);
    expect(strikes[0].impactDelay).toBeCloseTo(scatterFuseForPhase(2));
  });

  test('follow-up shells land inside the scatter ring band', () => {
    const strikes = planScatterBarrage(0, 0, 3, seededRandom(11));
    for (const strike of strikes.slice(1)) {
      const distance = Math.sqrt(strike.x ** 2 + strike.y ** 2);
      expect(distance).toBeGreaterThanOrEqual(SCATTER_RING_MIN - 1e-9);
      expect(distance).toBeLessThanOrEqual(SCATTER_RING_MAX + 1e-9);
    }
  });

  test('impact delays drumroll strictly upward from the fuse', () => {
    const strikes = planScatterBarrage(100, 100, 3, seededRandom(5));
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].impactDelay).toBeGreaterThan(strikes[i - 1].impactDelay);
    }
  });

  test('fuse tightens in later phases but never below a dodgeable window', () => {
    expect(scatterFuseForPhase(1)).toBeGreaterThan(scatterFuseForPhase(3));
    expect(scatterFuseForPhase(3)).toBeGreaterThanOrEqual(0.9);
  });

  test('deterministic under the same seed', () => {
    const a = planScatterBarrage(250, 250, 2, seededRandom(42));
    const b = planScatterBarrage(250, 250, 2, seededRandom(42));
    expect(a).toEqual(b);
  });
});

describe('planRollingBarrage', () => {
  test('strike count scales with phase (6 at phase 2, 7 at phase 3)', () => {
    expect(planRollingBarrage(0, 0, 500, 0, 2, seededRandom(1))).toHaveLength(rollingCountForPhase(2));
    expect(rollingCountForPhase(2)).toBe(6);
    expect(rollingCountForPhase(3)).toBe(7);
  });

  test('line marches from partway along the axis to past the player', () => {
    const strikes = planRollingBarrage(0, 0, 400, 0, 2, () => 0.5);
    // jitter of exactly 0 when random() = 0.5, so strikes sit on the axis
    expect(strikes[0].x).toBeCloseTo(400 * 0.35);
    expect(strikes[strikes.length - 1].x).toBeCloseTo(400 + 120);
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].x).toBeGreaterThan(strikes[i - 1].x);
    }
  });

  test('impact delays land in march order', () => {
    const strikes = planRollingBarrage(100, 100, 600, 500, 3, seededRandom(9));
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].impactDelay).toBeGreaterThan(strikes[i - 1].impactDelay);
    }
  });

  test('perpendicular jitter stays bounded', () => {
    const strikes = planRollingBarrage(0, 0, 500, 0, 3, seededRandom(13));
    for (const strike of strikes) {
      expect(Math.abs(strike.y)).toBeLessThanOrEqual(ROLLING_JITTER + 1e-9);
    }
  });

  test('strikes near the player never arrive with a sub-dodgeable warning', () => {
    // The march runs boss → past the player, so near-player strikes are late
    // in the sequence. Lock the effective warning at the player's position to
    // at least the tightest scatter fuse (0.9s) regardless of jitter.
    for (const phase of [2, 3]) {
      const strikes = planRollingBarrage(0, 0, 500, 0, phase, seededRandom(21));
      for (const strike of strikes) {
        const distanceToPlayer = Math.sqrt((strike.x - 500) ** 2 + strike.y ** 2);
        if (distanceToPlayer <= MORTAR_BLAST_RADIUS + 40) {
          expect(strike.impactDelay).toBeGreaterThanOrEqual(scatterFuseForPhase(3) - 1e-9);
        }
      }
      expect(strikes[0].impactDelay).toBeGreaterThanOrEqual(scatterFuseForPhase(3) - 1e-9);
    }
  });

  test('boss standing on the player still produces a marching line', () => {
    const strikes = planRollingBarrage(300, 300, 300, 300, 2, () => 0.5);
    expect(strikes).toHaveLength(rollingCountForPhase(2));
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].x).toBeGreaterThan(strikes[i - 1].x);
    }
    for (const strike of strikes) {
      expect(Number.isFinite(strike.x)).toBe(true);
      expect(Number.isFinite(strike.y)).toBe(true);
    }
  });
});

describe('mortarDamageForPhase', () => {
  test('scales 28/34/40 across phases', () => {
    expect(mortarDamageForPhase(1)).toBe(28);
    expect(mortarDamageForPhase(2)).toBe(34);
    expect(mortarDamageForPhase(3)).toBe(40);
  });
});
