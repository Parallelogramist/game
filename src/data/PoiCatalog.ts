import { PoiKind } from '../world/worldTypes';

/**
 * What fills a POI slot. Worldgen owns where slots are and what kind they are
 * (sectorInterior.placePoiSlots); this catalog owns what a slot pays.
 *
 * Imports nothing but worldTypes on purpose: src/world/poiRoll.ts consumes it, and
 * src/world/ may not reach Phaser, src/game/, src/systems/ or the ECS.
 */
export type PoiContentId =
  | 'poi_treasure_chest'
  | 'poi_crate_field'
  | 'poi_field_boost_cache'
  | 'poi_black_market'
  | 'poi_ambush_nest'
  | 'poi_nemesis_lair'
  | 'poi_shrine_cleanse'
  | 'poi_shrine_power'
  | 'poi_shrine_fortune'
  | 'poi_shrine_sacrifice';

export interface PoiContentDefinition {
  id: PoiContentId;
  /** The generator slot kind this entry may fill. */
  slotKind: PoiKind;
  /** Base rarity weight before the depth-band scale. */
  weight: number;
  /** At most one of these spawns per world per run. */
  oncePerRun?: boolean;
  /**
   * Only offered while the caller reports a live nemesis and no lair already standing.
   * A separate budget from `oncePerRun`, which is one shared world-wide slot the Black
   * Market already claims.
   */
  requiresNemesis?: true;
}

/**
 * One shrine archetype per entry rather than a `shrineType` string: GameScene's switch
 * then maps each id to a ShrineType literal the compiler checks, so a typo is a red
 * build instead of an altar that silently never spawns.
 */
export const POI_CONTENTS: readonly PoiContentDefinition[] = [
  { id: 'poi_treasure_chest',    slotKind: PoiKind.Treasure, weight: 30 },
  { id: 'poi_crate_field',       slotKind: PoiKind.Treasure, weight: 25 },
  { id: 'poi_field_boost_cache', slotKind: PoiKind.Treasure, weight: 10 },
  { id: 'poi_black_market',      slotKind: PoiKind.Treasure, weight: 2, oncePerRun: true },
  { id: 'poi_ambush_nest',       slotKind: PoiKind.Treasure, weight: 15 },
  { id: 'poi_nemesis_lair',      slotKind: PoiKind.Treasure, weight: 5, requiresNemesis: true },
  { id: 'poi_shrine_cleanse',    slotKind: PoiKind.Shrine,   weight: 3 },
  { id: 'poi_shrine_power',      slotKind: PoiKind.Shrine,   weight: 3 },
  { id: 'poi_shrine_fortune',    slotKind: PoiKind.Shrine,   weight: 2 },
  { id: 'poi_shrine_sacrifice',  slotKind: PoiKind.Shrine,   weight: 2 },
];

export interface PoiDepthBand {
  /** Inclusive lower bound on SectorDef.depth. Bands MUST be ordered ascending. */
  minDepth: number;
  /** Multiplier on each content's base weight in this band; a missing key means 1. */
  weightScale: Partial<Record<PoiContentId, number>>;
}

/**
 * Depth is graph distance from the hangar, so this is doc 04 section 1's "deeper rings shift
 * toward chest/market/boost and away from crates", as data. The market's zero in the shallow
 * band is what keeps the one in-run gold sink an actual exploration payoff.
 */
export const POI_DEPTH_BANDS: readonly PoiDepthBand[] = [
  { minDepth: 0, weightScale: { poi_black_market: 0, poi_ambush_nest: 0.5 } },
  {
    minDepth: 3,
    weightScale: {
      poi_crate_field: 0.6,
      poi_treasure_chest: 1.3,
      poi_field_boost_cache: 1.5,
      poi_black_market: 4,
    },
  },
  {
    minDepth: 6,
    weightScale: {
      poi_crate_field: 0.3,
      poi_treasure_chest: 1.6,
      poi_field_boost_cache: 2,
      poi_black_market: 10,
      poi_ambush_nest: 1.4,
    },
  },
];

export interface AmbushWaveMember {
  /** An id in ENEMY_TYPES; referentialIntegrity.test.ts fails the build on a typo. */
  typeId: string;
  count: number;
}

/**
 * What a nest stands up when the ship trips it. Numbers rather than affixes: a vault guard is a
 * wall the player must beat, a nest is a swarm the player may also outrun, so forcing an elite
 * affix on nine bodies would make the optional room harder than the placed one.
 */
export const AMBUSH_NEST_WAVES: Record<'shallow' | 'deep', readonly AmbushWaveMember[]> = {
  shallow: [
    { typeId: 'swarm', count: 4 },
    { typeId: 'zigzag', count: 2 },
  ],
  deep: [
    { typeId: 'swarm', count: 4 },
    { typeId: 'charger', count: 2 },
    { typeId: 'lurker', count: 2 },
    { typeId: 'shielded', count: 1 },
  ],
};

/** The tier boundary is POI_DEPTH_BANDS' own middle band, not a second depth scale. */
export function ambushWaveTier(depth: number): 'shallow' | 'deep' {
  return depth >= 3 ? 'deep' : 'shallow';
}
