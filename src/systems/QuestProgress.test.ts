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
  loadQuestCargo,
  assignQuestDrone,
  dropQuestCargo,
  reclaimQuestCargo,
  buildQuestCargoDropObjectives,
  buildQuestCargoStatus,
  effectiveStepTarget,
  renderStepDescription,
  worldBoundStepProgress,
  dropStaleWorldBoundProgress,
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

  test('a solved ring counts for a cache step but a walk-in never counts for a ring step', () => {
    const RING_DEFS: readonly ExpeditionQuestDefinition[] = [{
      id: 'quest_ring',
      name: 'Ring',
      icon: 'chain',
      steps: [
        { id: 'q_ring.s1', description: 'find a cache', trigger: { kind: 'findSecret', secretKind: 'cache' }, target: 1, scope: 'run', goldReward: 11 },
        { id: 'q_ring.s2', description: 'solve a ring', trigger: { kind: 'findSecret', secretKind: 'puzzle' }, target: 1, scope: 'run', goldReward: 13 },
      ],
      completionGoldReward: 40,
    }];
    const sealed = recordQuestEvent([active('quest_ring')], RING_DEFS, { kind: 'findSecret', secretKind: 'puzzle' });
    expect(sealed.stepCompletions).toEqual([{ questId: 'quest_ring', stepId: 'q_ring.s1', goldReward: 11 }]);
    const walkIn = recordQuestEvent([active('quest_ring', 1)], RING_DEFS, { kind: 'findSecret', secretKind: 'cache' });
    expect(walkIn.states[0].stepProgress).toBe(0);
  });

  test('a region capstone counts for a cache step but a walk-in never counts for a capstone step', () => {
    const VAULT_DEFS: readonly ExpeditionQuestDefinition[] = [{
      id: 'quest_vault',
      name: 'Vault',
      icon: 'chain',
      steps: [
        { id: 'q_vault.s1', description: 'find a cache', trigger: { kind: 'findSecret', secretKind: 'cache' }, target: 1, scope: 'run', goldReward: 11 },
        { id: 'q_vault.s2', description: 'empty a region', trigger: { kind: 'findSecret', secretKind: 'capstone' }, target: 1, scope: 'run', goldReward: 13 },
      ],
      completionGoldReward: 40,
    }];
    const held = recordQuestEvent([active('quest_vault')], VAULT_DEFS, { kind: 'findSecret', secretKind: 'capstone' });
    expect(held.stepCompletions).toEqual([{ questId: 'quest_vault', stepId: 'q_vault.s1', goldReward: 11 }]);
    const walkIn = recordQuestEvent([active('quest_vault', 1)], VAULT_DEFS, { kind: 'findSecret', secretKind: 'cache' });
    expect(walkIn.states[0].stepProgress).toBe(0);
  });

  test('never mutates the states it was handed', () => {
    const states = [active('quest_a')];
    recordQuestEvent(states, DEFS, { kind: 'kill', amount: 10 });
    expect(states[0]).toEqual(active('quest_a'));
  });

  test('a completion carries its definition\'s relic roll and omits it otherwise', () => {
    const relicDefs: readonly ExpeditionQuestDefinition[] = [
      {
        id: 'quest_relic', name: 'R', icon: 'clipboard',
        steps: [{ id: 'q_relic.s1', description: 'kill 1', trigger: { kind: 'kill' }, target: 1, scope: 'run', goldReward: 1 }],
        completionGoldReward: 10,
        completionRelicRoll: true,
      },
      {
        id: 'quest_plain', name: 'P', icon: 'clipboard',
        steps: [{ id: 'q_plain.s1', description: 'kill 1', trigger: { kind: 'kill' }, target: 1, scope: 'run', goldReward: 1 }],
        completionGoldReward: 10,
      },
    ];
    const done = recordQuestEvent(
      [active('quest_relic'), active('quest_plain')], relicDefs, { kind: 'kill', amount: 1 },
    );
    expect(done.questCompletions.find((entry) => entry.questId === 'quest_relic')?.relicRoll).toBe(true);
    expect(done.questCompletions.find((entry) => entry.questId === 'quest_plain')?.relicRoll).toBeUndefined();
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
    const views = buildQuestStepViews([active('quest_a', 0, 4), active('quest_b', 0, 99)], DEFS, 'w1');
    expect(views).toEqual([
      { questId: 'quest_a', questName: 'A', stepDescription: 'kill 10', progress: 4, target: 10, stepNumber: 1, stepCount: 2, stepGoldReward: 5, chainGoldRemaining: 32 },
      { questId: 'quest_b', questName: 'B', stepDescription: 'open 2', progress: 2, target: 2, stepNumber: 1, stepCount: 1, stepGoldReward: 9, chainGoldRemaining: 39 },
    ]);
  });

  test('reports the chain position of a later step', () => {
    const views = buildQuestStepViews([active('quest_a', 1, 2)], DEFS, 'w1');
    expect(views[0]).toMatchObject({ stepDescription: 'depth 3', stepNumber: 2, stepCount: 2 });
  });

  test('omits completed quests and states the catalog no longer resolves', () => {
    const states: QuestInstanceState[] = [
      { questId: 'quest_a', stepIndex: 2, stepProgress: 0, status: 'complete' },
      { questId: 'quest_gone', stepIndex: 0, stepProgress: 1, status: 'active' },
      { questId: 'quest_b', stepIndex: 7, stepProgress: 1, status: 'active' },
    ];
    expect(buildQuestStepViews(states, DEFS, 'w1')).toEqual([]);
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
    expect(buildQuestMarkers(held, PLACE_DEFS, 'w1')).toEqual([
      { questId: 'quest_place', label: 'Place', icon: 'radar', sectorTag: 'boss-arena' },
    ]);
    expect(buildQuestMarkers([active('quest_a', 0, 0)], DEFS, 'w1')).toEqual([]);
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
    expect(buildQuestMarkers(held, HOLD_DEFS, 'w1')).toEqual([
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

describe('deliverItem', () => {
  const CARGO_DEFS: readonly ExpeditionQuestDefinition[] = [{
    id: 'quest_run',
    name: 'Run',
    icon: 'clipboard',
    steps: [{
      id: 'quest_run.s1',
      description: 'carry it out',
      trigger: { kind: 'deliverItem', itemId: 'cargo_test_core', destinationTag: 'boss-arena' },
      target: 1,
      scope: 'run',
      goldReward: 50,
    }],
    completionGoldReward: 100,
  }];
  const held: QuestInstanceState[] = [
    { questId: 'quest_run', stepIndex: 0, stepProgress: 0, status: 'active' },
  ];

  test('an arrival with an empty hold is not a delivery', () => {
    const result = recordQuestEvent(held, CARGO_DEFS,
      { kind: 'deliverItem', sectorTags: ['boss-arena'] });
    expect(result.stepCompletions).toEqual([]);
    expect(result.states[0].stepProgress).toBe(0);
  });

  test('a crate aboard completes the step at the destination and is spent doing it', () => {
    const loadedStates = loadQuestCargo(held, CARGO_DEFS).states;
    expect(loadedStates[0].cargoHeld).toBe(true);
    const wrongPlace = recordQuestEvent(loadedStates, CARGO_DEFS,
      { kind: 'deliverItem', sectorTags: ['biome:stage_ion_field'] });
    expect(wrongPlace.stepCompletions).toEqual([]);
    expect(wrongPlace.states[0].cargoHeld).toBe(true);
    const delivered = recordQuestEvent(loadedStates, CARGO_DEFS,
      { kind: 'deliverItem', sectorTags: ['boss-arena'] });
    expect(delivered.questCompletions).toEqual([{ questId: 'quest_run', goldReward: 100 }]);
    expect(delivered.states[0].cargoHeld).toBeUndefined();
  });

  test('the death rule drops a crate even though the counter never moved', () => {
    const loadedStates = loadQuestCargo(held, CARGO_DEFS).states;
    expect(settleRunScopeProgress(loadedStates, CARGO_DEFS)[0].cargoHeld).toBeUndefined();
  });

  test('loading is idempotent and only ever loads an active delivery step', () => {
    const first = loadQuestCargo(held, CARGO_DEFS);
    expect(first.loaded).toEqual([{ questId: 'quest_run', itemId: 'cargo_test_core' }]);
    const second = loadQuestCargo(first.states, CARGO_DEFS);
    expect(second.loaded).toEqual([]);
    expect(second.aboard).toEqual([{ questId: 'quest_run', itemId: 'cargo_test_core' }]);
    expect(loadQuestCargo([active('quest_a', 0, 0)], DEFS).loaded).toEqual([]);
  });

  describe('cargo dropped where the run died', () => {
    const DROP = { worldStamp: 'seed:v9', sectorKey: '3,-2', x: 1234, y: -567 };

    test('survives the run-scope settle and comes back aboard on reclaim', () => {
      const loadedStates = loadQuestCargo(held, CARGO_DEFS).states;
      const dropped = dropQuestCargo(loadedStates, CARGO_DEFS, DROP);
      expect(dropped.dropped).toHaveLength(1);
      expect(dropped.states[0].cargoHeld).toBeUndefined();
      expect(dropped.states[0].cargoDrop).toEqual(DROP);

      const settled = settleRunScopeProgress(dropped.states, CARGO_DEFS);
      expect(settled[0].cargoDrop).toEqual(DROP);

      expect(buildQuestCargoDropObjectives(settled, CARGO_DEFS, 'seed:v9')).toHaveLength(1);

      const back = reclaimQuestCargo(settled, CARGO_DEFS, settled[0].questId);
      expect(back.reclaimed?.itemId).toBe('cargo_test_core');
      expect(back.states[0].cargoHeld).toBe(true);
      expect(back.states[0].cargoDrop).toBeUndefined();
    });

    test('ignores a drop taken in another world', () => {
      const loadedStates = loadQuestCargo(held, CARGO_DEFS).states;
      const dropped = dropQuestCargo(loadedStates, CARGO_DEFS, DROP);
      expect(buildQuestCargoDropObjectives(dropped.states, CARGO_DEFS, 'other:v9')).toHaveLength(0);
      expect(buildQuestMarkers(dropped.states, CARGO_DEFS, 'other:v9')
        .some((marker) => marker.sectorKey !== undefined)).toBe(false);
      expect(buildQuestMarkers(dropped.states, CARGO_DEFS, 'seed:v9')
        .some((marker) => marker.sectorKey === '3,-2')).toBe(true);
    });
  });
});

describe('buildQuestCargoStatus', () => {
  const WORLD_STAMP = '20260727:v1';
  const CARGO_DEFS: readonly ExpeditionQuestDefinition[] = [{
    id: 'quest_run',
    name: 'Run',
    icon: 'clipboard',
    steps: [{
      id: 'quest_run.s1',
      description: 'carry it out',
      trigger: { kind: 'deliverItem', itemId: 'cargo_test_core', destinationTag: 'boss-arena' },
      target: 1,
      scope: 'run',
      goldReward: 50,
    }],
    completionGoldReward: 100,
  }];
  const held: QuestInstanceState[] = [
    { questId: 'quest_run', stepIndex: 0, stepProgress: 0, status: 'active' },
  ];
  const dropAt = (worldStamp: string): QuestInstanceState[] =>
    dropQuestCargo(loadQuestCargo(held, CARGO_DEFS).states, CARGO_DEFS,
      { worldStamp, sectorKey: '3,-2', x: 1234, y: -567 }).states;

  test('a crate aboard is aboard and never pending', () => {
    const status = buildQuestCargoStatus(
      loadQuestCargo(held, CARGO_DEFS).states, CARGO_DEFS, WORLD_STAMP,
    );
    expect(status.aboard).toEqual([{ questId: 'quest_run', itemId: 'cargo_test_core' }]);
    expect(status.pending).toEqual([]);
  });

  test('a delivery with no crate anywhere is pending', () => {
    const status = buildQuestCargoStatus(held, CARGO_DEFS, WORLD_STAMP);
    expect(status.pending).toEqual([{ questId: 'quest_run', itemId: 'cargo_test_core' }]);
    expect(status.aboard).toEqual([]);
  });

  test('a crate lying in this world is neither pending nor aboard', () => {
    const status = buildQuestCargoStatus(dropAt(WORLD_STAMP), CARGO_DEFS, WORLD_STAMP);
    expect(status.pending).toEqual([]);
    expect(status.aboard).toEqual([]);
  });

  test('a crate lying in another world is pending again', () => {
    const status = buildQuestCargoStatus(dropAt('other:v9'), CARGO_DEFS, WORLD_STAMP);
    expect(status.pending).toEqual([{ questId: 'quest_run', itemId: 'cargo_test_core' }]);
    expect(status.aboard).toEqual([]);
  });
});

describe('escortDrone', () => {
  const ESCORT_DEFS: readonly ExpeditionQuestDefinition[] = [
    {
      id: 'quest_escort',
      name: 'Escort',
      icon: 'rocket',
      steps: [
        { id: 'q_escort.s1', description: 'escort', trigger: { kind: 'escortDrone', droneId: 'drone_test', destinationTag: 'biome:stage_inferno' }, target: 1, scope: 'run', goldReward: 15 },
      ],
      completionGoldReward: 25,
    },
  ];
  const held: QuestInstanceState[] = [
    { questId: 'quest_escort', stepIndex: 0, stepProgress: 0, status: 'active' },
  ];

  test('arriving with a drone completes the step and spends it', () => {
    const assignedStates = assignQuestDrone(held, ESCORT_DEFS).states;
    expect(assignedStates[0].droneEscorting).toBe(true);
    const arrived = recordQuestEvent(assignedStates, ESCORT_DEFS,
      { kind: 'escortDrone', sectorTags: ['biome:stage_inferno'] });
    expect(arrived.stepCompletions)
      .toEqual([{ questId: 'quest_escort', stepId: 'q_escort.s1', goldReward: 15 }]);
    expect(arrived.states[0].droneEscorting).toBeUndefined();
  });

  test('arriving with no drone counts nothing', () => {
    const result = recordQuestEvent(held, ESCORT_DEFS,
      { kind: 'escortDrone', sectorTags: ['biome:stage_inferno'] });
    expect(result.stepCompletions).toEqual([]);
    expect(result.states[0].stepProgress).toBe(0);
  });

  test('the death rule drops an assigned drone even though the counter never moved', () => {
    const assignedStates = assignQuestDrone(held, ESCORT_DEFS).states;
    expect(settleRunScopeProgress(assignedStates, ESCORT_DEFS)[0].droneEscorting).toBeUndefined();
  });

  test('assigning is idempotent and reports a drone already under way', () => {
    const first = assignQuestDrone(held, ESCORT_DEFS);
    expect(first.assigned).toEqual([{ questId: 'quest_escort', droneId: 'drone_test' }]);
    expect(first.active).toEqual([]);
    const second = assignQuestDrone(first.states, ESCORT_DEFS);
    expect(second.assigned).toEqual([]);
    expect(second.active).toEqual([{ questId: 'quest_escort', droneId: 'drone_test' }]);
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
    expect(entries[0]).toMatchObject({ status: 'available', acceptable: true, progress: 1, goldRemaining: 39 });
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

describe('world-aware reachSector targets', () => {
  const SUPPLY = { anyTag: 45, byTag: { 'biome:stage_inferno': 4, 'boss-arena': 1 } };
  const SWEEP: readonly ExpeditionQuestDefinition[] = [{
    id: 'quest_sweep',
    name: 'Sweep',
    icon: 'radar',
    steps: [{
      id: 'q_sweep.s1',
      description: 'Survey {target} sectors of the Inferno',
      trigger: { kind: 'reachSector', sectorTag: 'biome:stage_inferno' },
      target: 6,
      scope: 'persistent',
      goldReward: 10,
    }],
    completionGoldReward: 20,
  }];

  const walk = (rooms: number) => {
    let states: QuestInstanceState[] =
      [{ questId: 'quest_sweep', stepIndex: 0, stepProgress: 0, status: 'active' }];
    let completions = 0;
    for (let room = 0; room < rooms; room += 1) {
      const result = recordQuestEvent(states, SWEEP, {
        kind: 'reachSector',
        sectorKey: `${room},0`,
        sectorTags: ['biome:stage_inferno'],
        worldStamp: 'w1',
      }, SUPPLY);
      states = result.states;
      completions += result.stepCompletions.length;
    }
    return { states, completions };
  };

  test('a step completes at what the world supplies, not at the authored target', () => {
    expect(walk(3).completions).toBe(0);
    const done = walk(4);
    expect(done.completions).toBe(1);
    expect(done.states[0].status).toBe('complete');
  });

  test('the authored target stands when no world is bound', () => {
    const result = recordQuestEvent(
      [{ questId: 'quest_sweep', stepIndex: 0, stepProgress: 0, status: 'active' }],
      SWEEP,
      { kind: 'reachSector', sectorKey: '0,0', sectorTags: ['biome:stage_inferno'], worldStamp: 'w1' },
      null,
    );
    expect(result.stepCompletions).toHaveLength(0);
    expect(effectiveStepTarget(SWEEP[0].steps[0], null)).toBe(6);
  });

  test('a tag the world has none of floors at 1 rather than paying out for nothing', () => {
    const empty = { anyTag: 45, byTag: {} };
    expect(effectiveStepTarget(SWEEP[0].steps[0], empty)).toBe(1);
    const result = recordQuestEvent(
      [{ questId: 'quest_sweep', stepIndex: 0, stepProgress: 0, status: 'active' }],
      SWEEP,
      { kind: 'kill', amount: 1 },
      empty,
    );
    expect(result.stepCompletions).toHaveLength(0);
  });

  test('the view reads the clamped number in both its text and its target', () => {
    const views = buildQuestStepViews(
      [{ questId: 'quest_sweep', stepIndex: 0, stepProgress: 0, status: 'active' }],
      SWEEP, 'w1', SUPPLY);
    expect(views[0].target).toBe(4);
    expect(views[0].stepDescription).toBe('Survey 4 sectors of the Inferno');
    expect(renderStepDescription(SWEEP[0].steps[0], 6)).toBe('Survey 6 sectors of the Inferno');
  });
});

describe('conquerWorld trigger', () => {
  const WARDEN_DEFS: readonly ExpeditionQuestDefinition[] = [
    {
      id: 'quest_w',
      name: 'W',
      icon: 'crown',
      steps: [
        { id: 'q_w.s1', description: 'any two', trigger: { kind: 'conquerWorld' }, target: 2, scope: 'persistent', goldReward: 5 },
      ],
      completionGoldReward: 10,
    },
    {
      id: 'quest_v',
      name: 'V',
      icon: 'skull',
      steps: [
        { id: 'q_v.s1', description: 'two distinct', trigger: { kind: 'conquerWorld', distinctWorlds: true }, target: 2, scope: 'persistent', goldReward: 5 },
      ],
      completionGoldReward: 10,
    },
  ];

  const activeStates = (): QuestInstanceState[] => [
    { questId: 'quest_w', stepIndex: 0, stepProgress: 0, status: 'active' },
    { questId: 'quest_v', stepIndex: 0, stepProgress: 0, status: 'active' },
  ];

  test('a re-conquest counts for a plain step and not for a distinctWorlds one', () => {
    const first = recordQuestEvent(activeStates(), WARDEN_DEFS,
      { kind: 'conquerWorld', firstConquest: true });
    expect(first.states.map((state) => state.stepProgress)).toEqual([1, 1]);

    const again = recordQuestEvent(first.states, WARDEN_DEFS,
      { kind: 'conquerWorld', firstConquest: false });
    // The plain step counted the re-win, so it hit its target of 2 and reset on completion;
    // the distinctWorlds step ignored it and is still one short.
    expect(again.states.map((state) => state.stepProgress)).toEqual([0, 1]);
    expect(again.questCompletions.map((entry) => entry.questId)).toEqual(['quest_w']);
  });

  test('a live conquest step pins the boss arena', () => {
    const markers = buildQuestMarkers(activeStates(), WARDEN_DEFS, '1:v1');
    expect(markers.map((marker) => marker.sectorTag)).toEqual(['boss-arena', 'boss-arena']);
  });
});

describe('worldBoundStepProgress and dropStaleWorldBoundProgress', () => {
  const SWEEP_DEFS: readonly ExpeditionQuestDefinition[] = [{
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

  const swept = (worldStamp: string, rooms: readonly string[]): QuestInstanceState[] => ([{
    questId: 'quest_cross',
    stepIndex: 0,
    stepProgress: rooms.length,
    status: 'active',
    visitedSectorKeys: [...rooms],
    visitedWorldStamp: worldStamp,
  }]);

  test('reports only an active room sweep that has counted something, with its world', () => {
    expect(worldBoundStepProgress(swept('w1', ['1,0', '2,0']), SWEEP_DEFS)).toEqual([{
      questId: 'quest_cross',
      questName: 'Cross',
      stepDescription: renderStepDescription(SWEEP_DEFS[0].steps[0], 3),
      roomsCounted: 2,
      worldStamp: 'w1',
    }]);

    expect(worldBoundStepProgress(swept('w1', []), SWEEP_DEFS)).toEqual([]);
    const complete = swept('w1', ['1,0']);
    complete[0].status = 'complete';
    expect(worldBoundStepProgress(complete, SWEEP_DEFS)).toEqual([]);
  });

  test('drops a sweep counted in another world and leaves this world\'s alone', () => {
    const stale = dropStaleWorldBoundProgress(swept('w1', ['1,0', '2,0']), SWEEP_DEFS, 'w2');
    expect(stale.dropped.map((row) => row.roomsCounted)).toEqual([2]);
    expect(stale.states[0].stepProgress).toBe(0);
    expect(stale.states[0].visitedSectorKeys).toBeUndefined();
    expect(stale.states[0].visitedWorldStamp).toBeUndefined();

    const live = dropStaleWorldBoundProgress(swept('w1', ['1,0', '2,0']), SWEEP_DEFS, 'w1');
    expect(live.dropped).toEqual([]);
    expect(live.states[0].stepProgress).toBe(2);
    expect(live.states[0].visitedSectorKeys).toEqual(['1,0', '2,0']);
  });
});
