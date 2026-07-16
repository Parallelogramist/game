/**
 * endlessCycles.ts — pure serialization for post-victory ENDLESS mode's best
 * cycle reached.
 *
 * Phaser- and storage-free so the payload parsing is unit-testable (mirrors
 * gauntletWaves.ts / runnerMath.ts). EndlessBestCycle.ts owns the SecureStorage
 * side; GameScene owns the cycle counter itself.
 */

/** Parse the persisted best-cycle payload (`{ bestCycle: number }`); 0 when absent/corrupt. */
export function parseBestCycle(raw: string | null): number {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const bestCycle = (parsed as { bestCycle?: unknown }).bestCycle;
      if (typeof bestCycle === 'number' && Number.isFinite(bestCycle) && bestCycle >= 0) {
        return Math.floor(bestCycle);
      }
    }
  } catch {
    // Corrupted JSON — treat as no best.
  }
  return 0;
}

export function serializeBestCycle(bestCycle: number): string {
  const safe = Number.isFinite(bestCycle) ? Math.max(0, Math.floor(bestCycle)) : 0;
  return JSON.stringify({ bestCycle: safe });
}
