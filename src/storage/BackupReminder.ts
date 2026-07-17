import { SecureStorage } from './SecureStorage';

const STORAGE_KEY_LAST_EXPORT_AT = 'survivor-last-export-at';
const STORAGE_KEY_LAST_NUDGE_AT = 'survivor-backup-nudge-at';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Below this many completed runs a profile isn't worth interrupting for. */
export const BACKUP_NUDGE_MIN_RUNS = 25;

/** A backup older than this no longer protects the profile's current progress. */
export const BACKUP_STALE_MS = 30 * DAY_MS;

/**
 * Re-nag no faster than Safari's ~7-day ITP eviction window: a warning that
 * fires more often than the loss it warns about is just noise.
 */
export const BACKUP_NUDGE_COOLDOWN_MS = 7 * DAY_MS;

function loadTimestamp(key: string): number | null {
  const raw = SecureStorage.getItem(key);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function loadLastExportAt(): number | null {
  return loadTimestamp(STORAGE_KEY_LAST_EXPORT_AT);
}

export function saveLastExportAt(timestamp: number): void {
  SecureStorage.setItem(STORAGE_KEY_LAST_EXPORT_AT, String(Math.floor(timestamp)));
}

export function loadLastNudgeAt(): number | null {
  return loadTimestamp(STORAGE_KEY_LAST_NUDGE_AT);
}

export function saveLastNudgeAt(timestamp: number): void {
  SecureStorage.setItem(STORAGE_KEY_LAST_NUDGE_AT, String(Math.floor(timestamp)));
}

export interface BackupNudgeInput {
  runsCompleted: number;
  lastExportAt: number | null;
  lastNudgeAt: number | null;
  now: number;
}

/**
 * A timestamp in the future (clock skew, or a blob from a device set ahead)
 * reads as "recent" and suppresses — erring toward silence, never toward
 * nagging a player who did back up.
 */
export function shouldShowBackupNudge(input: BackupNudgeInput): boolean {
  const { runsCompleted, lastExportAt, lastNudgeAt, now } = input;
  if (!Number.isFinite(runsCompleted) || runsCompleted < BACKUP_NUDGE_MIN_RUNS) return false;
  if (lastExportAt !== null && now - lastExportAt < BACKUP_STALE_MS) return false;
  if (lastNudgeAt !== null && now - lastNudgeAt < BACKUP_NUDGE_COOLDOWN_MS) return false;
  return true;
}

export function describeLastBackup(lastExportAt: number | null, now: number): string {
  if (lastExportAt === null) return 'Never backed up — progress lives only on this device.';
  const days = Math.floor((now - lastExportAt) / DAY_MS);
  if (days <= 0) return 'Backed up today.';
  if (days === 1) return 'Backed up yesterday.';
  return `Backed up ${days} days ago.`;
}
