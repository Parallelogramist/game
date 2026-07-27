import Phaser from 'phaser';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import { WorldRect } from '../../world/worldSpace';

export type RunModeKind = 'arena' | 'expedition';

/**
 * The single seam between "the world is the screen" (arena) and a world the camera
 * moves across (expedition, FEAT-WORLD-SPACE-4 onward). Gameplay systems take a
 * WorldRect and never read the scale manager or the camera themselves.
 *
 * Deliberately narrower than doc 01 section 7.2: lockToSector and releaseSectorLock
 * land with their first callers in W6 rather than shipping here as no-ops with nothing
 * to call them. setupCamera takes the grid and the trail buffer alongside the player
 * visual because those are the two screen-sized layers that must track the camera.
 */
export interface WorldModeAdapter {
  readonly kind: RunModeKind;

  /**
   * Called once from create(), after the player visual, the grid and the trail buffer
   * all exist. The camera and the two screen-sized view layers are wired together
   * because they are one decision: where the view is. Arena: no-op.
   */
  setupCamera(
    playerVisual: Phaser.GameObjects.Container,
    grid: GridBackground,
    trails: TrailManager,
  ): void;

  /** Where a fresh run places the player. Arena: screen centre. */
  playerStartPoint(): { x: number; y: number };

  /**
   * World rect the camera shows this frame. Drives spawning and culling.
   * The returned object is reused between calls: read it, never retain it.
   */
  viewRect(): WorldRect;

  /** Legal playfield for the player clamp and the enemy-AI bounds. Same reuse rule. */
  fieldRect(): WorldRect;

  /**
   * May something enter the world at this point? Arena: the screen is the world, so
   * always. Expedition: inside the world plane, and, once barriers land, outside
   * sealed space. The single choke point every ring spawn passes through.
   */
  isSpawnableWorldPoint(x: number, y: number): boolean;

  /**
   * World px from the view centre past which a drifted regular is recycled onto the
   * spawn ring, or null for a mode whose player cannot outrun anything (arena).
   */
  leashRadius(): number | null;

  /**
   * Once per frame from GameScene.update(), after deltaSeconds is final and before
   * any spawner runs. W4 hangs sector-change detection and the grid scroll here.
   */
  update(deltaSeconds: number): void;
}
