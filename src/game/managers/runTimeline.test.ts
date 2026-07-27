import { describe, it, expect } from 'vitest';
import { layoutRunTimeline, type RunTimelineEvent } from './runTimeline';

const at = (kind: RunTimelineEvent['kind'], atSeconds: number): RunTimelineEvent => ({ kind, atSeconds });

describe('layoutRunTimeline', () => {
  it('collapses a burst of same-kind beats into one counted marker and keeps a distant one apart', () => {
    const markers = layoutRunTimeline(
      [at('level', 100), at('level', 100.4), at('level', 101), at('level', 500)],
      1000,
      1000,
    );

    expect(markers).toEqual([
      { kind: 'level', offsetX: 100, count: 3 },
      { kind: 'level', offsetX: 500, count: 1 },
    ]);
  });

  it('never collapses across kinds', () => {
    const markers = layoutRunTimeline([at('boss', 300), at('level', 300)], 1000, 1000);

    expect(markers).toEqual([
      { kind: 'level', offsetX: 300, count: 1 },
      { kind: 'boss', offsetX: 300, count: 1 },
    ]);
  });

  it('clamps out-of-range times and puts everything at the origin when the run has no duration', () => {
    expect(layoutRunTimeline([at('level', 5000), at('boss', -20)], 1000, 800)).toEqual([
      { kind: 'level', offsetX: 800, count: 1 },
      { kind: 'boss', offsetX: 0, count: 1 },
    ].sort((first, second) => first.offsetX - second.offsetX));

    expect(layoutRunTimeline([at('level', 10), at('level', 20)], 0, 800)).toEqual([
      { kind: 'level', offsetX: 0, count: 2 },
    ]);
  });

  it('returns nothing for an empty log or a non-positive track', () => {
    expect(layoutRunTimeline([], 600, 1000)).toEqual([]);
    expect(layoutRunTimeline([at('level', 10)], 600, 0)).toEqual([]);
  });
});
