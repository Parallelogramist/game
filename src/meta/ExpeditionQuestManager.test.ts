import { describe, test, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import { EXPEDITION_QUESTS } from '../data/ExpeditionQuests';
import {
  beginExpeditionQuestRun,
  recordExpeditionQuestEvent,
  claimExpeditionQuestGold,
  getExpeditionQuestStates,
  ACTIVE_EXPEDITION_QUEST_LIMIT,
} from './ExpeditionQuestManager';

const STORAGE_KEY = 'survivor-expedition-quests';

beforeEach(() => {
  SecureStorage.removeItem(STORAGE_KEY);
});

describe('ExpeditionQuestManager', () => {
  test('a first run starts the chain heads and a second run starts nothing new', () => {
    const first = beginExpeditionQuestRun();
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(ACTIVE_EXPEDITION_QUEST_LIMIT);
    expect(beginExpeditionQuestRun()).toEqual([]);
  });

  test('step gold banks once and is claimed once', () => {
    beginExpeditionQuestRun();
    const rewards = recordExpeditionQuestEvent({ kind: 'kill', amount: 100000 });
    expect(rewards.stepCompletions.length).toBeGreaterThan(0);
    const owed = rewards.stepCompletions.reduce((total, entry) => total + entry.goldReward, 0)
      + rewards.questCompletions.reduce((total, entry) => total + entry.goldReward, 0);
    expect(claimExpeditionQuestGold()).toBe(owed);
    expect(claimExpeditionQuestGold()).toBe(0);
  });

  test('progress survives a reload and a completed step is never re-paid', () => {
    beginExpeditionQuestRun();
    recordExpeditionQuestEvent({ kind: 'kill', amount: 150 });
    claimExpeditionQuestGold();
    const before = getExpeditionQuestStates();
    expect(before.find((state) => state.questId === 'quest_survey_01')?.stepIndex).toBe(1);

    beginExpeditionQuestRun();
    const replay = recordExpeditionQuestEvent({ kind: 'kill', amount: 150 });
    expect(replay.stepCompletions).toEqual([]);
    expect(claimExpeditionQuestGold()).toBe(0);
  });

  test('a new run clears an in-progress run-scope counter but not a completed step', () => {
    beginExpeditionQuestRun();
    recordExpeditionQuestEvent({ kind: 'kill', amount: 40 });
    expect(getExpeditionQuestStates().find((state) => state.questId === 'quest_survey_01')?.stepProgress).toBe(40);
    beginExpeditionQuestRun();
    const after = getExpeditionQuestStates().find((state) => state.questId === 'quest_survey_01');
    expect(after?.stepProgress).toBe(0);
    expect(after?.stepIndex).toBe(0);
  });

  test('a sweep that changes world saves the new stamp even when the room count does not move', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({
      states: [{ questId: 'quest_survey_03', stepIndex: 5, stepProgress: 0, status: 'active' }],
      pendingGold: 0,
    }));
    const enter = (sectorKey: string, worldStamp: string) => recordExpeditionQuestEvent(
      { kind: 'reachSector', sectorKey, sectorTags: [], worldStamp },
    );

    enter('1,0', 'w1');
    expect(getExpeditionQuestStates()[0].stepProgress).toBe(1);

    enter('1,0', 'w2');
    const [restated] = getExpeditionQuestStates();
    expect(restated.stepProgress).toBe(1);
    expect(restated.visitedWorldStamp).toBe('w2');
  });

  test('a profile whose authored chains are all done is issued this world\'s contracts', () => {
    const completedAuthored = EXPEDITION_QUESTS.map((quest) => ({
      questId: quest.id,
      stepIndex: quest.steps.length,
      stepProgress: 0,
      status: 'complete' as const,
    }));
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({
      states: completedAuthored, pendingGold: 0,
    }));

    const activated = beginExpeditionQuestRun();
    expect(activated.length).toBe(ACTIVE_EXPEDITION_QUEST_LIMIT);
    for (const quest of activated) {
      expect(quest.id.startsWith('quest_contract_'), quest.id).toBe(true);
      expect(quest.grantsKeyId, quest.id).toBeUndefined();
    }
  });
});
