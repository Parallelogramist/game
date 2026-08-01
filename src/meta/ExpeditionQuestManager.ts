import { SecureStorage } from '../storage';
import {
  EXPEDITION_QUESTS,
  type ExpeditionQuestDefinition,
} from '../data/ExpeditionQuests';
import {
  acceptQuest,
  recordQuestEvent,
  seedQuestStates,
  setQuestAside,
  settleRunScopeProgress,
  buildQuestBoardEntries,
  buildQuestStepViews,
  buildQuestMarkers,
  buildQuestHoldObjectives,
  buildQuestHazardObjectives,
  loadQuestCargo,
  type QuestBoardEntry,
  type QuestCargoRow,
  type QuestEvent,
  type QuestHazardObjective,
  type QuestHoldObjective,
  type QuestInstanceState,
  type QuestMarker,
  type QuestProgressResult,
  type QuestStatus,
  type QuestStepView,
} from '../systems/QuestProgress';
import { buildSeasonQuests } from '../expedition/seasonQuests';
import { getCurrentExpeditionSeed } from '../expedition/ExpeditionSeasonStore';

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

/**
 * The authored chains plus the contracts the world this profile is on issues
 * (FEAT-QUEST-SEASON-CONTRACTS). Contracts sit AFTER the chains, which is the one ordering
 * rule that matters: seedQuestStates fills the three active slots in catalog order, so a chain
 * head, which grants the keys the generator seals regions behind, always wins a slot over a
 * contract, and a contract auto-activates only once the chains stop filling the cap. A
 * contract id carries its seed, so re-rolling the world retires the old set through the
 * unknown-id drop sanitizeStates already does.
 */
function questCatalog(): readonly ExpeditionQuestDefinition[] {
  return [...EXPEDITION_QUESTS, ...buildSeasonQuests(getCurrentExpeditionSeed())];
}

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

/** A generated world holds 48 sectors, so a longer set is a tampered file, not a sweep. */
const MAX_VISITED_SECTOR_KEYS = 64;

function sanitizeSectorKeys(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keys: string[] = [];
  for (const entry of value) {
    if (keys.length >= MAX_VISITED_SECTOR_KEYS) break;
    if (typeof entry !== 'string' || entry.length === 0 || keys.includes(entry)) continue;
    keys.push(entry);
  }
  return keys.length > 0 ? keys : undefined;
}

/** A world stamp is opaque to the store: it is only ever compared for equality, so the only
 *  thing to validate is that it is a short non-empty string. */
function sanitizeWorldStamp(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : undefined;
}

/**
 * A state whose quest or step index no longer exists in the catalog is dropped, not
 * clamped: the content was re-authored, and inventing a step index is how a player gets
 * paid for a step that is not the one they see.
 */
function sanitizeStates(
  value: unknown,
  defs: readonly ExpeditionQuestDefinition[],
): QuestInstanceState[] {
  if (!Array.isArray(value)) return [];
  const states: QuestInstanceState[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const questId = typeof entry.questId === 'string' ? entry.questId : '';
    const definition = defs.find((entry) => entry.id === questId);
    if (!definition || seen.has(questId)) continue;
    const status: QuestStatus = entry.status === 'complete' ? 'complete'
      : entry.status === 'available' ? 'available'
      : 'active';
    const stepIndex = sanitizeCount(entry.stepIndex);
    // An unfinished quest whose index is past the end of its chain is nonsense in either live
    // status, so the guard follows the status rather than the word 'active'.
    if (status !== 'complete' && stepIndex >= definition.steps.length) continue;
    const clampedIndex = Math.min(stepIndex, definition.steps.length);
    const isDistinctStep = definition.steps[clampedIndex]?.trigger.kind === 'reachSector';
    const isDeliveryStep = definition.steps[clampedIndex]?.trigger.kind === 'deliverItem';
    // Set and stamp are kept or dropped together: a set whose world is unknown cannot be
    // checked against the live world, and a stamp with no set says nothing.
    const storedStamp = isDistinctStep ? sanitizeWorldStamp(entry.visitedWorldStamp) : undefined;
    const visitedSectorKeys = storedStamp !== undefined
      ? sanitizeSectorKeys(entry.visitedSectorKeys)
      : undefined;
    const visitedWorldStamp = visitedSectorKeys !== undefined ? storedStamp : undefined;
    seen.add(questId);
    states.push({
      questId,
      stepIndex: clampedIndex,
      // Progress on a distinct step is DERIVED from the visited set, never trusted beside it:
      // one count in two fields is two sources of truth.
      stepProgress: isDistinctStep
        ? visitedSectorKeys?.length ?? 0
        : sanitizeCount(entry.stepProgress),
      status,
      visitedSectorKeys,
      visitedWorldStamp,
      // A crate is only meaningful on the step that asks for it, so a stale flag from a
      // re-authored catalog is dropped rather than carried onto whatever step is current now.
      cargoHeld: isDeliveryStep && entry.cargoHeld === true ? true : undefined,
    });
  }
  return states;
}

function load(defs: readonly ExpeditionQuestDefinition[] = questCatalog()):
ExpeditionQuestSaveState {
  try {
    const raw = SecureStorage.getItem(STORAGE_KEY_EXPEDITION_QUESTS);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (!isPlainObject(stored)) return { states: [], pendingGold: 0 };
    return {
      states: sanitizeStates(stored.states, defs),
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
  const defs = questCatalog();
  const earned: string[] = [];
  for (const state of load(defs).states) {
    if (state.status !== 'complete') continue;
    const keyId = defs.find((entry) => entry.id === state.questId)?.grantsKeyId;
    if (keyId !== undefined) earned.push(keyId);
  }
  return earned;
}

export type { QuestStepView } from '../systems/QuestProgress';

/** What the HUD ticker and the map panel render. Cheap: SecureStorage.getItem is a cache read. */
export function getActiveQuestStepViews(): QuestStepView[] {
  const defs = questCatalog();
  return buildQuestStepViews(load(defs).states, defs);
}

export type { QuestMarker } from '../systems/QuestProgress';

/** Doc 04 section 4's map-marker feed. Same store read as getActiveQuestStepViews, and the
 *  same one-projection rule: the panel and the pins cannot disagree about what is active. */
export function getActiveQuestMarkers(): QuestMarker[] {
  const defs = questCatalog();
  return buildQuestMarkers(load(defs).states, defs);
}

export type { QuestHoldObjective } from '../systems/QuestProgress';

/** What the siege driver reads once a second. Same store read and same one-projection rule as
 *  getActiveQuestMarkers, so the pressure can never answer for a room the pins do not point at. */
export function getActiveQuestHoldObjectives(): QuestHoldObjective[] {
  const defs = questCatalog();
  return buildQuestHoldObjectives(load(defs).states, defs);
}

export type { QuestHazardObjective } from '../systems/QuestProgress';

/** Which objectives the chart and the radar may point at a remembered hive for. Same store
 *  read and same one-projection rule as getActiveQuestMarkers, so the panel and the pins
 *  cannot disagree about what is active. */
export function getActiveQuestHazardObjectives(): QuestHazardObjective[] {
  const defs = questCatalog();
  return buildQuestHazardObjectives(load(defs).states, defs);
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
  const defs = questCatalog();
  const state = load(defs);
  const settled = settleRunScopeProgress(state.states, defs);
  const seeded = seedQuestStates(settled, defs, ACTIVE_EXPEDITION_QUEST_LIMIT);
  save({ states: seeded.states, pendingGold: state.pendingGold });
  return seeded.activatedQuestIds
    .map((questId) => defs.find((entry) => entry.id === questId))
    .filter((definition): definition is ExpeditionQuestDefinition => definition !== undefined);
}

/**
 * Folds one event in and banks whatever it earned. Storage is written only when something
 * actually changed, so the once-a-second kill poll is free on a frame that earned nothing.
 */
export function recordExpeditionQuestEvent(event: QuestEvent): ExpeditionQuestRewards {
  const defs = questCatalog();
  const state = load(defs);
  if (state.states.length === 0) return EMPTY_REWARDS;
  const result = recordQuestEvent(state.states, defs, event);

  const earned = result.stepCompletions.reduce((total, entry) => total + entry.goldReward, 0)
    + result.questCompletions.reduce((total, entry) => total + entry.goldReward, 0);
  const changed = earned > 0
    || result.activatedQuestIds.length > 0
    || result.states.some((next, index) => {
      const prior = state.states[index];
      // The stamp too: a world change can reset a distinct step to one room and leave the count
      // where it was, and a reset that is never saved is recomputed forever.
      return next.stepProgress !== prior?.stepProgress
        || next.visitedWorldStamp !== prior?.visitedWorldStamp;
    });
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

export type { QuestBoardEntry } from '../systems/QuestProgress';

/** What the walk-in board renders. Same store read and same one-projection rule as
 *  getActiveQuestStepViews: the board and the ticker cannot disagree about what is active. */
export function getQuestBoardEntries(): QuestBoardEntry[] {
  const defs = questCatalog();
  return buildQuestBoardEntries(load(defs).states, defs, ACTIVE_EXPEDITION_QUEST_LIMIT);
}

export type { QuestCargoRow } from '../systems/QuestProgress';

/**
 * The walk-in board handing over what an active delivery objective asks for. Writes only when
 * something actually loaded, so the board's re-render after an accept costs nothing.
 */
export function loadExpeditionQuestCargo(): { loaded: QuestCargoRow[]; aboard: QuestCargoRow[] } {
  const defs = questCatalog();
  const state = load(defs);
  const result = loadQuestCargo(state.states, defs);
  if (result.loaded.length > 0) {
    save({ states: result.states, pendingGold: state.pendingGold });
  }
  return { loaded: result.loaded, aboard: result.aboard };
}

/** False when the cap refused the accept, which is what the board plays an error on. Banked gold
 *  is carried through untouched: accepting a quest is not a payout event. */
export function acceptExpeditionQuest(questId: string): boolean {
  const defs = questCatalog();
  const stored = load(defs);
  const result = acceptQuest(stored.states, defs, questId, ACTIVE_EXPEDITION_QUEST_LIMIT);
  if (!result.accepted) return false;
  save({ states: result.states, pendingGold: stored.pendingGold });
  return true;
}

/** False when the quest was not active to begin with. */
export function setExpeditionQuestAside(questId: string): boolean {
  const defs = questCatalog();
  const stored = load(defs);
  const result = setQuestAside(stored.states, defs, questId);
  if (!result.changed) return false;
  save({ states: result.states, pendingGold: stored.pendingGold });
  return true;
}
