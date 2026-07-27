import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so progress round-trips without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one.
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import {
  getDailyQuestBoard,
  getDailyQuestCompletionCount,
  settleDailyQuests,
  claimDailyQuestGold,
} from './DailyQuestManager';
import {
  DAILY_QUESTS,
  DAILY_QUEST_COUNT,
  getQuestsForDate,
  type DailyQuestRunData,
} from '../data/DailyQuests';
import { getCurrentDailyDate } from '../utils/dailySeed';

const STORAGE_KEY = 'survivor-daily-quests';

/** A finished run whose every measurable field is `magnitude`, taking no damage —
 *  so each quest's measure() scales with the one knob the assertions drive off. */
function runOfMagnitude(magnitude: number): DailyQuestRunData {
  return {
    wasVictory: true,
    killCount: magnitude,
    levelReached: magnitude,
    survivalTimeSeconds: magnitude,
    damageDealt: magnitude,
    damageTaken: 0,
    goldEarned: magnitude,
    highestCombo: magnitude,
  };
}

const todaysQuests = () => getQuestsForDate(getCurrentDailyDate());

describe('DailyQuestManager', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
  });

  // ── Corruption / tamper resilience (an encrypted key that pays gold) ──

  test.each([
    ['a "null" payload', 'null'],
    ['non-JSON garbage', '{not valid json'],
    ['a non-object payload (array)', JSON.stringify([1, 2, 3])],
  ])('%s degrades to a fresh board instead of throwing', (_label, payload) => {
    SecureStorage.setItem(STORAGE_KEY, payload);
    expect(() => getDailyQuestBoard()).not.toThrow();

    const board = getDailyQuestBoard();
    expect(board).toHaveLength(DAILY_QUEST_COUNT);
    expect(board.every((entry) => entry.value === 0)).toBe(true);
    expect(board.every((entry) => entry.complete === false)).toBe(true);
    expect(getDailyQuestCompletionCount()).toBe(0);
  });

  // ── Rotation ──

  test('a date picks a stable set of distinct quests from the pool', () => {
    const first = getQuestsForDate('2026-01-02');
    const second = getQuestsForDate('2026-01-02');

    expect(first).toHaveLength(DAILY_QUEST_COUNT);
    expect(new Set(first.map((quest) => quest.id)).size).toBe(DAILY_QUEST_COUNT);
    expect(first.map((quest) => quest.id)).toEqual(second.map((quest) => quest.id));
    for (const quest of first) {
      expect(DAILY_QUESTS.some((pooled) => pooled.id === quest.id)).toBe(true);
    }
  });

  // ── Aggregation ──

  test("'best' quests keep the highest single-run value", () => {
    const strong = runOfMagnitude(1000);
    const weak = runOfMagnitude(200);
    settleDailyQuests(strong);
    settleDailyQuests(weak);

    const board = getDailyQuestBoard();
    expect(board).toHaveLength(DAILY_QUEST_COUNT);
    for (const entry of board.filter((candidate) => candidate.quest.aggregate === 'best')) {
      const expected = Math.max(entry.quest.measure(strong), entry.quest.measure(weak));
      expect(entry.value).toBe(expected);
    }
  });

  test("'sum' quests accumulate across runs", () => {
    const first = runOfMagnitude(1000);
    const second = runOfMagnitude(200);
    settleDailyQuests(first);
    settleDailyQuests(second);

    const board = getDailyQuestBoard();
    expect(board).toHaveLength(DAILY_QUEST_COUNT);
    for (const entry of board.filter((candidate) => candidate.quest.aggregate === 'sum')) {
      const expected = entry.quest.measure(first) + entry.quest.measure(second);
      expect(entry.value).toBe(expected);
    }
  });

  // ── Payout ──

  test('a completed quest banks its gold exactly once', () => {
    const clearingRun = runOfMagnitude(1_000_000);
    const completedFirst = settleDailyQuests(clearingRun);
    expect(completedFirst.length).toBeGreaterThan(0);

    const expectedGold = completedFirst.reduce((total, quest) => total + quest.gold, 0);
    expect(settleDailyQuests(clearingRun)).toEqual([]);

    expect(claimDailyQuestGold()).toBe(expectedGold);
    expect(claimDailyQuestGold()).toBe(0);
  });

  test('the day rollover resets progress but preserves unpaid gold', () => {
    const clearingRun = runOfMagnitude(1_000_000);
    const expectedGold = settleDailyQuests(clearingRun).reduce(
      (total, quest) => total + quest.gold,
      0
    );
    expect(expectedGold).toBeGreaterThan(0);

    const stored = JSON.parse(SecureStorage.getItem(STORAGE_KEY) as string);
    stored.date = '2000-01-01';
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const board = getDailyQuestBoard();
    expect(board.every((entry) => entry.value === 0)).toBe(true);
    expect(claimDailyQuestGold()).toBe(expectedGold);
  });

  // ── Sanity ──

  test('a non-finite or negative stored progress value degrades to zero', () => {
    const [first, second] = todaysQuests();
    SecureStorage.setItem(
      STORAGE_KEY,
      `{"date":"${getCurrentDailyDate()}","progress":{"${first.id}":null,"${second.id}":-5},"rewarded":[],"pendingGold":-10}`
    );

    const board = getDailyQuestBoard();
    expect(board.every((entry) => entry.value === 0)).toBe(true);
    expect(claimDailyQuestGold()).toBe(0);
  });
});
