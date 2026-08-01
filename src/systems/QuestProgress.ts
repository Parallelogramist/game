import type { ExpeditionQuestDefinition, QuestTrigger } from '../data/ExpeditionQuests';
import type { SecretTier } from '../world/secretRewards';
import type { SectorTag } from '../world/sectorTags';
import type { PoiHazardKind } from '../data/PoiCatalog';

/**
 * The pure expedition-quest state machine (doc 04 section 4). No Phaser, no storage, no
 * clock: every caller hands it the states, the defs and one event, and gets new states
 * plus what those states just earned.
 *
 * The headline rule is the death rule: a completed step is a checkpoint and never
 * regresses. Only an IN-PROGRESS 'run'-scope counter is ever cleared, by
 * settleRunScopeProgress, and stepIndex only ever increases.
 */

export type QuestStatus = 'active' | 'complete';

export interface QuestInstanceState {
  questId: string;
  stepIndex: number;
  stepProgress: number;
  status: QuestStatus;
  /** Which sectors a reachSector step has already counted, so a re-entered room cannot pay
   *  twice. Absent for every other kind and cleared the moment the step completes. */
  visitedSectorKeys?: readonly string[];
  /** The world those keys were collected in. A key like `2,-1` names a different room in a
   *  regenerated world, so the set is dropped rather than added to when this does not match,
   *  which is what makes a 'persistent' distinct step safe. */
  visitedWorldStamp?: string;
}

/**
 * `kill` carries a DELTA, never a run total: the caller polls a running counter and the
 * machine accumulates, so a poll that arrives twice with the same total adds nothing.
 * `reachDepth` carries an ABSOLUTE depth and is folded with max, which is what makes a
 * re-entered sector idempotent without a visited-set to persist.
 */
export type QuestEvent =
  | { kind: 'kill'; amount: number }
  | { kind: 'reachDepth'; depth: number }
  | { kind: 'openGate' }
  | { kind: 'claimAbility'; abilityId: string }
  | { kind: 'findSecret'; secretKind: SecretTier }
  /** Every tag the entered sector answers to, the sector's own key, and the world that key
   *  belongs to: progress counts DISTINCT sectors, so a room already counted adds nothing, and
   *  a set collected in another world is dropped instead of over-crediting. */
  | { kind: 'reachSector'; sectorKey: string; sectorTags: readonly SectorTag[]; worldStamp: string }
  /** ABSOLUTE unbroken seconds held in the sector whose tags these are, folded with max: a poll
   *  that repeats cannot double-credit, and leaving restarts the producer's count at 0. */
  | { kind: 'surviveInSector'; sectorTags: readonly SectorTag[]; seconds: number }
  /** One cleared risk room, counted with +1 like a secret find. The producer fires once per
   *  hive whose wave is dead and once per hunter killed AT a woken den, so there is nothing to
   *  de-duplicate here. */
  | { kind: 'clearHazard'; hazardKind: PoiHazardKind };

export interface QuestStepCompletion {
  questId: string;
  stepId: string;
  goldReward: number;
}

export interface QuestCompletion {
  questId: string;
  goldReward: number;
}

export interface QuestProgressResult {
  states: QuestInstanceState[];
  stepCompletions: QuestStepCompletion[];
  questCompletions: QuestCompletion[];
  /** Quests that entered 'active' on this call (chain successors). */
  activatedQuestIds: string[];
}

function triggerMatches(trigger: QuestTrigger, event: QuestEvent): boolean {
  switch (event.kind) {
    case 'kill': return trigger.kind === 'kill';
    case 'reachDepth': return trigger.kind === 'reachDepth';
    case 'openGate': return trigger.kind === 'openGate';
    case 'claimAbility':
      return trigger.kind === 'claimAbility'
        && (trigger.abilityId === undefined || trigger.abilityId === event.abilityId);
    case 'findSecret':
      return trigger.kind === 'findSecret'
        && (trigger.secretKind === undefined || trigger.secretKind === event.secretKind);
    case 'reachSector':
      return trigger.kind === 'reachSector'
        && (trigger.sectorTag === undefined || event.sectorTags.includes(trigger.sectorTag));
    case 'surviveInSector':
      return trigger.kind === 'surviveInSector' && event.sectorTags.includes(trigger.sectorTag);
    case 'clearHazard':
      return trigger.kind === 'clearHazard'
        && (trigger.hazardKind === undefined || trigger.hazardKind === event.hazardKind);
    default: {
      const unhandled: never = event;
      console.warn(`Unhandled quest event kind: ${JSON.stringify(unhandled)}`);
      return false;
    }
  }
}

interface StepProgress {
  progress: number;
  visitedSectorKeys?: readonly string[];
  visitedWorldStamp?: string;
}

function foldEvent(current: StepProgress, event: QuestEvent): StepProgress {
  switch (event.kind) {
    case 'kill':
      return { ...current, progress: current.progress + Math.max(0, Math.floor(event.amount)) };
    case 'reachDepth': return { ...current, progress: Math.max(current.progress, event.depth) };
    case 'openGate': return { ...current, progress: current.progress + 1 };
    case 'claimAbility': return { ...current, progress: current.progress + 1 };
    case 'findSecret': return { ...current, progress: current.progress + 1 };
    // Distinct rooms, so a multi-destination step cannot be met by bouncing in and out of one.
    // A set collected in another world is dropped whole rather than added to: a sector key is
    // reused by a regenerated world for a different room, and over-crediting a cross-run sweep
    // is worse than restarting it.
    case 'reachSector': {
      const visited = current.visitedWorldStamp === event.worldStamp
        ? current.visitedSectorKeys ?? []
        : [];
      if (visited.includes(event.sectorKey)) return current;
      const nextVisited = [...visited, event.sectorKey];
      return {
        progress: nextVisited.length,
        visitedSectorKeys: nextVisited,
        visitedWorldStamp: event.worldStamp,
      };
    }
    // A high-water mark, so a partial dwell survives leaving the room while COMPLETION still
    // needs one visit that reaches the target.
    case 'surviveInSector':
      return { ...current, progress: Math.max(current.progress, event.seconds) };
    case 'clearHazard': return { ...current, progress: current.progress + 1 };
    default: {
      const unhandled: never = event;
      console.warn(`Unhandled quest event kind: ${JSON.stringify(unhandled)}`);
      return current;
    }
  }
}

/**
 * Folds one event into every active quest. A single event closes at most one step per
 * quest: the value it carries belongs to the step that was current when it arrived, and
 * letting it cascade would pay a second step the player never worked.
 */
export function recordQuestEvent(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  event: QuestEvent,
): QuestProgressResult {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const next: QuestInstanceState[] = states.map((state) => ({ ...state }));
  const stepCompletions: QuestStepCompletion[] = [];
  const questCompletions: QuestCompletion[] = [];
  const activatedQuestIds: string[] = [];

  for (const state of next) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    if (!definition) continue;
    const step = definition.steps[state.stepIndex];
    if (!step || !triggerMatches(step.trigger, event)) continue;

    const folded = foldEvent(
      {
        progress: state.stepProgress,
        visitedSectorKeys: state.visitedSectorKeys,
        visitedWorldStamp: state.visitedWorldStamp,
      },
      event,
    );
    if (folded.progress < step.target) {
      state.stepProgress = folded.progress;
      state.visitedSectorKeys = folded.visitedSectorKeys;
      state.visitedWorldStamp = folded.visitedWorldStamp;
      continue;
    }

    stepCompletions.push({
      questId: definition.id,
      stepId: step.id,
      goldReward: step.goldReward,
    });
    state.stepIndex += 1;
    state.stepProgress = 0;
    state.visitedSectorKeys = undefined;
    state.visitedWorldStamp = undefined;
    if (state.stepIndex >= definition.steps.length) {
      state.status = 'complete';
      questCompletions.push({
        questId: definition.id,
        goldReward: definition.completionGoldReward,
      });
    }
  }

  // Chain hand-off runs after the fold so a successor cannot also advance on the same
  // event. It ignores the accept cap deliberately: a successor is a continuation of a
  // quest the player already holds, not a fourth accept.
  for (const completion of questCompletions) {
    const successorId = byId.get(completion.questId)?.nextQuestId;
    if (!successorId || !byId.has(successorId)) continue;
    if (next.some((state) => state.questId === successorId)) continue;
    next.push({ questId: successorId, stepIndex: 0, stepProgress: 0, status: 'active' });
    activatedQuestIds.push(successorId);
  }

  return { states: next, stepCompletions, questCompletions, activatedQuestIds };
}

/**
 * Starts chains the player does not hold yet, newest never displacing oldest, up to the
 * accept cap (doc 04's anti-chore rule: at most 3 active at once). Only chain HEADS are
 * seeded: a quest another quest names as its successor is reached by finishing that one.
 */
export function seedQuestStates(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  activeLimit: number,
): { states: QuestInstanceState[]; activatedQuestIds: string[] } {
  const successorIds = new Set(
    defs.map((definition) => definition.nextQuestId).filter((id): id is string => Boolean(id)),
  );
  const held = new Set(states.map((state) => state.questId));
  const next = states.map((state) => ({ ...state }));
  const activatedQuestIds: string[] = [];
  let activeCount = next.filter((state) => state.status === 'active').length;

  for (const definition of defs) {
    if (activeCount >= activeLimit) break;
    if (successorIds.has(definition.id) || held.has(definition.id)) continue;
    if (definition.steps.length === 0) continue;
    next.push({ questId: definition.id, stepIndex: 0, stepProgress: 0, status: 'active' });
    activatedQuestIds.push(definition.id);
    activeCount += 1;
  }

  return { states: next, activatedQuestIds };
}

/**
 * The death rule. Clears the counter of an in-progress 'run'-scope step and nothing else:
 * 'persistent' counters and every completed step survive untouched.
 */
export function settleRunScopeProgress(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestInstanceState[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  return states.map((state) => {
    if (state.status !== 'active') return state;
    if (state.stepProgress === 0 && state.visitedSectorKeys === undefined) return state;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (!step || step.scope === 'persistent') return state;
    return {
      ...state,
      stepProgress: 0,
      visitedSectorKeys: undefined,
      visitedWorldStamp: undefined,
    };
  });
}

/**
 * The read model every quest surface renders from. A completed quest, a state whose
 * definition was re-authored away, and a step index past the end are all absent rather than
 * drawn blank, and progress is clamped to the target so a persistent counter that overshot a
 * step never displays as 412/400.
 */
export interface QuestStepView {
  questId: string;
  questName: string;
  stepDescription: string;
  progress: number;
  target: number;
  /** 1-based position of the current step within its quest. */
  stepNumber: number;
  stepCount: number;
}

export function buildQuestStepViews(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestStepView[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const views: QuestStepView[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || !step) continue;
    views.push({
      questId: definition.id,
      questName: definition.name,
      stepDescription: step.description,
      progress: Math.min(state.stepProgress, step.target),
      target: step.target,
      stepNumber: state.stepIndex + 1,
      stepCount: definition.steps.length,
    });
  }
  return views;
}

/**
 * Doc 04 section 4's marker feed, the half `FEAT-QUEST-VIEW` cut for having no key and no
 * consumer. One entry per active quest whose CURRENT step names a place (`reachSector`,
 * `surviveInSector`); a quest working a kill, depth, gate, ability or secret step contributes
 * nothing, because those name a thing to do rather than somewhere to be.
 */
export interface QuestMarker {
  questId: string;
  label: string;
  icon: string;
  sectorTag: SectorTag;
  /** Rooms this step has already counted. The pin must skip them or it points at a room that
   *  would grant nothing. Absent for a step that counts no sectors. */
  countedSectorKeys?: readonly string[];
}

export function buildQuestMarkers(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestMarker[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const markers: QuestMarker[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || !step) continue;
    const trigger = step.trigger;
    if (trigger.kind !== 'reachSector' && trigger.kind !== 'surviveInSector') continue;
    // A tagless breadth step names no place, so there is nothing to pin and nothing to bear on.
    if (trigger.sectorTag === undefined) continue;
    markers.push({
      questId: definition.id,
      label: definition.name,
      icon: definition.icon,
      sectorTag: trigger.sectorTag,
      countedSectorKeys: state.visitedSectorKeys,
    });
  }
  return markers;
}

/**
 * The sector a live objective asks the player to HOLD, with the seconds it asks for.
 * buildQuestMarkers deliberately merges the two place-naming kinds and so cannot answer this:
 * a reachSector step wants the ship to arrive, and only a hold step wants the room to answer.
 */
export interface QuestHoldObjective {
  questId: string;
  sectorTag: SectorTag;
  /** The step's own target, which IS the dwell in seconds (a853c83: one threshold, one field). */
  target: number;
}

export function buildQuestHoldObjectives(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestHoldObjective[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const objectives: QuestHoldObjective[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || !step) continue;
    if (step.trigger.kind !== 'surviveInSector') continue;
    objectives.push({
      questId: definition.id,
      sectorTag: step.trigger.sectorTag,
      target: step.target,
    });
  }
  return objectives;
}
