import { SecureStorage } from '../storage';
import { sanitizeLoadout, type LastLoadout } from './LastLoadout';

const STORAGE_KEY_LOADOUT_PRESETS = 'survivor-loadout-presets';

/** Max saved loadout presets. Saving beyond this drops the oldest (FIFO). */
export const MAX_LOADOUT_PRESETS = 3;

// Module-level handoff for a one-tap replay launched from LoadoutScene. We route
// the launch back through BootScene (to reuse its confirm-if-a-run-is-in-progress
// + clear-save + fade path) but deliberately do NOT ride it on scene.start data:
// Phaser retains a scene's last settings.data when start() is passed none, which
// would re-fire the replay on a later plain return to BootScene. consume clears it.
let pendingReplay: LastLoadout | null = null;

export function setPendingReplay(loadout: LastLoadout): void {
  pendingReplay = loadout;
}

export function consumePendingReplay(): LastLoadout | null {
  const loadout = pendingReplay;
  pendingReplay = null;
  return loadout;
}

function persist(presets: LastLoadout[]): void {
  try {
    SecureStorage.setItem(STORAGE_KEY_LOADOUT_PRESETS, JSON.stringify(presets));
  } catch {
    // Best-effort: a failed write just means the preset isn't kept next session.
  }
}

export function loadLoadoutPresets(): LastLoadout[] {
  const raw = SecureStorage.getItem(STORAGE_KEY_LOADOUT_PRESETS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const presets: LastLoadout[] = [];
    for (const entry of parsed) {
      const loadout = sanitizeLoadout(entry);
      if (loadout) presets.push(loadout);
    }
    return presets.slice(0, MAX_LOADOUT_PRESETS);
  } catch {
    return [];
  }
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/** Two loadouts are equal if every run-identity field matches (pact order ignored). */
export function loadoutsEqual(a: LastLoadout, b: LastLoadout): boolean {
  return (
    a.startingWeapon === b.startingWeapon &&
    (a.shipId ?? '') === (b.shipId ?? '') &&
    (a.stageId ?? '') === (b.stageId ?? '') &&
    (a.directorStrategy ?? '') === (b.directorStrategy ?? '') &&
    a.threatLevel === b.threatLevel &&
    a.gauntletMode === b.gauntletMode &&
    sameStringArray(a.pactIds ?? [], b.pactIds ?? [])
  );
}

export function isLoadoutSaved(loadout: LastLoadout, presets: LastLoadout[]): boolean {
  return presets.some((preset) => loadoutsEqual(preset, loadout));
}

/**
 * Save a loadout as a preset. No-ops (returns the list unchanged) if an identical
 * loadout is already saved. When the store is full, the oldest preset is dropped
 * (FIFO) to make room. Returns the updated list.
 */
export function saveLoadoutPreset(loadout: LastLoadout): LastLoadout[] {
  const presets = loadLoadoutPresets();
  if (isLoadoutSaved(loadout, presets)) return presets;
  presets.push(loadout);
  while (presets.length > MAX_LOADOUT_PRESETS) presets.shift();
  persist(presets);
  return presets;
}
