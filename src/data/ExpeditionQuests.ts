import type { SecretTier } from '../world/secretRewards';
import type { SectorTag } from '../world/sectorTags';

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
 * A trigger names WHICH signal a step listens to. The seven kinds here are the seven the game
 * emits; doc 04's other two (escortDrone, deliverItem) have no producer yet and are
 * deliberately absent rather than inert.
 */
export type QuestTrigger =
  | { kind: 'kill' }
  | { kind: 'reachDepth' }
  | { kind: 'openGate' }
  | { kind: 'claimAbility'; abilityId?: string }
  /** Doc 04 authors this as `secretId?`, but a secret's id is generated per world
   *  (`poi:12,-3:0`), so a static catalog can only name the KIND of find. */
  | { kind: 'findSecret'; secretKind?: SecretTier }
  /** Doc 04 authors this as `sectorTag: string`. The vocabulary is the closed two-family union
   *  in src/world/sectorTags.ts, and referentialIntegrity.test.ts asserts every biome tag
   *  resolves to a real stage, which the template-literal type cannot. Progress counts DISTINCT
   *  sectors, so a target above 1 asks for that many different rooms, and an omitted tag counts
   *  every sector, which is how a breadth step is authored. */
  | { kind: 'reachSector'; sectorTag?: SectorTag }
  /** Doc 04 authors a `seconds` field beside the step's own `target`. The target IS the dwell
   *  in seconds here: one threshold in two fields is two sources of truth, and the shipped
   *  ticker renders `42/90` off the target for free. */
  | { kind: 'surviveInSector'; sectorTag: SectorTag };

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
      {
        id: 'q_survey_03.s3',
        description: 'Chart the Ion Field, out past the crystal belt',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_ion_field' },
        target: 1,
        scope: 'persistent',
        goldReward: 220,
      },
      {
        id: 'q_survey_03.s4',
        description: 'Hold the Ion Field for 60 seconds without leaving',
        trigger: { kind: 'surviveInSector', sectorTag: 'biome:stage_ion_field' },
        target: 60,
        scope: 'run',
        goldReward: 240,
      },
      {
        id: 'q_survey_03.s5',
        description: 'Chart eight sectors on one expedition',
        trigger: { kind: 'reachSector' },
        target: 8,
        scope: 'run',
        goldReward: 240,
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
      {
        id: 'q_gatecrash_02.s2',
        description: "Chart the arena at the world's heart",
        trigger: { kind: 'reachSector', sectorTag: 'boss-arena' },
        target: 1,
        scope: 'persistent',
        goldReward: 200,
      },
      {
        id: 'q_gatecrash_02.s3',
        description: "Hold the arena at the world's heart for 90 seconds",
        trigger: { kind: 'surviveInSector', sectorTag: 'boss-arena' },
        target: 90,
        scope: 'run',
        goldReward: 260,
      },
      {
        id: 'q_gatecrash_02.s4',
        description: 'Survey three sectors of the Crystal Caves',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_crystal_caves' },
        target: 3,
        scope: 'run',
        goldReward: 240,
      },
    ],
    completionGoldReward: 300,
  },
  {
    id: 'quest_secret_01',
    name: 'Ghost Signals',
    icon: 'ghost',
    steps: [
      {
        id: 'q_secret_01.s1',
        description: 'Uncover two concealed caches on one expedition',
        trigger: { kind: 'findSecret', secretKind: 'cache' },
        target: 2,
        scope: 'run',
        goldReward: 90,
      },
      {
        id: 'q_secret_01.s2',
        description: 'Break into a hidden sector',
        trigger: { kind: 'findSecret', secretKind: 'hiddenSector' },
        target: 1,
        scope: 'persistent',
        goldReward: 140,
      },
    ],
    completionGoldReward: 180,
    nextQuestId: 'quest_secret_02',
  },
  {
    id: 'quest_secret_02',
    name: "Voidmason's Ledger",
    icon: 'crystal',
    steps: [
      {
        id: 'q_secret_02.s1',
        description: 'Uncover twelve secrets across your expeditions',
        trigger: { kind: 'findSecret' },
        target: 12,
        scope: 'persistent',
        goldReward: 200,
      },
      {
        id: 'q_secret_02.s2',
        description: 'Break into five hidden sectors across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'hiddenSector' },
        target: 5,
        scope: 'persistent',
        goldReward: 240,
      },
    ],
    completionGoldReward: 340,
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
