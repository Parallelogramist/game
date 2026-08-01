import { describe, test, expect } from 'vitest';
import {
  CRITICAL_REPEAT_COOLDOWN_MS,
  createToastGateState,
  decideToast,
  RARE_TOASTS_PER_SESSION,
} from './toastGate';

describe('toastGate', () => {
  test('ambient never draws and never records', () => {
    expect(decideToast(createToastGateState(), 'ambient', 'COMBO x10', 0)).toBe('drop');
  });

  test('notable records instead of drawing', () => {
    expect(decideToast(createToastGateState(), 'notable', 'QUEST COMPLETE', 0)).toBe('suppress');
  });

  test('rare draws up to the session budget, then records', () => {
    const state = createToastGateState();
    for (let shown = 0; shown < RARE_TOASTS_PER_SESSION; shown++) {
      expect(decideToast(state, 'rare', `EVOLVED ${shown}`, 0)).toBe('show');
    }
    expect(decideToast(state, 'rare', 'NEMESIS SLAIN', 0)).toBe('suppress');
  });

  test('critical repeats are dropped inside the cooldown and allowed after it', () => {
    const state = createToastGateState();
    expect(decideToast(state, 'critical', 'DRONE UNDER FIRE', 0)).toBe('show');
    expect(decideToast(state, 'critical', 'DRONE UNDER FIRE', CRITICAL_REPEAT_COOLDOWN_MS - 1))
      .toBe('drop');
    expect(decideToast(state, 'critical', 'DRONE UNDER FIRE', CRITICAL_REPEAT_COOLDOWN_MS))
      .toBe('show');
  });

  test('the critical cooldown is per title', () => {
    const state = createToastGateState();
    expect(decideToast(state, 'critical', 'RECALL ENGAGED', 0)).toBe('show');
    expect(decideToast(state, 'critical', 'RECALL BROKEN', 10)).toBe('show');
  });

  test('a fresh session restores the rare budget', () => {
    const spent = createToastGateState();
    spent.rareShown = RARE_TOASTS_PER_SESSION;
    expect(decideToast(spent, 'rare', 'Ship Evolved!', 0)).toBe('suppress');
    expect(decideToast(createToastGateState(), 'rare', 'Ship Evolved!', 0)).toBe('show');
  });
});
