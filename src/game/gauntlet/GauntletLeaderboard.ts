import { SecureStorage } from '../../storage';

/**
 * GauntletLeaderboard — persists a ranked list of the player's best GAUNTLET
 * boss-rush runs via SecureStorage, so LeaderboardScene can show a browsable
 * history (deepest wave, kills, time, level, date). Distinct from
 * GauntletBestWave (a single scalar best used by the game-over overlay) and from
 * RunHistoryManager (recent standard/endless runs, newest-first).
 *
 * Ranking is BEST-first — deepest wave, then most kills, then longest survival,
 * then most recent. The list is capped to the best MAX_GAUNTLET_ENTRIES runs of
 * all time (not the most recent), so a great old run stays on the board.
 *
 * Read-through, no in-memory cache: reads are infrequent (run-end + leaderboard
 * open), and skipping the cache keeps the persisted store the single source of
 * truth. The key is registered in StorageBootstrap.ALL_STORAGE_KEYS (required —
 * unregistered keys read back as null on every fresh page load).
 */

const STORAGE_KEY = 'survivor-gauntlet-leaderboard';

/** Maximum ranked runs retained; runs outside the best this many are dropped. */
export const MAX_GAUNTLET_ENTRIES = 15;

export interface GauntletRunEntry {
  /** ms epoch when the run ended (caller-supplied, e.g. Date.now()). */
  timestamp: number;
  /** Deepest gauntlet wave reached this run. */
  wave: number;
  /** Enemies killed this run. */
  kills: number;
  /** Run length in seconds. */
  durationSeconds: number;
  /** Player level reached. */
  levelReached: number;
  /** World level the run was played at. */
  worldLevel: number;
}

/** True if the value is a well-formed GauntletRunEntry (defensive vs schema drift). */
function isGauntletRunEntry(value: unknown): value is GauntletRunEntry {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.timestamp === 'number' &&
    typeof run.wave === 'number' &&
    typeof run.kills === 'number' &&
    typeof run.durationSeconds === 'number' &&
    typeof run.levelReached === 'number' &&
    typeof run.worldLevel === 'number'
  );
}

/**
 * Rank entries BEST-first: deepest wave, then most kills, then longest survival,
 * then most recent. Pure; returns a new array. Exported for the unit test.
 */
export function rankGauntletEntries(entries: GauntletRunEntry[]): GauntletRunEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.wave - a.wave ||
      b.kills - a.kills ||
      b.durationSeconds - a.durationSeconds ||
      b.timestamp - a.timestamp
  );
}

/** Reads + validates the persisted board, ranked best-first. Corrupt → []. */
function load(): GauntletRunEntry[] {
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
    return rankGauntletEntries(parsed.filter(isGauntletRunEntry));
  } catch {
    return [];
  }
}

function save(entries: GauntletRunEntry[]): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Non-fatal — the leaderboard is cosmetic.
  }
}

/**
 * Records a finished gauntlet run, re-ranking the board best-first and keeping
 * only the best MAX_GAUNTLET_ENTRIES of all time. Returns the trimmed, persisted
 * list (ranked best-first).
 */
export function recordGauntletRun(entry: GauntletRunEntry): GauntletRunEntry[] {
  const ranked = rankGauntletEntries([entry, ...load()]).slice(0, MAX_GAUNTLET_ENTRIES);
  save(ranked);
  return ranked;
}

/** All retained runs, ranked best-first. */
export function getGauntletRuns(): GauntletRunEntry[] {
  return load();
}

/** Clears the persisted gauntlet leaderboard. */
export function clearGauntletRuns(): void {
  try {
    SecureStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}
