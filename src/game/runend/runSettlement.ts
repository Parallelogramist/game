import { getAchievementManager, type RunEndData } from '../../achievements';
import { getCodexManager } from '../../codex';
import type { DailyQuestRunData } from '../../data/DailyQuests';
import { recordScore } from '../../meta/BestScoreManager';
import { recordDailyRun } from '../../meta/DailyChallengeManager';
import type { UnlockEvaluationContext } from '../../meta/HiddenUnlocks';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { savePaceGhost } from '../../meta/PaceGhostManager';
import { getRecentRuns, recordRun, type RunSummary } from '../../meta/RunHistoryManager';
import { recordShipRun } from '../../meta/ShipRecords';
import { computePerformanceGrade, computeRunScore, type GradeResult } from '../../utils/PerformanceGrade';
import { recordEndlessRun } from '../endless/EndlessLeaderboard';
import { recordGauntletRun } from '../gauntlet/GauntletLeaderboard';

/**
 * The run's measured numbers at run end. Every run-end consumer wants a different subset of
 * these eleven, which is why they are snapshotted once and reshaped by the builders below
 * rather than re-read from the scene at each call site.
 */
export interface RunFacts {
  wasVictory: boolean;
  killCount: number;
  levelReached: number;
  survivalTimeSeconds: number;
  damageDealt: number;
  damageTaken: number;
  highestCombo: number;
  goldEarned: number;
  worldLevel: number;
  weaponIdsUsed: string[];
  winStreak: number;
}

export type RunBuildIdentity = Pick<
  RunSummary,
  'startingWeapon' | 'shipId' | 'stageId' | 'threatLevel' | 'pactIds' | 'mode'
>;

export interface RunEndModes {
  practice: boolean;
  gauntlet: boolean;
  gauntletWave: number;
  endless: boolean;
  endlessCycle: number;
  daily: { challengeType: 'daily' | 'weekly'; dateString: string } | null;
  /** Null when this run is not recording a pace ghost. */
  paceSamples: readonly number[] | null;
  shipId: string;
  build: RunBuildIdentity;
}

export interface RunOutcome {
  score?: { score: number; best: number; isNewBest: boolean };
  grade?: GradeResult;
  /** The runs that preceded this one, read before it was recorded. */
  priorRuns?: RunSummary[];
  paceGhostReplaced: boolean;
}

export function buildRunEndData(facts: RunFacts): RunEndData {
  const metaManager = getMetaProgressionManager();
  return {
    wasVictory: facts.wasVictory,
    killCount: facts.killCount,
    levelReached: facts.levelReached,
    survivalTimeSeconds: facts.survivalTimeSeconds,
    worldLevel: facts.worldLevel,
    damageDealt: facts.damageDealt,
    damageTaken: facts.damageTaken,
    goldEarned: facts.goldEarned,
    accountLevel: metaManager.getAccountLevel(),
    bestStreak: metaManager.getBestStreak(),
    highestCombo: facts.highestCombo,
  };
}

export function buildQuestRunData(facts: RunFacts): DailyQuestRunData {
  return {
    wasVictory: facts.wasVictory,
    killCount: facts.killCount,
    levelReached: facts.levelReached,
    survivalTimeSeconds: facts.survivalTimeSeconds,
    damageDealt: facts.damageDealt,
    damageTaken: facts.damageTaken,
    goldEarned: facts.goldEarned,
    highestCombo: facts.highestCombo,
  };
}

export function buildUnlockContext(facts: RunFacts): UnlockEvaluationContext {
  return {
    run: {
      wasVictory: facts.wasVictory,
      killCount: facts.killCount,
      levelReached: facts.levelReached,
      survivalTimeSeconds: facts.survivalTimeSeconds,
      highestCombo: facts.highestCombo,
      damageTaken: facts.damageTaken,
      damageDealt: facts.damageDealt,
      weaponIdsUsed: facts.weaponIdsUsed,
      worldLevel: facts.worldLevel,
      noDamageTaken: facts.damageTaken === 0,
      winStreak: facts.winStreak,
    },
    lifetime: getAchievementManager().getLifetimeStats(),
  };
}

/** The codex takes seven positional stats; keeping the order in one place is the point. */
export function recordCodexRunEnd(facts: RunFacts): void {
  getCodexManager().recordRunEnd(
    facts.survivalTimeSeconds,
    facts.killCount,
    facts.damageDealt,
    facts.goldEarned,
    facts.wasVictory,
    facts.worldLevel,
    facts.levelReached
  );
}

/**
 * Posts the run to every record it belongs in. A practice run posts to none: SecureStorage
 * drops the writes anyway, and the practice menu promises no records.
 */
export function recordRunOutcome(facts: RunFacts, modes: RunEndModes): RunOutcome {
  const outcome: RunOutcome = { paceGhostReplaced: false };
  if (modes.practice) return outcome;

  if (modes.gauntlet) {
    recordGauntletRun({
      timestamp: Date.now(),
      wave: Math.max(1, modes.gauntletWave),
      kills: facts.killCount,
      durationSeconds: facts.survivalTimeSeconds,
      levelReached: facts.levelReached,
      worldLevel: facts.worldLevel,
    });
  } else {
    const runScore = computeRunScore({
      killCount: facts.killCount,
      survivalSeconds: facts.survivalTimeSeconds,
      level: facts.levelReached,
      damageDealt: facts.damageDealt,
      highestCombo: facts.highestCombo,
      wasVictory: facts.wasVictory,
    });
    const scoreResult = recordScore(facts.worldLevel, runScore);
    outcome.score = scoreResult;
    if (modes.paceSamples && scoreResult.isNewBest) {
      outcome.paceGhostReplaced = savePaceGhost(facts.worldLevel, modes.paceSamples);
    }
    recordShipRun(modes.shipId, facts.wasVictory, scoreResult.score);
    outcome.grade = computePerformanceGrade(runScore, facts.worldLevel, facts.wasVictory);

    if (modes.daily) {
      recordDailyRun(modes.daily.challengeType, modes.daily.dateString, {
        survivalSeconds: facts.survivalTimeSeconds,
        killCount: facts.killCount,
        levelReached: facts.levelReached,
        wasVictory: facts.wasVictory,
        score: runScore,
      });
    }

    // Read the prior runs before recording this one, so the "RECENT" strip shows the runs
    // leading up to it.
    outcome.priorRuns = getRecentRuns(3);
    recordRun({
      timestamp: Date.now(),
      durationSeconds: facts.survivalTimeSeconds,
      kills: facts.killCount,
      level: facts.levelReached,
      score: scoreResult.score,
      grade: outcome.grade.grade,
      victory: facts.wasVictory,
      worldLevel: facts.worldLevel,
      ...modes.build,
    });
  }

  if (modes.endless && modes.endlessCycle >= 1) {
    recordEndlessRun({
      timestamp: Date.now(),
      cycle: modes.endlessCycle,
      kills: facts.killCount,
      durationSeconds: facts.survivalTimeSeconds,
      levelReached: facts.levelReached,
      worldLevel: facts.worldLevel,
    });
  }

  return outcome;
}
