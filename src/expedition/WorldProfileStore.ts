/**
 * WorldProfileStore: what a profile remembers about the expedition world between runs.
 *
 * Separate from the run save on purpose (doc 02 section 4.7): a broken wall is a property
 * of the world this profile has explored, not of the life the player is currently on, so it
 * survives death, and a run save that predates it is not invalidated by it.
 */

import { SecureStorage } from '../storage';
import { readArchivedWorld, writeArchivedWorld } from './worldArchive';
import { parseSectorMarkId, sanitizeSectorNote, sectorMarkId,
  SECTOR_MARK_ID_PATTERN } from './sectorMarks';
import type { SectorMarkKind } from './sectorMarks';

const STORAGE_KEY_WORLD_PROFILE = 'survivor-world-profile';
const WORLD_PROFILE_VERSION = 1;

/** Cap on remembered ids, so a tampered payload cannot make world load walk a huge list. */
const MAX_REMEMBERED_BARRIERS = 2048;

/** One mark per sector and a generated world is 48 sectors, so this bounds a tampered payload
 *  rather than a real one: no honest profile can reach it. */
const MAX_SECTOR_MARKS = 128;

/** Same bound and the same reason as MAX_SECTOR_MARKS: at most one note per marked sector. */
const MAX_SECTOR_NOTES = 128;

const SECTOR_KEY = /^-?\d+,-?\d+$/;

const BARRIER_ID =/^(edge:-?\d+,-?\d+:(north|east|south|west)|breakable:-?\d+,-?\d+:\d+)$/;
const GRID_ID = /^(poi|band):-?\d+,-?\d+:\d+$/;

export interface WorldProfileState {
  version: number;
  worldSeed: number;
  worldGenVersion: number;
  brokenBreakableIds: string[];
  /** Security grids this profile has phased through, by fenced-altar POI slot id or corridor band id. Optional in storage
   *  for the same reason `conquered` is: a payload written before this field shipped reads
   *  as an empty list, which is why WORLD_PROFILE_VERSION does NOT move. */
  downedSecurityGridIds: string[];
  /** Marks the player wrote onto this world's chart, one per sector, as `mark:<gx>,<gy>:<kind>`.
   *  Optional in storage for the same reason `conquered` is: a payload written before this field
   *  shipped reads as an empty list, which is why WORLD_PROFILE_VERSION does NOT move. */
  markedSectorIds: string[];
  /** What the player typed about a marked sector, keyed by `<gx>,<gy>`. Optional in storage for
   *  the same reason `conquered` is: a payload written before this field shipped reads as no
   *  notes, which is why WORLD_PROFILE_VERSION does NOT move. */
  sectorNotes: Record<string, string>;
  /** True once this profile has killed this world's boss. Optional in storage on purpose:
   *  a payload written before this field shipped reads false, which is why
   *  WORLD_PROFILE_VERSION does NOT move: a bump would discard every remembered wall. */
  conquered: boolean;
}

function emptyProfile(worldSeed: number, worldGenVersion: number): WorldProfileState {
  return {
    version: WORLD_PROFILE_VERSION, worldSeed, worldGenVersion, brokenBreakableIds: [],
    downedSecurityGridIds: [],
    markedSectorIds: [],
    sectorNotes: {},
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
      const parsed = readArchivedWorld(
        JSON.parse(stored), worldSeed, worldGenVersion,
      ) as Partial<WorldProfileState> | undefined;
      if (parsed
        && parsed.version === WORLD_PROFILE_VERSION
        && parsed.worldSeed === worldSeed
        && parsed.worldGenVersion === worldGenVersion) {
        const ids = Array.isArray(parsed.brokenBreakableIds) ? parsed.brokenBreakableIds : [];
        const gridIds = Array.isArray(parsed.downedSecurityGridIds)
          ? parsed.downedSecurityGridIds : [];
        const markIds = Array.isArray(parsed.markedSectorIds) ? parsed.markedSectorIds : [];
        const storedNotes = parsed.sectorNotes;
        const sectorNotes: Record<string, string> = {};
        if (storedNotes !== null && typeof storedNotes === 'object'
          && !Array.isArray(storedNotes)) {
          for (const [key, value] of Object.entries(storedNotes as Record<string, unknown>)) {
            if (Object.keys(sectorNotes).length >= MAX_SECTOR_NOTES) break;
            if (!SECTOR_KEY.test(key) || typeof value !== 'string') continue;
            const note = sanitizeSectorNote(value);
            if (note !== null) sectorNotes[key] = note;
          }
        }
        return {
          version: WORLD_PROFILE_VERSION,
          worldSeed,
          worldGenVersion,
          brokenBreakableIds: ids
            .filter((id): id is string => typeof id === 'string' && BARRIER_ID.test(id))
            .slice(0, MAX_REMEMBERED_BARRIERS),
          downedSecurityGridIds: gridIds
            .filter((id): id is string => typeof id === 'string' && GRID_ID.test(id))
            .slice(0, MAX_REMEMBERED_BARRIERS),
          markedSectorIds: markIds
            .filter((id): id is string => typeof id === 'string' && SECTOR_MARK_ID_PATTERN.test(id))
            .slice(0, MAX_SECTOR_MARKS),
          sectorNotes,
          conquered: parsed.conquered === true,
        };
      }
    }
  } catch {
    console.warn('Could not load world profile from storage');
  }
  return emptyProfile(worldSeed, worldGenVersion);
}

function saveWorldProfile(profile: WorldProfileState): boolean {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY_WORLD_PROFILE);
    SecureStorage.setItem(STORAGE_KEY_WORLD_PROFILE, JSON.stringify(
      writeArchivedWorld(stored ? JSON.parse(stored) : null, profile),
    ));
    return true;
  } catch {
    console.warn('Could not save world profile to storage');
    return false;
  }
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
  saveWorldProfile(profile);
}

/** Remembers one tripped kill-switch immediately, so a death or a refresh cannot relight
 *  a fence the ship already walked through. */
export function recordDownedSecurityGrid(
  worldSeed: number, worldGenVersion: number, gridId: string,
): void {
  if (!GRID_ID.test(gridId)) return;
  const profile = loadWorldProfile(worldSeed, worldGenVersion);
  if (profile.downedSecurityGridIds.includes(gridId)) return;
  if (profile.downedSecurityGridIds.length >= MAX_REMEMBERED_BARRIERS) return;
  profile.downedSecurityGridIds.push(gridId);
  saveWorldProfile(profile);
}

/** Returns true only on the false→true transition, so the caller can count DISTINCT worlds
 *  conquered without a second store. A failed write returns false: nothing may be counted
 *  that was not recorded. */
export function markWorldConquered(worldSeed: number, worldGenVersion: number): boolean {
  const profile = loadWorldProfile(worldSeed, worldGenVersion);
  if (profile.conquered) return false;
  profile.conquered = true;
  return saveWorldProfile(profile);
}

export function isWorldConquered(worldSeed: number, worldGenVersion: number): boolean {
  return loadWorldProfile(worldSeed, worldGenVersion).conquered;
}

/** Writes one sector's mark, replacing whatever kind was there; `null` removes it. Returns
 *  false when the write failed or the cap refused it, so a caller can never show a mark the
 *  store did not keep. */
export function setSectorMark(
  worldSeed: number, worldGenVersion: number, sector: string, kind: SectorMarkKind | null,
): boolean {
  const profile = loadWorldProfile(worldSeed, worldGenVersion);
  const remaining = profile.markedSectorIds.filter(
    id => parseSectorMarkId(id)?.sectorKey !== sector,
  );
  if (kind === null) {
    const hadNote = profile.sectorNotes[sector] !== undefined;
    if (remaining.length === profile.markedSectorIds.length && !hadNote) return true;
    profile.markedSectorIds = remaining;
    if (hadNote) delete profile.sectorNotes[sector];
    return saveWorldProfile(profile);
  }
  const id = sectorMarkId(sector, kind);
  if (!SECTOR_MARK_ID_PATTERN.test(id)) return false;
  if (remaining.length >= MAX_SECTOR_MARKS) return false;
  profile.markedSectorIds = [...remaining, id];
  return saveWorldProfile(profile);
}

export function getSectorMarks(
  worldSeed: number, worldGenVersion: number,
): Map<string, SectorMarkKind> {
  const marks = new Map<string, SectorMarkKind>();
  for (const id of loadWorldProfile(worldSeed, worldGenVersion).markedSectorIds) {
    const parsed = parseSectorMarkId(id);
    if (parsed) marks.set(parsed.sectorKey, parsed.kind);
  }
  return marks;
}

/** Writes one sector's note; `null`, or text that sanitizes to nothing, removes it. Returns false
 *  when the write failed or the cap refused it, on setSectorMark's rule: a caller may never show a
 *  note the store did not keep. */
export function setSectorNote(
  worldSeed: number, worldGenVersion: number, sector: string, note: string | null,
): boolean {
  if (!SECTOR_KEY.test(sector)) return false;
  const profile = loadWorldProfile(worldSeed, worldGenVersion);
  const cleaned = note === null ? null : sanitizeSectorNote(note);
  if (cleaned === null) {
    if (profile.sectorNotes[sector] === undefined) return true;
    delete profile.sectorNotes[sector];
    return saveWorldProfile(profile);
  }
  if (profile.sectorNotes[sector] === undefined
    && Object.keys(profile.sectorNotes).length >= MAX_SECTOR_NOTES) return false;
  profile.sectorNotes[sector] = cleaned;
  return saveWorldProfile(profile);
}

export function getSectorNotes(
  worldSeed: number, worldGenVersion: number,
): Map<string, string> {
  return new Map(Object.entries(loadWorldProfile(worldSeed, worldGenVersion).sectorNotes));
}
