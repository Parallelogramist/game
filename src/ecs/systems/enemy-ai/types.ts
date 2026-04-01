import { IWorld } from 'bitecs';

/**
 * Context passed to all AI behavior functions each frame.
 * Created once per frame by the dispatcher, avoiding per-function parameter lists.
 */
export interface AIContext {
  playerX: number;
  playerY: number;
  deltaTime: number;
  world: IWorld;
}

/**
 * Signature for an AI behavior update function.
 */
export type AIUpdateFn = (enemyId: number, ctx: AIContext) => void;
