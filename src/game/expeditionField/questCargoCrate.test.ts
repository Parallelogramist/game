import { describe, expect, it } from 'vitest';
import { generateExpeditionWorld } from '../../expedition/expeditionWorld';
import { pickCargoCratePoint } from './questCargoCrate';
import { isSolidAtWorld, MoverKind } from '../../world/staticCollision';
import { PoiKind, TILE_SIZE } from '../../world/worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from '../../world/worldSpace';

describe('pickCargoCratePoint', () => {
  it('stands the crate on open floor at every quest board of the live world', () => {
    const map = generateExpeditionWorld(20260727);
    const point = { x: 0, y: 0 };
    let boards = 0;
    for (const sector of map.sectors.values()) {
      for (const slot of sector.poiSlots) {
        if (slot.kind !== PoiKind.QuestGiver) continue;
        boards++;
        const boardX = sector.sx * SECTOR_WIDTH + slot.tileX * TILE_SIZE + TILE_SIZE / 2;
        const boardY = sector.sy * SECTOR_HEIGHT + slot.tileY * TILE_SIZE + TILE_SIZE / 2;
        pickCargoCratePoint(map, boardX, boardY, point);
        expect(isSolidAtWorld(map, point.x, point.y, MoverKind.Player)).toBe(false);
      }
    }
    expect(boards).toBeGreaterThan(0);
  });
});
