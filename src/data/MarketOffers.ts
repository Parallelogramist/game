/**
 * MarketOffers — what the Black Market shrine sells (FEAT-MARKET).
 *
 * Pure + Phaser-free so the price curve and the unbuyable rules are one
 * readable table. GameScene owns the gold deduction and the effects; this
 * module only decides what is on the shelf and what is locked.
 */

/** The three cards that are always on the shelf. */
export type MarketBaseOfferId = 'repair' | 'supply' | 'relic';

/** The rotating 4th card, chosen from what the run lacks (FEAT-MARKET-STOCK). */
export type MarketStockId = 'recruit' | 'arsenal' | 'contraband';

export type MarketOfferId = MarketBaseOfferId | MarketStockId;

/** A concrete weapon a stock card would deliver. Resolved by GameScene. */
export interface MarketStockSubject {
  weaponId: string;
  name: string;
  /** IconMap key (src/utils/IconMap.ts). */
  icon: string;
  /** Current weapon level; 0 for a weapon the player does not own yet. */
  level: number;
}

/** Live run state the 4th slot is chosen from. */
export interface MarketStockContext {
  /** weaponManager.getRemainingSlots() */
  freeWeaponSlots: number;
  /** The unowned weapon this visit would sell — rolled once by GameScene, at open. */
  recruit: MarketStockSubject | null;
  /** The owned non-max weapon a tune-up would raise (lowest level wins). */
  arsenal: MarketStockSubject | null;
  /** rerollsRemaining + banishesRemaining. */
  draftCharges: number;
}

export interface MarketOffer {
  id: MarketOfferId;
  name: string;
  description: string;
  /** IconMap key (src/utils/IconMap.ts). */
  icon: string;
  color: number;
  price: number;
  /** Set on 'recruit' / 'arsenal': the exact weapon this card was built for. */
  stockWeaponId?: string;
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
  /** Omit or pass null for no 4th card. */
  stock?: MarketStockContext | null;
}

const BASE: Record<MarketBaseOfferId, Omit<MarketOffer, 'price'>> = {
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

const STOCK_BASE: Record<MarketStockId, { name: string; color: number }> = {
  recruit: { name: 'Arms Dealer', color: 0xffa63d },
  arsenal: { name: 'Arsenal Contract', color: 0xf25f7c },
  contraband: { name: 'Contraband', color: 0xd9b26f },
};

export const MARKET_BASE_PRICES: Record<MarketOfferId, number> = {
  repair: 150,
  supply: 260,
  relic: 520,
  recruit: 420,
  arsenal: 200,
  contraband: 120,
};

/** Contraband's payload. GameScene adds these to playerStats on purchase. */
export const MARKET_CONTRABAND_REROLLS = 2;
export const MARKET_CONTRABAND_BANISHES = 1;

/** Contraband is stocked at or below this many combined reroll+banish charges. */
export const MARKET_CONTRABAND_NEED_THRESHOLD = 1;

/** The always-present cards, in on-screen and 1..3 keybind order. Stock appends as card 4. */
export const MARKET_OFFER_ORDER: MarketBaseOfferId[] = ['repair', 'supply', 'relic'];

/**
 * Prices track world level so the market keeps pace with run payouts (world
 * level already multiplies gold earned — see getWorldLevelGoldMultiplier).
 */
export function marketOfferPrice(id: MarketOfferId, worldLevel: number): number {
  const level = Math.min(50, Math.max(1, Math.floor(worldLevel) || 1));
  return Math.round(MARKET_BASE_PRICES[id] * (1 + 0.15 * (level - 1)));
}

/**
 * Picks the 4th card, most acute lack first. An empty weapon slot is a hole in
 * the build; spent draft charges are a hole in every future level-up; a
 * levellable weapon is the fallback because almost every run has one.
 */
export function pickMarketStock(stock: MarketStockContext | null | undefined): MarketStockId | null {
  if (!stock) return null;
  if (stock.freeWeaponSlots > 0 && stock.recruit) return 'recruit';
  if (stock.draftCharges <= MARKET_CONTRABAND_NEED_THRESHOLD) return 'contraband';
  if (stock.arsenal) return 'arsenal';
  return null;
}

function buildStockOffer(id: MarketStockId, context: MarketContext): MarketOffer {
  const stock = context.stock as MarketStockContext;
  const price = marketOfferPrice(id, context.worldLevel);
  const base = STOCK_BASE[id];

  if (id === 'recruit') {
    const subject = stock.recruit as MarketStockSubject;
    return {
      id,
      name: base.name,
      description: `${subject.name} joins your arsenal.`,
      icon: subject.icon,
      color: base.color,
      price,
      stockWeaponId: subject.weaponId,
    };
  }

  if (id === 'arsenal') {
    const subject = stock.arsenal as MarketStockSubject;
    return {
      id,
      name: base.name,
      description: `Raise ${subject.name} to level ${subject.level + 1}.`,
      icon: subject.icon,
      color: base.color,
      price,
      stockWeaponId: subject.weaponId,
    };
  }

  return {
    id,
    name: base.name,
    description: `+${MARKET_CONTRABAND_REROLLS} upgrade rerolls, +${MARKET_CONTRABAND_BANISHES} banish.`,
    icon: 'dice',
    color: base.color,
    price,
  };
}

export function buildMarketOffers(context: MarketContext): MarketOfferView[] {
  const views: MarketOfferView[] = MARKET_OFFER_ORDER.map((id) => {
    const price = marketOfferPrice(id, context.worldLevel);
    // A "would do nothing" reason wins over "cannot afford" so the player is
    // told the useful fact rather than a price he could go earn.
    let lockLabel = '';
    if (id === 'repair' && context.atFullHealth) lockLabel = 'AT FULL HEALTH';
    else if (id === 'relic' && context.relicsMaxed) lockLabel = 'RELICS MAXED';
    else if (context.gold < price) lockLabel = 'NOT ENOUGH GOLD';
    return { ...BASE[id], price, locked: lockLabel !== '', lockLabel };
  });

  const stockId = pickMarketStock(context.stock);
  if (stockId) {
    const offer = buildStockOffer(stockId, context);
    // pickMarketStock only returns a card whose effect can land, so price is the
    // only thing that can lock one.
    const lockLabel = context.gold < offer.price ? 'NOT ENOUGH GOLD' : '';
    views.push({ ...offer, locked: lockLabel !== '', lockLabel });
  }

  return views;
}
