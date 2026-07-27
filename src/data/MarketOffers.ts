/**
 * MarketOffers — what the Black Market shrine sells (FEAT-MARKET).
 *
 * Pure + Phaser-free so the price curve and the unbuyable rules are one
 * readable table. GameScene owns the gold deduction and the effects; this
 * module only decides what is on the shelf and what is locked.
 */

export type MarketOfferId = 'repair' | 'supply' | 'relic';

export interface MarketOffer {
  id: MarketOfferId;
  name: string;
  description: string;
  /** IconMap key (src/utils/IconMap.ts). */
  icon: string;
  color: number;
  price: number;
}

/** An offer plus why the player cannot take it right now. */
export interface MarketOfferView extends MarketOffer {
  locked: boolean;
  /** Shown in place of the price when locked. Empty when buyable. */
  lockLabel: string;
}

export interface MarketContext {
  worldLevel: number;
  gold: number;
  /** ECS health is already at max — a repair would burn gold for nothing. */
  atFullHealth: boolean;
  /** Every relic slot is full AND every carried relic is rank-capped. */
  relicsMaxed: boolean;
}

const BASE: Record<MarketOfferId, Omit<MarketOffer, 'price'>> = {
  repair: {
    id: 'repair',
    name: 'Field Repair',
    description: 'Restore 50% of your maximum health.',
    icon: 'heart',
    color: 0x66ff99,
  },
  supply: {
    id: 'supply',
    name: 'Supply Drop',
    description: 'Two random power-ups drop at your feet.',
    icon: 'backpack',
    color: 0x4ad9ff,
  },
  relic: {
    id: 'relic',
    name: 'Relic Cache',
    description: 'Draft a relic — or raise one you already carry.',
    icon: 'crown',
    color: 0xc678ff,
  },
};

export const MARKET_BASE_PRICES: Record<MarketOfferId, number> = {
  repair: 150,
  supply: 260,
  relic: 520,
};

/** Order is the on-screen card order and the 1..3 keybind order. */
export const MARKET_OFFER_ORDER: MarketOfferId[] = ['repair', 'supply', 'relic'];

/**
 * Prices track world level so the market keeps pace with run payouts (world
 * level already multiplies gold earned — see getWorldLevelGoldMultiplier).
 */
export function marketOfferPrice(id: MarketOfferId, worldLevel: number): number {
  const level = Math.min(50, Math.max(1, Math.floor(worldLevel) || 1));
  return Math.round(MARKET_BASE_PRICES[id] * (1 + 0.15 * (level - 1)));
}

export function buildMarketOffers(context: MarketContext): MarketOfferView[] {
  return MARKET_OFFER_ORDER.map((id) => {
    const price = marketOfferPrice(id, context.worldLevel);
    // A "would do nothing" reason wins over "cannot afford" so the player is
    // told the useful fact rather than a price he could go earn.
    let lockLabel = '';
    if (id === 'repair' && context.atFullHealth) lockLabel = 'AT FULL HEALTH';
    else if (id === 'relic' && context.relicsMaxed) lockLabel = 'RELICS MAXED';
    else if (context.gold < price) lockLabel = 'NOT ENOUGH GOLD';
    return { ...BASE[id], price, locked: lockLabel !== '', lockLabel };
  });
}
