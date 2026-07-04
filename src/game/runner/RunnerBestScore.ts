/**
 * RunnerBestScore.ts — persistence for the endless-runner mode's best score.
 *
 * Thin SecureStorage wrapper around the pure parse/serialize helpers in
 * runnerMath.ts. Payload shape: `{ best: number }`. The key is registered in
 * StorageBootstrap.ALL_STORAGE_KEYS (required — unregistered keys read back
 * as null on every fresh page load) and the STORAGE_KEY_ naming convention
 * below is what StorageBootstrap.test.ts's source scan keys on.
 */

import { SecureStorage } from '../../storage';
import { parseBestScore, serializeBestScore } from './runnerMath';

const STORAGE_KEY_RUNNER_BEST = 'survivor-runner-best';

/** Load the persisted best runner score; 0 when missing or corrupted. */
export function loadRunnerBest(): number {
  return parseBestScore(SecureStorage.getItem(STORAGE_KEY_RUNNER_BEST));
}

/**
 * Persist `score` as the new best if it beats the stored one.
 * Returns true when a new best was written.
 */
export function saveRunnerBestIfHigher(score: number): boolean {
  const current = loadRunnerBest();
  if (!Number.isFinite(score) || Math.floor(score) <= current) return false;
  SecureStorage.setItem(STORAGE_KEY_RUNNER_BEST, serializeBestScore(score));
  return true;
}
