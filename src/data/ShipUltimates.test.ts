import { describe, test, expect } from 'vitest';

import { SHIP_CHARACTERS } from './ShipCharacters';
import { SHIP_ULTIMATES, getShipUltimate } from './ShipUltimates';

describe('ShipUltimates registry integrity', () => {
  test('every ship declares an ultimate that resolves', () => {
    for (const ship of SHIP_CHARACTERS) {
      expect(ship.ultimateId, `${ship.id} has no ultimateId`).toBeDefined();
      expect(
        SHIP_ULTIMATES.some((ultimate) => ultimate.id === ship.ultimateId),
        `${ship.id}'s ultimateId '${ship.ultimateId}' does not resolve`,
      ).toBe(true);
    }
  });

  test('every ship has a distinct ultimate', () => {
    const ultimateIds = SHIP_CHARACTERS.map((ship) => ship.ultimateId);
    expect(new Set(ultimateIds).size).toBe(SHIP_CHARACTERS.length);
  });

  test('registry ids are unique and every entry is claimed by a ship', () => {
    const registryIds = SHIP_ULTIMATES.map((ultimate) => ultimate.id);
    expect(new Set(registryIds).size).toBe(registryIds.length);

    const claimedIds = new Set(SHIP_CHARACTERS.map((ship) => ship.ultimateId));
    for (const ultimate of SHIP_ULTIMATES) {
      expect(claimedIds.has(ultimate.id), `${ultimate.id} is not used by any ship`).toBe(true);
    }
  });

  test('getShipUltimate falls back to overdrive, unchanged from today', () => {
    const fallbackForUndefined = getShipUltimate(undefined);
    const fallbackForUnknown = getShipUltimate('no_such_ultimate' as never);

    expect(fallbackForUndefined.id).toBe('overdrive');
    expect(fallbackForUnknown.id).toBe('overdrive');
    expect(fallbackForUndefined.nova).toEqual({
      radiusMultiplier: 1.0,
      damageMultiplier: 1.0,
      knockback: 380,
    });
  });
});
