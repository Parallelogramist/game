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
}

function emptyProfile(worldSeed: number, worldGenVersion: number): WorldProfileState {
  return {
    version: WORLD_PROFILE_VERSION, worldSeed, worldGenVersion, brokenBreakableIds: [],
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
