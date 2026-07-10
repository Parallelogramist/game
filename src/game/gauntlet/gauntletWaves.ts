/**
 * gauntletWaves.ts — pure wave math for GAUNTLET mode (boss-rush).
 *
 * Phaser-free so the escalation table is unit-testable. GameScene owns the
 * spawning/UI; this module owns WHAT each wave contains and how the per-wave
 * stat ramp and rewards scale.
 *
 * Wave shape: waves 1–2 are miniboss-only warmups; from wave 3 a boss appears
 * and the composition cycles miniboss padding (+0/+1/+2) while the boss count
 * steps up every 3 waves. Boss count caps at 3 and miniboss count at 6 (pool +
 * readability limits — endless mode tops out at 2 bosses + 3 minibosses per
 * wave, so this cap is already past the proven-stable density); past the caps,
 * difficulty keeps growing through the per-wave stat multipliers instead.
 */

export interface GauntletWaveComposition {
  minibossCount: number;
  bossCount: number;
}

export interface GauntletSpawnPlanEntry {
  kind: 'miniboss' | 'boss';
  /** Seconds after the wave starts that this spawn fires. */
  delaySeconds: number;
}

/** Seconds before wave 1 starts on a fresh gauntlet run. */
export const GAUNTLET_INTRO_SECONDS = 8;

/** Seconds between a wave clear and the next wave's spawns. */
export const GAUNTLET_BREATHER_SECONDS = 5;

/** Per-wave stat ramp, applied when each wave AFTER the first starts. */
export const GAUNTLET_HEALTH_MULT_PER_WAVE = 1.12;
export const GAUNTLET_DAMAGE_MULT_PER_WAVE = 1.08;
export const GAUNTLET_XP_MULT_PER_WAVE = 1.06;

export const GAUNTLET_MAX_BOSSES_PER_WAVE = 3;
export const GAUNTLET_MAX_MINIBOSSES_PER_WAVE = 6;

const MINIBOSS_SPAWN_STAGGER_SECONDS = 1.5;
const FIRST_BOSS_DELAY_SECONDS = 2.5;
const BOSS_SPAWN_STAGGER_SECONDS = 4.5;

export function gauntletWaveComposition(waveNumber: number): GauntletWaveComposition {
  const wave = Math.max(1, Math.floor(waveNumber));
  if (wave <= 2) {
    return { minibossCount: wave, bossCount: 0 };
  }
  const rawBossCount = 1 + Math.floor((wave - 3) / 3);
  const bossCount = Math.min(rawBossCount, GAUNTLET_MAX_BOSSES_PER_WAVE);
  // Bosses past the cap convert to 3 minibosses each so waves keep thickening.
  const overflowMinibosses = (rawBossCount - bossCount) * 3;
  const minibossCount = Math.min(
    ((wave - 3) % 3) + overflowMinibosses,
    GAUNTLET_MAX_MINIBOSSES_PER_WAVE,
  );
  return { minibossCount, bossCount };
}

/**
 * Expands a wave into individual timed spawns. Minibosses lead (from t=0,
 * staggered) and bosses land behind them so each entrance reads distinctly.
 */
export function gauntletWaveSpawnPlan(waveNumber: number): GauntletSpawnPlanEntry[] {
  const { minibossCount, bossCount } = gauntletWaveComposition(waveNumber);
  const plan: GauntletSpawnPlanEntry[] = [];
  for (let minibossIndex = 0; minibossIndex < minibossCount; minibossIndex++) {
    plan.push({ kind: 'miniboss', delaySeconds: minibossIndex * MINIBOSS_SPAWN_STAGGER_SECONDS });
  }
  for (let bossIndex = 0; bossIndex < bossCount; bossIndex++) {
    plan.push({ kind: 'boss', delaySeconds: FIRST_BOSS_DELAY_SECONDS + bossIndex * BOSS_SPAWN_STAGGER_SECONDS });
  }
  return plan;
}

/** Gold bonus awarded when a wave is fully cleared. */
export function gauntletWaveGoldReward(waveNumber: number): number {
  const wave = Math.max(1, Math.floor(waveNumber));
  return 25 + wave * 15;
}

/** Parse the persisted best-wave payload (`{ bestWave: number }`); 0 when absent/corrupt. */
export function parseBestWave(raw: string | null): number {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const bestWave = (parsed as { bestWave?: unknown }).bestWave;
      if (typeof bestWave === 'number' && Number.isFinite(bestWave) && bestWave >= 0) {
        return Math.floor(bestWave);
      }
    }
  } catch {
    // Corrupted JSON — treat as no best.
  }
  return 0;
}

export function serializeBestWave(bestWave: number): string {
  const safe = Number.isFinite(bestWave) ? Math.max(0, Math.floor(bestWave)) : 0;
  return JSON.stringify({ bestWave: safe });
}
