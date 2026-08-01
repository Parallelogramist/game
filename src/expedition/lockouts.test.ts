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

const KEYED = generateWorld(20260727, {
  abilityGateOrder: ['ability_blink_drive'],
  questKeyOrder: ['quest_key_survey'],
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
    questStateOf: () => ({ kind: 'acceptable' as const }),
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

  test('an ability row names the vault that grants it', () => {
    const vaults = [...GATED.sectors.values()]
      .filter(sector => sector.poiSlots.some(slot =>
        slot.kind === PoiKind.AbilityPowerUp && slot.grantsAbilityId === 'ability_blink_drive'))
      .map(sector => ({
        key: sector.key,
        distance: Math.max(Math.abs(sector.sx), Math.abs(sector.sy)),
      }));
    expect(vaults.length).toBeGreaterThan(0);
    const nearest = Math.min(...vaults.map(vault => vault.distance));

    const row = rowsFor().find(candidate => candidate.id === 'ability_blink_drive')!;
    expect(row).toBeDefined();
    expect(row.source.kind).toBe('vault');
    if (row.source.kind !== 'vault') throw new Error('unreachable');
    expect(row.source.distance).toBe(nearest);
    expect(vaults.filter(vault => vault.distance === nearest).map(vault => vault.key))
      .toContain(row.source.sectorKey);
  });

  test('a vault in a sector the profile has never entered names no place', () => {
    const rows = rowsFor(GATED, { poiFlagsOf: () => 0 }).filter(row => row.kind === 'ability');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.source.kind === 'unfound')).toBe(true);
  });

  test('an active quest names its step rather than a place', () => {
    const rows = rowsFor(KEYED, {
      questStateOf: () => ({ kind: 'active', stepNumber: 2, stepCount: 4 }),
    }).filter(row => row.kind === 'questKey');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].source).toEqual({ kind: 'questActive', stepNumber: 2, stepCount: 4 });
  });

  test('an acceptable quest names the nearest board the profile has seen', () => {
    const seen = rowsFor(KEYED).filter(row => row.kind === 'questKey');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].source.kind).toBe('questBoard');

    const unseen = rowsFor(KEYED, { poiFlagsOf: () => 0 })
      .find(row => row.id === seen[0].id)!;
    expect(unseen.source.kind).toBe('unfound');
  });
});
