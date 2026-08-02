import { describe, test, expect } from 'vitest';
import { buildRadarWaypoints, type RadarWaypointInputs } from './radarWaypoints';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from '../world/worldSpace';

const CHARTED = new Set(['1,0', '2,0', '3,0']);

function build(overrides: Partial<RadarWaypointInputs>) {
  return buildRadarWaypoints({
    objectiveSectorKeys: [],
    markSectorKeys: [],
    leadSectorKeys: [],
    sealedLeadSectorKeys: new Set<string>(),
    vaultSectorKeys: [],
    isCharted: (sectorKey) => CHARTED.has(sectorKey),
    shipSectorKey: '0,0',
    playerX: SECTOR_WIDTH / 2,
    playerY: SECTOR_HEIGHT / 2,
    ...overrides,
  });
}

describe('buildRadarWaypoints', () => {
  test('drops an uncharted destination, an unresolved pin and the ship own sector', () => {
    const waypoints = build({ objectiveSectorKeys: ['9,9', null, '0,0', '1,0'] });
    expect(waypoints).toHaveLength(1);
    expect(waypoints[0].sectorKey).toBe('1,0');
    expect(waypoints[0].worldX).toBe(SECTOR_WIDTH * 1.5);
    expect(waypoints[0].worldY).toBe(SECTOR_HEIGHT * 0.5);
  });

  test('an objective and a lead on one sector collapse to a single objective mark', () => {
    const waypoints = build({ objectiveSectorKeys: ['1,0'], leadSectorKeys: ['1,0'] });
    expect(waypoints).toHaveLength(1);
    expect(waypoints[0].kind).toBe('objective');
  });

  test('objectives outrank leads and the cap keeps the nearest lead', () => {
    const waypoints = build({
      objectiveSectorKeys: ['2,0'],
      leadSectorKeys: ['3,0', '1,0'],
      maxWaypoints: 2,
    });
    expect(waypoints.map((waypoint) => [waypoint.kind, waypoint.sectorKey])).toEqual([
      ['objective', '2,0'],
      ['lead', '1,0'],
    ]);
  });

  test('a vault ranks below an objective and a lead under the cap', () => {
    const waypoints = build({
      objectiveSectorKeys: ['3,0'],
      leadSectorKeys: ['2,0'],
      vaultSectorKeys: ['1,0'],
      maxWaypoints: 2,
    });
    expect(waypoints.map((waypoint) => [waypoint.kind, waypoint.sectorKey])).toEqual([
      ['objective', '3,0'],
      ['lead', '2,0'],
    ]);
  });

  test('a lead and a vault on one sector collapse to the lead', () => {
    const waypoints = build({ leadSectorKeys: ['1,0'], vaultSectorKeys: ['1,0'] });
    expect(waypoints).toHaveLength(1);
    expect(waypoints[0].kind).toBe('lead');
  });

  test('only a lead seals, and an objective on the same sector clears the seal', () => {
    const waypoints = build({
      objectiveSectorKeys: ['2,0'],
      leadSectorKeys: ['1,0', '2,0'],
      vaultSectorKeys: ['3,0'],
      sealedLeadSectorKeys: new Set(['1,0', '2,0', '3,0']),
    });
    expect(waypoints.map((waypoint) => [waypoint.kind, waypoint.sectorKey, waypoint.sealed]))
      .toEqual([
        ['objective', '2,0', false],
        ['lead', '1,0', true],
        ['vault', '3,0', false],
      ]);
  });
});
