import { describe, it, expect } from 'vitest';
import { buildMarketOffers, marketOfferPrice, MARKET_BASE_PRICES, pickMarketStock } from './MarketOffers';

const open = { worldLevel: 1, gold: 99_999, atFullHealth: false, relicsMaxed: false };

describe('market offers', () => {
  it('prices at base on world level 1 and scales 15% per level', () => {
    expect(marketOfferPrice('repair', 1)).toBe(MARKET_BASE_PRICES.repair);
    expect(marketOfferPrice('relic', 3)).toBe(Math.round(MARKET_BASE_PRICES.relic * 1.3));
  });

  it('unlocks every offer when the player can afford it and both effects would land', () => {
    expect(buildMarketOffers(open).every((offer) => !offer.locked)).toBe(true);
  });

  it('locks an offer that would do nothing, ahead of the affordability check', () => {
    const full = buildMarketOffers({ ...open, atFullHealth: true, relicsMaxed: true });
    expect(full.find((offer) => offer.id === 'repair')?.lockLabel).toBe('AT FULL HEALTH');
    expect(full.find((offer) => offer.id === 'relic')?.lockLabel).toBe('RELICS MAXED');
  });

  it('locks what the wallet cannot cover', () => {
    const broke = buildMarketOffers({ ...open, gold: 0 });
    expect(broke.every((offer) => offer.lockLabel === 'NOT ENOUGH GOLD')).toBe(true);
  });
});

const weapon = (weaponId: string, level: number) => ({
  weaponId,
  name: weaponId,
  icon: 'katana',
  level,
});

const fullStock = {
  freeWeaponSlots: 1,
  recruit: weapon('meteor', 0),
  arsenal: weapon('katana', 3),
  draftCharges: 0,
};

describe('market stock (the rotating 4th card)', () => {
  it('shows no 4th card when the run lacks nothing it can sell', () => {
    expect(buildMarketOffers(open)).toHaveLength(3);
    expect(
      buildMarketOffers({
        ...open,
        stock: { freeWeaponSlots: 0, recruit: null, arsenal: null, draftCharges: 5 },
      }),
    ).toHaveLength(3);
  });

  it('ranks an empty weapon slot over spent charges over a levellable weapon', () => {
    expect(pickMarketStock(fullStock)).toBe('recruit');
    expect(pickMarketStock({ ...fullStock, freeWeaponSlots: 0 })).toBe('contraband');
    expect(pickMarketStock({ ...fullStock, freeWeaponSlots: 0, draftCharges: 5 })).toBe('arsenal');
    expect(
      pickMarketStock({ ...fullStock, freeWeaponSlots: 0, draftCharges: 5, arsenal: null }),
    ).toBeNull();
  });

  it('carries the exact weapon it named so the purchase cannot drift', () => {
    const card = buildMarketOffers({ ...open, stock: fullStock })[3];
    expect(card.id).toBe('recruit');
    expect(card.stockWeaponId).toBe('meteor');
    expect(card.description).toContain('meteor');
    expect(card.locked).toBe(false);
  });

  it('locks the 4th card on price alone', () => {
    const card = buildMarketOffers({ ...open, gold: 0, stock: fullStock })[3];
    expect(card.lockLabel).toBe('NOT ENOUGH GOLD');
  });
});
