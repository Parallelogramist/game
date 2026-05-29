import { SecureStorage } from '../storage';

/**
 * BestScoreManager — persists the best run score per world level via
 * SecureStorage, so the post-run results screen can show a personal best and
 * flag new records. Scores come from PerformanceGrade.computeRunScore so the
 * grade and the best are derived from the same number.
 */

const STORAGE_KEY = 'survivor-best-scores';

type BestScoreMap = Record<string, number>; // worldLevel -> best score

let cache: BestScoreMap | null = null;

function load(): BestScoreMap {
  if (cache) return cache;
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY);
    cache = stored ? (JSON.parse(stored) as BestScoreMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(map: BestScoreMap): void {
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal — best scores are cosmetic.
  }
}

/** Best score recorded for a world level (0 if none). */
export function getBestScore(worldLevel: number): number {
  return load()[String(worldLevel)] ?? 0;
}

/**
 * Records a run score for a world level. Returns the prior best and whether
 * this run set a new record. The score itself is always echoed back.
 */
export function recordScore(worldLevel: number, score: number): { score: number; best: number; isNewBest: boolean } {
  const map = load();
  const key = String(worldLevel);
  const priorBest = map[key] ?? 0;
  const isNewBest = score > priorBest;
  if (isNewBest) {
    map[key] = score;
    save(map);
  }
  return { score, best: Math.max(priorBest, score), isNewBest };
}
