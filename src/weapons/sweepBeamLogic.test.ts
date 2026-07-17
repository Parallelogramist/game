import { describe, it, expect } from 'vitest';
import { isEnemyInBeam } from './sweepBeamLogic';

describe('isEnemyInBeam', () => {
  const O = { x: 0, y: 0, cos: 1, sin: 0, length: 100, halfWidth: 20 };
  const hit = (x: number, y: number) =>
    isEnemyInBeam(x, y, O.x, O.y, O.cos, O.sin, O.length, O.halfWidth);

  it('hits a point straight down the beam within length', () => expect(hit(50, 0)).toBe(true));
  it('hits at the origin (along = 0)', () => expect(hit(0, 0)).toBe(true));
  it('hits at the far tip (along = length)', () => expect(hit(100, 0)).toBe(true));
  it('misses beyond the beam length', () => expect(hit(140, 0)).toBe(false));
  it('misses behind the origin (negative projection)', () => expect(hit(-10, 0)).toBe(false));
  it('hits within the half-width laterally', () => expect(hit(50, 19)).toBe(true));
  it('misses outside the half-width', () => expect(hit(50, 30)).toBe(false));
  it('respects a rotated axis (points up +Y)', () => {
    // cos=0, sin=1 → beam points +Y; a point at (0,50) is on-axis.
    expect(isEnemyInBeam(0, 50, 0, 0, 0, 1, 100, 20)).toBe(true);
    expect(isEnemyInBeam(50, 0, 0, 0, 0, 1, 100, 20)).toBe(false);
  });
});
