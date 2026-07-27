import { SecureStorage } from '../storage';

/**
 * PaceGhostManager — persists the kill-count pace curve of the best-scoring run
 * per world level, so a live run can be raced against it mid-run ("+37 PACE").
 *
 * Read-through (no in-memory cache — the store is the single source of truth)
 * and sanitize-on-read, mirroring BestScoreManager: a corrupt, tampered or
 * partially-written payload degrades to "no ghost" instead of putting garbage
 * on the HUD for a whole run.
 */

const STORAGE_KEY = 'survivor-pace-ghost';

/** Seconds between curve samples. Sample `i` is the kill count at `(i + 1) * this`. */
export const PACE_SAMPLE_INTERVAL_SECONDS = 15;

/** 20 minutes of curve. A run that outlives its ghost simply stops showing a delta. */
export const MAX_PACE_SAMPLES = 80;

type PaceGhostMap = Record<string, number[]>; // worldLevel -> kill count at each sample

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A stored curve is trusted only if every entry is a finite, non-negative
 * number; one bad entry drops the whole curve rather than leaving a hole that
 * would silently distort the interpolation.
 */
function sanitizeCurve(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const clean: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) return null;
    clean.push(Math.floor(entry));
    if (clean.length >= MAX_PACE_SAMPLES) break;
  }
  return clean;
}

function load(): PaceGhostMap {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!isPlainObject(parsed)) return {};
    const clean: PaceGhostMap = {};
    for (const [worldLevelKey, value] of Object.entries(parsed)) {
      const curve = sanitizeCurve(value);
      if (curve) clean[worldLevelKey] = curve;
    }
    return clean;
  } catch {
    return {};
  }
}

function save(map: PaceGhostMap): boolean {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    // Non-fatal — the pace line is informational.
    return false;
  }
}

/** The best-scoring run's curve for a world level (null if none recorded yet). */
export function getPaceGhost(worldLevel: number): number[] | null {
  return load()[String(worldLevel)] ?? null;
}

/**
 * Replaces the stored curve for a world level. A malformed curve is ignored.
 * Returns true only when the store actually took the write — the run-end
 * "NEW GHOST" marker must never claim a ghost that was never persisted.
 */
export function savePaceGhost(worldLevel: number, samples: readonly number[]): boolean {
  const clean = sanitizeCurve(samples);
  if (!clean) return false;
  const map = load();
  map[String(worldLevel)] = clean;
  return save(map);
}

/**
 * Kills ahead (+) or behind (-) the ghost at `elapsedSeconds`, or null when
 * there is nothing honest to say: no ghost, before the first sample, or past
 * the end of the recorded curve. Sample `i` sits at `(i + 1) * INTERVAL`
 * seconds, so the sample at-or-before `elapsedSeconds` is
 * `floor(elapsed / INTERVAL) - 1`; the value between two samples is linearly
 * interpolated.
 */
export function paceDeltaKills(
  ghost: number[] | null,
  elapsedSeconds: number,
  kills: number,
): number | null {
  if (!ghost || ghost.length === 0) return null;
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(kills)) return null;
  if (elapsedSeconds < PACE_SAMPLE_INTERVAL_SECONDS) return null;
  if (elapsedSeconds > ghost.length * PACE_SAMPLE_INTERVAL_SECONDS) return null;

  const sampleIndex = Math.min(
    ghost.length - 1,
    Math.floor(elapsedSeconds / PACE_SAMPLE_INTERVAL_SECONDS) - 1,
  );
  const lowerKills = ghost[sampleIndex];
  const lowerSeconds = (sampleIndex + 1) * PACE_SAMPLE_INTERVAL_SECONDS;
  const upperKills = sampleIndex + 1 < ghost.length ? ghost[sampleIndex + 1] : lowerKills;
  const fraction = Math.min(1, Math.max(0, (elapsedSeconds - lowerSeconds) / PACE_SAMPLE_INTERVAL_SECONDS));
  const ghostKills = lowerKills + (upperKills - lowerKills) * fraction;
  return Math.round(kills - ghostKills);
}

/**
 * How the run finished against the ghost it raced.
 * - `never-ahead`   — the run was never strictly ahead at any compared sample.
 * - `ahead-at-end`  — strictly ahead at the last compared sample.
 * - `lost-lead`     — led at some point, not at the last compared sample.
 * - `none`          — the run recorded no samples of its own (restored run), so
 *                     only the final delta is knowable.
 */
export type RunPaceShape = 'never-ahead' | 'ahead-at-end' | 'lost-lead' | 'none';

export interface RunPaceSummary {
  /** Kills ahead (+) / behind (-) at the end of the race; null when there is nothing honest to say. */
  finalDelta: number | null;
  /** Seconds the run survived past the end of the ghost's curve (0 when it did not). */
  outlastedSeconds: number;
  shape: RunPaceShape;
  /** For `lost-lead`: the last sample time the run was still strictly ahead. */
  lostLeadAtSeconds: number | null;
}

/**
 * Run-end summary of the pace race. `ghost` must be the curve the run RACED
 * (captured at run start) — never a re-read of the store, which a new best has
 * already overwritten with this very run.
 *
 * A run that outlives the ghost's curve is compared against the ghost's final
 * kill count instead of an interpolated point that does not exist.
 */
export function summarizeRunPace(
  ghost: number[] | null,
  runSamples: readonly number[],
  elapsedSeconds: number,
  kills: number,
): RunPaceSummary {
  const nothing: RunPaceSummary = {
    finalDelta: null,
    outlastedSeconds: 0,
    shape: 'none',
    lostLeadAtSeconds: null,
  };
  if (!ghost || ghost.length === 0) return nothing;
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(kills)) return nothing;

  const ghostEndSeconds = ghost.length * PACE_SAMPLE_INTERVAL_SECONDS;
  const outlastedSeconds = Math.max(0, elapsedSeconds - ghostEndSeconds);
  const finalDelta = outlastedSeconds > 0
    ? Math.round(kills - ghost[ghost.length - 1])
    : paceDeltaKills(ghost, elapsedSeconds, kills);

  const comparedCount = Math.min(runSamples.length, ghost.length);
  if (comparedCount === 0) {
    return { finalDelta, outlastedSeconds, shape: 'none', lostLeadAtSeconds: null };
  }

  let lastAheadIndex = -1;
  for (let index = 0; index < comparedCount; index++) {
    if (runSamples[index] > ghost[index]) lastAheadIndex = index;
  }
  if (lastAheadIndex === -1) {
    return { finalDelta, outlastedSeconds, shape: 'never-ahead', lostLeadAtSeconds: null };
  }
  if (lastAheadIndex === comparedCount - 1) {
    return { finalDelta, outlastedSeconds, shape: 'ahead-at-end', lostLeadAtSeconds: null };
  }
  return {
    finalDelta,
    outlastedSeconds,
    shape: 'lost-lead',
    lostLeadAtSeconds: (lastAheadIndex + 1) * PACE_SAMPLE_INTERVAL_SECONDS,
  };
}
