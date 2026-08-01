/**
 * radarWaypoints: which destinations the tactical radar carries a bearing for.
 *
 * Pure and Phaser-free like the rest of src/expedition/. A waypoint is a SECTOR, never a
 * position: an objective resolves to the sector its pin already chose and a lead to the sector
 * its riddle already names, which is the granularity both already have on the chart. Pointing
 * at a real position is hint tier 3's earned privilege (the decryptor scan), and handing it out
 * here would quietly overrule tier 1's "a cache is in this room, never where".
 *
 * Two drops keep the radar from saying more than the chart does. An uncharted destination is
 * dropped, the same rule SectorMapRenderer's hinted badge and questPins both obey. A
 * destination in the sector the ship is already inside is dropped too, so the ambient shimmer
 * stays the only thing that speaks in the room it is withholding a position in. An unclaimed
 * ability vault is the third kind, and it ranks last, so it can only take a slot no objective
 * and no lead wanted.
 */

import { parseSectorKey, sectorCenterWorld } from '../world/worldSpace';

export type RadarWaypointKind = 'objective' | 'mark' | 'lead' | 'vault';

export interface RadarWaypoint {
  kind: RadarWaypointKind;
  sectorKey: string;
  /** Centre of the named sector in world space. Never an entity position. */
  worldX: number;
  worldY: number;
}

export interface RadarWaypointInputs {
  /** Each active objective's pinned sector; a null is an objective whose place is not charted
   *  yet, which buildQuestPins already resolved rather than leaking the real key. */
  objectiveSectorKeys: readonly (string | null)[];
  /** Sectors the player marked on the chart, any kind. */
  markSectorKeys: readonly string[];
  /** The sector each open lead names. */
  leadSectorKeys: readonly string[];
  /** Sectors holding an ability vault the profile has seen and not claimed. */
  vaultSectorKeys: readonly string[];
  /** Non-zero discovery flags mean charted. */
  isCharted: (sectorKey: string) => boolean;
  /** The sector the ship is inside right now. */
  shipSectorKey: string;
  playerX: number;
  playerY: number;
  maxWaypoints?: number;
}

/** Four is the readable ceiling on a 56px disc that already carries blips, door glyphs and the
 *  secret shimmer, and it clears the three-active-quest limit with a lead to spare. */
export const MAX_RADAR_WAYPOINTS = 4;

/** A player's own mark ranks above a lead and a vault and below an objective: the player asked
 *  to be led back there, which outranks anything the game merely inferred, but an active
 *  objective is the run's own next step and there are at most three of those. */
const KIND_ORDER: Record<RadarWaypointKind, number> = {
  objective: 0, mark: 1, lead: 2, vault: 3,
};

export function buildRadarWaypoints(inputs: RadarWaypointInputs): RadarWaypoint[] {
  const limit = inputs.maxWaypoints ?? MAX_RADAR_WAYPOINTS;
  const bySectorKey = new Map<string, RadarWaypoint>();

  const consider = (sectorKey: string | null, kind: RadarWaypointKind): void => {
    if (sectorKey === null) return;
    if (sectorKey === inputs.shipSectorKey) return;
    if (!inputs.isCharted(sectorKey)) return;
    // Objectives are offered first, so a sector carrying both reads as the objective.
    if (bySectorKey.has(sectorKey)) return;
    const cell = parseSectorKey(sectorKey);
    if (!cell) return;
    const centre = sectorCenterWorld(cell);
    bySectorKey.set(sectorKey, { kind, sectorKey, worldX: centre.x, worldY: centre.y });
  };

  for (const sectorKey of inputs.objectiveSectorKeys) consider(sectorKey, 'objective');
  for (const sectorKey of inputs.markSectorKeys) consider(sectorKey, 'mark');
  for (const sectorKey of inputs.leadSectorKeys) consider(sectorKey, 'lead');
  for (const sectorKey of inputs.vaultSectorKeys) consider(sectorKey, 'vault');

  const distanceSquared = (waypoint: RadarWaypoint): number => {
    const deltaX = waypoint.worldX - inputs.playerX;
    const deltaY = waypoint.worldY - inputs.playerY;
    return deltaX * deltaX + deltaY * deltaY;
  };

  return [...bySectorKey.values()]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || distanceSquared(a) - distanceSquared(b)
      // Ties break on the key so two equidistant destinations cannot swap between refreshes.
      || (a.sectorKey < b.sectorKey ? -1 : a.sectorKey > b.sectorKey ? 1 : 0))
    .slice(0, Math.max(0, limit));
}
