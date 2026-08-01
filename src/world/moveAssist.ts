/**
 * moveAssist — the two corrections that make a wall feel like a wall rather than glue.
 *
 * The resolver is axis-separated, so a press that is nearly perpendicular into a wall keeps only
 * its raw tangential projection: pressing 5 degrees off the normal slid at 8% of full speed. The
 * slide transfer pays the blocked component back into the free axis, capped so sliding along a
 * wall can approach but never exceed open-field speed.
 *
 * The corner slip answers the other half. A 32px ship entering a 40px doorway has 4px of margin
 * per side, so a straight-on approach 8px off centre clips a jamb and is stopped for good, with no
 * tangential input to transfer. When exactly one corner is in the way and the overlap is shallow,
 * the ship is nudged off it.
 *
 * Player-only by design: enemies steer from the flow field and have their own Band A items.
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS.
 */

import { TILE_SIZE } from './worldTypes';
import type { WorldMap } from './worldTypes';
import { MoverKind, isSolidAtWorld, resolveCircleMove } from './staticCollision';
import type { CollisionResult } from './staticCollision';

const SLIDE_TRANSFER = 0.75;
const CORNER_SLIP_TRANSFER = 0.75;
const CORNER_SLIP_MAX_OVERLAP = 10;
const CORNER_PROBE_AHEAD = 2;
const CORNER_PROBE_INSET = 0.5;
const CORNER_SLIP_MARGIN = 1;

function slideTransfer(blockedStep: number, freeStep: number): number {
  if (freeStep === 0) return 0;
  const fullSpeed = Math.sqrt(blockedStep * blockedStep + freeStep * freeStep);
  const headroom = fullSpeed - Math.abs(freeStep);
  if (headroom <= 0) return 0;
  return Math.sign(freeStep) * Math.min(Math.abs(blockedStep) * SLIDE_TRANSFER, headroom);
}

function cornerSlipY(
  world: WorldMap, x: number, y: number, radius: number, stepX: number,
): number {
  const probeX = x + Math.sign(stepX) * (radius + CORNER_PROBE_AHEAD);
  if (isSolidAtWorld(world, probeX, y, MoverKind.Player)) return 0;
  const solidAbove = isSolidAtWorld(world, probeX, y - radius + CORNER_PROBE_INSET, MoverKind.Player);
  const solidBelow = isSolidAtWorld(world, probeX, y + radius - CORNER_PROBE_INSET, MoverKind.Player);
  if (solidAbove === solidBelow) return 0;
  const rowTop = Math.floor(y / TILE_SIZE) * TILE_SIZE;
  const overlap = solidAbove ? radius - (y - rowTop) : radius - (rowTop + TILE_SIZE - y);
  if (overlap <= 0 || overlap > CORNER_SLIP_MAX_OVERLAP) return 0;
  const magnitude = Math.min(Math.abs(stepX) * CORNER_SLIP_TRANSFER, overlap + CORNER_SLIP_MARGIN);
  return solidAbove ? magnitude : -magnitude;
}

function cornerSlipX(
  world: WorldMap, x: number, y: number, radius: number, stepY: number,
): number {
  const probeY = y + Math.sign(stepY) * (radius + CORNER_PROBE_AHEAD);
  if (isSolidAtWorld(world, x, probeY, MoverKind.Player)) return 0;
  const solidLeft = isSolidAtWorld(world, x - radius + CORNER_PROBE_INSET, probeY, MoverKind.Player);
  const solidRight = isSolidAtWorld(world, x + radius - CORNER_PROBE_INSET, probeY, MoverKind.Player);
  if (solidLeft === solidRight) return 0;
  const columnLeft = Math.floor(x / TILE_SIZE) * TILE_SIZE;
  const overlap = solidLeft ? radius - (x - columnLeft) : radius - (columnLeft + TILE_SIZE - x);
  if (overlap <= 0 || overlap > CORNER_SLIP_MAX_OVERLAP) return 0;
  const magnitude = Math.min(Math.abs(stepY) * CORNER_SLIP_TRANSFER, overlap + CORNER_SLIP_MARGIN);
  return solidLeft ? magnitude : -magnitude;
}

/** The slip wins when it disagrees with the player's own input: that is the case where the input
 *  is driving into the jamb and following it would keep the ship stuck. */
function chooseAssistOffset(slip: number, transfer: number): number {
  if (slip === 0) return transfer;
  if (transfer === 0) return slip;
  if (Math.sign(slip) !== Math.sign(transfer)) return slip;
  return Math.abs(slip) > Math.abs(transfer) ? slip : transfer;
}

export function resolvePlayerMoveWithAssist(
  world: WorldMap, prevX: number, prevY: number, nextX: number, nextY: number,
  radius: number, out: CollisionResult,
): void {
  resolveCircleMove(world, prevX, prevY, nextX, nextY, radius, MoverKind.Player, out);
  const blockedX = out.hitX;
  const blockedY = out.hitY;
  if (blockedX === blockedY) return;

  const stepX = nextX - prevX;
  const stepY = nextY - prevY;
  const restingX = out.x;
  const restingY = out.y;
  const offset = blockedX
    ? chooseAssistOffset(cornerSlipY(world, restingX, restingY, radius, stepX), slideTransfer(stepX, stepY))
    : chooseAssistOffset(cornerSlipX(world, restingX, restingY, radius, stepY), slideTransfer(stepY, stepX));

  if (offset !== 0) {
    if (blockedX) {
      resolveCircleMove(world, restingX, restingY, restingX, restingY + offset, radius, MoverKind.Player, out);
    } else {
      resolveCircleMove(world, restingX, restingY, restingX + offset, restingY, radius, MoverKind.Player, out);
    }
  }
  // The assist move overwrote the flags with its own contact; the frame's contact is what callers mean.
  out.hitX = blockedX;
  out.hitY = blockedY;
}
