import { describe, test, expect } from 'vitest';
import { SECTOR_RETIRE_KEEP_RADIUS, planSectorRetire } from './sectorRetire';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from './worldSpace';

// Sector "1,0" spans x 1280..2559, y 0..719. The ship has crossed east into "2,0".
const DEPARTED = '1,0';
const SHIP_X = SECTOR_WIDTH * 2 + 200;
const SHIP_Y = SECTOR_HEIGHT / 2;

function plan(candidates: { entityId: number; x: number; y: number }[], fromSectorKey: string | null = DEPARTED) {
  return planSectorRetire({ fromSectorKey, playerX: SHIP_X, playerY: SHIP_Y, candidates });
}

describe('planSectorRetire', () => {
  test('retires loot left deep in the departed room', () => {
    expect(plan([{ entityId: 7, x: SECTOR_WIDTH + 100, y: 100 }])).toEqual([7]);
  });

  test('keeps loot still within reach of the ship across the seam', () => {
    const justInside = { entityId: 8, x: SECTOR_WIDTH * 2 - 10, y: SHIP_Y };
    expect(SHIP_X - justInside.x).toBeLessThan(SECTOR_RETIRE_KEEP_RADIUS);
    expect(plan([justInside])).toEqual([]);
  });

  test('never touches loot outside the departed room', () => {
    expect(plan([{ entityId: 9, x: SECTOR_WIDTH * 2 + 600, y: 600 }])).toEqual([]);
  });

  test('retires nothing without a departed sector, and nothing on a malformed key', () => {
    const far = [{ entityId: 10, x: SECTOR_WIDTH + 100, y: 100 }];
    expect(plan(far, null)).toEqual([]);
    expect(plan(far, 'not-a-key')).toEqual([]);
  });
});
