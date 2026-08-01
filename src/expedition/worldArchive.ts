/**
 * One storage key holds every world a profile has flown, keyed by (seed, generator version).
 *
 * Both expedition stores were single-slot: one payload whose seed had to match the world being
 * bound or it was discarded, so banking a world erased its chart and its broken walls forever
 * and a world could never be returned to. The (seed, generator version) pair is the one both
 * stores already validate against, so nothing about what counts as "the same world" changes.
 */

export const WORLD_ARCHIVE_VERSION = 1;

/** The banked history caps at MAX_BANKED_SEASONS (20), so remembering 20 is what makes every
 *  row in it an honest offer. A fully explored world's discovery payload measured 3.0 KB
 *  (five seeds, 194 to 208 ids), so the whole archive is about 60 KB. */
export const MAX_ARCHIVED_WORLDS = 20;

/** Every archived payload names its own world, which is what lets a write place itself and a
 *  payload written before the archive shipped be filed under its own key rather than dropped. */
export interface ArchivedWorld {
  worldSeed: number;
  worldGenVersion: number;
}

export interface WorldArchive<T extends ArchivedWorld> {
  version: number;
  worlds: Record<string, T>;
}

/** The colon matters: JS object key order is insertion order ONLY for keys that are not
 *  integer-like, and eviction below relies on it. A bare numeric key would silently break it. */
export function worldArchiveKey(worldSeed: number, worldGenVersion: number): string {
  return `${worldSeed}:${worldGenVersion}`;
}

/**
 * The stored worlds, whatever shape the payload is in. A payload written before the archive
 * shipped is one world, presented under its own key rather than discarded: dropping it would
 * wipe the chart of the world the profile is currently flying. Entries are NOT validated here
 * and are carried across a write verbatim; each caller sanitizes the one entry it reads, which
 * is the same trust level the single-slot payload had.
 */
function archivedWorlds(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const candidate = raw as Partial<WorldArchive<ArchivedWorld>> & Partial<ArchivedWorld>;
  if (typeof candidate.worlds === 'object' && candidate.worlds !== null
    && !Array.isArray(candidate.worlds)) {
    return candidate.version === WORLD_ARCHIVE_VERSION
      ? candidate.worlds as Record<string, unknown>
      : {};
  }
  if (typeof candidate.worldSeed === 'number' && typeof candidate.worldGenVersion === 'number') {
    return { [worldArchiveKey(candidate.worldSeed, candidate.worldGenVersion)]: raw };
  }
  return {};
}

export function readArchivedWorld(
  raw: unknown, worldSeed: number, worldGenVersion: number,
): unknown {
  return archivedWorlds(raw)[worldArchiveKey(worldSeed, worldGenVersion)];
}

/** The written world is re-inserted last, so the oldest-touched world is the one evicted. */
export function writeArchivedWorld<T extends ArchivedWorld>(
  raw: unknown, payload: T,
): WorldArchive<T> {
  const worlds = { ...archivedWorlds(raw) } as Record<string, T>;
  const key = worldArchiveKey(payload.worldSeed, payload.worldGenVersion);
  delete worlds[key];
  worlds[key] = payload;
  const keys = Object.keys(worlds);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ARCHIVED_WORLDS))) {
    delete worlds[stale];
  }
  return { version: WORLD_ARCHIVE_VERSION, worlds };
}
