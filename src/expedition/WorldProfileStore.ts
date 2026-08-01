/**
 * WorldProfileStore: what a profile remembers about the expedition world between runs.
 *
 * Separate from the run save on purpose (doc 02 section 4.7): a broken wall is a property
 * of the world this profile has explored, not of the life the player is currently on, so it
 * survives death, and a run save that predates it is not invalidated by it.
 */

import { SecureStorage } from '../storage';

const STORAGE_KEY_WORLD_PROFILE = 'survivor-world-profile';
const WORLD_PROFILE_VERSION = 1;

/** Cap on remembered ids, so a tampered payload cannot make world load walk a huge list. */
const MAX_REMEMBERED_BARRIERS = 2048;

const BARRIER_ID = /^(edge:-?\d+,-?\d+:(north|east|south|west)|breakable:-?\d+,-?\d+:\d+)$/;

export interface WorldProfileState {
  version: number;
  worldSeed: number;
  worldGenVersion: number;
  brokenBreakableIds: string[];
  /** True once this profile has killed this world's boss. Optional in storage on purpose:
   *  a payload written before this field shipped reads false, which is why
   *  WORLD_PROFILE_VERSION does NOT move: a bump would discard every remembered wall. */
  conquered: boolean;
}

function emptyProfile(worldSeed: number, worldGenVersion: number): WorldProfileState {
  return {
    version: WORLD_PROFILE_VERSION, worldSeed, worldGenVersion, brokenBreakableIds: [],
    conquered: false,
  };
}

/**
 * A profile written for a different seed or a different generator is not migrated, it is
 * discarded: its ids name tiles that no longer exist, and replaying them onto the new world
 * would open holes at coordinates nothing chose.
 */
export function loadWorldProfile(
  worldSeed: number, worldGenVersion: number,
): WorldProfileState {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY_WORLD_PROFILE);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<WorldProfileState> | null;
      if (parsed
        && parsed.version === WORLD_PROFILE_VERSION
        && parsed.worldSeed === worldSeed
        && parsed.worldGenVersion === worldGenVersion) {
        const ids = Array.isArray(parsed.brokenBreakableIds) ? parsed.brokenBreakableIds : [];
        return {
          version: WORLD_PROFILE_VERSION,
          worldSeed,
          worldGenVersion,
          brokenBreakableIds: ids
            .filter((id): id is string => typeof id === 'string' && BARRIER_ID.test(id))
            .slice(0, MAX_REMEMBERED_BARRIERS),
          conquered: parsed.conquered === true,
        };
      }
    }
  } catch {
    console.warn('Could not load world profile from storage');
  }
  return emptyProfile(worldSeed, worldGenVersion);
}

/** Remembers one broken barrier immediately, so a death or a refresh cannot undo it. */
export function recordBrokenBarrier(
  worldSeed: number, worldGenVersion: number, barrierId: string,
): void {
  if (!BARRIER_ID.test(barrierId)) return;
  const profile = loadWorldProfile(worldSeed, worldGenVersion);
  if (profile.brokenBreakableIds.includes(barrierId)) return;
  if (profile.brokenBreakableIds.length >= MAX_REMEMBERED_BARRIERS) return;
  profile.brokenBreakableIds.push(barrierId);
  try {
    SecureStorage.setItem(STORAGE_KEY_WORLD_PROFILE, JSON.stringify(profile));
  } catch {
    console.warn('Could not save world profile to storage');
  }
}

/** Returns true only on the false→true transition, so the caller can count DISTINCT worlds
 *  conquered without a second store. A failed write returns false: nothing may be counted
 *  that was not recorded. */
export function markWorldConquered(worldSeed: number, worldGenVersion: number): boolean {
  const profile = loadWorldProfile(worldSeed, worldGenVersion);
  if (profile.conquered) return false;
  profile.conquered = true;
  try {
    SecureStorage.setItem(STORAGE_KEY_WORLD_PROFILE, JSON.stringify(profile));
  } catch {
    console.warn('Could not save world profile to storage');
    return false;
  }
  return true;
}

export function isWorldConquered(worldSeed: number, worldGenVersion: number): boolean {
  return loadWorldProfile(worldSeed, worldGenVersion).conquered;
}
