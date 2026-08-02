/**
 * The one place an expedition world is built. Two callers need the exact same world: the
 * mode adapter that flies it, and the menu that reports how much of it is charted, so the
 * generator inputs live here rather than being written out twice and drifting.
 */

import { generateWorld } from '../world/generateWorld';
import { STAGES, getStageById } from '../data/Stages';
import { TRAVERSAL_ABILITY_GATE_ORDER } from '../data/TraversalAbilities';
import { EXPEDITION_QUEST_KEY_ORDER, WARDEN_SEAL_KEY_ID } from '../data/ExpeditionQuests';
import { PoiKind, WORLDGEN_VERSION } from '../world/worldTypes';
import type { WorldMap } from '../world/worldTypes';
import {
  getCurrentExpeditionSeasonIndex,
  getCurrentExpeditionSeed,
} from './ExpeditionSeasonStore';
import type { BankedSeason } from './ExpeditionSeasonStore';
import { getDiscoveryManager } from './DiscoveryManager';
import { isWorldConquered } from './WorldProfileStore';
import { wardenBossIdForWorld, wardenBossNameForWorld } from './wardenIdentity';

/** Three concealed rooms per world: enough that a run can stumble on one, few enough that
 *  finding one still reads as a find. */
export const EXPEDITION_HIDDEN_SECTOR_COUNT = 3;

export function generateExpeditionWorld(seed: number): WorldMap {
  return generateWorld(seed, {
    abilityGateOrder: [...TRAVERSAL_ABILITY_GATE_ORDER],
    // Appended last, never inserted: placeQuestKeyDoors assigns keys to regions positionally,
    // so this leaves all four shipped quest doors on the exact edges they already had (measured
    // over 101 seeds) and needs no WORLDGEN_VERSION bump.
    questKeyOrder: [...EXPEDITION_QUEST_KEY_ORDER, WARDEN_SEAL_KEY_ID],
    hiddenSectorCount: EXPEDITION_HIDDEN_SECTOR_COUNT,
    availableBiomeIds: STAGES.map(stage => stage.id),
  });
}

export interface ExpeditionProgressSummary {
  seasonIndex: number;
  seed: number;
  completionPercent: number;
  sectorsCharted: number;
  knowableSectors: number;
  secretsFound: number;
  wardenName: string;
  /** The id behind wardenName, so a caller can ask whether this guardian is already on the
   *  roster without re-deriving it from the seed. */
  wardenBossId: string;
  /** So a caller can build this world's quest stamp without generating the world again. The
   *  warden ids above are derived from the same value for the same reason. */
  worldGenVersion: number;
  conquered: boolean;
}

/**
 * What the profile has charted of the world it is currently on, read outside a run.
 *
 * Binding the discovery singleton here is the manager's own contract ("bindWorld is what
 * re-reads it for the world actually being played") and is what GameScene does at every
 * run start, so the only thing this can disturb is the newly-passable overlay, which a
 * scene start clears anyway. One generateWorld measured at 33 ms on the Deck: call this on
 * a button press, never per frame and never from a scene's create().
 */
export function summariseCurrentExpedition(): ExpeditionProgressSummary {
  const seed = getCurrentExpeditionSeed();
  const discovery = getDiscoveryManager();
  const map = generateExpeditionWorld(seed);
  discovery.bindWorld(map);
  return {
    seasonIndex: getCurrentExpeditionSeasonIndex(),
    seed,
    completionPercent: discovery.getCompletionPercent(),
    sectorsCharted: discovery.getVisitedSectorCount(),
    knowableSectors: discovery.getKnowableSectorCount(),
    secretsFound: discovery.getFoundSecretCount(),
    wardenName: wardenBossNameForWorld(seed, map.worldGenVersion),
    wardenBossId: wardenBossIdForWorld(seed, map.worldGenVersion),
    worldGenVersion: map.worldGenVersion,
    conquered: isWorldConquered(seed, map.worldGenVersion),
  };
}

export interface BankedWorldRow extends BankedSeason {
  conquered: boolean;
}

/**
 * The banked history plus the one fact the season store does not carry. Conquest lives in
 * WorldProfileStore keyed on (seed, generator version), so no world has to be generated to
 * read it. A world banked under an older generator reads unconquered, which is honest: a
 * version bump discards that world's memory anyway.
 */
export function describeBankedWorlds(
  banked: readonly BankedSeason[],
): readonly BankedWorldRow[] {
  return banked.map(season => ({
    ...season,
    conquered: isWorldConquered(season.seed, WORLDGEN_VERSION),
  }));
}

export interface ExpeditionWorldPreview {
  seed: number;
  secretSlots: number;
  /** Treasure + Shrine: the slots FEAT-POI-CATALOG stocks on first sector entry. */
  cacheSlots: number;
  deepestSectorDepth: number;
  deepestRegionName: string;
  /** Who guards it. The one preview fact that is not a count: choosing a world is choosing a
   *  guardian, and it is fixed for that world forever. */
  wardenName: string;
  /** The id behind wardenName. A pure function of (seed, generator version), which is what makes
   *  it safe inside previewExpeditionWorlds' memo: "have you beaten it" is not, because it can
   *  change within one session. */
  wardenBossId: string;
}

/**
 * The facts that actually vary between seeds, measured over 41 worlds of the real chain:
 * secret slots 15 to 33, caches 30 to 61, deepest depth 7 to 13, four distinct deepest
 * regions. Sector count (always 48), ability doors (6), key doors (5, four quest plus the
 * warden seal) and hidden sectors (3) are deliberately absent: a preview number that never
 * moves is decoration.
 */
export function previewExpeditionWorld(seed: number): ExpeditionWorldPreview {
  const map = generateExpeditionWorld(seed);
  let secretSlots = 0;
  let cacheSlots = 0;
  let deepestSectorDepth = 0;
  let deepestBiomeId = '';
  let deepestKey = '';
  for (const sector of map.sectors.values()) {
    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret) secretSlots += 1;
      else if (slot.kind === PoiKind.Treasure || slot.kind === PoiKind.Shrine) cacheSlots += 1;
    }
    // Key order breaks depth ties, so the preview cannot depend on Map iteration order.
    if (sector.depth > deepestSectorDepth
      || (sector.depth === deepestSectorDepth && (deepestKey === '' || sector.key < deepestKey))) {
      deepestSectorDepth = sector.depth;
      deepestBiomeId = sector.biomeId;
      deepestKey = sector.key;
    }
  }
  return {
    seed,
    secretSlots,
    cacheSlots,
    deepestSectorDepth,
    deepestRegionName: getStageById(deepestBiomeId)?.name ?? deepestBiomeId,
    wardenName: wardenBossNameForWorld(seed, map.worldGenVersion),
    wardenBossId: wardenBossIdForWorld(seed, map.worldGenVersion),
  };
}

let previewMemoKey = '';
let previewMemo: readonly ExpeditionWorldPreview[] = [];

/** Memoised on the seed list because reopening the CHART dialog in one session must not pay
 *  the generator again: one preview is one generateWorld, 34 ms measured on the Deck. Keyed
 *  on its own input, so it cannot go stale and needs no reset hook (the precedent is
 *  seasonQuests.buildSeasonQuests). */
export function previewExpeditionWorlds(
  seeds: readonly number[],
): readonly ExpeditionWorldPreview[] {
  const key = seeds.join(',');
  if (key === previewMemoKey) return previewMemo;
  previewMemo = seeds.map(previewExpeditionWorld);
  previewMemoKey = key;
  return previewMemo;
}
