/**
 * Permanent upgrades that persist across runs.
 * Purchased with gold earned from gameplay.
 *
 * Organized into categories with progressive unlocking at account levels.
 * Inspired by: Yet Another Zombie Survivors, Vampire Survivors, Brotato, Halls of Torment
 */

export type UpgradeCategory =
  | 'offense'
  | 'defense'
  | 'movement'
  | 'resources'
  | 'utility'
  | 'elemental'
  | 'mastery';

export interface PermanentUpgrade {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: UpgradeCategory;
  unlockLevel: number; // Account level required to see this upgrade
  maxLevel: number;
  baseCost: number;
  costScaling: number; // Multiplier per level
  getEffect: (level: number) => string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY: OFFENSE - Damage and attack-related upgrades
// ═══════════════════════════════════════════════════════════════════════════

const OFFENSE_UPGRADES: PermanentUpgrade[] = [
  // Tier 1 - Unlock Level 0 (Starter upgrades - reduced costs for smooth early game)
  {
    id: 'damageLevel',
    name: 'Power',
    description: 'Increase all damage dealt',
    icon: 'sword',
    category: 'offense',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 75, // Reduced from 100 for smoother early progression
    costScaling: 1.35, // Reduced from 1.5 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 5}% damage` : 'No bonus'),
  },
  {
    id: 'attackSpeedLevel',
    name: 'Reflexes',
    description: 'Increase attack speed',
    icon: 'lightning',
    category: 'offense',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 80, // Reduced from 120 for smoother early progression
    costScaling: 1.35, // Reduced from 1.6 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 8}% attack speed` : 'No bonus'),
  },
  {
    id: 'projectileCountLevel',
    name: 'Multishot',
    description: 'Fire additional projectiles',
    icon: 'target',
    category: 'offense',
    unlockLevel: 0,
    maxLevel: 3,
    baseCost: 300,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `+${level} projectile` : 'No bonus'),
  },
  {
    id: 'piercingLevel',
    name: 'Sharpness',
    description: 'Projectiles pierce through enemies',
    icon: 'pierce',
    category: 'offense',
    unlockLevel: 0,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `+${level} piercing` : 'No bonus'),
  },

  // Tier 2 - Unlock Level 10
  {
    id: 'critChanceLevel',
    name: 'Precision',
    description: 'Increase critical hit chance',
    icon: 'dice',
    category: 'offense',
    unlockLevel: 10,
    maxLevel: 10,
    baseCost: 150,
    costScaling: 1.6,
    getEffect: (level) => (level > 0 ? `+${level * 3}% crit chance` : 'No bonus'),
  },
  {
    id: 'critDamageLevel',
    name: 'Devastation',
    description: 'Increase critical hit damage',
    icon: 'explosion',
    category: 'offense',
    unlockLevel: 10,
    maxLevel: 10,
    baseCost: 150,
    costScaling: 1.6,
    getEffect: (level) => (level > 0 ? `+${level * 15}% crit damage` : 'No bonus'),
  },
  {
    id: 'projectileSpeedLevel',
    name: 'Velocity',
    description: 'Projectiles travel faster',
    icon: 'wind',
    category: 'offense',
    unlockLevel: 10,
    maxLevel: 8,
    baseCost: 100,
    costScaling: 1.4,
    getEffect: (level) => (level > 0 ? `+${level * 10}% projectile speed` : 'No bonus'),
  },
  {
    id: 'areaLevel',
    name: 'Reach',
    description: 'Increase attack area',
    icon: 'circle',
    category: 'offense',
    unlockLevel: 10,
    maxLevel: 8,
    baseCost: 120,
    costScaling: 1.5,
    getEffect: (level) => (level > 0 ? `+${level * 8}% area` : 'No bonus'),
  },

  // Tier 3 - Unlock Level 20
  {
    id: 'durationLevel',
    name: 'Persistence',
    description: 'Effects last longer',
    icon: 'timer',
    category: 'offense',
    unlockLevel: 20,
    maxLevel: 6,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 12}% duration` : 'No bonus'),
  },
  {
    id: 'cooldownLevel',
    name: 'Readiness',
    description: 'Reduce weapon cooldowns',
    icon: 'refresh',
    category: 'offense',
    unlockLevel: 20,
    maxLevel: 6,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `-${level * 5}% cooldown` : 'No bonus'),
  },
  {
    id: 'knockbackLevel',
    name: 'Impact',
    description: 'Attacks push enemies further',
    icon: 'fist',
    category: 'offense',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 150,
    costScaling: 1.6,
    getEffect: (level) => (level > 0 ? `+${level * 10}% knockback` : 'No bonus'),
  },

  // Tier 4 - Unlock Level 30
  {
    id: 'executionLevel',
    name: 'Execution',
    description: 'Deal bonus damage to low HP enemies',
    icon: 'skull-bones',
    category: 'offense',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 300,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `+${level * 10}% damage to enemies below 25% HP` : 'No bonus'),
  },
  {
    id: 'overkillLevel',
    name: 'Overkill',
    description: 'Excess damage splashes to nearby enemies',
    icon: 'skull',
    category: 'offense',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 400,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `${level * 25}% overkill splash` : 'No bonus'),
  },
  {
    id: 'armorPenLevel',
    name: 'Armor Piercing',
    description: 'Ignore enemy armor',
    icon: 'shield-crack',
    category: 'offense',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 250,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `Ignore ${level * 10}% armor` : 'No bonus'),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY: DEFENSE - Health and survivability upgrades
// ═══════════════════════════════════════════════════════════════════════════

const DEFENSE_UPGRADES: PermanentUpgrade[] = [
  // Tier 1 - Unlock Level 0 (Starter upgrades - reduced costs for smooth early game)
  {
    id: 'healthLevel',
    name: 'Fortitude',
    description: 'Increase maximum HP',
    icon: 'heart',
    category: 'defense',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 60, // Reduced from 80 for smoother early progression
    costScaling: 1.35, // Reduced from 1.4 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 10} max HP` : 'No bonus'),
  },
  {
    id: 'armorLevel',
    name: 'Toughness',
    description: 'Reduce damage taken',
    icon: 'shield',
    category: 'defense',
    unlockLevel: 0,
    maxLevel: 8,
    baseCost: 80, // Reduced from 100 for smoother early progression
    costScaling: 1.4, // Reduced from 1.5 for smoother curve
    getEffect: (level) => (level > 0 ? `-${level} damage taken` : 'No bonus'),
  },
  {
    id: 'regenLevel',
    name: 'Regeneration',
    description: 'Recover HP over time',
    icon: 'heart-green',
    category: 'defense',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 100, // Reduced from 120 for smoother early progression
    costScaling: 1.4, // Reduced from 1.5 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 0.5} HP/sec` : 'No bonus'),
  },

  // Tier 2 - Unlock Level 10
  {
    id: 'dodgeLevel',
    name: 'Evasion',
    description: 'Chance to dodge attacks',
    icon: 'swirl',
    category: 'defense',
    unlockLevel: 10,
    maxLevel: 6,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 5}% dodge chance` : 'No bonus'),
  },
  {
    id: 'lifeStealLevel',
    name: 'Vampirism',
    description: 'Heal from damage dealt',
    icon: 'vampire',
    category: 'defense',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 250,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `+${level}% life steal` : 'No bonus'),
  },
  {
    id: 'iframeLevel',
    name: 'Iron Will',
    description: 'Longer invincibility after damage',
    icon: 'star',
    category: 'defense',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 0.1}s invincibility` : 'No bonus'),
  },

  // Tier 3 - Unlock Level 20
  {
    id: 'thornLevel',
    name: 'Thorns',
    description: 'Reflect damage to attackers',
    icon: 'thorns',
    category: 'defense',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `Reflect ${level * 10}% damage` : 'No bonus'),
  },
  {
    id: 'shieldLevel',
    name: 'Barrier',
    description: 'Start with a damage shield',
    icon: 'crystal',
    category: 'defense',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 300,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `+${level * 20} starting shield` : 'No bonus'),
  },
  {
    id: 'healingBoostLevel',
    name: 'Restoration',
    description: 'Health pickups heal more',
    icon: 'sparkle',
    category: 'defense',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 150,
    costScaling: 1.6,
    getEffect: (level) => (level > 0 ? `+${level * 20}% healing received` : 'No bonus'),
  },

  // Tier 4 - Unlock Level 30
  {
    id: 'revivalLevel',
    name: 'Second Chance',
    description: 'Revive once per run',
    icon: 'revive',
    category: 'defense',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 500,
    costScaling: 3.0,
    getEffect: (level) => (level > 0 ? `${level} revival(s) per run` : 'No bonus'),
  },
  {
    id: 'emergencyHealLevel',
    name: 'Survival Instinct',
    description: 'Auto-heal when HP is critical',
    icon: 'warning',
    category: 'defense',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 400,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `Heal ${level * 15}% when below 20% HP (once per 30s)` : 'No bonus'),
  },
  {
    id: 'damageCapLevel',
    name: 'Damage Limit',
    description: 'Cap max damage per hit',
    icon: 'cancel',
    category: 'defense',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 450,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `Max ${100 - level * 15}% HP damage per hit` : 'No bonus'),
  },
  {
    id: 'barrierCapacityLevel',
    name: 'Barrier Capacity',
    description: 'Increase maximum shield barrier charges',
    icon: 'crystal',
    category: 'defense',
    unlockLevel: 15,
    maxLevel: 4,
    baseCost: 250,
    costScaling: 1.8,
    getEffect: (level) =>
      level > 0 ? `+${level} max shield charge${level > 1 ? 's' : ''}` : 'No bonus',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY: MOVEMENT - Speed and mobility upgrades
// ═══════════════════════════════════════════════════════════════════════════

const MOVEMENT_UPGRADES: PermanentUpgrade[] = [
  // Tier 1 - Unlock Level 0 (Starter upgrades - reduced costs for smooth early game)
  {
    id: 'moveSpeedLevel',
    name: 'Agility',
    description: 'Increase movement speed',
    icon: 'boot',
    category: 'movement',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 70, // Reduced from 100 for smoother early progression
    costScaling: 1.35, // Reduced from 1.5 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 5}% speed` : 'No bonus'),
  },

  // Tier 2 - Unlock Level 10
  {
    id: 'accelerationLevel',
    name: 'Quick Start',
    description: 'Reach top speed faster',
    icon: 'run',
    category: 'movement',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 120,
    costScaling: 1.5,
    getEffect: (level) => (level > 0 ? `+${level * 20}% acceleration` : 'No bonus'),
  },
  {
    id: 'slowResistLevel',
    name: 'Steadfast',
    description: 'Resist slow effects',
    icon: 'ice-cube',
    category: 'movement',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 150,
    costScaling: 1.6,
    getEffect: (level) => (level > 0 ? `${level * 15}% slow resistance` : 'No bonus'),
  },

  // Tier 3 - Unlock Level 20
  {
    id: 'sprintLevel',
    name: 'Sprint',
    description: 'Bonus speed when not attacking',
    icon: 'wind',
    category: 'movement',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 8}% speed when idle` : 'No bonus'),
  },
  {
    id: 'combatSpeedLevel',
    name: 'Battle Flow',
    description: 'Move faster in combat',
    icon: 'sword',
    category: 'movement',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 5}% speed per nearby enemy (max 25%)` : 'No bonus'),
  },

  // Tier 4 - Unlock Level 30
  {
    id: 'dashLevel',
    name: 'Dash',
    description: 'Quick dash ability',
    icon: 'sparkle',
    category: 'movement',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 400,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `Dash every ${8 - level}s` : 'No bonus'),
  },
  {
    id: 'phaseLevel',
    name: 'Phase',
    description: 'Brief invincibility during movement',
    icon: 'ghost',
    category: 'movement',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 500,
    costScaling: 3.0,
    getEffect: (level) => (level > 0 ? `${level * 3}% chance to phase through attacks` : 'No bonus'),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY: RESOURCES - XP, gold, and pickup upgrades
// ═══════════════════════════════════════════════════════════════════════════

const RESOURCE_UPGRADES: PermanentUpgrade[] = [
  // Tier 1 - Unlock Level 0 (Starter upgrades - reduced costs for smooth early game)
  {
    id: 'xpGainLevel',
    name: 'Quick Learner',
    description: 'Gain more experience',
    icon: 'book',
    category: 'resources',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 75, // Reduced from 100 for smoother early progression
    costScaling: 1.35, // Reduced from 1.5 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 5}% XP` : 'No bonus'),
  },
  {
    id: 'pickupRangeLevel',
    name: 'Magnetism',
    description: 'Increase pickup range',
    icon: 'magnet',
    category: 'resources',
    unlockLevel: 0,
    maxLevel: 8,
    baseCost: 65, // Reduced from 80 for smoother early progression
    costScaling: 1.35, // Reduced from 1.4 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 15}% pickup range` : 'No bonus'),
  },
  {
    id: 'goldGainLevel',
    name: 'Greed',
    description: 'Earn more gold per run',
    icon: 'coins',
    category: 'resources',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 120, // Reduced from 150 for smoother early progression
    costScaling: 1.45, // Reduced from 1.6 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 10}% gold` : 'No bonus'),
  },

  // Tier 2 - Unlock Level 10
  {
    id: 'gemValueLevel',
    name: 'Gem Expert',
    description: 'XP gems worth more',
    icon: 'gem',
    category: 'resources',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 10}% gem value` : 'No bonus'),
  },
  {
    id: 'dropRateLevel',
    name: 'Fortune',
    description: 'Enemies drop items more often',
    icon: 'clover',
    category: 'resources',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 5}% drop rate` : 'No bonus'),
  },
  {
    id: 'healthDropLevel',
    name: 'Scavenger',
    description: 'More health pickups',
    icon: 'bandage',
    category: 'resources',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 20}% health drop rate` : 'No bonus'),
  },

  // Tier 3 - Unlock Level 20
  {
    id: 'gemMagnetLevel',
    name: 'Gem Vacuum',
    description: 'Auto-collect distant gems periodically',
    icon: 'sunbeam',
    category: 'resources',
    unlockLevel: 20,
    maxLevel: 3,
    baseCost: 300,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `Vacuum gems every ${15 - level * 3}s` : 'No bonus'),
  },
  {
    id: 'treasureLevel',
    name: 'Treasure Hunter',
    description: 'Rare treasure chests appear',
    icon: 'gift',
    category: 'resources',
    unlockLevel: 20,
    maxLevel: 3,
    baseCost: 350,
    costScaling: 2.2,
    getEffect: (level) => (level > 0 ? `Chest every ${120 - level * 20}s` : 'No bonus'),
  },

  // Tier 4 - Unlock Level 30
  {
    id: 'bossGoldLevel',
    name: 'Boss Slayer',
    description: 'Bonus gold from bosses',
    icon: 'crown',
    category: 'resources',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 250,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 50}% boss gold` : 'No bonus'),
  },
  {
    id: 'startingXPLevel',
    name: 'Head Start',
    description: 'Start runs at higher level',
    icon: 'rocket',
    category: 'resources',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 400,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `Start at level ${level + 1}` : 'No bonus'),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY: UTILITY - Rerolls, choices, and game modifiers
// ═══════════════════════════════════════════════════════════════════════════

const UTILITY_UPGRADES: PermanentUpgrade[] = [
  // Tier 1 - Unlock Level 0 (Starter upgrades - reduced costs for smooth early game)
  {
    id: 'rerollLevel',
    name: 'Reroll',
    description: 'Reroll upgrade choices',
    icon: 'refresh',
    category: 'utility',
    unlockLevel: 0,
    maxLevel: 10,
    baseCost: 80, // Reduced from 100 for smoother early progression
    costScaling: 1.35, // Reduced from 1.4 for smoother curve
    getEffect: (level) => (level > 0 ? `+${level * 2} rerolls per run` : 'No bonus'),
  },
  {
    id: 'choiceLevel',
    name: 'Options',
    description: 'More upgrade choices',
    icon: 'clipboard',
    category: 'utility',
    unlockLevel: 0,
    maxLevel: 3,
    baseCost: 300,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `+${level} upgrade choice` : 'No bonus'),
  },
  {
    id: 'autoUpgrade',
    name: 'Auto-Upgrade',
    description: 'Automatically select upgrades on level-up',
    icon: 'gear',
    category: 'utility',
    unlockLevel: 0,
    maxLevel: 4,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => {
      switch (level) {
        case 0:
          return 'Manual selection only';
        case 1:
          return 'Basic: Weighted random selection';
        case 2:
          return '+Gate Planning: Avoids break-level bottlenecks';
        case 3:
          return '+Health-Adaptive: Reacts to damage taken';
        case 4:
          return '+Weapon Synergy: Stats match your weapons';
        default:
          return 'No bonus';
      }
    },
  },

  // Tier 2 - Unlock Level 10
  {
    id: 'skipLevel',
    name: 'Skip',
    description: 'Skip level-up to bank XP',
    icon: 'skip',
    category: 'utility',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 150,
    costScaling: 1.6,
    getEffect: (level) => (level > 0 ? `+${level} skips per run` : 'No bonus'),
  },
  {
    id: 'banishLevel',
    name: 'Banish',
    description: 'Remove unwanted upgrades from pool',
    icon: 'cancel',
    category: 'utility',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level} banishes per run` : 'No bonus'),
  },
  {
    id: 'luckLevel',
    name: 'Lucky',
    description: 'Better quality upgrades',
    icon: 'sunbeam',
    category: 'utility',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 10}% rare upgrade chance` : 'No bonus'),
  },

  // Tier 3 - Unlock Level 20
  {
    id: 'upgradeKeepLevel',
    name: 'Memory',
    description: 'Keep some upgrades between runs',
    icon: 'brain',
    category: 'utility',
    unlockLevel: 20,
    maxLevel: 2,
    baseCost: 500,
    costScaling: 3.0,
    getEffect: (level) => (level > 0 ? `Keep ${level} lowest upgrades` : 'No bonus'),
  },
  {
    id: 'slowTimeLevel',
    name: 'Time Dilation',
    description: 'Game starts slower',
    icon: 'clock',
    category: 'utility',
    unlockLevel: 20,
    maxLevel: 3,
    baseCost: 300,
    costScaling: 2.2,
    getEffect: (level) => (level > 0 ? `First ${level} min at 75% speed` : 'No bonus'),
  },

  // Tier 4 - Unlock Level 30
  {
    id: 'curseLevel',
    name: 'Curse',
    description: 'Harder enemies, better rewards',
    icon: 'devil',
    category: 'utility',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.5,
    getEffect: (level) => (level > 0 ? `+${level * 20}% enemy stats, +${level * 15}% rewards` : 'No bonus'),
  },
  {
    id: 'blessingLevel',
    name: 'Blessing',
    description: 'Random bonus each run',
    icon: 'angel',
    category: 'utility',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 400,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `${level} random blessing(s)` : 'No bonus'),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY: ELEMENTAL - Elemental damage and effects
// ═══════════════════════════════════════════════════════════════════════════

const ELEMENTAL_UPGRADES: PermanentUpgrade[] = [
  // Tier 2 - Unlock Level 10
  {
    id: 'fireLevel',
    name: 'Pyromaniac',
    description: 'Chance to ignite enemies',
    icon: 'fire',
    category: 'elemental',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `${level * 5}% burn chance` : 'No bonus'),
  },
  {
    id: 'iceLevel',
    name: 'Cryomancer',
    description: 'Chance to freeze enemies',
    icon: 'snowflake',
    category: 'elemental',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `${level * 3}% freeze chance` : 'No bonus'),
  },
  {
    id: 'lightningLevel',
    name: 'Electromancer',
    description: 'Chance to chain lightning',
    icon: 'lightning',
    category: 'elemental',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `${level * 4}% chain lightning` : 'No bonus'),
  },
  {
    id: 'poisonLevel',
    name: 'Venomous',
    description: 'Chance to poison enemies',
    icon: 'poison',
    category: 'elemental',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `${level * 5}% poison chance` : 'No bonus'),
  },

  // Tier 3 - Unlock Level 20
  {
    id: 'burnDamageLevel',
    name: 'Inferno',
    description: 'Increase burn damage',
    icon: 'volcano',
    category: 'elemental',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 220,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 25}% burn damage` : 'No bonus'),
  },
  {
    id: 'freezeDurationLevel',
    name: 'Deep Freeze',
    description: 'Freeze lasts longer',
    icon: 'ice-cube',
    category: 'elemental',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 220,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 20}% freeze duration` : 'No bonus'),
  },
  {
    id: 'chainCountLevel',
    name: 'Conductor',
    description: 'Lightning chains more',
    icon: 'chain',
    category: 'elemental',
    unlockLevel: 20,
    maxLevel: 3,
    baseCost: 280,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `+${level} chain targets` : 'No bonus'),
  },
  {
    id: 'poisonStackLevel',
    name: 'Toxicity',
    description: 'Poison stacks higher',
    icon: 'flask',
    category: 'elemental',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 220,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level} max poison stacks` : 'No bonus'),
  },

  // Tier 4 - Unlock Level 30
  {
    id: 'explosionLevel',
    name: 'Detonation',
    description: 'Burning enemies explode on death',
    icon: 'explosion',
    category: 'elemental',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 350,
    costScaling: 2.2,
    getEffect: (level) => (level > 0 ? `${level * 50}% damage explosion` : 'No bonus'),
  },
  {
    id: 'shatterLevel',
    name: 'Shatter',
    description: 'Frozen enemies take bonus damage',
    icon: 'broken-heart',
    category: 'elemental',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 300,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `+${level * 30}% damage to frozen` : 'No bonus'),
  },
  {
    id: 'overchargeLevel',
    name: 'Overcharge',
    description: 'Lightning stuns briefly',
    icon: 'chain-lightning',
    category: 'elemental',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 350,
    costScaling: 2.2,
    getEffect: (level) => (level > 0 ? `${level * 0.3}s stun on chain` : 'No bonus'),
  },
  {
    id: 'pandemicLevel',
    name: 'Pandemic',
    description: 'Poison spreads on death',
    icon: 'virus',
    category: 'elemental',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 350,
    costScaling: 2.2,
    getEffect: (level) => (level > 0 ? `Spread to ${level} nearby enemies` : 'No bonus'),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY: MASTERY - Weapon-specific and class upgrades
// ═══════════════════════════════════════════════════════════════════════════

const MASTERY_UPGRADES: PermanentUpgrade[] = [
  // Tier 2 - Unlock Level 10
  {
    id: 'projectileMasteryLevel',
    name: 'Gunslinger',
    description: 'Projectile weapons deal more damage',
    icon: 'gun',
    category: 'mastery',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 10}% projectile damage` : 'No bonus'),
  },
  {
    id: 'meleeMasteryLevel',
    name: 'Berserker',
    description: 'Melee weapons deal more damage',
    icon: 'sword',
    category: 'mastery',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 10}% melee damage` : 'No bonus'),
  },
  {
    id: 'auraMasteryLevel',
    name: 'Aura Master',
    description: 'Aura abilities are stronger',
    icon: 'aura',
    category: 'mastery',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 10}% aura damage` : 'No bonus'),
  },
  {
    id: 'summonMasteryLevel',
    name: 'Summoner',
    description: 'Summons and drones stronger',
    icon: 'robot',
    category: 'mastery',
    unlockLevel: 10,
    maxLevel: 5,
    baseCost: 180,
    costScaling: 1.7,
    getEffect: (level) => (level > 0 ? `+${level * 15}% summon damage` : 'No bonus'),
  },

  // Tier 5 - Unlock Level 50 (fills gap between Level 30 and late-game)
  {
    id: 'weaponSlotLevel',
    name: 'Arsenal Expansion',
    description: 'Unlock additional weapon slots per run',
    icon: 'backpack',
    category: 'mastery',
    unlockLevel: 50, // Moved from 75 to fill the unlock gap
    maxLevel: 3,
    baseCost: 800, // Reduced from 1000 for smoother curve
    costScaling: 2.5, // Reduced from 3.0 for smoother curve
    getEffect: (level) => {
      if (level === 0) return 'Base: 3 weapon slots';
      return `${3 + level} weapon slots (+${level})`;
    },
  },
  {
    id: 'orbitalMasteryLevel',
    name: 'Orbital Expert',
    description: 'Orbiting weapons enhanced',
    icon: 'planet',
    category: 'mastery',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 15}% orbit speed & damage` : 'No bonus'),
  },
  {
    id: 'explosiveMasteryLevel',
    name: 'Demolitionist',
    description: 'Explosions are larger and stronger',
    icon: 'bomb',
    category: 'mastery',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 10}% explosion area & damage` : 'No bonus'),
  },
  {
    id: 'beamMasteryLevel',
    name: 'Laser Focus',
    description: 'Beam weapons enhanced',
    icon: 'radar',
    category: 'mastery',
    unlockLevel: 20,
    maxLevel: 5,
    baseCost: 200,
    costScaling: 1.8,
    getEffect: (level) => (level > 0 ? `+${level * 10}% beam damage & width` : 'No bonus'),
  },

  // Tier 4 - Unlock Level 30
  {
    id: 'weaponEvolutionLevel',
    name: 'Evolution',
    description: 'Weapons evolve faster',
    icon: 'dna',
    category: 'mastery',
    unlockLevel: 30,
    maxLevel: 3,
    baseCost: 400,
    costScaling: 2.5,
    getEffect: (level) => (level > 0 ? `-${level} levels to evolve` : 'No bonus'),
  },
  {
    id: 'weaponSynergyLevel',
    name: 'Synergy',
    description: 'Weapons boost each other',
    icon: 'handshake',
    category: 'mastery',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 300,
    costScaling: 2.0,
    getEffect: (level) => (level > 0 ? `+${level * 3}% damage per weapon` : 'No bonus'),
  },
  {
    id: 'ultimateMasteryLevel',
    name: 'Grandmaster',
    description: 'All weapons enhanced',
    icon: 'trophy',
    category: 'mastery',
    unlockLevel: 30,
    maxLevel: 5,
    baseCost: 350,
    costScaling: 2.2,
    getEffect: (level) => (level > 0 ? `+${level * 5}% all weapon stats` : 'No bonus'),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All available permanent upgrades in the shop.
 */
export const PERMANENT_UPGRADES: PermanentUpgrade[] = [
  ...OFFENSE_UPGRADES,
  ...DEFENSE_UPGRADES,
  ...MOVEMENT_UPGRADES,
  ...RESOURCE_UPGRADES,
  ...UTILITY_UPGRADES,
  ...ELEMENTAL_UPGRADES,
  ...MASTERY_UPGRADES,
];

/**
 * Get upgrades by category.
 */
export function getUpgradesByCategory(category: UpgradeCategory): PermanentUpgrade[] {
  return PERMANENT_UPGRADES.filter(u => u.category === category);
}

/**
 * Get upgrades available at a given account level.
 */
export function getUpgradesForLevel(accountLevel: number): PermanentUpgrade[] {
  return PERMANENT_UPGRADES.filter(u => u.unlockLevel <= accountLevel);
}

/**
 * Get all category names with their display info.
 */
export const UPGRADE_CATEGORIES: { id: UpgradeCategory; name: string; icon: string }[] = [
  { id: 'offense', name: 'Offense', icon: 'sword' },
  { id: 'defense', name: 'Defense', icon: 'shield' },
  { id: 'movement', name: 'Movement', icon: 'boot' },
  { id: 'resources', name: 'Resources', icon: 'coins' },
  { id: 'utility', name: 'Utility', icon: 'wrench' },
  { id: 'elemental', name: 'Elemental', icon: 'sparkle' },
  { id: 'mastery', name: 'Mastery', icon: 'trophy' },
];

/**
 * Calculate the cost to purchase the next level of an upgrade.
 */
export function calculateUpgradeCost(
  upgrade: PermanentUpgrade,
  currentLevel: number
): number {
  if (currentLevel >= upgrade.maxLevel) {
    return Infinity;
  }
  return Math.floor(upgrade.baseCost * Math.pow(upgrade.costScaling, currentLevel));
}

/**
 * Get a permanent upgrade by its ID.
 */
export function getPermanentUpgradeById(id: string): PermanentUpgrade | undefined {
  return PERMANENT_UPGRADES.find((upgrade) => upgrade.id === id);
}

/**
 * Calculate total account level (sum of all upgrade levels).
 */
export function calculateAccountLevel(upgradeState: Record<string, number>): number {
  return Object.values(upgradeState).reduce((sum, level) => sum + level, 0);
}
