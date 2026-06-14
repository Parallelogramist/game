import { describe, test, expect } from 'vitest';

import {
  projectToRadar,
  classifyEnemyKind,
  blipStyle,
  MINIMAP_WORLD_RANGE,
  MINIMAP_MINIBOSS_XP,
  MINIMAP_BOSS_XP,
  type MinimapBlipKind,
} from './minimapProjection';

const RADIUS = 50;

describe('projectToRadar', () => {
  test('an entity on top of the player maps to the radar center', () => {
    const projected = projectToRadar(0, 0, RADIUS, MINIMAP_WORLD_RANGE);
    expect(projected).toEqual({ x: 0, y: 0, atRim: false });
  });

  test('scales linearly inside the world range', () => {
    // Halfway out along +x maps to half the radar radius.
    const projected = projectToRadar(MINIMAP_WORLD_RANGE / 2, 0, RADIUS, MINIMAP_WORLD_RANGE);
    expect(projected.x).toBeCloseTo(RADIUS / 2, 6);
    expect(projected.y).toBeCloseTo(0, 6);
    expect(projected.atRim).toBe(false);
  });

  test('exactly at the world range lands on the rim without clamping', () => {
    const projected = projectToRadar(MINIMAP_WORLD_RANGE, 0, RADIUS, MINIMAP_WORLD_RANGE);
    expect(projected.x).toBeCloseTo(RADIUS, 6);
    expect(projected.atRim).toBe(false);
  });

  test('beyond the world range clamps to the rim, preserving direction', () => {
    const projected = projectToRadar(MINIMAP_WORLD_RANGE * 3, 0, RADIUS, MINIMAP_WORLD_RANGE);
    expect(projected.x).toBeCloseTo(RADIUS, 6);
    expect(projected.y).toBeCloseTo(0, 6);
    expect(projected.atRim).toBe(true);
  });

  test('a clamped diagonal blip sits exactly on the rim circle', () => {
    const projected = projectToRadar(5000, 5000, RADIUS, MINIMAP_WORLD_RANGE);
    expect(Math.hypot(projected.x, projected.y)).toBeCloseTo(RADIUS, 4);
    expect(projected.x).toBeCloseTo(RADIUS / Math.SQRT2, 4);
    expect(projected.y).toBeCloseTo(RADIUS / Math.SQRT2, 4);
    expect(projected.atRim).toBe(true);
  });

  test('preserves negative directions (left / up)', () => {
    const projected = projectToRadar(-MINIMAP_WORLD_RANGE / 2, -MINIMAP_WORLD_RANGE / 4, RADIUS, MINIMAP_WORLD_RANGE);
    expect(projected.x).toBeCloseTo(-RADIUS / 2, 6);
    expect(projected.y).toBeCloseTo(-RADIUS / 4, 6);
  });

  test('non-finite deltas fall back to the center (never NaN on the radar)', () => {
    expect(projectToRadar(NaN, 0, RADIUS, MINIMAP_WORLD_RANGE)).toEqual({ x: 0, y: 0, atRim: false });
    expect(projectToRadar(0, Infinity, RADIUS, MINIMAP_WORLD_RANGE)).toEqual({ x: 0, y: 0, atRim: false });
  });

  test('a non-positive radar radius or world range is inert', () => {
    expect(projectToRadar(100, 100, 0, MINIMAP_WORLD_RANGE)).toEqual({ x: 0, y: 0, atRim: false });
    expect(projectToRadar(100, 100, RADIUS, 0)).toEqual({ x: 0, y: 0, atRim: false });
  });

  test('defaults the world range when omitted', () => {
    const explicit = projectToRadar(300, 0, RADIUS, MINIMAP_WORLD_RANGE);
    const defaulted = projectToRadar(300, 0, RADIUS);
    expect(defaulted).toEqual(explicit);
  });
});

describe('classifyEnemyKind', () => {
  test('bosses are detected by the boss XP threshold', () => {
    expect(classifyEnemyKind(MINIMAP_BOSS_XP, false)).toBe('boss');
    expect(classifyEnemyKind(MINIMAP_BOSS_XP + 500, true)).toBe('boss');
  });

  test('minibosses sit between the miniboss and boss thresholds', () => {
    expect(classifyEnemyKind(MINIMAP_MINIBOSS_XP, false)).toBe('miniboss');
    expect(classifyEnemyKind(MINIMAP_BOSS_XP - 1, false)).toBe('miniboss');
  });

  test('tier always wins over the elite flag for high-XP enemies', () => {
    // An elite-affixed miniboss-tier enemy still classifies by tier.
    expect(classifyEnemyKind(MINIMAP_MINIBOSS_XP, true)).toBe('miniboss');
  });

  test('low-XP enemies are elite only when affixed, else plain', () => {
    expect(classifyEnemyKind(MINIMAP_MINIBOSS_XP - 1, true)).toBe('elite');
    expect(classifyEnemyKind(MINIMAP_MINIBOSS_XP - 1, false)).toBe('enemy');
    expect(classifyEnemyKind(1, false)).toBe('enemy');
  });
});

describe('blipStyle', () => {
  const kinds: MinimapBlipKind[] = ['enemy', 'pickup', 'elite', 'miniboss', 'boss'];

  test('every kind resolves to a finite, drawable style', () => {
    for (const kind of kinds) {
      const style = blipStyle(kind);
      expect(Number.isInteger(style.color)).toBe(true);
      expect(style.color).toBeGreaterThanOrEqual(0);
      expect(style.radius).toBeGreaterThan(0);
      expect(Number.isFinite(style.priority)).toBe(true);
    }
  });

  test('threat tier raises both the blip size and the draw priority', () => {
    expect(blipStyle('boss').radius).toBeGreaterThan(blipStyle('enemy').radius);
    expect(blipStyle('boss').priority).toBeGreaterThan(blipStyle('miniboss').priority);
    expect(blipStyle('miniboss').priority).toBeGreaterThan(blipStyle('enemy').priority);
  });

  test('an unknown kind degrades to the plain-enemy style', () => {
    expect(blipStyle('mystery' as MinimapBlipKind)).toEqual(blipStyle('enemy'));
  });
});
