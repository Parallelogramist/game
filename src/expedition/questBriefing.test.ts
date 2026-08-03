import { describe, expect, test } from 'vitest';
import { buildQuestBriefingLines } from './questBriefing';
import type { QuestStepView } from '../systems/QuestProgress';

const view = (overrides: Partial<QuestStepView> = {}): QuestStepView => ({
  questId: 'quest_survey_03',
  questName: 'Deep Survey',
  stepDescription: 'Chart 20 rooms',
  progress: 14,
  target: 20,
  stepNumber: 6,
  stepCount: 6,
  stepGoldReward: 150,
  chainGoldRemaining: 350,
  ...overrides,
});

describe('buildQuestBriefingLines', () => {
  test('says nothing is active rather than printing an empty list', () => {
    const lines = buildQuestBriefingLines({
      seasonIndex: 3, completionPercent: 42, worldStamp: '99:v7', views: [], worldBound: [],
    });
    expect(lines[0]).toBe('WORLD 3   ·   42% CHARTED');
    expect(lines.join('\n')).toContain('No objectives are active.');
  });

  test('warns only about rooms counted under another world stamp', () => {
    const bound = (questId: string, worldStamp: string) => ({
      questId, questName: 'Deep Survey', stepDescription: 'Chart 20 rooms',
      roomsCounted: 14, worldStamp,
    });
    const here = buildQuestBriefingLines({
      seasonIndex: 3, completionPercent: 42, worldStamp: '99:v7',
      views: [view()], worldBound: [bound('quest_survey_03', '99:v7')],
    }).join('\n');
    expect(here).not.toContain('restart here');

    const elsewhere = buildQuestBriefingLines({
      seasonIndex: 3, completionPercent: 42, worldStamp: '99:v7',
      views: [view()], worldBound: [bound('quest_survey_03', '12:v7')],
    }).join('\n');
    expect(elsewhere).toContain('14 rooms were charted in another world and restart here.');
  });

  test('prints the step position, the progress and a step note', () => {
    const lines = buildQuestBriefingLines({
      seasonIndex: 1, completionPercent: 0, worldStamp: '99:v7',
      views: [view({ stepNumber: 2, stepCount: 3, note: 'CARGO ABOARD' })],
      worldBound: [],
    }).join('\n');
    expect(lines).toContain('Deep Survey   ·   STEP 2 OF 3   ·   CHAIN PAYS 350 G');
    expect(lines).toContain('Chart 20 rooms   14 / 20   ·   PAYS 150 G');
    expect(lines).toContain('CARGO ABOARD');
  });
});
