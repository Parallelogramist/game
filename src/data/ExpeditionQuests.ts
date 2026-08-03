import type { SecretTier } from '../world/secretRewards';
import type { SectorTag } from '../world/sectorTags';
import type { PoiHazardKind } from './PoiCatalog';

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
 * A trigger names WHICH signal a step listens to. All ten kinds have a producer: doc 04
 * section 4's list is closed by escortDrone, and clearHazard is an eleventh the game emits
 * that doc 04 predates.
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
   *  every sector, which is how a breadth step is authored. The visited set carries the world it
   *  was collected in, so a 'persistent' sweep may span expeditions without a regenerated world
   *  over-crediting it.
   *  A target is CLAMPED to what the world being flown holds (`effectiveStepTarget`), because a
   *  region's room count is a property of the seed: write `{target}` in the description of any
   *  step whose count could exceed a thin world's supply, or the text will name a number the
   *  step no longer asks for. */
  | { kind: 'reachSector'; sectorTag?: SectorTag }
  /** Doc 04 authors a `seconds` field beside the step's own `target`. The target IS the dwell
   *  in seconds here: one threshold in two fields is two sources of truth, and the shipped
   *  ticker renders `42/90` off the target for free. */
  | { kind: 'surviveInSector'; sectorTag: SectorTag }
  /** Doc 04 authors this as `{ itemId: string; destinationTag: string }`. The destination is the
   *  same closed two-family `SectorTag` union `reachSector` uses, and the crate is NOT a world
   *  entity: `cargoHeld` on the quest state is the whole of it, which is why this kind needed no
   *  persistence-exemption API and did not wait on FEAT-WORLDGEN-STREAM. A step's `target` is the
   *  number of deliveries, and each one spends the crate, so a second delivery needs a second
   *  load at a board. */
  | { kind: 'deliverItem'; itemId: string; destinationTag: SectorTag }
  /** Doc 04 authors this as `{ routeTag: string }`. **No `routeTag` vocabulary is invented**:
   *  the destination is the same closed two-family `SectorTag` union `reachSector` and
   *  `deliverItem` use, because a `SectorTag` is a compile error when mistyped and
   *  referentialIntegrity.test.ts can assert it resolves to a real stage, and a bare route
   *  string is neither. The drone is a scene Graphics object on the syncWardenThrone idiom, not
   *  an ECS entity, so like the delivery crate it needed no persistence-exemption API and did
   *  not wait on FEAT-WORLDGEN-STREAM. A step's `target` is the number of escorts, and each one
   *  spends the drone, so a second escort needs a second assignment at a board. */
  | { kind: 'escortDrone'; droneId: string; destinationTag: SectorTag }
  /** The two risk rooms (a523eca, 760ccc8). An omitted kind counts either fight, which is how a
   *  breadth step is authored; a named one counts only that one. Doc 04 lists nine kinds and
   *  this is not among them: the hive and the den were authored after that doc, and a trigger
   *  the game already emits beats a ninth that nothing produces. A hazard's ROOM is rolled per
   *  run into scene state, not into the catalog, so a step of this kind names no place and
   *  therefore produces no chart pin and no radar bearing. */
  | { kind: 'clearHazard'; hazardKind?: PoiHazardKind }
  /** The world's own boss, defeated. Doc 04 lists nine kinds and this is a twelfth, on the
   *  clearHazard precedent: a trigger for a signal the game already emits beats a kind nothing
   *  produces. The signal is GameScene.recordWorldConquered, the same false→true transition
   *  LifetimeStats.worldsConqueredTotal counts. `distinctWorlds` narrows a step to a world's
   *  FIRST conquest, which is what lets "two different worlds" be counted with no visited-set:
   *  a world can only be first-conquered once. */
  | { kind: 'conquerWorld'; distinctWorlds?: true };

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
  /** One roll on the STANDARD relic table when the quest completes (doc 04 section 4). Econ
   *  rule 1 is "more rolls, never better odds", so this pays through the unchanged draft the
   *  chest pipeline already uses and adds nothing to the gold budget. */
  readonly completionRelicRoll?: boolean;
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
      {
        id: 'q_survey_03.s6',
        description: 'Chart twenty rooms across your expeditions',
        trigger: { kind: 'reachSector' },
        target: 20,
        scope: 'persistent',
        goldReward: 260,
      },
      {
        id: 'q_survey_03.s7',
        description: 'Walk a survey probe into the Crystal Caves in one piece',
        trigger: {
          kind: 'escortDrone',
          droneId: 'drone_survey_probe',
          destinationTag: 'biome:stage_crystal_caves',
        },
        target: 1,
        scope: 'run',
        goldReward: 260,
      },
    ],
    completionGoldReward: 350,
    completionRelicRoll: true,
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
        description: 'Survey {target} sectors of the Crystal Caves',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_crystal_caves' },
        target: 3,
        scope: 'run',
        goldReward: 240,
      },
      {
        id: 'q_gatecrash_02.s5',
        description: 'Survey {target} sectors of the Inferno across your expeditions',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_inferno' },
        target: 6,
        scope: 'persistent',
        goldReward: 260,
      },
      {
        id: 'q_gatecrash_02.s6',
        description: 'Walk a breach drone into the Inferno in one piece',
        trigger: {
          kind: 'escortDrone',
          droneId: 'drone_breach_unit',
          destinationTag: 'biome:stage_inferno',
        },
        target: 1,
        scope: 'run',
        goldReward: 280,
      },
    ],
    completionGoldReward: 300,
    completionRelicRoll: true,
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
    grantsKeyId: 'quest_key_secret',
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
      {
        id: 'q_secret_02.s3',
        description: 'Carry a ledger core out to the Ion Field',
        trigger: {
          kind: 'deliverItem',
          itemId: 'cargo_ledger_core',
          destinationTag: 'biome:stage_ion_field',
        },
        target: 1,
        scope: 'run',
        goldReward: 240,
      },
    ],
    completionGoldReward: 340,
    completionRelicRoll: true,
  },
  {
    id: 'quest_purge_01',
    name: 'Hive Clearance',
    icon: 'spikes',
    steps: [
      {
        id: 'q_purge_01.s1',
        description: 'Clear two ambush hives on one expedition',
        trigger: { kind: 'clearHazard', hazardKind: 'nest' },
        target: 2,
        scope: 'run',
        goldReward: 100,
      },
      {
        id: 'q_purge_01.s2',
        description: 'Clear six ambush hives across your expeditions',
        trigger: { kind: 'clearHazard', hazardKind: 'nest' },
        target: 6,
        scope: 'persistent',
        goldReward: 160,
      },
    ],
    completionGoldReward: 200,
    grantsKeyId: 'quest_key_purge',
    nextQuestId: 'quest_purge_02',
  },
  {
    id: 'quest_purge_02',
    name: "The Hunter's Den",
    icon: 'skull',
    steps: [
      {
        id: 'q_purge_02.s1',
        description: 'Kill the hunter at its lair',
        trigger: { kind: 'clearHazard', hazardKind: 'lair' },
        target: 1,
        scope: 'persistent',
        goldReward: 240,
      },
      {
        id: 'q_purge_02.s2',
        description: 'Clear ten risk rooms across your expeditions',
        trigger: { kind: 'clearHazard' },
        target: 10,
        scope: 'persistent',
        goldReward: 260,
      },
      {
        id: 'q_purge_02.s3',
        description: "Carry a purge charge to the warden's arena",
        trigger: {
          kind: 'deliverItem',
          itemId: 'cargo_purge_charge',
          destinationTag: 'boss-arena',
        },
        target: 1,
        scope: 'run',
        goldReward: 260,
      },
    ],
    completionGoldReward: 320,
    completionRelicRoll: true,
  },
  /** Neither sigil quest grants a key ON PURPOSE. EXPEDITION_QUEST_KEY_ORDER is derived from
   *  catalog order and fed to the generator as WorldGenInputs.questKeyOrder, so a fifth key
   *  would move KeyDoor placement in every world and cost a WORLDGEN_VERSION bump, which
   *  discards every existing profile's discovery state. */
  {
    id: 'quest_sigil_01',
    name: 'Sigil Work',
    icon: 'swirl',
    steps: [
      {
        id: 'q_sigil_01.s1',
        description: 'Wake a sigil ring in order and take the cache it seals',
        trigger: { kind: 'findSecret', secretKind: 'puzzle' },
        target: 1,
        scope: 'run',
        goldReward: 110,
      },
      {
        id: 'q_sigil_01.s2',
        description: 'Solve three sigil rings across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'puzzle' },
        target: 3,
        scope: 'persistent',
        goldReward: 170,
      },
    ],
    completionGoldReward: 220,
    nextQuestId: 'quest_sigil_02',
  },
  {
    id: 'quest_sigil_02',
    name: 'The Sealed Choir',
    icon: 'sparkle',
    steps: [
      {
        id: 'q_sigil_02.s1',
        description: 'Solve eight sigil rings across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'puzzle' },
        target: 8,
        scope: 'persistent',
        goldReward: 240,
      },
      {
        id: 'q_sigil_02.s2',
        description: 'Uncover twenty secrets across your expeditions',
        trigger: { kind: 'findSecret' },
        target: 20,
        scope: 'persistent',
        goldReward: 250,
      },
      {
        id: 'q_sigil_02.s3',
        description: 'Chart {target} rooms across your expeditions',
        trigger: { kind: 'reachSector' },
        target: 24,
        scope: 'persistent',
        goldReward: 260,
      },
    ],
    completionGoldReward: 340,
    completionRelicRoll: true,
  },
  {
    id: 'quest_warden_01',
    name: 'The Heart of the World',
    icon: 'skull',
    steps: [
      {
        id: 'q_warden_01.s1',
        description: 'Find the arena at the heart of the world',
        trigger: { kind: 'reachSector', sectorTag: 'boss-arena' },
        target: 1,
        scope: 'run',
        goldReward: 160,
      },
      {
        id: 'q_warden_01.s2',
        description: 'Take the Warden and conquer the world',
        trigger: { kind: 'conquerWorld' },
        target: 1,
        scope: 'persistent',
        goldReward: 260,
      },
    ],
    completionGoldReward: 320,
    nextQuestId: 'quest_warden_02',
  },
  {
    id: 'quest_warden_02',
    name: 'Crown of Wardens',
    icon: 'crown',
    steps: [
      {
        id: 'q_warden_02.s1',
        description: 'Take the Warden three times',
        trigger: { kind: 'conquerWorld' },
        target: 3,
        scope: 'persistent',
        goldReward: 240,
      },
      {
        id: 'q_warden_02.s2',
        description: 'Conquer two different worlds',
        trigger: { kind: 'conquerWorld', distinctWorlds: true },
        target: 2,
        scope: 'persistent',
        goldReward: 260,
      },
    ],
    completionGoldReward: 340,
    completionRelicRoll: true,
  },
  /** Neither region quest grants a key, for the reason the sigil pair records:
   *  EXPEDITION_QUEST_KEY_ORDER is derived from catalog order and fed to the generator, so a
   *  fifth key would move KeyDoor placement in every world and cost a WORLDGEN_VERSION bump. */
  {
    id: 'quest_region_01',
    name: 'Empty Quarters',
    icon: 'telescope',
    steps: [
      {
        id: 'q_region_01.s1',
        description: 'Take the vault a region was holding back',
        trigger: { kind: 'findSecret', secretKind: 'capstone' },
        target: 1,
        scope: 'run',
        goldReward: 130,
      },
      {
        id: 'q_region_01.s2',
        description: 'Empty two regions across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'capstone' },
        target: 2,
        scope: 'persistent',
        goldReward: 190,
      },
    ],
    completionGoldReward: 240,
    nextQuestId: 'quest_region_02',
  },
  {
    id: 'quest_region_02',
    name: 'The Hollowed Map',
    icon: 'globe',
    steps: [
      {
        id: 'q_region_02.s1',
        description: 'Empty four regions across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'capstone' },
        target: 4,
        scope: 'persistent',
        goldReward: 260,
      },
      {
        id: 'q_region_02.s2',
        description: 'Carry a survey core into the Crystal Caves',
        trigger: {
          kind: 'deliverItem',
          itemId: 'cargo_survey_core',
          destinationTag: 'biome:stage_crystal_caves',
        },
        target: 1,
        scope: 'run',
        goldReward: 260,
      },
    ],
    completionGoldReward: 340,
    completionRelicRoll: true,
  },
];

/** No `getExpeditionQuest(id)` lives here on purpose. A quest id may name a season contract,
 *  which is generated per world and is not in this array, so the only correct lookup is
 *  `ExpeditionQuestManager.getExpeditionQuestFromCatalog`. */

/** 'cargo_ledger_core' -> 'LEDGER CORE'. Derived rather than a second catalog field, because a
 *  display name beside the id is two sources of truth for one thing.
 *  referentialIntegrity.test.ts pins the `cargo_` prefix every itemId carries. */
export function cargoLabelOf(itemId: string): string {
  return itemId.replace(/^cargo_/, '').replace(/_/g, ' ').toUpperCase();
}

/** 'drone_survey_probe' -> 'SURVEY PROBE'. Derived rather than a second catalog field, the
 *  cargoLabelOf rule: a display name beside the id is two sources of truth for one thing.
 *  referentialIntegrity.test.ts pins the `drone_` prefix every droneId carries. */
export function droneLabelOf(droneId: string): string {
  return droneId.replace(/^drone_/, '').replace(/_/g, ' ').toUpperCase();
}

/** The generation input the expedition world consumes as WorldGenInputs.questKeyOrder.
 *  Catalog order, so a key's door placement is stable while the catalog is. */
export const EXPEDITION_QUEST_KEY_ORDER: readonly string[] = EXPEDITION_QUESTS
  .map((quest) => quest.grantsKeyId)
  .filter((keyId): keyId is string => keyId !== undefined);

/** The one KeyDoor id no quest grants: the profile holds it once it has conquered this world.
 *  APPENDED after EXPEDITION_QUEST_KEY_ORDER at the generator call site and never inserted into
 *  it, because placeQuestKeyDoors assigns keys to candidate regions positionally, so an id added
 *  anywhere but the end would hand every shipped quest door a different requiredId. */
export const WARDEN_SEAL_KEY_ID = 'key_warden_seal';

/** What a warden-sealed door names as its requirement, everywhere a quest name would go. */
export const WARDEN_SEAL_LABEL = 'The Warden';

/** The quest a sealed door should name. Undefined for a key no quest grants, which
 *  referentialIntegrity.test.ts forbids. */
export function getQuestForKeyId(keyId: string): ExpeditionQuestDefinition | undefined {
  return EXPEDITION_QUESTS.find((quest) => quest.grantsKeyId === keyId);
}
