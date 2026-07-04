/**
 * runnerMath.ts — Pure tuning / pacing / scoring math for the endless-runner
 * mode (RunnerScene). No Phaser, no ECS, no storage imports: everything here
 * is a deterministic function of its arguments so it can be unit-tested in a
 * plain Node environment.
 *
 * Design source: docs/superpowers/specs/2026-05-29-scroll-runner-polish-design.md
 * (Area C). The runner is deliberately self-contained — these helpers are
 * runner-local on purpose and must not grow dependencies on GameScene systems.
 */

/** Central tuning knobs for the runner mode. */
export const RUNNER_TUNING = {
  /** Scroll speed (px/s) at distance 0. */
  BASE_SCROLL_SPEED: 200,
  /** Scroll speed ceiling (px/s). */
  MAX_SCROLL_SPEED: 460,
  /** Extra px/s of scroll speed per world unit (px) already scrolled. */
  SCROLL_RAMP_PER_UNIT: 0.03,

  /** Seconds between spawns at distance 0. */
  BASE_SPAWN_INTERVAL: 1.6,
  /** Spawn interval floor (seconds). */
  MIN_SPAWN_INTERVAL: 0.45,
  /** Seconds shaved off the spawn interval per world unit scrolled. */
  SPAWN_RAMP_PER_UNIT: 0.0001,

  /** Score points per world unit of distance (1 point per 10 px). */
  DISTANCE_SCORE_FACTOR: 0.1,
  /** Score points per kill. */
  KILL_SCORE: 25,

  /** World units per displayed "meter" of distance. */
  UNITS_PER_METER: 10,
} as const;

/**
 * Forced auto-scroll speed for a given cumulative scrolled distance
 * (world units / px). Linear ramp, hard-capped.
 */
export function scrollSpeedForDistance(distance: number): number {
  const d = Math.max(0, distance);
  return Math.min(
    RUNNER_TUNING.MAX_SCROLL_SPEED,
    RUNNER_TUNING.BASE_SCROLL_SPEED + d * RUNNER_TUNING.SCROLL_RAMP_PER_UNIT
  );
}

/**
 * Seconds until the next enemy spawn for a given cumulative distance.
 * Linear tightening, hard-floored.
 */
export function spawnIntervalForDistance(distance: number): number {
  const d = Math.max(0, distance);
  return Math.max(
    RUNNER_TUNING.MIN_SPAWN_INTERVAL,
    RUNNER_TUNING.BASE_SPAWN_INTERVAL - d * RUNNER_TUNING.SPAWN_RAMP_PER_UNIT
  );
}

/**
 * One entry of the runner spawn roster. `typeId` must be a key of the shared
 * ENEMY_TYPES table (visuals + base stats are read from there); everything
 * else is runner-local behavior tuning.
 */
export interface RunnerSpawnEntry {
  typeId: string;
  /** Distance (world units) at which this type starts appearing. */
  minDistance: number;
  /** Relative weight among unlocked types. */
  weight: number;
  /** Multiplier on the scroll speed for this enemy's flow speed. */
  speedFactor: number;
  /** Cross-axis sine wobble amplitude (px); 0 = flows straight. */
  wobbleAmplitude: number;
  /** Cross-axis sine wobble angular speed (rad/s). */
  wobbleSpeed: number;
}

/**
 * Runner spawn roster. Types unlock as distance grows so the first stretch
 * reads as a tutorial. Order is irrelevant (selection is weight-based).
 */
export const RUNNER_SPAWN_TABLE: readonly RunnerSpawnEntry[] = [
  { typeId: 'basic',  minDistance: 0,    weight: 45, speedFactor: 1.0,  wobbleAmplitude: 0,  wobbleSpeed: 0 },
  { typeId: 'swarm',  minDistance: 600,  weight: 25, speedFactor: 1.35, wobbleAmplitude: 24, wobbleSpeed: 5 },
  { typeId: 'zigzag', minDistance: 1500, weight: 20, speedFactor: 1.2,  wobbleAmplitude: 60, wobbleSpeed: 3.2 },
  { typeId: 'dasher', minDistance: 3200, weight: 12, speedFactor: 1.55, wobbleAmplitude: 0,  wobbleSpeed: 0 },
  { typeId: 'tank',   minDistance: 4800, weight: 10, speedFactor: 0.7,  wobbleAmplitude: 0,  wobbleSpeed: 0 },
];

/**
 * Weighted pick from the entries unlocked at `distance`. `roll` is a uniform
 * random in [0, 1) supplied by the caller (kept as a parameter so tests are
 * deterministic). Always returns an entry — at distance 0 at least 'basic'
 * is unlocked.
 */
export function pickSpawnEntry(distance: number, roll: number): RunnerSpawnEntry {
  const unlocked = RUNNER_SPAWN_TABLE.filter((entry) => distance >= entry.minDistance);
  const pool = unlocked.length > 0 ? unlocked : [RUNNER_SPAWN_TABLE[0]];

  const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  const clampedRoll = Math.min(Math.max(roll, 0), 0.999999);
  let threshold = clampedRoll * totalWeight;
  for (const entry of pool) {
    threshold -= entry.weight;
    if (threshold < 0) return entry;
  }
  return pool[pool.length - 1];
}

/** Final run score: distance points + kill points. */
export function computeScore(distance: number, kills: number): number {
  const d = Math.max(0, distance);
  const k = Math.max(0, Math.floor(kills));
  return Math.floor(d * RUNNER_TUNING.DISTANCE_SCORE_FACTOR) + k * RUNNER_TUNING.KILL_SCORE;
}

/** Displayed distance in whole meters. */
export function distanceToMeters(distance: number): number {
  return Math.floor(Math.max(0, distance) / RUNNER_TUNING.UNITS_PER_METER);
}

/**
 * Corruption-hardened parse of the persisted best-score payload
 * (`{ best: number }` as JSON). Any malformed, missing, negative, or
 * non-finite input yields 0 — a bad save must never crash the scene or
 * produce NaN in the HUD.
 */
export function parseBestScore(raw: string | null): number {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const best = (parsed as { best?: unknown }).best;
      if (typeof best === 'number' && Number.isFinite(best) && best >= 0) {
        return Math.floor(best);
      }
    }
  } catch {
    // Corrupted JSON — treat as no best score.
  }
  return 0;
}

/** Serialize a best score to the persisted `{ best: number }` payload. */
export function serializeBestScore(best: number): string {
  const safe = Number.isFinite(best) ? Math.max(0, Math.floor(best)) : 0;
  return JSON.stringify({ best: safe });
}
