import { describe, test, expect } from 'vitest';
import { generateWorld } from '../world/generateWorld';
import { STAGES } from '../data/Stages';
import { buildLockoutRows } from './lockouts';
import type { LockoutInputs } from './lockouts';
import { EdgeFlags, PoiFlags, SecretFlags } from './DiscoveryTypes';
import { EDGE_DIRECTIONS, EdgeKind, PoiKind, edgeIdFor } from '../world/worldTypes';
import type { WorldMap } from '../world/worldTypes';

const MAP = generateWorld(20260727, {
  abilityGateOrder: [],
  availableBiomeIds: STAGES.map(stage => stage.id),
});

const GATED = generateWorld(20260727, {
  abilityGateOrder: ['ability_blink_drive', 'ability_magno_tether'],
  availableBiomeIds: STAGES.map(stage => stage.id),
});

function rowsFor(map: WorldMap = GATED, overrides: Partial<LockoutInputs> = {}) {
  return buildLockoutRows({
    map,
    sectorFlagsOf: () => 1,
    edgeFlagsOf: () => EdgeFlags.KNOWN,
    poiFlagsOf: () => PoiFlags.SEEN,
    secretFlagsOf: () => SecretFlags.HINTED,
    holdsAbility: () => false,
    holdsQuestKey: () => false,
    shipCell: { col: 0, row: 0 },
    ...overrides,
  });
}

function distinctAbilityDoorEdgeIds(map: WorldMap): Set<string> {
  const ids = new Set<string>();
  for (const sector of map.sectors.values()) {
    for (const direction of EDGE_DIRECTIONS) {
      const edge = sector.edges[direction];
      if (edge.kind !== EdgeKind.AbilityDoor || edge.requiredId === undefined) continue;
      ids.add(edgeIdFor(sector.sx, sector.sy, direction));
    }
  }
  return ids;
}

const GAPPED_MAP = [MAP, GATED].find(map => [...map.sectors.values()]
  .some(sector => sector.poiSlots.some(slot =>
    slot.kind === PoiKind.Secret && slot.gapped === true)))!;

describe('buildLockoutRows', () => {
  test('an interior door is counted once, not once per sector that touches it', () => {
    const expected = distinctAbilityDoorEdgeIds(GATED).size;
    expect(expected).toBeGreaterThan(0);
    const doors = rowsFor().filter(row => row.kind === 'ability')
      .reduce((total, row) => total + row.doors, 0);
    expect(doors).toBe(expected);
  });

  test('an uncharted sector contributes nothing', () => {
    expect(rowsFor(GATED, { sectorFlagsOf: () => 0 })).toEqual([]);
  });

  test('an unknown edge raises no door count', () => {
    const doors = rowsFor(GATED, { edgeFlagsOf: () => 0 })
      .reduce((total, row) => total + row.doors, 0);
    expect(doors).toBe(0);
  });

  test('holding an ability drops its row and leaves the rest untouched', () => {
    const before = rowsFor();
    const held = before.find(row => row.kind === 'ability')!.id;
    const after = rowsFor(GATED, { holdsAbility: id => id === held });
    expect(after.some(row => row.id === held)).toBe(false);
    const beforeIds = new Set(before.map(row => row.id));
    expect(after.every(row => beforeIds.has(row.id))).toBe(true);
    expect(after.length).toBeLessThan(before.length);
  });

  test('an un-hinted cache raises no count, because a count with a distance beside it is a position', () => {
    const hinted = rowsFor(GAPPED_MAP)
      .find(row => row.id === 'ability_magno_tether')?.sites ?? 0;
    expect(hinted).toBeGreaterThan(0);
    const unhinted = rowsFor(GAPPED_MAP, { secretFlagsOf: () => 0 })
      .find(row => row.id === 'ability_magno_tether')?.sites ?? 0;
    expect(unhinted).toBe(0);
  });
});
