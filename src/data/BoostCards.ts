/**
 * Boost Cards — one-run consumables, fully separate from the permanent card
 * archive (FEAT-CARDS-3 in
 * docs/superpowers/specs/2026-07-03-card-collection-meta-design.md).
 *
 * A miniboss "flux cache" arms ONE boost for the NEXT fresh run; GameScene
 * consumes it at run start right after the permanent card bonuses. Boosts
 * reuse CardBonus but are deliberately LOUDER than permanent cards — they
 * fire once and vanish, so the magnitudes can spike without touching the
 * long-term power curve.
 *
 * No rarities and no dupe protection: there are only 8 boosts, the roll is
 * uniform, and holding the same boost twice in a row is fine (only one can
 * be held at a time — BoostCardManager refuses to roll while one is queued).
 */

import { CardBonus } from './Cards';

/** Chance a MINIBOSS death drops a flux cache (when no data cache dropped and no boost is held). */
export const FLUX_CACHE_DROP_CHANCE = 0.1;

export interface BoostCardDefinition {
  id: string;
  name: string;
  description: string;
  /** Semantic icon key resolved through IconMap.getIconFrame. */
  icon: string;
  /** Single next-run bonus; reuses the permanent-card bonus channels. */
  bonus: CardBonus;
}

// ---------------------------------------------------------------------------
// Boost definitions (8, ids and magnitudes fixed by the spec)
// ---------------------------------------------------------------------------

export const ALL_BOOST_CARDS: readonly BoostCardDefinition[] = [
  {
    id: 'boost_overcharge',
    name: 'Overcharge',
    description: '+15% damage',
    icon: 'lightning',
    bonus: { damageMult: 1.15 },
  },
  {
    id: 'boost_datastream',
    name: 'Datastream',
    description: '+20% XP',
    icon: 'book',
    bonus: { xpMult: 1.2 },
  },
  {
    id: 'boost_goldrush',
    name: 'Gold Rush',
    description: '+20% gold',
    icon: 'coins',
    bonus: { goldMult: 1.2 },
  },
  {
    id: 'boost_afterburner',
    name: 'Afterburner',
    description: '+10% move speed',
    icon: 'fire',
    bonus: { moveSpeedMult: 1.1 },
  },
  {
    id: 'boost_headstart',
    name: 'Jump Start',
    description: '+1 starting level',
    icon: 'star',
    bonus: { startAtLevel: 2 },
  },
  {
    id: 'boost_widebeam',
    name: 'Wide Beam',
    description: '+25% pickup radius',
    icon: 'magnet',
    bonus: { magnetRadiusMult: 1.25 },
  },
  {
    id: 'boost_plating',
    name: 'Reactive Plating',
    description: '+3 armor',
    icon: 'shield',
    bonus: { armorAdd: 3 },
  },
  {
    id: 'boost_spare_dice',
    name: 'Spare Dice',
    description: '+2 rerolls',
    icon: 'dice',
    bonus: { rerollsAdd: 2 },
  },
];

export function getBoostCardById(id: string): BoostCardDefinition | undefined {
  return ALL_BOOST_CARDS.find((boost) => boost.id === id);
}

/**
 * Uniform roll over the whole boost catalog — no rarity table, no dupe
 * exclusion (boosts are consumables, re-drawing one is fine). `rng` is
 * injectable for tests and must return values in [0, 1); clamped anyway so
 * an inclusive-1 rng can't index past the end.
 */
export function rollBoostCard(rng: () => number = Math.random): BoostCardDefinition {
  const pick = Math.min(ALL_BOOST_CARDS.length - 1, Math.floor(rng() * ALL_BOOST_CARDS.length));
  return ALL_BOOST_CARDS[pick];
}
