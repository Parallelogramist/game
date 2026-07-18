import { SecureStorage } from '../storage';

const STORAGE_KEY_THREAT_BEST = 'survivor-threat-best';
const STORAGE_KEY_THREAT_LAST = 'survivor-threat-last';

function parseTier(raw: string | null): number {
  const parsed = raw == null ? 0 : parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function loadThreatBest(): number {
  return parseTier(SecureStorage.getItem(STORAGE_KEY_THREAT_BEST));
}

export function recordThreatCleared(tier: number): boolean {
  const current = loadThreatBest();
  if (!Number.isFinite(tier) || Math.floor(tier) <= current) return false;
  SecureStorage.setItem(STORAGE_KEY_THREAT_BEST, String(Math.floor(tier)));
  return true;
}

export function loadThreatLastSelected(): number {
  return parseTier(SecureStorage.getItem(STORAGE_KEY_THREAT_LAST));
}

export function saveThreatLastSelected(tier: number): void {
  if (Number.isFinite(tier) && tier >= 0) {
    SecureStorage.setItem(STORAGE_KEY_THREAT_LAST, String(Math.floor(tier)));
  }
}
