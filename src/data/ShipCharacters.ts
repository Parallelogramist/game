/**
 * ShipCharacters — playable ship/character definitions.
 *
 * Each ship grants a starting weapon, stat multipliers, a unique visual
 * neon color palette, and a unique hull family (procedural silhouette across
 * all 5 evolution tiers — see src/visual/shipHullGeometry.ts). Ships are
 * unlocked via either (a) account-level progression or (b) hidden unlocks
 * from HiddenUnlockManager.
 */

import type { ShipHullId } from '../visual/shipHullGeometry';
import type { ShipUltimateId } from './ShipUltimates';

export interface ShipCharacter {
  id: string;
  name: string;
  description: string;
  startingWeaponId: string;

  /** Multiplier applied to base player max HP. */
  healthMultiplier: number;
  /** Multiplier applied to base player move speed. */
  moveSpeedMultiplier: number;
  /** Multiplier applied to base player damage (affects all weapons). */
  damageMultiplier: number;
  /** Multiplier applied to all weapon cooldowns (lower = faster). */
  cooldownMultiplier: number;
  /** Additive bonus to XP gathered per gem. */
  xpMultiplier: number;
  /** Additive bonus to gold earned at end of run. */
  goldMultiplier: number;

  /** Neon color palette applied to the procedural spaceship graphics. */
  neonColorId: 'cyan' | 'red' | 'green' | 'gold' | 'purple' | 'white' | 'pink';

  /** Hull family drawn by PlayerSpaceship — unique silhouette per ship. */
  hullId: ShipHullId;

  /** Boss-specific damage multiplier. 1.5 = +50% damage against bosses only. */
  bossDamageMultiplier?: number;

  /** If true, player cannot be knocked back by any source. */
  knockbackImmune?: boolean;

  // ───────────────────────────────────────────────────────────────────────────
  // Signature mechanic fields — each ship can opt into one or more of these
  // to express a unique identity beyond pure stat multipliers. Values are
  // applied additively to the base/meta-derived stats at run start.
  // ───────────────────────────────────────────────────────────────────────────

  /** The ship's ultimate. Omitted → 'overdrive', the shared baseline nova. */
  ultimateId?: ShipUltimateId;
  /** Flat addition to critChance (0.15 = +15 pp). */
  critChanceBonus?: number;
  /** Flat addition to regenPerSecond (1 = +1 HP/s). */
  regenPerSecondBonus?: number;
  /** Flat addition to armor (3 = +3 flat damage reduction). */
  armorBonus?: number;
  /** Flat addition to lifeStealPercent (0.05 = +5%). */
  lifeStealBonus?: number;
  /** Extra rerolls granted at the start of the run. */
  startingRerollBonus?: number;
  /** Extra skip tokens granted at the start of the run. */
  startingSkipBonus?: number;

  /**
   * Unlock requirement. If undefined, ship is available from run 1.
   * If 'hidden:<conditionId>', unlock gated via HiddenUnlockManager.
   * If 'account:<level>', unlock gated via account level (re-locks after an
   * ascension reset, like account-gated shop upgrades).
   * Parsed by isUnlockRequirementMet (src/data/UnlockGates.ts).
   */
  unlockRequirement?: string;
}

// ---------------------------------------------------------------------------
// Ship roster
// ---------------------------------------------------------------------------

export const SHIP_CHARACTERS: ShipCharacter[] = [
  {
    id: 'ship_default',
    name: 'Sparrow',
    description: 'Balanced all-rounder. No bonuses, no drawbacks.',
    startingWeaponId: 'projectile',
    healthMultiplier: 1.0,
    moveSpeedMultiplier: 1.0,
    damageMultiplier: 1.0,
    cooldownMultiplier: 1.0,
    xpMultiplier: 1.0,
    goldMultiplier: 1.0,
    neonColorId: 'cyan',
    hullId: 'dart',
    ultimateId: 'overdrive',
  },
  {
    id: 'ship_interceptor',
    name: 'Interceptor',
    description: '+20% speed, -10% cooldown. Starts with +2 rerolls. Starts with Shuriken.',
    startingWeaponId: 'shuriken',
    healthMultiplier: 0.9,
    moveSpeedMultiplier: 1.2,
    damageMultiplier: 1.0,
    cooldownMultiplier: 0.9,
    xpMultiplier: 1.0,
    goldMultiplier: 1.0,
    neonColorId: 'green',
    hullId: 'scissor',
    startingRerollBonus: 2,
    ultimateId: 'temporal_rip',
  },
  {
    id: 'ship_dreadnought',
    name: 'Dreadnought',
    description: '+40% HP, +15% damage, +1 HP/s regen. Slower (-10% speed). Starts with Aura.',
    startingWeaponId: 'aura',
    healthMultiplier: 1.4,
    moveSpeedMultiplier: 0.9,
    damageMultiplier: 1.15,
    cooldownMultiplier: 1.05,
    xpMultiplier: 1.0,
    goldMultiplier: 1.0,
    neonColorId: 'red',
    hullId: 'ram',
    regenPerSecondBonus: 1.0,
    ultimateId: 'siege_pulse',
  },
  {
    id: 'ship_scholar',
    name: 'Scholar',
    description: '+25% XP, +2 rerolls, +3 armor. Fragile (-20% HP). Starts with Orbiting Blades.',
    startingWeaponId: 'orbiting_blades',
    healthMultiplier: 0.8,
    moveSpeedMultiplier: 1.0,
    damageMultiplier: 1.0,
    cooldownMultiplier: 1.0,
    xpMultiplier: 1.25,
    goldMultiplier: 1.0,
    neonColorId: 'purple',
    hullId: 'prism',
    unlockRequirement: 'hidden:unlock_pacifist',
    startingRerollBonus: 2,
    armorBonus: 3,
    ultimateId: 'insight_surge',
  },
  {
    id: 'ship_juggernaut',
    name: 'Juggernaut',
    description: '+75% HP, +5 armor, knockback-immune. Slow (-25% speed). Starts with Ground Spike.',
    startingWeaponId: 'ground_spike',
    healthMultiplier: 1.75,
    moveSpeedMultiplier: 0.75,
    damageMultiplier: 1.1,
    cooldownMultiplier: 1.0,
    xpMultiplier: 1.0,
    goldMultiplier: 1.0,
    neonColorId: 'gold',
    hullId: 'bastion',
    knockbackImmune: true,
    unlockRequirement: 'hidden:unlock_ironclad',
    armorBonus: 5,
    regenPerSecondBonus: 0.5,
    ultimateId: 'bulwark_slam',
  },
  {
    id: 'ship_void_walker',
    name: 'Void Walker',
    description: '+30% damage, +20% crit. Glass cannon (-30% HP). Starts with Laser Beam.',
    startingWeaponId: 'laser_beam',
    healthMultiplier: 0.7,
    moveSpeedMultiplier: 1.1,
    damageMultiplier: 1.3,
    cooldownMultiplier: 0.95,
    xpMultiplier: 1.0,
    goldMultiplier: 1.0,
    neonColorId: 'pink',
    hullId: 'umbra',
    unlockRequirement: 'hidden:unlock_void_walker',
    critChanceBonus: 0.2,
    ultimateId: 'void_collapse',
  },
  {
    id: 'ship_boss_hunter',
    name: 'Boss Hunter',
    description: '+50% vs bosses, +15% gold, 3% life steal. Starts with Meteor.',
    startingWeaponId: 'meteor',
    healthMultiplier: 1.0,
    moveSpeedMultiplier: 1.0,
    damageMultiplier: 1.1,
    cooldownMultiplier: 1.0,
    xpMultiplier: 1.0,
    goldMultiplier: 1.15,
    neonColorId: 'red',
    hullId: 'harpoon',
    bossDamageMultiplier: 1.5,
    unlockRequirement: 'hidden:unlock_boss_hunter',
    lifeStealBonus: 0.03,
    ultimateId: 'execution_mark',
  },
  {
    id: 'ship_flawless',
    name: 'Flawless',
    description: '+100% gold, +20% crit, +0.5 HP/s. Rewards clean play. Starts with Chain Lightning.',
    startingWeaponId: 'chain_lightning',
    healthMultiplier: 1.0,
    moveSpeedMultiplier: 1.0,
    damageMultiplier: 1.0,
    cooldownMultiplier: 1.0,
    xpMultiplier: 1.0,
    goldMultiplier: 2.0,
    neonColorId: 'white',
    hullId: 'aurora',
    unlockRequirement: 'hidden:unlock_flawless',
    critChanceBonus: 0.2,
    regenPerSecondBonus: 0.5,
    ultimateId: 'pristine_aegis',
  },
  {
    id: 'ship_glass_cannon',
    name: 'Glass Cannon',
    description: '+80% damage, +15% atk speed, 5% life steal. -50% HP. Fires Homing Missiles.',
    startingWeaponId: 'homing_missile',
    healthMultiplier: 0.5,
    moveSpeedMultiplier: 1.05,
    damageMultiplier: 1.8,
    cooldownMultiplier: 0.85,
    xpMultiplier: 1.0,
    goldMultiplier: 1.0,
    neonColorId: 'pink',
    hullId: 'needle',
    unlockRequirement: 'hidden:unlock_glass_cannon',
    lifeStealBonus: 0.05,
    ultimateId: 'critical_cascade',
  },
  {
    id: 'ship_elite_slayer',
    name: 'Elite Slayer',
    description: '+25% damage, +20% XP, +10% crit, +2 armor. Starts with Ricochet.',
    startingWeaponId: 'ricochet',
    healthMultiplier: 1.1,
    moveSpeedMultiplier: 1.0,
    damageMultiplier: 1.25,
    cooldownMultiplier: 0.95,
    xpMultiplier: 1.2,
    goldMultiplier: 1.0,
    neonColorId: 'green',
    hullId: 'mantis',
    unlockRequirement: 'hidden:unlock_elite_slayer',
    critChanceBonus: 0.1,
    armorBonus: 2,
    ultimateId: 'culling_field',
  },
  {
    id: 'ship_apex',
    name: 'Apex',
    description: '+30% everything, +10% crit, +1 HP/s, +3 armor, +1 reroll. Pinnacle. Starts with Drone.',
    startingWeaponId: 'drone',
    healthMultiplier: 1.3,
    moveSpeedMultiplier: 1.15,
    damageMultiplier: 1.3,
    cooldownMultiplier: 0.85,
    xpMultiplier: 1.3,
    goldMultiplier: 1.3,
    neonColorId: 'gold',
    hullId: 'sovereign',
    bossDamageMultiplier: 1.3,
    unlockRequirement: 'hidden:unlock_apex',
    critChanceBonus: 0.1,
    regenPerSecondBonus: 1.0,
    armorBonus: 3,
    startingRerollBonus: 1,
    ultimateId: 'apex_ascendance',
  },
];

export function getShipById(id: string): ShipCharacter | undefined {
  return SHIP_CHARACTERS.find((ship) => ship.id === id);
}

export function getDefaultShip(): ShipCharacter {
  return SHIP_CHARACTERS[0];
}
