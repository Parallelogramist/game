import { getAchievementManager } from '../../achievements';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import type { SerializedGauntletState } from '../../save/GameStateManager';
import { saveGauntletBestWaveIfHigher } from '../gauntlet/GauntletBestWave';
import {
  GAUNTLET_BREATHER_SECONDS,
  GAUNTLET_DAMAGE_MULT_PER_WAVE,
  GAUNTLET_HEALTH_MULT_PER_WAVE,
  GAUNTLET_INTRO_SECONDS,
  GAUNTLET_XP_MULT_PER_WAVE,
  GauntletSpawnPlanEntry,
  gauntletWaveGoldReward,
  gauntletWaveSpawnPlan,
} from '../gauntlet/gauntletWaves';

/**
 * Everything the wave loop needs from the scene. Only scene-owned capabilities live here
 * (Phaser, the ECS, the managers); the pure wave math and the persisted-best/achievement
 * singletons are imported directly, the boundary `runSettlement` already tests at.
 */
export interface GauntletDeps {
  /** True while any miniboss/boss-tier enemy is alive. An ECS frame-cache query, so it
   *  stays in the scene beside its twin `hasOtherAliveBoss`. */
  hasAliveThreat(): boolean;
  spawnWaveEntry(kind: 'miniboss' | 'boss'): void;
  showWaveBanner(message: string, color: string): void;
  /** The HUD is built after the restore applies gauntletState, so the label sync is lazy
   *  and must not mark itself done before the HUD exists. */
  hudReady(): boolean;
  setTopCenterLabel(label: string): void;
  escalateWorldMultipliers(healthMult: number, damageMult: number, xpMult: number): void;
  /** Null while no player entity exists. */
  playerPosition(): { x: number; y: number } | null;
  spawnHealthPickup(x: number, y: number, healAmount: number): void;
  playGoldSparkle(x: number, y: number, particleCount: number): void;
}

/**
 * Drives GAUNTLET mode: intro countdown -> staggered wave spawns -> kill-driven wave
 * clear -> breather -> next wave. Owns the wave progression and its run-save block; the
 * scene keeps `gauntletModeActive`, the mode flag every other system gates on.
 */
export class GauntletDirector {
  private wave = 0;
  private phase: 'intro' | 'combat' | 'breather' = 'intro';
  private phaseTimer = 0;
  /** Ticked from the gated update, so spawns freeze with pause. */
  private pendingSpawns: GauntletSpawnPlanEntry[] = [];
  private clearScanTimer = 0;
  private newBestThisRun = false;
  /** Last wave pushed to the HUD label (lazy sync survives restore ordering). */
  private hudWaveShown = -1;
  /** Restored into 'combat': an empty first scan re-queues the wave instead of clearing it. */
  private restoredMidCombat = false;

  constructor(private readonly deps: GauntletDeps) {}

  getWave(): number {
    return this.wave;
  }

  isNewBestThisRun(): boolean {
    return this.newBestThisRun;
  }

  resetForNewRun(gauntletModeActive: boolean): void {
    this.wave = 0;
    this.phase = 'intro';
    this.phaseTimer = GAUNTLET_INTRO_SECONDS;
    this.pendingSpawns = [];
    this.clearScanTimer = 0;
    this.newBestThisRun = false;
    this.hudWaveShown = -1;
    this.restoredMidCombat = false;
    // Starting a gauntlet run counts as reaching wave 1 — an intro-phase death
    // otherwise reports "WAVE 1" against a stored best of 0.
    if (gauntletModeActive && saveGauntletBestWaveIfHigher(1)) {
      this.newBestThisRun = true;
      getAchievementManager().recordGauntletWaveReached(1);
    }
  }

  /** The `active` flag stays the scene's: it comes from init data on a fresh run. */
  serialize(): Omit<SerializedGauntletState, 'active'> {
    return {
      wave: this.wave,
      phase: this.phase,
      phaseTimer: this.phaseTimer,
      newBestThisRun: this.newBestThisRun,
    };
  }

  /**
   * Assigned unconditionally (scene restarts reuse the instance, so stale fields from a
   * prior gauntlet run must not leak into a restored standard run). Pending staggered
   * spawns are NOT persisted — the alive-scan finishes the wave off whatever enemies were
   * restored, and if none survived the save window the wave re-queues in full rather than
   * granting a free clear.
   */
  restore(saved: SerializedGauntletState | undefined, gauntletModeActive: boolean): void {
    const sanitize = (value: unknown, fallback: number, min: number, max: number): number =>
      (typeof value === 'number' && Number.isFinite(value))
        ? Math.max(min, Math.min(max, value))
        : fallback;
    this.wave = Math.floor(sanitize(saved?.wave, 0, 0, 100_000));
    this.phase = (saved?.phase === 'combat' || saved?.phase === 'breather')
      ? saved.phase
      : 'intro';
    // Combat/breather with wave 0 only occurs in a tampered save — wave 1 is
    // the smallest state those phases can legitimately hold.
    if (this.phase !== 'intro' && this.wave < 1) {
      this.wave = 1;
    }
    this.phaseTimer = sanitize(
      saved?.phaseTimer,
      GAUNTLET_INTRO_SECONDS,
      0,
      Math.max(GAUNTLET_INTRO_SECONDS, GAUNTLET_BREATHER_SECONDS),
    );
    this.pendingSpawns = [];
    this.clearScanTimer = 1;
    this.newBestThisRun = saved?.newBestThisRun === true;
    this.hudWaveShown = -1;
    this.restoredMidCombat = gauntletModeActive && this.phase === 'combat';
  }

  /** Runs from the scene's gated update tick, so spawn staggers and clear scans freeze
   *  with pause/game-over (a delayedCall would keep firing into menus). */
  update(deltaSeconds: number): void {
    this.syncHudLabel();

    if (this.phase === 'intro' || this.phase === 'breather') {
      this.phaseTimer -= deltaSeconds;
      if (this.phaseTimer <= 0) {
        this.startWave(this.wave + 1);
      }
      return;
    }

    // Combat: release staggered spawns first. The clear scan never runs on a
    // release frame — freshly created enemies enter the frame cache one frame
    // later, so scanning now would read an empty arena and end the wave early.
    if (this.pendingSpawns.length > 0) {
      const stillPendingSpawns: GauntletSpawnPlanEntry[] = [];
      for (const pendingSpawn of this.pendingSpawns) {
        pendingSpawn.delaySeconds -= deltaSeconds;
        if (pendingSpawn.delaySeconds <= 0) {
          this.deps.spawnWaveEntry(pendingSpawn.kind);
        } else {
          stillPendingSpawns.push(pendingSpawn);
        }
      }
      this.pendingSpawns = stillPendingSpawns;
      this.clearScanTimer = 0.5;
      return;
    }

    this.clearScanTimer -= deltaSeconds;
    if (this.clearScanTimer > 0) return;
    this.clearScanTimer = 0.5;
    if (this.deps.hasAliveThreat()) {
      this.restoredMidCombat = false;
      return;
    }
    // A restore into 'combat' with nothing alive means the save caught the
    // pre-spawn stagger window (pending spawns aren't persisted) — re-queue
    // the wave instead of handing out a free clear.
    if (this.restoredMidCombat) {
      this.restoredMidCombat = false;
      this.pendingSpawns = gauntletWaveSpawnPlan(this.wave).map(entry => ({ ...entry }));
      return;
    }
    this.completeWave();
  }

  private startWave(waveNumber: number): void {
    this.wave = waveNumber;
    this.phase = 'combat';
    this.pendingSpawns = gauntletWaveSpawnPlan(waveNumber).map(entry => ({ ...entry }));
    this.clearScanTimer = 1;

    // Escalate from wave 2 on — the same knobs the endless cycles ramp.
    if (waveNumber >= 2) {
      this.deps.escalateWorldMultipliers(
        GAUNTLET_HEALTH_MULT_PER_WAVE,
        GAUNTLET_DAMAGE_MULT_PER_WAVE,
        GAUNTLET_XP_MULT_PER_WAVE,
      );
    }

    if (saveGauntletBestWaveIfHigher(waveNumber)) {
      this.newBestThisRun = true;
      getAchievementManager().recordGauntletWaveReached(waveNumber);
    }

    this.syncHudLabel();
    this.deps.showWaveBanner(`WAVE ${waveNumber}`, waveNumber >= 9 ? '#ff3366' : '#ffaa44');
  }

  private completeWave(): void {
    const clearedWave = this.wave;
    const goldReward = gauntletWaveGoldReward(clearedWave);
    getMetaProgressionManager().addGold(goldReward);

    // Breather heal: a pair of health pickups beside the player.
    const playerPosition = this.deps.playerPosition();
    if (playerPosition) {
      this.deps.spawnHealthPickup(playerPosition.x - 40, playerPosition.y - 20, 20);
      this.deps.spawnHealthPickup(playerPosition.x + 40, playerPosition.y - 20, 20);
      this.deps.playGoldSparkle(playerPosition.x, playerPosition.y, 10);
    }

    this.deps.showWaveBanner(`WAVE ${clearedWave} CLEARED\n+${goldReward} GOLD`, '#66ff99');

    this.phase = 'breather';
    this.phaseTimer = GAUNTLET_BREATHER_SECONDS;
  }

  /** Pushes the current wave into the HUD's top-center slot ("WORLD N" in standard runs). */
  private syncHudLabel(): void {
    if (this.hudWaveShown === this.wave || !this.deps.hudReady()) return;
    this.hudWaveShown = this.wave;
    this.deps.setTopCenterLabel(
      this.wave === 0 ? 'GAUNTLET' : `GAUNTLET · WAVE ${this.wave}`,
    );
  }
}
