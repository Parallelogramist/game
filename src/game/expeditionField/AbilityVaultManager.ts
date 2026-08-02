import Phaser from 'phaser';
import { addComponent, hasComponent, type IWorld } from 'bitecs';
import type { ToastConfig } from '../../achievements/AchievementTypes';
import { EnemyAffixType } from '../../data/Affixes';
import {
  getTraversalAbility, IMPLEMENTED_TRAVERSAL_ABILITY_IDS, VAULT_GUARD_PACKS,
} from '../../data/TraversalAbilities';
import { EnemyTag, VaultGuardTag } from '../../ecs/components';
import { getEnemyType, getScaledStats, type EnemyTypeDefinition } from '../../enemies/EnemyTypes';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import { claimTraversalAbility } from '../../meta/TraversalAbilityManager';
import { getSettingsManager } from '../../settings';
import type { QuestEvent } from '../../systems/QuestProgress';
import { WORLD_GEOMETRY_COLORS } from '../../visual/NeonColors';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from '../../world/worldSpace';
import { PoiKind, TILE_SIZE } from '../../world/worldTypes';
import type { WorldMap } from '../../world/worldTypes';
import type { FieldPoiContact, FieldPoiManager } from './FieldPoiManager';

/** Where a vault's placed pack stands up, measured from the core. */
const VAULT_GUARD_RING_RADIUS = 120;
/** Inside this, a guarded core says so once per sector visit. */
const VAULT_GUARD_NOTICE_RADIUS = 170;
/** Every guard is the same elite, so the encounter reads identically on every vault. */
const VAULT_GUARD_AFFIX = EnemyAffixType.TITAN;
const VAULT_CLAIM_RADIUS = 40;

interface ActiveAbilityVault {
  poiId: string;
  abilityId: string;
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  guarded: boolean;
  guardEntityIds: number[];
  noticed: boolean;
}

/**
 * The scene services a vault needs. Every member is a closure so the manager can be built before
 * the scene has finished wiring the managers behind them, which is exactly what the fresh create
 * path does.
 */
export interface AbilityVaultDeps {
  world(): IWorld;
  gameTime(): number;
  worldLevelHealthMult(): number;
  worldLevelDamageMult(): number;
  holdsAbility(abilityId: string): boolean;
  noteAbilityClaimed(abilityId: string): void;
  createEnemy(
    x: number,
    y: number,
    enemyType: EnemyTypeDefinition,
    scaledStats: { health: number; speed: number; damage: number },
  ): number;
  applyDampedAffixStats(entityId: number, affix: EnemyAffixType): void;
  createGuardHealthBar(entityId: number, name: string): void;
  /** Silent guard removal. Stays in the scene: it is ECS + sprite teardown shared with the
   *  scene's other despawn paths, and moving it would drag four visual managers and the live
   *  enemy counter into the POI layer. */
  despawnGuard(entityId: number): void;
  playDeathBurst(x: number, y: number, color: number): void;
  showDamageNumber(x: number, y: number, text: string, color: number): void;
  playLevelUp(): void;
  playPurchase(): void;
  showToast(config: ToastConfig): void;
  announceNewRoutes(gainedId: string, sourceName: string, icon: string): void;
  recordExpeditionQuest(event: QuestEvent): void;
}

/**
 * Ability vaults (expedition only): the walk-in claim sites for traversal abilities. Rebuilt when
 * the ship changes sector, keyed the way the radar's sector underlay is keyed.
 */
export class AbilityVaultManager implements FieldPoiManager {
  private vaults: ActiveAbilityVault[] = [];
  private sectorKey: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: AbilityVaultDeps,
  ) {}

  /** Live radar contacts. The array is the manager's own — read it, never mutate it. */
  contacts(): ReadonlyArray<FieldPoiContact> {
    return this.vaults;
  }

  /**
   * Ability vaults for the sector the ship is in. Rebuilt only when that sector changes, so the
   * common frame does no work. A vault is spawned only for an ability this profile does not
   * already own: ownership is the single source of truth for a spent vault, so there is no second
   * collected-ids list to disagree with it.
   */
  sync(map: WorldMap, playerX: number, playerY: number): void {
    const key = `${Math.floor(playerX / SECTOR_WIDTH)},${Math.floor(playerY / SECTOR_HEIGHT)}`;
    if (key === this.sectorKey) return;
    this.sectorKey = key;
    this.destroyVaults();

    const sector = map.sectors.get(key);
    if (!sector) return;
    for (const slot of sector.poiSlots) {
      if (slot.kind !== PoiKind.AbilityPowerUp) continue;
      const abilityId = slot.grantsAbilityId;
      if (!abilityId || this.deps.holdsAbility(abilityId)) continue;
      this.addVault(
        slot.id, abilityId,
        sector.sx * SECTOR_WIDTH + slot.tileX * TILE_SIZE + TILE_SIZE / 2,
        sector.sy * SECTOR_HEIGHT + slot.tileY * TILE_SIZE + TILE_SIZE / 2,
      );
    }
  }

  /** Pulse and walk-in test. Iterated backwards because a claim splices the entry out. */
  update(playerX: number, playerY: number): void {
    if (this.vaults.length === 0) return;
    const pulse = 1 + Math.sin(this.deps.gameTime() * 2.4) * 0.14;
    const world = this.deps.world();
    for (let i = this.vaults.length - 1; i >= 0; i--) {
      const vault = this.vaults[i];
      vault.graphics.setScale(pulse);
      const dx = playerX - vault.x;
      const dy = playerY - vault.y;
      const distanceSq = dx * dx + dy * dy;

      if (vault.guarded) {
        vault.guardEntityIds = vault.guardEntityIds.filter(entityId =>
          hasComponent(world, VaultGuardTag, entityId)
          && hasComponent(world, EnemyTag, entityId));
        if (vault.guardEntityIds.length === 0) {
          this.unsealVault(vault);
        } else if (!vault.noticed
          && distanceSq < VAULT_GUARD_NOTICE_RADIUS * VAULT_GUARD_NOTICE_RADIUS) {
          this.noticeGuardedVault(vault);
        }
        continue;
      }

      if (distanceSq < VAULT_CLAIM_RADIUS * VAULT_CLAIM_RADIUS) this.claimVault(i);
    }
  }

  clear(): void {
    this.destroyVaults();
    this.sectorKey = null;
  }

  private addVault(poiId: string, abilityId: string, x: number, y: number): void {
    const graphics = this.scene.add.graphics();
    graphics.setPosition(x, y);
    graphics.setDepth(4);
    const vault: ActiveAbilityVault = {
      poiId, abilityId, graphics, x, y,
      guarded: false, guardEntityIds: [], noticed: false,
    };
    this.vaults.push(vault);

    if (!getDiscoveryManager().isVaultGuardCleared(poiId)) {
      this.spawnVaultGuards(vault, abilityId);
    }
    // A pack that produced no entity (an unknown type id) leaves the core claimable rather
    // than permanently sealed: the failure mode of a placed encounter must be open, not locked.
    vault.guarded = vault.guardEntityIds.length > 0;
    graphics.setAlpha(vault.guarded ? 0.55 : 1);
    drawAbilityVault(
      graphics,
      vault.guarded ? WORLD_GEOMETRY_COLORS.hazard.stroke : WORLD_GEOMETRY_COLORS.gate.stroke,
    );
  }

  /**
   * A vault's pack, standing in an even ring around the core. Every member is forced to the
   * same elite affix rather than rolled, so a guard is never a plain trash spawn and the
   * encounter is identical on every visit. createEnemy runs freeSpotNear, so a ring point
   * inside rock is shoved to open floor instead of spawning a mover in a wall.
   */
  private spawnVaultGuards(vault: ActiveAbilityVault, abilityId: string): void {
    const definition = getTraversalAbility(abilityId);
    if (!definition) return;
    const pack = VAULT_GUARD_PACKS[definition.guardTier];
    const total = pack.reduce((sum, member) => sum + member.count, 0);
    if (total === 0) return;

    let placed = 0;
    for (const member of pack) {
      const enemyType = getEnemyType(member.typeId);
      if (!enemyType) continue;
      for (let index = 0; index < member.count; index++) {
        const angle = (Math.PI * 2 * placed) / total - Math.PI / 2;
        placed++;
        const scaledStats = getScaledStats(
          enemyType,
          this.deps.gameTime(),
          this.deps.worldLevelHealthMult(),
          this.deps.worldLevelDamageMult(),
        );
        const entityId = this.deps.createEnemy(
          vault.x + Math.cos(angle) * VAULT_GUARD_RING_RADIUS,
          vault.y + Math.sin(angle) * VAULT_GUARD_RING_RADIUS,
          enemyType, scaledStats,
        );
        addComponent(this.deps.world(), VaultGuardTag, entityId);
        this.deps.applyDampedAffixStats(entityId, VAULT_GUARD_AFFIX);
        if (enemyType.xpValue >= 30) {
          this.deps.createGuardHealthBar(entityId, enemyType.name);
        }
        vault.guardEntityIds.push(entityId);
      }
    }
  }

  private claimVault(index: number): void {
    const vault = this.vaults[index];
    const definition = getTraversalAbility(vault.abilityId);
    claimTraversalAbility(vault.abilityId);
    this.deps.noteAbilityClaimed(vault.abilityId);
    getDiscoveryManager().markPoiCollected(vault.poiId);

    vault.graphics.destroy();
    this.vaults.splice(index, 1);

    const color = WORLD_GEOMETRY_COLORS.gate.stroke;
    this.deps.playDeathBurst(vault.x, vault.y, color);
    this.scene.cameras.main.shake(160, 0.006);
    this.deps.playLevelUp();
    if (definition) {
      // Only an ability whose description names a system that exists may print it: the rest
      // still open doors and nothing more, and a toast must not promise what it cannot pay.
      this.deps.showToast({
        tier: 'rare',
        title: `${definition.name.toUpperCase()} ACQUIRED`,
        description: IMPLEMENTED_TRAVERSAL_ABILITY_IDS.has(definition.id)
          ? definition.description
          : 'Doors keyed to it now open as you approach.',
        icon: definition.icon,
        color,
        duration: 3600,
      });
    }
    this.deps.announceNewRoutes(
      vault.abilityId, definition?.name ?? 'the new system', definition?.icon ?? 'bolt',
    );
    this.deps.recordExpeditionQuest({ kind: 'claimAbility', abilityId: vault.abilityId });
  }

  private noticeGuardedVault(vault: ActiveAbilityVault): void {
    vault.noticed = true;
    const color = WORLD_GEOMETRY_COLORS.hazard.stroke;
    this.deps.showDamageNumber(vault.x, vault.y - 26, 'GUARDED', color);
    const definition = getTraversalAbility(vault.abilityId);
    this.deps.showToast({
      tier: 'ambient',
      title: 'VAULT GUARDED',
      description: definition
        ? `${definition.name} stays sealed until its guard falls.`
        : 'The core stays sealed until its guard falls.',
      icon: 'skull',
      color,
      duration: 3200,
    });
  }

  /** The last guard fell: the core drops to its own violet and the shipped walk-in claim takes
   *  over on the next frame. The cleared flag is written here, not at the claim, because a
   *  player who wins the fight and dies on the way to the core has already paid the price. */
  private unsealVault(vault: ActiveAbilityVault): void {
    vault.guarded = false;
    getDiscoveryManager().markVaultGuardCleared(vault.poiId);

    const color = WORLD_GEOMETRY_COLORS.gate.stroke;
    vault.graphics.setAlpha(1);
    drawAbilityVault(vault.graphics, color);
    this.deps.playDeathBurst(vault.x, vault.y, color);
    if (!getSettingsManager().isReducedMotionEnabled()) this.scene.cameras.main.shake(180, 0.007);
    this.deps.playPurchase();
    this.deps.showToast({
      tier: 'ambient',
      title: 'VAULT UNSEALED',
      description: 'The core is exposed. Fly into it to claim.',
      icon: 'bolt',
      color,
      duration: 3000,
    });
  }

  private destroyVaults(): void {
    for (const vault of this.vaults) {
      for (const entityId of vault.guardEntityIds) this.deps.despawnGuard(entityId);
      vault.graphics.destroy();
    }
    this.vaults = [];
  }
}

/** A caged core in the gate's own violet, so the vault and the doors it opens read as one
 *  system without inventing a second palette. A guarded core takes hazard orange instead. */
function drawAbilityVault(graphics: Phaser.GameObjects.Graphics, color: number): void {
  graphics.clear();
  graphics.fillStyle(color, 0.18);
  graphics.fillCircle(0, 0, 30);
  graphics.lineStyle(3, color, 0.95);
  graphics.strokeCircle(0, 0, 22);
  const cage: Phaser.Geom.Point[] = [];
  for (let corner = 0; corner < 6; corner++) {
    const angle = (Math.PI / 3) * corner - Math.PI / 2;
    cage.push(new Phaser.Geom.Point(Math.cos(angle) * 13, Math.sin(angle) * 13));
  }
  graphics.strokePoints(cage, true);
  graphics.fillStyle(0xffffff, 0.9);
  graphics.fillCircle(0, 0, 5);
}
