import { SecureStorage } from '../storage';
import {
  EXPEDITION_QUESTS,
  getExpeditionQuest,
  type ExpeditionQuestDefinition,
} from '../data/ExpeditionQuests';
import {
  recordQuestEvent,
  seedQuestStates,
  settleRunScopeProgress,
  buildQuestStepViews,
  buildQuestMarkers,
  type QuestEvent,
  type QuestInstanceState,
  type QuestMarker,
  type QuestProgressResult,
  type QuestStepView,
} from '../systems/QuestProgress';

/**
 * Persists expedition quest chains for this profile (doc 04 section 4).
 *
 * Gold is banked into `pendingGold` on completion and handed out by
 * claimExpeditionQuestGold(), exactly as DailyQuestManager does it: banking first means a
 * failed payout leaves the gold owed rather than lost, and claiming (rather than adding
 * each reward inline) sweeps up anything an earlier failure left behind.
 */

const STORAGE_KEY_EXPEDITION_QUESTS = 'survivor-expedition-quests';

/** Doc 04 section 4's anti-chore rule: a fourth accept is refused. */
export const ACTIVE_EXPEDITION_QUEST_LIMIT = 3;

interface ExpeditionQuestSaveState {
  states: QuestInstanceState[];
  pendingGold: number;
}

export interface ExpeditionQuestRewards {
  stepCompletions: QuestProgressResult['stepCompletions'];
  questCompletions: QuestProgressResult['questCompletions'];
  activatedQuestIds: string[];
}

const EMPTY_REWARDS: ExpeditionQuestRewards = {
  stepCompletions: [],
  questCompletions: [],
  activatedQuestIds: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * A state whose quest or step index no longer exists in the catalog is dropped, not
 * clamped: the content was re-authored, and inventing a step index is how a player gets
 * paid for a step that is not the one they see.
 */
function sanitizeStates(value: unknown): QuestInstanceState[] {
  if (!Array.isArray(value)) return [];
  const states: QuestInstanceState[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const questId = typeof entry.questId === 'string' ? entry.questId : '';
    const definition = getExpeditionQuest(questId);
    if (!definition || seen.has(questId)) continue;
    const status = entry.status === 'complete' ? 'complete' : 'active';
    const stepIndex = sanitizeCount(entry.stepIndex);
    if (status === 'active' && stepIndex >= definition.steps.length) continue;
    seen.add(questId);
    states.push({
      questId,
      stepIndex: Math.min(stepIndex, definition.steps.length),
      stepProgress: sanitizeCount(entry.stepProgress),
      status,
    });
  }
  return states;
}

function load(): ExpeditionQuestSaveState {
  try {
    const raw = SecureStorage.getItem(STORAGE_KEY_EXPEDITION_QUESTS);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (!isPlainObject(stored)) return { states: [], pendingGold: 0 };
    return {
      states: sanitizeStates(stored.states),
      pendingGold: sanitizeCount(stored.pendingGold),
    };
  } catch {
    return { states: [], pendingGold: 0 };
  }
}

function save(state: ExpeditionQuestSaveState): void {
  try {
    SecureStorage.setItem(STORAGE_KEY_EXPEDITION_QUESTS, JSON.stringify(state));
  } catch {
    // Non-fatal: quest progress is a bonus track, never a run blocker.
  }
}

export function getExpeditionQuestStates(): QuestInstanceState[] {
  return load().states;
}

/** Keys earned by completed quests. Derived, never stored: a second copy of "which quests
 *  finished" is how a door and its quest log disagree. */
export function getEarnedQuestKeyIds(): string[] {
  const earned: string[] = [];
  for (const state of load().states) {
    if (state.status !== 'complete') continue;
    const keyId = getExpeditionQuest(state.questId)?.grantsKeyId;
    if (keyId !== undefined) earned.push(keyId);
  }
  return earned;
}

export type { QuestStepView } from '../systems/QuestProgress';

/** What the HUD ticker and the map panel render. Cheap: SecureStorage.getItem is a cache read. */
export function getActiveQuestStepViews(): QuestStepView[] {
  return buildQuestStepViews(load().states, EXPEDITION_QUESTS);
}

export type { QuestMarker } from '../systems/QuestProgress';

/** Doc 04 section 4's map-marker feed. Same store read as getActiveQuestStepViews, and the
 *  same one-projection rule: the panel and the pins cannot disagree about what is active. */
export function getActiveQuestMarkers(): QuestMarker[] {
  return buildQuestMarkers(load().states, EXPEDITION_QUESTS);
}

/**
 * Called once at the start of a fresh expedition (never on a refresh-restore, which is the
 * same run continuing). Clears in-progress run-scope counters and starts any chain the
 * player does not hold yet, returning what it just started so the caller can announce it.
 *
 * The run-scope clear lives HERE rather than at the run-end sites doc 04 names: a run can
 * end through death, victory, the END RUN dialog or a closed tab, and a reset that only
 * some of those paths reach would leak one run's counter into the next.
 */
export function beginExpeditionQuestRun(): ExpeditionQuestDefinition[] {
  const state = load();
  const settled = settleRunScopeProgress(state.states, EXPEDITION_QUESTS);
  const seeded = seedQuestStates(settled, EXPEDITION_QUESTS, ACTIVE_EXPEDITION_QUEST_LIMIT);
  save({ states: seeded.states, pendingGold: state.pendingGold });
  return seeded.activatedQuestIds
    .map((questId) => getExpeditionQuest(questId))
    .filter((definition): definition is ExpeditionQuestDefinition => definition !== undefined);
}

/**
 * Folds one event in and banks whatever it earned. Storage is written only when something
 * actually changed, so the once-a-second kill poll is free on a frame that earned nothing.
 */
export function recordExpeditionQuestEvent(event: QuestEvent): ExpeditionQuestRewards {
  const state = load();
  if (state.states.length === 0) return EMPTY_REWARDS;
  const result = recordQuestEvent(state.states, EXPEDITION_QUESTS, event);

  const earned = result.stepCompletions.reduce((total, entry) => total + entry.goldReward, 0)
    + result.questCompletions.reduce((total, entry) => total + entry.goldReward, 0);
  const changed = earned > 0
    || result.activatedQuestIds.length > 0
    || result.states.some((next, index) => next.stepProgress !== state.states[index]?.stepProgress);
  if (!changed) return EMPTY_REWARDS;

  save({ states: result.states, pendingGold: state.pendingGold + earned });
  return {
    stepCompletions: result.stepCompletions,
    questCompletions: result.questCompletions,
    activatedQuestIds: result.activatedQuestIds,
  };
}

/** Hands the caller all unpaid quest gold and zeroes the bank (claimDailyQuestGold's shape). */
export function claimExpeditionQuestGold(): number {
  const state = load();
  const owed = state.pendingGold;
  if (owed <= 0) return 0;
  save({ states: state.states, pendingGold: 0 });
  return owed;
}
