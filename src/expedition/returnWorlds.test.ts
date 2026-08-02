import { describe, it, expect } from 'vitest';
import {
  RETURN_WORLD_SORT_ORDER,
  nextReturnWorldSort,
  returnWorldPage,
  sortReturnWorlds,
} from './returnWorlds';
import type { BankedWorldRow } from './expeditionWorld';

/** Banking order, oldest first, exactly as the season store keeps it. */
function bankedWorlds(count: number): BankedWorldRow[] {
  return Array.from({ length: count }, (_, at) => ({
    index: at + 1,
    seed: 1000 + at,
    completionPercent: 50,
    sectorsCharted: 20,
    secretsFound: 5,
    conquered: false,
  }));
}

describe('return world ordering', () => {
  it('pages the whole banked history, most recent first, and wraps past the last page', () => {
    const banked = bankedWorlds(7);

    const firstPage = returnWorldPage(banked, 'recent', 0);
    expect(firstPage.pageCount).toBe(3);
    expect(firstPage.rows.length).toBe(3);
    expect(firstPage.rows.map(row => row.index)).toEqual([7, 6, 5]);
    expect(returnWorldPage(banked, 'recent', 2).rows.map(row => row.index)).toEqual([1]);
    // One MORE button has to reach the first page again from the last.
    expect(returnWorldPage(banked, 'recent', 3)).toEqual(firstPage);
    expect(returnWorldPage(banked, 'recent', -1).rows.map(row => row.index)).toEqual([1]);
    // Every banked world is reachable, and no world is offered on two pages.
    const paged = [0, 1, 2].flatMap(page => returnWorldPage(banked, 'recent', page).rows)
      .map(row => row.seed);
    expect(new Set(paged).size).toBe(banked.length);

    const empty = returnWorldPage([], 'recent', 0);
    expect(empty.pageCount).toBe(1);
    expect(empty.rows).toEqual([]);
    expect(empty.page).toBe(0);
  });

  it('orders by the key asked for and breaks every tie on banking recency', () => {
    const banked = bankedWorlds(4);
    banked[0] = { ...banked[0]!, completionPercent: 88, secretsFound: 2, conquered: true };
    banked[1] = { ...banked[1]!, completionPercent: 10, secretsFound: 30 };
    banked[2] = { ...banked[2]!, completionPercent: 88, secretsFound: 1 };
    banked[3] = { ...banked[3]!, completionPercent: 40, secretsFound: 9 };

    const indexes = (sort: Parameters<typeof sortReturnWorlds>[1]) =>
      sortReturnWorlds(banked, sort).map(row => row.index);

    expect(indexes('recent')).toEqual([4, 3, 2, 1]);
    // W1 and W3 both sit at 88%, and the later-banked W3 wins the tie.
    expect(indexes('charted')).toEqual([3, 1, 4, 2]);
    expect(indexes('secrets')).toEqual([2, 4, 1, 3]);
    expect(indexes('conquered')).toEqual([1, 4, 3, 2]);
    // Every order is a permutation of the same worlds: no row is dropped or duplicated.
    for (const sort of RETURN_WORLD_SORT_ORDER) {
      expect(new Set(indexes(sort))).toEqual(new Set([1, 2, 3, 4]));
    }
  });

  it('cycles the sort button through every order and back to the default', () => {
    let sort = RETURN_WORLD_SORT_ORDER[0]!;
    const seen = [sort];
    for (let press = 1; press < RETURN_WORLD_SORT_ORDER.length; press += 1) {
      sort = nextReturnWorldSort(sort);
      seen.push(sort);
    }
    expect(seen).toEqual([...RETURN_WORLD_SORT_ORDER]);
    expect(nextReturnWorldSort(sort)).toBe(RETURN_WORLD_SORT_ORDER[0]);
  });
});
