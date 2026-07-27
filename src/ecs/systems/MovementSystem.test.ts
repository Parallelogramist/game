import { describe, test, expect } from 'vitest';
import { createWorld, addEntity } from 'bitecs';
import { Transform } from '../components';
import { clampPlayerToRect } from './MovementSystem';
import { rectFromScreen } from '../../world/worldSpace';

/**
 * FEAT-WORLD-SPACE-2 replaced a screen-literal clamp with a rect clamp on the live
 * arena game. The property worth pinning is not "the new formula is correct" but
 * "the new formula IS the old formula" over the screen rect: a one-pixel drift in
 * where the ship stops is invisible in a diff and unfalsifiable without a browser.
 */
const legacyClamp = (value: number, extent: number, padding: number): number =>
  Math.max(padding, Math.min(extent - padding, value));

describe('clampPlayerToRect', () => {
  const screenRect = rectFromScreen(1280, 720);
  const world = createWorld();
  const playerId = addEntity(world);

  test.each([
    [-500, -500],
    [0, 0],
    [15.5, 15.5],
    [16, 16],
    [640, 360],
    [1264, 704],
    [1265, 705],
    [1280, 720],
    [9999, 9999],
  ])('matches the legacy screen clamp at (%s, %s)', (x, y) => {
    Transform.x[playerId] = x;
    Transform.y[playerId] = y;

    clampPlayerToRect(world, playerId, screenRect);

    expect(Transform.x[playerId]).toBe(legacyClamp(x, 1280, 16));
    expect(Transform.y[playerId]).toBe(legacyClamp(y, 720, 16));
  });

  test('an offset rect shifts the clamp with it', () => {
    Transform.x[playerId] = 0;
    Transform.y[playerId] = 0;

    clampPlayerToRect(world, playerId, { minX: 1280, minY: 720, maxX: 2560, maxY: 1440 });

    expect(Transform.x[playerId]).toBe(1296);
    expect(Transform.y[playerId]).toBe(736);
  });
});
