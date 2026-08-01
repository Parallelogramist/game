import { describe, test, expect } from 'vitest';
import {
  acceptQuest,
  recordQuestEvent,
  seedQuestStates,
  setQuestAside,
  settleRunScopeProgress,
  buildQuestBoardEntries,
  buildQuestStepViews,
  buildQuestMarkers,
  buildQuestHoldObjectives,
  buildQuestHazardObjectives,
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
      { kind: 'reachSector', sectorKey: '1,0', sectorTags: ['biome:stage_inferno'], worldStamp: 'w1' });
    expect(miss.stepCompletions).toEqual([]);
    const hit = recordQuestEvent(held, PLACE_DEFS,
      { kind: 'reachSector', sectorKey: '2,0', sectorTags: ['biome:stage_inferno', 'boss-arena'], worldStamp: 'w1' });
    expect(hit.questCompletions).toEqual([{ questId: 'quest_place', goldReward: 50 }]);
  });

  test('markers carry only the quests whose current step names a place', () => {
    expect(buildQuestMarkers(held, PLACE_DEFS)).toEqual([
      { questId: 'quest_place', label: 'Place', icon: 'radar', sectorTag: 'boss-arena' },
    ]);
    expect(buildQuestMarkers([active('quest_a', 0, 0)], DEFS)).toEqual([]);
  });

  test('counts distinct rooms, so a re-entry adds nothing and a tagless step counts any sector', () => {
    const SWEEP_DEFS: readonly ExpeditionQuestDefinition[] = [{
      id: 'quest_sweep',
      name: 'Sweep',
      icon: 'radar',
      steps: [{
        id: 'q_sweep.s1',
        description: 'survey three rooms',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_inferno' },
        target: 3,
        scope: 'run',
        goldReward: 17,
      }],
      completionGoldReward: 60,
    }];
    const sweeping: QuestInstanceState[] = [
      { questId: 'quest_sweep', stepIndex: 0, stepProgress: 0, status: 'active' },
    ];
    const enter = (states: QuestInstanceState[], sectorKey: string) => recordQuestEvent(
      states, SWEEP_DEFS,
      { kind: 'reachSector', sectorKey, sectorTags: ['biome:stage_inferno'], worldStamp: 'w1' },
    );

    const first = enter(sweeping, '1,0');
    expect(first.states[0].stepProgress).toBe(1);
    const again = enter(first.states, '1,0');
    expect(again.states[0].stepProgress).toBe(1);
    const second = enter(again.states, '2,0');
    expect(second.states[0].stepProgress).toBe(2);
    const done = enter(second.states, '3,0');
    expect(done.questCompletions).toEqual([{ questId: 'quest_sweep', goldReward: 60 }]);
    expect(done.states[0].visitedSectorKeys).toBeUndefined();

    const TAGLESS_DEFS: readonly ExpeditionQuestDefinition[] = [{
      ...SWEEP_DEFS[0],
      steps: [{ ...SWEEP_DEFS[0].steps[0], trigger: { kind: 'reachSector' }, target: 2 }],
    }];
    const anyRoom = recordQuestEvent(sweeping, TAGLESS_DEFS,
      { kind: 'reachSector', sectorKey: '9,9', sectorTags: ['biome:stage_verdant_rot'], worldStamp: 'w1' });
    expect(anyRoom.states[0].stepProgress).toBe(1);
  });

  test('drops the rooms counted in another world, so a regenerated map cannot over-credit', () => {
    const CROSS_RUN_DEFS: readonly ExpeditionQuestDefinition[] = [{
      id: 'quest_cross',
      name: 'Cross',
      icon: 'radar',
      steps: [{
        id: 'q_cross.s1',
        description: 'survey three rooms across expeditions',
        trigger: { kind: 'reachSector' },
        target: 3,
        scope: 'persistent',
        goldReward: 19,
      }],
      completionGoldReward: 70,
    }];
    const enter = (states: QuestInstanceState[], sectorKey: string, worldStamp: string) =>
      recordQuestEvent(states, CROSS_RUN_DEFS,
        { kind: 'reachSector', sectorKey, sectorTags: [], worldStamp });

    const start: QuestInstanceState[] = [
      { questId: 'quest_cross', stepIndex: 0, stepProgress: 0, status: 'active' },
    ];
    const oldWorld = enter(enter(start, '1,0', 'w1').states, '2,0', 'w1');
    expect(oldWorld.states[0].stepProgress).toBe(2);

    const newWorld = enter(oldWorld.states, '1,0', 'w2');
    expect(newWorld.states[0].stepProgress).toBe(1);
    expect(newWorld.states[0].visitedSectorKeys).toEqual(['1,0']);
    expect(newWorld.states[0].visitedWorldStamp).toBe('w2');
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

  test('a hold objective carries the step target, and a non-hold step is not one', () => {
    expect(buildQuestHoldObjectives(held, HOLD_DEFS)).toEqual([
      { questId: 'quest_hold', sectorTag: 'boss-arena', target: 60 },
    ]);
    expect(buildQuestHoldObjectives(
      [{ questId: 'quest_a', stepIndex: 0, stepProgress: 0, status: 'active' }],
      DEFS,
    )).toEqual([]);
  });
});

describe('clearHazard', () => {
  const HAZARD_DEFS: readonly ExpeditionQuestDefinition[] = [
    {
      id: 'quest_hive',
      name: 'Hive',
      icon: 'spikes',
      steps: [{
        id: 'q_hive.s1',
        description: 'clear 2 hives',
        trigger: { kind: 'clearHazard', hazardKind: 'nest' },
        target: 2,
        scope: 'run',
        goldReward: 19,
      }],
      completionGoldReward: 70,
    },
    {
      id: 'quest_purge',
      name: 'Purge',
      icon: 'skull',
      steps: [{
        id: 'q_purge.s1',
        description: 'clear 2 risk rooms',
        trigger: { kind: 'clearHazard' },
        target: 2,
        scope: 'persistent',
        goldReward: 23,
      }],
      completionGoldReward: 80,
    },
  ];
  const held = (questId: string): QuestInstanceState[] =>
    [{ questId, stepIndex: 0, stepProgress: 0, status: 'active' }];

  test('a hazard trigger matches only its named risk room', () => {
    const wrong = recordQuestEvent(held('quest_hive'), HAZARD_DEFS,
      { kind: 'clearHazard', hazardKind: 'lair' });
    expect(wrong.states[0].stepProgress).toBe(0);
    const right = recordQuestEvent(held('quest_hive'), HAZARD_DEFS,
      { kind: 'clearHazard', hazardKind: 'nest' });
    expect(right.states[0].stepProgress).toBe(1);
  });

  test('a hazard trigger naming no kind counts either fight', () => {
    const first = recordQuestEvent(held('quest_purge'), HAZARD_DEFS,
      { kind: 'clearHazard', hazardKind: 'nest' });
    expect(first.states[0].stepProgress).toBe(1);
    const second = recordQuestEvent(first.states, HAZARD_DEFS,
      { kind: 'clearHazard', hazardKind: 'lair' });
    expect(second.questCompletions).toEqual([{ questId: 'quest_purge', goldReward: 80 }]);
  });
});

describe('the quest board', () => {
  test('refuses an accept at the cap and takes it once a slot is freed', () => {
    const held: QuestInstanceState[] = [active('quest_a'), active('quest_c'), active('quest_d')];
    const refused = acceptQuest(held, DEFS, 'quest_e', 3);
    expect(refused.accepted).toBe(false);
    expect(refused.states).toHaveLength(3);

    const freed = setQuestAside(held, DEFS, 'quest_a');
    expect(freed.changed).toBe(true);
    const taken = acceptQuest(freed.states, DEFS, 'quest_e', 3);
    expect(taken.accepted).toBe(true);
    expect(taken.states.find((state) => state.questId === 'quest_e')?.status).toBe('active');
    expect(taken.states.find((state) => state.questId === 'quest_a')?.status).toBe('available');
  });

  test('setting aside keeps a persistent counter and clears a run counter', () => {
    // quest_a step 0 is 'run', step 1 is 'persistent'.
    const runScope = setQuestAside([active('quest_a', 0, 7)], DEFS, 'quest_a');
    expect(runScope.states[0]).toMatchObject({ status: 'available', stepIndex: 0, stepProgress: 0 });

    const persistent = setQuestAside([active('quest_a', 1, 2)], DEFS, 'quest_a');
    expect(persistent.states[0]).toMatchObject({ status: 'available', stepIndex: 1, stepProgress: 2 });

    const resumed = acceptQuest(persistent.states, DEFS, 'quest_a', 3);
    expect(resumed.states[0]).toMatchObject({ status: 'active', stepIndex: 1, stepProgress: 2 });
  });

  test('offers every head plus held chains, and sinks complete ones to the end', () => {
    const states: QuestInstanceState[] = [
      { questId: 'quest_a', stepIndex: 2, stepProgress: 0, status: 'complete' },
      { questId: 'quest_b', stepIndex: 0, stepProgress: 1, status: 'available' },
    ];
    const entries = buildQuestBoardEntries(states, DEFS, 3);
    // quest_b is a successor, listed only because it is held; quest_a sinks for being complete.
    expect(entries.map((entry) => entry.questId))
      .toEqual(['quest_b', 'quest_c', 'quest_d', 'quest_e', 'quest_a']);
    expect(entries[0]).toMatchObject({ status: 'available', acceptable: true, progress: 1 });
    expect(entries[entries.length - 1]).toMatchObject({ status: 'complete', acceptable: false, goldRemaining: 0 });
  });
});

describe('buildQuestHazardObjectives', () => {
  const HAZARD_DEFS: readonly ExpeditionQuestDefinition[] = [
    {
      id: 'quest_nest',
      name: 'Nest',
      icon: 'radar',
      steps: [{
        id: 'q_nest.s1',
        description: 'clear hives',
        trigger: { kind: 'clearHazard', hazardKind: 'nest' },
        target: 2,
        scope: 'run',
        goldReward: 10,
      }],
      completionGoldReward: 20,
    },
    {
      id: 'quest_lair',
      name: 'Lair',
      icon: 'radar',
      steps: [{
        id: 'q_lair.s1',
        description: 'kill the hunter at its den',
        trigger: { kind: 'clearHazard', hazardKind: 'lair' },
        target: 1,
        scope: 'persistent',
        goldReward: 10,
      }],
      completionGoldReward: 20,
    },
    {
      id: 'quest_any',
      name: 'Any',
      icon: 'radar',
      steps: [{
        id: 'q_any.s1',
        description: 'clear risk rooms',
        trigger: { kind: 'clearHazard' },
        target: 10,
        scope: 'persistent',
        goldReward: 10,
      }],
      completionGoldReward: 20,
    },
  ];

  test('carries nest and breadth steps, never a lair and never a non-hazard step', () => {
    const held = [active('quest_nest'), active('quest_lair'), active('quest_any')];
    expect(buildQuestHazardObjectives(held, HAZARD_DEFS)).toEqual([
      { questId: 'quest_nest', label: 'Nest' },
      { questId: 'quest_any', label: 'Any' },
    ]);
    expect(buildQuestHazardObjectives([active('quest_a', 0, 0)], DEFS)).toEqual([]);
  });
});
