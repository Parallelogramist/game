import { describe, it, expect } from 'vitest';
import {
  getSynergy,
  getActiveSynergies,
  computeSynergyMultipliers,
  diffActivatedSynergies,
} from './WeaponSynergies';

/**
 * WeaponSynergies covers the build-crafting passive-bonus layer. The headline
 * behaviour under test is `computeSynergyMultipliers`, the pure function that
 * turns an equipped weapon set + the player's `weaponSynergy` stat into the
 * per-weapon damage/cooldown multipliers WeaponManager applies. Before this was
 * wired, the `weaponSynergy` stat (granted by the "Synergy" meta upgrade and the
 * legendary "Synergy Chain" relic) was a dead stat — written but never read.
 */

describe('getSynergy', () => {
  it('finds a synergy regardless of argument order', () => {
    const forward = getSynergy('frost_nova', 'meteor');
    const reversed = getSynergy('meteor', 'frost_nova');
    expect(forward).not.toBeNull();
    expect(forward).toBe(reversed);
    expect(forward?.name).toBe('Thermal Shock');
  });

  it('returns null for a non-synergy pair', () => {
    expect(getSynergy('frost_nova', 'frost_nova')).toBeNull();
    expect(getSynergy('katana', 'meteor')).toBeNull();
  });
});

describe('getActiveSynergies', () => {
  it('returns nothing for fewer than two weapons', () => {
    expect(getActiveSynergies([])).toEqual([]);
    expect(getActiveSynergies(['frost_nova'])).toEqual([]);
  });

  it('finds the synergy when both members of a pair are equipped', () => {
    const active = getActiveSynergies(['frost_nova', 'meteor', 'projectile']);
    expect(active.map((s) => s.name)).toEqual(['Thermal Shock']);
  });
});

describe('diffActivatedSynergies', () => {
  // Drives the "a new synergy just activated" feedback (toast + sound). The
  // function answers "which synergies are in `current` that were not in
  // `previous`?" so a level-up/pickup that completes a pair can be announced —
  // and only newly-completed pairs, never ones that were already active.
  const active = (...ids: string[]) => getActiveSynergies(ids);

  it('reports nothing when neither set has synergies', () => {
    expect(diffActivatedSynergies([], [])).toEqual([]);
  });

  it('reports a synergy that is newly present', () => {
    const current = active('frost_nova', 'meteor'); // Thermal Shock
    const newly = diffActivatedSynergies([], current);
    expect(newly.map((s) => s.name)).toEqual(['Thermal Shock']);
  });

  it('reports nothing when the synergy set is unchanged (no re-fire)', () => {
    const set = active('frost_nova', 'meteor');
    expect(diffActivatedSynergies(set, set)).toEqual([]);
  });

  it('reports nothing when a synergy is lost rather than gained', () => {
    const previous = active('frost_nova', 'meteor');
    expect(diffActivatedSynergies(previous, [])).toEqual([]);
  });

  it('reports only the gained synergy when one is swapped for another', () => {
    // previous: Thermal Shock (frost_nova+meteor)
    // current:  Blade Dance (katana+orbiting_blades) — count is unchanged (1→1),
    // so a count-based check would miss this; the diff must still fire.
    const previous = active('frost_nova', 'meteor');
    const current = active('katana', 'orbiting_blades');
    const newly = diffActivatedSynergies(previous, current);
    expect(newly.map((s) => s.name)).toEqual(['Blade Dance']);
  });

  it('reports every synergy gained at once when several appear together', () => {
    const current = active('frost_nova', 'meteor', 'katana', 'orbiting_blades');
    const names = diffActivatedSynergies([], current).map((s) => s.name).sort();
    expect(names).toEqual(['Blade Dance', 'Thermal Shock']);
  });

  it('keeps an already-active synergy and reports only the addition', () => {
    const previous = active('frost_nova', 'meteor'); // Thermal Shock
    const current = active('frost_nova', 'meteor', 'katana', 'orbiting_blades');
    const newly = diffActivatedSynergies(previous, current);
    expect(newly.map((s) => s.name)).toEqual(['Blade Dance']);
  });
});

describe('computeSynergyMultipliers', () => {
  it('returns an empty map when no weapons are equipped', () => {
    expect(computeSynergyMultipliers([]).size).toBe(0);
  });

  it('returns an empty map when no synergy pair is equipped', () => {
    // katana + meteor have no synergy together
    expect(computeSynergyMultipliers(['katana', 'meteor']).size).toBe(0);
  });

  it('applies the raw synergy multipliers to both members when no bonus is set', () => {
    // Thermal Shock: frost_nova + meteor → damage 1.3, cooldown 1.0
    const result = computeSynergyMultipliers(['frost_nova', 'meteor']);
    expect(result.get('frost_nova')).toEqual({ damage: 1.3, cooldown: 1.0 });
    expect(result.get('meteor')).toEqual({ damage: 1.3, cooldown: 1.0 });
  });

  it('leaves a weapon with no active synergy out of the map', () => {
    const result = computeSynergyMultipliers(['frost_nova', 'meteor', 'projectile']);
    expect(result.has('projectile')).toBe(false);
  });

  it('defaults the bonus to zero so amplification is a no-op (regression lock)', () => {
    // Blade Dance: katana + orbiting_blades → damage 1.0, cooldown 0.85
    const noArg = computeSynergyMultipliers(['katana', 'orbiting_blades']);
    const explicitZero = computeSynergyMultipliers(['katana', 'orbiting_blades'], 0);
    expect(noArg.get('katana')).toEqual(explicitZero.get('katana'));
    expect(noArg.get('katana')).toEqual({ damage: 1.0, cooldown: 0.85 });
  });

  it('amplifies the damage-bonus portion by the synergy bonus', () => {
    // Thermal Shock damage 1.3 (= +30% bonus); a 0.2 bonus → +30% × 1.2 = +36%
    const result = computeSynergyMultipliers(['frost_nova', 'meteor'], 0.2);
    expect(result.get('frost_nova')!.damage).toBeCloseTo(1.36, 6);
    expect(result.get('frost_nova')!.cooldown).toBeCloseTo(1.0, 6); // no cooldown bonus to amplify
  });

  it('amplifies the cooldown-reduction portion by the synergy bonus', () => {
    // Blade Dance cooldown 0.85 (= 15% faster); a 0.2 bonus → 15% × 1.2 = 18% faster
    const result = computeSynergyMultipliers(['katana', 'orbiting_blades'], 0.2);
    expect(result.get('katana')!.cooldown).toBeCloseTo(0.82, 6);
    expect(result.get('katana')!.damage).toBeCloseTo(1.0, 6); // no damage bonus to amplify
  });

  it('amplifies damage and cooldown bonuses together', () => {
    // Conducting Field: chain_lightning + aura → damage 1.15, cooldown 0.9
    const result = computeSynergyMultipliers(['chain_lightning', 'aura'], 0.2);
    expect(result.get('aura')!.damage).toBeCloseTo(1.18, 6); // +15% × 1.2 = +18%
    expect(result.get('aura')!.cooldown).toBeCloseTo(0.88, 6); // 10% × 1.2 = 12% faster
  });

  it('stacks multiple synergies on a weapon multiplicatively, each amplified', () => {
    // frost_nova is in Thermal Shock (×frost_nova+meteor, dmg 1.3) AND
    // Elemental Flux (flamethrower+frost_nova, dmg 1.2).
    const raw = computeSynergyMultipliers(['frost_nova', 'meteor', 'flamethrower']);
    expect(raw.get('frost_nova')!.damage).toBeCloseTo(1.3 * 1.2, 6); // 1.56

    const amplified = computeSynergyMultipliers(['frost_nova', 'meteor', 'flamethrower'], 0.2);
    // each bonus amplified before stacking: (1+0.3*1.2) × (1+0.2*1.2) = 1.36 × 1.24
    expect(amplified.get('frost_nova')!.damage).toBeCloseTo(1.36 * 1.24, 6);
  });

  it('clamps a negative bonus to zero so synergies are never inverted below base', () => {
    const result = computeSynergyMultipliers(['frost_nova', 'meteor'], -1);
    expect(result.get('frost_nova')).toEqual({ damage: 1.3, cooldown: 1.0 });
  });

  it('treats a non-finite bonus as zero', () => {
    const nan = computeSynergyMultipliers(['frost_nova', 'meteor'], Number.NaN);
    expect(nan.get('frost_nova')!.damage).toBeCloseTo(1.3, 6);
    const inf = computeSynergyMultipliers(['frost_nova', 'meteor'], Number.POSITIVE_INFINITY);
    expect(inf.get('frost_nova')!.damage).toBeCloseTo(1.3, 6);
  });
});
