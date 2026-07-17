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
  {
    weaponA: 'boomerang',
    weaponB: 'ricochet',
    name: 'Rebound Theory',
    description: 'Returning projectiles strike +20% harder and 10% faster',
    damageMultiplier: 1.2,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'sentry',
    weaponB: 'drone',
    name: 'Automated Arsenal',
    description: 'Autonomous weapons deal +20% damage and act 10% faster',
    damageMultiplier: 1.2,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'singularity',
    weaponB: 'meteor',
    name: 'Gravity Collapse',
    description: 'Clumped enemies amplify area blasts: +25% damage',
    damageMultiplier: 1.25,
    cooldownMultiplier: 1.0,
  },
  {
    weaponA: 'guardian',
    weaponB: 'katana',
    name: 'Riposte',
    description: 'Brawler build: +20% damage and retaliate/strike 10% faster',
    damageMultiplier: 1.2,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'wake',
    weaponB: 'homing_missile',
    name: 'Hit and Run',
    description: 'Kiting weapons deal +20% damage and act 10% faster',
    damageMultiplier: 1.2,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'pulse',
    weaponB: 'aura',
    name: 'Resonance Field',
    description: 'Overlapping fields amplify each other: +20% damage, 10% faster',
    damageMultiplier: 1.2,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'mine',
    weaponB: 'singularity',
    name: 'Kill Zone',
    description: 'Wells herd the horde onto your mines: +20% damage, 10% faster',
    damageMultiplier: 1.2,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'sweep_beam',
    weaponB: 'orbiting_blades',
    name: 'Gyre',
    description: 'Rotating weapons cut +20% harder and 10% faster',
    damageMultiplier: 1.2,
    cooldownMultiplier: 0.9,
  },
  {
    weaponA: 'storm',
    weaponB: 'chain_lightning',
    name: 'Overcharge',
    description: 'Twin tempests feed each other: +20% damage, 10% faster',
    damageMultiplier: 1.2,
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

/**
 * Given the previously-active and currently-active synergy lists, return the
 * synergies that are newly active (present in `current`, absent from
 * `previous`). Synergies are identified by their unique `name`.
 *
 * Drives the "a synergy just activated" feedback: WeaponManager recomputes
 * active synergies whenever the equipped set changes, and announces only the
 * pairs that just completed — never re-announcing ones that were already active.
 * Diffing the sets (rather than comparing counts) correctly catches the case
 * where one synergy is lost and another gained in the same recalculation, which
 * leaves the count unchanged.
 */
export function diffActivatedSynergies(
  previous: readonly WeaponSynergy[],
  current: readonly WeaponSynergy[]
): WeaponSynergy[] {
  const previousNames = new Set(previous.map((s) => s.name));
  return current.filter((s) => !previousNames.has(s.name));
}

/** Per-weapon synergy multipliers (1.0 = no effect). */
export interface SynergyMultiplier {
  /** Damage multiplier (>= 1.0 for the current synergy table). */
  damage: number;
  /** Cooldown multiplier (<= 1.0 means faster). */
  cooldown: number;
}

/**
 * Compute the per-weapon synergy multipliers for an equipped weapon set.
 *
 * `synergyBonus` is the player's `weaponSynergy` stat (e.g. 0.2 = +20%), granted
 * by the "Synergy" meta upgrade and the "Synergy Chain" relic. It amplifies the
 * *bonus portion* of every active synergy: a +30% damage synergy becomes +36%
 * at a 0.2 bonus, and a 15%-faster cooldown becomes 18% faster. A bonus of 0
 * leaves the raw synergy multipliers untouched. Non-finite or negative bonuses
 * are treated as 0 so synergies are never inverted below their base values.
 *
 * Returns a Map of weaponId → { damage, cooldown }, stacking multiplicatively
 * when a weapon belongs to more than one active synergy. Weapons with no active
 * synergy are absent from the map (callers default them to 1.0).
 */
export function computeSynergyMultipliers(
  equippedWeaponIds: string[],
  synergyBonus: number = 0
): Map<string, SynergyMultiplier> {
  const amplification = 1 + (Number.isFinite(synergyBonus) ? Math.max(0, synergyBonus) : 0);
  const multipliers = new Map<string, SynergyMultiplier>();

  for (const synergy of getActiveSynergies(equippedWeaponIds)) {
    // Scale only the deviation from 1.0 (the bonus) so a no-op dimension
    // (multiplier exactly 1.0) stays 1.0 regardless of the bonus.
    const amplifiedDamage = 1 + (synergy.damageMultiplier - 1) * amplification;
    const amplifiedCooldown = 1 - (1 - synergy.cooldownMultiplier) * amplification;

    for (const weaponId of [synergy.weaponA, synergy.weaponB]) {
      const existing = multipliers.get(weaponId) ?? { damage: 1.0, cooldown: 1.0 };
      existing.damage *= amplifiedDamage;
      existing.cooldown *= amplifiedCooldown;
      multipliers.set(weaponId, existing);
    }
  }

  return multipliers;
}
