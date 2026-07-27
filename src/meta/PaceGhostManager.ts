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

function save(map: PaceGhostMap): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal — the pace line is informational.
  }
}

/** The best-scoring run's curve for a world level (null if none recorded yet). */
export function getPaceGhost(worldLevel: number): number[] | null {
  return load()[String(worldLevel)] ?? null;
}

/** Replaces the stored curve for a world level. A malformed curve is ignored. */
export function savePaceGhost(worldLevel: number, samples: readonly number[]): void {
  const clean = sanitizeCurve(samples);
  if (!clean) return;
  const map = load();
  map[String(worldLevel)] = clean;
  save(map);
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
