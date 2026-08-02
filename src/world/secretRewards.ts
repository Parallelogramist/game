import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';
import { weightedPick } from './generateWorld';

/**
 * What a found secret PAYS. Worldgen owns where secrets are; this owns what one is worth.
 *
 * Entries are ids, not spawn calls, for the PoiCatalog reason: src/world/ may not reach
 * Phaser, src/game/, src/systems/ or the ECS, so GameScene maps each id to a rail that
 * already exists and the `never` default there turns a future unmapped entry into a compile
 * error rather than a secret that pays nothing.
 *
 * Nothing here pays gold. Exploration grants more relic ROLLS on the unchanged arena table
 * and never better odds (doc 04 econ rule 1), so a found secret adds nothing to the
 * expedition gold budget FEAT-ECON-WARDS will eventually enforce.
 */
export type SecretRewardId =
  | 'secret_relic_chest'
  | 'secret_twin_chests'
  | 'secret_armory_cache'
  | 'secret_boost_bundle'
  | 'secret_ordnance_pack'
  | 'secret_repair_bay'
  | 'secret_map_fragment';

/** A cache is walked into; a hidden sector is a whole room the chart never drew; a puzzle
 *  cache is a walk-in that made the player earn it. */
export type SecretTier = 'cache' | 'hiddenSector' | 'puzzle';

export interface SecretRewardDefinition {
  id: SecretRewardId;
  /** Toast body: names the payout, so variety a player cannot read is not variety. */
  description: string;
  /** Semantic IconMap key. */
  icon: string;
  /** Base rarity weight before the depth-band and tier scales. */
  weight: number;
}

/**
 * `secret_twin_chests` sits at index 1 rather than last because the shallow band zeroes it:
 * weightedPick walks past a zero weight, and a zero in the final slot is the one position
 * where that reasoning needs a second look.
 *
 * `secret_armory_cache` sits at index 2 for the same reason: the shallow band zeroes it too, and
 * two zeroable rows both belong away from the fallback slot.
 */
export const SECRET_REWARDS: readonly SecretRewardDefinition[] = [
  {
    id: 'secret_relic_chest',
    description: 'A sealed chest waits where the wall stood.',
    icon: 'star',
    weight: 34,
  },
  {
    id: 'secret_twin_chests',
    description: 'Two sealed chests, and nobody came back for either.',
    icon: 'gem',
    weight: 8,
  },
  {
    id: 'secret_armory_cache',
    description: 'An armory crate, and the racks inside are still loaded.',
    icon: 'sword',
    weight: 10,
  },
  {
    id: 'secret_boost_bundle',
    description: 'A field-boost cache, three charges still live.',
    icon: 'lightning',
    weight: 22,
  },
  {
    id: 'secret_ordnance_pack',
    description: 'Ordnance: a bomb, a freeze and a vacuum charge.',
    icon: 'bomb',
    weight: 20,
  },
  {
    id: 'secret_repair_bay',
    description: 'An intact repair bay. Hull plating, still sealed.',
    icon: 'heart',
    weight: 16,
  },
  {
    id: 'secret_map_fragment',
    description: 'Survey data from a ship that got further than this one.',
    icon: 'radar',
    weight: 14,
  },
];

export interface SecretRewardDepthBand {
  /** Inclusive lower bound on SectorDef.depth. Bands MUST be ordered ascending. */
  minDepth: number;
  /** Multiplier on each reward's base weight in this band; a missing key means 1. */
  weightScale: Partial<Record<SecretRewardId, number>>;
}

/** Depth is graph distance from the hangar, so the jackpot is unreachable in the first ring
 *  and climbs outward: the knob for depth is chest COUNT, never table quality. */
export const SECRET_REWARD_DEPTH_BANDS: readonly SecretRewardDepthBand[] = [
  { minDepth: 0, weightScale: { secret_twin_chests: 0, secret_armory_cache: 0 } },
  {
    minDepth: 3,
    weightScale: {
      secret_twin_chests: 1.5,
      secret_relic_chest: 1.1,
      secret_repair_bay: 0.9,
      secret_map_fragment: 1.2,
      secret_armory_cache: 1.2,
    },
  },
  {
    minDepth: 6,
    weightScale: {
      secret_twin_chests: 3,
      secret_relic_chest: 1.2,
      secret_boost_bundle: 1.2,
      secret_repair_bay: 0.7,
      secret_map_fragment: 1.3,
      secret_armory_cache: 1.6,
    },
  },
];

/** A room that was never on the chart is the strongest find in the game, so it leans away
 *  from the payout a cache hands out most often and toward the one it hands out least. */
export const SECRET_TIER_SCALES: Readonly<
  Record<SecretTier, Partial<Record<SecretRewardId, number>>>
> = {
  cache: {},
  hiddenSector: {
    secret_twin_chests: 3,
    secret_relic_chest: 0.7,
    secret_repair_bay: 0.6,
    secret_map_fragment: 0.5,
    secret_armory_cache: 1.5,
  },
  /** Earned rather than stumbled into, so it leans the hidden-sector way without matching a
   *  whole undrawn room: half that lean on the jackpot, and the same push off the repair bay. */
  puzzle: {
    secret_twin_chests: 2,
    secret_boost_bundle: 1.2,
    secret_repair_bay: 0.6,
    secret_armory_cache: 1.25,
  },
};

export interface SecretRewardRollInput {
  /** WorldMap.seed. No run salt: a secret is found once and never respawns, so re-rolling
   *  per run would only make the payout unrepeatable, never varied. */
  worldSeed: number;
  /** PoiSlot.id for a cache, SectorDef.key for a hidden sector. */
  secretId: string;
  /** SectorDef.depth, graph distance from the hangar. */
  depth: number;
  tier: SecretTier;
}

export function rollSecretReward(input: SecretRewardRollInput): SecretRewardDefinition {
  const bandScale = depthBandScale(input.depth);
  const tierScale = SECRET_TIER_SCALES[input.tier];
  const weights = SECRET_REWARDS.map(reward =>
    reward.weight * (bandScale[reward.id] ?? 1) * (tierScale[reward.id] ?? 1));
  const rng = mulberry32(hashStringToSeed(
    `secretReward:${input.worldSeed}:${input.tier}:${input.secretId}`));
  return SECRET_REWARDS[weightedPick(weights, rng)];
}

function depthBandScale(depth: number): Partial<Record<SecretRewardId, number>> {
  let scale = SECRET_REWARD_DEPTH_BANDS[0].weightScale;
  for (const band of SECRET_REWARD_DEPTH_BANDS) {
    if (depth >= band.minDepth) scale = band.weightScale;
  }
  return scale;
}
