import { SecureStorage } from '../storage';
import { getCurrentDailyDate } from '../utils/dailySeed';
import {
  DAILY_QUEST_COUNT,
  getQuestsForDate,
  type DailyQuestDefinition,
  type DailyQuestRunData,
} from '../data/DailyQuests';

/**
 * DailyQuestManager — persists progress against the day's rotating quest board.
 *
 * Read-through (no in-memory cache; the store is the single source of truth,
 * mirroring ShipRecords/BestScoreManager). `load()` validates on every read, so a
 * corrupt or tampered payload degrades to "fresh day" rather than crashing the
 * achievements screen or poisoning the gold award with NaN.
 *
 * Day rollover resets progress and the rewarded set but deliberately PRESERVES
 * `pendingGold`: a quest completed yesterday and never collected still pays out,
 * so gold can never be earned and silently lost to a UTC midnight.
 */

const STORAGE_KEY = 'survivor-daily-quests';

interface DailyQuestState {
  date: string;
  progress: Record<string, number>;
  rewarded: string[];
  pendingGold: number;
}

export interface DailyQuestProgress {
  quest: DailyQuestDefinition;
  value: number;
  complete: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerce a stored number to a finite, non-negative value (0 if invalid). */
function sanitizeValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function freshState(date: string, pendingGold: number): DailyQuestState {
  return { date, progress: {}, rewarded: [], pendingGold };
}

/**
 * Parse + validate on every call, then roll the day over if the stored date is
 * not today. Anything unparseable is dropped rather than propagated.
 */
function load(): DailyQuestState {
  const today = getCurrentDailyDate();
  let stored: unknown = null;
  try {
    const raw = SecureStorage.getItem(STORAGE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  if (!isPlainObject(stored)) return freshState(today, 0);

  const pendingGold = Math.floor(sanitizeValue(stored.pendingGold));
  if (stored.date !== today) return freshState(today, pendingGold);

  const progress: Record<string, number> = {};
  if (isPlainObject(stored.progress)) {
    for (const [questId, value] of Object.entries(stored.progress)) {
      progress[questId] = sanitizeValue(value);
    }
  }
  const rewarded = Array.isArray(stored.rewarded)
    ? stored.rewarded.filter((id): id is string => typeof id === 'string')
    : [];

  return { date: today, progress, rewarded, pendingGold };
}

function save(state: DailyQuestState): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal — quest progress is a bonus track, never a run blocker.
  }
}

/** Today's board with live progress, in board order. */
export function getDailyQuestBoard(): DailyQuestProgress[] {
  const state = load();
  return getQuestsForDate(state.date).map((quest) => {
    const value = state.progress[quest.id] ?? 0;
    return { quest, value, complete: value >= quest.target };
  });
}

/** How many of today's quests are complete (0..DAILY_QUEST_COUNT). */
export function getDailyQuestCompletionCount(): number {
  return getDailyQuestBoard().filter((entry) => entry.complete).length;
}

/**
 * Folds one finished run into today's board. Returns the quests that completed on
 * THIS run (empty if none) and banks their gold into `pendingGold` for the
 * achievements screen to pay out. A quest already rewarded today never pays twice.
 */
export function settleDailyQuests(run: DailyQuestRunData): DailyQuestDefinition[] {
  const state = load();
  const completedNow: DailyQuestDefinition[] = [];

  for (const quest of getQuestsForDate(state.date)) {
    const previous = state.progress[quest.id] ?? 0;
    const contribution = sanitizeValue(quest.measure(run));
    const next =
      quest.aggregate === 'sum' ? previous + contribution : Math.max(previous, contribution);
    state.progress[quest.id] = next;

    if (next >= quest.target && !state.rewarded.includes(quest.id)) {
      state.rewarded.push(quest.id);
      state.pendingGold += quest.gold;
      completedNow.push(quest);
    }
  }

  save(state);
  return completedNow;
}

/**
 * Hands the caller all unpaid quest gold and zeroes the bank. The caller adds it to
 * the player's gold — mirroring how AchievementScene claims unclaimed achievement
 * rewards on entry.
 */
export function claimDailyQuestGold(): number {
  const state = load();
  const owed = Math.floor(state.pendingGold);
  if (owed <= 0) return 0;
  state.pendingGold = 0;
  save(state);
  return owed;
}

export { DAILY_QUEST_COUNT };
