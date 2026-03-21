/**
 * Weapon Evolution System
 * When a weapon reaches the required level AND the player has the required stat at the right level,
 * the weapon evolves into a super form with boosted stats and potentially special effects.
 */

export interface WeaponEvolution {
  weaponId: string;           // Weapon that can evolve
  requiredWeaponLevel: number; // Minimum weapon level (typically 5)
  requiredStatId: string;      // Required stat upgrade ID from Upgrades.ts
  requiredStatLevel: number;   // Minimum stat level (typically 5)
  evolvedName: string;         // New display name
  evolvedDescription: string;  // Description of the evolved form
  statMultipliers: {           // Applied multiplicatively to weapon base stats
    damage?: number;           // e.g., 1.5 = +50% damage
    cooldown?: number;         // e.g., 0.6 = 40% faster cooldown
    range?: number;            // e.g., 2.0 = double range
    count?: number;            // Additive bonus to projectile count
    piercing?: number;         // Additive bonus to pierce
    size?: number;             // e.g., 1.5 = 50% bigger
    speed?: number;            // e.g., 1.5 = 50% faster projectiles
  };
}

const weaponEvolutionDefinitions: WeaponEvolution[] = [
  {
    weaponId: 'projectile',
    requiredWeaponLevel: 5,
    requiredStatId: 'multishot',
    requiredStatLevel: 5,
    evolvedName: 'Bullet Storm',
    evolvedDescription: 'Unleashes a relentless barrage of projectiles that shreds everything in its path.',
    statMultipliers: {
      damage: 1.5,
      cooldown: 0.6,
      count: 3,
    },
  },
  {
    weaponId: 'katana',
    requiredWeaponLevel: 5,
    requiredStatId: 'swiftness',
    requiredStatLevel: 5,
    evolvedName: 'Blade Dancer',
    evolvedDescription: 'A whirlwind of slashes so fast they leave afterimages across the battlefield.',
    statMultipliers: {
      damage: 1.5,
      cooldown: 0.5,
      range: 2.0,
    },
  },
  {
    weaponId: 'orbiting_blades',
    requiredWeaponLevel: 5,
    requiredStatId: 'might',
    requiredStatLevel: 5,
    evolvedName: 'Void Vortex',
    evolvedDescription: 'Massive blades orbit in a crushing vortex that pulls enemies to their doom.',
    statMultipliers: {
      damage: 2.0,
      size: 1.5,
      count: 2,
    },
  },
  {
    weaponId: 'aura',
    requiredWeaponLevel: 5,
    requiredStatId: 'vitality',
    requiredStatLevel: 5,
    evolvedName: 'Radiant Nova',
    evolvedDescription: 'Life force radiates outward as a searing nova that incinerates nearby foes.',
    statMultipliers: {
      damage: 2.0,
      range: 2.0,
      size: 1.5,
    },
  },
  {
    weaponId: 'chain_lightning',
    requiredWeaponLevel: 5,
    requiredStatId: 'haste',
    requiredStatLevel: 5,
    evolvedName: 'Tesla Coil',
    evolvedDescription: 'Arcs of electricity cascade endlessly between enemies in a storm of pure energy.',
    statMultipliers: {
      damage: 1.3,
      cooldown: 0.3,
      count: 2,
    },
  },
  {
    weaponId: 'homing_missile',
    requiredWeaponLevel: 5,
    requiredStatId: 'reach',
    requiredStatLevel: 5,
    evolvedName: 'Hellfire Barrage',
    evolvedDescription: 'A swarm of heat-seeking warheads locks onto targets across the entire arena.',
    statMultipliers: {
      damage: 1.5,
      cooldown: 0.5,
      count: 2,
    },
  },
  {
    weaponId: 'frost_nova',
    requiredWeaponLevel: 5,
    requiredStatId: 'vitality',
    requiredStatLevel: 5,
    evolvedName: 'Absolute Zero',
    evolvedDescription: 'Temperature plummets to absolute zero, flash-freezing and shattering all in range.',
    statMultipliers: {
      damage: 2.0,
      range: 2.0,
    },
  },
  {
    weaponId: 'laser_beam',
    requiredWeaponLevel: 5,
    requiredStatId: 'piercing',
    requiredStatLevel: 5,
    evolvedName: 'Death Ray',
    evolvedDescription: 'A concentrated beam of annihilation that vaporizes everything in a wide, piercing line.',
    statMultipliers: {
      damage: 2.5,
      range: 1.5,
      size: 1.5,
    },
  },
  {
    weaponId: 'meteor',
    requiredWeaponLevel: 5,
    requiredStatId: 'might',
    requiredStatLevel: 5,
    evolvedName: 'Apocalypse',
    evolvedDescription: 'The sky splits open as a cascade of devastating meteors rains down upon the battlefield.',
    statMultipliers: {
      damage: 2.0,
      range: 1.5,
      count: 2,
    },
  },
  {
    weaponId: 'flamethrower',
    requiredWeaponLevel: 5,
    requiredStatId: 'haste',
    requiredStatLevel: 5,
    evolvedName: 'Inferno Engine',
    evolvedDescription: 'An industrial furnace of flame that engulfs the battlefield in a roaring firestorm.',
    statMultipliers: {
      damage: 1.5,
      cooldown: 0.5,
      range: 2.0,
    },
  },
  {
    weaponId: 'ricochet',
    requiredWeaponLevel: 5,
    requiredStatId: 'velocity',
    requiredStatLevel: 5,
    evolvedName: 'Chaos Orb',
    evolvedDescription: 'Blazing orbs tear through enemies at impossible speeds, bouncing endlessly through the horde.',
    statMultipliers: {
      damage: 1.5,
      speed: 1.5,
      piercing: 3,
    },
  },
  {
    weaponId: 'ground_spike',
    requiredWeaponLevel: 5,
    requiredStatId: 'reach',
    requiredStatLevel: 5,
    evolvedName: 'Tectonic Fury',
    evolvedDescription: 'The earth erupts in massive spikes that impale enemies across a vast area.',
    statMultipliers: {
      damage: 2.0,
      range: 2.0,
      count: 1,
    },
  },
  {
    weaponId: 'drone',
    requiredWeaponLevel: 5,
    requiredStatId: 'multishot',
    requiredStatLevel: 5,
    evolvedName: 'Drone Swarm',
    evolvedDescription: 'A fleet of autonomous drones fills the sky, raining suppressive fire from all angles.',
    statMultipliers: {
      damage: 1.5,
      cooldown: 0.7,
      count: 2,
    },
  },
  {
    weaponId: 'shuriken',
    requiredWeaponLevel: 5,
    requiredStatId: 'velocity',
    requiredStatLevel: 5,
    evolvedName: 'Cyclone',
    evolvedDescription: 'A spiraling tornado of razor-sharp blades that shreds everything caught in its wake.',
    statMultipliers: {
      damage: 1.5,
      speed: 2.0,
      count: 2,
    },
  },
];

/** Map of weaponId -> WeaponEvolution for O(1) lookup */
const evolutionsByWeaponId: Map<string, WeaponEvolution> = new Map(
  weaponEvolutionDefinitions.map((evolution) => [evolution.weaponId, evolution])
);

/** Returns the evolution recipe for a weapon, or undefined if none exists. */
export function getEvolutionForWeapon(weaponId: string): WeaponEvolution | undefined {
  return evolutionsByWeaponId.get(weaponId);
}

/** Returns all evolution recipes. */
export function getAllEvolutions(): WeaponEvolution[] {
  return [...weaponEvolutionDefinitions];
}

/**
 * Checks whether a weapon evolution is ready to trigger.
 * @param weaponId The weapon's ID
 * @param weaponLevel Current weapon level
 * @param statUpgrades Array of { id: string, currentLevel: number } for player's stat upgrades
 * @returns The evolution if requirements are met, null otherwise
 */
export function checkEvolutionReady(
  weaponId: string,
  weaponLevel: number,
  statUpgrades: { id: string; currentLevel: number }[]
): WeaponEvolution | null {
  const evolution = evolutionsByWeaponId.get(weaponId);
  if (!evolution) {
    return null;
  }

  if (weaponLevel < evolution.requiredWeaponLevel) {
    return null;
  }

  const matchingStatUpgrade = statUpgrades.find(
    (statUpgrade) => statUpgrade.id === evolution.requiredStatId
  );
  if (!matchingStatUpgrade || matchingStatUpgrade.currentLevel < evolution.requiredStatLevel) {
    return null;
  }

  return evolution;
}
