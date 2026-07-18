import { SecureStorage } from '../storage';

/**
 * ShipRecords — persists a per-ship lifetime record (runs played, victories, and
 * best run score) via SecureStorage, so the Codex Statistics tab can show a
 * per-ship performance board. Distinct from BestScoreManager (best score keyed by
 * world level) and RunHistoryManager (only the last 10 runs, any ship).
 *
 * Read-through (no in-memory cache — the store is the single source of truth,
 * mirroring BestScoreManager). `load()` validates + sanitizes on every read so a
 * corrupt, tampered, or partially-written payload degrades to "no record" instead
 * of crashing the Statistics screen — the same hardening posture as BestScoreManager.
 */

const STORAGE_KEY = 'survivor-ship-records';

export interface ShipRecord {
  runs: number;
  victories: number;
  bestScore: number;
}

type ShipRecordMap = Record<string, ShipRecord>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerce a candidate count/score to a finite, non-negative integer (0 if invalid). */
function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** A stored per-ship record is only trustworthy if it is a plain object of valid counts. */
function sanitizeRecord(value: unknown): ShipRecord | null {
  if (!isPlainObject(value)) return null;
  return {
    runs: sanitizeCount(value.runs),
    victories: sanitizeCount(value.victories),
    bestScore: sanitizeCount(value.bestScore),
  };
}

/**
 * Parse + validate the stored map on every call. Anything that isn't a plain
 * object of valid records is dropped rather than propagated, so a tampered or
 * truncated payload can never throw or surface NaN/garbage on the stats screen.
 */
function load(): ShipRecordMap {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!isPlainObject(parsed)) return {};
    const clean: ShipRecordMap = {};
    for (const [shipId, value] of Object.entries(parsed)) {
      const record = sanitizeRecord(value);
      if (record) clean[shipId] = record;
    }
    return clean;
  } catch {
    return {};
  }
}

function save(map: ShipRecordMap): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal — ship records are cosmetic.
  }
}

/** Lifetime record for a ship (zeros if none tracked yet). */
export function getShipRecord(shipId: string): ShipRecord {
  return load()[shipId] ?? { runs: 0, victories: 0, bestScore: 0 };
}

/**
 * Records one finished run for a ship: +1 run, +1 victory if won, and raises the
 * best score. Score is sanitized to a finite non-negative integer. No-ops on a
 * blank ship id.
 */
export function recordShipRun(shipId: string, victory: boolean, score: number): void {
  if (!shipId) return;
  const map = load();
  const prior = map[shipId] ?? { runs: 0, victories: 0, bestScore: 0 };
  const safeScore = sanitizeCount(score);
  map[shipId] = {
    runs: prior.runs + 1,
    victories: prior.victories + (victory ? 1 : 0),
    bestScore: Math.max(prior.bestScore, safeScore),
  };
  save(map);
}
