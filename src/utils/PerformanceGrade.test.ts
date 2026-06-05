import { describe, test, expect } from 'vitest';
import { computeRunScore, computePerformanceGrade } from './PerformanceGrade';

// PerformanceGrade is the canonical run-scoring + grade contract shared by
// BestScoreManager (persisted best), DailyChallengeManager (leaderboard rank),
// RunHistoryManager (recorded summaries), and the S–F results badge. These two
// pure functions therefore decide leaderboard ordering and the grade thresholds
// four consumers depend on, yet had no direct coverage — a tuning tweak could
// silently shift ranking or grade cutoffs. This file locks the formula + the
// baseline-scaled thresholds so any change is a deliberate, visible diff.

// Baseline is 4000 * max(1, worldLevel). At world level 1 the baseline is 4000,
// so these are the exact score cutoffs for each grade (non-victory):
//   S: ratio >= 2.5  -> score >= 10000
//   A: ratio >= 1.6  -> score >=  6400
//   B: ratio >= 1.0  -> score >=  4000
//   C: ratio >= 0.6  -> score >=  2400
//   D: ratio >= 0.3  -> score >=  1200
//   F: ratio <  0.3  -> score <   1200

describe('computeRunScore', () => {
  test('an all-zero run scores 0', () => {
    expect(
      computeRunScore({
        killCount: 0,
        survivalSeconds: 0,
        level: 0,
        damageDealt: 0,
        highestCombo: 0,
        wasVictory: false,
      }),
    ).toBe(0);
  });

  test('sums each term with its documented weight', () => {
    // 100*10 + 300*3 + 20*50 + 50000/100 + 50*5 + 0 (no victory)
    // = 1000 + 900 + 1000 + 500 + 250 = 3650
    expect(
      computeRunScore({
        killCount: 100,
        survivalSeconds: 300,
        level: 20,
        damageDealt: 50000,
        highestCombo: 50,
        wasVictory: false,
      }),
    ).toBe(3650);
  });

  test('kills are weighted x10', () => {
    expect(score({ killCount: 7 })).toBe(70);
  });

  test('survival seconds are weighted x3', () => {
    expect(score({ survivalSeconds: 11 })).toBe(33);
  });

  test('level is weighted x50', () => {
    expect(score({ level: 4 })).toBe(200);
  });

  test('damage dealt is weighted /100', () => {
    expect(score({ damageDealt: 12300 })).toBe(123);
  });

  test('highest combo is weighted x5', () => {
    expect(score({ highestCombo: 9 })).toBe(45);
  });

  test('a victory adds exactly 5000', () => {
    const base = score({ killCount: 10 }); // 100
    const won = score({ killCount: 10, wasVictory: true });
    expect(won - base).toBe(5000);
  });

  test('a non-victory adds nothing for the victory term', () => {
    expect(score({ killCount: 10, wasVictory: false })).toBe(100);
  });

  test('rounds the composite to the nearest integer (round half up)', () => {
    // damageDealt 250 -> 2.5, the only contributing term -> Math.round(2.5) === 3
    expect(score({ damageDealt: 250 })).toBe(3);
    // survivalSeconds 1.5 -> 4.5 -> 5
    expect(score({ survivalSeconds: 1.5 })).toBe(5);
    // damageDealt 240 -> 2.4 -> 2
    expect(score({ damageDealt: 240 })).toBe(2);
  });

  test('is deterministic for identical inputs', () => {
    const params = {
      killCount: 42,
      survivalSeconds: 137,
      level: 13,
      damageDealt: 98765,
      highestCombo: 27,
      wasVictory: true,
    };
    expect(computeRunScore(params)).toBe(computeRunScore(params));
  });
});

describe('computePerformanceGrade', () => {
  describe('grade thresholds at world level 1 (baseline 4000, no victory)', () => {
    test('score at the S cutoff is S', () => {
      expect(computePerformanceGrade(10000, 1, false).grade).toBe('S');
    });
    test('just below the S cutoff is A', () => {
      expect(computePerformanceGrade(9999, 1, false).grade).toBe('A');
    });
    test('score at the A cutoff is A', () => {
      expect(computePerformanceGrade(6400, 1, false).grade).toBe('A');
    });
    test('just below the A cutoff is B', () => {
      expect(computePerformanceGrade(6399, 1, false).grade).toBe('B');
    });
    test('score at the B cutoff is B', () => {
      expect(computePerformanceGrade(4000, 1, false).grade).toBe('B');
    });
    test('just below the B cutoff is C', () => {
      expect(computePerformanceGrade(3999, 1, false).grade).toBe('C');
    });
    test('score at the C cutoff is C', () => {
      expect(computePerformanceGrade(2400, 1, false).grade).toBe('C');
    });
    test('just below the C cutoff is D', () => {
      expect(computePerformanceGrade(2399, 1, false).grade).toBe('D');
    });
    test('score at the D cutoff is D', () => {
      expect(computePerformanceGrade(1200, 1, false).grade).toBe('D');
    });
    test('just below the D cutoff is F', () => {
      expect(computePerformanceGrade(1199, 1, false).grade).toBe('F');
    });
    test('a zero score is F', () => {
      expect(computePerformanceGrade(0, 1, false).grade).toBe('F');
    });
  });

  describe('world-level baseline scaling', () => {
    test('the same score grades lower at a higher world level', () => {
      // 10000 is S at wl1 (ratio 2.5) but only B at wl2 (baseline 8000, ratio 1.25)
      expect(computePerformanceGrade(10000, 1, false).grade).toBe('S');
      expect(computePerformanceGrade(10000, 2, false).grade).toBe('B');
    });

    test('S at world level 5 needs 5x the score it needs at world level 1', () => {
      // baseline 4000*5 = 20000, S needs ratio 2.5 -> score 50000
      expect(computePerformanceGrade(50000, 5, false).grade).toBe('S');
      expect(computePerformanceGrade(49999, 5, false).grade).toBe('A');
    });

    test('world level 0 is clamped to baseline 4000 (same as world level 1)', () => {
      expect(computePerformanceGrade(10000, 0, false).grade).toBe('S');
      expect(computePerformanceGrade(9999, 0, false).grade).toBe('A');
    });

    test('a negative world level is clamped to baseline 4000', () => {
      expect(computePerformanceGrade(10000, -3, false).grade).toBe('S');
    });
  });

  describe('victory tier bump', () => {
    test('a victory bumps the grade up exactly one tier', () => {
      // 4000 at wl1 is B without victory; a win bumps it to A.
      expect(computePerformanceGrade(4000, 1, false).grade).toBe('B');
      expect(computePerformanceGrade(4000, 1, true).grade).toBe('A');
    });

    test('a victory bump from F yields D', () => {
      expect(computePerformanceGrade(0, 1, false).grade).toBe('F');
      expect(computePerformanceGrade(0, 1, true).grade).toBe('D');
    });

    test('a victory at the S cutoff stays S (bump caps, no overflow)', () => {
      expect(computePerformanceGrade(10000, 1, false).grade).toBe('S');
      expect(computePerformanceGrade(10000, 1, true).grade).toBe('S');
    });

    test('a victory bump from A yields S', () => {
      expect(computePerformanceGrade(6400, 1, false).grade).toBe('A');
      expect(computePerformanceGrade(6400, 1, true).grade).toBe('S');
    });
  });

  describe('color mapping', () => {
    const expected: Record<string, string> = {
      S: '#ffd24a',
      A: '#66ff99',
      B: '#66ccff',
      C: '#bbbbdd',
      D: '#cc9966',
      F: '#ff6666',
    };
    test('each grade carries its palette color', () => {
      expect(computePerformanceGrade(10000, 1, false)).toEqual({ grade: 'S', color: expected.S });
      expect(computePerformanceGrade(6400, 1, false)).toEqual({ grade: 'A', color: expected.A });
      expect(computePerformanceGrade(4000, 1, false)).toEqual({ grade: 'B', color: expected.B });
      expect(computePerformanceGrade(2400, 1, false)).toEqual({ grade: 'C', color: expected.C });
      expect(computePerformanceGrade(1200, 1, false)).toEqual({ grade: 'D', color: expected.D });
      expect(computePerformanceGrade(0, 1, false)).toEqual({ grade: 'F', color: expected.F });
    });
  });

  describe('defensive numeric edges', () => {
    test('a negative score floors to F (and D on victory)', () => {
      expect(computePerformanceGrade(-5000, 1, false).grade).toBe('F');
      expect(computePerformanceGrade(-5000, 1, true).grade).toBe('D');
    });

    test('NaN never crashes and degrades to the worst grade', () => {
      // All `NaN >= n` comparisons are false, so the index falls through to F.
      expect(() => computePerformanceGrade(NaN, 1, false)).not.toThrow();
      expect(computePerformanceGrade(NaN, 1, false).grade).toBe('F');
    });

    test('an Infinite score saturates to S', () => {
      expect(computePerformanceGrade(Infinity, 1, false).grade).toBe('S');
    });
  });
});

// ── helpers ──

/** computeRunScore with all-zero defaults, overriding only the fields under test. */
function score(overrides: Partial<Parameters<typeof computeRunScore>[0]>): number {
  return computeRunScore({
    killCount: 0,
    survivalSeconds: 0,
    level: 0,
    damageDealt: 0,
    highestCombo: 0,
    wasVictory: false,
    ...overrides,
  });
}
