import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../meta/BestScoreManager', () => ({
  recordScore: vi.fn(() => ({ score: 4200, best: 4200, isNewBest: true })),
}));
vi.mock('../../meta/PaceGhostManager', () => ({ savePaceGhost: vi.fn(() => true) }));
vi.mock('../../meta/ShipRecords', () => ({ recordShipRun: vi.fn() }));
vi.mock('../../meta/DailyChallengeManager', () => ({ recordDailyRun: vi.fn() }));
vi.mock('../../meta/RunHistoryManager', () => ({
  recordRun: vi.fn(),
  getRecentRuns: vi.fn(() => []),
}));
vi.mock('../gauntlet/GauntletLeaderboard', () => ({ recordGauntletRun: vi.fn() }));
vi.mock('../endless/EndlessLeaderboard', () => ({ recordEndlessRun: vi.fn() }));

import { recordScore } from '../../meta/BestScoreManager';
import { savePaceGhost } from '../../meta/PaceGhostManager';
import { recordShipRun } from '../../meta/ShipRecords';
import { recordDailyRun } from '../../meta/DailyChallengeManager';
import { recordRun } from '../../meta/RunHistoryManager';
import { recordGauntletRun } from '../gauntlet/GauntletLeaderboard';
import { recordEndlessRun } from '../endless/EndlessLeaderboard';
import { recordRunOutcome, type RunEndModes, type RunFacts } from './runSettlement';

const FACTS: RunFacts = {
  wasVictory: false,
  killCount: 300,
  levelReached: 12,
  survivalTimeSeconds: 480,
  damageDealt: 50000,
  damageTaken: 900,
  highestCombo: 40,
  goldEarned: 250,
  worldLevel: 3,
  weaponIdsUsed: ['projectile'],
  winStreak: 0,
};

const MODES: RunEndModes = {
  practice: false,
  gauntlet: false,
  gauntletWave: 0,
  endless: false,
  endlessCycle: 0,
  daily: null,
  paceSamples: [1, 2, 3],
  shipId: 'ship_default',
  build: { startingWeapon: 'projectile', shipId: 'ship_default', mode: 'normal' },
};

const modes = (overrides: Partial<RunEndModes> = {}): RunEndModes => ({ ...MODES, ...overrides });

describe('recordRunOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('a practice run posts to no record at all', () => {
    const outcome = recordRunOutcome(FACTS, modes({
      practice: true,
      gauntlet: true,
      gauntletWave: 7,
      endless: true,
      endlessCycle: 4,
      daily: { challengeType: 'daily', dateString: '2026-08-02' },
    }));

    expect(outcome).toEqual({ paceGhostReplaced: false });
    for (const recorder of [recordScore, recordRun, recordShipRun, recordDailyRun,
      recordGauntletRun, recordEndlessRun, savePaceGhost]) {
      expect(recorder).not.toHaveBeenCalled();
    }
  });

  test('a normal run posts a score, a ship record and a history entry', () => {
    const outcome = recordRunOutcome(FACTS, modes());

    expect(recordScore).toHaveBeenCalledWith(3, expect.any(Number));
    expect(recordShipRun).toHaveBeenCalledWith('ship_default', false, 4200);
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordRun).mock.calls[0][0]).toMatchObject({
      kills: 300,
      level: 12,
      durationSeconds: 480,
      worldLevel: 3,
      victory: false,
      score: 4200,
      startingWeapon: 'projectile',
      mode: 'normal',
    });
    expect(outcome.score).toEqual({ score: 4200, best: 4200, isNewBest: true });
    expect(outcome.grade?.grade).toBeDefined();
    expect(recordGauntletRun).not.toHaveBeenCalled();
    expect(recordEndlessRun).not.toHaveBeenCalled();
  });

  test('a gauntlet run posts a wave and nothing from the standard tables', () => {
    recordRunOutcome(FACTS, modes({ gauntlet: true, gauntletWave: 0 }));

    expect(vi.mocked(recordGauntletRun).mock.calls[0][0]).toMatchObject({
      wave: 1,
      kills: 300,
      worldLevel: 3,
    });
    expect(recordScore).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
    expect(recordDailyRun).not.toHaveBeenCalled();
  });

  test('a daily run posts one leaderboard entry, and a non-daily run posts none', () => {
    recordRunOutcome(FACTS, modes({ daily: { challengeType: 'weekly', dateString: '2026-08-02' } }));

    expect(recordDailyRun).toHaveBeenCalledWith('weekly', '2026-08-02', expect.objectContaining({
      survivalSeconds: 480,
      killCount: 300,
      wasVictory: false,
    }));

    vi.clearAllMocks();
    recordRunOutcome(FACTS, modes());
    expect(recordDailyRun).not.toHaveBeenCalled();
  });

  test('endless posts a cycle only from cycle 1, and posts alongside the gauntlet branch', () => {
    recordRunOutcome(FACTS, modes({ endless: true, endlessCycle: 0 }));
    expect(recordEndlessRun).not.toHaveBeenCalled();

    recordRunOutcome(FACTS, modes({ endless: true, endlessCycle: 2, gauntlet: true, gauntletWave: 3 }));
    expect(vi.mocked(recordEndlessRun).mock.calls[0][0]).toMatchObject({ cycle: 2, kills: 300 });
    expect(recordGauntletRun).toHaveBeenCalledTimes(1);
  });

  test('the pace ghost is saved only on a new best, and only while recording', () => {
    recordRunOutcome(FACTS, modes({ paceSamples: null }));
    expect(savePaceGhost).not.toHaveBeenCalled();

    const outcome = recordRunOutcome(FACTS, modes());
    expect(savePaceGhost).toHaveBeenCalledWith(3, [1, 2, 3]);
    expect(outcome.paceGhostReplaced).toBe(true);

    vi.clearAllMocks();
    vi.mocked(recordScore).mockReturnValueOnce({ score: 10, best: 9999, isNewBest: false });
    const stale = recordRunOutcome(FACTS, modes());
    expect(savePaceGhost).not.toHaveBeenCalled();
    expect(stale.paceGhostReplaced).toBe(false);
  });

  test('scoreWorldLevel sends the score-side records to the level actually played', () => {
    recordRunOutcome({ ...FACTS, wasVictory: true }, modes({ scoreWorldLevel: 2 }));

    expect(recordScore).toHaveBeenCalledWith(2, expect.any(Number));
    expect(savePaceGhost).toHaveBeenCalledWith(2, [1, 2, 3]);
    expect(vi.mocked(recordRun).mock.calls[0][0]).toMatchObject({ worldLevel: 2, victory: true });
  });

  test('scoreWorldLevel leaves the gauntlet and endless boards on the run world level', () => {
    recordRunOutcome(FACTS, modes({
      scoreWorldLevel: 2,
      gauntlet: true,
      gauntletWave: 3,
      endless: true,
      endlessCycle: 1,
    }));

    expect(vi.mocked(recordGauntletRun).mock.calls[0][0]).toMatchObject({ worldLevel: 3 });
    expect(vi.mocked(recordEndlessRun).mock.calls[0][0]).toMatchObject({ worldLevel: 3 });
  });
});
