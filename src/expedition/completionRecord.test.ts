import { describe, it, expect } from 'vitest';
import {
  EMPTY_COMPLETION_RECORD,
  describeCompletionRecordClause,
  foldCompletionRecord,
  parseCompletionRecord,
  serializeCompletionRecord,
} from './completionRecord';

describe('foldCompletionRecord', () => {
  it('takes a strictly higher percent and the world that set it', () => {
    expect(foldCompletionRecord({ bestPercent: 42, bestSeasonIndex: 2 }, 61, 5))
      .toEqual({ record: { bestPercent: 61, bestSeasonIndex: 5 }, isNewBest: true });
  });

  it('leaves an equal percent alone, so a tie cannot re-attribute the record', () => {
    expect(foldCompletionRecord({ bestPercent: 61, bestSeasonIndex: 2 }, 61, 5))
      .toEqual({ record: { bestPercent: 61, bestSeasonIndex: 2 }, isNewBest: false });
  });

  it('reports no new best when the same run is folded twice', () => {
    const first = foldCompletionRecord(EMPTY_COMPLETION_RECORD, 61, 5);
    expect(first.isNewBest).toBe(true);
    expect(foldCompletionRecord(first.record, 61, 5).isNewBest).toBe(false);
  });
});

describe('parseCompletionRecord', () => {
  it('round-trips a serialized record', () => {
    expect(parseCompletionRecord(serializeCompletionRecord({ bestPercent: 61, bestSeasonIndex: 5 })))
      .toEqual({ bestPercent: 61, bestSeasonIndex: 5 });
  });

  it('reads a missing or corrupt payload as no record rather than throwing', () => {
    expect(parseCompletionRecord(null)).toEqual(EMPTY_COMPLETION_RECORD);
    expect(parseCompletionRecord('not json')).toEqual(EMPTY_COMPLETION_RECORD);
    expect(parseCompletionRecord('[1,2]')).toEqual(EMPTY_COMPLETION_RECORD);
    expect(parseCompletionRecord('{"bestPercent":"61"}')).toEqual(EMPTY_COMPLETION_RECORD);
  });

  it('clamps a tampered percent into the range a percent can hold', () => {
    expect(parseCompletionRecord('{"bestPercent":999,"bestSeasonIndex":-4}'))
      .toEqual({ bestPercent: 100, bestSeasonIndex: 0 });
  });
});

describe('describeCompletionRecordClause', () => {
  it('names the record and its world while the live world is behind it', () => {
    expect(describeCompletionRecordClause({ bestPercent: 61, bestSeasonIndex: 2 }, 42))
      .toBe('   ·   BEST 61% (W2)');
  });

  it('says nothing once the live world has caught the record', () => {
    expect(describeCompletionRecordClause({ bestPercent: 61, bestSeasonIndex: 2 }, 61)).toBe('');
    expect(describeCompletionRecordClause(EMPTY_COMPLETION_RECORD, 0)).toBe('');
  });

  it('drops the world clause rather than printing W0 for a record with no ordinal', () => {
    expect(describeCompletionRecordClause({ bestPercent: 61, bestSeasonIndex: 0 }, 42))
      .toBe('   ·   BEST 61%');
  });
});
