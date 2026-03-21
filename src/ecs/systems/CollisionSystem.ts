/**
 * Combat stats from player that affect damage calculations.
 * Used by WeaponManager.damageEnemy() for the full combat pipeline.
 */
export interface CombatStats {
  critChance: number;
  critDamage: number;
  burnChance: number;
  burnDamageMultiplier: number;
  freezeChance: number;
  freezeDurationMultiplier: number;
  poisonChance: number;
  poisonMaxStacks: number;
  chainLightningChance: number;
  lifeStealPercent: number;
  executionBonus: number;      // Extra damage to enemies below 25% HP
  overkillSplash: number;      // Percent of overkill damage splashed to nearby
  armorPenetration: number;    // Ignore enemy armor percentage
  knockbackMultiplier: number; // Knockback force multiplier
  shatterBonus: number;        // Bonus damage to frozen enemies
}

// Combat stats from player (elemental chances, crit, etc.)
let combatStats: CombatStats | null = null;

/**
 * Set combat stats (crit, elemental chances) from player.
 */
export function setCombatStats(stats: CombatStats): void {
  combatStats = stats;
}

/**
 * Get the current combat stats (for use by WeaponManager).
 * Returns a frozen copy to prevent external mutation.
 */
export function getCombatStats(): Readonly<CombatStats> | null {
  return combatStats ? Object.freeze({ ...combatStats }) : null;
}

/**
 * Resets all module-level state.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetCollisionSystem(): void {
  combatStats = null;
}
