import { describe, it, expect } from 'vitest';
import { buildExpeditionDebriefRow } from './expeditionDebrief';

const debrief = {
  seasonIndex: 3,
  completionPercent: 42,
  sectorsCharted: 18,
  knowableSectors: 43,
  chartedThisRun: 4,
  bestPercent: 61,
  bestSeasonIndex: 2,
  isNewBest: false,
};

describe('buildExpeditionDebriefRow', () => {
  it('names the world and its completion percent', () => {
    expect(buildExpeditionDebriefRow(debrief).worldLabel).toBe('W3 · 42%');
  });

  it('prints the charted count over the knowable total with this run\'s gain', () => {
    expect(buildExpeditionDebriefRow(debrief).chartedLabel).toBe('18 / 43 (+4)');
  });

  it('drops the gain on a restored run, which has no run-start baseline', () => {
    expect(buildExpeditionDebriefRow({ ...debrief, chartedThisRun: null }).chartedLabel)
      .toBe('18 / 43');
  });

  it('drops the gain when the run charted nothing new', () => {
    expect(buildExpeditionDebriefRow({ ...debrief, chartedThisRun: 0 }).chartedLabel)
      .toBe('18 / 43');
  });

  it('drops the denominator rather than printing a zero total', () => {
    expect(buildExpeditionDebriefRow({ ...debrief, knowableSectors: 0 }).chartedLabel)
      .toBe('18 (+4)');
  });

  it('reads correctly on a first run into a fresh world', () => {
    expect(buildExpeditionDebriefRow({
      seasonIndex: 1, completionPercent: 5, sectorsCharted: 2, knowableSectors: 40,
      chartedThisRun: 2, bestPercent: 0, bestSeasonIndex: 0, isNewBest: false,
    })).toEqual({ worldLabel: 'W1 · 5%', chartedLabel: '2 / 40 (+2)', recordLabel: null });
  });

  it('names the record and the world holding it', () => {
    expect(buildExpeditionDebriefRow(debrief).recordLabel).toBe('61% · W2');
  });

  it('says NEW BEST instead of the number this run just set', () => {
    expect(buildExpeditionDebriefRow({ ...debrief, bestPercent: 42, bestSeasonIndex: 3, isNewBest: true }).recordLabel)
      .toBe('NEW BEST');
  });

  it('draws no record row before the profile has one', () => {
    expect(buildExpeditionDebriefRow({ ...debrief, bestPercent: 0, bestSeasonIndex: 0 }).recordLabel)
      .toBeNull();
  });
});
