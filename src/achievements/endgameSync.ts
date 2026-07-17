/**
 * endgameSync.ts — retro-credit + drift repair for the endgame achievements.
 *
 * The in-run hooks only push forward from the moment a record is beaten, so a
 * profile that had already cleared gauntlet wave 12 or killed The Bastion would
 * read as zero progress until it beat its own record. Each of these stats has a
 * persisted owner that predates the achievements (GauntletBestWave,
 * EndlessBestCycle, the codex's per-enemy timesKilled), so the true value can be
 * replayed in. Paragon kills have no such record and are deliberately absent.
 *
 * Call ONLY from a context with no unlock callback wired: unlocks then land
 * unclaimed and AchievementScene's retroactive claim pass delivers the gold
 * (see AchievementManager.unlockAchievement).
 */

import { getCodexManager } from '../codex';
import { loadGauntletBestWave } from '../game/gauntlet/GauntletBestWave';
import { loadEndlessBestCycle } from '../game/endless/EndlessBestCycle';
import { BOSS_KILL_TRACKING } from './AchievementDefinitions';
import { getAchievementManager } from './AchievementManager';

export function syncEndgameAchievements(): void {
  const achievementManager = getAchievementManager();
  const codexManager = getCodexManager();

  achievementManager.recordGauntletWaveReached(loadGauntletBestWave());
  achievementManager.recordEndlessCycleReached(loadEndlessBestCycle());

  for (const bossTypeId of Object.keys(BOSS_KILL_TRACKING)) {
    achievementManager.recordBossTypeKills(
      bossTypeId,
      codexManager.getEnemyEntry(bossTypeId)?.timesKilled ?? 0,
    );
  }
}
