import { describe, test, expect } from 'vitest';
import {
  recordQuestEvent,
  seedQuestStates,
  settleRunScopeProgress,
  type QuestInstanceState,
} from './QuestProgress';
import type { ExpeditionQuestDefinition } from '../data/ExpeditionQuests';

const DEFS: readonly ExpeditionQuestDefinition[] = [
  {
    id: 'quest_a',
    name: 'A',
    icon: 'clipboard',
    steps: [
      { id: 'q_a.s1', description: 'kill 10', trigger: { kind: 'kill' }, target: 10, scope: 'run', goldReward: 5 },
      { id: 'q_a.s2', description: 'depth 3', trigger: { kind: 'reachDepth' }, target: 3, scope: 'persistent', goldReward: 7 },
    ],
    completionGoldReward: 20,
    nextQuestId: 'quest_b',
  },
  {
    id: 'quest_b',
    name: 'B',
    icon: 'radar',
    steps: [
      { id: 'q_b.s1', description: 'open 2', trigger: { kind: 'openGate' }, target: 2, scope: 'run', goldReward: 9 },
    ],
    completionGoldReward: 30,
  },
  {
    id: 'quest_c',
    name: 'C',
    icon: 'crown',
    steps: [
      { id: 'q_c.s1', description: 'claim blink', trigger: { kind: 'claimAbility', abilityId: 'ability_blink' }, target: 1, scope: 'persistent', goldReward: 11 },
    ],
    completionGoldReward: 40,
  },
];

const active = (questId: string, stepIndex = 0, stepProgress = 0): QuestInstanceState =>
  ({ questId, stepIndex, stepProgress, status: 'active' });

describe('recordQuestEvent', () => {
  test('accumulates a kill delta without completing below target', () => {
    const result = recordQuestEvent([active('quest_a')], DEFS, { kind: 'kill', amount: 4 });
    expect(result.states[0].stepProgress).toBe(4);
    expect(result.stepCompletions).toEqual([]);
  });

  test('completes a step at target, pays it once and advances the index', () => {
    const first = recordQuestEvent([active('quest_a')], DEFS, { kind: 'kill', amount: 10 });
    expect(first.stepCompletions).toEqual([{ questId: 'quest_a', stepId: 'q_a.s1', goldReward: 5 }]);
    expect(first.states[0]).toMatchObject({ stepIndex: 1, stepProgress: 0, status: 'active' });

    const second = recordQuestEvent(first.states, DEFS, { kind: 'kill', amount: 50 });
    expect(second.stepCompletions).toEqual([]);
    expect(second.states[0].stepIndex).toBe(1);
  });

  test('one event never cascades through two steps', () => {
    const result = recordQuestEvent([active('quest_a')], DEFS, { kind: 'kill', amount: 999 });
    expect(result.stepCompletions).toHaveLength(1);
    expect(result.states[0].stepIndex).toBe(1);
  });

  test('reachDepth folds with max, so re-entering a shallower sector cannot regress it', () => {
    const deep = recordQuestEvent([active('quest_a', 1)], DEFS, { kind: 'reachDepth', depth: 2 });
    expect(deep.states[0].stepProgress).toBe(2);
    const shallow = recordQuestEvent(deep.states, DEFS, { kind: 'reachDepth', depth: 1 });
    expect(shallow.states[0].stepProgress).toBe(2);
  });

  test('completing the last step completes the quest and hands off to the chain successor', () => {
    const afterStep1 = recordQuestEvent([active('quest_a')], DEFS, { kind: 'kill', amount: 10 });
    const done = recordQuestEvent(afterStep1.states, DEFS, { kind: 'reachDepth', depth: 3 });
    expect(done.questCompletions).toEqual([{ questId: 'quest_a', goldReward: 20 }]);
    expect(done.states.find((state) => state.questId === 'quest_a')?.status).toBe('complete');
    expect(done.activatedQuestIds).toEqual(['quest_b']);
    expect(done.states.find((state) => state.questId === 'quest_b')).toMatchObject({
      stepIndex: 0, stepProgress: 0, status: 'active',
    });
  });

  test('a completed quest ignores further events', () => {
    const states: QuestInstanceState[] = [{ questId: 'quest_b', stepIndex: 1, stepProgress: 0, status: 'complete' }];
    const result = recordQuestEvent(states, DEFS, { kind: 'openGate' });
    expect(result.stepCompletions).toEqual([]);
    expect(result.states[0].stepProgress).toBe(0);
  });

  test('an ability trigger matches only its named ability', () => {
    const wrong = recordQuestEvent([active('quest_c')], DEFS, { kind: 'claimAbility', abilityId: 'ability_other' });
    expect(wrong.stepCompletions).toEqual([]);
    const right = recordQuestEvent([active('quest_c')], DEFS, { kind: 'claimAbility', abilityId: 'ability_blink' });
    expect(right.questCompletions).toEqual([{ questId: 'quest_c', goldReward: 40 }]);
  });

  test('never mutates the states it was handed', () => {
    const states = [active('quest_a')];
    recordQuestEvent(states, DEFS, { kind: 'kill', amount: 10 });
    expect(states[0]).toEqual(active('quest_a'));
  });
});

describe('settleRunScopeProgress', () => {
  test('clears an in-progress run-scope counter and keeps persistent ones and completed steps', () => {
    const states = [active('quest_a', 0, 9), active('quest_a', 1, 2)];
    const settled = settleRunScopeProgress(states, DEFS);
    expect(settled[0].stepProgress).toBe(0);
    expect(settled[0].stepIndex).toBe(0);
    expect(settled[1].stepProgress).toBe(2);
    expect(settled[1].stepIndex).toBe(1);
  });
});

describe('seedQuestStates', () => {
  test('seeds chain heads only, never a successor, and never re-seeds a held quest', () => {
    const seeded = seedQuestStates([], DEFS, 3);
    expect(seeded.activatedQuestIds).toEqual(['quest_a', 'quest_c']);
    const again = seedQuestStates(seeded.states, DEFS, 3);
    expect(again.activatedQuestIds).toEqual([]);
  });

  test('honors the active cap', () => {
    const seeded = seedQuestStates([], DEFS, 1);
    expect(seeded.activatedQuestIds).toEqual(['quest_a']);
  });
});
