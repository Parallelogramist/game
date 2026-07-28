import Phaser from 'phaser';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import {
  SectorCoord,
  WorldPoint,
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
import { STAGES } from '../../data/Stages';
import { TRAVERSAL_ABILITY_GATE_ORDER } from '../../data/TraversalAbilities';
import { generateWorld } from '../../world/generateWorld';
import { worldBoundsRect } from '../../world/worldTypes';
import type { WorldMap } from '../../world/worldTypes';
import {
  MoverKind,
  findNearestFreeCircleSpot,
  isSolidAtWorld,
  raycastSolid,
} from '../../world/staticCollision';
import {
  computeFlowField,
  createFlowField,
  flowStepPoint,
} from '../../world/flowField';
import type { FlowField } from '../../world/flowField';
import { TILE_SIZE } from '../../world/worldTypes';
import type { NavigationContext } from '../../ecs/systems/enemy-ai/common';
import { WorldGeometryRenderer } from '../../visual/WorldGeometryRenderer';
import { setEnemyAIFieldRect } from '../../ecs/systems/enemy-ai/state';
import { SerializedExpeditionState, WorldModeAdapter } from './WorldModeAdapter';

/**
 * Expedition mode: the world is a plane the camera moves across, and the screen is a
 * window onto it. Every gameplay system already takes a rect (FEAT-WORLD-SPACE-2), so
 * this adapter only has to own the camera, the two screen-sized view layers that must
 * track it, and the sector the player is standing in.
 *
 * The flight rect is the bounding box of the generated layout and the start point is the
 * layout's own start sector (FEAT-BARRIER-PLAYER).
 */

/**
 * One fixed world for the dev route: the layout has to be the same on every run and
 * every refresh or a saved position means nothing, and there is no per-profile world
 * store to seed from until FEAT-BARRIER-GATES adds `survivor-world-profile`.
 */
const EXPEDITION_WORLD_SEED = 20260727;

const PLAYER_COLLISION_RADIUS = 16;

/**
 * 150 ms or a player tile crossing, whichever comes first: a stale field only ever points at
 * where the player was one tile ago, and a refresh is one BFS over 5184 tiles.
 */
const FLOW_REFRESH_SECONDS = 0.15;

const CAMERA_LERP = 0.12;
const CAMERA_DEADZONE_WIDTH = 160;
const CAMERA_DEADZONE_HEIGHT = 120;

export class ExpeditionModeAdapter implements WorldModeAdapter, NavigationContext {
  readonly kind = 'expedition' as const;

  private readonly scene: Phaser.Scene;
  private readonly map: WorldMap;
  private readonly world: WorldRect;
  private readonly spotScratch: WorldPoint = { x: 0, y: 0 };
  private readonly flow: FlowField = createFlowField();
  private flowAge = FLOW_REFRESH_SECONDS;
  private flowTileX = Number.NaN;
  private flowTileY = Number.NaN;
  private geometry: WorldGeometryRenderer | null = null;
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
    this.map = generateWorld(EXPEDITION_WORLD_SEED, {
      abilityGateOrder: [...TRAVERSAL_ABILITY_GATE_ORDER],
      availableBiomeIds: STAGES.map(stage => stage.id),
    });
    if (this.map.abilityOrder.length < TRAVERSAL_ABILITY_GATE_ORDER.length) {
      // The generator places a gate only while a candidate subtree still has room for its
      // key, so a short world silently ungates the rest. Surfaced here at the call site
      // rather than discovered as a missing ability in play (CHORE-WORLDGEN-BUDGET-GUARD).
      console.warn(
        `[expedition] worldgen placed ${this.map.abilityOrder.length} of `
        + `${TRAVERSAL_ABILITY_GATE_ORDER.length} ability gates at seed `
        + `${EXPEDITION_WORLD_SEED}; the rest are ungated this world`,
      );
    }
    this.world = worldBoundsRect(this.map);
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
    this.geometry = new WorldGeometryRenderer(this.scene, this.map);
    this.geometry.update(this.view);
    this.enterSector(sectorOfWorldPoint(playerVisual.x, playerVisual.y));
  }

  playerStartPoint(): { x: number; y: number } {
    const start = parseSectorKey(this.map.startKey) ?? { col: 0, row: 0 };
    const centre = sectorCenterWorld(start);
    this.freeSpotNear(centre.x, centre.y, this.spotScratch);
    return { x: this.spotScratch.x, y: this.spotScratch.y };
  }

  viewRect(): WorldRect {
    return this.syncView();
  }

  fieldRect(): WorldRect {
    return this.lockedRoom ?? this.world;
  }

  // The point must be in open floor, not merely inside the world plane: from this chunk on an
  // enemy resolves against geometry, so a ring point inside rock would spawn something that
  // has to be shoved out by the resolver on its first step. Tile snapping and a reachability
  // filter are still FEAT-WORLDGEN-SPAWN.
  isSpawnableWorldPoint(x: number, y: number): boolean {
    return rectContains(this.world, x, y)
      && !isSolidAtWorld(this.map, x, y, MoverKind.Enemy);
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
    // A tampered or foreign key naming a sector this world does not have would lock the
    // camera to a room the player can never stand in and strand the run.
    const sector = state.sectorLockKey ? parseSectorKey(state.sectorLockKey) : null;
    if (sector && this.map.sectors.has(sectorKey(sector))) this.lockToSector(sector);

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
    this.geometry?.update(this.view);
  }

  worldMap(): WorldMap | null {
    return this.map;
  }

  navigationContext(): NavigationContext | null {
    return this;
  }

  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    return raycastSolid(this.map, x1, y1, x2, y2, MoverKind.Enemy) >= 1;
  }

  flowStep(x: number, y: number, out: WorldPoint): boolean {
    return flowStepPoint(this.flow, x, y, out);
  }

  freeSpotNear(x: number, y: number, out: WorldPoint): void {
    if (!isSolidAtWorld(this.map, x, y, MoverKind.Player)) {
      out.x = x;
      out.y = y;
      return;
    }
    if (findNearestFreeCircleSpot(this.map, x, y, PLAYER_COLLISION_RADIUS, out)) return;
    out.x = x;
    out.y = y;
  }

  destroy(): void {
    this.geometry?.destroy();
    this.geometry = null;
  }

  update(deltaSeconds: number): void {
    const camera = this.scene.cameras.main;
    if (camera.width !== this.appliedCameraWidth || camera.height !== this.appliedCameraHeight) {
      // A Safari address-bar collapse or an orientation flip changes the viewport under
      // a live lock, which would leave the room's centring padding sized for the old one.
      this.applyCameraBounds(this.lockedRoom ?? this.world);
    }
    this.syncView();
    this.grid?.setViewScroll(camera.scrollX, camera.scrollY);
    this.trails?.setViewScroll(camera.scrollX, camera.scrollY);
    this.geometry?.update(this.view);

    const player = this.playerVisual;
    if (!player) return;

    this.flowAge += deltaSeconds;
    const playerTileX = Math.floor(player.x / TILE_SIZE);
    const playerTileY = Math.floor(player.y / TILE_SIZE);
    if (this.flowAge >= FLOW_REFRESH_SECONDS
      || playerTileX !== this.flowTileX || playerTileY !== this.flowTileY) {
      computeFlowField(this.map, player.x, player.y, this.flow);
      this.flowAge = 0;
      this.flowTileX = playerTileX;
      this.flowTileY = playerTileY;
    }

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
