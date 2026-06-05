import { SecureStorage } from '../storage';

/**
 * BestScoreManager — persists the best run score per world level via
 * SecureStorage, so the post-run results screen can show a personal best and
 * flag new records. Scores come from PerformanceGrade.computeRunScore so the
 * grade and the best are derived from the same number.
 *
 * Read-through (no in-memory cache — the store is the single source of truth,
 * mirroring RunHistoryManager). `load()` validates + sanitizes on every read so
 * a corrupt, tampered, or partially-written payload (the threat model
 * SecureStorage exists for) degrades to "no record" instead of crashing the
 * results screen — the same hardening posture as FEAT-SAVE-VALIDATE.
 */

const STORAGE_KEY = 'survivor-best-scores';

type BestScoreMap = Record<string, number>; // worldLevel -> best score

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored best is only trustworthy if it is a finite, non-negative number. */
function isValidStoredScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Coerce a candidate run score to a finite, non-negative integer (0 if invalid). */
function sanitizeScore(score: number): number {
  if (!Number.isFinite(score) || score < 0) return 0;
  return Math.floor(score);
}

/**
 * Parse + validate the stored score map on every call. Anything that isn't a
 * plain object of valid scores is dropped rather than propagated, so a tampered
 * or truncated payload can never throw (e.g. a `"null"` payload would otherwise
 * make `getBestScore` dereference null) or surface a NaN/garbage "best".
 */
function load(): BestScoreMap {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!isPlainObject(parsed)) return {};
    const clean: BestScoreMap = {};
    for (const [worldLevelKey, value] of Object.entries(parsed)) {
      if (isValidStoredScore(value)) {
        clean[worldLevelKey] = value;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function save(map: BestScoreMap): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal — best scores are cosmetic.
  }
}

/** Best score recorded for a world level (0 if none). */
export function getBestScore(worldLevel: number): number {
  return load()[String(worldLevel)] ?? 0;
}

/**
 * Records a run score for a world level. Returns the prior best and whether
 * this run set a new record. The score itself is always echoed back (sanitized
 * to a finite, non-negative integer so a garbage input never reaches the UI).
 */
export function recordScore(worldLevel: number, score: number): { score: number; best: number; isNewBest: boolean } {
  const safeScore = sanitizeScore(score);
  const map = load();
  const key = String(worldLevel);
  const priorBest = map[key] ?? 0;
  const isNewBest = safeScore > priorBest;
  if (isNewBest) {
    map[key] = safeScore;
    save(map);
  }
  return { score: safeScore, best: Math.max(priorBest, safeScore), isNewBest };
}
