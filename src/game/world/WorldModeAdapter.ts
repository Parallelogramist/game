import { WorldRect } from '../../world/worldSpace';

export type RunModeKind = 'arena' | 'expedition';

/**
 * The single seam between "the world is the screen" (arena) and a world the camera
 * moves across (expedition, FEAT-WORLD-SPACE-4 onward). Gameplay systems take a
 * WorldRect and never read the scale manager or the camera themselves.
 *
 * Deliberately narrower than doc 01 section 7.2: setupCamera, playerStartPoint,
 * isSpawnableWorldPoint, lockToSector and releaseSectorLock land with their first
 * callers in W4/W5/W6 rather than shipping here as no-ops with nothing to call them.
 */
export interface WorldModeAdapter {
  readonly kind: RunModeKind;

  /**
   * World rect the camera shows this frame. Drives spawning and culling.
   * The returned object is reused between calls: read it, never retain it.
   */
  viewRect(): WorldRect;

  /** Legal playfield for the player clamp and the enemy-AI bounds. Same reuse rule. */
  fieldRect(): WorldRect;

  /**
   * Once per frame from GameScene.update(), after deltaSeconds is final and before
   * any spawner runs. W4 hangs sector-change detection and the grid scroll here.
   */
  update(deltaSeconds: number): void;
}
