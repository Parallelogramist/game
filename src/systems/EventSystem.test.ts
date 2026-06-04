import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetEventSystem,
  getEventState,
  restoreEventState,
  getActiveEvent,
  isEventActive,
  updateEventSystem,
} from './EventSystem';

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
