/**
 * Run Modifier System — random per-run modifiers that change gameplay rules.
 *
 * Each run selects 1-2 modifiers from the pool, displayed briefly at start.
 * Modifiers apply through the existing PlayerStats multiplier system.
 */

import { PlayerStats } from './Upgrades';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunModifier {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: 'offense' | 'defense' | 'resources' | 'chaos';
  /** Apply modifier effects to player stats at run start. */
  readonly apply: (stats: PlayerStats) => void;
}

// ---------------------------------------------------------------------------
// Modifier Pool
// ---------------------------------------------------------------------------

export const RUN_MODIFIERS: readonly RunModifier[] = [
  // ── Offense ──
  {
    id: 'glass_cannon',
    name: 'Glass Cannon',
    description: '+50% damage, -30% max HP',
    category: 'offense',
    apply: (stats) => {
      stats.damageMultiplier *= 1.5;
      stats.maxHealth = Math.round(stats.maxHealth * 0.7);
      stats.currentHealth = Math.min(stats.currentHealth, stats.maxHealth);
    },
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    description: '+30% attack speed, +20% longer cooldowns',
    category: 'offense',
    apply: (stats) => {
      stats.attackSpeedMultiplier *= 1.3;
      stats.cooldownMultiplier *= 1.2;
    },
  },
  {
    id: 'precision_strike',
    name: 'Precision Strike',
    description: '+25% crit chance, -20% attack speed',
    category: 'offense',
    apply: (stats) => {
      stats.critChance += 0.25;
      stats.attackSpeedMultiplier *= 0.8;
    },
  },
  {
    id: 'heavy_hitter',
    name: 'Heavy Hitter',
    description: '+40% damage, -25% projectile speed',
    category: 'offense',
    apply: (stats) => {
      stats.damageMultiplier *= 1.4;
      stats.projectileSpeedMultiplier *= 0.75;
    },
  },

  // ── Defense ──
  {
    id: 'iron_skin',
    name: 'Iron Skin',
    description: '+40% max HP, -20% move speed',
    category: 'defense',
    apply: (stats) => {
      stats.maxHealth = Math.round(stats.maxHealth * 1.4);
      stats.currentHealth = Math.min(stats.currentHealth, stats.maxHealth);
      stats.moveSpeed *= 0.8;
    },
  },
  {
    id: 'adrenaline',
    name: 'Adrenaline Rush',
    description: '+20% move speed, +15% damage, -25% max HP',
    category: 'defense',
    apply: (stats) => {
      stats.moveSpeed *= 1.2;
      stats.damageMultiplier *= 1.15;
      stats.maxHealth = Math.round(stats.maxHealth * 0.75);
      stats.currentHealth = Math.min(stats.currentHealth, stats.maxHealth);
    },
  },
  {
    id: 'famine',
    name: 'Famine',
    description: 'Health pickups heal 50% less',
    category: 'defense',
    apply: (stats) => {
      stats.healingBoost *= 0.5;
    },
  },
  {
    id: 'resilience',
    name: 'Resilience',
    description: '+3 armor, +0.5 HP regen, -10% damage',
    category: 'defense',
    apply: (stats) => {
      stats.armor += 3;
      stats.regenPerSecond += 0.5;
      stats.damageMultiplier *= 0.9;
    },
  },

  // ── Resources ──
  {
    id: 'treasure_hunter',
    name: 'Treasure Hunter',
    description: '+100% gold, -15% damage',
    category: 'resources',
    apply: (stats) => {
      stats.goldMultiplier *= 2.0;
      stats.damageMultiplier *= 0.85;
    },
  },
  {
    id: 'scholar',
    name: 'Scholar',
    description: '+30% XP gain, -15% damage',
    category: 'resources',
    apply: (stats) => {
      stats.xpMultiplier *= 1.3;
      stats.damageMultiplier *= 0.85;
    },
  },
  {
    id: 'magnetic_field',
    name: 'Magnetic Field',
    description: '+80 pickup range, -10% move speed',
    category: 'resources',
    apply: (stats) => {
      stats.pickupRange += 80;
      stats.moveSpeed *= 0.9;
    },
  },

  // ── Chaos ──
  {
    id: 'elemental_storm',
    name: 'Elemental Storm',
    description: 'Elemental effects 100% stronger',
    category: 'chaos',
    apply: (stats) => {
      stats.burnDamageMultiplier *= 2.0;
      stats.freezeDurationMultiplier *= 2.0;
      stats.poisonMaxStacks += 5;
    },
  },
  {
    id: 'speed_demon',
    name: 'Speed Demon',
    description: '+25% move speed, -15% max HP',
    category: 'chaos',
    apply: (stats) => {
      stats.moveSpeed *= 1.25;
      stats.maxHealth = Math.round(stats.maxHealth * 0.85);
      stats.currentHealth = Math.min(stats.currentHealth, stats.maxHealth);
    },
  },
  {
    id: 'berserker',
    name: 'Berserker',
    description: '+35% damage and attack speed, no i-frames',
    category: 'chaos',
    apply: (stats) => {
      stats.damageMultiplier *= 1.35;
      stats.attackSpeedMultiplier *= 1.35;
      stats.iframeDuration = 0;
    },
  },
  {
    id: 'vampiric',
    name: 'Vampiric',
    description: '+5% life steal, -30% healing from pickups',
    category: 'chaos',
    apply: (stats) => {
      stats.lifeStealPercent += 0.05;
      stats.healingBoost *= 0.7;
    },
  },
];

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Select random modifiers for a run. Returns 1-2 non-conflicting modifiers.
 * Avoids picking two modifiers from the same category.
 */
export function selectRunModifiers(count: number = 2): RunModifier[] {
  const shuffled = [...RUN_MODIFIERS].sort(() => Math.random() - 0.5);
  const selected: RunModifier[] = [];
  const usedCategories = new Set<string>();

  for (const modifier of shuffled) {
    if (selected.length >= count) break;
    // Avoid same-category stacking for variety
    if (usedCategories.has(modifier.category)) continue;
    selected.push(modifier);
    usedCategories.add(modifier.category);
  }

  return selected;
}

/**
 * Look up a modifier by ID. Returns undefined if not found.
 */
export function getModifierById(modifierId: string): RunModifier | undefined {
  return RUN_MODIFIERS.find(modifier => modifier.id === modifierId);
}
