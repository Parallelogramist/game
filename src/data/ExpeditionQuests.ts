/**
 * Expedition quest chains: multi-step objectives that span runs (doc 04 section 4).
 *
 * Distinct from DailyQuests (single-day run aggregates) and in-run bounties (one rotating
 * objective): these keep a step index across deaths and hand off to a successor quest.
 *
 * Pure data. The state machine is src/systems/QuestProgress.ts and the store is
 * src/meta/ExpeditionQuestManager.ts.
 */

/**
 * A trigger names WHICH signal a step listens to. The four kinds here are the four the
 * game already emits; doc 04's other four (findSecret, surviveInSector, escortDrone,
 * deliverItem) have no producer yet and are deliberately absent rather than inert.
 */
export type QuestTrigger =
  | { kind: 'kill' }
  | { kind: 'reachDepth' }
  | { kind: 'openGate' }
  | { kind: 'claimAbility'; abilityId?: string };

export interface ExpeditionQuestStep {
  readonly id: string;
  readonly description: string;
  readonly trigger: QuestTrigger;
  readonly target: number;
  /** 'run' counters reset when the next expedition starts; 'persistent' ones never do. */
  readonly scope: 'run' | 'persistent';
  readonly goldReward: number;
}

export interface ExpeditionQuestDefinition {
  readonly id: string;
  readonly name: string;
  /** ICON_MAP key, asserted by referentialIntegrity.test.ts. */
  readonly icon: string;
  readonly steps: readonly ExpeditionQuestStep[];
  readonly completionGoldReward: number;
  /** Chain link. Resolved + asserted acyclic by referentialIntegrity.test.ts. */
  readonly nextQuestId?: string;
  /** Completing this quest hands the profile a key that opens the world's KeyDoor edges
   *  carrying this id. Fed to the generator as WorldGenInputs.questKeyOrder. */
  readonly grantsKeyId?: string;
}

export const EXPEDITION_QUESTS: readonly ExpeditionQuestDefinition[] = [
  {
    id: 'quest_survey_01',
    name: 'Shakedown Run',
    icon: 'clipboard',
    steps: [
      {
        id: 'q_survey_01.s1',
        description: 'Destroy 150 hostiles on one expedition',
        trigger: { kind: 'kill' },
        target: 150,
        scope: 'run',
        goldReward: 60,
      },
      {
        id: 'q_survey_01.s2',
        description: 'Fly two sectors out from the hangar',
        trigger: { kind: 'reachDepth' },
        target: 2,
        scope: 'run',
        goldReward: 80,
      },
    ],
    completionGoldReward: 120,
    grantsKeyId: 'quest_key_survey',
    nextQuestId: 'quest_survey_02',
  },
  {
    id: 'quest_survey_02',
    name: 'Deep Survey',
    icon: 'telescope',
    steps: [
      {
        id: 'q_survey_02.s1',
        description: 'Fly four sectors out from the hangar',
        trigger: { kind: 'reachDepth' },
        target: 4,
        scope: 'run',
        goldReward: 120,
      },
      {
        id: 'q_survey_02.s2',
        description: 'Destroy 400 hostiles across your expeditions',
        trigger: { kind: 'kill' },
        target: 400,
        scope: 'persistent',
        goldReward: 150,
      },
    ],
    completionGoldReward: 200,
    nextQuestId: 'quest_survey_03',
  },
  {
    id: 'quest_survey_03',
    name: 'Vault Warden',
    icon: 'crown',
    steps: [
      {
        id: 'q_survey_03.s1',
        description: 'Claim a traversal ability from a vault',
        trigger: { kind: 'claimAbility' },
        target: 1,
        scope: 'persistent',
        goldReward: 200,
      },
      {
        id: 'q_survey_03.s2',
        description: 'Open three sealed doors with your abilities',
        trigger: { kind: 'openGate' },
        target: 3,
        scope: 'persistent',
        goldReward: 200,
      },
    ],
    completionGoldReward: 350,
  },
  {
    id: 'quest_gatecrash_01',
    name: 'Gatecrasher',
    icon: 'radar',
    steps: [
      {
        id: 'q_gatecrash_01.s1',
        description: 'Open a sealed door on one expedition',
        trigger: { kind: 'openGate' },
        target: 1,
        scope: 'run',
        goldReward: 80,
      },
      {
        id: 'q_gatecrash_01.s2',
        description: 'Fly three sectors out on that same expedition',
        trigger: { kind: 'reachDepth' },
        target: 3,
        scope: 'run',
        goldReward: 100,
      },
    ],
    completionGoldReward: 150,
    grantsKeyId: 'quest_key_gatecrash',
    nextQuestId: 'quest_gatecrash_02',
  },
  {
    id: 'quest_gatecrash_02',
    name: 'Long Haul',
    icon: 'rocket',
    steps: [
      {
        id: 'q_gatecrash_02.s1',
        description: 'Destroy 1000 hostiles across your expeditions',
        trigger: { kind: 'kill' },
        target: 1000,
        scope: 'persistent',
        goldReward: 250,
      },
    ],
    completionGoldReward: 300,
  },
];

export function getExpeditionQuest(questId: string): ExpeditionQuestDefinition | undefined {
  return EXPEDITION_QUESTS.find((quest) => quest.id === questId);
}

/** The generation input the expedition world consumes as WorldGenInputs.questKeyOrder.
 *  Catalog order, so a key's door placement is stable while the catalog is. */
export const EXPEDITION_QUEST_KEY_ORDER: readonly string[] = EXPEDITION_QUESTS
  .map((quest) => quest.grantsKeyId)
  .filter((keyId): keyId is string => keyId !== undefined);

/** The quest a sealed door should name. Undefined for a key no quest grants, which
 *  referentialIntegrity.test.ts forbids. */
export function getQuestForKeyId(keyId: string): ExpeditionQuestDefinition | undefined {
  return EXPEDITION_QUESTS.find((quest) => quest.grantsKeyId === keyId);
}
