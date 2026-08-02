import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../endless/EndlessBestCycle', () => ({ saveEndlessBestCycleIfHigher: vi.fn(() => true) }));
vi.mock('../../achievements', () => ({
  getAchievementManager: vi.fn(() => ({ recordEndlessCycleReached: vi.fn() })),
}));

import { EndlessMutatorType } from '../../data/EndlessMutators';
import { saveEndlessBestCycleIfHigher } from '../endless/EndlessBestCycle';
import { EndlessDirector, type EndlessDeps } from './EndlessDirector';

const makeDeps = (overrides: Partial<EndlessDeps> = {}) => ({
  spawnWaveEntry: vi.fn(),
  scheduleWaveEntry: vi.fn(),
  showWaveBanner: vi.fn(),
  hudReady: vi.fn(() => true),
  setTopCenterLabel: vi.fn(),
  escalateWorldMultipliers: vi.fn(),
  isPracticeMode: vi.fn(() => false),
  ...overrides,
});

describe('EndlessDirector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('the miniboss cadence re-arms, and cycle 2+ doubles up', () => {
    const deps = makeDeps();
    const director = new EndlessDirector(deps);
    director.activateForContinue();

    director.update(45);
    expect(deps.spawnWaveEntry).toHaveBeenCalledExactlyOnceWith('miniboss');
    expect(deps.scheduleWaveEntry).not.toHaveBeenCalled();

    // Cycle 2 tightens the cadence to 35s and pairs the miniboss with a second one.
    director.applyPracticeRung(2);
    director.update(35);
    expect(deps.spawnWaveEntry).toHaveBeenCalledTimes(2);
    expect(deps.scheduleWaveEntry).toHaveBeenCalledWith('miniboss', 3000);
  });

  test('a boss wave cycles up, banks the best and stages the wave', () => {
    const deps = makeDeps();
    const director = new EndlessDirector(deps);
    director.activateForContinue();

    director.update(300);

    expect(director.getCycle()).toBe(1);
    expect(director.isNewBestThisRun()).toBe(true);
    expect(deps.showWaveBanner).toHaveBeenCalledWith(expect.stringContaining('CYCLE 1'), '#ffaa44');
    expect(deps.escalateWorldMultipliers).toHaveBeenCalledWith(1.25, 1.15, 1.10);
    // Cycle 1: two staggered minibosses, one boss. The second boss is cycle 3+ only.
    expect(deps.scheduleWaveEntry).toHaveBeenCalledWith('miniboss', 0);
    expect(deps.scheduleWaveEntry).toHaveBeenCalledWith('miniboss', 1500);
    expect(deps.scheduleWaveEntry).toHaveBeenCalledWith('boss', 2500);
    expect(deps.scheduleWaveEntry).not.toHaveBeenCalledWith('boss', 7000);
    expect(director.serialize().bossIntervalSeconds).toBe(255);
  });

  test('practice never rolls the mutator and never writes the leaderboard', () => {
    const deps = makeDeps({ isPracticeMode: vi.fn(() => true) });
    const director = new EndlessDirector(deps);
    director.activateForContinue();
    director.setMutator(EndlessMutatorType.GOLD_RUSH);

    director.update(300);

    expect(director.getCycle()).toBe(1);
    expect(saveEndlessBestCycleIfHigher).not.toHaveBeenCalled();
    expect(director.isNewBestThisRun()).toBe(false);
    expect(director.getMutator()).toBe(EndlessMutatorType.GOLD_RUSH);
  });
});
