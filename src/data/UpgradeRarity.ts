/**
 * Upgrade rarity tiers for the level-up offer engine.
 *
 * Mirrors the relic rarity system (src/data/Relics.ts) with one crucial
 * difference: rarity does NOT make an upgrade rarer at baseline. At luck 0
 * every rarity weighs exactly 1, so selection stays a plain uniform shuffle —
 * rarity is a quality signal on the card plus a second consumer for the
 * `luck` stat, which boosts how often rare and epic upgrades surface.
 * (The pre-rarity engine used a random-comparator sort, which is only
 * approximately uniform; the luck-0 weighted order is truly uniform, a
 * deliberate slight fairness improvement rather than a bit-exact match.)
 */

export type UpgradeRarity = 'common' | 'rare' | 'epic';

/** Rarities in ascending quality order (lowest → highest). */
export const UPGRADE_RARITIES: readonly UpgradeRarity[] = ['common', 'rare', 'epic'];

/**
 * Per-rarity luck sensitivity, mirroring LUCK_RARITY_WEIGHT_BONUS in
 * Relics.ts. Selection weight is `1 + clampedLuck * bonus`, so common
 * (bonus 0) always weighs 1 and higher tiers grow with luck. At realistic
 * max luck (~0.6) an epic offer weighs 1.9× a common one.
 */
export const UPGRADE_LUCK_RARITY_BONUS: Record<UpgradeRarity, number> = {
  common: 0,
  rare: 0.75,
  epic: 1.5,
};

/**
 * Selection weight for an upgrade of the given rarity at the given luck.
 * Luck is clamped to [0, 1]; non-finite luck is treated as 0. At luck 0 the
 * result is exactly 1 for every rarity (the no-bias invariant).
 */
export function luckBiasedUpgradeWeight(rarity: UpgradeRarity, luck: number): number {
  const safeLuck = Number.isFinite(luck) ? Math.max(0, Math.min(1, luck)) : 0;
  return 1 + safeLuck * UPGRADE_LUCK_RARITY_BONUS[rarity];
}

/**
 * Weighted sampling without replacement — returns a full ordering of `items`
 * where higher-weight items tend to appear earlier. With equal weights this
 * degenerates to a uniform shuffle. Weights must be positive and finite.
 * The optional `random` parameter exists for deterministic tests.
 */
export function weightedOrder<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  random: () => number = Math.random,
): T[] {
  const remaining = [...items];
  const ordered: T[] = [];
  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, item) => sum + weightOf(item), 0);
    let roll = random() * totalWeight;
    let pickedIndex = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weightOf(remaining[i]);
      if (roll <= 0) {
        pickedIndex = i;
        break;
      }
    }
    ordered.push(remaining[pickedIndex]);
    remaining.splice(pickedIndex, 1);
  }
  return ordered;
}

export interface UpgradeRarityCardStyle {
  /** Card body fill (deep saturated tint, matches MenuStyle body palette). */
  body: number;
  /** Banner/border accent color. */
  accent: number;
  /** Accent as a CSS string for text. */
  accentStr: string;
  /** Sticker label naming the tier. */
  label: string;
}

/**
 * Card styling for rare/epic upgrade cards in UpgradeScene. Common (and
 * weapon entries, which carry no rarity) return null — they keep their
 * existing role-based styling. Colors follow the relic rarity language
 * (blue = rare, purple = epic, see getRelicRarityColor in Relics.ts).
 */
export function getUpgradeRarityCardStyle(
  rarity: UpgradeRarity | undefined,
): UpgradeRarityCardStyle | null {
  switch (rarity) {
    case 'rare':
      return { body: 0x16264e, accent: 0x4488ff, accentStr: '#4488ff', label: '◆ RARE ◆' };
    case 'epic':
      return { body: 0x261238, accent: 0xcc44ff, accentStr: '#cc44ff', label: '◆ EPIC ◆' };
    default:
      return null;
  }
}
