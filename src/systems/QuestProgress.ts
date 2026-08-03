import type {
  ExpeditionQuestDefinition,
  ExpeditionQuestStep,
  QuestTrigger,
} from '../data/ExpeditionQuests';
import type { SecretTier } from '../world/secretRewards';
import type { SectorSupplySnapshot, SectorTag } from '../world/sectorTags';
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

/**
 * 'available' is a chain the player HOLDS but has set aside at the board. It counts against
 * nothing (not the accept cap, not the fold, not any read model) and keeps everything it has
 * earned, so accepting it again resumes rather than restarts.
 */
export type QuestStatus = 'active' | 'available' | 'complete';

/** Where a `deliverItem` crate was left when the run carrying it died. */
export interface QuestCargoDrop {
  /** Compared for equality only, exactly as `visitedWorldStamp` is. */
  worldStamp: string;
  sectorKey: string;
  x: number;
  y: number;
}

/** The one definition of a world's identity for quest state. Structural rather than `WorldMap`,
 *  so this module stays free of `src/world/` runtime imports. The format is the one already
 *  stored in `visitedWorldStamp`, so existing states keep matching. */
export function questWorldStamp(map: { seed: number; worldGenVersion: number }): string {
  return `${map.seed}:v${map.worldGenVersion}`;
}

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
  /** True while a `deliverItem` step's crate is aboard. Absent for every other kind, and cleared
   *  by the death rule, by SET ASIDE and by the delivery itself: the crate is spent on arrival. */
  cargoHeld?: boolean;
  /** Set instead of clearing `cargoHeld` when the run carrying the crate died: the crate is in
   *  the world now, not aboard and not back at a board. A sector key names a different room in a
   *  regenerated world, so a drop whose stamp does not match the live world is ignored rather
   *  than pointed at, the rule `visitedWorldStamp` already obeys. */
  cargoDrop?: QuestCargoDrop;
  /** True while a `escortDrone` step's drone is assigned and alive. Absent for every other kind,
   *  and cleared by the death rule, by SET ASIDE, by the drone dying and by the arrival itself:
   *  the drone is spent on delivery exactly as the crate is. */
  droneEscorting?: boolean;
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
  /** Every tag the entered sector answers to. The crate is what makes an arrival a DELIVERY, so
   *  the hold is read by the fold and not by the match: arriving at the right place with an empty
   *  hold must count nothing rather than count as a delivery. */
  | { kind: 'deliverItem'; sectorTags: readonly SectorTag[] }
  /** Every tag the sector the DRONE just entered answers to. The producer is the drone's own
   *  position, not the ship's: an escort that the player outran and left two rooms back has not
   *  arrived, which is the entire difference between this kind and deliverItem. */
  | { kind: 'escortDrone'; sectorTags: readonly SectorTag[] }
  /** One cleared risk room, counted with +1 like a secret find. The producer fires once per
   *  hive whose wave is dead and once per hunter killed AT a woken den, so there is nothing to
   *  de-duplicate here. */
  | { kind: 'clearHazard'; hazardKind: PoiHazardKind }
  /** One expedition victory: the world's boss is dead. `firstConquest` is the read-before-write
   *  answer to "was this world already conquered", so a step narrowed by `distinctWorlds` counts
   *  a world once however many times it is re-won. */
  | { kind: 'conquerWorld'; firstConquest: boolean };

export interface QuestStepCompletion {
  questId: string;
  stepId: string;
  goldReward: number;
}

export interface QuestCompletion {
  questId: string;
  goldReward: number;
  /** Straight from the definition's completionRelicRoll. Left undefined rather than false when
   *  the quest pays no relic, so a completion object stays deep-equal to the one it was before
   *  this field existed. */
  relicRoll?: boolean;
}

export interface QuestProgressResult {
  states: QuestInstanceState[];
  stepCompletions: QuestStepCompletion[];
  questCompletions: QuestCompletion[];
  /** Quests that entered 'active' on this call (chain successors). */
  activatedQuestIds: string[];
}

/**
 * The tiers a `findSecret` trigger accepts. Exported because the census, the contract-ordering
 * invariant in seasonQuests.test.ts and `triggerMatches` must all agree, and a private copy in a
 * test file already drifted once.
 *
 * A sigil ring and a region capstone both seal a CACHE slot (buildRegionVaults picks the vault
 * out of the region's own Secret slots, and picks a ring-free one, so the two can never be the
 * same find), so a step that asks for a cache is satisfied by either. Never the reverse: a ring
 * or capstone step must not be met by walking into an open one.
 */
export function secretTiersMatched(trigger: QuestTrigger): ReadonlySet<SecretTier> {
  if (trigger.kind !== 'findSecret') return new Set<SecretTier>();
  if (trigger.secretKind === undefined) {
    return new Set<SecretTier>(['cache', 'hiddenSector', 'puzzle', 'capstone']);
  }
  if (trigger.secretKind === 'cache') {
    return new Set<SecretTier>(['cache', 'puzzle', 'capstone']);
  }
  return new Set<SecretTier>([trigger.secretKind]);
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
        && secretTiersMatched(trigger).has(event.secretKind);
    case 'reachSector':
      return trigger.kind === 'reachSector'
        && (trigger.sectorTag === undefined || event.sectorTags.includes(trigger.sectorTag));
    case 'surviveInSector':
      return trigger.kind === 'surviveInSector' && event.sectorTags.includes(trigger.sectorTag);
    case 'deliverItem':
      return trigger.kind === 'deliverItem'
        && event.sectorTags.includes(trigger.destinationTag);
    case 'escortDrone':
      return trigger.kind === 'escortDrone'
        && event.sectorTags.includes(trigger.destinationTag);
    case 'clearHazard':
      return trigger.kind === 'clearHazard'
        && (trigger.hazardKind === undefined || trigger.hazardKind === event.hazardKind);
    case 'conquerWorld':
      return trigger.kind === 'conquerWorld'
        && (trigger.distinctWorlds !== true || event.firstConquest);
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
  cargoHeld?: boolean;
  droneEscorting?: boolean;
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
    // The crate is spent on the drop-off, so a step asking for two deliveries needs two loads.
    case 'deliverItem':
      return current.cargoHeld === true
        ? { ...current, progress: current.progress + 1, cargoHeld: undefined }
        : current;
    // The drone is spent on arrival, so a step asking for two escorts needs two assignments.
    case 'escortDrone':
      return current.droneEscorting === true
        ? { ...current, progress: current.progress + 1, droneEscorting: undefined }
        : current;
    case 'clearHazard': return { ...current, progress: current.progress + 1 };
    case 'conquerWorld': return { ...current, progress: current.progress + 1 };
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
/**
 * What a step's target means in the world being flown. Only `reachSector` counts distinct
 * rooms, so only it can ask for more than a world holds: `assignDangerAndBiomes` gives each
 * depth band one biome, so a region's room count is a property of the seed. Measured over 500
 * seeds, 12 hold fewer than the six Inferno rooms `q_gatecrash_02.s5` asks for, which parked
 * that chain forever. Every other trigger counts kills, seconds, gates or items and is not
 * world-bound. A null supply (arena, daily, gauntlet, practice: no world map) means the
 * authored target stands.
 *
 * The floor of 1 is not cosmetic: a zero-supply tag clamped to 0 would satisfy `progress >=
 * target` on the spot and pay the step's gold for nothing. No shipped tag measures zero, so
 * the floor is the guard rather than the behaviour.
 */
export function effectiveStepTarget(
  step: ExpeditionQuestStep,
  supply: SectorSupplySnapshot | null | undefined,
): number {
  if (!supply || step.trigger.kind !== 'reachSector') return step.target;
  const available = step.trigger.sectorTag === undefined
    ? supply.anyTag
    : (supply.byTag[step.trigger.sectorTag] ?? 0);
  return Math.max(1, Math.min(step.target, available));
}

/** A description may carry `{target}` so a clamped step does not read a number it no longer
 *  asks for. A description without the token renders unchanged. */
export function renderStepDescription(step: ExpeditionQuestStep, target: number): string {
  return step.description.replace('{target}', String(target));
}

export function recordQuestEvent(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  event: QuestEvent,
  supply?: SectorSupplySnapshot | null,
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
        cargoHeld: state.cargoHeld,
        droneEscorting: state.droneEscorting,
      },
      event,
    );
    if (folded.progress < effectiveStepTarget(step, supply)) {
      state.stepProgress = folded.progress;
      state.visitedSectorKeys = folded.visitedSectorKeys;
      state.visitedWorldStamp = folded.visitedWorldStamp;
      state.cargoHeld = folded.cargoHeld;
      state.droneEscorting = folded.droneEscorting;
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
    state.cargoHeld = undefined;
    state.cargoDrop = undefined;
    state.droneEscorting = undefined;
    if (state.stepIndex >= definition.steps.length) {
      state.status = 'complete';
      questCompletions.push({
        questId: definition.id,
        goldReward: definition.completionGoldReward,
        relicRoll: definition.completionRelicRoll,
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
 * The board's ACCEPT. The cap is enforced HERE rather than in the overlay, because a second copy
 * of the rule in the UI is how the board and seedQuestStates come to disagree about how many
 * objectives a player may hold. A refused accept returns `accepted: false` and untouched states.
 */
export function acceptQuest(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  questId: string,
  activeLimit: number,
): { states: QuestInstanceState[]; accepted: boolean } {
  const copied = states.map((state) => ({ ...state }));
  const definition = defs.find((entry) => entry.id === questId);
  if (!definition || definition.steps.length === 0) return { states: copied, accepted: false };
  if (copied.filter((state) => state.status === 'active').length >= activeLimit) {
    return { states: copied, accepted: false };
  }

  const held = copied.find((state) => state.questId === questId);
  if (held) {
    if (held.status !== 'available') return { states: copied, accepted: false };
    held.status = 'active';
    return { states: copied, accepted: true };
  }
  copied.push({ questId, stepIndex: 0, stepProgress: 0, status: 'active' });
  return { states: copied, accepted: true };
}

/**
 * The board's SET ASIDE, the only way to free an accept slot. It destroys nothing the chain has
 * earned: the step index and every 'persistent' counter survive, and only the in-progress
 * 'run'-scope counter is cleared, which is the death rule (settleRunScopeProgress) applied to one
 * quest. A run counter left standing while the quest sat on the board would be credited to
 * whichever later run happened to re-accept it.
 */
export function setQuestAside(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  questId: string,
): { states: QuestInstanceState[]; changed: boolean } {
  const copied = states.map((state) => ({ ...state }));
  const target = copied.find((state) => state.questId === questId);
  if (!target || target.status !== 'active') return { states: copied, changed: false };

  const step = defs.find((definition) => definition.id === questId)?.steps[target.stepIndex];
  target.status = 'available';
  if (step && step.scope === 'run') {
    target.stepProgress = 0;
    target.visitedSectorKeys = undefined;
    target.visitedWorldStamp = undefined;
    target.cargoHeld = undefined;
    target.cargoDrop = undefined;
    target.droneEscorting = undefined;
  }
  return { states: copied, changed: true };
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
    if (state.stepProgress === 0
      && state.visitedSectorKeys === undefined
      && state.cargoHeld !== true
      && state.droneEscorting !== true) return state;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (!step || step.scope === 'persistent') return state;
    return {
      ...state,
      stepProgress: 0,
      visitedSectorKeys: undefined,
      visitedWorldStamp: undefined,
      cargoHeld: undefined,
      droneEscorting: undefined,
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
  /** Gold this step pays the moment it completes. */
  stepGoldReward: number;
  /** Gold the rest of this chain still pays from this step on, its completion bonus included. */
  chainGoldRemaining: number;
  /** A clause the ticker, the OBJECTIVES panel and nothing else render: what a delivery or escort
   *  step is waiting on. Absent for every kind that needs no second state to be legible. */
  note?: string;
}

const CARGO_ABOARD_NOTE = 'CARGO ABOARD';
const BOARD_COLLECT_NOTE = 'COLLECT AT A BOARD';
const DRONE_ESCORT_NOTE = 'DRONE ESCORTING';
const CARGO_ADRIFT_NOTE = 'CARGO ADRIFT';

function cargoNote(state: QuestInstanceState, worldStamp: string): string {
  const drop = state.cargoDrop;
  if (drop !== undefined && drop.worldStamp === worldStamp) {
    return `${CARGO_ADRIFT_NOTE} · ${drop.sectorKey}`;
  }
  return state.cargoHeld === true ? CARGO_ABOARD_NOTE : BOARD_COLLECT_NOTE;
}

/**
 * Gold a chain still pays from `stepIndex` onward, its completion bonus included. The board's
 * `goldRemaining` and the briefing's per-objective payout are the same number, so they share the
 * arithmetic rather than each restating it.
 */
export function remainingChainGold(
  definition: ExpeditionQuestDefinition,
  stepIndex: number,
): number {
  return definition.steps.slice(stepIndex).reduce((total, step) => total + step.goldReward, 0)
    + definition.completionGoldReward;
}

export function buildQuestStepViews(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  worldStamp: string,
  supply?: SectorSupplySnapshot | null,
): QuestStepView[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const views: QuestStepView[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || !step) continue;
    const target = effectiveStepTarget(step, supply);
    views.push({
      questId: definition.id,
      questName: definition.name,
      stepDescription: renderStepDescription(step, target),
      progress: Math.min(state.stepProgress, target),
      target,
      stepNumber: state.stepIndex + 1,
      stepCount: definition.steps.length,
      stepGoldReward: step.goldReward,
      chainGoldRemaining: remainingChainGold(definition, state.stepIndex),
      note: step.trigger.kind === 'deliverItem'
        ? cargoNote(state, worldStamp)
        : step.trigger.kind === 'escortDrone'
          ? (state.droneEscorting === true ? DRONE_ESCORT_NOTE : BOARD_COLLECT_NOTE)
          : undefined,
    });
  }
  return views;
}

/**
 * Every active step whose progress belongs to ONE world: a `reachSector` sweep that has counted
 * at least one room. The stamp travels with the row so both consumers can ask their own
 * question of it. The CHART dialog wants the rows whose stamp IS the world being traded away
 * (those restart); a run binding a world wants the rows whose stamp is NOT it (those already
 * have).
 */
export interface WorldBoundStepProgress {
  questId: string;
  questName: string;
  stepDescription: string;
  /** Rooms already counted. Never zero: an empty set is nothing to warn about or announce. */
  roomsCounted: number;
  worldStamp: string;
}

export function worldBoundStepProgress(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): WorldBoundStepProgress[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const rows: WorldBoundStepProgress[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || !step) continue;
    if (step.trigger.kind !== 'reachSector') continue;
    const roomsCounted = state.visitedSectorKeys?.length ?? 0;
    const worldStamp = state.visitedWorldStamp;
    if (worldStamp === undefined || roomsCounted === 0) continue;
    rows.push({
      questId: definition.id,
      questName: definition.name,
      // No supply snapshot: this is read from a menu with no world loaded, and the authored
      // target is the honest number there. The live clamp stays buildQuestStepViews' job.
      stepDescription: renderStepDescription(step, effectiveStepTarget(step, undefined)),
      roomsCounted,
      worldStamp,
    });
  }
  return rows;
}

/**
 * The eager form of a drop `foldQuestEvent` already performs lazily. Its `reachSector` branch
 * discards a visited set collected under another stamp, but only when the next room-entry event
 * arrives, so until the ship crosses a door the read model still renders the world the player
 * left. Doing it when the world binds is what makes the ticker honest on the first frame; the
 * outcome is identical, because a run cannot reach a `reachSector` event without entering a
 * room first.
 */
export function dropStaleWorldBoundProgress(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  worldStamp: string,
): { states: QuestInstanceState[]; dropped: WorldBoundStepProgress[] } {
  const dropped = worldBoundStepProgress(states, defs)
    .filter((row) => row.worldStamp !== worldStamp);
  if (dropped.length === 0) return { states: [...states], dropped };
  const staleQuestIds = new Set(dropped.map((row) => row.questId));
  const next = states.map((state) => (staleQuestIds.has(state.questId)
    ? {
      ...state,
      stepProgress: 0,
      visitedSectorKeys: undefined,
      visitedWorldStamp: undefined,
    }
    : state));
  return { states: next, dropped };
}

/**
 * Doc 04 section 4's marker feed, the half `FEAT-QUEST-VIEW` cut for having no key and no
 * consumer. One entry per active quest whose CURRENT step names a place (`reachSector`,
 * `surviveInSector`, `conquerWorld`); a quest working a kill, depth, gate, ability or secret
 * step contributes nothing, because those name a thing to do rather than somewhere to be.
 */
export interface QuestMarker {
  questId: string;
  label: string;
  icon: string;
  sectorTag: SectorTag;
  /** Rooms this step has already counted. The pin must skip them or it points at a room that
   *  would grant nothing. Absent for a step that counts no sectors. */
  countedSectorKeys?: readonly string[];
  /** A pin that names a ROOM rather than a tag: a dropped crate is at one known position, not
   *  wherever the nearest matching sector happens to be. When present it IS the pin. */
  sectorKey?: string;
}

export function buildQuestMarkers(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  worldStamp: string,
): QuestMarker[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const markers: QuestMarker[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || !step) continue;
    const trigger = step.trigger;
    if (trigger.kind === 'deliverItem') {
      // A dropped crate makes the next place the room it is lying in: not the destination, which
      // it cannot reach, and not a board, which will not re-issue it.
      const drop = state.cargoDrop;
      if (drop !== undefined && drop.worldStamp === worldStamp) {
        markers.push({
          questId: definition.id,
          label: definition.name,
          icon: definition.icon,
          sectorTag: trigger.destinationTag,
          sectorKey: drop.sectorKey,
        });
        continue;
      }
      // An empty hold means the next place is a BOARD, and every charted board already draws its
      // own QuestGiver glyph, so a destination pin here would name the wrong errand.
      if (state.cargoHeld !== true) continue;
      markers.push({
        questId: definition.id,
        label: definition.name,
        icon: definition.icon,
        sectorTag: trigger.destinationTag,
      });
      continue;
    }
    if (trigger.kind === 'escortDrone') {
      // No drone means the next place is a BOARD, and every charted board already draws its own
      // QuestGiver glyph, so a destination pin here would name the wrong errand.
      if (state.droneEscorting !== true) continue;
      markers.push({
        questId: definition.id,
        label: definition.name,
        icon: definition.icon,
        sectorTag: trigger.destinationTag,
      });
      continue;
    }
    if (trigger.kind === 'conquerWorld') {
      // Where you go to take the Warden on purpose. The patient timed spawn can still field the
      // boss wherever the ship stands, so the pin is guidance rather than a requirement, and it
      // resolves to null until the arena is charted like every other marker.
      markers.push({
        questId: definition.id,
        label: definition.name,
        icon: definition.icon,
        sectorTag: 'boss-arena',
      });
      continue;
    }
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

/**
 * The objectives asking for a cleared risk room. A step naming 'lair' is deliberately absent:
 * a lair is placed only while the profile holds an unspawned nemesis and at most once per
 * world per run, so it is never remembered and there is nothing to point at. An omitted
 * hazardKind counts either fight, and a remembered hive satisfies it.
 */
export interface QuestHazardObjective {
  questId: string;
  label: string;
}

export function buildQuestHazardObjectives(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestHazardObjective[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const objectives: QuestHazardObjective[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || !step) continue;
    if (step.trigger.kind !== 'clearHazard') continue;
    if (step.trigger.hazardKind === 'lair') continue;
    objectives.push({ questId: definition.id, label: definition.name });
  }
  return objectives;
}

/**
 * What the walk-in board renders: one row per chain the player may act on. The offerable set is
 * every chain HEAD plus every chain the profile already holds, which is what lets a successor the
 * player set aside be picked back up while an unreached successor stays out of the list (it is
 * reached by finishing its predecessor, never accepted).
 */
export interface QuestBoardEntry {
  questId: string;
  name: string;
  icon: string;
  status: QuestStatus;
  /** The step the player would work next; the last step for a finished chain. */
  stepDescription: string;
  progress: number;
  target: number;
  /** 1-based position of that step within its chain. */
  stepNumber: number;
  stepCount: number;
  /** Gold the rest of this chain still pays, including its completion bonus. 0 once complete. */
  goldRemaining: number;
  /** Whether finishing this quest also pays a relic roll, so the board can say so before the
   *  player commits to the chain. */
  relicOnCompletion: boolean;
  /** True only where the board would take the accept RIGHT NOW: available AND under the cap. */
  acceptable: boolean;
}

export function buildQuestBoardEntries(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  activeLimit: number,
  supply?: SectorSupplySnapshot | null,
): QuestBoardEntry[] {
  const successorIds = new Set(
    defs.map((definition) => definition.nextQuestId).filter((id): id is string => Boolean(id)),
  );
  const byQuestId = new Map(states.map((state) => [state.questId, state]));
  const capReached = states.filter((state) => state.status === 'active').length >= activeLimit;

  const entries: QuestBoardEntry[] = [];
  for (const definition of defs) {
    if (definition.steps.length === 0) continue;
    const held = byQuestId.get(definition.id);
    if (successorIds.has(definition.id) && !held) continue;

    const status = held?.status ?? 'available';
    const stepIndex = Math.min(held?.stepIndex ?? 0, definition.steps.length - 1);
    const step = definition.steps[stepIndex];
    const target = effectiveStepTarget(step, supply);
    entries.push({
      questId: definition.id,
      name: definition.name,
      icon: definition.icon,
      status,
      stepDescription: renderStepDescription(step, target),
      progress: status === 'complete' ? target : Math.min(held?.stepProgress ?? 0, target),
      target,
      stepNumber: stepIndex + 1,
      stepCount: definition.steps.length,
      goldRemaining: status === 'complete' ? 0 : remainingChainGold(definition, stepIndex),
      relicOnCompletion: definition.completionRelicRoll === true,
      acceptable: status === 'available' && !capReached,
    });
  }

  // Complete chains sink to the end: they are a record, not a choice, and keeping them out of the
  // navigator's leading run means the focused card is always one the player can act on.
  return [
    ...entries.filter((entry) => entry.status !== 'complete'),
    ...entries.filter((entry) => entry.status === 'complete'),
  ];
}

export interface QuestCargoRow {
  questId: string;
  itemId: string;
}

export interface QuestCargoLoad {
  states: QuestInstanceState[];
  /** Crates this call just handed over. */
  loaded: QuestCargoRow[];
  /** Crates already aboard before this call, so the board can say so without loading twice. */
  aboard: QuestCargoRow[];
}

/**
 * What a walk-in board hands over: the crate for every ACTIVE quest whose current step is a
 * delivery. Idempotent, which is what lets the board call it on every re-render: a crate already
 * aboard is reported in `aboard` and never re-loaded, so nothing is duplicated and no state moves.
 *
 * The board issues the crate rather than a world pickup doing it: the crate is a boolean on the
 * quest state, so there is no entity to rematerialize after a refresh and no serializer exemption
 * to ask FEAT-WORLDGEN-STREAM for.
 */
export function loadQuestCargo(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestCargoLoad {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const next = states.map((state) => ({ ...state }));
  const loaded: QuestCargoRow[] = [];
  const aboard: QuestCargoRow[] = [];
  for (const state of next) {
    if (state.status !== 'active') continue;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (step?.trigger.kind !== 'deliverItem') continue;
    const row = { questId: state.questId, itemId: step.trigger.itemId };
    if (state.cargoHeld === true) {
      aboard.push(row);
      continue;
    }
    state.cargoHeld = true;
    loaded.push(row);
  }
  return { states: next, loaded, aboard };
}

export interface QuestDroneRow {
  questId: string;
  droneId: string;
}

export interface QuestDroneAssignment {
  states: QuestInstanceState[];
  /** Drones this call just assigned. */
  assigned: QuestDroneRow[];
  /** Drones already under way before this call, so the board can say so without re-assigning. */
  active: QuestDroneRow[];
}

/**
 * What a walk-in board hands over for an escort objective: the drone for every ACTIVE quest whose
 * current step is an escort. Idempotent for the reason loadQuestCargo is, and so that the board
 * may call it on every re-render: a drone already under way is reported in `active` and never
 * re-assigned, so a player cannot stack two drones on one step by walking back to the board.
 */
export function assignQuestDrone(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestDroneAssignment {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const next = states.map((state) => ({ ...state }));
  const assigned: QuestDroneRow[] = [];
  const active: QuestDroneRow[] = [];
  for (const state of next) {
    if (state.status !== 'active') continue;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (step?.trigger.kind !== 'escortDrone') continue;
    const row = { questId: state.questId, droneId: step.trigger.droneId };
    if (state.droneEscorting === true) {
      active.push(row);
      continue;
    }
    state.droneEscorting = true;
    assigned.push(row);
  }
  return { states: next, assigned, active };
}

/**
 * The drone died. Doc 04 section 4's escort rule is fail-and-retry, never fail-forever, so this
 * clears the flag and nothing else: the step's counter, its index and every completed step are
 * untouched, and the player picks up another drone at any board.
 */
export function dropQuestDrone(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): { states: QuestInstanceState[]; dropped: QuestDroneRow[] } {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const next = states.map((state) => ({ ...state }));
  const dropped: QuestDroneRow[] = [];
  for (const state of next) {
    if (state.status !== 'active' || state.droneEscorting !== true) continue;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (step?.trigger.kind !== 'escortDrone') continue;
    state.droneEscorting = undefined;
    dropped.push({ questId: state.questId, droneId: step.trigger.droneId });
  }
  return { states: next, dropped };
}

/**
 * The run carrying the crate ended in the room named by `drop`. The hold becomes a position:
 * the crate is a thing in the world, not something a board re-issues. Returns what was dropped
 * so the scene can name it.
 */
export function dropQuestCargo(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  drop: QuestCargoDrop,
): { states: QuestInstanceState[]; dropped: QuestCargoRow[] } {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const next = states.map((state) => ({ ...state }));
  const dropped: QuestCargoRow[] = [];
  for (const state of next) {
    if (state.status !== 'active' || state.cargoHeld !== true) continue;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (step?.trigger.kind !== 'deliverItem') continue;
    state.cargoHeld = undefined;
    state.cargoDrop = { ...drop };
    dropped.push({ questId: state.questId, itemId: step.trigger.itemId });
  }
  return { states: next, dropped };
}

/**
 * Walking into the crate puts it back aboard. Keyed on the quest rather than on a position: the
 * scene built the object FROM this state, so it already knows whose crate it touched, and a
 * position compare here would be a second source of truth for one thing.
 */
export function reclaimQuestCargo(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  questId: string,
): { states: QuestInstanceState[]; reclaimed: QuestCargoRow | null } {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const next = states.map((state) => ({ ...state }));
  const target = next.find((state) => state.questId === questId);
  if (!target || target.status !== 'active' || target.cargoDrop === undefined) {
    return { states: next, reclaimed: null };
  }
  const step = byId.get(questId)?.steps[target.stepIndex];
  if (step?.trigger.kind !== 'deliverItem') return { states: next, reclaimed: null };
  target.cargoDrop = undefined;
  target.cargoHeld = true;
  return { states: next, reclaimed: { questId, itemId: step.trigger.itemId } };
}

/**
 * The escort the scene should have a drone standing for, if any. buildQuestMarkers cannot answer
 * this: it names the destination to PIN, and the scene needs the drone's identity to decide
 * whether the object in the room is still the right one.
 */
export interface QuestEscortObjective {
  questId: string;
  droneId: string;
  destinationTag: SectorTag;
}

export function buildQuestEscortObjectives(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
): QuestEscortObjective[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const objectives: QuestEscortObjective[] = [];
  for (const state of states) {
    if (state.status !== 'active' || state.droneEscorting !== true) continue;
    const definition = byId.get(state.questId);
    const step = definition?.steps[state.stepIndex];
    if (!definition || step?.trigger.kind !== 'escortDrone') continue;
    objectives.push({
      questId: definition.id,
      droneId: step.trigger.droneId,
      destinationTag: step.trigger.destinationTag,
    });
  }
  return objectives;
}

/** The crate the scene should have an object standing for in this world, if any. */
export interface QuestCargoDropObjective {
  questId: string;
  itemId: string;
  drop: QuestCargoDrop;
}

export function buildQuestCargoDropObjectives(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  worldStamp: string,
): QuestCargoDropObjective[] {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const objectives: QuestCargoDropObjective[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const drop = state.cargoDrop;
    if (drop === undefined || drop.worldStamp !== worldStamp) continue;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (step?.trigger.kind !== 'deliverItem') continue;
    objectives.push({ questId: state.questId, itemId: step.trigger.itemId, drop });
  }
  return objectives;
}

export interface QuestCargoStatus {
  /** Delivery steps whose crate is still waiting at a board: not aboard, and not lying in this
   *  world where a run dropped it. This is what puts a crate beside a board. */
  pending: QuestCargoRow[];
  /** Delivery steps whose crate is already aboard. */
  aboard: QuestCargoRow[];
}

/**
 * The three-way split every cargo surface reads. A drop stamped for ANOTHER world is pending,
 * not adrift, which is the same call `cargoNote` already makes when it falls through to
 * BOARD_COLLECT_NOTE: that crate is unreachable from here, so a board must re-issue it.
 */
export function buildQuestCargoStatus(
  states: readonly QuestInstanceState[],
  defs: readonly ExpeditionQuestDefinition[],
  worldStamp: string,
): QuestCargoStatus {
  const byId = new Map(defs.map((definition) => [definition.id, definition]));
  const pending: QuestCargoRow[] = [];
  const aboard: QuestCargoRow[] = [];
  for (const state of states) {
    if (state.status !== 'active') continue;
    const step = byId.get(state.questId)?.steps[state.stepIndex];
    if (step?.trigger.kind !== 'deliverItem') continue;
    const row = { questId: state.questId, itemId: step.trigger.itemId };
    if (state.cargoHeld === true) {
      aboard.push(row);
      continue;
    }
    const drop = state.cargoDrop;
    if (drop !== undefined && drop.worldStamp === worldStamp) continue;
    pending.push(row);
  }
  return { pending, aboard };
}
