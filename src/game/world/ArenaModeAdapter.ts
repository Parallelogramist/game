import Phaser from 'phaser';
import { WorldRect } from '../../world/worldSpace';
import { WorldModeAdapter } from './WorldModeAdapter';

/**
 * Arena mode: the world IS the screen, which is why nothing in the shipped game
 * needed a rect before this seam existed. Both rects are recomputed from the live
 * scale on every call rather than cached, so an orientation flip or a Safari
 * address-bar resize needs no invalidation hook; they are reused instances rather
 * than fresh objects because the culling and clamp paths call them every frame.
 */
export class ArenaModeAdapter implements WorldModeAdapter {
  readonly kind = 'arena' as const;

  private readonly scene: Phaser.Scene;
  private readonly view: WorldRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly field: WorldRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  viewRect(): WorldRect {
    return this.syncToScreen(this.view);
  }

  fieldRect(): WorldRect {
    return this.syncToScreen(this.field);
  }

  update(_deltaSeconds: number): void {}

  private syncToScreen(rect: WorldRect): WorldRect {
    rect.minX = 0;
    rect.minY = 0;
    rect.maxX = this.scene.scale.width;
    rect.maxY = this.scene.scale.height;
    return rect;
  }
}
