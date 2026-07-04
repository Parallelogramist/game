import { Health } from '../../components';
import { bossPhaseTransitionCallback } from './state';

/**
 * Boss phase tracker — stored externally from EnemyAI.phase because some
 * bosses (e.g. Void Wyrm) repurpose the `phase` field as a serpentine timer.
 * Cleared on enemy despawn via resetBossPhaseTracking (called in reset flow).
 */
const bossPhaseByEntity = new Map<number, number>();

/**
 * Checks whether the boss just crossed a phase boundary (66% / 33% HP).
 * Fires the transition callback on change. Returns the current phase (1-3).
 */
export function checkBossPhaseTransition(bossId: number): number {
  const healthPercent = Health.current[bossId] / Math.max(1, Health.max[bossId]);
  const currentPhase = healthPercent > 0.66 ? 1 : healthPercent > 0.33 ? 2 : 3;
  const storedPhase = bossPhaseByEntity.get(bossId) ?? 1;
  if (currentPhase > storedPhase) {
    bossPhaseByEntity.set(bossId, currentPhase);
    if (bossPhaseTransitionCallback) {
      bossPhaseTransitionCallback(bossId, currentPhase);
    }
  } else if (!bossPhaseByEntity.has(bossId)) {
    bossPhaseByEntity.set(bossId, currentPhase);
  }
  return currentPhase;
}

export function resetBossPhaseTracking(): void {
  bossPhaseByEntity.clear();
}
