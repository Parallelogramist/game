/**
 * EventSystem triggers random in-run events to break monotony and create variety.
 *
 * Module-level state pattern — no class, just exported functions.
 * Call resetEventSystem() in GameScene.create() to clear state between runs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunEvent {
  id: string;
  name: string;
  description: string;
  color: number;
  weight: number;
  minGameTime: number;
  duration: number;
}

export interface ActiveEventState {
  event: RunEvent;
  remainingTime: number;
}

// ---------------------------------------------------------------------------
// Event Pool
// ---------------------------------------------------------------------------

const EVENT_POOL: readonly RunEvent[] = [
  {
    id: 'elite_surge',
    name: 'Elite Surge!',
    description: 'Double spawns, double XP!',
    color: 0xff6644,
    weight: 20,
    minGameTime: 60,
    duration: 10,
  },
  {
    id: 'golden_tide',
    name: 'Golden Tide',
    description: 'All XP gems worth 3x!',
    color: 0xffdd44,
    weight: 25,
    minGameTime: 45,
    duration: 10,
  },
  {
    id: 'magnetic_storm',
    name: 'Magnetic Storm',
    description: 'All gems fly to you!',
    color: 0x44aaff,
    weight: 15,
    minGameTime: 90,
    duration: 0,
  },
  {
    id: 'treasure_rain',
    name: 'Treasure Rain',
    description: 'Chests incoming!',
    color: 0xff88ff,
    weight: 10,
    minGameTime: 120,
    duration: 0,
  },
  {
    id: 'power_surge',
    name: 'Power Surge',
    description: 'Massive damage boost!',
    color: 0xff4444,
    weight: 15,
    minGameTime: 60,
    duration: 8,
  },
] as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_EVENT_INTERVAL = 45;
const MAX_EVENT_INTERVAL = 75;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let eventTimer = 0;
let nextEventInterval = 0;
let activeEvent: ActiveEventState | null = null;
let lastEventId = '';
let eventHistory: string[] = [];
let suppressEvents = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a random number between min (inclusive) and max (inclusive). */
function randomIntervalSeconds(minSeconds: number, maxSeconds: number): number {
  return minSeconds + Math.random() * (maxSeconds - minSeconds);
}

/**
 * Picks a weighted-random event from eligible candidates.
 *
 * Eligible events must:
 *  - Have minGameTime <= current gameTime
 *  - Not be the same as lastEventId (to prevent immediate repeats)
 *
 * Returns null if no events are eligible.
 */
function pickWeightedEvent(gameTime: number): RunEvent | null {
  const eligibleEvents = EVENT_POOL.filter(
    (candidateEvent) =>
      candidateEvent.id !== lastEventId &&
      gameTime >= candidateEvent.minGameTime
  );

  if (eligibleEvents.length === 0) return null;

  const totalWeight = eligibleEvents.reduce(
    (weightSum, candidateEvent) => weightSum + candidateEvent.weight,
    0
  );

  let randomRoll = Math.random() * totalWeight;

  for (const candidateEvent of eligibleEvents) {
    randomRoll -= candidateEvent.weight;
    if (randomRoll <= 0) {
      return candidateEvent;
    }
  }

  // Fallback — should not be reached, but satisfies the type checker
  return eligibleEvents[eligibleEvents.length - 1];
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Resets all event state to defaults.
 * Must be called in GameScene.create() before the game loop starts.
 */
export function resetEventSystem(): void {
  eventTimer = 0;
  nextEventInterval = randomIntervalSeconds(MIN_EVENT_INTERVAL, MAX_EVENT_INTERVAL);
  activeEvent = null;
  lastEventId = '';
  eventHistory = [];
  suppressEvents = false;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Advances event timers each frame.
 *
 * - If a timed event is active, decrements its remaining time and clears it
 *   when expired.
 * - Otherwise, accumulates the event timer and attempts to trigger a new
 *   event once the interval elapses.
 *
 * @param deltaSeconds - Frame delta already converted to seconds.
 * @param gameTime     - Total elapsed game time in seconds (for minGameTime checks).
 * @returns The newly triggered RunEvent, or null if nothing fired this frame.
 */
export function updateEventSystem(
  deltaSeconds: number,
  gameTime: number
): RunEvent | null {
  // --- Tick down active timed event ---
  if (activeEvent !== null) {
    activeEvent.remainingTime -= deltaSeconds;

    if (activeEvent.remainingTime <= 0) {
      activeEvent = null;
    }

    return null;
  }

  // --- Suppressed (e.g. during boss warning) ---
  if (suppressEvents) {
    return null;
  }

  // --- Accumulate timer and check for trigger ---
  eventTimer += deltaSeconds;

  if (eventTimer < nextEventInterval) {
    return null;
  }

  // Timer elapsed — attempt to pick an event
  eventTimer = 0;
  nextEventInterval = randomIntervalSeconds(MIN_EVENT_INTERVAL, MAX_EVENT_INTERVAL);

  const selectedEvent = pickWeightedEvent(gameTime);

  if (selectedEvent === null) {
    return null;
  }

  // Record the event
  lastEventId = selectedEvent.id;
  eventHistory.push(selectedEvent.id);

  // If the event has a duration, activate it as a timed event
  if (selectedEvent.duration > 0) {
    activeEvent = {
      event: selectedEvent,
      remainingTime: selectedEvent.duration,
    };
  }

  return selectedEvent;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Returns the currently active timed event, or null if none is running. */
export function getActiveEvent(): ActiveEventState | null {
  return activeEvent;
}

/** Returns true if a timed event is currently active. */
export function isEventActive(): boolean {
  return activeEvent !== null;
}

/** Suppresses or un-suppresses event triggering (used during boss warnings). */
export function setSuppressEvents(suppress: boolean): void {
  suppressEvents = suppress;
}

/** Returns all event IDs triggered during this run, in order. */
export function getEventHistory(): string[] {
  return eventHistory;
}

// ---------------------------------------------------------------------------
// Save / Restore
// ---------------------------------------------------------------------------

/** Serialises the event state for mid-run saves. */
export function getEventState(): {
  eventTimer: number;
  nextEventInterval: number;
  lastEventId: string;
} {
  return {
    eventTimer,
    nextEventInterval,
    lastEventId,
  };
}

/** Restores event state from a previous save. */
export function restoreEventState(state: {
  eventTimer: number;
  nextEventInterval: number;
  lastEventId: string;
}): void {
  eventTimer = state.eventTimer;
  nextEventInterval = state.nextEventInterval;
  lastEventId = state.lastEventId;
}
