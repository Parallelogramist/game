/**
 * How the RETURN dialog orders the worlds this profile banked.
 *
 * The list shipped in banking order only (FEAT-SEASON-RETURN-FULL-LIST), which answers "which
 * world did I leave last" and no other question. A player chasing a completion unlock wants the
 * world he left at 88%, and with 20 banked worlds dealt three to a page that world is six presses
 * away. Ordering lives here rather than in ExpeditionSeasonStore because `conquered` is not a
 * field of BankedSeason: it is read from WorldProfileStore by describeBankedWorlds, and importing
 * that module into the store would make a cycle.
 */

import { RETURN_WORLD_CHOICE_COUNT } from './ExpeditionSeasonStore';
import type { BankedWorldRow } from './expeditionWorld';

export type ReturnWorldSort = 'recent' | 'charted' | 'secrets' | 'conquered';

/** The cycle order of the SORT button. `recent` leads because it is the shipped behaviour and
 *  the default a dialog opens on. */
export const RETURN_WORLD_SORT_ORDER: readonly ReturnWorldSort[] = [
  'recent', 'charted', 'secrets', 'conquered',
];

/** Reads as a clause in the dialog's heading line, so each one completes "Fly back to, ___". */
export const RETURN_WORLD_SORT_LABELS: Readonly<Record<ReturnWorldSort, string>> = {
  recent: 'most recent first',
  charted: 'most charted first',
  secrets: 'most secrets first',
  conquered: 'conquered first',
};

export function nextReturnWorldSort(sort: ReturnWorldSort): ReturnWorldSort {
  const at = RETURN_WORLD_SORT_ORDER.indexOf(sort);
  return RETURN_WORLD_SORT_ORDER[(at + 1) % RETURN_WORLD_SORT_ORDER.length]!;
}

export interface ReturnWorldPage {
  /** The rows this page shows, in the requested order. */
  rows: readonly BankedWorldRow[];
  /** The page actually shown: the requested one wrapped into range. */
  page: number;
  /** Never 0, so an empty history still reads as "page 1 of 1". */
  pageCount: number;
}

/**
 * `banked` arrives in banking order, oldest first, exactly as the season store keeps it and
 * exactly as describeBankedWorlds returns it.
 *
 * Every order falls back to banking recency, and the tiebreak is written out rather than left to
 * the engine's sort stability, because two worlds left at the same percent are extremely common
 * and the list a player is choosing from must not depend on an implementation detail.
 */
export function sortReturnWorlds(
  banked: readonly BankedWorldRow[], sort: ReturnWorldSort,
): readonly BankedWorldRow[] {
  const byRecency = [...banked].reverse();
  if (sort === 'recent') return byRecency;
  const rank = (row: BankedWorldRow): number => {
    if (sort === 'charted') return row.completionPercent;
    if (sort === 'secrets') return row.secretsFound;
    return row.conquered ? 1 : 0;
  };
  return byRecency
    .map((row, recency) => ({ row, recency }))
    .sort((a, b) => (rank(b.row) - rank(a.row)) || (a.recency - b.recency))
    .map(entry => entry.row);
}

/**
 * One page of the ordered list. The page index WRAPS rather than clamping, because the dialog has
 * one MORE button and it has to reach the first page again from the last.
 */
export function returnWorldPage(
  banked: readonly BankedWorldRow[], sort: ReturnWorldSort, page: number,
): ReturnWorldPage {
  const ordered = sortReturnWorlds(banked, sort);
  const pageCount = Math.max(1, Math.ceil(ordered.length / RETURN_WORLD_CHOICE_COUNT));
  const requested = Number.isFinite(page) ? Math.trunc(page) : 0;
  const safePage = ((requested % pageCount) + pageCount) % pageCount;
  const start = safePage * RETURN_WORLD_CHOICE_COUNT;
  return {
    rows: ordered.slice(start, start + RETURN_WORLD_CHOICE_COUNT),
    page: safePage,
    pageCount,
  };
}
