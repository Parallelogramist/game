import { SecureStorage } from '../storage';
import { isPracticeSession, setPracticeSession } from '../utils/practiceSession';
import { EnemyAffixType } from '../data/Affixes';

/**
 * PracticeBestTimes — fastest recorded sandbox kill per fight, where a "fight" is
 * the exact configuration the PRACTICE dock spawned: target + both affixes + the
 * build depth it was fought at. Ship and weapon are deliberately NOT part of the
 * key — they are what the operator varies, so the record answers "what is the
 * fastest known clear of this fight, and with what".
 *
 * Read-through with sanitize-on-read, mirroring ShipRecords/BestScoreManager: a
 * corrupt or tampered payload degrades to "no record" instead of throwing.
 */

const STORAGE_KEY = 'survivor-practice-bests';

export interface PracticeBestEntry {
  /** Fight duration in milliseconds, measured on the run clock. */
  ms: number;
  shipId: string;
  weaponId: string;
  weaponLevel: number;
  evolved: boolean;
}

type PracticeBestMap = Record<string, PracticeBestEntry>;

/** Stable id for one exact sandbox fight. */
export function practiceBestKey(
  targetId: string,
  affix: EnemyAffixType,
  affix2: EnemyAffixType,
  buildDepth: number
): string {
  return `${targetId}|${affix}|${affix2}|d${buildDepth}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeEntry(value: unknown): PracticeBestEntry | null {
  if (!isPlainObject(value)) return null;
  const ms = value.ms;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const shipId = typeof value.shipId === 'string' ? value.shipId : '';
  const weaponId = typeof value.weaponId === 'string' ? value.weaponId : '';
  const rawLevel = value.weaponLevel;
  const weaponLevel =
    typeof rawLevel === 'number' && Number.isFinite(rawLevel) && rawLevel > 0
      ? Math.floor(rawLevel)
      : 1;
  return {
    ms: Math.round(ms),
    shipId,
    weaponId,
    weaponLevel,
    evolved: value.evolved === true,
  };
}

function load(): PracticeBestMap {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!isPlainObject(parsed)) return {};
    const clean: PracticeBestMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const entry = sanitizeEntry(value);
      if (entry) clean[key] = entry;
    }
    return clean;
  } catch {
    return {};
  }
}

/**
 * SecureStorage drops every write while a practice session is active — that block
 * is what stops a sandbox run from touching the real profile. A practice best time
 * is the one thing a sandbox run is meant to persist, so the block is lifted for
 * this single write and restored immediately.
 */
function writeThroughPracticeBlock(map: PracticeBestMap): void {
  const wasPracticeSession = isPracticeSession();
  if (wasPracticeSession) setPracticeSession(false);
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } finally {
    if (wasPracticeSession) setPracticeSession(true);
  }
}

export function getPracticeBest(key: string): PracticeBestEntry | null {
  return load()[key] ?? null;
}

/** Stores the entry only if it beats the standing record. Returns true if it did. */
export function savePracticeBestIfFaster(key: string, entry: PracticeBestEntry): boolean {
  const candidate = sanitizeEntry(entry);
  if (!candidate) return false;
  const map = load();
  const current = map[key];
  if (current && current.ms <= candidate.ms) return false;
  map[key] = candidate;
  writeThroughPracticeBlock(map);
  return true;
}

/** `M:SS.d` — the readout used in the kill toast. */
export function formatFightTime(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalTenths = Math.round(safeMs / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
