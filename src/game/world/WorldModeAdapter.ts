import Phaser from 'phaser';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import { SectorCoord, WorldRect } from '../../world/worldSpace';

export type RunModeKind = 'arena' | 'expedition';

/**
 * The moving-view state a run save carries. Arena has none: its view is the screen and
 * never moves, which is why an arena run keeps writing a version-1 payload.
 */
export interface SerializedExpeditionState {
  cameraScrollX: number;
  cameraScrollY: number;
  /** Sector key of a live boss lock ("col,row"); absent when the world is open. */
  sectorLockKey?: string;
}

/**
 * The single seam between "the world is the screen" (arena) and a world the camera
 * moves across (expedition, FEAT-WORLD-SPACE-4 onward). Gameplay systems take a
 * WorldRect and never read the scale manager or the camera themselves.
 *
 * Every member of doc 01 section 7.2 has now landed, plus the save/restore pair section
 * 8.3 needs. setupCamera takes the grid and the
 * trail buffer alongside the player visual because those are the two screen-sized layers
 * that must track the camera.
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
   * Seal the playfield to one sector: a boss room. Narrows fieldRect and the camera
   * bounds so every arena-tuned boss behaviour recovers its original geometry, and
   * pushes the new rect to the enemy-AI bounds so a re-lock cannot leave them stale.
   * Locking while already locked is the caller's decision to make, not this method's.
   * Arena: no-op, the screen is already the room.
   */
  lockToSector(sector: SectorCoord): void;

  /** Restore the full world bounds. A no-op when nothing is locked. Arena: no-op. */
  releaseSectorLock(): void;

  /**
   * Moving-view state for the run save, or null for a mode whose view never moves.
   * Returning null is what keeps the arena payload on version 1.
   */
  saveViewState(): SerializedExpeditionState | null;

  /**
   * Re-apply a saved view after a restore. Called once, after setupCamera, because the
   * camera has to exist and be following before its scroll can be overridden.
   */
  restoreViewState(state: SerializedExpeditionState): void;

  /**
   * Once per frame from GameScene.update(), after deltaSeconds is final and before
   * any spawner runs. W4 hangs sector-change detection and the grid scroll here.
   */
  update(deltaSeconds: number): void;
}
