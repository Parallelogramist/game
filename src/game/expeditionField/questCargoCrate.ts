import type Phaser from 'phaser';
import { isSolidAtWorld, MoverKind } from '../../world/staticCollision';
import type { WorldPoint } from '../../world/worldSpace';
import type { WorldMap } from '../../world/worldTypes';

/** The board's own amber: a crate reads as quest freight, not as a secret (breakable amber) and
 *  not as a vault (violet). */
export const QUEST_CARGO_COLOR = 0xffb347;
export const QUEST_CARGO_DRAW_RADIUS = 15;
/** The secret cache's claim radius, so a crate and a cache feel the same to fly into. */
export const QUEST_CARGO_PICKUP_RADIUS = 44;

/** Past the board's 48 px open radius by more than the crate's own 44 px pickup radius, so a
 *  ship that flies to the crate is still outside the board when it grabs it and the overlay
 *  never steals the pickup. Under the 110 px re-arm radius, so the board a player just left
 *  does not re-open behind them either. */
const QUEST_CARGO_BOARD_OFFSET = 104;

/** Down first (a board is drawn as a notice board standing above its post, so the open floor is
 *  usually below it), then clockwise. */
const CRATE_BEARINGS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
];

/** A square: the cache is a diamond and the drone is a ring, so the third world object a
 *  quest puts in a room is legible without colour. */
export function drawQuestCargoCrate(graphics: Phaser.GameObjects.Graphics): void {
  const radius = QUEST_CARGO_DRAW_RADIUS;
  graphics.fillStyle(QUEST_CARGO_COLOR, 0.16);
  graphics.fillRect(-radius, -radius, radius * 2, radius * 2);
  graphics.lineStyle(2, QUEST_CARGO_COLOR, 0.9);
  graphics.strokeRect(-radius, -radius, radius * 2, radius * 2);
  graphics.lineStyle(2, QUEST_CARGO_COLOR, 0.5);
  graphics.lineBetween(-radius, 0, radius, 0);
  graphics.lineBetween(0, -radius, 0, radius);
}

/**
 * Where the crate for a board stands. Both the destination and the midpoint are probed, so a
 * bearing that lands in open floor on the far side of a wall is rejected rather than putting
 * the crate somewhere the ship cannot reach from the board. Falls back to the board's own
 * position, which is always reachable because the board itself was walked into.
 */
export function pickCargoCratePoint(
  map: WorldMap, boardX: number, boardY: number, out: WorldPoint,
): void {
  for (const bearing of CRATE_BEARINGS) {
    const scale = bearing[0] !== 0 && bearing[1] !== 0 ? Math.SQRT1_2 : 1;
    const x = boardX + bearing[0] * scale * QUEST_CARGO_BOARD_OFFSET;
    const y = boardY + bearing[1] * scale * QUEST_CARGO_BOARD_OFFSET;
    if (isSolidAtWorld(map, x, y, MoverKind.Player)) continue;
    if (isSolidAtWorld(map, (boardX + x) / 2, (boardY + y) / 2, MoverKind.Player)) continue;
    out.x = x;
    out.y = y;
    return;
  }
  out.x = boardX;
  out.y = boardY;
}
