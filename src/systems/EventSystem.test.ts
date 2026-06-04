import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetEventSystem,
  getEventState,
  restoreEventState,
  getActiveEvent,
  isEventActive,
  updateEventSystem,
  getEventStatBuff,
  type RunEvent,
} from './EventSystem';

/** Minimal RunEvent stub for the pure event→buff mapping tests. */
function makeRunEvent(id: string, duration: number): RunEvent {
  return {
    id,
    name: id,
    description: '',
    color: 0,
    weight: 1,
    minGameTime: 0,
    duration,
  };
}

/**
 * Active timed events (Elite Surge / Golden Tide / Power Surge) used to be lost
 * on a mid-run refresh: getEventState/restoreEventState only round-tripped the
 * trigger timer, not the live event. These cover the active-event persistence:
 * the event id + remaining time survive a get→restore round-trip, legacy/corrupt
 * snapshots degrade gracefully, and a restored event still ticks down normally.
 */
describe('EventSystem active-event persistence', () => {
  beforeEach(() => {
    resetEventSystem();
  });

  test('round-trips a live timed event (id + remaining time) through get/restore', () => {
    restoreEventState({
      eventTimer: 12,
      nextEventInterval: 50,
      lastEventId: 'power_surge',
      activeEvent: { id: 'power_surge', remainingTime: 5 },
    });

    expect(isEventActive()).toBe(true);
    const active = getActiveEvent();
    expect(active?.event.id).toBe('power_surge');
    // The full RunEvent def is re-derived from the pool, not serialised.
    expect(active?.event.name).toBe('Power Surge');
    expect(active?.remainingTime).toBe(5);

    expect(getEventState()).toEqual({
      eventTimer: 12,
      nextEventInterval: 50,
      lastEventId: 'power_surge',
      activeEvent: { id: 'power_surge', remainingTime: 5 },
    });
  });

  test('a legacy snapshot without activeEvent restores to no active event', () => {
    // Older saves carry eventState but no activeEvent field.
    restoreEventState({ eventTimer: 3, nextEventInterval: 60, lastEventId: '' });

    expect(isEventActive()).toBe(false);
    expect(getActiveEvent()).toBeNull();
    expect(getEventState().activeEvent).toBeNull();
  });

  test('an explicit null activeEvent restores to no active event', () => {
    restoreEventState({
      eventTimer: 3,
      nextEventInterval: 60,
      lastEventId: 'golden_tide',
      activeEvent: null,
    });

    expect(isEventActive()).toBe(false);
    expect(getActiveEvent()).toBeNull();
  });

  test('an unknown event id (corrupt save) clears the active event', () => {
    restoreEventState({
      eventTimer: 0,
      nextEventInterval: 60,
      lastEventId: '',
      activeEvent: { id: 'not_a_real_event', remainingTime: 4 },
    });

    expect(isEventActive()).toBe(false);
    expect(getActiveEvent()).toBeNull();
  });

  test('a non-positive remaining time clears the active event', () => {
    restoreEventState({
      eventTimer: 0,
      nextEventInterval: 60,
      lastEventId: '',
      activeEvent: { id: 'golden_tide', remainingTime: 0 },
    });

    expect(isEventActive()).toBe(false);
  });

  test('a restored active event ticks down and expires via updateEventSystem', () => {
    restoreEventState({
      eventTimer: 0,
      nextEventInterval: 60,
      lastEventId: 'golden_tide',
      activeEvent: { id: 'golden_tide', remainingTime: 2 },
    });

    // While active, updateEventSystem decrements remaining time and fires nothing.
    expect(updateEventSystem(1.5, 100)).toBeNull();
    expect(getActiveEvent()?.remainingTime).toBeCloseTo(0.5, 5);
    expect(isEventActive()).toBe(true);

    // Next tick crosses zero → event clears (and the snapshot reflects it).
    expect(updateEventSystem(1, 100)).toBeNull();
    expect(isEventActive()).toBe(false);
    expect(getActiveEvent()).toBeNull();
    expect(getEventState().activeEvent).toBeNull();
  });

  test('resetEventSystem clears any restored active event', () => {
    restoreEventState({
      eventTimer: 0,
      nextEventInterval: 60,
      lastEventId: '',
      activeEvent: { id: 'elite_surge', remainingTime: 9 },
    });
    expect(isEventActive()).toBe(true);

    resetEventSystem();

    expect(isEventActive()).toBe(false);
    expect(getActiveEvent()).toBeNull();
    expect(getEventState().activeEvent).toBeNull();
  });
});

/**
 * The three timed *stat* events (Power Surge → damage, Elite Surge → XP, Golden
 * Tide → gem value) used to multiply their PlayerStats field and schedule the
 * revert via a Phaser `delayedCall` — a timer that dies on page reload while the
 * save bakes the already-multiplied stat, so a mid-event refresh left the boon
 * permanent (BUG-EVENT-BUFF-REVERT). The fix routes all three through the
 * gameTime-keyed timed-stat-buff list (which survives refresh). `getEventStatBuff`
 * is the pure mapping that drives that wiring: which events grant a timed stat
 * buff, on which stat, by how much, and for how long.
 */
describe('getEventStatBuff', () => {
  test('power_surge grants a 2x damage buff for the event duration', () => {
    expect(getEventStatBuff(makeRunEvent('power_surge', 8))).toEqual({
      stat: 'damageMultiplier',
      magnitude: 2,
      durationSeconds: 8,
    });
  });

  test('elite_surge grants a 2x XP buff for the event duration', () => {
    expect(getEventStatBuff(makeRunEvent('elite_surge', 10))).toEqual({
      stat: 'xpMultiplier',
      magnitude: 2,
      durationSeconds: 10,
    });
  });

  test('golden_tide grants a 3x gem-value buff for the event duration', () => {
    expect(getEventStatBuff(makeRunEvent('golden_tide', 10))).toEqual({
      stat: 'gemValueMultiplier',
      magnitude: 3,
      durationSeconds: 10,
    });
  });

  test('the buff duration tracks the event def (not a hard-coded value)', () => {
    expect(getEventStatBuff(makeRunEvent('power_surge', 12))?.durationSeconds).toBe(12);
    expect(getEventStatBuff(makeRunEvent('elite_surge', 7))?.durationSeconds).toBe(7);
  });

  test.each(['magnetic_storm', 'treasure_rain', 'shrine_bargain'])(
    '%s grants no timed stat buff',
    (eventId) => {
      expect(getEventStatBuff(makeRunEvent(eventId, 10))).toBeNull();
    },
  );
});
