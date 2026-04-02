/**
 * ComboSystem tracks consecutive enemy kills and triggers threshold-based rewards.
 *
 * Module-level state pattern — no class, just exported functions.
 * Call resetComboSystem() in GameScene.create() to clear state between runs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComboTier = 'none' | 'warm' | 'hot' | 'blazing' | 'inferno';

export interface ComboThreshold {
  readonly count: number;
  readonly type: 'xp_burst' | 'damage_boost' | 'annihilation';
}

export interface ComboSnapshot {
  comboCount: number;
  comboDecayTimer: number;
  highestCombo: number;
}

interface ActiveThresholdEffect {
  type: string;
  timer: number;
}

interface RecordKillResult {
  newCombo: number;
  triggeredThreshold: { count: number; type: string } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds of inactivity before the combo begins to decay. */
const COMBO_DECAY_DELAY = 3.0;

/** Combos lost per second once decay has started. */
const COMBO_DECAY_RATE = 15;

/** Duration (seconds) of the damage buff granted at the 50-kill threshold. */
const COMBO_DAMAGE_BUFF_DURATION = 8.0;

/** Additional damage multiplier while the damage buff is active (+50%). */
const COMBO_DAMAGE_BUFF_AMOUNT = 0.5;

/** Maximum XP multiplier the combo system can provide. */
const MAX_XP_MULTIPLIER = 1.5;

/** XP multiplier gained per combo kill (additive). */
const XP_MULTIPLIER_PER_KILL = 0.002;

export const COMBO_THRESHOLDS: readonly ComboThreshold[] = [
  { count: 25, type: 'xp_burst' },
  { count: 50, type: 'damage_boost' },
  { count: 100, type: 'annihilation' },
] as const;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let comboCount = 0;
let comboDecayTimer = 0;
let highestCombo = 0;
let activeThresholdEffects: ActiveThresholdEffect[] = [];
let triggeredThresholdCounts: Set<number> = new Set();

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Resets all combo state to defaults.
 * Must be called in GameScene.create() before the game loop starts.
 */
export function resetComboSystem(): void {
  comboCount = 0;
  comboDecayTimer = 0;
  highestCombo = 0;
  activeThresholdEffects = [];
  triggeredThresholdCounts = new Set();
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Records a kill, incrementing the combo and checking for newly-crossed
 * thresholds.  Each threshold fires only once per combo chain (resets when
 * the combo drops back to 0).
 */
export function recordComboKill(): RecordKillResult {
  comboCount += 1;
  comboDecayTimer = COMBO_DECAY_DELAY;

  if (comboCount > highestCombo) {
    highestCombo = comboCount;
  }

  // Check whether a threshold was just crossed
  let triggeredThreshold: { count: number; type: string } | null = null;

  for (const threshold of COMBO_THRESHOLDS) {
    if (
      comboCount >= threshold.count &&
      !triggeredThresholdCounts.has(threshold.count)
    ) {
      triggeredThresholdCounts.add(threshold.count);
      triggeredThreshold = { count: threshold.count, type: threshold.type };

      // If this is the damage boost threshold, activate the timed buff
      if (threshold.type === 'damage_boost') {
        activeThresholdEffects.push({
          type: 'damage_boost',
          timer: COMBO_DAMAGE_BUFF_DURATION,
        });
      }

      // Only report the highest newly-triggered threshold per kill
    }
  }

  return { newCombo: comboCount, triggeredThreshold };
}

/**
 * Advances combo timers each frame.
 *
 * - Decrements the decay delay timer.  Once it reaches zero the combo count
 *   drains at COMBO_DECAY_RATE per second.
 * - When the combo reaches 0, the triggered-threshold tracker is also reset
 *   so thresholds can fire again in the next chain.
 * - Decrements active threshold effect timers and removes expired ones.
 *
 * @param deltaSeconds - Frame delta already converted to seconds.
 */
export function updateComboSystem(deltaSeconds: number): void {
  // --- Decay logic ---
  if (comboCount > 0) {
    comboDecayTimer -= deltaSeconds;

    if (comboDecayTimer <= 0) {
      comboCount -= COMBO_DECAY_RATE * deltaSeconds;

      if (comboCount <= 0) {
        comboCount = 0;
        triggeredThresholdCounts.clear();
      }
    }
  }

  // --- Active threshold effect timers ---
  for (let effectIndex = activeThresholdEffects.length - 1; effectIndex >= 0; effectIndex--) {
    activeThresholdEffects[effectIndex].timer -= deltaSeconds;

    if (activeThresholdEffects[effectIndex].timer <= 0) {
      activeThresholdEffects.splice(effectIndex, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Returns the current combo kill count. */
export function getComboCount(): number {
  return Math.floor(comboCount);
}

/** Returns the highest combo achieved during the current run. */
export function getHighestCombo(): number {
  return highestCombo;
}

/**
 * Returns a named tier based on the current combo count.
 *
 * - none:    0-9
 * - warm:    10-24
 * - hot:     25-49
 * - blazing: 50-99
 * - inferno: 100+
 */
export function getComboTier(): ComboTier {
  const currentCombo = Math.floor(comboCount);
  if (currentCombo >= 100) return 'inferno';
  if (currentCombo >= 50) return 'blazing';
  if (currentCombo >= 25) return 'hot';
  if (currentCombo >= 10) return 'warm';
  return 'none';
}

/**
 * Returns 0-1 representing how much of the decay delay timer remains.
 * Useful for UI fade effects — 1 means full time left, 0 means decay has
 * started (or combo is at zero).
 */
export function getComboDecayPercent(): number {
  if (comboCount <= 0) return 0;
  return Math.max(0, Math.min(1, comboDecayTimer / COMBO_DECAY_DELAY));
}

/**
 * Returns the XP multiplier granted by the current combo.
 * Scales linearly from 1.0 at combo 0, capped at 1.5.
 */
export function getComboXPMultiplier(): number {
  const uncappedMultiplier = 1.0 + Math.floor(comboCount) * XP_MULTIPLIER_PER_KILL;
  return Math.min(uncappedMultiplier, MAX_XP_MULTIPLIER);
}

/**
 * Returns true when the damage buff from the 50-kill threshold is active.
 */
export function isComboBuffActive(): boolean {
  return activeThresholdEffects.some(
    (effect) => effect.type === 'damage_boost'
  );
}

/**
 * Returns the additional damage multiplier granted by the combo damage buff.
 * 0.5 while active, 0 otherwise.
 */
export function getComboBuffDamageMultiplier(): number {
  return isComboBuffActive() ? COMBO_DAMAGE_BUFF_AMOUNT : 0;
}

/**
 * Returns the next combo threshold the player hasn't reached yet,
 * or null if all thresholds have been passed.
 */
export function getNextComboThreshold(): { nextCount: number; progress: number } | null {
  const currentCombo = Math.floor(comboCount);
  for (const threshold of COMBO_THRESHOLDS) {
    if (currentCombo < threshold.count) {
      return { nextCount: threshold.count, progress: currentCombo / threshold.count };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Save / Restore
// ---------------------------------------------------------------------------

/** Serialises the combo state for mid-run saves. */
export function getComboState(): ComboSnapshot {
  return {
    comboCount: Math.floor(comboCount),
    comboDecayTimer,
    highestCombo,
  };
}

/** Restores combo state from a previous save. */
export function restoreComboState(state: ComboSnapshot): void {
  comboCount = state.comboCount;
  comboDecayTimer = state.comboDecayTimer;
  highestCombo = state.highestCombo;

  // Rebuild triggered thresholds based on restored combo count so thresholds
  // that were already passed do not re-fire.
  triggeredThresholdCounts.clear();
  for (const threshold of COMBO_THRESHOLDS) {
    if (comboCount >= threshold.count) {
      triggeredThresholdCounts.add(threshold.count);
    }
  }
}
