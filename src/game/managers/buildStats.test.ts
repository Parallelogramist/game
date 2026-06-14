import { describe, test, expect } from 'vitest';
import {
  perMinuteRate,
  perSecondRate,
  safeRatio,
  orderWeaponsByDamage,
  deriveBuildStats,
} from './buildStats';
import { WeaponRunStats } from '../../weapons/WeaponManager';

// buildStats holds the pure stat-derivation that backs the mid-run build
// dashboard on the pause overlay (FEAT-PAUSE-RUN-STATS). The panel itself is
// Phaser-coupled and untestable headlessly, so every derivation that decides a
// displayed number — DPS, crit %, kills/min, damage share, top-N ordering —
// lives here behind these tests. Guarding the divide-by-zero / empty-run paths
// matters because the pause menu can open one frame into a run (gameTime ~ 0,
// no hits yet) and must never render NaN/Infinity.

function makeWeapon(partial: Partial<WeaponRunStats> & { weaponId: string }): WeaponRunStats {
  return {
    weaponName: partial.weaponId,
    totalDamage: 0,
    kills: 0,
    hits: 0,
    crits: 0,
    maxSingleHit: 0,
    ...partial,
  };
}

describe('perMinuteRate', () => {
  test('120 kills across 60s is 120/min', () => {
    expect(perMinuteRate(120, 60)).toBe(120);
  });

  test('60 kills across 120s is 30/min', () => {
    expect(perMinuteRate(60, 120)).toBe(30);
  });

  test('zero elapsed time yields 0, never Infinity', () => {
    expect(perMinuteRate(50, 0)).toBe(0);
  });

  test('negative elapsed time is treated as no time elapsed', () => {
    expect(perMinuteRate(50, -10)).toBe(0);
  });

  test('zero count over real time is 0', () => {
    expect(perMinuteRate(0, 90)).toBe(0);
  });
});

describe('perSecondRate', () => {
  test('1000 damage across 10s is 100 dps', () => {
    expect(perSecondRate(1000, 10)).toBe(100);
  });

  test('zero elapsed time yields 0, never Infinity', () => {
    expect(perSecondRate(1000, 0)).toBe(0);
  });

  test('negative elapsed time yields 0', () => {
    expect(perSecondRate(1000, -5)).toBe(0);
  });
});

describe('safeRatio', () => {
  test('5 / 10 is 0.5', () => {
    expect(safeRatio(5, 10)).toBe(0.5);
  });

  test('zero denominator yields 0, never NaN', () => {
    expect(safeRatio(5, 0)).toBe(0);
  });

  test('negative denominator yields 0', () => {
    expect(safeRatio(5, -2)).toBe(0);
  });

  test('zero numerator over positive denominator is 0', () => {
    expect(safeRatio(0, 7)).toBe(0);
  });
});

describe('orderWeaponsByDamage', () => {
  test('sorts by total damage descending', () => {
    const ordered = orderWeaponsByDamage([
      makeWeapon({ weaponId: 'a', totalDamage: 100 }),
      makeWeapon({ weaponId: 'b', totalDamage: 300 }),
      makeWeapon({ weaponId: 'c', totalDamage: 200 }),
    ]);
    expect(ordered.map((w) => w.weaponId)).toEqual(['b', 'c', 'a']);
  });

  test('drops weapons that have dealt no damage', () => {
    const ordered = orderWeaponsByDamage([
      makeWeapon({ weaponId: 'a', totalDamage: 100 }),
      makeWeapon({ weaponId: 'idle', totalDamage: 0 }),
    ]);
    expect(ordered.map((w) => w.weaponId)).toEqual(['a']);
  });

  test('breaks ties by weapon name ascending for deterministic order', () => {
    const ordered = orderWeaponsByDamage([
      makeWeapon({ weaponId: 'zeta', weaponName: 'Zeta', totalDamage: 50 }),
      makeWeapon({ weaponId: 'alpha', weaponName: 'Alpha', totalDamage: 50 }),
    ]);
    expect(ordered.map((w) => w.weaponId)).toEqual(['alpha', 'zeta']);
  });

  test('truncates to top-N', () => {
    const ordered = orderWeaponsByDamage(
      [
        makeWeapon({ weaponId: 'a', totalDamage: 500 }),
        makeWeapon({ weaponId: 'b', totalDamage: 400 }),
        makeWeapon({ weaponId: 'c', totalDamage: 300 }),
        makeWeapon({ weaponId: 'd', totalDamage: 200 }),
      ],
      2,
    );
    expect(ordered.map((w) => w.weaponId)).toEqual(['a', 'b']);
  });

  test('does not mutate the input array', () => {
    const input = [
      makeWeapon({ weaponId: 'a', totalDamage: 100 }),
      makeWeapon({ weaponId: 'b', totalDamage: 300 }),
    ];
    orderWeaponsByDamage(input);
    expect(input.map((w) => w.weaponId)).toEqual(['a', 'b']);
  });

  test('empty input yields empty output', () => {
    expect(orderWeaponsByDamage([])).toEqual([]);
  });
});

describe('deriveBuildStats', () => {
  const weaponStats: WeaponRunStats[] = [
    makeWeapon({ weaponId: 'katana', weaponName: 'Katana', totalDamage: 6000, kills: 40, hits: 200, crits: 50 }),
    makeWeapon({ weaponId: 'drone', weaponName: 'Drone', totalDamage: 4000, kills: 20, hits: 100, crits: 10 }),
    makeWeapon({ weaponId: 'idle', weaponName: 'Idle', totalDamage: 0, kills: 0, hits: 0, crits: 0 }),
  ];

  test('sums total damage across all weapons (including dormant ones contribute 0)', () => {
    const summary = deriveBuildStats({
      weaponStats,
      gameTimeSeconds: 100,
      killCount: 70,
      totalDamageTaken: 250,
    });
    expect(summary.totalDamage).toBe(10000);
  });

  test('headline dps is total damage over elapsed seconds', () => {
    const summary = deriveBuildStats({
      weaponStats,
      gameTimeSeconds: 100,
      killCount: 70,
      totalDamageTaken: 250,
    });
    expect(summary.dps).toBe(100); // 10000 / 100
  });

  test('overall crit rate is total crits over total hits', () => {
    const summary = deriveBuildStats({
      weaponStats,
      gameTimeSeconds: 100,
      killCount: 70,
      totalDamageTaken: 250,
    });
    expect(summary.critRate).toBeCloseTo(60 / 300, 6); // (50+10) / (200+100)
  });

  test('kills per minute uses the run kill count, not the per-weapon sum', () => {
    const summary = deriveBuildStats({
      weaponStats,
      gameTimeSeconds: 120,
      killCount: 90, // environmental/other kills exceed weapon-attributed 60
      totalDamageTaken: 250,
    });
    expect(summary.killsPerMinute).toBe(45); // 90 / (120/60)
    expect(summary.totalKills).toBe(90);
  });

  test('passes damage taken through untouched', () => {
    const summary = deriveBuildStats({
      weaponStats,
      gameTimeSeconds: 100,
      killCount: 70,
      totalDamageTaken: 250,
    });
    expect(summary.totalDamageTaken).toBe(250);
  });

  test('top weapons are damage-ordered with per-weapon share, dps and crit rate', () => {
    const summary = deriveBuildStats({
      weaponStats,
      gameTimeSeconds: 100,
      killCount: 70,
      totalDamageTaken: 250,
    });
    expect(summary.topWeapons.map((w) => w.weaponId)).toEqual(['katana', 'drone']);
    const katana = summary.topWeapons[0];
    expect(katana.damageShare).toBeCloseTo(0.6, 6); // 6000 / 10000
    expect(katana.dps).toBe(60); // 6000 / 100
    expect(katana.critRate).toBeCloseTo(0.25, 6); // 50 / 200
    expect(katana.kills).toBe(40);
  });

  test('damage shares of the top weapons sum to 1 when all weapons are shown', () => {
    const summary = deriveBuildStats({
      weaponStats,
      gameTimeSeconds: 100,
      killCount: 70,
      totalDamageTaken: 250,
    });
    const shareSum = summary.topWeapons.reduce((sum, w) => sum + w.damageShare, 0);
    expect(shareSum).toBeCloseTo(1, 6);
  });

  test('respects an explicit top-N cap', () => {
    const summary = deriveBuildStats(
      {
        weaponStats,
        gameTimeSeconds: 100,
        killCount: 70,
        totalDamageTaken: 250,
      },
      1,
    );
    expect(summary.topWeapons.map((w) => w.weaponId)).toEqual(['katana']);
  });

  test('an empty run (no weapons, no time) is all-zero and never NaN/Infinity', () => {
    const summary = deriveBuildStats({
      weaponStats: [],
      gameTimeSeconds: 0,
      killCount: 0,
      totalDamageTaken: 0,
    });
    expect(summary.totalDamage).toBe(0);
    expect(summary.dps).toBe(0);
    expect(summary.critRate).toBe(0);
    expect(summary.killsPerMinute).toBe(0);
    expect(summary.topWeapons).toEqual([]);
    for (const value of [summary.dps, summary.critRate, summary.killsPerMinute]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test('one frame into a run (time ~ 0) the headline rates stay finite', () => {
    const summary = deriveBuildStats({
      weaponStats: [makeWeapon({ weaponId: 'katana', totalDamage: 12, hits: 1, crits: 0, kills: 0 })],
      gameTimeSeconds: 0,
      killCount: 0,
      totalDamageTaken: 0,
    });
    expect(summary.dps).toBe(0);
    expect(summary.killsPerMinute).toBe(0);
    expect(summary.topWeapons[0].dps).toBe(0);
    expect(summary.totalDamage).toBe(12);
  });
});
