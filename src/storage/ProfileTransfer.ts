import { ALL_STORAGE_KEYS } from './StorageBootstrap';

export const PROFILE_BLOB_VERSION = 1;
export const PROFILE_BLOB_APP = 'pew-pew-survivor';
export const PROFILE_ENVELOPE_PREFIX = 'PEWSAVE1:';

// Not portable. The in-run save references a run in progress, and restoring one
// onto a different device's meta-progression resumes a run the imported profile
// never started. The backup markers describe THIS device's relationship to its
// backups rather than the profile itself — carrying the exporting device's
// markers over would tell the importing device it was backed up at a time it
// never was. applyProfilePayload restamps the export marker from the payload.
export const NON_TRANSFERABLE_STORAGE_KEYS: readonly string[] = [
  'survivor-game-state',
  'survivor-last-export-at',
  'survivor-backup-nudge-at',
];

export const TRANSFERABLE_STORAGE_KEYS: readonly string[] = ALL_STORAGE_KEYS.filter(
  (key) => !NON_TRANSFERABLE_STORAGE_KEYS.includes(key),
);

export interface ProfilePayload {
  app: string;
  v: number;
  exportedAt: number;
  keys: Record<string, string>;
  checksum: string;
}

export type ProfileValidation =
  | { ok: true; payload: ProfilePayload }
  | { ok: false; error: string };

export interface ProfileApplyPlan {
  sets: Record<string, string>;
  removes: string[];
  ignoredKeys: string[];
}

export function canonicalizeKeys(keys: Record<string, string>): string {
  return Object.keys(keys)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(keys[key])}`)
    .join(',');
}

export function checksumKeys(keys: Record<string, string>): string {
  const canonical = canonicalizeKeys(keys);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index++) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function packProfile(keys: Record<string, string>, exportedAt: number): ProfilePayload {
  return {
    app: PROFILE_BLOB_APP,
    v: PROFILE_BLOB_VERSION,
    exportedAt,
    keys,
    checksum: checksumKeys(keys),
  };
}

export function validateProfilePayload(parsed: unknown): ProfileValidation {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'This is not a profile code.' };
  }
  const candidate = parsed as Record<string, unknown>;

  if (candidate.app !== PROFILE_BLOB_APP) {
    return { ok: false, error: 'This is not a Pew Pew Survivor profile code.' };
  }

  if (typeof candidate.v !== 'number' || !Number.isInteger(candidate.v) || candidate.v <= 0) {
    return { ok: false, error: 'This profile code is corrupted.' };
  }
  if (candidate.v > PROFILE_BLOB_VERSION) {
    return { ok: false, error: 'This profile code was made by a newer version of the game.' };
  }

  if (typeof candidate.exportedAt !== 'number' || !Number.isFinite(candidate.exportedAt)) {
    return { ok: false, error: 'This profile code is corrupted.' };
  }

  const keys = candidate.keys;
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
    return { ok: false, error: 'This profile code is corrupted.' };
  }
  for (const value of Object.values(keys as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      return { ok: false, error: 'This profile code is corrupted.' };
    }
  }

  if (typeof candidate.checksum !== 'string' || candidate.checksum !== checksumKeys(keys as Record<string, string>)) {
    return { ok: false, error: 'This profile code is corrupted.' };
  }

  return { ok: true, payload: parsed as ProfilePayload };
}

export function planProfileApply(payload: ProfilePayload): ProfileApplyPlan {
  const sets: Record<string, string> = {};
  const removes: string[] = [];
  for (const key of TRANSFERABLE_STORAGE_KEYS) {
    const value = payload.keys[key];
    if (typeof value === 'string') sets[key] = value;
    else removes.push(key);
  }
  // A stale in-run save must not resume on top of freshly imported meta.
  removes.push(...NON_TRANSFERABLE_STORAGE_KEYS);
  const transferable = new Set(TRANSFERABLE_STORAGE_KEYS);
  const ignoredKeys = Object.keys(payload.keys).filter((key) => !transferable.has(key));
  return { sets, removes, ignoredKeys };
}

export function describeProfile(payload: ProfilePayload): string {
  const parts: string[] = [];
  const exported = new Date(payload.exportedAt);
  if (!Number.isNaN(exported.getTime())) parts.push(`Exported ${exported.toISOString().slice(0, 10)}`);
  const gold = Number.parseInt(payload.keys['survivor-meta-gold'] ?? '', 10);
  if (Number.isFinite(gold)) parts.push(`${gold.toLocaleString()} gold`);
  const runs = Number.parseInt(payload.keys['survivor-meta-runs-completed'] ?? '', 10);
  if (Number.isFinite(runs)) parts.push(`${runs} runs`);
  return parts.join(' · ');
}
