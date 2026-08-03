/**
 * The profile's lifetime best expedition completion: the most of any one world it has ever
 * charted, and which world set it.
 *
 * Completion has been a per-world number since FEAT-EXPEDITION-SEASONS, so charting a new world
 * reset the only figure a player had to beat. This is the chase metric README section 6 asks
 * for, in the shape score, endless cycle and gauntlet wave already ship: a persisted best plus
 * an isNewBest flag, folded at run end. Pure parse/fold/describe below the storage entry points,
 * on the ExpeditionSeasonStore model, so the grammar and the clamps are testable without storage.
 */

import { SecureStorage } from '../storage';

const STORAGE_KEY_COMPLETION_BEST = 'survivor-expedition-completion-best';

export interface CompletionRecord {
  /** Whole percent. 0 means the profile has never recorded one. */
  bestPercent: number;
  /** The season ordinal of the world that set it. 0 when unknown, which still leaves a usable
   *  record: the percent is the chase and the ordinal is only the clause that names it. */
  bestSeasonIndex: number;
}

export interface CompletionFold {
  record: CompletionRecord;
  /** True only when the candidate strictly beat the stored record. */
  isNewBest: boolean;
}

export const EMPTY_COMPLETION_RECORD: CompletionRecord = { bestPercent: 0, bestSeasonIndex: 0 };

function clampWholePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampOrdinal(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function parseCompletionRecord(raw: string | null): CompletionRecord {
  if (typeof raw !== 'string' || raw.length === 0) return EMPTY_COMPLETION_RECORD;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return EMPTY_COMPLETION_RECORD;
    }
    const candidate = parsed as { bestPercent?: unknown; bestSeasonIndex?: unknown };
    return {
      bestPercent: clampWholePercent(candidate.bestPercent),
      bestSeasonIndex: clampOrdinal(candidate.bestSeasonIndex),
    };
  } catch {
    return EMPTY_COMPLETION_RECORD;
  }
}

export function serializeCompletionRecord(record: CompletionRecord): string {
  return JSON.stringify({
    bestPercent: clampWholePercent(record.bestPercent),
    bestSeasonIndex: clampOrdinal(record.bestSeasonIndex),
  });
}

/**
 * Strictly greater wins. An equal percent must NOT overwrite, or a second world tying the record
 * would silently re-attribute it, and a run whose completion is folded twice (a won-then-died
 * endless run reaches both run-end paths) would report a second new best for the same number.
 */
export function foldCompletionRecord(
  prior: CompletionRecord, percent: number, seasonIndex: number,
): CompletionFold {
  const candidatePercent = clampWholePercent(percent);
  if (candidatePercent <= prior.bestPercent) return { record: prior, isNewBest: false };
  return {
    record: { bestPercent: candidatePercent, bestSeasonIndex: clampOrdinal(seasonIndex) },
    isNewBest: true,
  };
}

/**
 * `   ·   BEST 61% (W2)` for a dialog line, or '' when there is nothing to beat. Suppressed once
 * the live world has caught the record, because the line this appends to already prints that same
 * number as `Charted 61%`, and a clause repeating it reads as two different facts. The leading
 * separator belongs to the clause so a caller appends one expression instead of branching.
 */
export function describeCompletionRecordClause(
  record: CompletionRecord, currentPercent: number,
): string {
  if (record.bestPercent <= 0 || record.bestPercent <= currentPercent) return '';
  const world = record.bestSeasonIndex > 0 ? ` (W${record.bestSeasonIndex})` : '';
  return `   ·   BEST ${record.bestPercent}%${world}`;
}

export function loadCompletionRecord(): CompletionRecord {
  return parseCompletionRecord(SecureStorage.getItem(STORAGE_KEY_COMPLETION_BEST));
}

/** Folds `percent` into the stored record. Writes only on a new best, so a run that beats
 *  nothing costs one read and no write. */
export function recordExpeditionCompletion(
  percent: number, seasonIndex: number,
): CompletionFold {
  const fold = foldCompletionRecord(loadCompletionRecord(), percent, seasonIndex);
  if (fold.isNewBest) {
    try {
      SecureStorage.setItem(STORAGE_KEY_COMPLETION_BEST, serializeCompletionRecord(fold.record));
    } catch {
      console.warn('Could not save the expedition completion record');
    }
  }
  return fold;
}
