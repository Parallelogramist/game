/**
 * regionSignature: the one-line rule a region obeys, in the player's words.
 *
 * Pure and Phaser-free: it reads the same STAGE_SPAWN_BIASES and STAGE_HAZARD_BIASES tables the
 * director and the hazard spawner roll against, so the banner can never promise a pack or a
 * hazard the region does not send. Enemy names come from ENEMY_TYPES rather than a second
 * authored table, for the reason the bias table itself carries: a parallel list of display names
 * is a source of truth waiting to disagree. Hazard types are the exception: they have no display
 * name anywhere in the catalog, so the four words below are authored here, beside the only
 * surface that says them.
 */

import { ENEMY_TYPES } from '../enemies/EnemyTypes';
import { STAGE_SPAWN_BIASES } from './DirectorSystem';
import { STAGE_HAZARD_BIASES } from './stageHazardBias';
import type { HazardType, StageHazardBias } from './stageHazardBias';

const BOOSTED_NAMED = 2;
const SUPPRESSED_NAMED = 1;

/** Matches the separator the sector banner already uses between its own clauses. */
const CLAUSE_SEPARATOR = '  ·  ';

/**
 * Declared alphabetically: Object.keys walks string keys in insertion order and the scan below
 * keeps the first of an equal pair, so a tie resolves the same way on every region entry.
 */
const HAZARD_SIGNATURE_NAMES: Readonly<Record<HazardType, string>> = {
  burn: 'fire',
  energy: 'energy',
  ice: 'ice',
  void: 'void',
};

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

/** The one hazard a region grows more of than default ground, or null when it grows none. */
function signatureHazardName(bias: StageHazardBias | undefined): string | null {
  if (bias === undefined) return null;
  let strongest: HazardType | null = null;
  for (const hazardType of Object.keys(HAZARD_SIGNATURE_NAMES) as HazardType[]) {
    const multiplier = bias.weightMultipliers[hazardType];
    if (multiplier <= 1) continue;
    if (strongest === null || multiplier > bias.weightMultipliers[strongest]) {
      strongest = hazardType;
    }
  }
  return strongest === null ? null : HAZARD_SIGNATURE_NAMES[strongest];
}

/**
 * The banner's second line for a region, or null when the region has no signature to state.
 * Null for stage_deep_void (unbiased in both tables on purpose) and for any unknown stage id,
 * so the caller renders exactly the one-line banner it renders today.
 */
export function describeRegionSignature(stageId: string): string | null {
  const spawnBias = STAGE_SPAWN_BIASES[stageId];
  const hazardBias = STAGE_HAZARD_BIASES[stageId];

  const clauses: string[] = [];
  if (spawnBias !== undefined) {
    const boosted = namesByMultiplier(spawnBias, m => m > 1, (a, b) => b - a, BOOSTED_NAMED);
    const suppressed = namesByMultiplier(spawnBias, m => m < 1, (a, b) => a - b, SUPPRESSED_NAMED);
    if (boosted.length > 0) clauses.push(`Sends ${boosted.join(' and ')}`);
    if (suppressed.length > 0) clauses.push(`Few ${suppressed.join(' and ')}`);
  }

  const hazardName = signatureHazardName(hazardBias);
  if (hazardName !== null) clauses.push(`Blooms ${hazardName}`);

  if (clauses.length === 0) return null;
  return clauses.join(CLAUSE_SEPARATOR).toUpperCase();
}
