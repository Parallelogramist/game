import { describe, test, expect } from 'vitest';
import {
  SHIP_HULL_IDS,
  SHIP_TIER_COUNT,
  POD_START_TIER,
  DEFAULT_HULL_ID,
  getShipTierGeometry,
  getHullBounds,
  Point2D,
  ShipTierGeometry,
} from './shipHullGeometry';

// PlayerSpaceship composites hull + glow into a 200×200 RenderTexture
// (CACHE_SIZE), and the tier-5 energy corona scales the outline up to 1.6×.
// Every hull at every tier must fit that budget or the cached sprite clips.
const CACHE_HALF_SIZE = 100;
const MAX_GLOW_SCALE = 1.6;

const ALL_TIERS = Array.from({ length: SHIP_TIER_COUNT }, (_, tier) => tier);

function forEveryHullTier(
  assertFn: (geometry: ShipTierGeometry, hullId: string, tier: number) => void
): void {
  for (const hullId of SHIP_HULL_IDS) {
    for (const tier of ALL_TIERS) {
      assertFn(getShipTierGeometry(hullId, tier), hullId, tier);
    }
  }
}

function maxRadius(outline: Point2D[]): number {
  return outline.reduce((max, point) => Math.max(max, Math.hypot(point.x, point.y)), 0);
}

/** Shoelace formula — abs area of a closed polygon. */
function polygonArea(outline: Point2D[]): number {
  let doubleArea = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    doubleArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(doubleArea) / 2;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** True proper-crossing test for two segments (shared endpoints excluded by caller). */
function segmentsCross(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): boolean {
  const d1 = orientation(b1, b2, a1);
  const d2 = orientation(b1, b2, a2);
  const d3 = orientation(a1, a2, b1);
  const d4 = orientation(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Every polygon edge pair (excluding neighbors) must not properly cross. */
function findSelfIntersection(outline: Point2D[]): string | null {
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges (they share a vertex), including the wrap pair.
      if (i === 0 && j === n - 1) continue;
      const a1 = outline[i];
      const a2 = outline[(i + 1) % n];
      const b1 = outline[j];
      const b2 = outline[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) {
        return `edge ${i} (${a1.x},${a1.y})→(${a2.x},${a2.y}) crosses edge ${j} (${b1.x},${b1.y})→(${b2.x},${b2.y})`;
      }
    }
  }
  return null;
}

function pointKey(point: Point2D): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
}

/** Multiset symmetry: every point's x-axis mirror is also present. */
function isMirrorSymmetric(points: Point2D[]): boolean {
  const counts = new Map<string, number>();
  for (const point of points) {
    counts.set(pointKey(point), (counts.get(pointKey(point)) ?? 0) + 1);
  }
  for (const point of points) {
    const mirroredKey = pointKey({ x: point.x, y: -point.y });
    if ((counts.get(mirroredKey) ?? 0) < 1) return false;
  }
  return true;
}

describe('shipHullGeometry — registry & resolution', () => {
  test('hull ids are unique and cover the full roster count', () => {
    expect(new Set(SHIP_HULL_IDS).size).toBe(SHIP_HULL_IDS.length);
    expect(SHIP_HULL_IDS.length).toBe(11);
    expect(SHIP_HULL_IDS).toContain(DEFAULT_HULL_ID);
  });

  test('unknown hull ids fall back to the default hull', () => {
    for (const tier of ALL_TIERS) {
      expect(getShipTierGeometry('hull_that_does_not_exist', tier))
        .toBe(getShipTierGeometry(DEFAULT_HULL_ID, tier));
    }
  });

  test('out-of-range tiers clamp instead of crashing', () => {
    expect(getShipTierGeometry('dart', -3)).toBe(getShipTierGeometry('dart', 0));
    expect(getShipTierGeometry('dart', 99)).toBe(getShipTierGeometry('dart', SHIP_TIER_COUNT - 1));
    expect(getShipTierGeometry('dart', 2.7)).toBe(getShipTierGeometry('dart', 2));
  });

  test('ten evolution tiers per hull', () => {
    expect(SHIP_TIER_COUNT).toBe(10);
  });

  test('geometry is cached — same reference per (hull, tier)', () => {
    expect(getShipTierGeometry('umbra', 3)).toBe(getShipTierGeometry('umbra', 3));
  });
});

describe('shipHullGeometry — outline invariants (every hull × tier)', () => {
  test('outlines are substantial closed polygons', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      const label = `${hullId} tier ${tier}`;
      expect(geometry.hullOutline.length, label).toBeGreaterThanOrEqual(8);
      expect(polygonArea(geometry.hullOutline), label).toBeGreaterThan(50);
    });
  });

  test('outlines are mirror-symmetric about the x axis', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      expect(isMirrorSymmetric(geometry.hullOutline), `${hullId} tier ${tier}`).toBe(true);
    });
  });

  test('outlines never self-intersect', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      const crossing = findSelfIntersection(geometry.hullOutline);
      expect(crossing, `${hullId} tier ${tier}: ${crossing}`).toBeNull();
    });
  });

  test('ships face +x: outline extends both forward and backward', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      const bounds = getHullBounds(geometry.hullOutline);
      const label = `${hullId} tier ${tier}`;
      expect(bounds.maxX, label).toBeGreaterThan(10);
      expect(bounds.minX, label).toBeLessThan(-5);
      // Symmetric span sanity.
      expect(bounds.maxY, label).toBeCloseTo(-bounds.minY, 5);
    });
  });

  test('each evolution tier is strictly larger than the previous', () => {
    for (const hullId of SHIP_HULL_IDS) {
      let previousRadius = 0;
      for (const tier of ALL_TIERS) {
        const radius = maxRadius(getShipTierGeometry(hullId, tier).hullOutline);
        expect(radius, `${hullId} tier ${tier}`).toBeGreaterThan(previousRadius);
        previousRadius = radius;
      }
    }
  });

  test('every hull fits the PlayerSpaceship render cache at max glow scale', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      expect(maxRadius(geometry.hullOutline) * MAX_GLOW_SCALE, `${hullId} tier ${tier}`)
        .toBeLessThanOrEqual(CACHE_HALF_SIZE * 0.95);
    });
  });

  test('every hull silhouette is unique at every tier', () => {
    for (const tier of ALL_TIERS) {
      const signatures = new Map<string, string>();
      for (const hullId of SHIP_HULL_IDS) {
        const signature = getShipTierGeometry(hullId, tier).hullOutline
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(';');
        const clash = signatures.get(signature);
        expect(clash, `tier ${tier}: ${hullId} duplicates ${clash}`).toBeUndefined();
        signatures.set(signature, hullId);
      }
    }
  });
});

describe('shipHullGeometry — per-tier variation', () => {
  // "10 variations per ship" must mean visible change, not just scale: compare
  // scale-normalized signatures of the shape-defining parts between
  // consecutive tiers. Pure uniform growth would produce identical signatures.
  function normalizedSignature(geometry: ShipTierGeometry): string {
    const radius = maxRadius(geometry.hullOutline);
    const norm = (points: Point2D[]) => points
      .map((point) => `${(point.x / radius).toFixed(2)},${(point.y / radius).toFixed(2)}`)
      .join(';');
    return [
      norm(geometry.hullOutline),
      norm(geometry.engineNozzles),
      norm(geometry.energyPods),
      norm(geometry.wingTipAccents),
    ].join('|');
  }

  test('every consecutive tier changes the ship beyond uniform scaling', () => {
    for (const hullId of SHIP_HULL_IDS) {
      let previous = normalizedSignature(getShipTierGeometry(hullId, 0));
      for (let tier = 1; tier < SHIP_TIER_COUNT; tier++) {
        const current = normalizedSignature(getShipTierGeometry(hullId, tier));
        expect(current, `${hullId} tier ${tier - 1} → ${tier} looks identical (scale-only)`)
          .not.toBe(previous);
        previous = current;
      }
    }
  });
});

describe('shipHullGeometry — fittings invariants (every hull × tier)', () => {
  test('cockpits are valid polygons inside the hull bounds', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      const label = `${hullId} tier ${tier}`;
      const bounds = getHullBounds(geometry.hullOutline);
      expect(geometry.cockpit.length, label).toBeGreaterThanOrEqual(4);
      expect(isMirrorSymmetric(geometry.cockpit), label).toBe(true);
      for (const point of geometry.cockpit) {
        expect(point.x, label).toBeLessThanOrEqual(bounds.maxX);
        expect(point.x, label).toBeGreaterThanOrEqual(bounds.minX);
        expect(Math.abs(point.y), label).toBeLessThanOrEqual(bounds.maxY);
      }
    });
  });

  test('engines exist, sit behind the cockpit, mirror-symmetric, within bounds', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      const label = `${hullId} tier ${tier}`;
      expect(geometry.engineNozzles.length, label).toBeGreaterThanOrEqual(1);
      expect(geometry.engineNozzleRadius, label).toBeGreaterThan(0);
      expect(isMirrorSymmetric(geometry.engineNozzles), label).toBe(true);

      const bounds = getHullBounds(geometry.hullOutline);
      const cockpitFront = Math.max(...geometry.cockpit.map((point) => point.x));
      for (const nozzle of geometry.engineNozzles) {
        expect(nozzle.x, label).toBeLessThan(cockpitFront);
        expect(nozzle.x, label).toBeGreaterThanOrEqual(bounds.minX);
        expect(Math.abs(nozzle.y), label).toBeLessThanOrEqual(bounds.maxY);
      }
    });
  });

  test('engine count never shrinks as the ship evolves', () => {
    for (const hullId of SHIP_HULL_IDS) {
      let previousCount = 0;
      for (const tier of ALL_TIERS) {
        const count = getShipTierGeometry(hullId, tier).engineNozzles.length;
        expect(count, `${hullId} tier ${tier}`).toBeGreaterThanOrEqual(previousCount);
        previousCount = count;
      }
    }
  });

  test('energy pods appear from POD_START_TIER up, mirrored, with a radius', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      const label = `${hullId} tier ${tier}`;
      if (tier < POD_START_TIER) {
        expect(geometry.energyPods.length, label).toBe(0);
      } else {
        expect(geometry.energyPods.length, label).toBeGreaterThanOrEqual(2);
        expect(geometry.energyPodRadius, label).toBeGreaterThan(0);
        expect(isMirrorSymmetric(geometry.energyPods), label).toBe(true);
      }
    });
  });

  test('detail linework stays within the hull footprint', () => {
    forEveryHullTier((geometry, hullId, tier) => {
      const label = `${hullId} tier ${tier}`;
      const bounds = getHullBounds(geometry.hullOutline);
      const inflate = 1.01;
      const within = (point: Point2D) =>
        point.x <= bounds.maxX * inflate + 1 &&
        point.x >= bounds.minX * inflate - 1 &&
        Math.abs(point.y) <= bounds.maxY * inflate + 1;

      for (const trace of geometry.circuitTraces) {
        expect(trace.path.length, label).toBeGreaterThanOrEqual(2);
        for (const point of trace.path) expect(within(point), `${label} trace`).toBe(true);
      }
      for (const channel of geometry.energyChannels) {
        expect(channel.path.length, label).toBeGreaterThanOrEqual(2);
        for (const point of channel.path) expect(within(point), `${label} channel`).toBe(true);
      }
      for (const segment of geometry.wingEdgeSegments) {
        expect(within(segment.from), `${label} edge`).toBe(true);
        expect(within(segment.to), `${label} edge`).toBe(true);
      }
    });
  });

  test('detail density ramps with tier: tier 0 has no edge accents, later tiers do', () => {
    for (const hullId of SHIP_HULL_IDS) {
      expect(getShipTierGeometry(hullId, 0).wingEdgeSegments.length, hullId).toBe(0);
      expect(getShipTierGeometry(hullId, 4).wingEdgeSegments.length, hullId).toBeGreaterThan(0);
      // Every tier has an energy spine + at least one circuit trace pair.
      for (const tier of ALL_TIERS) {
        const geometry = getShipTierGeometry(hullId, tier);
        expect(geometry.energyChannels.length, `${hullId} tier ${tier}`).toBeGreaterThanOrEqual(1);
        expect(geometry.circuitTraces.length, `${hullId} tier ${tier}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
