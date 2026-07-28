import Phaser from 'phaser';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import {
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  SectorCoord,
  WorldRect,
  parseSectorKey,
  rectContains,
  rectHeight,
  rectWidth,
  sectorCenterWorld,
  sectorKey,
  sectorOfWorldPoint,
  sectorRectWorld,
  sectorsEqual,
} from '../../world/worldSpace';
import { LEASH_RADIUS } from '../../world/spawnRing';
import { setEnemyAIFieldRect } from '../../ecs/systems/enemy-ai/state';
import { SerializedExpeditionState, WorldModeAdapter } from './WorldModeAdapter';

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
  private lockedRoom: WorldRect | null = null;
  private lockedSector: SectorCoord | null = null;
  private appliedCameraWidth = 0;
  private appliedCameraHeight = 0;

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
    this.applyCameraBounds(this.world);
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
    return this.lockedRoom ?? this.world;
  }

  isSpawnableWorldPoint(x: number, y: number): boolean {
    return rectContains(this.world, x, y);
  }

  leashRadius(): number | null {
    return LEASH_RADIUS;
  }

  lockToSector(sector: SectorCoord): void {
    this.lockedSector = sector;
    this.lockedRoom = sectorRectWorld(sector);
    this.applyCameraBounds(this.lockedRoom);
    setEnemyAIFieldRect(this.lockedRoom);
  }

  releaseSectorLock(): void {
    if (!this.lockedRoom) return;
    this.lockedSector = null;
    this.lockedRoom = null;
    this.applyCameraBounds(this.world);
    setEnemyAIFieldRect(this.world);
  }

  saveViewState(): SerializedExpeditionState {
    const camera = this.scene.cameras.main;
    return {
      cameraScrollX: camera.scrollX,
      cameraScrollY: camera.scrollY,
      sectorLockKey: this.lockedSector ? sectorKey(this.lockedSector) : undefined,
    };
  }

  restoreViewState(state: SerializedExpeditionState): void {
    const sector = state.sectorLockKey ? parseSectorKey(state.sectorLockKey) : null;
    if (sector) {
      const centre = sectorCenterWorld(sector);
      // A tampered or foreign key naming a sector outside the flight rect would clamp the
      // camera to a room the player can never be in and strand the run.
      if (rectContains(this.world, centre.x, centre.y)) this.lockToSector(sector);
    }

    const camera = this.scene.cameras.main;
    if (Number.isFinite(state.cameraScrollX) && Number.isFinite(state.cameraScrollY)) {
      // centerOn, not setScroll: it sets midPoint as well, which is what preRender centres
      // the deadzone on, so frame 1 back resumes the exact camera the save was taken at
      // instead of snapping by up to half a deadzone.
      camera.centerOn(
        state.cameraScrollX + camera.width / 2,
        state.cameraScrollY + camera.height / 2,
      );
    }

    this.syncView();
    this.grid?.setViewScroll(camera.scrollX, camera.scrollY);
    this.trails?.setViewScroll(camera.scrollX, camera.scrollY);
  }

  update(_deltaSeconds: number): void {
    const camera = this.scene.cameras.main;
    if (camera.width !== this.appliedCameraWidth || camera.height !== this.appliedCameraHeight) {
      // A Safari address-bar collapse or an orientation flip changes the viewport under
      // a live lock, which would leave the room's centring padding sized for the old one.
      this.applyCameraBounds(this.lockedRoom ?? this.world);
    }
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

  private applyCameraBounds(bounds: WorldRect): void {
    const camera = this.scene.cameras.main;
    // Phaser pins the camera to bounds.x/y when the bounds are narrower than the
    // viewport, so a locked sector would sit against the top-left of the screen on any
    // panel wider or taller than one sector. Padding the bounds out to the viewport
    // instead leaves the room centred, and costs nothing when the world is the bounds.
    const padX = Math.max(0, (camera.width - rectWidth(bounds)) / 2);
    const padY = Math.max(0, (camera.height - rectHeight(bounds)) / 2);
    this.appliedCameraWidth = camera.width;
    this.appliedCameraHeight = camera.height;
    camera.setBounds(
      bounds.minX - padX,
      bounds.minY - padY,
      rectWidth(bounds) + padX * 2,
      rectHeight(bounds) + padY * 2,
    );
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
