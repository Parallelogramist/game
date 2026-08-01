/**
 * sectorRetire: the departed half of a sector handoff (FEAT-WORLDGEN-STREAM).
 *
 * Leaving a sector puts its loose floor loot away. Pure: no Phaser, no ECS, no storage. It
 * takes positions and hands back entity ids; the caller owns every destroy, which is the same
 * split secretPuzzles.ts uses for ring offsets.
 */

import { parseSectorKey, rectContains, sectorRectWorld } from './worldSpace';

/**
 * Loot this close to the ship survives the handoff. A magnetised gem chasing the player over a
 * seam is still the player's, and a seam has no width: without this the pickup being reeled in
 * at the moment of crossing would vanish out of the magnet beam. Sized under a sector's half
 * diagonal (~735 px) so a room still empties.
 */
export const SECTOR_RETIRE_KEEP_RADIUS = 600;

export interface RetireCandidate {
  entityId: number;
  x: number;
  y: number;
}

export interface SectorRetireInput {
  /** The sector just left, as "col,row". Null (a run start, a restore) retires nothing. */
  fromSectorKey: string | null;
  playerX: number;
  playerY: number;
  candidates: readonly RetireCandidate[];
}

/**
 * The entity ids the handoff retires: inside the departed room, and out of the ship's reach.
 * Order follows the input, and an id is never returned twice.
 */
export function planSectorRetire(input: SectorRetireInput): number[] {
  const sector = input.fromSectorKey ? parseSectorKey(input.fromSectorKey) : null;
  if (!sector) return [];

  const room = sectorRectWorld(sector);
  const keepRadiusSq = SECTOR_RETIRE_KEEP_RADIUS * SECTOR_RETIRE_KEEP_RADIUS;
  const retired: number[] = [];

  for (const candidate of input.candidates) {
    if (!rectContains(room, candidate.x, candidate.y)) continue;
    const deltaX = candidate.x - input.playerX;
    const deltaY = candidate.y - input.playerY;
    if (deltaX * deltaX + deltaY * deltaY <= keepRadiusSq) continue;
    retired.push(candidate.entityId);
  }
  return retired;
}
