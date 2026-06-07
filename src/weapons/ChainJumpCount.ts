/**
 * Pure logic for the chain-lightning jump count.
 *
 * Chain Lightning's jump count was derived purely from level scaling plus the
 * generic projectile-count bonus (`base + floor(level/2) + genericBonusCount`),
 * so the dedicated `chainLightningCount` stat — advertised by the Chain Catalyst
 * relic (+2) and the `chainCountLevel` meta upgrade — was written and never read
 * (same dead-stat vein as `weaponSynergy`/`501b5bc` and `slowResistance`/`457a755`).
 *
 * `resolveChainJumpCount` folds the dedicated chain bonus in as a fourth additive
 * term. At `chainBonusCount === 0` the result is byte-identical to the old formula,
 * so wiring the stat is regression-safe for runs without the relic/upgrade. Kept
 * pure (no Phaser/ECS) so it is unit-testable without a live scene.
 */

/**
 * Resolve the number of chain-lightning jumps from level + external bonuses.
 *
 * @param baseCount - The weapon's base jump count (its `baseStats.count`).
 * @param level - The weapon's current level (drives `floor(level / 2)` extra jumps).
 * @param genericBonusCount - The generic projectile-count bonus from
 *   `applyMultipliers` (`externalBonusCount`).
 * @param chainBonusCount - The dedicated `chainLightningCount` stat. Sanitized to a
 *   finite, non-negative integer; negative/non-finite (e.g. a corrupt legacy save)
 *   contributes 0, so it can never pull jumps below the level + generic baseline.
 * @returns The total number of chain jumps.
 */
export function resolveChainJumpCount(
  baseCount: number,
  level: number,
  genericBonusCount: number,
  chainBonusCount: number
): number {
  const safeChainBonus = Number.isFinite(chainBonusCount)
    ? Math.max(0, Math.floor(chainBonusCount))
    : 0;
  return baseCount + Math.floor(level / 2) + genericBonusCount + safeChainBonus;
}
