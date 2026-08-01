import { describe, it, expect } from 'vitest';
import {
  MAX_ARCHIVED_WORLDS,
  readArchivedWorld,
  worldArchiveKey,
  writeArchivedWorld,
} from './worldArchive';

const world = (worldSeed: number, note = '') => ({ worldSeed, worldGenVersion: 3, note });

describe('world archive', () => {
  it('reads a payload written before the archive shipped, and keeps it across a write', () => {
    // The one catastrophic failure: a live profile's chart is wiped by the build that ships
    // the feature meant to preserve it.
    const legacy = world(20260727, 'live');
    expect(readArchivedWorld(legacy, 20260727, 3)).toEqual(legacy);
    expect(readArchivedWorld(legacy, 20260727, 2)).toBeUndefined();
    expect(readArchivedWorld(legacy, 999, 3)).toBeUndefined();

    const archive = writeArchivedWorld(legacy, world(4242, 'new'));
    expect(readArchivedWorld(archive, 20260727, 3)).toEqual(legacy);
    expect(readArchivedWorld(archive, 4242, 3)).toEqual(world(4242, 'new'));
  });

  it('keeps worlds apart by seed and by generator version', () => {
    let archive: unknown = null;
    archive = writeArchivedWorld(archive, world(11, 'a'));
    archive = writeArchivedWorld(archive, { worldSeed: 11, worldGenVersion: 2, note: 'b' });
    expect(readArchivedWorld(archive, 11, 3)).toEqual(world(11, 'a'));
    expect(readArchivedWorld(archive, 11, 2))
      .toEqual({ worldSeed: 11, worldGenVersion: 2, note: 'b' });
    expect(Object.keys((archive as { worlds: object }).worlds))
      .toEqual([worldArchiveKey(11, 3), worldArchiveKey(11, 2)]);
  });

  it('evicts the oldest-touched world at the cap and never the one just written', () => {
    let archive: unknown = null;
    for (let seed = 1; seed <= MAX_ARCHIVED_WORLDS + 5; seed++) {
      archive = writeArchivedWorld(archive, world(seed));
    }
    const worlds = (archive as { worlds: Record<string, unknown> }).worlds;
    expect(Object.keys(worlds).length).toBe(MAX_ARCHIVED_WORLDS);
    expect(readArchivedWorld(archive, 1, 3)).toBeUndefined();
    expect(readArchivedWorld(archive, MAX_ARCHIVED_WORLDS + 5, 3)).toBeDefined();

    // Re-writing an old world makes it the most recent, so the next eviction is not it.
    archive = writeArchivedWorld(archive, world(6, 'touched'));
    archive = writeArchivedWorld(archive, world(9001));
    expect(readArchivedWorld(archive, 6, 3)).toEqual(world(6, 'touched'));
  });
});
