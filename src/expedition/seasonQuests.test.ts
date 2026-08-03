import { describe, test, expect } from 'vitest';

import { EXPEDITION_QUESTS } from '../data/ExpeditionQuests';
import { STAGES } from '../data/Stages';
import { secretTiersMatched } from '../systems/QuestProgress';
import { ICON_MAP } from '../utils/IconMap';
import { buildSeasonQuests, CONTRACTS_PER_WORLD } from './seasonQuests';

const SEEDS = [20260727, 1, 999_999_999, 1_733_221_004];

describe('seasonQuests', () => {
  test('a seed issues the same contracts every time and different seeds differ', () => {
    expect(buildSeasonQuests(20260727)).toEqual(buildSeasonQuests(20260727));
    const first = buildSeasonQuests(20260727).map((quest) => quest.id).join('|');
    const second = buildSeasonQuests(4242).map((quest) => quest.id).join('|');
    expect(first).not.toBe(second);
  });

  test('every world issues a full set the active cap can hold', () => {
    for (const seed of SEEDS) {
      const contracts = buildSeasonQuests(seed);
      expect(contracts.length, `seed ${seed}`).toBe(CONTRACTS_PER_WORLD);
      for (const contract of contracts) {
        expect(contract.steps.length, contract.id).toBeGreaterThan(0);
        expect(ICON_MAP[contract.icon], `icon "${contract.icon}" on ${contract.id}`).toBeDefined();
        expect(contract.grantsKeyId, contract.id).toBeUndefined();
        expect(contract.nextQuestId, contract.id).toBeUndefined();
        expect(contract.completionGoldReward).toBeGreaterThanOrEqual(120);
        expect(contract.completionGoldReward).toBeLessThanOrEqual(350);
        for (const step of contract.steps) {
          expect(step.target, step.id).toBeGreaterThan(0);
          expect(step.goldReward, step.id).toBeGreaterThanOrEqual(60);
          expect(step.goldReward, step.id).toBeLessThanOrEqual(260);
        }
      }
    }
  });

  test('contract ids are unique and never collide with the authored catalog', () => {
    const authoredQuestIds = new Set(EXPEDITION_QUESTS.map((quest) => quest.id));
    const authoredStepIds = new Set(EXPEDITION_QUESTS.flatMap((q) => q.steps.map((s) => s.id)));
    const questIds = new Set<string>();
    const stepIds = new Set<string>();
    for (const seed of SEEDS) {
      for (const contract of buildSeasonQuests(seed)) {
        expect(authoredQuestIds.has(contract.id), contract.id).toBe(false);
        expect(questIds.has(contract.id), contract.id).toBe(false);
        questIds.add(contract.id);
        for (const step of contract.steps) {
          expect(authoredStepIds.has(step.id), step.id).toBe(false);
          expect(stepIds.has(step.id), step.id).toBe(false);
          stepIds.add(step.id);
        }
      }
    }
  });

  // The bounds src/data/referentialIntegrity.test.ts holds the authored catalog to, applied
  // to the generated one. A contract is issued unasked and cannot be set aside forever, so a
  // template whose target the world cannot supply is an objective that never ticks.
  test('every template obeys the catalog bounds and names only a guaranteed biome', () => {
    // Depth region k is orderBiomesByHarshness(STAGES)[k] and that ordering reads no seed, so
    // these four are in every world. Measured over 300 seeds: minimum non-hidden counts 2, 3,
    // 6, 2 and zero worlds missing any. Deeper regions are absent from some worlds.
    const guaranteedBiomeTags = new Set([
      'boss-arena',
      'biome:stage_deep_void',
      'biome:stage_inferno',
      'biome:stage_crystal_caves',
      'biome:stage_ion_field',
    ]);
    const stageIds = new Set(STAGES.map((stage) => stage.id));
    const seenKeys = new Set<string>();

    for (let seed = 1; seed <= 400; seed += 1) {
      for (const contract of buildSeasonQuests(seed)) {
        seenKeys.add(contract.id.split('_').slice(3).join('_'));
        // Only the ACTIVE step records, and a secret is spent for good, so an earlier step whose
        // trigger matches EVERY tier a later one needs eats that later step's whole supply. The
        // 'ghost' template shipped that way, a bare findSecret ahead of a hiddenSector ask against
        // the two or three a world holds, and was reordered. Necessary, not sufficient: this reads
        // the triggers, never the world's counts, which is why the supply questions on 'purge' and
        // 'warden' are filed rather than asserted here.
        for (let later = 1; later < contract.steps.length; later += 1) {
          const neededTiers = secretTiersMatched(contract.steps[later].trigger);
          if (neededTiers.size === 0) continue;
          for (let earlier = 0; earlier < later; earlier += 1) {
            const eatenTiers = secretTiersMatched(contract.steps[earlier].trigger);
            const eatsEveryNeededTier = [...neededTiers].every((tier) => eatenTiers.has(tier));
            expect(
              eatsEveryNeededTier,
              `${contract.steps[earlier].id} matches every tier ${contract.steps[later].id} needs`,
            ).toBe(false);
          }
        }
        for (const step of contract.steps) {
          const trigger = step.trigger;
          if (trigger.kind === 'surviveInSector') {
            expect(step.target, step.id).toBeLessThanOrEqual(180);
          }
          if (trigger.kind === 'deliverItem') {
            expect(step.target, step.id).toBeLessThanOrEqual(2);
            expect(trigger.itemId.startsWith('cargo_'), step.id).toBe(true);
          }
          if (trigger.kind === 'escortDrone') {
            expect(step.target, step.id).toBeLessThanOrEqual(2);
            expect(trigger.droneId.startsWith('drone_'), step.id).toBe(true);
          }
          if (trigger.kind === 'findSecret' && trigger.secretKind === 'puzzle') {
            // buildSecretPuzzle seals ~30% of a world's cache slots with no depth term, and
            // measured over 300 seeds through the real generator the thinnest world holds two
            // rings (median seven, zero worlds with fewer than two). Steps are sequential, so a
            // template asking for two would need three in the worst case and never tick there.
            expect(step.target, step.id).toBeLessThanOrEqual(1);
          }
          if (trigger.kind === 'findSecret' && trigger.secretKind === 'capstone') {
            // A region vault opens only once every OTHER secret in its region is found, and
            // measured over 300 seeds through generateExpeditionWorld plus buildRegionVaults the
            // thinnest world holds exactly one (p10 2, median 4, max 6). A contract dies with its
            // world, so a 'persistent' step is world-bounded here too, and steps are sequential:
            // one capstone is the whole budget a contract may spend, which is why the 'vault'
            // template's second step names the plentiful cache supply instead of a second vault.
            expect(step.target, step.id).toBeLessThanOrEqual(1);
          }
          const tag = trigger.kind === 'reachSector' ? trigger.sectorTag
            : trigger.kind === 'surviveInSector' ? trigger.sectorTag
            : trigger.kind === 'deliverItem' ? trigger.destinationTag
            : trigger.kind === 'escortDrone' ? trigger.destinationTag
            : undefined;
          if (tag !== undefined) {
            expect(guaranteedBiomeTags.has(tag), `${step.id} tag ${tag}`).toBe(true);
            if (tag !== 'boss-arena') {
              expect(stageIds.has(tag.slice('biome:'.length)), step.id).toBe(true);
            }
          }
          if (step.scope !== 'run') continue;
          if (trigger.kind === 'reachDepth') {
            expect(step.target, step.id).toBeLessThanOrEqual(8);
          }
          if (trigger.kind === 'reachSector') {
            expect(step.target, step.id).toBeLessThanOrEqual(12);
          }
          if (trigger.kind === 'kill') expect(step.target, step.id).toBeLessThanOrEqual(800);
          if (trigger.kind === 'openGate') expect(step.target, step.id).toBeLessThanOrEqual(4);
          if (trigger.kind === 'findSecret') {
            expect(step.target, step.id).toBeLessThanOrEqual(3);
          }
          if (trigger.kind === 'clearHazard') {
            expect(step.target, step.id).toBeLessThanOrEqual(4);
          }
        }
      }
    }

    // 400 seeds x 3 draws sees every template many times over; a miss means the pool shrank.
    expect(seenKeys.size).toBe(14);
  });
});
