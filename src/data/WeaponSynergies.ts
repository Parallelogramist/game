/**
 * Weapon Synergy System — passive bonuses when specific weapon pairs are equipped.
 *
 * Synergies add build-crafting depth: players experiment with weapon combos
 * for powerful passive effects beyond raw DPS.
 */

export interface WeaponSynergy {
  readonly weaponA: string;
  readonly weaponB: string;
  readonly name: string;
  readonly description: string;
  /** Damage multiplier applied to BOTH weapons (e.g., 1.15 = +15%) */
  readonly damageMultiplier: number;
  /** Cooldown multiplier applied to BOTH weapons (e.g., 0.9 = 10% faster) */
  readonly cooldownMultiplier: number;
}

/**
 * All weapon synergy pairs. Each pair grants a passive bonus when both weapons
 * are equipped simultaneously.
 */
export const WEAPON_SYNERGIES: readonly WeaponSynergy[] = [
  {
    weaponA: 'frost_nova',
    weaponB: 'meteor',
    name: 'Thermal Shock',
    description: 'Frozen enemies take +30% meteor damage',
    damageMultiplier: 1.3,
    cooldownMultiplier: 1.0,
  },
  {
    weaponA: 'chain_lightning',
    weaponB: 'aura',
    name: 'Conducting Field',
    description: 'Lightning chains +20% further through aura',
    damageMultiplier: 1.15,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'flamethrower',
    weaponB: 'frost_nova',
    name: 'Elemental Flux',
    description: 'Rapid temperature shifts deal +20% damage',
    damageMultiplier: 1.2,
    cooldownMultiplier: 1.0,
  },
  {
    weaponA: 'katana',
    weaponB: 'orbiting_blades',
    name: 'Blade Dance',
    description: 'Melee weapons attack 15% faster',
    damageMultiplier: 1.0,
    cooldownMultiplier: 0.85,
  },
  {
    weaponA: 'projectile',
    weaponB: 'ricochet',
    name: 'Bullet Storm',
    description: 'Projectile weapons deal +20% damage',
    damageMultiplier: 1.2,
    cooldownMultiplier: 1.0,
  },
  {
    weaponA: 'homing_missile',
    weaponB: 'drone',
    name: 'Autonomous Arsenal',
    description: 'Auto-targeting weapons fire 15% faster',
    damageMultiplier: 1.0,
    cooldownMultiplier: 0.85,
  },
  {
    weaponA: 'laser_beam',
    weaponB: 'chain_lightning',
    name: 'Energy Overload',
    description: 'Energy weapons deal +25% damage',
    damageMultiplier: 1.25,
    cooldownMultiplier: 1.0,
  },
  {
    weaponA: 'ground_spike',
    weaponB: 'meteor',
    name: 'Earth & Sky',
    description: 'Area attacks deal +15% damage and cool down 10% faster',
    damageMultiplier: 1.15,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'shuriken',
    weaponB: 'katana',
    name: 'Shadow Arts',
    description: 'Ninja weapons gain +20% damage',
    damageMultiplier: 1.2,
    cooldownMultiplier: 1.0,
  },
  {
    weaponA: 'flamethrower',
    weaponB: 'laser_beam',
    name: 'Focused Heat',
    description: 'Beam weapons deal +15% damage with 10% faster cooldown',
    damageMultiplier: 1.15,
    cooldownMultiplier: 0.9,
  },
] as const;

// Pre-built lookup for O(1) synergy checks
const synergyLookup = new Map<string, WeaponSynergy>();

function buildSynergyKey(weaponIdA: string, weaponIdB: string): string {
  // Sort to ensure order-independent lookup
  return weaponIdA < weaponIdB ? `${weaponIdA}|${weaponIdB}` : `${weaponIdB}|${weaponIdA}`;
}

// Populate lookup on module load
for (const synergy of WEAPON_SYNERGIES) {
  const key = buildSynergyKey(synergy.weaponA, synergy.weaponB);
  synergyLookup.set(key, synergy);
}

/**
 * Check if two weapons have a synergy. Returns the synergy or null.
 */
export function getSynergy(weaponIdA: string, weaponIdB: string): WeaponSynergy | null {
  return synergyLookup.get(buildSynergyKey(weaponIdA, weaponIdB)) ?? null;
}

/**
 * Find all active synergies for a given set of equipped weapon IDs.
 * Returns an array of active synergies with their bonuses.
 */
export function getActiveSynergies(equippedWeaponIds: string[]): WeaponSynergy[] {
  const activeSynergies: WeaponSynergy[] = [];

  for (let i = 0; i < equippedWeaponIds.length; i++) {
    for (let j = i + 1; j < equippedWeaponIds.length; j++) {
      const synergy = getSynergy(equippedWeaponIds[i], equippedWeaponIds[j]);
      if (synergy) {
        activeSynergies.push(synergy);
      }
    }
  }

  return activeSynergies;
}
