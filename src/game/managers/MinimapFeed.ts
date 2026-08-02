import { defineQuery, hasComponent, type IWorld } from 'bitecs';
import {
  ConsumablePickupTag,
  Destructible,
  EnemyAffix,
  EnemyType,
  Transform,
} from '../../ecs/components';
import { getEnemyIds as getFrameCacheEnemyIds } from '../../ecs/FrameCache';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import { SectorFlags } from '../../expedition/DiscoveryTypes';
import { findUnclaimedAbilityVaults } from '../../expedition/lockouts';
import { buildHazardPins, buildQuestPins } from '../../expedition/questPins';
import { buildRadarWaypoints, type RadarWaypoint } from '../../expedition/radarWaypoints';
import { findSecretSector } from '../../expedition/secretHints';
import {
  getActiveQuestHazardObjectives,
  getActiveQuestMarkers,
} from '../../meta/ExpeditionQuestManager';
import { questWorldStamp } from '../../systems/QuestProgress';
import type { MinimapEntry, MinimapSectorUnderlay } from '../../visual/MinimapManager';
import {
  classifyEnemyKind,
  secretPingIntensity,
  MINIMAP_WORLD_RANGE,
  SECRET_PING_RADIUS,
  type MinimapBlipKind,
} from '../../visual/minimapProjection';
import { sectorWallSegments } from '../../world/sectorWallSegments';
import { SECTOR_HEIGHT, SECTOR_WIDTH, sectorKey, sectorOfWorldPoint } from '../../world/worldSpace';
import { directionDelta } from '../../world/worldTypes';
import type { WorldMap } from '../../world/worldTypes';

const minimapConsumableQuery = defineQuery([Transform, ConsumablePickupTag]);

/** How often the radar re-resolves its bearings. The set only changes on a quest step, a lead
 *  or a newly charted sector, so a poll at the objective ticker's own cadence is cheaper than
 *  subscribing three managers. */
const RADAR_WAYPOINT_REFRESH_SECONDS = 1;

/** Fed while there is no live player, so a held bearing can never be drawn against a (0,0)
 *  ship position. */
const EMPTY_RADAR_WAYPOINTS: readonly RadarWaypoint[] = [];

const MAX_ENEMY_BLIPS = 48;

/**
 * The slice of MinimapManager this feed drives, declared structurally so the feed stays
 * Phaser-free and the gathering pass can be exercised without a live scene.
 */
export interface MinimapRadar {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  setSectorUnderlay(underlay: MinimapSectorUnderlay | null): void;
  setSecretPing(intensity: number): void;
  setWaypoints(waypoints: ReadonlyArray<RadarWaypoint>): void;
  update(
    playerX: number,
    playerY: number,
    entries: ReadonlyArray<MinimapEntry>,
    entryCount: number,
    deltaSeconds: number,
  ): void;
}

/** Anything the radar draws as a plain world-space contact. */
interface RadarPoint {
  readonly x: number;
  readonly y: number;
}

/** A risk room. A WOKEN one is skipped: its wave and the hunter are already live enemy blips. */
interface RadarHazard extends RadarPoint {
  readonly awake: boolean;
}

/** A chest reads its position live off its graphic, which drifts toward the player. */
interface RadarChest {
  readonly graphics: { readonly active: boolean; readonly x: number; readonly y: number };
}

export interface MinimapFeedOptions {
  world: () => IWorld;
  /** -1 while there is no player entity. */
  playerId: () => number;
  minimapEnabled: () => boolean;
  worldMap: () => WorldMap | null;
  biomeTint: (biomeId: string) => number;
  chests: () => ReadonlyArray<RadarChest>;
  vaults: () => ReadonlyArray<RadarPoint>;
  questBoards: () => ReadonlyArray<RadarPoint>;
  ambushNests: () => ReadonlyArray<RadarHazard>;
  nemesisLairs: () => ReadonlyArray<RadarHazard>;
  secretCaches: () => ReadonlyArray<RadarPoint>;
  decryptorOwned: () => boolean;
  spentNestSectorKeys: () => string[];
  markedSectorKeys: () => readonly string[];
  holdsAbility: (abilityId: string) => boolean;
}

/**
 * Drives the tactical minimap / threat radar: gathers this frame's contacts, keeps the sector
 * underlay and the bearing set in sync, and hands them to the radar it was built with.
 *
 * Constructed fresh per run, which is what keeps the underlay key honest: Phaser reuses the
 * scene instance across a restart, so a key held on the scene outlived the MinimapManager it
 * described and could suppress the first underlay of the next run.
 */
export class MinimapFeed {
  private radar: MinimapRadar;
  private options: MinimapFeedOptions;
  /** Reusable per-frame radar contact buffer — grown once, never re-allocated. */
  private entries: MinimapEntry[] = [];
  private underlayKey: string | null = null;
  private waypointTimer = 0;

  constructor(radar: MinimapRadar, options: MinimapFeedOptions) {
    this.radar = radar;
    this.options = options;
  }

  /** Reassemble the underlay next frame: a collapsed barrier or an opened gate changes the
   *  tiles the radar drew. */
  invalidateUnderlay(): void {
    this.underlayKey = null;
  }

  /** Re-resolve the bearings next frame instead of waiting out the refresh timer. */
  invalidateWaypoints(): void {
    this.waypointTimer = 0;
  }

  /**
   * Gathers this frame's radar contacts (bosses/minibosses/elites always shown; regular
   * enemies sampled to a cap to keep the radar readable + cheap; treasure chests as pickups)
   * and hands them to the radar. Reuses the shared per-frame enemy query and a pooled entry
   * buffer — allocates nothing per frame.
   */
  update(deltaSeconds: number): void {
    const minimapEnabled = this.options.minimapEnabled();
    if (minimapEnabled !== this.radar.isEnabled()) {
      this.radar.setEnabled(minimapEnabled);
    }

    const playerId = this.options.playerId();
    if (!minimapEnabled || playerId === -1) {
      this.radar.setSectorUnderlay(null);
      this.underlayKey = null;
      this.radar.setSecretPing(0);
      this.radar.setWaypoints(EMPTY_RADAR_WAYPOINTS);
      this.waypointTimer = 0;
      this.radar.update(0, 0, this.entries, 0, deltaSeconds);
      return;
    }

    const playerX = Transform.x[playerId];
    const playerY = Transform.y[playerId];
    this.syncUnderlay(playerX, playerY);

    this.waypointTimer -= deltaSeconds;
    if (this.waypointTimer <= 0) {
      this.waypointTimer = RADAR_WAYPOINT_REFRESH_SECONDS;
      this.syncWaypoints(playerX, playerY);
    }

    const world = this.options.world();
    const enemyIds = getFrameCacheEnemyIds();
    // Stride-sample regular enemies so dense swarms stay near the blip cap while
    // still conveying density; high-value threats (boss/miniboss/elite) bypass it.
    const stride = Math.max(1, Math.ceil(enemyIds.length / MAX_ENEMY_BLIPS));
    let count = 0;
    let regularSeen = 0;

    for (let i = 0; i < enemyIds.length; i++) {
      const entityId = enemyIds[i];
      // Crates share the enemy pipeline but are stationary props, not threats.
      if (hasComponent(world, Destructible, entityId)) continue;

      const xpValue = EnemyType.xpValue[entityId] || 1;
      const isElite = hasComponent(world, EnemyAffix, entityId);
      const kind = classifyEnemyKind(xpValue, isElite);

      if (kind === 'enemy') {
        if (regularSeen % stride !== 0) {
          regularSeen++;
          continue;
        }
        regularSeen++;
      }
      this.writeEntry(count++, Transform.x[entityId], Transform.y[entityId], kind);
    }

    // Pickups: treasure chests + floor consumables (bomb/freeze/vacuum/gold) are
    // the "go grab this" radar contacts.
    const chests = this.options.chests();
    for (let i = 0; i < chests.length; i++) {
      const chest = chests[i].graphics;
      if (!chest.active) continue;
      this.writeEntry(count++, chest.x, chest.y, 'pickup');
    }
    const vaults = this.options.vaults();
    for (let i = 0; i < vaults.length; i++) {
      this.writeEntry(count++, vaults[i].x, vaults[i].y, 'pickup');
    }
    const questBoards = this.options.questBoards();
    for (let i = 0; i < questBoards.length; i++) {
      this.writeEntry(count++, questBoards[i].x, questBoards[i].y, 'pickup');
    }

    // A dormant hive or den is a decision, so the radar names it a full range before the
    // 150/160 px trip radius and before its own graphic reaches the screen edge. Range-gated
    // rather than rim-clamped: nests and lairs are world-space and run-scoped, so every one
    // rolled this run is still in these arrays, and rim contacts for rooms three sectors away
    // would be permanent clutter. A WOKEN one is skipped: its wave and the hunter are already
    // live enemy blips, and drawing the den too would double-count one fight.
    const hazardRangeSq = MINIMAP_WORLD_RANGE * MINIMAP_WORLD_RANGE;
    const ambushNests = this.options.ambushNests();
    for (let i = 0; i < ambushNests.length; i++) {
      const nest = ambushNests[i];
      if (nest.awake) continue;
      const dx = nest.x - playerX;
      const dy = nest.y - playerY;
      if (dx * dx + dy * dy > hazardRangeSq) continue;
      this.writeEntry(count++, nest.x, nest.y, 'nest');
    }
    const nemesisLairs = this.options.nemesisLairs();
    for (let i = 0; i < nemesisLairs.length; i++) {
      const lair = nemesisLairs[i];
      if (lair.awake) continue;
      const dx = lair.x - playerX;
      const dy = lair.y - playerY;
      if (dx * dx + dy * dy > hazardRangeSq) continue;
      this.writeEntry(count++, lair.x, lair.y, 'lair');
    }

    const secretCaches = this.options.secretCaches();
    // Hint tier 3: the decryptor puts this room's unfound caches on the radar by POSITION,
    // which is precisely what the ambient shimmer withholds. Without the ability the shimmer
    // below is still all the player gets. The array is the sector's own unfound set, so a
    // claim splices a cache out and its blip stops in the same frame.
    if (this.options.decryptorOwned()) {
      for (let i = 0; i < secretCaches.length; i++) {
        this.writeEntry(count++, secretCaches[i].x, secretCaches[i].y, 'secret');
      }
    }

    const consumableIds = minimapConsumableQuery(world);
    for (let i = 0; i < consumableIds.length; i++) {
      const consumableId = consumableIds[i];
      this.writeEntry(count++, Transform.x[consumableId], Transform.y[consumableId], 'pickup');
    }

    // Hint tier 1: the nearest unfound cache in this sector shimmers the radar. The set is
    // the sector's own, so a claimed cache leaves it and stops pinging in the same frame.
    let nearestSecretDistanceSq = Infinity;
    for (let i = 0; i < secretCaches.length; i++) {
      const cache = secretCaches[i];
      const dx = cache.x - playerX;
      const dy = cache.y - playerY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < nearestSecretDistanceSq) nearestSecretDistanceSq = distanceSq;
    }
    this.radar.setSecretPing(
      nearestSecretDistanceSq === Infinity
        ? 0
        : secretPingIntensity(Math.sqrt(nearestSecretDistanceSq), SECRET_PING_RADIUS),
    );

    this.radar.update(playerX, playerY, this.entries, count, deltaSeconds);
  }

  /**
   * Writes a radar contact into the reusable buffer at `index`, growing it by one
   * slot on first use of that index. Returns nothing — caller tracks the count.
   */
  private writeEntry(index: number, worldX: number, worldY: number, kind: MinimapBlipKind): void {
    let slot = this.entries[index];
    if (!slot) {
      slot = { worldX: 0, worldY: 0, kind: 'enemy' };
      this.entries.push(slot);
    }
    slot.worldX = worldX;
    slot.worldY = worldY;
    slot.kind = kind;
  }

  /**
   * Rebuild the radar's sector underlay only when what it draws could have changed: the
   * sector under the ship, the discovery revision (which door stubs are earned), or a broken
   * barrier (which nulls the key from the event sink). Arena returns on the first line, so an
   * arena run never assembles one and the radar there is byte-identical to before.
   */
  private syncUnderlay(playerX: number, playerY: number): void {
    const map = this.options.worldMap();
    if (!map) return;
    const col = Math.floor(playerX / SECTOR_WIDTH);
    const row = Math.floor(playerY / SECTOR_HEIGHT);
    const discovery = getDiscoveryManager();
    const key = `${col},${row}:${discovery.getRevision()}`;
    if (key === this.underlayKey) return;
    this.underlayKey = key;

    const sector = map.sectors.get(`${col},${row}`);
    if (!sector) {
      this.radar.setSectorUnderlay(null);
      return;
    }

    const outline = sectorWallSegments(sector);
    const charted = SectorFlags.DISCOVERED | SectorFlags.VISITED;
    this.radar.setSectorUnderlay({
      originX: col * SECTOR_WIDTH,
      originY: row * SECTOR_HEIGHT,
      segments: outline.segments,
      impassable: outline.impassable,
      doors: outline.doors.map(door => {
        const { dsx, dsy } = directionDelta(door.direction);
        return {
          localX: door.localX,
          localY: door.localY,
          outwardX: door.outwardX,
          outwardY: door.outwardY,
          kind: door.kind,
          horizontalWall: door.direction === 'north' || door.direction === 'south',
          discoveredBeyond:
            (discovery.getSectorFlags(`${col + dsx},${row + dsy}`) & charted) !== 0,
        };
      }),
      biomeTint: this.options.biomeTint(sector.biomeId),
    });
  }

  /**
   * Re-resolve the radar's bearings: each active objective's pinned sector, each open lead's
   * named sector, and every ability vault the ship has stood beside and not claimed. Arena and
   * every other no-map mode return on the first line, so the radar there is byte-identical to
   * before.
   */
  private syncWaypoints(playerX: number, playerY: number): void {
    const map = this.options.worldMap();
    if (!map) {
      this.radar.setWaypoints(EMPTY_RADAR_WAYPOINTS);
      return;
    }
    const discovery = getDiscoveryManager();
    const shipCell = sectorOfWorldPoint(playerX, playerY);
    const spentNestSectorKeys = new Set(this.options.spentNestSectorKeys());
    const pins = [
      ...buildQuestPins({
        map,
        markers: getActiveQuestMarkers(questWorldStamp(map)),
        sectorFlagsOf: (key) => discovery.getSectorFlags(key),
        shipCell,
      }),
      ...buildHazardPins({
        map,
        objectives: getActiveQuestHazardObjectives(),
        sectorFlagsOf: (key) => discovery.getSectorFlags(key),
        poiFlagsOf: (poiId) => discovery.getPoiFlags(poiId),
        spentNestSectorKeys,
        shipCell,
      }),
    ];
    const leadSectorKeys: string[] = [];
    for (const secretId of discovery.getHintedSecretIds()) {
      const sector = findSecretSector(map, secretId);
      if (sector) leadSectorKeys.push(sector.key);
    }
    const vaultSectorKeys = findUnclaimedAbilityVaults({
      map,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      poiFlagsOf: (poiId) => discovery.getPoiFlags(poiId),
      holdsAbility: (abilityId) => this.options.holdsAbility(abilityId),
    }).map((site) => site.sectorKey);
    this.radar.setWaypoints(buildRadarWaypoints({
      objectiveSectorKeys: pins.map((pin) => pin.sectorKey),
      markSectorKeys: this.options.markedSectorKeys(),
      leadSectorKeys,
      vaultSectorKeys,
      isCharted: (key) => discovery.getSectorFlags(key) !== 0,
      shipSectorKey: sectorKey(shipCell),
      playerX,
      playerY,
    }));
  }
}
