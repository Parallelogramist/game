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
  getLiveDailyQuestBoard,
  getDailyQuestCompletionCount,
  settleDailyQuests,
  claimDailyQuestGold,
  createDailyQuestWatcher,
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

  // ── Live watcher (the in-run path; gold must never be paid twice) ──

  /** An in-progress run big enough to satisfy every live-measurable quest. */
  const liveRunOfMagnitude = (magnitude: number): DailyQuestRunData => ({
    ...runOfMagnitude(magnitude),
    wasVictory: false,
    goldEarned: 0,
  });

  test('the live watcher pays a quest mid-run, and the run-end settle never pays it again', () => {
    const live = liveRunOfMagnitude(1_000_000);
    const expected = todaysQuests().filter(
      (quest) => quest.settleOnly !== true && quest.measure(live) >= quest.target,
    );

    const watcher = createDailyQuestWatcher();
    const paid = watcher.check(live);
    expect(paid.map((quest) => quest.id).sort()).toEqual(expected.map((quest) => quest.id).sort());
    expect(claimDailyQuestGold()).toBe(expected.reduce((total, quest) => total + quest.gold, 0));

    // Same run, checked again: nothing new, nothing owed.
    expect(watcher.check(live)).toEqual([]);
    expect(claimDailyQuestGold()).toBe(0);

    // The run finally ends: only quests the watcher could not judge may pay now.
    const settled = settleDailyQuests(runOfMagnitude(1_000_000));
    expect(settled.some((quest) => paid.some((already) => already.id === quest.id))).toBe(false);
    expect(claimDailyQuestGold()).toBe(settled.reduce((total, quest) => total + quest.gold, 0));
  });

  test('a live-completed quest reads as complete on the board before any run ends', () => {
    const live = liveRunOfMagnitude(1_000_000);
    const expected = todaysQuests().filter(
      (quest) => quest.settleOnly !== true && quest.measure(live) >= quest.target,
    );
    const paid = createDailyQuestWatcher().check(live);
    expect(paid.map((quest) => quest.id).sort()).toEqual(expected.map((quest) => quest.id).sort());

    const board = getDailyQuestBoard();
    for (const quest of paid) {
      const entry = board.find((candidate) => candidate.quest.id === quest.id);
      expect(entry?.complete).toBe(true);
      expect(entry?.value).toBeGreaterThanOrEqual(quest.target);
    }
    expect(getDailyQuestCompletionCount()).toBeGreaterThanOrEqual(paid.length);
  });

  test('a settleOnly quest never completes live, however big the run', () => {
    expect(DAILY_QUESTS.find((quest) => quest.id === 'runs_day_3')?.settleOnly).toBe(true);
    const paid = createDailyQuestWatcher().check(liveRunOfMagnitude(1_000_000));
    expect(paid.some((quest) => quest.settleOnly === true)).toBe(false);
  });

  // ── Live board (the pause panel's read; it must never write) ──

  test('the live board folds the in-progress run in without writing anything', () => {
    const live = liveRunOfMagnitude(1_000_000);
    const board = getLiveDailyQuestBoard(live);

    for (const entry of board) {
      if (entry.quest.settleOnly === true) continue;
      expect(entry.value).toBeGreaterThanOrEqual(entry.quest.measure(live));
      expect(entry.complete).toBe(entry.value >= entry.quest.target);
    }
    // Nothing was persisted: the stored board is still empty and nothing is owed.
    expect(getDailyQuestBoard().every((entry) => entry.value === 0)).toBe(true);
    expect(claimDailyQuestGold()).toBe(0);
  });

  test('a settleOnly quest shows only its stored progress on the live board', () => {
    settleDailyQuests(runOfMagnitude(1));
    const stored = getDailyQuestBoard();
    const board = getLiveDailyQuestBoard(liveRunOfMagnitude(1_000_000));

    for (const quest of todaysQuests()) {
      if (quest.settleOnly !== true) continue;
      const liveEntry = board.find((entry) => entry.quest.id === quest.id);
      const storedEntry = stored.find((entry) => entry.quest.id === quest.id);
      expect(liveEntry?.value).toBe(storedEntry?.value);
    }
  });

  test('a quest already paid today reads complete on the live board', () => {
    const paid = createDailyQuestWatcher().check(liveRunOfMagnitude(1_000_000));
    expect(paid.length).toBeGreaterThan(0);

    // A fresh run that measures nothing must not un-complete an already-paid quest.
    const board = getLiveDailyQuestBoard(liveRunOfMagnitude(0));
    for (const quest of paid) {
      const entry = board.find((candidate) => candidate.quest.id === quest.id);
      expect(entry?.complete).toBe(true);
      expect(entry?.value).toBeGreaterThanOrEqual(quest.target);
    }
  });
});
