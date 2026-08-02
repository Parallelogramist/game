import { getAchievementManager } from '../../achievements';
import {
  ENDLESS_MUTATOR_META,
  EndlessMutatorType,
  rollEndlessMutator,
  sanitizeEndlessMutator,
} from '../../data/EndlessMutators';
import { endlessCycleRampFactor } from '../../data/PracticeArena';
import type { SerializedEndlessState } from '../../save/GameStateManager';
import { saveEndlessBestCycleIfHigher } from '../endless/EndlessBestCycle';

/**
 * Everything the endless loop needs from the scene. Only scene-owned capabilities live here
 * (Phaser timers, the ECS spawners, the managers); the pure mutator/ramp math and the
 * persisted-best/achievement singletons are imported directly, the boundary GauntletDirector
 * already draws.
 */
export interface EndlessDeps {
  /** Spawns on this frame. */
  spawnWaveEntry(kind: 'miniboss' | 'boss'): void;
  /** Staggered spawn through the scene's Phaser timer, which — unlike the gauntlet's ticked
   *  stagger — keeps running through pause. Preserved as-is: changing it is a feel change. */
  scheduleWaveEntry(kind: 'miniboss' | 'boss', delayMs: number): void;
  showWaveBanner(message: string, color: string): void;
  /** The HUD is built after the restore applies endlessState, so the label sync is lazy and
   *  must not mark itself done before the HUD exists. */
  hudReady(): boolean;
  setTopCenterLabel(label: string): void;
  escalateWorldMultipliers(healthMult: number, damageMult: number, xpMult: number): void;
  /** Practice fields the mutator the operator picked and never writes the leaderboard. */
  isPracticeMode(): boolean;
}

const FRESH_BOSS_INTERVAL_SECONDS = 300;

/**
 * Drives post-victory ENDLESS mode: miniboss cadence -> boss wave -> cycle escalation.
 * Owns the progression, its mutator and its run-save block; the scene keeps every spawn,
 * banner and HUD primitive it calls back into.
 */
export class EndlessDirector {
  private active = false;
  /** Time elapsed since continue was chosen. Persisted only; nothing reads it back. */
  private modeTime = 0;
  private minibossTimer = 0;
  private bossTimer = 0;
  private cycleNumber = 0;
  private bossIntervalSeconds = FRESH_BOSS_INTERVAL_SECONDS;
  private mutator: EndlessMutatorType = EndlessMutatorType.NONE;
  /** Last cycle pushed to the HUD label (lazy sync survives restore ordering). */
  private hudCycleShown = -1;
  /** Drives the end screen's "NEW BEST!" callout. */
  private newBestThisRun = false;

  constructor(private readonly deps: EndlessDeps) {}

  isActive(): boolean {
    return this.active;
  }

  getCycle(): number {
    return this.cycleNumber;
  }

  getMutator(): EndlessMutatorType {
    return this.mutator;
  }

  isNewBestThisRun(): boolean {
    return this.newBestThisRun;
  }

  resetForNewRun(): void {
    this.active = false;
    this.modeTime = 0;
    this.minibossTimer = 0;
    this.bossTimer = 0;
    this.cycleNumber = 0;
    this.bossIntervalSeconds = FRESH_BOSS_INTERVAL_SECONDS;
    this.mutator = EndlessMutatorType.NONE;
    this.hudCycleShown = -1;
    this.newBestThisRun = false;
  }

  serialize(): SerializedEndlessState {
    return {
      active: this.active,
      time: this.modeTime,
      minibossTimer: this.minibossTimer,
      bossTimer: this.bossTimer,
      cycleNumber: this.cycleNumber,
      bossIntervalSeconds: this.bossIntervalSeconds,
      mutator: this.mutator,
      newBestThisRun: this.newBestThisRun,
    };
  }

  /**
   * Absent on legacy + normal mid-run saves — those keep the fresh defaults (endless stays
   * inactive), which is why this returns early instead of assigning. Values are sanitized
   * (corruption/tamper): a non-finite entry falls back to its fresh default instead of
   * poisoning the run loop with NaN timers.
   */
  restore(saved: SerializedEndlessState | undefined): void {
    if (!saved || typeof saved !== 'object') return;
    const sanitize = (value: unknown, fallback: number, min: number, max: number): number =>
      (typeof value === 'number' && Number.isFinite(value))
        ? Math.max(min, Math.min(max, value))
        : fallback;
    this.active = saved.active === true;
    this.modeTime = sanitize(saved.time, 0, 0, 1e9);
    this.cycleNumber = sanitize(saved.cycleNumber, 0, 0, 10_000);
    this.bossIntervalSeconds = sanitize(saved.bossIntervalSeconds, 300, 120, 300);
    this.minibossTimer = sanitize(saved.minibossTimer, 45, 0, 600);
    this.bossTimer = sanitize(saved.bossTimer, this.bossIntervalSeconds, 0, 600);
    this.mutator = this.active
      ? sanitizeEndlessMutator(saved.mutator)
      : EndlessMutatorType.NONE;
    this.newBestThisRun = saved.newBestThisRun === true;
    this.hudCycleShown = -1;
  }

  /** The post-victory "continue": the run keeps whatever boss interval it already holds. */
  activateForContinue(): void {
    this.active = true;
    this.modeTime = 0;
    this.minibossTimer = 45;   // First miniboss in 45 seconds (faster than old 60)
    this.bossTimer = this.bossIntervalSeconds; // First post-victory boss in 5 min
    this.cycleNumber = 0;
    this.mutator = EndlessMutatorType.NONE;
    this.newBestThisRun = false;
  }

  /**
   * Practice arena: field the cycle a real run would have at this depth. Monotonic — a
   * compounded escalation cannot be taken back, so a rung at or below the current cycle
   * is a no-op.
   */
  applyPracticeRung(targetCycle: number): void {
    if (targetCycle <= this.cycleNumber) return;
    const ramp = endlessCycleRampFactor(this.cycleNumber, targetCycle);
    this.deps.escalateWorldMultipliers(ramp.health, ramp.damage, ramp.xp);
    this.active = true;
    this.modeTime = 0;
    this.cycleNumber = targetCycle;
    this.bossIntervalSeconds = Math.max(120, 300 - targetCycle * 45);
    this.bossTimer = this.bossIntervalSeconds;
    this.minibossTimer = Math.max(20, 45 - targetCycle * 5);
    this.hudCycleShown = -1;
    this.showCycleBanner(targetCycle);
  }

  setMutator(mutator: EndlessMutatorType): void {
    this.mutator = mutator;
    this.hudCycleShown = -1;
  }

  /** Runs from the scene's gated update tick, and only while `isActive()`. */
  update(deltaSeconds: number): void {
    this.syncHudLabel();
    this.modeTime += deltaSeconds;
    this.minibossTimer -= deltaSeconds;
    this.bossTimer -= deltaSeconds;

    // Miniboss cadence: starts at 45s, tightens by 5s per cycle (floor 20s).
    const minibossIntervalSeconds = Math.max(20, 45 - this.cycleNumber * 5);
    if (this.minibossTimer <= 0) {
      this.minibossTimer = minibossIntervalSeconds;
      this.deps.spawnWaveEntry('miniboss');
      // Cycle 2+: spawn a second miniboss after a short delay for density.
      if (this.cycleNumber >= 2) {
        this.deps.scheduleWaveEntry('miniboss', 3000);
      }
    }

    // Boss waves: interval shortens each cycle (5min → 4min → 3min → 2min floor).
    if (this.bossTimer <= 0) {
      const practiceRun = this.deps.isPracticeMode();
      this.cycleNumber += 1;
      if (!practiceRun && saveEndlessBestCycleIfHigher(this.cycleNumber)) {
        this.newBestThisRun = true;
        getAchievementManager().recordEndlessCycleReached(this.cycleNumber);
      }
      // Practice fields the mutator the operator picked; every other mode rolls.
      if (!practiceRun) {
        this.mutator = rollEndlessMutator(this.mutator);
      }
      // Each cycle tightens the next interval by 45s (minimum 120s = 2 min).
      this.bossIntervalSeconds = Math.max(120, 300 - this.cycleNumber * 45);
      this.bossTimer = this.bossIntervalSeconds;

      // Ramp world-level-style multipliers per cycle so each wave hits harder.
      this.deps.escalateWorldMultipliers(1.25, 1.15, 1.10);

      this.showCycleBanner(this.cycleNumber);

      // Boss wave composition escalates:
      //   cycle 1: +1 miniboss + boss
      //   cycle 2: +2 minibosses + boss
      //   cycle 3+: +3 minibosses + TWO bosses back-to-back
      const minibossCountPerWave = Math.min(3, 1 + this.cycleNumber);
      for (let spawnIndex = 0; spawnIndex < minibossCountPerWave; spawnIndex++) {
        this.deps.scheduleWaveEntry('miniboss', spawnIndex * 1500);
      }

      this.deps.scheduleWaveEntry('boss', 2500);
      if (this.cycleNumber >= 3) {
        this.deps.scheduleWaveEntry('boss', 7000);
      }
    }
  }

  /**
   * Large "CYCLE N — escalated" landmark when a new endless wave starts, naming the cycle's
   * rolled mutator. Gives the player a clear landmark for their post-victory progression.
   */
  private showCycleBanner(cycleNumber: number): void {
    const mutatorMeta = ENDLESS_MUTATOR_META[this.mutator];
    const bannerMessage = this.mutator === EndlessMutatorType.NONE
      ? `CYCLE ${cycleNumber}\nESCALATION`
      : `CYCLE ${cycleNumber} · ${mutatorMeta.name}\n${mutatorMeta.description}`;
    this.deps.showWaveBanner(bannerMessage, cycleNumber >= 3 ? '#ff3366' : '#ffaa44');
  }

  /** Pushes the cycle + mutator into the HUD's top-center slot ("WORLD N" in standard runs). */
  private syncHudLabel(): void {
    if (this.cycleNumber < 1 || this.hudCycleShown === this.cycleNumber || !this.deps.hudReady()) return;
    this.hudCycleShown = this.cycleNumber;
    const mutatorMeta = ENDLESS_MUTATOR_META[this.mutator];
    this.deps.setTopCenterLabel(
      this.mutator === EndlessMutatorType.NONE
        ? `CYCLE ${this.cycleNumber}`
        : `CYCLE ${this.cycleNumber} · ${mutatorMeta.name}`,
    );
  }
}
