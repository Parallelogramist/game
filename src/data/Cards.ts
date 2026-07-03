/**
 * Card Collection System — ~24 collectible cards, each a small PERMANENT
 * passive applied at run start (GameScene meta-bonus block). Cards are the
 * seasoning, the permanent upgrade shop is the meal: magnitudes stay small so
 * a full archive is roughly one shop tier, never a difficulty cliff.
 *
 * Discovery sources (see docs/superpowers/specs/2026-07-03-card-collection-meta-design.md):
 * data cache drops in-run and the Scanner lottery in the Cards scene. There
 * are NO duplicates — a roll always lands on an undiscovered card of the
 * rolled (or nearest fallback) rarity, so every card id is discovered at most
 * once and persistence is just the set of discovered ids.
 *
 * Rarity model mirrors Relics.ts (common/rare/epic/legendary, weights
 * 60/30/9/1) but with NO luck bias — luck is an in-run stat and cards are
 * discovered from meta contexts.
 */

export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Rarities in ascending quality order (lowest → highest). */
export const CARD_RARITIES: readonly CardRarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Discovery-roll weights per rarity — higher = more common. */
export const CARD_RARITY_DROP_WEIGHTS: Record<CardRarity, number> = {
  common: 60,
  rare: 30,
  epic: 9,
  legendary: 1,
};

/**
 * The permanent passive a card grants. All fields optional per card;
 * aggregateCardBonuses folds the discovered set into a Required<CardBonus>
 * with identity defaults (multipliers 1, adds 0, startAtLevel 1) so the
 * run-start consumer never branches on presence.
 */
export type CardBonus = Partial<{
  damageMult: number;
  attackSpeedMult: number;
  goldMult: number;
  xpMult: number;
  magnetRadiusMult: number;
  moveSpeedMult: number;
  maxHealthAdd: number;
  critChanceAdd: number;
  armorAdd: number;
  luckAdd: number;
  rerollsAdd: number;
  banishesAdd: number;
  ultChargeRateMult: number;
  startAtLevel: number;
}>;

export interface CardDefinition {
  id: string;
  name: string;
  description: string;
  rarity: CardRarity;
  /** Semantic icon key resolved through IconMap.getIconFrame. */
  icon: string;
  bonus: CardBonus;
}

// ---------------------------------------------------------------------------
// Card definitions (24: 10 common / 8 rare / 4 epic / 2 legendary)
// ---------------------------------------------------------------------------

export const ALL_CARDS: readonly CardDefinition[] = [
  // ═══ Common (+2–3% single stat) ═══
  {
    id: 'card_hull_patch',
    name: 'Hull Patch',
    description: '+10 max HP',
    rarity: 'common',
    icon: 'heart',
    bonus: { maxHealthAdd: 10 },
  },
  {
    id: 'card_overtuned_coils',
    name: 'Overtuned Coils',
    description: '+2% damage',
    rarity: 'common',
    icon: 'sword',
    bonus: { damageMult: 1.02 },
  },
  {
    id: 'card_servo_grease',
    name: 'Servo Grease',
    description: '+3% attack speed',
    rarity: 'common',
    icon: 'timer',
    bonus: { attackSpeedMult: 1.03 },
  },
  {
    id: 'card_salvage_manifest',
    name: 'Salvage Manifest',
    description: '+3% gold gain',
    rarity: 'common',
    icon: 'coins',
    bonus: { goldMult: 1.03 },
  },
  {
    id: 'card_data_siphon',
    name: 'Data Siphon',
    description: '+3% XP gain',
    rarity: 'common',
    icon: 'book',
    bonus: { xpMult: 1.03 },
  },
  {
    id: 'card_tractor_lens',
    name: 'Tractor Lens',
    description: '+3% pickup radius',
    rarity: 'common',
    icon: 'magnet',
    bonus: { magnetRadiusMult: 1.03 },
  },
  {
    id: 'card_thruster_bias',
    name: 'Thruster Bias',
    description: '+2% move speed',
    rarity: 'common',
    icon: 'boot',
    bonus: { moveSpeedMult: 1.02 },
  },
  {
    id: 'card_targeting_assist',
    name: 'Targeting Assist',
    description: '+1% crit chance',
    rarity: 'common',
    icon: 'target',
    bonus: { critChanceAdd: 0.01 },
  },
  {
    id: 'card_ablative_paint',
    name: 'Ablative Paint',
    description: '+1 armor',
    rarity: 'common',
    icon: 'shield',
    bonus: { armorAdd: 1 },
  },
  {
    id: 'card_emergency_foam',
    name: 'Emergency Foam',
    description: '+10 max HP',
    rarity: 'common',
    icon: 'bandage',
    bonus: { maxHealthAdd: 10 },
  },

  // ═══ Rare (+4–6% single stat, or utility charges) ═══
  {
    id: 'card_void_capacitor',
    name: 'Void Capacitor',
    description: '+5% damage',
    rarity: 'rare',
    icon: 'lightning',
    bonus: { damageMult: 1.05 },
  },
  {
    id: 'card_overclock_bus',
    name: 'Overclock Bus',
    description: '+5% attack speed',
    rarity: 'rare',
    icon: 'gear',
    bonus: { attackSpeedMult: 1.05 },
  },
  {
    id: 'card_smugglers_ledger',
    name: "Smuggler's Ledger",
    description: '+6% gold gain',
    rarity: 'rare',
    icon: 'gift',
    bonus: { goldMult: 1.06 },
  },
  {
    id: 'card_neural_uplink',
    name: 'Neural Uplink',
    description: '+6% XP gain',
    rarity: 'rare',
    icon: 'brain',
    bonus: { xpMult: 1.06 },
  },
  {
    id: 'card_graviton_net',
    name: 'Graviton Net',
    description: '+6% pickup radius',
    rarity: 'rare',
    icon: 'radar',
    bonus: { magnetRadiusMult: 1.06 },
  },
  {
    id: 'card_lucky_debris',
    name: 'Lucky Debris',
    description: '+5% luck',
    rarity: 'rare',
    icon: 'clover',
    bonus: { luckAdd: 0.05 },
  },
  {
    id: 'card_spare_processor',
    name: 'Spare Processor',
    description: '+1 reroll per run',
    rarity: 'rare',
    icon: 'refresh',
    bonus: { rerollsAdd: 1 },
  },
  {
    id: 'card_blacklist_protocol',
    name: 'Blacklist Protocol',
    description: '+1 banish per run',
    rarity: 'rare',
    icon: 'cancel',
    bonus: { banishesAdd: 1 },
  },

  // ═══ Epic (dual small stats or +8% single) ═══
  {
    id: 'card_twin_reactor',
    name: 'Twin Reactor',
    description: '+4% damage, +4% attack speed',
    rarity: 'epic',
    icon: 'dna',
    bonus: { damageMult: 1.04, attackSpeedMult: 1.04 },
  },
  {
    id: 'card_prospector_ai',
    name: 'Prospector AI',
    description: '+4% gold gain, +4% XP gain',
    rarity: 'epic',
    icon: 'robot',
    bonus: { goldMult: 1.04, xpMult: 1.04 },
  },
  {
    id: 'card_ion_stride',
    name: 'Ion Stride',
    description: '+8% move speed',
    rarity: 'epic',
    icon: 'rocket',
    bonus: { moveSpeedMult: 1.08 },
  },
  {
    id: 'card_surge_array',
    name: 'Surge Array',
    description: '+10% ultimate charge rate',
    rarity: 'epic',
    icon: 'chain-lightning',
    bonus: { ultChargeRateMult: 1.1 },
  },

  // ═══ Legendary (identity cards) ═══
  {
    id: 'card_head_start',
    name: 'Head Start',
    description: 'Begin every run at level 2',
    rarity: 'legendary',
    icon: 'star',
    bonus: { startAtLevel: 2 },
  },
  {
    id: 'card_golden_compass',
    name: 'Golden Compass',
    description: '+12% gold gain, +8% luck',
    rarity: 'legendary',
    icon: 'crown',
    bonus: { goldMult: 1.12, luckAdd: 0.08 },
  },
];

export function getCardById(id: string): CardDefinition | undefined {
  return ALL_CARDS.find((card) => card.id === id);
}

/** Rarity accent colors — matches the relic palette so tiers read consistently. */
export function getCardRarityColor(rarity: CardRarity): number {
  switch (rarity) {
    case 'common':    return 0xaaaaaa;
    case 'rare':      return 0x4488ff;
    case 'epic':      return 0xcc44ff;
    case 'legendary': return 0xffaa22;
  }
}

// ---------------------------------------------------------------------------
// Discovery rolls
// ---------------------------------------------------------------------------

/**
 * Weighted rarity roll for a card discovery (60/30/9/1). No luck bias — luck
 * is an in-run stat; cards are rolled from meta contexts (cache drops resolve
 * at end-of-run, the Scanner in the menu). `rng` is injectable for tests and
 * must return values in [0, 1).
 */
export function rollCardRarity(rng: () => number = Math.random): CardRarity {
  let totalWeight = 0;
  for (const rarity of CARD_RARITIES) totalWeight += CARD_RARITY_DROP_WEIGHTS[rarity];
  let roll = rng() * totalWeight;
  for (const rarity of CARD_RARITIES) {
    roll -= CARD_RARITY_DROP_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return CARD_RARITIES[CARD_RARITIES.length - 1];
}

/**
 * Random undiscovered card of the rolled rarity. When that rarity is fully
 * discovered, falls back to the NEAREST rarity (by absolute index distance in
 * CARD_RARITIES) that still has undiscovered cards; on an exact distance tie
 * the HIGHER rarity wins (a fallback should feel like a bonus, not a
 * consolation). Returns null only when the whole archive is discovered —
 * callers award gold instead.
 */
export function pickUndiscoveredCard(
  discoveredIds: ReadonlySet<string>,
  rarity: CardRarity,
  rng: () => number = Math.random,
): CardDefinition | null {
  const rolledIndex = CARD_RARITIES.indexOf(rarity);

  let bestPool: CardDefinition[] | null = null;
  let bestDistance = Infinity;
  // Ascending iteration + `<=` makes the higher rarity win an exact-distance
  // tie (the later, higher index overwrites the earlier, lower one).
  for (let index = 0; index < CARD_RARITIES.length; index++) {
    const tier = CARD_RARITIES[index];
    const pool = ALL_CARDS.filter((card) => card.rarity === tier && !discoveredIds.has(card.id));
    if (pool.length === 0) continue;
    const distance = Math.abs(index - rolledIndex);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestPool = pool;
    }
  }

  if (!bestPool) return null; // archive complete
  // rng contract is [0, 1) but clamp anyway so an inclusive-1 rng can't index
  // past the end.
  const pick = Math.min(bestPool.length - 1, Math.floor(rng() * bestPool.length));
  return bestPool[pick];
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Multiplier fields — compound multiplicatively across discovered cards. */
const MULT_KEYS = [
  'damageMult',
  'attackSpeedMult',
  'goldMult',
  'xpMult',
  'magnetRadiusMult',
  'moveSpeedMult',
  'ultChargeRateMult',
] as const;

/** Additive fields — sum across discovered cards. */
const ADD_KEYS = [
  'maxHealthAdd',
  'critChanceAdd',
  'armorAdd',
  'luckAdd',
  'rerollsAdd',
  'banishesAdd',
] as const;

/**
 * Fold the discovered set into one bonus block for the run-start meta-bonus
 * application. Identity defaults (multipliers 1, adds 0, startAtLevel 1) mean
 * an empty collection is a no-op; multipliers COMPOUND multiplicatively,
 * additive fields sum, and startAtLevel takes the max (start levels don't
 * stack — the best card wins).
 */
export function aggregateCardBonuses(discoveredIds: ReadonlySet<string>): Required<CardBonus> {
  const result: Required<CardBonus> = {
    damageMult: 1,
    attackSpeedMult: 1,
    goldMult: 1,
    xpMult: 1,
    magnetRadiusMult: 1,
    moveSpeedMult: 1,
    ultChargeRateMult: 1,
    maxHealthAdd: 0,
    critChanceAdd: 0,
    armorAdd: 0,
    luckAdd: 0,
    rerollsAdd: 0,
    banishesAdd: 0,
    startAtLevel: 1,
  };

  for (const card of ALL_CARDS) {
    if (!discoveredIds.has(card.id)) continue;
    for (const key of MULT_KEYS) {
      const value = card.bonus[key];
      if (value !== undefined) result[key] *= value;
    }
    for (const key of ADD_KEYS) {
      const value = card.bonus[key];
      if (value !== undefined) result[key] += value;
    }
    if (card.bonus.startAtLevel !== undefined) {
      result.startAtLevel = Math.max(result.startAtLevel, card.bonus.startAtLevel);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** Percentage-point rendering of a compounded multiplier (1.071 → '+7%'). */
function formatMultPercent(value: number): string {
  return `+${Math.round((value - 1) * 100)}%`;
}

/**
 * One-line summary of an aggregated bonus block for the CardsScene header
 * ('+7% DMG · +20 HP · +1 REROLLS'). Identity values are omitted; an empty
 * collection formats to '' so callers can show a call-to-action instead.
 */
export function formatCardBonusSummary(bonuses: Required<CardBonus>): string {
  const parts: string[] = [];
  const mult = (value: number, label: string) => {
    if (Math.round((value - 1) * 100) !== 0) parts.push(`${formatMultPercent(value)} ${label}`);
  };

  mult(bonuses.damageMult, 'DMG');
  mult(bonuses.attackSpeedMult, 'ATK SPD');
  mult(bonuses.goldMult, 'GOLD');
  mult(bonuses.xpMult, 'XP');
  mult(bonuses.magnetRadiusMult, 'MAGNET');
  mult(bonuses.moveSpeedMult, 'SPEED');
  mult(bonuses.ultChargeRateMult, 'ULT RATE');
  if (bonuses.maxHealthAdd !== 0) parts.push(`+${bonuses.maxHealthAdd} HP`);
  if (Math.round(bonuses.critChanceAdd * 100) !== 0) parts.push(`+${Math.round(bonuses.critChanceAdd * 100)}% CRIT`);
  if (bonuses.armorAdd !== 0) parts.push(`+${bonuses.armorAdd} ARMOR`);
  if (Math.round(bonuses.luckAdd * 100) !== 0) parts.push(`+${Math.round(bonuses.luckAdd * 100)}% LUCK`);
  if (bonuses.rerollsAdd !== 0) parts.push(`+${bonuses.rerollsAdd} REROLLS`);
  if (bonuses.banishesAdd !== 0) parts.push(`+${bonuses.banishesAdd} BANISHES`);
  if (bonuses.startAtLevel > 1) parts.push(`START LV ${bonuses.startAtLevel}`);

  return parts.join(' · ');
}
