import { TUNING } from '../../data/GameTuning';
import {
  advanceBossRotation,
  bossIdAtRotation,
  challengeBossRotationIndex,
  getBossRotationIndex,
} from '../../meta/BossRotationManager';

/**
 * Everything the boss fight needs from the scene. Only scene-owned capabilities live here
 * (the run clock, the throne body, the spawn and the hazard paint); the rotation math and
 * its persisted cursor are imported directly, the boundary GauntletDirector and
 * EndlessDirector already draw.
 */
export interface BossFightDeps {
  /** The run clock in seconds. */
  gameTime(): number;
  /** True while the world's boss still stands in its arena. */
  wardenThroneStanding(): boolean;
  /** A daily fields a date-seeded boss and never moves the persisted rotation. */
  isDailyMode(): boolean;
  /** Empty when the run carries no date. Both daily deps are needed, not one: a daily with
   *  no date string still reads the live rotation, yet still must not spend it. */
  dailyDateString(): string;
  /** A practice session must never spend the rotation. */
  isPracticeMode(): boolean;
  /** Tears down the warning text, vignette and countdown before the fight starts. */
  cleanupBossWarning(): void;
  /** Fields the boss entity with its entrance, health bar and sealed room. It calls back
   *  into setActiveBoss, which is why it stays a dep rather than moving in here. */
  spawnBoss(typeId: string): void;
  /** Paints one hazard beat for the live boss and returns the seconds until the next one. */
  spawnBossHazard(bossTypeId: string): number;
}

/** How long the scheduled boss holds off while a throne is standing. Past it the timer fires
 *  as it always has and the throne stands down, so a player who never walks in still meets
 *  the boss and loses nothing that ships today. */
const WARDEN_THRONE_PATIENCE_SECONDS = 300;

/** Seconds before the spawn each warning beat becomes due: stirs, trembles, incoming. */
const WARNING_LEAD_SECONDS: Record<1 | 2 | 3, number> = { 1: 120, 2: 60, 3: 5 };

/**
 * Drives the run's boss fight: the 10-minute timer and its warning ladder, the rotation
 * spend, the live fight's identity and its hazard cadence. Owns the progression; the scene
 * keeps every spawn, entrance, banner and hazard primitive it calls back into.
 */
export class BossFightDirector {
  private readonly spawnTime = TUNING.bosses.spawnTime;
  private spawned = false;
  private warningPhase = 0;
  /**
   * Rotation position the run's NEXT variety boss spawns from (endless waves, gauntlet).
   * Run-local and never written back: only a rotation-fed 10-minute boss moves the
   * persisted rotation. -1 = unseeded.
   */
  private rotationCursor = -1;
  private activeBossType: string | null = null;
  private hazardTimer = 0;

  constructor(private readonly deps: BossFightDeps) {}

  hasSpawned(): boolean {
    return this.spawned;
  }

  getWarningPhase(): number {
    return this.warningPhase;
  }

  getActiveBossType(): string | null {
    return this.activeBossType;
  }

  isBossActive(): boolean {
    return this.activeBossType !== null;
  }

  /** False when the run has no timed boss at all, which silences the warning ladder. */
  hasScheduledSpawn(): boolean {
    return this.spawnTime > 0;
  }

  secondsUntilSpawn(): number {
    return this.spawnTime - this.deps.gameTime();
  }

  resetForNewRun(): void {
    this.spawned = false;
    this.warningPhase = 0;
    this.rotationCursor = -1;
    this.activeBossType = null;
    this.hazardTimer = 0;
  }

  /** Both create paths run this (a restored run never reaches the fresh block), so the
   *  cursor is reseeded per run rather than per scene instance. */
  resetRotationCursor(): void {
    this.rotationCursor = -1;
  }

  restoreSpawnTracking(spawned: boolean, warningPhase: number): void {
    this.spawned = spawned;
    this.warningPhase = warningPhase;
  }

  setActiveBoss(typeId: string): void {
    this.activeBossType = typeId;
    this.hazardTimer = 0;
  }

  clearActiveBoss(): void {
    this.activeBossType = null;
    this.hazardTimer = 0;
  }

  /**
   * Rotation position this run's 10-minute boss sits at. A daily/weekly is
   * seeded from its challenge date, so the same challenge is the same fight
   * everywhere; every other run takes the next boss on the persisted rotation.
   */
  rotationIndex(): number {
    const dateString = this.deps.dailyDateString();
    if (this.deps.isDailyMode() && dateString) {
      return challengeBossRotationIndex(dateString);
    }
    return getBossRotationIndex();
  }

  /** The boss the warning ladder names before it arrives. */
  upcomingBossTypeId(): string {
    return bossIdAtRotation(this.rotationIndex());
  }

  /** Spawns this run's boss at 10 minutes and moves the rotation on. */
  checkTimedSpawn(): void {
    if (this.spawned || this.deps.gameTime() < this.spawnTime) return;
    // A standing throne holds the timer off: the boss is at home and going there is the
    // point. Past the patience window it stops waiting, and the throne stands down.
    if (this.deps.wardenThroneStanding()
      && this.deps.gameTime() < this.spawnTime + WARDEN_THRONE_PATIENCE_SECONDS) return;
    this.beginFight();
  }

  /** Fields this run's boss and moves the rotation on. Shared by the timer and by the warden
   *  throne, so a fight taken at the arena spends the rotation exactly as the timed one does. */
  beginFight(): void {
    this.spawned = true;

    this.deps.cleanupBossWarning();

    const rotationIndex = this.rotationIndex();
    // Later variety spawns this run continue past the boss just fielded.
    this.rotationCursor = rotationIndex + 1;
    // The rotation moves only when the player actually MEETS the boss, and only
    // for rotation-fed runs: a daily fields a date-seeded boss, and a practice
    // session must never spend the rotation.
    if (!this.deps.isDailyMode() && !this.deps.isPracticeMode()) {
      advanceBossRotation();
    }

    this.deps.spawnBoss(bossIdAtRotation(rotationIndex));
  }

  /**
   * A practice time-jump lands past the 10-minute boss. Marking it fielded is what stops
   * the schedule burying the target the dock is there to spawn on demand.
   */
  skipTimedSpawnIfDue(): void {
    if (this.deps.gameTime() < this.spawnTime) return;
    this.spawned = true;
    this.deps.cleanupBossWarning();
  }

  /**
   * True exactly once, on the tick a warning beat becomes due. Ascending calls within one
   * tick can each claim, which is how a long frame still plays every beat in order.
   */
  claimWarningPhase(phase: 1 | 2 | 3): boolean {
    if (this.warningPhase >= phase) return false;
    if (this.deps.gameTime() < this.spawnTime - WARNING_LEAD_SECONDS[phase]) return false;
    this.warningPhase = phase;
    return true;
  }

  /** Boss-specific hazards, on their own cadence, for as long as a fight is live. */
  updateHazardCadence(deltaSeconds: number): void {
    if (this.activeBossType === null) return;
    this.hazardTimer -= deltaSeconds;
    if (this.hazardTimer <= 0) {
      this.hazardTimer = this.deps.spawnBossHazard(this.activeBossType);
    }
  }

  /**
   * Variety boss for an endless wave or a gauntlet wave. Walks a run-local
   * cursor so a long run keeps rotating without spending the persisted
   * rotation, which belongs to the 10-minute boss.
   */
  nextVarietyBossTypeId(): string {
    if (this.rotationCursor < 0) {
      this.rotationCursor = getBossRotationIndex();
    }
    const bossTypeId = bossIdAtRotation(this.rotationCursor);
    this.rotationCursor += 1;
    return bossTypeId;
  }
}
