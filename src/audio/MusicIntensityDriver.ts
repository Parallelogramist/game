import { getMusicManager } from './MusicManager';

/**
 * Dynamic music intensity.
 *
 * Reads live combat signals each frame (combo, on-screen enemy density, player
 * danger, boss presence) and ramps the music's intensity multiplier so the
 * soundtrack swells in the thick of a fight and settles when things calm down.
 * Boss fights get a sustained lift. Uses a smoothed envelope to avoid jumpy
 * volume — and only adjusts a multiplier on top of the user's volume, so it
 * never overrides the player's audio settings.
 *
 * Module-level state — reset in GameScene.create() via resetMusicIntensityDriver().
 */

const MIN_INTENSITY = 0.55;
const MAX_INTENSITY = 1.15;
const SMOOTHING_TAU = 0.7; // seconds — larger = slower response

let smoothedIntensity = MIN_INTENSITY;

export interface IntensitySignals {
  comboCount: number;
  enemyCount: number;
  hpFraction: number;  // 0..1
  bossActive: boolean;
}

/**
 * Resets the driver to a calm baseline and restores the music manager to full
 * (1.0) intensity — important on run end so menu music plays at the user's
 * chosen volume rather than a leftover combat level.
 */
export function resetMusicIntensityDriver(): void {
  smoothedIntensity = MIN_INTENSITY;
  getMusicManager().setIntensity(1.0);
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Per-frame update. Computes a target intensity from the signals, smooths it,
 * and applies it to the music manager.
 */
export function updateMusicIntensity(deltaSeconds: number, signals: IntensitySignals): void {
  const combo = clamp01(signals.comboCount / 80);
  const density = clamp01(signals.enemyCount / 60);
  const danger = 1 - clamp01(signals.hpFraction);
  const boss = signals.bossActive ? 0.35 : 0;

  const rawTarget = Math.max(
    MIN_INTENSITY,
    Math.min(MAX_INTENSITY, MIN_INTENSITY + combo * 0.22 + density * 0.16 + danger * 0.14 + boss),
  );

  // Exponential smoothing (frame-rate independent).
  const alpha = 1 - Math.exp(-deltaSeconds / SMOOTHING_TAU);
  smoothedIntensity += (rawTarget - smoothedIntensity) * alpha;

  getMusicManager().setIntensity(smoothedIntensity);
}
