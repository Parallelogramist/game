import { describe, test, expect } from 'vitest';
import { buildRunTickerRows, MAX_TICKER_LEADS } from './runTicker';
import type { QuestStepView } from '../systems/QuestProgress';
import type { SecretLead } from './secretHints';

const viewFor = (questId: string): QuestStepView => ({
  questId,
  questName: questId,
  stepDescription: `do ${questId}`,
  progress: 1,
  target: 3,
  stepNumber: 1,
  stepCount: 2,
});

const leadFor = (secretId: string): SecretLead => ({
  secretId,
  sectorKey: '1,1',
  depth: 3,
  fragment: { id: secretId, title: `frag ${secretId}`, text: 'flavour', icon: 'radar' },
  riddle: `A dead end, ${secretId}.`,
});

describe('buildRunTickerRows', () => {
  test('badges only the quest that moved and lists objectives before leads', () => {
    expect(buildRunTickerRows({
      views: [viewFor('q_a'), viewFor('q_b')],
      updatedQuestIds: new Set(['q_b']),
      leads: [leadFor('s_1')],
    })).toEqual([
      'OBJECTIVE · do q_a 1/3',
      'OBJECTIVE · do q_b 1/3 · UPDATED',
      'LEAD · FRAG S_1 · A dead end, s_1.',
    ]);
  });

  test('caps the lead rows so the cycle cannot outgrow the line', () => {
    const rows = buildRunTickerRows({
      views: [],
      updatedQuestIds: new Set(),
      leads: [leadFor('s_1'), leadFor('s_2'), leadFor('s_3')],
    });
    expect(rows).toHaveLength(MAX_TICKER_LEADS);
    expect(rows[0]).toContain('S_1');
  });

  test('says nothing when there is nothing to say', () => {
    expect(buildRunTickerRows({
      views: [], updatedQuestIds: new Set(), leads: [],
    })).toEqual([]);
  });
});
