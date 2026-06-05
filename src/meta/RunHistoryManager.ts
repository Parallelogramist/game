import { SecureStorage } from '../storage';

/**
 * RunHistoryManager — persists a short list of recent run summaries via
 * SecureStorage, so the post-run results screen can show the player how their
 * latest runs went. Distinct from AchievementManager (which tracks *aggregate*
 * lifetime stats) and the daily leaderboard (daily-mode only).
 *
 * Read-through, no in-memory cache: reads are infrequent (run-end + boot), and
 * skipping the cache keeps the persisted store the single source of truth.
 */

const STORAGE_KEY = 'survivor-run-history';

/** Maximum number of recent runs retained; older runs are dropped. */
export const MAX_RUN_HISTORY = 10;

export interface RunSummary {
  /** ms epoch when the run ended (caller-supplied, e.g. Date.now()). */
  timestamp: number;
  /** Run length in seconds. */
  durationSeconds: number;
  /** Enemies killed this run. */
  kills: number;
  /** Player level reached. */
  level: number;
  /** Composite run score (PerformanceGrade.computeRunScore). */
  score: number;
  /** Letter grade ('S'..'F'). */
  grade: string;
  /** Whether the run ended in victory. */
  victory: boolean;
  /** World level the run was played at. */
  worldLevel: number;
}

/** True if the value is a well-formed RunSummary (defensive against schema drift). */
function isRunSummary(value: unknown): value is RunSummary {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.timestamp === 'number' &&
    typeof run.durationSeconds === 'number' &&
    typeof run.kills === 'number' &&
    typeof run.level === 'number' &&
    typeof run.score === 'number' &&
    typeof run.grade === 'string' &&
    typeof run.victory === 'boolean' &&
    typeof run.worldLevel === 'number'
  );
}

/** Reads + validates the persisted history (newest-first). Corrupt → []. */
function load(): RunSummary[] {
  let stored: string | null;
  try {
    stored = SecureStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRunSummary);
  } catch {
    return [];
  }
}

function save(history: RunSummary[]): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Non-fatal — run history is cosmetic.
  }
}

/**
 * Records a finished run, prepending it (newest-first) and capping the list to
 * MAX_RUN_HISTORY. Returns the trimmed, persisted list.
 */
export function recordRun(summary: RunSummary): RunSummary[] {
  const history = [summary, ...load()].slice(0, MAX_RUN_HISTORY);
  save(history);
  return history;
}

/** All retained runs, newest-first. */
export function getRunHistory(): RunSummary[] {
  return load();
}

/**
 * The most recent runs, newest-first. Without a limit returns the whole
 * retained history; a limit larger than the history is clamped.
 */
export function getRecentRuns(limit?: number): RunSummary[] {
  const history = load();
  if (limit === undefined) return history;
  return history.slice(0, Math.max(0, limit));
}

/** Clears all persisted run history. */
export function clearRunHistory(): void {
  try {
    SecureStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}
