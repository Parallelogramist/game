/**
 * EndlessBestCycle.ts — persistence for post-victory ENDLESS mode's deepest
 * cycle reached.
 *
 * Thin SecureStorage wrapper around the pure parse/serialize helpers in
 * endlessCycles.ts (mirrors GauntletBestWave / RunnerBestScore). The key is
 * registered in StorageBootstrap.ALL_STORAGE_KEYS (required — unregistered keys
 * read back as null on every fresh page load) and the STORAGE_KEY_ naming
 * convention below is what StorageBootstrap.test.ts's source scan keys on.
 */

import { SecureStorage } from '../../storage';
import { parseBestCycle, serializeBestCycle } from './endlessCycles';

const STORAGE_KEY_ENDLESS_BEST = 'survivor-endless-best';

/** Load the persisted deepest endless cycle reached; 0 when missing or corrupted. */
export function loadEndlessBestCycle(): number {
  return parseBestCycle(SecureStorage.getItem(STORAGE_KEY_ENDLESS_BEST));
}

/**
 * Persist `cycle` as the new best if it beats the stored one.
 * Returns true when a new best was written.
 */
export function saveEndlessBestCycleIfHigher(cycle: number): boolean {
  const current = loadEndlessBestCycle();
  if (!Number.isFinite(cycle) || Math.floor(cycle) <= current) return false;
  SecureStorage.setItem(STORAGE_KEY_ENDLESS_BEST, serializeBestCycle(cycle));
  return true;
}
