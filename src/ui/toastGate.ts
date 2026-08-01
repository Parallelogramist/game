/**
 * toastGate — the pure decision half of the toast diet. A run used to fire 30 to 60
 * toasts; the operator wants one or two. Kept Phaser-free so the budget and the cooldown
 * are testable without a live scene.
 */

import { ToastTier } from '../achievements/AchievementTypes';

/** How many `rare` toasts a single run may draw before the rest are recorded instead. */
export const RARE_TOASTS_PER_SESSION = 2;

/** A `critical` toast with the same title cannot redraw inside this window. */
export const CRITICAL_REPEAT_COOLDOWN_MS = 60_000;

export type ToastVerdict = 'show' | 'suppress' | 'drop';

export interface ToastGateState {
  rareShown: number;
  lastCriticalAtMs: Map<string, number>;
}

export function createToastGateState(): ToastGateState {
  return { rareShown: 0, lastCriticalAtMs: new Map() };
}

/** Decides one toast and records what it spent. Mutates `state`. */
export function decideToast(
  state: ToastGateState,
  tier: ToastTier,
  title: string,
  nowMs: number,
): ToastVerdict {
  if (tier === 'ambient') return 'drop';
  if (tier === 'critical') {
    const lastAtMs = state.lastCriticalAtMs.get(title);
    if (lastAtMs !== undefined && nowMs - lastAtMs < CRITICAL_REPEAT_COOLDOWN_MS) return 'drop';
    state.lastCriticalAtMs.set(title, nowMs);
    return 'show';
  }
  if (tier === 'rare' && state.rareShown < RARE_TOASTS_PER_SESSION) {
    state.rareShown++;
    return 'show';
  }
  return 'suppress';
}
