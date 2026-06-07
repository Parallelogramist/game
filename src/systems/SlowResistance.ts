/**
 * Pure logic for the player's `slowResistance` stat.
 *
 * The only thing that slows the *player* is the Warden enemy's slow aura
 * (`getWardenSlowMultiplier()` in `EnemyAISystem`, applied to player Velocity in
 * `GameScene`). `slowResistance` is advertised by the `slowResistLevel` permanent
 * upgrade (+15%/level) and the `relic_frost_ward` legendary (+20%), but until now
 * the stat was written and never read — both sources were no-ops (same dead-stat
 * vein as `weaponSynergy`/`501b5bc` and the wired weapon stats).
 *
 * `resolveSlowAfterResistance` scales back only the *slow penalty* — the deviation
 * of the slow multiplier from 1.0 — by the resistance fraction, so at resistance 0
 * the output is byte-identical to the raw slow (regression-safe wiring) and at
 * resistance 1.0 the player is fully immune. Kept pure (no Phaser/ECS) so it is
 * unit-testable without a live scene.
 */

/**
 * Apply the player's slow resistance to a raw slow multiplier.
 *
 * @param rawSlowMultiplier - The incoming slow as a speed multiplier in (0, 1],
 *   e.g. 0.85 for one Warden aura (1.0 = no slow). Non-finite → treated as no slow.
 * @param slowResistance - The player's `slowResistance` stat (0 = none, 1 = immune).
 *   Clamped to [0, 1]; negative or non-finite → 0 (no resistance applied).
 * @returns The resisted slow multiplier in [0, 1]. At resistance 0 this equals
 *   `rawSlowMultiplier` exactly; at resistance 1.0 it is 1.0 (no slow).
 */
export function resolveSlowAfterResistance(
  rawSlowMultiplier: number,
  slowResistance: number
): number {
  // A non-finite or non-slowing input means "nothing to resist".
  if (!Number.isFinite(rawSlowMultiplier) || rawSlowMultiplier >= 1.0) {
    return 1.0;
  }

  const clampedResistance = Number.isFinite(slowResistance)
    ? Math.max(0, Math.min(1, slowResistance))
    : 0;

  // Scale only the deviation from 1.0 so resistance 0 is a perfect no-op.
  const slowPenalty = 1 - rawSlowMultiplier;
  const resistedMultiplier = 1 - slowPenalty * (1 - clampedResistance);

  // A slow multiplier is always a speed fraction in [0, 1].
  return Math.max(0, Math.min(1, resistedMultiplier));
}
