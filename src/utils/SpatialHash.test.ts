import { describe, test, expect } from 'vitest';
import {
  SpatialHash,
  getEnemySpatialHash,
  resetEnemySpatialHash,
  type SpatialEntity,
} from './SpatialHash';

// SpatialHash underpins weapon targeting, overkill splash, GridBackground
// warping, and FrameCache — every "what's near this point?" answer in the game
// flows through it, yet it had no direct coverage. A subtle cell-math bug
// (wrong floor on negatives, a missed neighboring cell, a key collision) is
// invisible mistargeting everywhere. This file locks insert/query correctness
// including cell-boundary straddling, negative-coordinate cell keys, the
// non-allocating query variants' parity with the allocating ones, buffer
// semantics, clear/rebuild, findNearest/findNearestN contracts, and the
// enemy-hash singleton.

function ids(entities: SpatialEntity[]): number[] {
  return entities.map((e) => e.id).sort((a, b) => a - b);
}

describe('insert + query radius correctness', () => {
  test('finds an entity within radius and excludes one outside, same cell', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 10, 10);
    hash.insert(2, 75, 10); // same 80px cell as the query point, but 65px away

    expect(ids(hash.query(10, 10, 60))).toEqual([1]);
  });

  test('finds entities straddling an 80px cell boundary', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 79, 40); // cell (0, 0)
    hash.insert(2, 81, 40); // cell (1, 0)

    // Query from cell (1, 0) with a radius reaching back across the boundary.
    expect(ids(hash.query(85, 40, 10))).toEqual([1, 2]);
    // And from cell (0, 0) reaching forward.
    expect(ids(hash.query(75, 40, 10))).toEqual([1, 2]);
  });

  test('radius check is inclusive at exactly radius distance', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 50, 0);

    expect(ids(hash.query(0, 0, 50))).toEqual([1]);
    expect(hash.query(0, 0, 49.999)).toEqual([]);
  });

  test('collects matches across multiple cells in one query', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 0, 0);
    hash.insert(2, 100, 0);
    hash.insert(3, 0, 100);
    hash.insert(4, 500, 500); // far away

    expect(ids(hash.query(50, 50, 120))).toEqual([1, 2, 3]);
  });
});

describe('negative coordinates', () => {
  test('entities at negative positions land in their own cells (floor, not trunc)', () => {
    const hash = new SpatialHash(80);
    // With Math.trunc both (-10, -10) and (10, 10) would collapse into cell
    // (0, 0); Math.floor puts them in cells (-1, -1) and (0, 0).
    hash.insert(1, -10, -10);
    hash.insert(2, 10, 10);

    expect(ids(hash.query(10, 10, 5))).toEqual([2]);
    expect(ids(hash.query(-10, -10, 5))).toEqual([1]);
  });

  test('distinct cells across all four quadrants stay distinct', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, -50, -50);
    hash.insert(2, 50, -50);
    hash.insert(3, -50, 50);
    hash.insert(4, 50, 50);

    expect(ids(hash.query(-50, -50, 10))).toEqual([1]);
    expect(ids(hash.query(50, -50, 10))).toEqual([2]);
    expect(ids(hash.query(-50, 50, 10))).toEqual([3]);
    expect(ids(hash.query(50, 50, 10))).toEqual([4]);
  });

  test('queries spanning the origin find entities on both sides', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, -30, 0);
    hash.insert(2, 30, 0);

    expect(ids(hash.query(0, 0, 40))).toEqual([1, 2]);
  });
});

describe('query buffer variants', () => {
  test('queryInto appends without clearing the caller buffer', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 0, 0);

    const sentinel: SpatialEntity = { id: 99, x: -999, y: -999 };
    const buffer: SpatialEntity[] = [sentinel];
    hash.queryInto(0, 0, 10, buffer);

    expect(buffer).toHaveLength(2);
    expect(buffer[0]).toBe(sentinel);
    expect(buffer[1].id).toBe(1);
  });

  test('queryIds returns the same ids as query', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 0, 0);
    hash.insert(2, 30, 30);
    hash.insert(3, 300, 300);

    const fromQuery = ids(hash.query(10, 10, 60));
    const fromQueryIds = [...hash.queryIds(10, 10, 60)].sort((a, b) => a - b);
    expect(fromQueryIds).toEqual(fromQuery);
    expect(fromQueryIds).toEqual([1, 2]);
  });
});

describe('queryPotential + queryPotentialForEach', () => {
  test('queryPotential skips the distance check (returns whole scanned cells)', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 10, 10);
    hash.insert(2, 75, 75); // same cell as (10, 10) but ~92px from it

    // Exact query filters by distance; potential query returns the full cell.
    expect(ids(hash.query(10, 10, 20))).toEqual([1]);
    expect(ids(hash.queryPotential(10, 10, 20))).toEqual([1, 2]);
  });

  test('queryPotentialForEach visits exactly the entities queryPotential returns', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, -70, -70);
    hash.insert(2, 0, 0);
    hash.insert(3, 79, 81);
    hash.insert(4, 400, 400);

    const allocated = ids(hash.queryPotential(0, 0, 90));
    const visited: number[] = [];
    hash.queryPotentialForEach(0, 0, 90, (entity) => visited.push(entity.id));

    expect(visited.sort((a, b) => a - b)).toEqual(allocated);
    expect(allocated).toContain(1);
    expect(allocated).not.toContain(4);
  });
});

describe('clear + rebuild + counters', () => {
  test('size and cellCount track inserts', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 0, 0);
    hash.insert(2, 10, 10); // same cell
    hash.insert(3, 200, 200); // new cell

    expect(hash.size).toBe(3);
    expect(hash.cellCount).toBe(2);
  });

  test('clear empties everything; insertMany rebuilds', () => {
    const hash = new SpatialHash(80);
    hash.insertMany([
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 100, y: 100 },
    ]);
    expect(hash.size).toBe(2);

    hash.clear();
    expect(hash.size).toBe(0);
    expect(hash.cellCount).toBe(0);
    expect(hash.query(0, 0, 500)).toEqual([]);

    hash.insertMany([{ id: 3, x: 50, y: 50 }]);
    expect(ids(hash.query(50, 50, 10))).toEqual([3]);
  });
});

describe('findNearest', () => {
  test('returns the closest entity', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 30, 0);
    hash.insert(2, 10, 0);
    hash.insert(3, 50, 0);

    expect(hash.findNearest(0, 0, 100)?.id).toBe(2);
  });

  test('excludeId skips to the next nearest', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 10, 0);
    hash.insert(2, 30, 0);

    expect(hash.findNearest(0, 0, 100, 1)?.id).toBe(2);
  });

  test('returns null when nothing is within maxRadius', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 500, 500);

    expect(hash.findNearest(0, 0, 100)).toBeNull();
  });

  test('an entity exactly at maxRadius is not returned (strict bound)', () => {
    // query() is inclusive at the radius, but findNearest seeds its best
    // distance with maxRadius² and requires strictly closer — lock that edge.
    const hash = new SpatialHash(80);
    hash.insert(1, 100, 0);

    expect(hash.findNearest(0, 0, 100)).toBeNull();
    expect(hash.findNearest(0, 0, 100.001)?.id).toBe(1);
  });
});

describe('findNearestN', () => {
  test('returns up to count entities ordered by ascending distance', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 40, 0);
    hash.insert(2, 10, 0);
    hash.insert(3, 25, 0);
    hash.insert(4, 60, 0);

    expect(hash.findNearestN(0, 0, 100, 3).map((e) => e.id)).toEqual([2, 3, 1]);
  });

  test('excludeIds filters before picking', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 10, 0);
    hash.insert(2, 20, 0);
    hash.insert(3, 30, 0);

    const picked = hash.findNearestN(0, 0, 100, 2, new Set([1]));
    expect(picked.map((e) => e.id)).toEqual([2, 3]);
  });

  test('returns fewer than count when not enough are in range', () => {
    const hash = new SpatialHash(80);
    hash.insert(1, 10, 0);
    hash.insert(2, 900, 900);

    expect(hash.findNearestN(0, 0, 100, 5).map((e) => e.id)).toEqual([1]);
  });
});

describe('enemy spatial hash singleton', () => {
  test('getEnemySpatialHash returns the same instance across calls', () => {
    expect(getEnemySpatialHash()).toBe(getEnemySpatialHash());
  });

  test('resetEnemySpatialHash clears contents but keeps the instance', () => {
    const hash = getEnemySpatialHash();
    hash.insert(1, 0, 0);
    expect(hash.size).toBe(1);

    resetEnemySpatialHash();
    expect(getEnemySpatialHash()).toBe(hash);
    expect(hash.size).toBe(0);
    expect(hash.query(0, 0, 100)).toEqual([]);
  });
});
