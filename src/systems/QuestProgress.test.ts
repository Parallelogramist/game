import { describe, test, expect } from 'vitest';
import {
  recordQuestEvent,
  seedQuestStates,
  settleRunScopeProgress,
  buildQuestStepViews,
  buildQuestMarkers,
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
  {
    id: 'quest_d',
    name: 'D',
    icon: 'ghost',
    steps: [
      { id: 'q_d.s1', description: 'find 2 hidden sectors', trigger: { kind: 'findSecret', secretKind: 'hiddenSector' }, target: 2, scope: 'persistent', goldReward: 13 },
    ],
    completionGoldReward: 50,
  },
  {
    id: 'quest_e',
    name: 'E',
    icon: 'crystal',
    steps: [
      { id: 'q_e.s1', description: 'find 2 secrets', trigger: { kind: 'findSecret' }, target: 2, scope: 'persistent', goldReward: 17 },
    ],
    completionGoldReward: 60,
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

  test('a secret trigger matches only its named secret kind', () => {
    const wrong = recordQuestEvent([active('quest_d')], DEFS, { kind: 'findSecret', secretKind: 'cache' });
    expect(wrong.states[0].stepProgress).toBe(0);
    const right = recordQuestEvent([active('quest_d')], DEFS, { kind: 'findSecret', secretKind: 'hiddenSector' });
    expect(right.states[0].stepProgress).toBe(1);
  });

  test('a secret trigger naming no kind counts either kind of find', () => {
    const first = recordQuestEvent([active('quest_e')], DEFS, { kind: 'findSecret', secretKind: 'cache' });
    expect(first.states[0].stepProgress).toBe(1);
    const second = recordQuestEvent(first.states, DEFS, { kind: 'findSecret', secretKind: 'hiddenSector' });
    expect(second.questCompletions).toEqual([{ questId: 'quest_e', goldReward: 60 }]);
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
    const seeded = seedQuestStates([], DEFS, 4);
    expect(seeded.activatedQuestIds).toEqual(['quest_a', 'quest_c', 'quest_d', 'quest_e']);
    const again = seedQuestStates(seeded.states, DEFS, 4);
    expect(again.activatedQuestIds).toEqual([]);
  });

  test('honors the active cap', () => {
    const seeded = seedQuestStates([], DEFS, 1);
    expect(seeded.activatedQuestIds).toEqual(['quest_a']);
  });
});

describe('buildQuestStepViews', () => {
  test('projects each active quest onto its current step, clamping overshoot', () => {
    const views = buildQuestStepViews([active('quest_a', 0, 4), active('quest_b', 0, 99)], DEFS);
    expect(views).toEqual([
      { questId: 'quest_a', questName: 'A', stepDescription: 'kill 10', progress: 4, target: 10, stepNumber: 1, stepCount: 2 },
      { questId: 'quest_b', questName: 'B', stepDescription: 'open 2', progress: 2, target: 2, stepNumber: 1, stepCount: 1 },
    ]);
  });

  test('reports the chain position of a later step', () => {
    const views = buildQuestStepViews([active('quest_a', 1, 2)], DEFS);
    expect(views[0]).toMatchObject({ stepDescription: 'depth 3', stepNumber: 2, stepCount: 2 });
  });

  test('omits completed quests and states the catalog no longer resolves', () => {
    const states: QuestInstanceState[] = [
      { questId: 'quest_a', stepIndex: 2, stepProgress: 0, status: 'complete' },
      { questId: 'quest_gone', stepIndex: 0, stepProgress: 1, status: 'active' },
      { questId: 'quest_b', stepIndex: 7, stepProgress: 1, status: 'active' },
    ];
    expect(buildQuestStepViews(states, DEFS)).toEqual([]);
  });
});

describe('reachSector', () => {
  const PLACE_DEFS: readonly ExpeditionQuestDefinition[] = [{
    id: 'quest_place',
    name: 'Place',
    icon: 'radar',
    steps: [{
      id: 'q_place.s1',
      description: 'reach arena',
      trigger: { kind: 'reachSector', sectorTag: 'boss-arena' },
      target: 1,
      scope: 'persistent',
      goldReward: 13,
    }],
    completionGoldReward: 50,
  }];
  const held: QuestInstanceState[] = [
    { questId: 'quest_place', stepIndex: 0, stepProgress: 0, status: 'active' },
  ];

  test('advances only on an entry whose tags include the step tag', () => {
    const miss = recordQuestEvent(held, PLACE_DEFS,
      { kind: 'reachSector', sectorTags: ['biome:stage_inferno'] });
    expect(miss.stepCompletions).toEqual([]);
    const hit = recordQuestEvent(held, PLACE_DEFS,
      { kind: 'reachSector', sectorTags: ['biome:stage_inferno', 'boss-arena'] });
    expect(hit.questCompletions).toEqual([{ questId: 'quest_place', goldReward: 50 }]);
  });

  test('markers carry only the quests whose current step names a place', () => {
    expect(buildQuestMarkers(held, PLACE_DEFS)).toEqual([
      { questId: 'quest_place', label: 'Place', icon: 'radar', sectorTag: 'boss-arena' },
    ]);
    expect(buildQuestMarkers([active('quest_a', 0, 0)], DEFS)).toEqual([]);
  });
});

describe('surviveInSector', () => {
  const HOLD_DEFS: readonly ExpeditionQuestDefinition[] = [{
    id: 'quest_hold',
    name: 'Hold',
    icon: 'radar',
    steps: [{
      id: 'q_hold.s1',
      description: 'hold the arena',
      trigger: { kind: 'surviveInSector', sectorTag: 'boss-arena' },
      target: 60,
      scope: 'run',
      goldReward: 21,
    }],
    completionGoldReward: 40,
  }];
  const held: QuestInstanceState[] = [
    { questId: 'quest_hold', stepIndex: 0, stepProgress: 0, status: 'active' },
  ];

  test('folds dwell with max, ignores a sector whose tags do not match, and completes at target', () => {
    const wrongRoom = recordQuestEvent(held, HOLD_DEFS,
      { kind: 'surviveInSector', sectorTags: ['biome:stage_inferno'], seconds: 90 });
    expect(wrongRoom.states[0].stepProgress).toBe(0);

    const partial = recordQuestEvent(held, HOLD_DEFS,
      { kind: 'surviveInSector', sectorTags: ['boss-arena'], seconds: 40 });
    expect(partial.states[0].stepProgress).toBe(40);
    expect(partial.stepCompletions).toEqual([]);

    const restarted = recordQuestEvent(partial.states, HOLD_DEFS,
      { kind: 'surviveInSector', sectorTags: ['boss-arena'], seconds: 5 });
    expect(restarted.states[0].stepProgress).toBe(40);

    const done = recordQuestEvent(partial.states, HOLD_DEFS,
      { kind: 'surviveInSector', sectorTags: ['boss-arena'], seconds: 60 });
    expect(done.questCompletions).toEqual([{ questId: 'quest_hold', goldReward: 40 }]);
  });

  test('a hold step names a place, so it carries a marker like reachSector', () => {
    expect(buildQuestMarkers(held, HOLD_DEFS)).toEqual([
      { questId: 'quest_hold', label: 'Hold', icon: 'radar', sectorTag: 'boss-arena' },
    ]);
  });
});
