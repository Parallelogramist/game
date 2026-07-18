/**
 * Relic / Passive Item System — mechanical modifiers dropped by chests,
 * minibosses, and events. Max 6 equipped per run.
 *
 * Unlike stat upgrades (Might, Haste, etc.) which scale linearly, relics
 * introduce emergent build interactions — each relic has a mechanical effect
 * that applies to the existing PlayerStats or combat pipeline.
 */

import { PlayerStats } from './Upgrades';

export type RelicRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Rarities in ascending quality order (lowest → highest). */
export const RELIC_RARITIES: readonly RelicRarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Drop weights per rarity — higher = more common. */
export const RELIC_RARITY_DROP_WEIGHTS: Record<RelicRarity, number> = {
  common: 60,
  rare: 30,
  epic: 9,
  legendary: 1,
};

/**
 * Per-rarity luck sensitivity. At luck `L` (0–1) each rarity's drop weight is
 * scaled by `1 + L * bonus`, so higher tiers grow faster than lower ones and
 * common (bonus 0) is never boosted — its *share* shrinks only because the
 * better tiers grow around it. Tune here to rebalance how strongly `luck`
 * favours rare loot.
 */
export const LUCK_RARITY_WEIGHT_BONUS: Record<RelicRarity, number> = {
  common: 0,
  rare: 0.5,
  epic: 1.5,
  legendary: 3,
};

/**
 * Rarity drop weights biased by the player's `luck` stat (`PlayerStats.luck`,
 * 0–1). Scales each base weight by `1 + clampedLuck * LUCK_RARITY_WEIGHT_BONUS`,
 * shifting the distribution toward higher-quality relics. At luck 0 the result
 * is byte-identical to RELIC_RARITY_DROP_WEIGHTS, so a run without luck is
 * unaffected. Luck is clamped to [0, 1]; a non-finite luck is treated as 0.
 */
export function luckBiasedRarityWeights(luck: number): Record<RelicRarity, number> {
  const safeLuck = Number.isFinite(luck) ? Math.max(0, Math.min(1, luck)) : 0;
  const weights = {} as Record<RelicRarity, number>;
  for (const rarity of RELIC_RARITIES) {
    weights[rarity] = RELIC_RARITY_DROP_WEIGHTS[rarity] * (1 + safeLuck * LUCK_RARITY_WEIGHT_BONUS[rarity]);
  }
  return weights;
}

export interface Relic {
  id: string;
  name: string;
  description: string;
  rarity: RelicRarity;
  icon: string;
  /** Mutates PlayerStats. Called once on pickup. */
  apply: (stats: PlayerStats) => void;
}

// ---------------------------------------------------------------------------
// Relic definitions (30+)
// ---------------------------------------------------------------------------

export const RELICS: readonly Relic[] = [
  // ═══ Common (basic stat boosts with a twist) ═══
  {
    id: 'relic_steady_eye',
    name: 'Steady Eye',
    description: '+5% crit chance, +2% crit damage',
    rarity: 'common',
    icon: 'target',
    apply: (stats) => {
      stats.critChance += 0.05;
      stats.critDamage += 0.02;
    },
  },
  {
    id: 'relic_vitality_core',
    name: 'Vitality Core',
    description: '+15 max HP, +0.5 HP/sec regen',
    rarity: 'common',
    icon: 'heart',
    apply: (stats) => {
      stats.maxHealth += 15;
      stats.currentHealth += 15;
      stats.regenPerSecond += 0.5;
    },
  },
  {
    id: 'relic_swift_boots',
    name: 'Swift Boots',
    description: '+8% move speed',
    rarity: 'common',
    icon: 'run',
    apply: (stats) => {
      stats.moveSpeed *= 1.08;
    },
  },
  {
    id: 'relic_piercing_round',
    name: 'Piercing Round',
    description: '+1 piercing on all projectiles',
    rarity: 'common',
    icon: 'arrow-right',
    apply: (stats) => {
      stats.piercing += 1;
    },
  },
  {
    id: 'relic_magnet_band',
    name: 'Magnet Band',
    description: '+25% gem pickup range',
    rarity: 'common',
    icon: 'magnet',
    apply: (stats) => {
      stats.pickupRange *= 1.25;
    },
  },
  {
    id: 'relic_lucky_charm',
    name: 'Lucky Charm',
    description: '+10% luck',
    rarity: 'common',
    icon: 'star',
    apply: (stats) => {
      stats.luck += 0.1;
    },
  },
  {
    id: 'relic_warm_hearth',
    name: 'Warm Hearth',
    description: '+10% burn chance, +10% burn damage',
    rarity: 'common',
    icon: 'fire',
    apply: (stats) => {
      stats.burnChance += 0.1;
      stats.burnDamageMultiplier *= 1.1;
    },
  },

  // ═══ Rare (stronger multi-stat packages) ═══
  {
    id: 'relic_berserker_rage',
    name: 'Berserker Rage',
    description: '+10% damage',
    rarity: 'rare',
    icon: 'sword',
    apply: (stats) => {
      // Always-on +10% damage. (An HP-conditional version would need per-frame
      // combat-stat hooks; relics apply once at pickup, so it stays flat.)
      stats.damageMultiplier *= 1.1;
    },
  },
  {
    id: 'relic_frost_ward',
    name: 'Frost Ward',
    description: '+15% freeze chance, +20% slow resist',
    rarity: 'rare',
    icon: 'snowflake',
    apply: (stats) => {
      stats.freezeChance += 0.15;
      stats.slowResistance += 0.2;
    },
  },
  {
    id: 'relic_venomous_blade',
    name: 'Venomous Blade',
    description: '+15% poison chance, +2 max poison stacks',
    rarity: 'rare',
    icon: 'poison',
    apply: (stats) => {
      stats.poisonChance += 0.15;
      stats.poisonMaxStacks += 2;
    },
  },
  {
    id: 'relic_armor_plate',
    name: 'Armor Plate',
    description: '+3 armor, +10% max HP',
    rarity: 'rare',
    icon: 'shield',
    apply: (stats) => {
      stats.armor += 3;
      stats.maxHealth = Math.round(stats.maxHealth * 1.1);
      stats.currentHealth += 10;
    },
  },
  {
    id: 'relic_vampiric_fang',
    name: 'Vampiric Fang',
    description: '+3% life steal',
    rarity: 'rare',
    icon: 'fang',
    apply: (stats) => {
      stats.lifeStealPercent += 0.03;
    },
  },
  {
    id: 'relic_overclock',
    name: 'Overclock',
    description: '+12% attack speed',
    rarity: 'rare',
    icon: 'bolt',
    apply: (stats) => {
      stats.attackSpeedMultiplier *= 1.12;
    },
  },
  {
    id: 'relic_resonant_core',
    name: 'Resonant Core',
    description: '+15% XP gain, +10% gold gain',
    rarity: 'rare',
    icon: 'gem',
    apply: (stats) => {
      stats.xpMultiplier *= 1.15;
      stats.goldMultiplier *= 1.1;
    },
  },
  {
    id: 'relic_thorned_mail',
    name: 'Thorned Mail',
    description: '+15% thorns damage',
    rarity: 'rare',
    icon: 'thorns',
    apply: (stats) => {
      stats.thornsPercent += 0.15;
    },
  },

  // ═══ Epic (transformative effects) ═══
  {
    id: 'relic_ancient_engine',
    name: 'Ancient Engine',
    description: '+1 projectile, +10% damage',
    rarity: 'epic',
    icon: 'gear',
    apply: (stats) => {
      stats.projectileCount += 1;
      stats.damageMultiplier *= 1.1;
    },
  },
  {
    id: 'relic_emperor_gem',
    name: "Emperor's Gem",
    description: '+30% gem value, +15% pickup range',
    rarity: 'epic',
    icon: 'gem',
    apply: (stats) => {
      stats.gemValueMultiplier *= 1.3;
      stats.pickupRange *= 1.15;
    },
  },
  {
    id: 'relic_phase_crystal',
    name: 'Phase Crystal',
    description: '+15% phase chance (avoid damage while moving)',
    rarity: 'epic',
    icon: 'diamond',
    apply: (stats) => {
      stats.phaseChance += 0.15;
    },
  },
  {
    id: 'relic_executioner',
    name: 'Executioner',
    description: '+20% damage vs enemies below 25% HP',
    rarity: 'epic',
    icon: 'skull',
    apply: (stats) => {
      stats.executionBonus += 0.2;
    },
  },
  {
    id: 'relic_chain_catalyst',
    name: 'Chain Catalyst',
    description: '+20% chain lightning chance, +2 chain count',
    rarity: 'epic',
    icon: 'chain-lightning',
    apply: (stats) => {
      stats.chainLightningChance += 0.2;
      stats.chainLightningCount += 2;
    },
  },
  {
    id: 'relic_overkill_torch',
    name: 'Overkill Torch',
    description: '+25% overkill splash damage',
    rarity: 'epic',
    icon: 'fire',
    apply: (stats) => {
      stats.overkillSplash += 0.25;
    },
  },
  {
    id: 'relic_siege_brace',
    name: 'Siege Brace',
    description: '+20% knockback, +5% range',
    rarity: 'epic',
    icon: 'hammer',
    apply: (stats) => {
      stats.knockbackMultiplier *= 1.2;
      stats.rangeMultiplier *= 1.05;
    },
  },

  // ═══ Legendary (game-changing) ═══
  {
    id: 'relic_crown_of_havoc',
    name: 'Crown of Havoc',
    description: '+25% damage, +1 projectile, -10% HP',
    rarity: 'legendary',
    icon: 'crown',
    apply: (stats) => {
      stats.damageMultiplier *= 1.25;
      stats.projectileCount += 1;
      stats.maxHealth = Math.round(stats.maxHealth * 0.9);
      stats.currentHealth = Math.min(stats.currentHealth, stats.maxHealth);
    },
  },
  {
    id: 'relic_immortal_core',
    name: 'Immortal Core',
    description: '+1 revival per run',
    rarity: 'legendary',
    icon: 'phoenix',
    apply: (stats) => {
      stats.revivals += 1;
    },
  },
  {
    id: 'relic_eye_of_storm',
    name: 'Eye of the Storm',
    description: '+15% crit chance, +50% crit damage',
    rarity: 'legendary',
    icon: 'eye',
    apply: (stats) => {
      stats.critChance += 0.15;
      stats.critDamage += 0.5;
    },
  },
  {
    id: 'relic_weapon_slot',
    name: 'Harbinger Mount',
    description: '+1 weapon slot',
    rarity: 'legendary',
    icon: 'weapon-slot',
    apply: (stats) => {
      stats.weaponSlots += 1;
    },
  },
  {
    id: 'relic_synergy_chain',
    name: 'Synergy Chain',
    description: '+20% weapon synergy bonus',
    rarity: 'legendary',
    icon: 'chain',
    apply: (stats) => {
      stats.weaponSynergy += 0.2;
    },
  },
  {
    id: 'relic_pandemic_engine',
    name: 'Pandemic Engine',
    description: '+2 pandemic spread (poison jumps to nearby enemies)',
    rarity: 'legendary',
    icon: 'virus',
    apply: (stats) => {
      stats.pandemicSpread += 2;
    },
  },

  // ═══ Relic Pack — build axes no relic touched yet ═══
  // Appended AFTER the legendaries on purpose: RelicManager.pity.test.ts,
  // RelicManager.draft.test.ts and Relics.test.ts rely on RELICS starting with the
  // original commons (a Math.random≈0 weighted roll must land on a sub-epic relic),
  // so new entries must never precede them. Keep this block last in the array.
  {
    id: 'relic_reactive_plating',
    name: 'Reactive Plating',
    description: '+8% dodge, +15% longer i-frames',
    rarity: 'rare',
    icon: 'guardian',
    apply: (stats) => {
      stats.dodgeChance += 0.08;
      stats.iframeDuration *= 1.15;
    },
  },
  {
    id: 'relic_rangers_lens',
    name: "Ranger's Lens",
    description: '+15% weapon range, +15% projectile speed',
    rarity: 'rare',
    icon: 'telescope',
    apply: (stats) => {
      stats.rangeMultiplier *= 1.15;
      stats.projectileSpeedMultiplier *= 1.15;
    },
  },
  {
    id: 'relic_detonation_matrix',
    name: 'Detonation Matrix',
    description: '+30% explosion damage, +15% armor penetration',
    rarity: 'epic',
    icon: 'explosion',
    apply: (stats) => {
      stats.explosionDamageMultiplier *= 1.3;
      stats.armorPenetration += 0.15;
    },
  },
  {
    id: 'relic_titans_bane',
    name: "Titan's Bane",
    description: '+40% boss damage, +50% boss gold',
    rarity: 'epic',
    icon: 'crowned-skull',
    apply: (stats) => {
      stats.bossDamageMultiplier *= 1.4;
      stats.bossGoldMultiplier *= 1.5;
    },
  },
  {
    id: 'relic_overdrive_capacitor',
    name: 'Overdrive Capacitor',
    description: '+40% ultimate power, +10% attack speed',
    rarity: 'epic',
    icon: 'lightning-bolt',
    apply: (stats) => {
      stats.ultimateMastery += 0.4;
      stats.attackSpeedMultiplier *= 1.1;
    },
  },
  {
    id: 'relic_elemental_overload',
    name: 'Elemental Overload',
    description: '+10% burn, freeze, poison & chain chance',
    rarity: 'legendary',
    icon: 'sparkle',
    apply: (stats) => {
      stats.burnChance += 0.1;
      stats.freezeChance += 0.1;
      stats.poisonChance += 0.1;
      stats.chainLightningChance += 0.1;
    },
  },
];

/**
 * Weighted random pick of a relic. Respects equipped relic exclusion.
 * `luck` (0–1, the player's `PlayerStats.luck`) biases the rarity roll toward
 * higher-quality relics; at the default luck 0 the weighting is unchanged.
 */
export function pickRandomRelic(
  excludeIds: string[] = [],
  luck = 0,
  minRarity?: RelicRarity,
): Relic | null {
  const eligible = RELICS.filter((relic) => !excludeIds.includes(relic.id));
  if (eligible.length === 0) return null;

  // Bad-luck protection ("pity"): when a rarity floor is requested, roll only
  // among relics at or above it — but fall back to the full eligible pool when
  // nothing qualifies (e.g. every epic/legendary is already equipped) so a pity
  // roll can never waste a drop by returning null.
  const floored = minRarity
    ? eligible.filter((relic) => rarityAtLeast(relic.rarity, minRarity))
    : eligible;
  const available = floored.length > 0 ? floored : eligible;

  // Weight by rarity, biased by luck (luck 0 → base drop weights).
  const rarityWeights = luckBiasedRarityWeights(luck);
  const weighted = available.map((relic) => ({
    relic,
    weight: rarityWeights[relic.rarity],
  }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.relic;
  }
  return weighted[weighted.length - 1].relic;
}

export function getRelicById(id: string): Relic | undefined {
  return RELICS.find((relic) => relic.id === id);
}

/**
 * True if `rarity` is at least as high-quality as `floor`, using the ascending
 * RELIC_RARITIES order (common < rare < epic < legendary).
 */
export function rarityAtLeast(rarity: RelicRarity, floor: RelicRarity): boolean {
  return RELIC_RARITIES.indexOf(rarity) >= RELIC_RARITIES.indexOf(floor);
}

export function getRelicRarityColor(rarity: RelicRarity): number {
  switch (rarity) {
    case 'common':    return 0xaaaaaa;
    case 'rare':      return 0x4488ff;
    case 'epic':      return 0xcc44ff;
    case 'legendary': return 0xffaa22;
  }
}
