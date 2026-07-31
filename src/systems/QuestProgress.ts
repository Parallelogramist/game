import type { ExpeditionQuestDefinition, QuestTrigger } from '../data/ExpeditionQuests';
import type { SecretTier } from '../world/secretRewards';

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
  | { kind: 'findSecret'; secretKind: SecretTier };

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
    default: {
      const unhandled: never = event;
      console.warn(`Unhandled quest event kind: ${JSON.stringify(unhandled)}`);
      return false;
    }
  }
}

function foldEvent(progress: number, event: QuestEvent): number {
  switch (event.kind) {
    case 'kill': return progress + Math.max(0, Math.floor(event.amount));
    case 'reachDepth': return Math.max(progress, event.depth);
    case 'openGate': return progress + 1;
    case 'claimAbility': return progress + 1;
    case 'findSecret': return progress + 1;
    default: {
      const unhandled: never = event;
      console.warn(`Unhandled quest event kind: ${JSON.stringify(unhandled)}`);
      return progress;
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

    const value = foldEvent(state.stepProgress, event);
    if (value < step.target) {
      state.stepProgress = value;
      continue;
    }

    stepCompletions.push({
      questId: definition.id,
      stepId: step.id,
      goldReward: step.goldReward,
    });
    state.stepIndex += 1;
    state.stepProgress = 0;
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
    if (state.status !== 'active' || state.stepProgress === 0) return state;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (!step || step.scope === 'persistent') return state;
    return { ...state, stepProgress: 0 };
  });
}

/**
 * The read model every quest surface renders from. A completed quest, a state whose
 * definition was re-authored away, and a step index past the end are all absent rather than
 * drawn blank, and progress is clamped to the target so a persistent counter that overshot a
 * step never displays as 412/400.
 */
export interface QuestStepView {
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
