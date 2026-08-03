/**
 * seasonQuests: the contracts a world issues on its own, one set per expedition seed.
 *
 * The authored chains in src/data/ExpeditionQuests.ts are once per profile: finishing them
 * leaves every world after it with no objectives at all, which FEAT-EXPEDITION-SEASONS
 * (fd406d3) made reachable the moment a player could re-roll the map. A contract is generated
 * rather than authored, so a fresh world always issues three, and its id carries the seed so
 * the store retires the old world's contracts through the unknown-id drop it already does.
 *
 * Pure and Phaser-free like the rest of src/expedition/, and deliberately WORLD-AGNOSTIC: a
 * contract is derived from the seed alone and never from the generated map, because the
 * catalog is rebuilt on the path every quest read takes and generateExpeditionWorld costs
 * 33 ms. Two tag families are safe here without generating anything: 'boss-arena', because
 * every world sets exactly one, and the four shallowest biomes, because assignDangerAndBiomes
 * maps depth region k to orderBiomesByHarshness(STAGES)[k] and that ordering reads no seed, so
 * region 0-3 is always deep void, inferno, crystal caves, ion field. Measured over 300 seeds:
 * 0 worlds lack any of the four (minimum non-hidden counts 2, 3, 6, 2), while verdant rot,
 * molten vault and endless void are absent from some worlds and are never named.
 */

import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';
import type {
  ExpeditionQuestDefinition,
  ExpeditionQuestStep,
} from '../data/ExpeditionQuests';

/** Matches ACTIVE_EXPEDITION_QUEST_LIMIT, so a profile whose chains are done refills exactly. */
export const CONTRACTS_PER_WORLD = 3;

/** The id is derived from the seed and the template key, so templates carry everything else. */
type ContractStepTemplate = Omit<ExpeditionQuestStep, 'id'>;

interface ContractTemplate {
  readonly key: string;
  readonly name: string;
  /** ICON_MAP key, asserted by seasonQuests.test.ts the way referentialIntegrity.test.ts
   *  asserts the authored catalog's. */
  readonly icon: string;
  readonly steps: readonly ContractStepTemplate[];
  readonly completionGoldReward: number;
}

/**
 * Rewards sit inside the band the authored catalog already occupies (steps 60 to 260,
 * completions 120 to 350) and ride the existing pendingGold rail, so the set is econ-neutral
 * by construction and FEAT-ECON-WARDS stays parked. Every trigger here has a shipped producer,
 * and none asks for a one-time act a finished profile can no longer perform: claimAbility is
 * absent on purpose, because a profile holding all six abilities can never claim a seventh.
 * Every biome tag names one of the four regions guaranteed to exist (see the module header).
 * 'cipher' is the one template that names the 'puzzle' tier, and asks for exactly one ring:
 * about 30% of a world's cache slots seal behind a sigil ring, and over 300 seeds the thinnest
 * world seals only two (median seven), so a sweep of them is not authorable but a single one is.
 * 'vault' is the one template that names the 'capstone' tier, and asks for exactly one region
 * vault: over 300 seeds the thinnest world holds ONE (p10 2, median 4, max 6), and a contract
 * dies with its world, so its second step names the plentiful cache supply rather than a second
 * vault. Emptying the cheapest region costs a measured median of 3 finds (p90 5), which is the
 * band 'ghost' already asks for in one expedition, and its prerequisites are read from persistent
 * discovery state, so a returning player pays less again.
 */
const CONTRACT_TEMPLATES: readonly ContractTemplate[] = [
  {
    key: 'survey',
    name: 'Contract · Grand Survey',
    icon: 'telescope',
    steps: [
      {
        description: 'Chart twelve sectors of this world on one expedition',
        trigger: { kind: 'reachSector' },
        target: 12,
        scope: 'run',
        goldReward: 140,
      },
      {
        description: 'Chart twenty-six rooms of this world',
        trigger: { kind: 'reachSector' },
        target: 26,
        scope: 'persistent',
        goldReward: 220,
      },
    ],
    completionGoldReward: 300,
  },
  {
    key: 'ghost',
    name: 'Contract · Ghost Sweep',
    icon: 'ghost',
    // The scarce ask leads, and that order is load-bearing. Only the ACTIVE step records
    // (QuestProgress reads definition.steps[stepIndex] alone), a bare findSecret trigger matches
    // every tier including hiddenSector, and a world's two or three hidden sectors stay broken
    // once entered: with the bare step first it ate the supply the second step needed and
    // stranded the contract for that world for good.
    steps: [
      {
        description: 'Break into two hidden sectors across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'hiddenSector' },
        target: 2,
        scope: 'persistent',
        goldReward: 200,
      },
      {
        description: 'Uncover three secrets on one expedition',
        trigger: { kind: 'findSecret' },
        target: 3,
        scope: 'run',
        goldReward: 140,
      },
    ],
    completionGoldReward: 280,
  },
  {
    key: 'purge',
    name: 'Contract · Sweep and Clear',
    icon: 'spikes',
    steps: [
      {
        description: 'Clear two ambush hives on one expedition',
        trigger: { kind: 'clearHazard', hazardKind: 'nest' },
        target: 2,
        scope: 'run',
        goldReward: 120,
      },
      {
        description: 'Clear five risk rooms across your expeditions',
        trigger: { kind: 'clearHazard' },
        target: 5,
        scope: 'persistent',
        goldReward: 200,
      },
    ],
    completionGoldReward: 260,
  },
  {
    key: 'patrol',
    name: 'Contract · Long Patrol',
    icon: 'rocket',
    steps: [
      {
        description: 'Destroy 300 hostiles on one expedition',
        trigger: { kind: 'kill' },
        target: 300,
        scope: 'run',
        goldReward: 120,
      },
      {
        description: 'Fly four sectors out from the hangar',
        trigger: { kind: 'reachDepth' },
        target: 4,
        scope: 'run',
        goldReward: 160,
      },
    ],
    completionGoldReward: 240,
  },
  {
    key: 'warden',
    name: 'Contract · Gate Warden',
    icon: 'radar',
    steps: [
      {
        description: 'Open two sealed doors on one expedition',
        trigger: { kind: 'openGate' },
        target: 2,
        scope: 'run',
        goldReward: 130,
      },
      {
        description: 'Open six sealed doors across your expeditions',
        trigger: { kind: 'openGate' },
        target: 6,
        scope: 'persistent',
        goldReward: 190,
      },
    ],
    completionGoldReward: 260,
  },
  {
    key: 'vigil',
    name: 'Contract · Arena Vigil',
    icon: 'crown',
    steps: [
      {
        description: "Chart the arena at this world's heart",
        trigger: { kind: 'reachSector', sectorTag: 'boss-arena' },
        target: 1,
        scope: 'persistent',
        goldReward: 150,
      },
      {
        description: 'Hold that arena for seventy-five seconds',
        trigger: { kind: 'surviveInSector', sectorTag: 'boss-arena' },
        target: 75,
        scope: 'run',
        goldReward: 230,
      },
    ],
    completionGoldReward: 300,
  },
  {
    key: 'courier',
    name: 'Contract · Standing Delivery',
    icon: 'backpack',
    steps: [
      {
        description: "Deliver a relay core to the arena at this world's heart",
        trigger: {
          kind: 'deliverItem',
          itemId: 'cargo_relay_core',
          destinationTag: 'boss-arena',
        },
        target: 1,
        scope: 'run',
        goldReward: 160,
      },
      {
        description: 'Run two more deliveries into the Ion Field',
        trigger: {
          kind: 'deliverItem',
          itemId: 'cargo_survey_ledger',
          destinationTag: 'biome:stage_ion_field',
        },
        target: 2,
        scope: 'persistent',
        goldReward: 220,
      },
    ],
    completionGoldReward: 310,
  },
  {
    key: 'convoy',
    name: 'Contract · Convoy Duty',
    icon: 'drone',
    steps: [
      {
        description: 'Escort a courier drone into the Crystal Caves',
        trigger: {
          kind: 'escortDrone',
          droneId: 'drone_contract_courier',
          destinationTag: 'biome:stage_crystal_caves',
        },
        target: 1,
        scope: 'run',
        goldReward: 170,
      },
      {
        description: 'Walk two more drones home through the Inferno',
        trigger: {
          kind: 'escortDrone',
          droneId: 'drone_relay_probe',
          destinationTag: 'biome:stage_inferno',
        },
        target: 2,
        scope: 'persistent',
        goldReward: 230,
      },
    ],
    completionGoldReward: 320,
  },
  {
    key: 'prospect',
    name: 'Contract · Deep Prospect',
    icon: 'crystal',
    steps: [
      {
        description: 'Chart {target} Inferno rooms on one expedition',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_inferno' },
        target: 3,
        scope: 'run',
        goldReward: 130,
      },
      {
        description: 'Chart {target} rooms of the Crystal Caves',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_crystal_caves' },
        target: 5,
        scope: 'persistent',
        goldReward: 200,
      },
    ],
    completionGoldReward: 280,
  },
  {
    key: 'bulwark',
    name: 'Contract · Standing Watch',
    icon: 'shield',
    steps: [
      {
        description: 'Hold an Inferno room for sixty seconds',
        trigger: { kind: 'surviveInSector', sectorTag: 'biome:stage_inferno' },
        target: 60,
        scope: 'run',
        goldReward: 150,
      },
      {
        description: 'Clear three nemesis lairs across your expeditions',
        trigger: { kind: 'clearHazard', hazardKind: 'lair' },
        target: 3,
        scope: 'persistent',
        goldReward: 200,
      },
    ],
    completionGoldReward: 290,
  },
  {
    key: 'homefront',
    name: 'Contract · Home Front',
    icon: 'eye',
    steps: [
      {
        description: 'Uncover two caches on one expedition',
        trigger: { kind: 'findSecret', secretKind: 'cache' },
        target: 2,
        scope: 'run',
        goldReward: 140,
      },
      {
        description: 'Chart two Deep Void rooms',
        trigger: { kind: 'reachSector', sectorTag: 'biome:stage_deep_void' },
        target: 2,
        scope: 'persistent',
        goldReward: 190,
      },
    ],
    completionGoldReward: 280,
  },
  {
    key: 'frontier',
    name: 'Contract · Far Frontier',
    icon: 'planet',
    steps: [
      {
        description: 'Fly five sectors out from the hangar',
        trigger: { kind: 'reachDepth' },
        target: 5,
        scope: 'run',
        goldReward: 170,
      },
      {
        description: 'Destroy nine hundred hostiles across your expeditions',
        trigger: { kind: 'kill' },
        target: 900,
        scope: 'persistent',
        goldReward: 220,
      },
    ],
    completionGoldReward: 310,
  },
  {
    key: 'cipher',
    name: 'Contract · Sigil Cipher',
    icon: 'chain',
    steps: [
      {
        description: 'Wake a sigil ring in its own order on one expedition',
        trigger: { kind: 'findSecret', secretKind: 'puzzle' },
        target: 1,
        scope: 'run',
        goldReward: 160,
      },
      {
        description: 'Uncover four caches across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'cache' },
        target: 4,
        scope: 'persistent',
        goldReward: 210,
      },
    ],
    completionGoldReward: 300,
  },
  {
    key: 'vault',
    name: 'Contract · Hollow Quarter',
    icon: 'gem',
    steps: [
      {
        description: 'Empty a region of this world on one expedition',
        trigger: { kind: 'findSecret', secretKind: 'capstone' },
        target: 1,
        scope: 'run',
        goldReward: 170,
      },
      {
        description: 'Uncover six more secrets across your expeditions',
        trigger: { kind: 'findSecret' },
        target: 6,
        scope: 'persistent',
        goldReward: 200,
      },
    ],
    completionGoldReward: 320,
  },
];

let memoSeed: number | null = null;
let memoQuests: readonly ExpeditionQuestDefinition[] = [];

function chooseTemplates(worldSeed: number): ContractTemplate[] {
  const rng = mulberry32(hashStringToSeed(`contracts:${worldSeed}`));
  const pool = [...CONTRACT_TEMPLATES];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const held = pool[index];
    pool[index] = pool[swapIndex];
    pool[swapIndex] = held;
  }
  return pool.slice(0, CONTRACTS_PER_WORLD);
}

/**
 * The contracts the given world issues. Memoised on the seed because the quest manager
 * rebuilds its catalog on every read, including a once-a-second poll, and the draw is a pure
 * function of the seed.
 */
export function buildSeasonQuests(worldSeed: number): readonly ExpeditionQuestDefinition[] {
  if (memoSeed === worldSeed) return memoQuests;
  const quests: ExpeditionQuestDefinition[] = chooseTemplates(worldSeed).map((template) => ({
    id: `quest_contract_${worldSeed}_${template.key}`,
    name: template.name,
    icon: template.icon,
    steps: template.steps.map((step, index) => ({
      ...step,
      id: `q_contract_${worldSeed}_${template.key}.s${index + 1}`,
    })),
    completionGoldReward: template.completionGoldReward,
  }));
  memoSeed = worldSeed;
  memoQuests = quests;
  return quests;
}
