import { describe, it, expect } from 'vitest';
import { SHIP_PAINTS, resolveEquippedPaint, resolveActivePaint, SHIP_DEFAULT_PAINT_CHOICE } from './ShipPaints';

describe('resolveEquippedPaint', () => {
  it('returns null when no cosmetics are unlocked', () => {
    expect(resolveEquippedPaint([])).toBeNull();
    expect(resolveEquippedPaint(['ship_scholar', 'stage_inferno'])).toBeNull();
  });

  it('returns the paint for a single unlocked cosmetic', () => {
    const paint = resolveEquippedPaint(['cosmetic_gold_hull']);
    expect(paint?.unlockId).toBe('cosmetic_gold_hull');
  });

  it('picks the highest-rank paint when several are unlocked', () => {
    // gold_hull rank 8 beats survivor_trim rank 1 and inferno_trail rank 5
    const paint = resolveEquippedPaint([
      'cosmetic_survivor_trim',
      'cosmetic_inferno_trail',
      'cosmetic_gold_hull',
    ]);
    expect(paint?.unlockId).toBe('cosmetic_gold_hull');
  });

  it('ignores unknown / non-cosmetic ids', () => {
    const paint = resolveEquippedPaint(['ship_apex', 'cosmetic_rookie_badge', 'weapon_x']);
    expect(paint?.unlockId).toBe('cosmetic_rookie_badge');
  });

  it('every paint has a unique rank and a well-formed color', () => {
    const ranks = new Set(SHIP_PAINTS.map((p) => p.rank));
    expect(ranks.size).toBe(SHIP_PAINTS.length);
    for (const p of SHIP_PAINTS) {
      expect(p.color.core).toBeGreaterThanOrEqual(0);
      expect(p.color.core).toBeLessThanOrEqual(0xffffff);
      expect(p.color.glow).toBeGreaterThanOrEqual(0);
      expect(p.color.glow).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe('resolveActivePaint', () => {
  const allUnlocked = SHIP_PAINTS.map((p) => p.unlockId);

  it('returns null (ship signature colour) when the player opts out', () => {
    expect(resolveActivePaint(allUnlocked, SHIP_DEFAULT_PAINT_CHOICE)).toBeNull();
  });

  it('returns the explicitly chosen paint when it is unlocked', () => {
    const paint = resolveActivePaint(allUnlocked, 'cosmetic_inferno_trail');
    expect(paint?.unlockId).toBe('cosmetic_inferno_trail');
  });

  it('falls back to highest-rank auto-equip when no choice is stored', () => {
    const paint = resolveActivePaint(['cosmetic_survivor_trim', 'cosmetic_gold_hull'], null);
    expect(paint?.unlockId).toBe('cosmetic_gold_hull');
  });

  it('falls back to auto-equip when the chosen paint is not (or no longer) unlocked', () => {
    const paint = resolveActivePaint(['cosmetic_survivor_trim'], 'cosmetic_gold_hull');
    expect(paint?.unlockId).toBe('cosmetic_survivor_trim');
  });

  it('returns null when a stored choice is locked and nothing else is unlocked', () => {
    expect(resolveActivePaint([], 'cosmetic_gold_hull')).toBeNull();
  });
});
