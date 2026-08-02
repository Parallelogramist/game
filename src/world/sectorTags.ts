/**
 * sectorTags: the semantic labels a quest may name a place by (doc 04 section 4's `sectorTag`,
 * README section 3.1's "stable vocabulary, never identity" rule).
 *
 * Two families ship and the omissions are deliberate. A tag works as a quest DESTINATION only
 * if the chart may admit it before the ship has been in the room, and `revealOnSectorEntry`
 * sets PoiFlags.SEEN only on entry: a vault or altar tag would light its pin at the exact
 * moment the step it belongs to completes, and a hidden sector is off the chart until it is
 * broken into. `isBossArena` and `biomeId` are the two facts buildSectorDetail already reads
 * out for any charted sector, so pinning them leaks nothing the readout does not already say.
 *
 * Phaser-free like the rest of src/world/.
 */

import type { SectorDef, SectorKey, WorldMap } from './worldTypes';

export type SectorTag = 'boss-arena' | `biome:${string}`;

export function sectorMatchesTag(sector: SectorDef, tag: SectorTag): boolean {
  if (tag === 'boss-arena') return sector.isBossArena;
  return tag.slice('biome:'.length) === sector.biomeId;
}

/** Every tag this sector answers to: the producer half of sectorMatchesTag. The two must agree
 *  or a quest step silently becomes uncompletable, which is what sectorTags.test.ts pins. */
export function sectorTagsOf(sector: SectorDef): SectorTag[] {
  const tags: SectorTag[] = [`biome:${sector.biomeId}`];
  if (sector.isBossArena) tags.push('boss-arena');
  return tags;
}

/** The whole world, unfiltered. Restricting to what the profile has charted is the caller's
 *  job, because only the caller holds the discovery state. */
export function sectorKeysWithTag(map: WorldMap, tag: SectorTag): SectorKey[] {
  const keys: SectorKey[] = [];
  for (const sector of map.sectors.values()) {
    if (sectorMatchesTag(sector, tag)) keys.push(sector.key);
  }
  return keys;
}

/** How many sectors of one world can ever answer each tag. `anyTag` is the untagged total,
 *  which a breadth step counts against. */
export interface SectorSupplySnapshot {
  anyTag: number;
  byTag: Readonly<Record<string, number>>;
}

/**
 * One walk of a world, so a reachSector step can be asked for no more rooms than the world
 * holds. Hidden sectors are excluded deliberately: they are off the chart until a breakable
 * wall is broken, so a target that only a hidden room can satisfy is a target the player
 * cannot plan for. Counting them would also be the wrong direction of error: a step the
 * player can finish early is fine, one they cannot finish at all is the bug this fixes.
 */
export function buildSectorSupply(map: WorldMap): SectorSupplySnapshot {
  const byTag: Record<string, number> = {};
  let anyTag = 0;
  for (const sector of map.sectors.values()) {
    if (sector.hidden === true) continue;
    anyTag += 1;
    for (const tag of sectorTagsOf(sector)) byTag[tag] = (byTag[tag] ?? 0) + 1;
  }
  return { anyTag, byTag };
}
