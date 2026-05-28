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
      return { type, weight: baseWeight * multiplier };
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
export function resetDirectorSystem(): void {
  creditBalance = 0;
  creditsEarned = 0;
  lastGameTime = 0;
  enemyCostCache.clear();
  pickDirectorStrategy();
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
