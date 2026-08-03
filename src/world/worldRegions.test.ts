/**
 * The two rules that fail silently. A boss-arena entry point spawns the Warden and seals the
 * room; a hidden-sector entry point hands over what a breakable wall conceals. Either
 * produces a run that looks fine and is the wrong one.
 */

import { describe, it, expect } from 'vitest';
import { generateExpeditionWorld } from '../expedition/expeditionWorld';
import { FIRST_EXPEDITION_WORLD_SEED } from '../expedition/ExpeditionSeasonStore';
import { bossArenaDropPoint, listWorldRegions } from './worldRegions';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from './worldSpace';

const SEEDS = [FIRST_EXPEDITION_WORLD_SEED, 1, 777, 20260801, 424242];

describe('listWorldRegions', () => {
  it('never enters a region through the boss arena or a hidden sector', () => {
    for (const seed of SEEDS) {
      const map = generateExpeditionWorld(seed);
      const regions = listWorldRegions(map);
      expect(regions.length).toBeGreaterThan(1);
      for (const region of regions) {
        const sector = map.sectors.get(region.entrySectorKey);
        expect(sector).toBeDefined();
        expect(sector?.biomeId).toBe(region.biomeId);
        expect(sector?.hidden).not.toBe(true);
        expect(sector?.isBossArena).toBe(false);
        expect(region.entrySectorKey).not.toBe(map.bossArenaKey);
      }
    }
  });

  it('starts at the hangar and goes deeper from there', () => {
    for (const seed of SEEDS) {
      const map = generateExpeditionWorld(seed);
      const regions = listWorldRegions(map);
      expect(regions[0].entrySectorKey).toBe(map.startKey);
      expect(regions[0].entryDepth).toBe(0);
      for (let index = 1; index < regions.length; index += 1) {
        expect(regions[index].entryDepth).toBeGreaterThanOrEqual(regions[index - 1].entryDepth);
      }
    }
  });

  it('is a pure function of the world', () => {
    const map = generateExpeditionWorld(FIRST_EXPEDITION_WORLD_SEED);
    expect(listWorldRegions(map)).toEqual(listWorldRegions(generateExpeditionWorld(
      FIRST_EXPEDITION_WORLD_SEED)));
  });
});

/** GameScene's WARDEN_THRONE_TRIGGER_RADIUS. The throne stands at the arena centre, so a drop
 *  inside this radius trips the boss before the player has taken a frame of control. */
const THRONE_TRIP_RADIUS = 150;

describe('bossArenaDropPoint', () => {
  it('drops inside the arena and clear of the throne trip radius', () => {
    for (const seed of SEEDS) {
      const map = generateExpeditionWorld(seed);
      const arena = map.sectors.get(map.bossArenaKey);
      expect(arena?.isBossArena).toBe(true);
      const drop = bossArenaDropPoint(map);
      expect(drop).not.toBeNull();
      if (drop === null || arena === undefined) continue;
      const originX = arena.sx * SECTOR_WIDTH;
      const originY = arena.sy * SECTOR_HEIGHT;
      expect(drop.x).toBeGreaterThan(originX);
      expect(drop.x).toBeLessThan(originX + SECTOR_WIDTH);
      expect(drop.y).toBeGreaterThan(originY);
      expect(drop.y).toBeLessThan(originY + SECTOR_HEIGHT);
      const offsetX = drop.x - (originX + SECTOR_WIDTH / 2);
      const offsetY = drop.y - (originY + SECTOR_HEIGHT / 2);
      expect(Math.hypot(offsetX, offsetY)).toBeGreaterThanOrEqual(THRONE_TRIP_RADIUS);
    }
  });

  it('is a pure function of the world', () => {
    expect(bossArenaDropPoint(generateExpeditionWorld(FIRST_EXPEDITION_WORLD_SEED)))
      .toEqual(bossArenaDropPoint(generateExpeditionWorld(FIRST_EXPEDITION_WORLD_SEED)));
  });
});
