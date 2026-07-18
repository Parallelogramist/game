import { SecureStorage } from '../../storage';

/**
 * EndlessLeaderboard — persists a ranked list of the player's best post-victory
 * ENDLESS runs via SecureStorage, so LeaderboardScene can show a browsable history
 * (deepest cycle, kills, time, level, date). Distinct from EndlessBestCycle (a single
 * scalar best used by the game-over endless overlay + endgame achievement sync) and
 * mirrors the shipped GauntletLeaderboard file-for-file (wave -> cycle).
 *
 * Ranking is BEST-first — deepest cycle, then most kills, then longest survival, then
 * most recent. The list is capped to the best MAX_ENDLESS_ENTRIES runs of all time
 * (not the most recent), so a great old run stays on the board.
 *
 * Read-through, no in-memory cache: reads are infrequent (run-end + leaderboard open),
 * and skipping the cache keeps the persisted store the single source of truth. The key
 * is registered in StorageBootstrap.ALL_STORAGE_KEYS (required — unregistered keys read
 * back as null on every fresh page load; StorageBootstrap.test.ts also source-scans the
 * `const STORAGE_KEY` convention and asserts registration).
 */

const STORAGE_KEY = 'survivor-endless-leaderboard';

/** Maximum ranked runs retained; runs outside the best this many are dropped. */
export const MAX_ENDLESS_ENTRIES = 15;

export interface EndlessRunEntry {
  /** ms epoch when the run ended (caller-supplied, e.g. Date.now()). */
  timestamp: number;
  /** Deepest endless cycle reached this run. */
  cycle: number;
  /** Enemies killed this run. */
  kills: number;
  /** Run length in seconds. */
  durationSeconds: number;
  /** Player level reached. */
  levelReached: number;
  /** World level the run was played at. */
  worldLevel: number;
}

/** True if the value is a well-formed EndlessRunEntry (defensive vs schema drift). */
function isEndlessRunEntry(value: unknown): value is EndlessRunEntry {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.timestamp === 'number' &&
    typeof run.cycle === 'number' &&
    typeof run.kills === 'number' &&
    typeof run.durationSeconds === 'number' &&
    typeof run.levelReached === 'number' &&
    typeof run.worldLevel === 'number'
  );
}

/**
 * Rank entries BEST-first: deepest cycle, then most kills, then longest survival, then
 * most recent. Pure; returns a new array. Exported for the unit test.
 */
export function rankEndlessEntries(entries: EndlessRunEntry[]): EndlessRunEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.cycle - a.cycle ||
      b.kills - a.kills ||
      b.durationSeconds - a.durationSeconds ||
      b.timestamp - a.timestamp
  );
}

/** Reads + validates the persisted board, ranked best-first. Corrupt → []. */
function load(): EndlessRunEntry[] {
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
    return rankEndlessEntries(parsed.filter(isEndlessRunEntry));
  } catch {
    return [];
  }
}

function save(entries: EndlessRunEntry[]): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Non-fatal — the leaderboard is cosmetic.
  }
}

/**
 * Records a finished endless run, re-ranking the board best-first and keeping only the
 * best MAX_ENDLESS_ENTRIES of all time. Returns the trimmed, persisted list (ranked
 * best-first).
 */
export function recordEndlessRun(entry: EndlessRunEntry): EndlessRunEntry[] {
  const ranked = rankEndlessEntries([entry, ...load()]).slice(0, MAX_ENDLESS_ENTRIES);
  save(ranked);
  return ranked;
}

/** All retained runs, ranked best-first. */
export function getEndlessRuns(): EndlessRunEntry[] {
  return load();
}

/** Clears the persisted endless leaderboard. */
export function clearEndlessRuns(): void {
  try {
    SecureStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}
