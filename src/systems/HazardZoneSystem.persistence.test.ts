import { describe, test, expect, beforeEach, vi } from 'vitest';

// HazardZoneSystem only needs Phaser for types + scene.add.graphics(); stub the
// module so the system can run in the Node test env without a canvas.
vi.mock('phaser', () => ({ default: {} }));

import {
  setHazardZoneScene,
  spawnHazardZone,
  getHazardState,
  restoreHazardState,
  resetHazardZoneSystem,
  getActiveHazardZoneCount,
} from './HazardZoneSystem';
import { TUNING } from '../data/GameTuning';

/** Minimal stand-in for the pooled Phaser Graphics objects the system creates. */
function makeFakeGraphics() {
  return {
    visible: false,
    setDepth() { return this; },
    setVisible(value: boolean) { this.visible = value; return this; },
    clear() { return this; },
    destroy() {},
  };
}

function makeFakeScene() {
  return {
    add: { graphics: () => makeFakeGraphics() },
  } as unknown as Phaser.Scene;
}

describe('HazardZoneSystem persistence', () => {
  beforeEach(() => {
    resetHazardZoneSystem();
    setHazardZoneScene(makeFakeScene());
  });

  test('getHazardState captures each active zone and the spawner pacing', () => {
    spawnHazardZone(300, 200, 70, 'burn', 6);
    spawnHazardZone(640, 360, 90, 'void', 8);

    const state = getHazardState();

    expect(state.zones).toEqual([
      { type: 'burn', x: 300, y: 200, radius: 70, duration: 6, maxDuration: 6 },
      { type: 'void', x: 640, y: 360, radius: 90, duration: 8, maxDuration: 8 },
    ]);
    expect(state.spawnTimer).toBe(0);
    expect(state.nextSpawnInterval).toBe(0);
  });

  test('restoreHazardState round-trips zones exactly, including partial lifetimes', () => {
    const saved = {
      zones: [
        // duration < maxDuration: a zone saved mid-life must keep its original
        // maxDuration so the fade-out visuals stay correct after restore.
        { type: 'burn', x: 100, y: 150, radius: 75, duration: 2.5, maxDuration: 6 },
        { type: 'energy', x: 800, y: 400, radius: 55, duration: 10, maxDuration: 10 },
      ],
      spawnTimer: 4.25,
      nextSpawnInterval: 9.5,
    };

    restoreHazardState(saved);

    expect(getActiveHazardZoneCount()).toBe(2);
    expect(getHazardState()).toEqual(saved);
  });

  test('restoreHazardState skips zones with unknown types', () => {
    restoreHazardState({
      zones: [
        { type: 'lava', x: 100, y: 100, radius: 50, duration: 5, maxDuration: 5 },
        { type: 'ice', x: 200, y: 200, radius: 65, duration: 7, maxDuration: 7 },
      ],
      spawnTimer: 0,
      nextSpawnInterval: 0,
    });

    expect(getActiveHazardZoneCount()).toBe(1);
    expect(getHazardState().zones[0].type).toBe('ice');
  });

  test('restoreHazardState skips zones with non-finite numbers', () => {
    restoreHazardState({
      zones: [
        { type: 'burn', x: Number.NaN, y: 100, radius: 70, duration: 6, maxDuration: 6 },
        { type: 'burn', x: 100, y: 100, radius: Infinity, duration: 6, maxDuration: 6 },
        { type: 'void', x: 300, y: 300, radius: 90, duration: 8, maxDuration: 8 },
      ],
      spawnTimer: 1,
      nextSpawnInterval: 5,
    });

    expect(getActiveHazardZoneCount()).toBe(1);
    expect(getHazardState().zones[0].type).toBe('void');
  });

  test('restoreHazardState ignores non-finite spawner timers (keeps reset defaults)', () => {
    restoreHazardState({
      zones: [],
      spawnTimer: Number.NaN,
      nextSpawnInterval: Infinity,
    });

    const state = getHazardState();
    expect(state.spawnTimer).toBe(0);
    expect(state.nextSpawnInterval).toBe(0);
  });

  test('restoreHazardState caps restored zones at the graphics pool size', () => {
    const poolSize = TUNING.hazards.graphicsPoolSize;
    const zones = Array.from({ length: poolSize + 3 }, (_, i) => ({
      type: 'burn',
      x: 100 + i,
      y: 100,
      radius: 70,
      duration: 6,
      maxDuration: 6,
    }));

    restoreHazardState({ zones, spawnTimer: 0, nextSpawnInterval: 0 });

    expect(getActiveHazardZoneCount()).toBe(poolSize);
  });

  test('restoreHazardState tolerates a tampered save (non-array zones, null entries)', () => {
    expect(() =>
      restoreHazardState({ zones: 'junk', spawnTimer: 1, nextSpawnInterval: 5 } as never),
    ).not.toThrow();
    expect(getActiveHazardZoneCount()).toBe(0);

    expect(() =>
      restoreHazardState({
        zones: [
          null,
          { type: 42, x: 1, y: 1, radius: 1, duration: 1, maxDuration: 1 },
          { type: 'burn', x: 100, y: 100, radius: 70, duration: 6, maxDuration: 6 },
        ] as never,
        spawnTimer: 0,
        nextSpawnInterval: 0,
      }),
    ).not.toThrow();
    expect(getActiveHazardZoneCount()).toBe(1);
  });

  test('restoreHazardState without a scene is a safe no-op', () => {
    resetHazardZoneSystem(); // nulls the scene ref + destroys the pool

    expect(() =>
      restoreHazardState({
        zones: [{ type: 'burn', x: 100, y: 100, radius: 70, duration: 6, maxDuration: 6 }],
        spawnTimer: 3,
        nextSpawnInterval: 7,
      }),
    ).not.toThrow();
    expect(getActiveHazardZoneCount()).toBe(0);
  });
});
