import Phaser from 'phaser';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import { SectorCoord, WorldRect } from '../../world/worldSpace';
import { SerializedExpeditionState, WorldModeAdapter } from './WorldModeAdapter';

/**
 * Arena mode: the world IS the screen, which is why nothing in the shipped game
 * needed a rect before this seam existed. Both rects are recomputed from the live
 * scale on every call rather than cached, so an orientation flip or a Safari
 * address-bar resize needs no invalidation hook; they are reused instances rather
 * than fresh objects because the culling and clamp paths call them every frame.
 *
 * setupCamera being empty is the byte-identical guarantee in one line: no arena code
 * path can acquire camera scroll. isSpawnableWorldPoint and leashRadius are the same
 * guarantee for FEAT-WORLD-SPACE-5: the spawnability retry always succeeds on its first
 * attempt with the draws it already made, and a null radius returns the leash pass
 * before it reads the frame cache.
 * lockToSector and releaseSectorLock are that guarantee for FEAT-WORLD-SPACE-6: an
 * arena boss fight cannot narrow a rect that is already the whole screen.
 * saveViewState returning null is that guarantee for FEAT-WORLD-SPACE-7: an arena run
 * cannot write a version-2 payload, so a client rollback can never orphan one.
 */
export class ArenaModeAdapter implements WorldModeAdapter {
  readonly kind = 'arena' as const;

  private readonly scene: Phaser.Scene;
  private readonly view: WorldRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly field: WorldRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setupCamera(
    _playerVisual: Phaser.GameObjects.Container,
    _grid: GridBackground,
    _trails: TrailManager,
  ): void {}

  playerStartPoint(): { x: number; y: number } {
    return { x: this.scene.scale.width / 2, y: this.scene.scale.height / 2 };
  }

  viewRect(): WorldRect {
    return this.syncToScreen(this.view);
  }

  fieldRect(): WorldRect {
    return this.syncToScreen(this.field);
  }

  isSpawnableWorldPoint(_x: number, _y: number): boolean {
    return true;
  }

  leashRadius(): number | null {
    return null;
  }

  lockToSector(_sector: SectorCoord): void {}

  releaseSectorLock(): void {}

  saveViewState(): SerializedExpeditionState | null {
    return null;
  }

  restoreViewState(_state: SerializedExpeditionState): void {}

  update(_deltaSeconds: number): void {}

  private syncToScreen(rect: WorldRect): WorldRect {
    rect.minX = 0;
    rect.minY = 0;
    rect.maxX = this.scene.scale.width;
    rect.maxY = this.scene.scale.height;
    return rect;
  }
}
