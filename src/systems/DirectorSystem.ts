/**
 * DirectorSystem — dynamic difficulty director (Risk of Rain 2 inspired).
 *
 * Replaces time-weighted probability spawning with a credit-budget system.
 * Credits accumulate per second; each enemy type has a spawn cost.
 * The director picks a random spend strategy per run, adding variance so
 * mechanically identical runs feel different.
 *
 * Module-level state pattern — call resetDirectorSystem() in GameScene.create().
 */

import {
  EnemyTypeDefinition,
  ENEMY_TYPES,
  EnemyCategory,
  getRandomEnemyType,
} from '../enemies/EnemyTypes';

// ---------------------------------------------------------------------------
// Spend strategies — selected once per run for variance
// ---------------------------------------------------------------------------

export type DirectorStrategy = 'swarm' | 'elite' | 'balanced' | 'chaos';

/** Canonical list of the four director strategies, in RNG-index order. */
export const DIRECTOR_STRATEGIES: readonly DirectorStrategy[] = ['swarm', 'elite', 'balanced', 'chaos'];

/** Runtime guard: true when `value` is one of the four valid director strategies. */
export function isDirectorStrategy(value: unknown): value is DirectorStrategy {
  return typeof value === 'string' && (DIRECTOR_STRATEGIES as readonly string[]).includes(value);
}

const STRATEGY_CONFIG: Record<DirectorStrategy, {
  saveChance: number;        // Chance per spawn tick to save credits instead of spend
  maxAffordableBias: number; // 0.0 = spend cheap, 1.0 = always spend max-affordable
  basicMultiplier: number;   // Weight multiplier for Basic-category enemies
  eliteMultiplier: number;   // Weight multiplier for Elite-category enemies
}> = {
  swarm:    { saveChance: 0.05, maxAffordableBias: 0.1, basicMultiplier: 2.5, eliteMultiplier: 0.3 },
  elite:    { saveChance: 0.35, maxAffordableBias: 0.8, basicMultiplier: 0.6, eliteMultiplier: 2.5 },
  balanced: { saveChance: 0.15, maxAffordableBias: 0.4, basicMultiplier: 1.0, eliteMultiplier: 1.0 },
  chaos:    { saveChance: 0.20, maxAffordableBias: 0.5, basicMultiplier: 1.5, eliteMultiplier: 1.5 },
};

// ---------------------------------------------------------------------------
// Region spawn bias — a biome sends its own pack
// ---------------------------------------------------------------------------

/**
 * Per-stage weight multipliers on the director's weighted roll, keyed by enemy id.
 * The twin of HazardZoneSystem's STAGE_HAZARD_BIASES: a region already picks the
 * hazard mix and the palette, and this is the third thing a named region owes the
 * player, the pack that lives there. An id absent from a stage's row is 1.0, and
 * stage_deep_void is empty on purpose so the default stage rolls exactly as before.
 * Every value is > 0: a 0 would let a small affordable pool sum to a zero total
 * weight, which the roll below cannot divide.
 */
export const STAGE_SPAWN_BIASES: Record<string, Readonly<Record<string, number>>> = {
  // The familiar expanse. No bias at all — this is the shape every other row deviates from.
  stage_deep_void: {},
  // Inferno: things that rush and burst. Suppressed shields and healers — nothing
  // patient survives here.
  stage_inferno: {
    exploder: 3.0, dasher: 2.2, zigzag: 1.6, swarm: 1.4, shielded: 0.4, healer: 0.3,
  },
  // Crystal Caves: armoured and splitting, matching the stage's own tougher-enemies
  // promise. Rushers and bursts are rare in the lattice.
  stage_crystal_caves: {
    shielded: 3.0, tank: 2.4, splitter: 2.0, giant: 1.6, dasher: 0.5, exploder: 0.4,
  },
  // Endless Void: things that blink, lurk and wait. Heavy bodies are rare in the rift.
  stage_endless_void: {
    teleporter: 3.0, wraith: 3.0, lurker: 2.0, warden: 1.6, tank: 0.5, exploder: 0.6,
  },
  // Ion Field: the charged plain shoots back. Everything ranged, plus the Rallier
  // riding the storm; melee bodies thin out.
  stage_ion_field: {
    shooter: 3.0, sniper: 2.5, circler: 2.0, rallier: 1.8, tank: 0.5, exploder: 0.5,
  },
  // Verdant Rot: it multiplies and it mends. Ranged pressure drops off in the damp.
  stage_verdant_rot: {
    swarm: 3.0, healer: 2.5, splitter: 2.4, lurker: 1.8, shooter: 0.6, sniper: 0.5,
  },
  // Molten Vault: the ore is guarded by the heaviest things in the catalog, and the
  // chaff is burned off.
  stage_molten_vault: {
    giant: 3.0, tank: 2.5, warden: 2.2, exploder: 1.6, zigzag: 0.5, swarm: 0.5,
  },
};

const DEFAULT_STAGE_SPAWN_BIAS: Readonly<Record<string, number>> = {};

let activeSpawnBias: Readonly<Record<string, number>> = DEFAULT_STAGE_SPAWN_BIAS;

/**
 * Point the director at a stage's pack. Called from the same three places
 * setHazardZoneStage is: run setup, save restore, and an expedition region change.
 */
export function setDirectorStage(stageId: string): void {
  activeSpawnBias = STAGE_SPAWN_BIASES[stageId] ?? DEFAULT_STAGE_SPAWN_BIAS;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Credits accumulated but not yet spent. */
let creditBalance = 0;

/** Total credits earned this run (diagnostic). */
let creditsEarned = 0;

/** Current strategy (randomized per run). */
let currentStrategy: DirectorStrategy = 'balanced';

/** Last game time credits were calculated for (to compute delta). */
let lastGameTime = 0;

/** Whether the director is enabled (gated behind feature flag for A/B testing). */
let directorEnabled = true;

/** Per-enemy spawn cost cache — computed lazily on first use. */
const enemyCostCache = new Map<string, number>();

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

/**
 * Compute a spawn cost for an enemy derived from its base stats.
 * Stronger enemies cost more. Cheap enemies (~1-3 credits), elites (~8-20),
 * minibosses (~40-80), bosses (~200+).
 */
export function getEnemyCost(enemyType: EnemyTypeDefinition): number {
  const cached = enemyCostCache.get(enemyType.id);
  if (cached !== undefined) return cached;

  const healthComponent = enemyType.baseHealth / 15;
  const damageComponent = enemyType.baseDamage / 10;
  const xpComponent = Math.sqrt(Math.max(1, enemyType.xpValue));

  let cost = healthComponent + damageComponent * 1.5 + xpComponent;

  if (enemyType.category === EnemyCategory.Elite) cost *= 2.0;
  if (enemyType.category === EnemyCategory.Miniboss) cost *= 8.0;
  if (enemyType.category === EnemyCategory.Boss) cost *= 30.0;

  const roundedCost = Math.max(1, Math.round(cost));
  enemyCostCache.set(enemyType.id, roundedCost);
  return roundedCost;
}

// ---------------------------------------------------------------------------
// Credit accumulation
// ---------------------------------------------------------------------------

/**
 * Credits-per-second scales with gameTime to match power creep.
 * At 0s: ~2/s. At 60s: ~4/s. At 300s: ~10/s. At 600s: ~18/s.
 */
function getCreditRate(gameTime: number, worldLevel: number): number {
  const timeScale = 2 + gameTime * 0.025;
  const worldScale = 1 + (worldLevel - 1) * 0.15;
  return timeScale * worldScale;
}

/**
 * Advance director state. Call once per frame from GameScene update.
 */
export function updateDirector(gameTime: number, worldLevel: number): void {
  if (!directorEnabled) return;

  const deltaSeconds = Math.max(0, gameTime - lastGameTime);
  lastGameTime = gameTime;

  const creditsThisFrame = getCreditRate(gameTime, worldLevel) * deltaSeconds;
  creditBalance += creditsThisFrame;
  creditsEarned += creditsThisFrame;
}

// ---------------------------------------------------------------------------
// Strategy selection
// ---------------------------------------------------------------------------

/**
 * Pick a random strategy. Call once per run from GameScene.create().
 * Accepts an optional forced strategy (for seeded daily runs).
 */
export function pickDirectorStrategy(forced?: DirectorStrategy): DirectorStrategy {
  if (forced !== undefined) {
    currentStrategy = forced;
    return currentStrategy;
  }
  const strategies: DirectorStrategy[] = ['swarm', 'elite', 'balanced', 'chaos'];
  currentStrategy = strategies[Math.floor(Math.random() * strategies.length)];
  return currentStrategy;
}

export function getCurrentStrategy(): DirectorStrategy {
  return currentStrategy;
}

// ---------------------------------------------------------------------------
// Enemy selection
// ---------------------------------------------------------------------------

/**
 * Pick an enemy to spawn given current credit balance, game time, and world level.
 * Deducts the enemy's cost from the balance. Returns null if director chose to save.
 *
 * Fallback: if no enemies are affordable, returns the basic Shambler (free of cost).
 */
export function pickEnemyFromDirector(
  gameTime: number,
  spawnTimeReduction: number,
  worldLevel: number
): EnemyTypeDefinition | null {
  if (!directorEnabled) {
    return getRandomEnemyType(gameTime, spawnTimeReduction, worldLevel);
  }

  const config = STRATEGY_CONFIG[currentStrategy];

  // Choose to save credits this tick (defers spending for a bigger enemy later)
  if (Math.random() < config.saveChance) {
    return null;
  }

  const effectiveGameTime = gameTime + spawnTimeReduction;
  const allCandidates = Object.values(ENEMY_TYPES).filter(
    (type) =>
      type.minSpawnTime <= effectiveGameTime &&
      type.spawnWeight > 0 &&
      type.category !== EnemyCategory.Miniboss &&
      type.category !== EnemyCategory.Boss &&
      (type.minWorldLevel ?? 1) <= worldLevel
  );

  if (allCandidates.length === 0) return ENEMY_TYPES.basic;

  // Filter to affordable candidates
  const affordable = allCandidates.filter((type) => getEnemyCost(type) <= creditBalance);
  if (affordable.length === 0) {
    // Not enough credits for anything legal — spawn the cheapest option anyway,
    // but at 1 credit (we want to always be able to spawn SOMETHING).
    const cheapest = allCandidates.reduce((best, candidate) =>
      getEnemyCost(candidate) < getEnemyCost(best) ? candidate : best
    );
    creditBalance = Math.max(0, creditBalance - getEnemyCost(cheapest));
    return cheapest;
  }

  // Apply strategy biasing: bias toward expensive enemies if maxAffordableBias is high
  let picked: EnemyTypeDefinition;
  if (Math.random() < config.maxAffordableBias) {
    // Pick among the most expensive affordable options (top-tier spending)
    const sortedByCost = [...affordable].sort((a, b) => getEnemyCost(b) - getEnemyCost(a));
    const topTierCount = Math.max(1, Math.ceil(sortedByCost.length * 0.3));
    const topTier = sortedByCost.slice(0, topTierCount);
    picked = topTier[Math.floor(Math.random() * topTier.length)];
  } else {
    // Weighted random pick using base spawn weights x strategy category multipliers
    const weighted = affordable.map((type) => {
      const baseWeight = type.spawnWeight;
      const multiplier =
        type.category === EnemyCategory.Basic ? config.basicMultiplier :
        type.category === EnemyCategory.Elite ? config.eliteMultiplier :
        1.0;
      const regionMultiplier = activeSpawnBias[type.id] ?? 1.0;
      return { type, weight: baseWeight * multiplier * regionMultiplier };
    });

    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * totalWeight;
    picked = weighted[weighted.length - 1].type;
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) {
        picked = entry.type;
        break;
      }
    }
  }

  creditBalance = Math.max(0, creditBalance - getEnemyCost(picked));
  return picked;
}

// ---------------------------------------------------------------------------
// Reset / enable
// ---------------------------------------------------------------------------

/**
 * Reset director state. Call in GameScene.create() on new run.
 */
export function resetDirectorSystem(forced?: DirectorStrategy): void {
  creditBalance = 0;
  creditsEarned = 0;
  lastGameTime = 0;
  enemyCostCache.clear();
  activeSpawnBias = DEFAULT_STAGE_SPAWN_BIAS;
  pickDirectorStrategy(forced);
}

export function setDirectorEnabled(enabled: boolean): void {
  directorEnabled = enabled;
}

// Save/restore support for mid-run refresh
export interface DirectorState {
  creditBalance: number;
  creditsEarned: number;
  currentStrategy: DirectorStrategy;
  lastGameTime: number;
}

export function getDirectorState(): DirectorState {
  return { creditBalance, creditsEarned, currentStrategy, lastGameTime };
}

export function restoreDirectorState(state: DirectorState): void {
  creditBalance = state.creditBalance;
  creditsEarned = state.creditsEarned;
  currentStrategy = state.currentStrategy;
  lastGameTime = state.lastGameTime;
}
