import { describe, it, expect } from 'vitest';
import { buildExpeditionDebriefRow } from './expeditionDebrief';

const debrief = {
  seasonIndex: 3,
  completionPercent: 42,
  sectorsCharted: 18,
  knowableSectors: 43,
  chartedThisRun: 4,
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
      seasonIndex: 1, completionPercent: 5, sectorsCharted: 2, knowableSectors: 40, chartedThisRun: 2,
    })).toEqual({ worldLabel: 'W1 · 5%', chartedLabel: '2 / 40 (+2)' });
  });
});
