import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../meta/BossRotationManager', () => ({
  advanceBossRotation: vi.fn(),
  bossIdAtRotation: vi.fn((rotationIndex: number) => `boss_${rotationIndex}`),
  challengeBossRotationIndex: vi.fn(() => 7),
  getBossRotationIndex: vi.fn(() => 3),
}));

import { advanceBossRotation } from '../../meta/BossRotationManager';
import { BossFightDirector, type BossFightDeps } from './BossFightDirector';

/** TUNING.bosses.spawnTime. The director reads the real value, so the tests use it too. */
const BOSS_SPAWN_TIME = 600;

const makeDeps = (overrides: Partial<BossFightDeps> = {}) => ({
  gameTime: vi.fn(() => BOSS_SPAWN_TIME),
  wardenThroneStanding: vi.fn(() => false),
  isDailyMode: vi.fn(() => false),
  dailyDateString: vi.fn(() => ''),
  isPracticeMode: vi.fn(() => false),
  cleanupBossWarning: vi.fn(),
  spawnBoss: vi.fn(),
  spawnBossHazard: vi.fn(() => 5),
  ...overrides,
});

describe('BossFightDirector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('a standard run fields the live rotation slot and spends it', () => {
    const deps = makeDeps();
    const director = new BossFightDirector(deps);

    director.checkTimedSpawn();

    expect(deps.spawnBoss).toHaveBeenCalledExactlyOnceWith('boss_3');
    expect(advanceBossRotation).toHaveBeenCalledTimes(1);
    expect(director.hasSpawned()).toBe(true);
  });

  test('a daily fields its date-seeded boss and never spends the rotation', () => {
    const deps = makeDeps({
      isDailyMode: vi.fn(() => true),
      dailyDateString: vi.fn(() => '2026-08-02'),
    });

    new BossFightDirector(deps).checkTimedSpawn();

    expect(deps.spawnBoss).toHaveBeenCalledExactlyOnceWith('boss_7');
    expect(advanceBossRotation).not.toHaveBeenCalled();
  });

  test('a daily with no date reads the live rotation but still does not spend it', () => {
    const deps = makeDeps({ isDailyMode: vi.fn(() => true) });

    new BossFightDirector(deps).checkTimedSpawn();

    expect(deps.spawnBoss).toHaveBeenCalledExactlyOnceWith('boss_3');
    expect(advanceBossRotation).not.toHaveBeenCalled();
  });

  test('practice never spends the rotation', () => {
    const deps = makeDeps({ isPracticeMode: vi.fn(() => true) });

    new BossFightDirector(deps).checkTimedSpawn();

    expect(deps.spawnBoss).toHaveBeenCalledExactlyOnceWith('boss_3');
    expect(advanceBossRotation).not.toHaveBeenCalled();
  });

  test('a standing throne holds the timer off until its patience runs out', () => {
    let clock = BOSS_SPAWN_TIME;
    const deps = makeDeps({
      gameTime: vi.fn(() => clock),
      wardenThroneStanding: vi.fn(() => true),
    });
    const director = new BossFightDirector(deps);

    director.checkTimedSpawn();
    expect(deps.spawnBoss).not.toHaveBeenCalled();

    clock = BOSS_SPAWN_TIME + 299;
    director.checkTimedSpawn();
    expect(deps.spawnBoss).not.toHaveBeenCalled();

    clock = BOSS_SPAWN_TIME + 300;
    director.checkTimedSpawn();
    expect(deps.spawnBoss).toHaveBeenCalledExactlyOnceWith('boss_3');
  });

  test('the variety cursor walks past the fielded boss without spending the rotation', () => {
    const deps = makeDeps();
    const director = new BossFightDirector(deps);

    // Unseeded: the first variety boss picks up at the live rotation slot.
    expect(director.nextVarietyBossTypeId()).toBe('boss_3');
    expect(director.nextVarietyBossTypeId()).toBe('boss_4');
    expect(advanceBossRotation).not.toHaveBeenCalled();

    // A fielded 10-minute boss reseats the cursor one past itself.
    director.resetRotationCursor();
    director.beginFight();
    expect(director.nextVarietyBossTypeId()).toBe('boss_4');
  });

  test('the hazard cadence re-arms from the delay the scene reports', () => {
    const deps = makeDeps({ spawnBossHazard: vi.fn(() => 6) });
    const director = new BossFightDirector(deps);

    director.updateHazardCadence(1);
    expect(deps.spawnBossHazard).not.toHaveBeenCalled();

    director.setActiveBoss('the_helix');
    director.updateHazardCadence(0.1);
    expect(deps.spawnBossHazard).toHaveBeenCalledExactlyOnceWith('the_helix');

    // Re-armed to 6s: a 5s tick must not fire a second beat, a 6s one must.
    director.updateHazardCadence(5);
    expect(deps.spawnBossHazard).toHaveBeenCalledTimes(1);
    director.updateHazardCadence(1);
    expect(deps.spawnBossHazard).toHaveBeenCalledTimes(2);
  });
});
