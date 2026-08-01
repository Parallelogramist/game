import { describe, test, expect } from 'vitest';

import { EXPEDITION_QUESTS } from '../data/ExpeditionQuests';
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
});
