import { WeaponManager } from '../weapons';
import { getCodexManager } from '../codex';

/**
 * Break level gates - stat upgrades cannot pass these thresholds
 * unless ALL owned stat upgrades are at this level.
 */
export const BREAK_LEVEL_GATES = [3, 6, 9];

/**
 * Level 10 bonus values - these are the ADDITIONAL bonuses for reaching mastery.
 * These are roughly 2.5x a normal level to make mastery feel rewarding.
 */
export const LEVEL_10_BONUSES: Record<string, number> = {
  might: 0.5,        // +50% damage (vs normal +20%)
  haste: 0.35,       // +35% attack speed (vs normal +15%)
  swiftness: 75,     // +75 move speed (vs normal +25)
  vitality: 50,      // +50 HP (vs normal +20)
  multishot: 2,      // +2 projectiles (vs normal +1)
  piercing: 3,       // +3 pierce (vs normal +1)
  reach: 0.5,        // +50% range (vs normal +20%)
  magnetism: 100,    // +100 pickup range (vs normal +30)
  velocity: 0.5,     // +50% proj. speed (vs normal +25%)
};

/**
 * Player stats that can be modified by upgrades.
 * All multipliers start at 1.0 (100%).
 */
export interface PlayerStats {
  // Base stats
  maxHealth: number;
  currentHealth: number;
  moveSpeed: number;

  // Combat multipliers
  damageMultiplier: number;
  attackSpeedMultiplier: number;
  projectileSpeedMultiplier: number;
  rangeMultiplier: number;
  cooldownMultiplier: number;      // 1.0 = normal, 0.8 = 20% faster cooldowns
  durationMultiplier: number;      // Effect duration multiplier

  // Critical hits
  critChance: number;              // 0-1, chance to critically hit
  critDamage: number;              // Multiplier, e.g., 2.0 = 200% damage

  // Special stats
  projectileCount: number;
  piercing: number;
  pickupRange: number;
  knockbackMultiplier: number;     // Knockback force multiplier

  // Defense stats
  armor: number;                   // Flat damage reduction
  regenPerSecond: number;          // HP regenerated per second
  dodgeChance: number;             // 0-1, chance to avoid damage entirely
  lifeStealPercent: number;        // 0-1, percent of damage dealt as healing
  iframeDuration: number;          // Invincibility duration after taking damage
  revivals: number;                // Number of free revivals per run
  thornsPercent: number;           // 0-1, reflect damage to attacker
  shield: number;                  // Current shield points (absorbs damage)
  maxShield: number;               // Maximum shield points
  damageCap: number;               // Max damage per hit as % of max HP (1.0 = no cap)
  healingBoost: number;            // Multiplier for all healing received

  // Shield Barrier system (binary shields that block hits completely)
  shieldBarrierEnabled: boolean;   // Whether shield barrier system is active
  shieldCharges: number;           // Current shield charges
  maxShieldCharges: number;        // Maximum charges (base + upgrades)
  shieldRechargeTime: number;      // Seconds per charge (8.0 → 3.0)
  shieldRechargeProgress: number;  // 0.0 to 1.0 progress on next charge

  // Movement
  accelerationMultiplier: number;  // How fast player reaches top speed
  slowResistance: number;          // 0-1, resistance to slow effects
  sprintBonus: number;             // Speed bonus when not attacking
  combatSpeedBonus: number;        // Speed bonus per nearby enemy
  dashCooldown: number;            // Seconds between dashes (0 = no dash)
  phaseChance: number;             // Chance to phase through damage while moving

  // Resources & XP
  xp: number;
  level: number;
  xpToNextLevel: number;
  xpMultiplier: number;            // XP gain multiplier
  gemValueMultiplier: number;      // XP gem value multiplier
  dropRateMultiplier: number;      // Item drop rate multiplier
  healthDropMultiplier: number;    // Health pickup spawn rate multiplier
  goldMultiplier: number;          // End-of-run gold multiplier (applied in MetaProgressionManager)
  bossGoldMultiplier: number;      // Bonus gold from bosses

  // Utility (tracked per run)
  rerollsRemaining: number;        // Rerolls available for upgrade selection
  skipsRemaining: number;          // Skips available to bank XP
  banishesRemaining: number;       // Banishes to remove upgrades from pool
  luck: number;                    // 0-1, chance for better quality upgrades

  // Elemental chances (applied on hit)
  burnChance: number;              // Chance to ignite enemies
  burnDamageMultiplier: number;    // Burn damage multiplier
  freezeChance: number;            // Chance to freeze enemies
  freezeDurationMultiplier: number;// Freeze duration multiplier
  chainLightningChance: number;    // Chance for lightning to chain
  chainLightningCount: number;     // Extra chain targets
  poisonChance: number;            // Chance to poison enemies
  poisonMaxStacks: number;         // Max poison stacks

  // Mastery bonuses (damage multipliers for weapon types)
  projectileMastery: number;       // Bonus for projectile weapons
  meleeMastery: number;            // Bonus for melee weapons
  auraMastery: number;             // Bonus for aura weapons
  summonMastery: number;           // Bonus for summon/drone weapons
  orbitalMastery: number;          // Bonus for orbital weapons
  explosiveMastery: number;        // Bonus for explosive weapons
  beamMastery: number;             // Bonus for beam weapons
  ultimateMastery: number;         // Global weapon bonus

  // Advanced mechanics
  executionBonus: number;          // Bonus damage to low HP enemies
  overkillSplash: number;          // 0-1, overkill damage splash percent
  armorPenetration: number;        // 0-1, ignore enemy armor percent
  weaponSlots: number;             // Extra weapon slots
  weaponSynergy: number;           // Bonus per weapon owned

  // Advanced elemental effects
  shatterBonus: number;            // Bonus damage to frozen enemies (e.g., 0.5 = +50%)
  pandemicSpread: number;          // Radius for poison to spread on death (0 = disabled)
  overchargeStunDuration: number;  // Stun duration from chain lightning (0 = disabled)

  // Time/difficulty modifiers
  slowTimeRemaining: number;       // Remaining slow time in seconds (75% game speed)
  curseMultiplier: number;         // Enemy difficulty & reward multiplier

  // Spawning
  explosionDamageMultiplier: number; // Bonus damage for explosive weapons
  treasureInterval: number;        // Seconds between treasure chest spawns (0 = disabled)
}

/**
 * Creates default player stats.
 */
export function createDefaultPlayerStats(): PlayerStats {
  return {
    // Base stats
    maxHealth: 100,
    currentHealth: 100,
    moveSpeed: 200,

    // Combat multipliers
    damageMultiplier: 1.0,
    attackSpeedMultiplier: 1.0,
    projectileSpeedMultiplier: 1.0,
    rangeMultiplier: 1.0,
    cooldownMultiplier: 1.0,
    durationMultiplier: 1.0,

    // Critical hits
    critChance: 0,
    critDamage: 2.0,  // 200% damage on crit

    // Special stats
    projectileCount: 1,
    piercing: 0,
    pickupRange: 80,
    knockbackMultiplier: 1.0,

    // Defense stats
    armor: 0,
    regenPerSecond: 0,
    dodgeChance: 0,
    lifeStealPercent: 0,
    iframeDuration: 0.5,
    revivals: 0,
    thornsPercent: 0,
    shield: 0,
    maxShield: 0,
    damageCap: 1.0,  // No cap by default
    healingBoost: 1.0,

    // Shield Barrier system
    shieldBarrierEnabled: false,
    shieldCharges: 0,
    maxShieldCharges: 0,
    shieldRechargeTime: 8.0,
    shieldRechargeProgress: 0,

    // Movement
    accelerationMultiplier: 1.0,
    slowResistance: 0,
    sprintBonus: 0,
    combatSpeedBonus: 0,
    dashCooldown: 0,  // 0 = no dash ability
    phaseChance: 0,

    // Resources & XP
    xp: 0,
    level: 1,
    xpToNextLevel: 10,
    xpMultiplier: 1.0,
    gemValueMultiplier: 1.0,
    dropRateMultiplier: 1.0,
    healthDropMultiplier: 1.0,
    goldMultiplier: 1.0,
    bossGoldMultiplier: 1.0,

    // Utility
    rerollsRemaining: 0,
    skipsRemaining: 0,
    banishesRemaining: 0,
    luck: 0,

    // Elemental chances
    burnChance: 0,
    burnDamageMultiplier: 1.0,
    freezeChance: 0,
    freezeDurationMultiplier: 1.0,
    chainLightningChance: 0,
    chainLightningCount: 0,
    poisonChance: 0,
    poisonMaxStacks: 5,

    // Mastery bonuses (all start at 1.0 = no bonus)
    projectileMastery: 1.0,
    meleeMastery: 1.0,
    auraMastery: 1.0,
    summonMastery: 1.0,
    orbitalMastery: 1.0,
    explosiveMastery: 1.0,
    beamMastery: 1.0,
    ultimateMastery: 1.0,

    // Advanced mechanics
    executionBonus: 0,
    overkillSplash: 0,
    armorPenetration: 0,
    weaponSlots: 0,
    weaponSynergy: 0,

    // Advanced elemental effects
    shatterBonus: 0,
    pandemicSpread: 0,
    overchargeStunDuration: 0,

    // Time/difficulty modifiers
    slowTimeRemaining: 0,
    curseMultiplier: 1.0,  // 1.0 = normal difficulty

    // Spawning
    explosionDamageMultiplier: 1.0,
    treasureInterval: 0,  // 0 = disabled
  };
}

/**
 * Calculates XP needed for the next level.
 * Formula: 10 * level^1.5 (rounded)
 */
export function calculateXPForLevel(level: number): number {
  return Math.round(10 * Math.pow(level, 1.5));
}

/**
 * Upgrade definition.
 */
export interface Upgrade {
  id: string;
  name: string;
  description: string;
  icon: string; // Icon key from IconMap (e.g., 'sword', 'heart')
  maxLevel: number;
  currentLevel: number;
  isStatUpgrade: boolean; // True for stat upgrades (subject to break level gates)
  apply: (stats: PlayerStats, level: number) => void; // Level param for dynamic scaling
  getDescription: (level: number) => string;
}

/**
 * Creates a fresh set of upgrades (used each run).
 * All stat upgrades now go to level 10 with mastery bonuses.
 */
export function createUpgrades(): Upgrade[] {
  return [
    {
      id: 'might',
      name: 'Might',
      description: 'Increase damage',
      icon: 'sword',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.damageMultiplier += LEVEL_10_BONUSES.might;
        } else {
          stats.damageMultiplier += 0.2;
        }
      },
      getDescription: (level) => {
        const perLevel = 20;
        if (level === 9) return `+${LEVEL_10_BONUSES.might * 100}% damage [MASTERY]`;
        const nextTotal = (level + 1) * perLevel;
        if (level === 0) return `+${nextTotal}% damage`;
        return `+${nextTotal}% damage (+${perLevel}%)`;
      },
    },
    {
      id: 'haste',
      name: 'Haste',
      description: 'Increase attack speed',
      icon: 'lightning',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.attackSpeedMultiplier += LEVEL_10_BONUSES.haste;
        } else {
          stats.attackSpeedMultiplier += 0.15;
        }
      },
      getDescription: (level) => {
        const perLevel = 15;
        if (level === 9) return `+${LEVEL_10_BONUSES.haste * 100}% attack speed [MASTERY]`;
        const nextTotal = (level + 1) * perLevel;
        if (level === 0) return `+${nextTotal}% attack speed`;
        return `+${nextTotal}% attack speed (+${perLevel}%)`;
      },
    },
    {
      id: 'swiftness',
      name: 'Swiftness',
      description: 'Increase movement speed',
      icon: 'boot',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.moveSpeed += LEVEL_10_BONUSES.swiftness;
        } else {
          stats.moveSpeed += 25;
        }
      },
      getDescription: (level) => {
        const perLevel = 25;
        if (level === 9) return `+${LEVEL_10_BONUSES.swiftness} move speed [MASTERY]`;
        const nextTotal = (level + 1) * perLevel;
        if (level === 0) return `+${nextTotal} move speed`;
        return `+${nextTotal} move speed (+${perLevel})`;
      },
    },
    {
      id: 'vitality',
      name: 'Vitality',
      description: 'Increase max health',
      icon: 'heart',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.maxHealth += LEVEL_10_BONUSES.vitality;
          stats.currentHealth += LEVEL_10_BONUSES.vitality;
        } else {
          stats.maxHealth += 20;
          stats.currentHealth += 20; // Also heal for the bonus
        }
      },
      getDescription: (level) => {
        const perLevel = 20;
        if (level === 9) return `+${LEVEL_10_BONUSES.vitality} max HP [MASTERY]`;
        const nextTotal = (level + 1) * perLevel;
        if (level === 0) return `+${nextTotal} max HP`;
        return `+${nextTotal} max HP (+${perLevel})`;
      },
    },
    {
      id: 'multishot',
      name: 'Multishot',
      description: 'Fire additional projectiles',
      icon: 'multishot',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.projectileCount += LEVEL_10_BONUSES.multishot;
        } else {
          stats.projectileCount += 1;
        }
      },
      getDescription: (level) => {
        if (level === 9) return `+${LEVEL_10_BONUSES.multishot} projectiles [MASTERY]`;
        const nextTotal = level + 2; // starts at 1, so level 0 = 2 total
        if (level === 0) return `${nextTotal} projectiles`;
        return `${nextTotal} projectiles (+1)`;
      },
    },
    {
      id: 'piercing',
      name: 'Piercing',
      description: 'Projectiles pass through enemies',
      icon: 'pierce',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.piercing += LEVEL_10_BONUSES.piercing;
        } else {
          stats.piercing += 1;
        }
      },
      getDescription: (level) => {
        if (level === 9) return `+${LEVEL_10_BONUSES.piercing} pierce [MASTERY]`;
        const nextTotal = level + 1;
        if (level === 0) return `Pierce ${nextTotal} enemy`;
        return `Pierce ${nextTotal} enemies (+1)`;
      },
    },
    {
      id: 'reach',
      name: 'Reach',
      description: 'Increase attack range',
      icon: 'telescope',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.rangeMultiplier += LEVEL_10_BONUSES.reach;
        } else {
          stats.rangeMultiplier += 0.2;
        }
      },
      getDescription: (level) => {
        const perLevel = 20;
        if (level === 9) return `+${LEVEL_10_BONUSES.reach * 100}% range [MASTERY]`;
        const nextTotal = (level + 1) * perLevel;
        if (level === 0) return `+${nextTotal}% range`;
        return `+${nextTotal}% range (+${perLevel}%)`;
      },
    },
    {
      id: 'magnetism',
      name: 'Magnetism',
      description: 'Increase pickup range',
      icon: 'magnet',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.pickupRange += LEVEL_10_BONUSES.magnetism;
        } else {
          stats.pickupRange += 30;
        }
      },
      getDescription: (level) => {
        const perLevel = 30;
        if (level === 9) return `+${LEVEL_10_BONUSES.magnetism} pickup range [MASTERY]`;
        const nextTotal = (level + 1) * perLevel;
        if (level === 0) return `+${nextTotal} pickup range`;
        return `+${nextTotal} pickup range (+${perLevel})`;
      },
    },
    {
      id: 'velocity',
      name: 'Velocity',
      description: 'Faster projectiles',
      icon: 'wind',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: true,
      apply: (stats, level) => {
        if (level === 10) {
          stats.projectileSpeedMultiplier += LEVEL_10_BONUSES.velocity;
        } else {
          stats.projectileSpeedMultiplier += 0.25;
        }
      },
      getDescription: (level) => {
        const perLevel = 25;
        if (level === 9) return `+${LEVEL_10_BONUSES.velocity * 100}% proj. speed [MASTERY]`;
        const nextTotal = (level + 1) * perLevel;
        if (level === 0) return `+${nextTotal}% proj. speed`;
        return `+${nextTotal}% proj. speed (+${perLevel}%)`;
      },
    },
    {
      id: 'shieldBarrier',
      name: 'Shield Barrier',
      description: 'Energy shields that block incoming damage',
      icon: 'shield',
      maxLevel: 10,
      currentLevel: 0,
      isStatUpgrade: false,  // Not subject to break level gates
      apply: (stats, level) => {
        stats.shieldBarrierEnabled = true;

        // Levels 1-5: Reduce recharge time (8s → 3s)
        if (level <= 5) {
          stats.shieldRechargeTime = 8.0 - (level - 1) * 1.25;  // 8, 6.75, 5.5, 4.25, 3.0
          stats.maxShieldCharges = Math.max(stats.maxShieldCharges, 1);
        } else {
          // Levels 6-10: Add max charges
          stats.shieldRechargeTime = 3.0;
          const baseCharges = level - 4;  // 2, 3, 4, 5, 6
          stats.maxShieldCharges = Math.max(stats.maxShieldCharges, baseCharges);
        }

        // Fill shields on upgrade
        stats.shieldCharges = stats.maxShieldCharges;
      },
      getDescription: (level) => {
        if (level === 0) return '1 shield, 8.0s recharge';
        if (level < 5) {
          const rechargeTime = 8.0 - level * 1.25;
          return `1 shield, ${rechargeTime.toFixed(2)}s recharge`;
        }
        if (level === 5) return '1 shield, 3.0s recharge';
        const charges = level - 4;
        if (level === 9) return `${charges + 1} shields, 3.0s [MASTERY]`;
        return `${charges} shields, 3.0s recharge`;
      },
    },
  ];
}

/**
 * Gets N random upgrades that haven't reached max level.
 */
export function getRandomUpgrades(upgrades: Upgrade[], count: number): Upgrade[] {
  // Filter to upgrades that can still be leveled
  const availableUpgrades = upgrades.filter((u) => u.currentLevel < u.maxLevel);

  // Shuffle and take first N
  const shuffled = [...availableUpgrades].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Check if an upgrade can advance past its current level.
 * Break level gates (3, 6, 9) require ALL owned stat upgrades to be at that level.
 * @returns true if the upgrade can be leveled, false if blocked by a gate
 */
export function canLevelUpgrade(
  upgradeId: string,
  currentLevel: number,
  allStatUpgrades: Upgrade[]
): boolean {
  // Only stat upgrades are subject to gates
  const upgrade = allStatUpgrades.find(u => u.id === upgradeId);
  if (!upgrade || !upgrade.isStatUpgrade) return true;

  for (const gate of BREAK_LEVEL_GATES) {
    // If this upgrade is exactly at a gate level, check if all owned stats are at the gate
    if (currentLevel === gate) {
      const ownedStats = allStatUpgrades.filter(u => u.isStatUpgrade && u.currentLevel > 0);
      // All owned stat upgrades must be at or above the gate level
      const allAtGate = ownedStats.every(u => u.currentLevel >= gate);
      if (!allAtGate) {
        return false; // Blocked by gate
      }
    }
  }
  return true;
}

/**
 * Get the gate level blocking an upgrade, or null if not blocked.
 * Useful for displaying gate status in UI.
 */
export function getBlockingGate(
  currentLevel: number,
  allStatUpgrades: Upgrade[]
): number | null {
  for (const gate of BREAK_LEVEL_GATES) {
    if (currentLevel === gate) {
      const ownedStats = allStatUpgrades.filter(u => u.isStatUpgrade && u.currentLevel > 0);
      const allAtGate = ownedStats.every(u => u.currentLevel >= gate);
      if (!allAtGate) {
        return gate;
      }
    }
  }
  return null;
}

/**
 * Get upgrades that are blocking progress past a specific gate.
 * Returns stat upgrades that are owned but below the gate level.
 */
export function getBlockingUpgrades(
  gate: number,
  allStatUpgrades: Upgrade[]
): Upgrade[] {
  return allStatUpgrades.filter(
    u => u.isStatUpgrade && u.currentLevel > 0 && u.currentLevel < gate
  );
}

/**
 * Weapon upgrade type - for adding or leveling weapons.
 */
export type WeaponUpgradeType = 'add' | 'level';

export interface WeaponUpgrade {
  id: string;
  type: WeaponUpgradeType;
  weaponId: string;
  name: string;
  description: string;
  icon: string;
  currentLevel: number;
  maxLevel: number;
  getDescription: (level: number) => string;
  /** Selection weight for new weapons (higher = more likely). Based on codex discovery. */
  weight?: number;
}

/**
 * Available weapons that can be unlocked.
 */
const UNLOCKABLE_WEAPONS = [
  { id: 'katana', name: 'Katana', icon: 'katana', description: 'Rapid crisscrossing blade cuts' },
  { id: 'orbiting_blades', name: 'Orbiting Blades', icon: 'orbiting-blades', description: 'Blades circle around you' },
  { id: 'aura', name: 'Spirit Guardians', icon: 'holy-aura', description: 'Damages nearby enemies' },
  { id: 'chain_lightning', name: 'Chain Lightning', icon: 'chain-lightning', description: 'Bolt jumps between enemies' },
  { id: 'homing_missile', name: 'Homing Missiles', icon: 'homing-missile', description: 'Slow but always hits' },
  { id: 'frost_nova', name: 'Frost Nova', icon: 'frost-nova', description: 'Freezing explosion' },
  { id: 'laser_beam', name: 'Laser Beam', icon: 'laser', description: 'Piercing energy beam' },
  { id: 'meteor', name: 'Meteor Strike', icon: 'meteor', description: 'Devastating sky bombs' },
  { id: 'flamethrower', name: 'Flamethrower', icon: 'flamethrower', description: 'Spray fire at enemies' },
  { id: 'ricochet', name: 'Bouncing Ball', icon: 'ricochet', description: 'Ricochets off walls' },
  { id: 'ground_spike', name: 'Ground Spikes', icon: 'spikes', description: 'Spikes erupt beneath enemies' },
  { id: 'drone', name: 'Combat Drone', icon: 'drone', description: 'Autonomous shooting helper' },
  { id: 'shuriken', name: 'Spiral Shuriken', icon: 'shuriken', description: 'Spinning spiral projectiles' },
];

/**
 * Generate weapon upgrades based on what weapons the player has.
 * Returns a mix of new weapons and level-ups for existing weapons.
 */
export function getWeaponUpgrades(weaponManager: WeaponManager): WeaponUpgrade[] {
  const upgrades: WeaponUpgrade[] = [];
  const ownedWeapons = weaponManager.getAllWeapons();
  const ownedIds = new Set(ownedWeapons.map(w => w.id));

  // Add level-up options for owned weapons (that aren't max level)
  for (const weapon of ownedWeapons) {
    if (!weapon.isMaxLevel()) {
      // Capture weapon's upgrade description for the closure
      const upgradeDescription = weapon.getUpgradeDescription();
      upgrades.push({
        id: `level_${weapon.id}`,
        type: 'level',
        weaponId: weapon.id,
        name: weapon.name,
        description: weapon.description,
        icon: weapon.icon,
        currentLevel: weapon.getLevel(),
        maxLevel: weapon.maxLevel,
        getDescription: () => upgradeDescription,
      });
    }
  }

  // Add new weapon options (weapons not owned)
  // Weight based on codex discovery status - discovered weapons appear more often
  const codexManager = getCodexManager();

  for (const weaponInfo of UNLOCKABLE_WEAPONS) {
    if (!ownedIds.has(weaponInfo.id)) {
      // Calculate weight based on codex discovery
      // Base weight: 10, Discovered bonus: +15, Usage bonus: +1 per 5 uses (max +10)
      let weight = 10;

      const codexEntry = codexManager.getWeaponEntry(weaponInfo.id);
      if (codexEntry?.discovered) {
        weight += 15; // Discovered bonus - familiarity
        // Usage bonus: +1 per 5 uses, max +10
        const usageBonus = Math.min(10, Math.floor((codexEntry.timesUsed || 0) / 5));
        weight += usageBonus;
      }

      upgrades.push({
        id: `add_${weaponInfo.id}`,
        type: 'add',
        weaponId: weaponInfo.id,
        name: weaponInfo.name,
        description: weaponInfo.description,
        icon: weaponInfo.icon,
        currentLevel: 0,
        maxLevel: 1, // Only offered once (to add)
        getDescription: () => 'NEW WEAPON!',
        weight,
      });
    }
  }

  return upgrades;
}

/**
 * Combined upgrade (stat or weapon).
 */
export type CombinedUpgrade =
  | (Upgrade & { upgradeType: 'stat' })
  | (WeaponUpgrade & { upgradeType: 'weapon' });

/**
 * Gets random upgrades from both stat and weapon pools.
 * Every 5th level (5, 10, 15, etc.) ALL options are weapons.
 * New weapons (type: 'add') are only offered on those milestone levels.
 * Stat upgrades at break level gates (3, 6, 9) are filtered if not all owned stats are at the gate.
 */
export function getRandomCombinedUpgrades(
  statUpgrades: Upgrade[],
  weaponManager: WeaponManager,
  count: number,
  playerLevel: number,
  banishedIds: Set<string> = new Set()
): CombinedUpgrade[] {
  // Every 5th level is a weapon milestone - ALL options are weapons
  const isWeaponMilestone = playerLevel % 5 === 0;

  // Check if player can add new weapons (has available slots)
  const canAddNewWeapon = weaponManager.canAddWeapon();

  // Get weapon upgrades
  const weaponUpgrades = getWeaponUpgrades(weaponManager);

  // Filter weapon upgrades:
  // - Level-ups are always allowed
  // - New weapons (type: 'add') only on milestones AND when slots available
  // - Exclude banished upgrades
  const availableWeapons: CombinedUpgrade[] = weaponUpgrades
    .filter(u => {
      if (banishedIds.has(u.id)) return false;
      if (u.type === 'add') {
        // New weapons: only on milestones when we have slots
        return isWeaponMilestone && canAddNewWeapon;
      }
      // Level-ups: always allowed
      return true;
    })
    .map(u => ({ ...u, upgradeType: 'weapon' as const }));

  // If it's a weapon milestone, return ONLY weapon options with weighted selection
  if (isWeaponMilestone) {
    // Cast to weapon upgrades for type safety (we know all items are weapons here)
    type WeaponCombinedUpgrade = WeaponUpgrade & { upgradeType: 'weapon' };
    const weaponOptions = availableWeapons as WeaponCombinedUpgrade[];

    // Use weighted random selection for new weapons, simple shuffle for level-ups
    const newWeapons = weaponOptions.filter(u => u.type === 'add');
    const levelUps = weaponOptions.filter(u => u.type === 'level');

    // Select new weapons using weighted random (if any available)
    const selectedNew: WeaponCombinedUpgrade[] = [];
    const remainingNew = [...newWeapons];
    while (selectedNew.length < count && remainingNew.length > 0) {
      // Calculate total weight
      const totalWeight = remainingNew.reduce((sum, u) => sum + (u.weight || 10), 0);
      // Pick random weighted index
      let randomValue = Math.random() * totalWeight;
      let selectedIndex = 0;
      for (let i = 0; i < remainingNew.length; i++) {
        randomValue -= remainingNew[i].weight || 10;
        if (randomValue <= 0) {
          selectedIndex = i;
          break;
        }
      }
      selectedNew.push(remainingNew[selectedIndex]);
      remainingNew.splice(selectedIndex, 1);
    }

    // Combine with shuffled level-ups and return
    const shuffledLevelUps = levelUps.sort(() => Math.random() - 0.5);
    const result: CombinedUpgrade[] = [...selectedNew, ...shuffledLevelUps];
    return result.sort(() => Math.random() - 0.5).slice(0, Math.min(count, result.length));
  }

  // Normal levels: mix of stats and weapon level-ups
  // Get available stat upgrades - filter by max level, gate validation, and banished
  const availableStats: CombinedUpgrade[] = statUpgrades
    .filter(u => {
      // Must not be banished
      if (banishedIds.has(u.id)) return false;
      // Must not be at max level
      if (u.currentLevel >= u.maxLevel) return false;
      // Must pass gate validation (only for stat upgrades)
      if (u.isStatUpgrade && !canLevelUpgrade(u.id, u.currentLevel, statUpgrades)) return false;
      return true;
    })
    .map(u => ({ ...u, upgradeType: 'stat' as const }));

  // Combine and shuffle
  const allUpgrades = [...availableStats, ...availableWeapons];
  const shuffled = allUpgrades.sort(() => Math.random() - 0.5);

  // Ensure at least one weapon upgrade if available (for variety)
  const result: CombinedUpgrade[] = [];
  const weaponOptions = shuffled.filter(u => u.upgradeType === 'weapon');
  const statOptions = shuffled.filter(u => u.upgradeType === 'stat');

  // Try to include 1 weapon and 2 stats if possible
  if (weaponOptions.length > 0) {
    result.push(weaponOptions[0]);
  }

  for (const stat of statOptions) {
    if (result.length >= count) break;
    result.push(stat);
  }

  // Fill remaining slots with any available
  for (const upgrade of shuffled) {
    if (result.length >= count) break;
    if (!result.includes(upgrade)) {
      result.push(upgrade);
    }
  }

  // Final shuffle for presentation randomness
  return result.sort(() => Math.random() - 0.5).slice(0, count);
}
