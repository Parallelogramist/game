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
 * 33 ms. 'boss-arena' is the one tag used, and every generated world has exactly one.
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
    steps: [
      {
        description: 'Uncover three secrets on one expedition',
        trigger: { kind: 'findSecret' },
        target: 3,
        scope: 'run',
        goldReward: 140,
      },
      {
        description: 'Break into two hidden sectors across your expeditions',
        trigger: { kind: 'findSecret', secretKind: 'hiddenSector' },
        target: 2,
        scope: 'persistent',
        goldReward: 200,
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
