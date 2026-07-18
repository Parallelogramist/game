import { describe, test, expect, vi } from 'vitest';

// LoadoutCode is pure, but it imports LastLoadout, which imports the encrypted
// storage module at load time. Stub it (as the sibling meta tests do) so the
// import graph never pulls in Web Crypto under Node. encode/decode never call it.
vi.mock('../storage', () => ({
  SecureStorage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
}));

import { encodeLoadoutCode, decodeLoadoutCode } from './LoadoutCode';
import type { LastLoadout } from './LastLoadout';

function makeLoadout(overrides: Partial<LastLoadout> = {}): LastLoadout {
  return {
    startingWeapon: 'projectile',
    shipId: 'ship_apex',
    stageId: 'stage_inferno',
    pactIds: ['pact_a', 'pact_b'],
    directorStrategy: 'balanced',
    threatLevel: 3,
    gauntletMode: true,
    ...overrides,
  };
}

describe('LoadoutCode', () => {
  test('encode then decode round-trips a full loadout', () => {
    const loadout = makeLoadout();
    expect(decodeLoadoutCode(encodeLoadoutCode(loadout))).toEqual(loadout);
  });

  test('a code round-trips a minimal loadout (optional fields absent)', () => {
    const loadout = makeLoadout({
      shipId: undefined,
      stageId: undefined,
      directorStrategy: undefined,
      pactIds: [],
      threatLevel: 0,
      gauntletMode: false,
    });
    expect(decodeLoadoutCode(encodeLoadoutCode(loadout))).toEqual(loadout);
  });

  test('encoded codes carry the version tag', () => {
    expect(encodeLoadoutCode(makeLoadout())).toMatch(/^PPS1-/);
  });

  test('decode trims surrounding whitespace', () => {
    const code = encodeLoadoutCode(makeLoadout({ startingWeapon: 'katana' }));
    expect(decodeLoadoutCode(`  \n${code}\n  `)?.startingWeapon).toBe('katana');
  });

  test('decode returns null for empty / garbage / wrong-tag input', () => {
    expect(decodeLoadoutCode('')).toBeNull();
    expect(decodeLoadoutCode('   ')).toBeNull();
    expect(decodeLoadoutCode('hello world')).toBeNull();
    // Valid base64 of valid JSON, but missing the version tag.
    expect(decodeLoadoutCode(btoa(JSON.stringify(makeLoadout())))).toBeNull();
  });

  test('decode returns null for a tagged but corrupt payload', () => {
    expect(decodeLoadoutCode('PPS1-')).toBeNull();
    expect(decodeLoadoutCode('PPS1-!!!not base64!!!')).toBeNull();
    // Valid base64, but not JSON.
    expect(decodeLoadoutCode(`PPS1-${btoa('not json')}`)).toBeNull();
  });

  test('decode returns null when the JSON is not a valid loadout', () => {
    // Valid tag + base64 + JSON, but no startingWeapon → sanitizeLoadout rejects.
    expect(decodeLoadoutCode(`PPS1-${btoa(JSON.stringify({ threatLevel: 2 }))}`)).toBeNull();
    expect(decodeLoadoutCode(`PPS1-${btoa(JSON.stringify({ startingWeapon: '' }))}`)).toBeNull();
  });

  test('decode rejects an over-long code without throwing', () => {
    expect(decodeLoadoutCode(`PPS1-${'A'.repeat(5000)}`)).toBeNull();
  });
});
