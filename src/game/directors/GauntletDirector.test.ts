import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../gauntlet/GauntletBestWave', () => ({ saveGauntletBestWaveIfHigher: vi.fn(() => false) }));
vi.mock('../../achievements', () => ({
  getAchievementManager: vi.fn(() => ({ recordGauntletWaveReached: vi.fn() })),
}));
vi.mock('../../meta/MetaProgressionManager', () => ({
  getMetaProgressionManager: vi.fn(() => ({ addGold: vi.fn() })),
}));

import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { GauntletDirector, type GauntletDeps } from './GauntletDirector';

const makeDeps = (overrides: Partial<GauntletDeps> = {}) => ({
  hasAliveThreat: vi.fn(() => false),
  spawnWaveEntry: vi.fn(),
  showWaveBanner: vi.fn(),
  hudReady: vi.fn(() => true),
  setTopCenterLabel: vi.fn(),
  escalateWorldMultipliers: vi.fn(),
  playerPosition: vi.fn(() => ({ x: 100, y: 200 })),
  spawnHealthPickup: vi.fn(),
  playGoldSparkle: vi.fn(),
  ...overrides,
});

describe('GauntletDirector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('the intro countdown starts wave 1 and queues its spawns', () => {
    const deps = makeDeps();
    const director = new GauntletDirector(deps);
    director.resetForNewRun(true);

    director.update(4);
    expect(director.getWave()).toBe(0);

    director.update(5);
    expect(director.getWave()).toBe(1);
    expect(deps.showWaveBanner).toHaveBeenCalledWith('WAVE 1', '#ffaa44');
    expect(deps.setTopCenterLabel).toHaveBeenLastCalledWith('GAUNTLET · WAVE 1');
    // Wave 1 is the first wave, so the per-wave stat ramp has not started.
    expect(deps.escalateWorldMultipliers).not.toHaveBeenCalled();
  });

  test('a spawn-release frame never clears the wave', () => {
    const deps = makeDeps();
    const director = new GauntletDirector(deps);
    director.resetForNewRun(true);
    director.update(9);

    director.update(1);
    expect(deps.spawnWaveEntry).toHaveBeenCalledWith('miniboss');
    // Freshly spawned enemies reach the frame cache a frame late, so a clear scan on the
    // release frame would end the wave against an empty arena.
    expect(deps.showWaveBanner).not.toHaveBeenCalledWith(expect.stringContaining('CLEARED'), expect.anything());
  });

  test('a restore into combat re-queues the wave instead of granting a free clear', () => {
    const deps = makeDeps();
    const director = new GauntletDirector(deps);
    director.restore({ active: true, wave: 4, phase: 'combat', phaseTimer: 0 }, true);

    director.update(1.5);
    expect(deps.spawnWaveEntry).not.toHaveBeenCalled();
    expect(deps.showWaveBanner).not.toHaveBeenCalled();

    director.update(1.5);
    expect(deps.spawnWaveEntry).toHaveBeenCalled();
    expect(director.getWave()).toBe(4);
  });

  test('an empty arena clears the wave, pays gold and enters the breather', () => {
    const addGold = vi.fn();
    vi.mocked(getMetaProgressionManager).mockReturnValue({ addGold } as never);
    const deps = makeDeps();
    const director = new GauntletDirector(deps);
    director.resetForNewRun(true);
    director.update(9);
    // Frame 1 releases the wave's one miniboss, frame 2 scans an empty arena and clears.
    // Do not add frames: the 5s breather would roll into wave 2.
    director.update(1);
    director.update(1);

    expect(addGold).toHaveBeenCalledWith(40);
    expect(deps.showWaveBanner).toHaveBeenCalledWith('WAVE 1 CLEARED\n+40 GOLD', '#66ff99');
    expect(deps.spawnHealthPickup).toHaveBeenCalledTimes(2);
    expect(director.serialize()).toMatchObject({ wave: 1, phase: 'breather' });
  });
});
