import Phaser from 'phaser';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import {
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  SectorCoord,
  WorldRect,
  sectorCenterWorld,
  sectorKey,
  sectorOfWorldPoint,
  sectorsEqual,
} from '../../world/worldSpace';
import { WorldModeAdapter } from './WorldModeAdapter';

/**
 * Expedition mode: the world is a plane the camera moves across, and the screen is a
 * window onto it. Every gameplay system already takes a rect (FEAT-WORLD-SPACE-2), so
 * this adapter only has to own the camera, the two screen-sized view layers that must
 * track it, and the sector the player is standing in.
 *
 * The flight rect is a fixed 5x5 sectors until a generated layout supplies worldBounds
 * and a start sector (doc 01 section 10, W4: "temporary bounded flight rect"). Wiring
 * generateWorld() in here would import a whole world nothing in this chunk can render.
 */
const FLIGHT_RECT_SECTORS_X = 5;
const FLIGHT_RECT_SECTORS_Y = 5;
const START_SECTOR: SectorCoord = { col: 2, row: 2 };

const CAMERA_LERP = 0.12;
const CAMERA_DEADZONE_WIDTH = 160;
const CAMERA_DEADZONE_HEIGHT = 120;

export class ExpeditionModeAdapter implements WorldModeAdapter {
  readonly kind = 'expedition' as const;

  private readonly scene: Phaser.Scene;
  private readonly world: WorldRect = {
    minX: 0,
    minY: 0,
    maxX: SECTOR_WIDTH * FLIGHT_RECT_SECTORS_X,
    maxY: SECTOR_HEIGHT * FLIGHT_RECT_SECTORS_Y,
  };
  private readonly view: WorldRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private playerVisual: Phaser.GameObjects.Container | null = null;
  private grid: GridBackground | null = null;
  private trails: TrailManager | null = null;
  private currentSector: SectorCoord | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setupCamera(
    playerVisual: Phaser.GameObjects.Container,
    grid: GridBackground,
    trails: TrailManager,
  ): void {
    this.playerVisual = playerVisual;
    this.grid = grid;
    this.trails = trails;

    const camera = this.scene.cameras.main;
    camera.setBounds(
      this.world.minX,
      this.world.minY,
      this.world.maxX - this.world.minX,
      this.world.maxY - this.world.minY,
    );
    camera.startFollow(playerVisual, true, CAMERA_LERP, CAMERA_LERP);
    camera.setDeadzone(CAMERA_DEADZONE_WIDTH, CAMERA_DEADZONE_HEIGHT);
    // Without this the first frame swoops in from the world origin.
    camera.centerOn(playerVisual.x, playerVisual.y);

    this.syncView();
    this.enterSector(sectorOfWorldPoint(playerVisual.x, playerVisual.y));
  }

  playerStartPoint(): { x: number; y: number } {
    return sectorCenterWorld(START_SECTOR);
  }

  viewRect(): WorldRect {
    return this.syncView();
  }

  fieldRect(): WorldRect {
    return this.world;
  }

  update(_deltaSeconds: number): void {
    const camera = this.scene.cameras.main;
    this.syncView();
    this.grid?.setViewScroll(camera.scrollX, camera.scrollY);
    this.trails?.setViewScroll(camera.scrollX, camera.scrollY);

    const player = this.playerVisual;
    if (!player) return;
    const sector = sectorOfWorldPoint(player.x, player.y);
    if (!this.currentSector || !sectorsEqual(sector, this.currentSector)) {
      this.enterSector(sector);
    }
  }

  private syncView(): WorldRect {
    const camera = this.scene.cameras.main;
    this.view.minX = camera.scrollX;
    this.view.minY = camera.scrollY;
    this.view.maxX = camera.scrollX + camera.width;
    this.view.maxY = camera.scrollY + camera.height;
    return this.view;
  }

  private enterSector(sector: SectorCoord): void {
    this.currentSector = sector;
    const key = sectorKey(sector);
    this.scene.events.emit('expedition:sector-entered', {
      sectorKey: key,
      coord: sector,
      viaEdgeId: null,
    });
    console.log(`[expedition] sector-entered ${key}`);
  }
}
