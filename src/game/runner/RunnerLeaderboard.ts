import { SecureStorage } from '../../storage';

/**
 * RunnerLeaderboard — persists a ranked list of the player's best RUNNER
 * (endless scroll-shooter) runs via SecureStorage, so LeaderboardScene can show a
 * browsable history (score, distance, kills, date). Distinct from RunnerBestScore
 * (a single scalar best used by the runner HUD/results) and mirrors the shipped
 * GauntletLeaderboard file-for-file.
 *
 * Ranking is BEST-first — highest score, then longest distance, then most kills,
 * then most recent. The list is capped to the best MAX_RUNNER_ENTRIES runs of all
 * time (not the most recent), so a great old run stays on the board.
 *
 * Read-through, no in-memory cache: reads are infrequent (run-end + leaderboard
 * open), and skipping the cache keeps the persisted store the single source of
 * truth. The key is registered in StorageBootstrap.ALL_STORAGE_KEYS (required —
 * unregistered keys read back as null on every fresh page load; StorageBootstrap.test.ts
 * also source-scans the `const STORAGE_KEY` convention and asserts registration).
 */

const STORAGE_KEY = 'survivor-runner-leaderboard';

/** Maximum ranked runs retained; runs outside the best this many are dropped. */
export const MAX_RUNNER_ENTRIES = 15;

export interface RunnerRunEntry {
  /** ms epoch when the run ended (caller-supplied, e.g. Date.now()). */
  timestamp: number;
  /** Final run score (computeScore of distance + kills). */
  score: number;
  /** Distance travelled this run, in whole displayed meters. */
  distanceMeters: number;
  /** Enemies killed this run. */
  kills: number;
}

/** True if the value is a well-formed RunnerRunEntry (defensive vs schema drift). */
function isRunnerRunEntry(value: unknown): value is RunnerRunEntry {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.timestamp === 'number' &&
    typeof run.score === 'number' &&
    typeof run.distanceMeters === 'number' &&
    typeof run.kills === 'number'
  );
}

/**
 * Rank entries BEST-first: highest score, then longest distance, then most kills,
 * then most recent. Pure; returns a new array. Exported for the unit test.
 */
export function rankRunnerEntries(entries: RunnerRunEntry[]): RunnerRunEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.score - a.score ||
      b.distanceMeters - a.distanceMeters ||
      b.kills - a.kills ||
      b.timestamp - a.timestamp
  );
}

/** Reads + validates the persisted board, ranked best-first. Corrupt → []. */
function load(): RunnerRunEntry[] {
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
    return rankRunnerEntries(parsed.filter(isRunnerRunEntry));
  } catch {
    return [];
  }
}

function save(entries: RunnerRunEntry[]): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Non-fatal — the leaderboard is cosmetic.
  }
}

/**
 * Records a finished runner run, re-ranking the board best-first and keeping only
 * the best MAX_RUNNER_ENTRIES of all time. Returns the trimmed, persisted list
 * (ranked best-first).
 */
export function recordRunnerRun(entry: RunnerRunEntry): RunnerRunEntry[] {
  const ranked = rankRunnerEntries([entry, ...load()]).slice(0, MAX_RUNNER_ENTRIES);
  save(ranked);
  return ranked;
}

/** All retained runs, ranked best-first. */
export function getRunnerRuns(): RunnerRunEntry[] {
  return load();
}

/** Clears the persisted runner leaderboard. */
export function clearRunnerRuns(): void {
  try {
    SecureStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}
