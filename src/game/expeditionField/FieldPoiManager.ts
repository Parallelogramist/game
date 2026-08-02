import type { WorldMap } from '../../world/worldTypes';

/**
 * The contract every sector-synced field POI implements. `sync` rebuilds the set when the ship
 * changes sector, `update` runs the per-frame pulse and walk-in test, and `clear` tears the set
 * down AND forgets the sector key — the pairing that made a run reset or a scene shutdown a
 * two-line remembered ritual at every call site before this contract existed.
 *
 * Three methods on purpose: neither implementation holds run-save state, so a serialize/restore
 * pair here would have no caller. It lands with the family that needs it.
 */
export interface FieldPoiManager {
  sync(map: WorldMap, playerX: number, playerY: number): void;
  update(playerX: number, playerY: number): void;
  clear(): void;
}

/** What the radar reads off a field POI. */
export interface FieldPoiContact {
  readonly x: number;
  readonly y: number;
}
