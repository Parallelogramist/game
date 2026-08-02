/**
 * regionSignature: the one-line rule a region obeys, in the player's words.
 *
 * Pure and Phaser-free: it reads the same STAGE_SPAWN_BIASES table the director rolls
 * against, so the banner can never promise a pack the director does not send. Enemy names
 * come from ENEMY_TYPES rather than a second authored table, for the reason the bias table
 * itself carries: a parallel list of display names is a source of truth waiting to disagree.
 *
 * The hazard half of a signature is deliberately absent: STAGE_HAZARD_BIASES is private to
 * HazardZoneSystem, which imports Phaser, so reaching it needs an extraction this slice does
 * not do (FEAT-REGION-SIGNATURE-HAZARDS).
 */

import { ENEMY_TYPES } from '../enemies/EnemyTypes';
import { STAGE_SPAWN_BIASES } from './DirectorSystem';

const BOOSTED_NAMED = 2;
const SUPPRESSED_NAMED = 1;

/** Matches the separator the sector banner already uses between its own clauses. */
const CLAUSE_SEPARATOR = '  ·  ';

function displayNameOf(enemyId: string): string | null {
  return ENEMY_TYPES[enemyId]?.name ?? null;
}

/**
 * Ties are broken by enemy id ascending so the line is stable across runs: Endless Void
 * boosts teleporter and wraith at 3.0 each, and a banner that reordered them between
 * entries would read as two different rules for one region.
 */
function namesByMultiplier(
  bias: Readonly<Record<string, number>>,
  keep: (multiplier: number) => boolean,
  order: (a: number, b: number) => number,
  limit: number,
): string[] {
  return Object.entries(bias)
    .filter(([, multiplier]) => keep(multiplier))
    .sort(([idA, multiplierA], [idB, multiplierB]) =>
      order(multiplierA, multiplierB) || idA.localeCompare(idB))
    .map(([enemyId]) => displayNameOf(enemyId))
    .filter((name): name is string => name !== null)
    .slice(0, limit);
}

/**
 * The banner's second line for a region, or null when the region has no signature to state.
 * Null for stage_deep_void (its bias row is empty on purpose) and for any unknown stage id,
 * so the caller renders exactly the one-line banner it renders today.
 */
export function describeRegionSignature(stageId: string): string | null {
  const bias = STAGE_SPAWN_BIASES[stageId];
  if (bias === undefined) return null;

  const boosted = namesByMultiplier(bias, m => m > 1, (a, b) => b - a, BOOSTED_NAMED);
  const suppressed = namesByMultiplier(bias, m => m < 1, (a, b) => a - b, SUPPRESSED_NAMED);

  const clauses: string[] = [];
  if (boosted.length > 0) clauses.push(`Sends ${boosted.join(' and ')}`);
  if (suppressed.length > 0) clauses.push(`Few ${suppressed.join(' and ')}`);
  if (clauses.length === 0) return null;
  return clauses.join(CLAUSE_SEPARATOR).toUpperCase();
}
