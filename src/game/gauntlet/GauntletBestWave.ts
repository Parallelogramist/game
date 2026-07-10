/**
 * GauntletBestWave.ts — persistence for GAUNTLET mode's best wave reached.
 *
 * Thin SecureStorage wrapper around the pure parse/serialize helpers in
 * gauntletWaves.ts (mirrors RunnerBestScore). The key is registered in
 * StorageBootstrap.ALL_STORAGE_KEYS (required — unregistered keys read back
 * as null on every fresh page load).
 */

import { SecureStorage } from '../../storage';
import { parseBestWave, serializeBestWave } from './gauntletWaves';

const STORAGE_KEY_GAUNTLET_BEST = 'survivor-gauntlet-best';

/** Load the persisted best gauntlet wave reached; 0 when missing or corrupted. */
export function loadGauntletBestWave(): number {
  return parseBestWave(SecureStorage.getItem(STORAGE_KEY_GAUNTLET_BEST));
}

/**
 * Persist `wave` as the new best if it beats the stored one.
 * Returns true when a new best was written.
 */
export function saveGauntletBestWaveIfHigher(wave: number): boolean {
  const current = loadGauntletBestWave();
  if (!Number.isFinite(wave) || Math.floor(wave) <= current) return false;
  SecureStorage.setItem(STORAGE_KEY_GAUNTLET_BEST, serializeBestWave(wave));
  return true;
}
