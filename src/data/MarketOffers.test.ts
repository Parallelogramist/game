import { describe, it, expect } from 'vitest';
import { buildMarketOffers, marketOfferPrice, MARKET_BASE_PRICES } from './MarketOffers';

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
