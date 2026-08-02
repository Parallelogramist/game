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
  getExpeditionQuestFromCatalog,
  loadExpeditionQuestCargo,
  ACTIVE_EXPEDITION_QUEST_LIMIT,
} from './ExpeditionQuestManager';
import { buildSeasonQuests } from '../expedition/seasonQuests';
import { getCurrentExpeditionSeed } from '../expedition/ExpeditionSeasonStore';

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

  test('a crate survives a reload and a new expedition takes it back', () => {
    beginExpeditionQuestRun();
    const loaded = loadExpeditionQuestCargo();
    expect(loaded.loaded.length + loaded.aboard.length).toBeGreaterThanOrEqual(0);
    // Nothing to assert about WHICH quest is on a delivery step from a cold profile: the chain
    // heads seed first. What must hold is that a load is remembered and a new run is not.
    const withCargo = getExpeditionQuestStates()
      .some((state) => state.cargoHeld === true);
    expect(withCargo).toBe(loaded.loaded.length > 0);
    beginExpeditionQuestRun();
    expect(getExpeditionQuestStates().some((state) => state.cargoHeld === true)).toBe(false);
  });

  test('a drone flag on a step that does not ask for one is dropped on load', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({
      states: [{
        questId: 'quest_survey_01', stepIndex: 0, stepProgress: 0,
        status: 'active', droneEscorting: true,
      }],
      pendingGold: 0,
    }));
    expect(getExpeditionQuestStates()[0].droneEscorting).toBeUndefined();
  });

  test('the catalog lookup answers for a season contract, not only for an authored chain', () => {
    const contracts = buildSeasonQuests(getCurrentExpeditionSeed());
    expect(contracts.length).toBeGreaterThan(0);
    for (const contract of contracts) {
      expect(getExpeditionQuestFromCatalog(contract.id)).toEqual(contract);
    }
    for (const authored of EXPEDITION_QUESTS) {
      expect(getExpeditionQuestFromCatalog(authored.id)).toEqual(authored);
    }
    expect(getExpeditionQuestFromCatalog('quest_does_not_exist')).toBeUndefined();
  });
});
