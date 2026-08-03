import Phaser from 'phaser';
import { getAchievementManager } from '../../achievements';
import type { ToastConfig } from '../../achievements/AchievementTypes';
import { getStageById } from '../../data/Stages';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import { SecretFlags } from '../../expedition/DiscoveryTypes';
import { getSettingsManager } from '../../settings';
import type { QuestEvent } from '../../systems/QuestProgress';
import { WORLD_GEOMETRY_COLORS } from '../../visual/NeonColors';
import { buildRegionVaults } from '../../world/secretCapstones';
import type { RegionVault } from '../../world/secretCapstones';
import { isSecretShellIntact, secretShellRingIndices } from '../../world/sectorInterior';
import { PUZZLE_RING_RADIUS, buildSecretPuzzle } from '../../world/secretPuzzles';
import type { PuzzleGlyphId, SecretPuzzle } from '../../world/secretPuzzles';
import { rollSecretReward } from '../../world/secretRewards';
import type { SecretRewardDefinition } from '../../world/secretRewards';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from '../../world/worldSpace';
import { PoiKind, TILE_SIZE } from '../../world/worldTypes';
import type { SectorDef, WorldMap } from '../../world/worldTypes';
import type { FieldPoiContact, FieldPoiManager } from './FieldPoiManager';

/** How far out a cache begins to fade in. */
const SECRET_SENSE_RADIUS = 300;
/** Inside this, an unsealed cache is claimed. */
const SECRET_CLAIM_RADIUS = 44;

/** Sigil pylons ringing a sealed cache. Draw-only, never added to physics, like the cache. */
const PUZZLE_NODE_TOUCH_RADIUS = 56;
const PUZZLE_NODE_DRAW_RADIUS = 20;
/** Clearance between the ring and the sector border, so a ring never crosses into the room
 *  next door and two pylons can never be shifted onto the same spot. */
const PUZZLE_RING_MARGIN = 60;
/** A sealed cache still fades in on the normal ramp, just dimmer: it is there, it is shut. */
const SEALED_CACHE_ALPHA = 0.5;

interface ActivePuzzleNode {
  glyphId: PuzzleGlyphId;
  sides: number;
  x: number;
  y: number;
  graphics: Phaser.GameObjects.Graphics;
  lit: boolean;
}

interface ActiveSecretPuzzle {
  definition: SecretPuzzle;
  nodes: ActivePuzzleNode[];
  /** How much of the sequence is woken. Reset to 0 by any wrong touch. */
  progress: number;
  /** Which node the ship is standing on, so holding still does not re-fire it. -1 for none. */
  occupiedNodeIndex: number;
  /** Whether the sealed-cache notice has been shown. A ring that comes back with pylons already
   *  woken starts noticed: a player looking at lit sigils knows the cache is sealed. */
  noticed: boolean;
}

interface ActiveSecretCache {
  secretId: string;
  reward: SecretRewardDefinition;
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  puzzle: ActiveSecretPuzzle | null;
  /** Set when this cache is its region's vault: it refuses the walk-in until every other
   *  cache in the region is found. Never set together with `puzzle` — a vault is ring-free
   *  by selection. */
  vault: RegionVault | null;
  /** The sealed-vault notice fires once per sector visit, the noticeSealedCache rule. */
  vaultNoticed: boolean;
  /** Set only for a walled cache. `tiles` is the live sector array a break mutates, and the
   *  indices are precomputed so the per-frame read allocates nothing. */
  shell: { tiles: Uint8Array; ringIndices: number[] } | null;
}

/**
 * The scene services a cache needs. Every member is a closure so the manager can be built before
 * the scene has finished wiring the managers behind them, which is exactly what the fresh create
 * path does.
 */
export interface SecretCacheDeps {
  gameTime(): number;
  /** Nudges a point out of rock. The scene routes it to the active world mode. */
  freeSpotNear(x: number, y: number, out: { x: number; y: number }): void;
  /** The settings-aware shake. Distinct from the raw `cameras.main.shake` the claim uses, and
   *  kept that way: this is the one the wrong-sigil fizzle has always gone through. */
  shakeCamera(duration: number, intensity: number): void;
  playDeathBurst(x: number, y: number, color?: number): void;
  showDamageNumber(x: number, y: number, text: string, color: number): void;
  playError(): void;
  playPurchase(): void;
  playLevelUp(): void;
  showToast(config: ToastConfig): void;
  /** Pays a reward id and returns the toast line. Stays in the scene: `announceHiddenSector`
   *  spends the same table at the richer hiddenSector tier, and it owns the chest, pickup and
   *  map-fragment rails the payouts spend. */
  payReward(reward: SecretRewardDefinition, x: number, y: number): string;
  /** Stays in the scene: a second caller (`announceHiddenSector`) grants the same lead. */
  grantSecretLead(sourceSecretId: string): void;
  recordExpeditionQuest(event: QuestEvent): void;
}

/**
 * Concealed caches (expedition only): the walk-in find sites for this profile's unfound secrets,
 * the AbilityVaultManager shape. Rebuilt when the ship changes sector, keyed the way the radar's
 * sector underlay is keyed. A cache carries no run-save state — the discovery store's FOUND flag
 * is the single source of truth for a spent one — so the contract's three methods are the whole
 * of it.
 */
export class SecretCacheManager implements FieldPoiManager {
  private caches: ActiveSecretCache[] = [];
  private sectorKey: string | null = null;
  /** How far into its sequence each partly-woken ring is, keyed by the cache's secret id. sync()
   *  rebuilds a sector's rings from the generator, so without this a ring you half woke and then
   *  stepped out of comes back dark. */
  private puzzleProgress = new Map<string, number>();
  /** Region vaults of the world currently being flown, keyed by the vault's own secret id.
   *  Derived from the map alone, so it is rebuilt on a world swap and never persisted. */
  private vaults = new Map<string, RegionVault>();
  private vaultWorldKey: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: SecretCacheDeps,
  ) {}

  /** Live radar contacts. The array is the manager's own — read it, never mutate it. */
  contacts(): ReadonlyArray<FieldPoiContact> {
    return this.caches;
  }

  /**
   * Concealed caches for the sector the ship is in. A cache is spawned only for a secret this
   * profile has not found: the found flag is the single source of truth for a spent cache, so
   * there is no second collected-ids list to disagree with it, and nothing about a cache needs to
   * survive into the run save.
   */
  sync(map: WorldMap, playerX: number, playerY: number): void {
    const worldKey = `${map.seed}:${map.worldGenVersion}`;
    if (worldKey !== this.vaultWorldKey) {
      this.vaultWorldKey = worldKey;
      this.vaults = buildRegionVaults(map);
    }
    const key = `${Math.floor(playerX / SECTOR_WIDTH)},${Math.floor(playerY / SECTOR_HEIGHT)}`;
    if (key === this.sectorKey) return;
    this.sectorKey = key;
    this.destroyCaches();

    const sector = map.sectors.get(key);
    if (!sector) return;
    const discovery = getDiscoveryManager();
    for (const slot of sector.poiSlots) {
      if (slot.kind !== PoiKind.Secret) continue;
      if ((discovery.getSecretFlags(slot.id) & SecretFlags.FOUND) !== 0) continue;
      const vault = this.vaults.get(slot.id) ?? null;
      const puzzle = buildSecretPuzzle({
        worldSeed: map.seed, secretId: slot.id, depth: sector.depth,
      });
      const shell = slot.sealed === true
        ? {
          tiles: sector.tiles,
          ringIndices: secretShellRingIndices(slot.tileX, slot.tileY),
        }
        : null;
      this.addCache(
        slot.id,
        rollSecretReward({
          worldSeed: map.seed, secretId: slot.id, depth: sector.depth,
          tier: vault ? 'capstone' : puzzle ? 'puzzle' : 'cache',
        }),
        sector.sx * SECTOR_WIDTH + slot.tileX * TILE_SIZE + TILE_SIZE / 2,
        sector.sy * SECTOR_HEIGHT + slot.tileY * TILE_SIZE + TILE_SIZE / 2,
        puzzle,
        sector,
        shell,
        vault,
      );
    }
  }

  /**
   * Fades a cache in on a quadratic ramp as the ship closes, so the far edge of the sense
   * radius is a hint you can miss and the last stride is unmistakable. Alpha and scale only:
   * the cache is never added to physics, so an unfound one costs nothing but a draw. A sealed
   * cache holds at half that alpha and refuses the walk-in until its ring is woken. A WALLED
   * cache draws nothing at all until its shell has a hole, because there the break IS the
   * reveal; the 44 px claim is out of reach through the wall anyway.
   */
  update(playerX: number, playerY: number): void {
    if (this.caches.length === 0) return;
    const senseRadius = SECRET_SENSE_RADIUS;
    const claimRadius = SECRET_CLAIM_RADIUS;
    const shimmer = 0.75 + Math.sin(this.deps.gameTime() * 3.1) * 0.25;
    for (let i = this.caches.length - 1; i >= 0; i--) {
      const cache = this.caches[i];
      if (cache.shell !== null
        && isSecretShellIntact(cache.shell.tiles, cache.shell.ringIndices)) {
        if (cache.graphics.alpha !== 0) cache.graphics.setAlpha(0);
        continue;
      }
      // The ring is read every frame at any distance: the pylons are the tell that a cache is
      // in this room, so unlike the cache itself they never fade out.
      if (cache.puzzle && this.updatePuzzle(cache.puzzle, playerX, playerY)) {
        this.claimCache(i);
        continue;
      }
      const dx = playerX - cache.x;
      const dy = playerY - cache.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > senseRadius * senseRadius) {
        if (cache.graphics.alpha !== 0) cache.graphics.setAlpha(0);
        continue;
      }
      const closeness = 1 - Math.sqrt(distanceSq) / senseRadius;
      // Re-read every frame, never cached at sync time: the last prerequisite can be a second
      // cache in this very room, and sync only rebuilds on a sector change.
      const vaultRemaining = cache.vault === null ? 0 : this.vaultRemaining(cache.vault);
      cache.graphics.setAlpha(closeness * closeness * shimmer
        * (cache.puzzle || vaultRemaining > 0 ? SEALED_CACHE_ALPHA : 1));
      cache.graphics.setScale(0.8 + closeness * 0.35);
      if (distanceSq < claimRadius * claimRadius) {
        if (cache.puzzle) this.noticeSealedCache(cache.puzzle);
        else if (vaultRemaining > 0) this.noticeSealedVault(cache, vaultRemaining);
        else this.claimCache(i);
      }
    }
  }

  clear(): void {
    this.destroyCaches();
    this.sectorKey = null;
    this.puzzleProgress.clear();
    this.vaults.clear();
    this.vaultWorldKey = null;
  }

  /** For `poiState.puzzles`. Only partly-woken rings are ever in the map, so this is usually
   *  empty. */
  serializePuzzleProgress(): { secretId: string; progress: number }[] {
    return Array.from(this.puzzleProgress, ([secretId, progress]) => ({ secretId, progress }));
  }

  /** One entry of `poiState.puzzles`, already sanitized by the caller: the addAmbushNest /
   *  addNemesisLair idiom. */
  restorePuzzleProgress(secretId: string, progress: number): void {
    this.puzzleProgress.set(secretId, progress);
  }

  private addCache(
    secretId: string, reward: SecretRewardDefinition, x: number, y: number,
    puzzle: SecretPuzzle | null, sector: SectorDef,
    shell: { tiles: Uint8Array; ringIndices: number[] } | null,
    vault: RegionVault | null,
  ): void {
    const graphics = this.scene.add.graphics();
    graphics.setPosition(x, y);
    drawSecretCache(graphics, vault !== null);
    graphics.setDepth(4);
    graphics.setAlpha(0);
    this.caches.push({
      secretId, reward, graphics, x, y,
      puzzle: puzzle ? this.buildActivePuzzle(puzzle, x, y, sector) : null,
      shell,
      vault,
      vaultNoticed: false,
    });
  }

  /**
   * The whole ring is SHIFTED to fit the room, never clamped pylon by pylon: clamping two
   * pylons independently can collapse them onto one spot, and a pylon you cannot reach on its
   * own is an unsolvable puzzle. freeSpotNear then keeps each one out of rock, the same nudge
   * the scene's reward pickups use.
   */
  private buildActivePuzzle(
    definition: SecretPuzzle, cacheX: number, cacheY: number, sector: SectorDef,
  ): ActiveSecretPuzzle {
    const originX = sector.sx * SECTOR_WIDTH;
    const originY = sector.sy * SECTOR_HEIGHT;
    const inset = PUZZLE_RING_RADIUS + PUZZLE_RING_MARGIN;
    const ringX = Phaser.Math.Clamp(cacheX, originX + inset, originX + SECTOR_WIDTH - inset);
    const ringY = Phaser.Math.Clamp(cacheY, originY + inset, originY + SECTOR_HEIGHT - inset);
    const spot = { x: 0, y: 0 };
    // Clamped below the full sequence: a ring restored with every pylon lit would refuse every
    // touch (a lit pylon is a no-op) and could never be solved.
    const restoredProgress = Math.min(
      this.puzzleProgress.get(definition.secretId) ?? 0,
      definition.sequence.length - 1);
    const litGlyphIds = new Set(definition.sequence.slice(0, restoredProgress));

    const nodes = definition.nodes.map(node => {
      this.deps.freeSpotNear(ringX + node.offsetX, ringY + node.offsetY, spot);
      const graphics = this.scene.add.graphics();
      graphics.setPosition(spot.x, spot.y);
      graphics.setDepth(4);
      const active: ActivePuzzleNode = {
        glyphId: node.glyphId, sides: node.sides, x: spot.x, y: spot.y, graphics,
        lit: litGlyphIds.has(node.glyphId),
      };
      drawPuzzleNode(active);
      return active;
    });

    return {
      definition, nodes, progress: restoredProgress, occupiedNodeIndex: -1,
      noticed: restoredProgress > 0,
    };
  }

  /**
   * Returns true on the frame the ring completes. Only the nearest pylon inside the touch
   * radius is considered, and only when it CHANGES: standing on a woken pylon must not
   * re-fire it, and a ring that fires every frame would fizzle itself.
   */
  private updatePuzzle(
    puzzle: ActiveSecretPuzzle, playerX: number, playerY: number,
  ): boolean {
    let nearestIndex = -1;
    let nearestDistanceSq = PUZZLE_NODE_TOUCH_RADIUS * PUZZLE_NODE_TOUCH_RADIUS;
    for (let i = 0; i < puzzle.nodes.length; i++) {
      const node = puzzle.nodes[i];
      const dx = playerX - node.x;
      const dy = playerY - node.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestIndex = i;
      }
    }
    if (nearestIndex === puzzle.occupiedNodeIndex) return false;
    puzzle.occupiedNodeIndex = nearestIndex;
    if (nearestIndex === -1) return false;
    return this.touchPuzzleNode(puzzle, nearestIndex);
  }

  /**
   * Re-touching a lit pylon is a no-op, never a fizzle: drifting back across one while lining
   * up the next is not a mistake, and on a four-pylon ring punishing it would be miserable.
   */
  private touchPuzzleNode(puzzle: ActiveSecretPuzzle, index: number): boolean {
    const node = puzzle.nodes[index];
    if (node.lit) return false;
    const reducedMotion = getSettingsManager().isReducedMotionEnabled();

    if (node.glyphId !== puzzle.definition.sequence[puzzle.progress]) {
      puzzle.progress = 0;
      this.rememberPuzzleProgress(puzzle);
      for (const other of puzzle.nodes) {
        other.lit = false;
        drawPuzzleNode(other);
      }
      this.deps.playError();
      this.deps.playDeathBurst(node.x, node.y);
      if (!reducedMotion) this.deps.shakeCamera(90, 0.003);
      return false;
    }

    node.lit = true;
    puzzle.progress++;
    this.rememberPuzzleProgress(puzzle);
    drawPuzzleNode(node);
    this.deps.playPurchase();
    if (!reducedMotion) {
      this.scene.tweens.add({
        targets: node.graphics,
        scale: { from: 1.35, to: 1 },
        duration: 220,
        ease: 'Quad.easeOut',
      });
    }
    return puzzle.progress === puzzle.definition.sequence.length;
  }

  private rememberPuzzleProgress(puzzle: ActiveSecretPuzzle): void {
    const secretId = puzzle.definition.secretId;
    if (puzzle.progress > 0) this.puzzleProgress.set(secretId, puzzle.progress);
    else this.puzzleProgress.delete(secretId);
  }

  /** A sealed cache that silently refuses the walk-in reads as a bug. Once per sector visit for an
   *  untouched ring; a ring with woken pylons starts noticed and never re-announces. */
  private noticeSealedCache(puzzle: ActiveSecretPuzzle): void {
    if (puzzle.noticed) return;
    puzzle.noticed = true;
    const sigilAnchor = puzzle.nodes[0];
    if (sigilAnchor) {
      this.deps.showDamageNumber(
        sigilAnchor.x, sigilAnchor.y - 26, 'SEALED CACHE',
        WORLD_GEOMETRY_COLORS.breakable.stroke,
      );
    }
    this.deps.showToast({
      tier: 'ambient',
      title: 'SEALED CACHE',
      description:
        `${puzzle.nodes.length} sigils ring this cache, and they wake in one order.`,
      icon: 'gear',
      color: WORLD_GEOMETRY_COLORS.breakable.stroke,
      duration: 3200,
    });
  }

  private vaultRemaining(vault: RegionVault): number {
    const discovery = getDiscoveryManager();
    let remaining = 0;
    for (const secretId of vault.prerequisiteSecretIds) {
      if ((discovery.getSecretFlags(secretId) & SecretFlags.FOUND) === 0) remaining++;
    }
    return remaining;
  }

  /** A vault that silently refuses the walk-in reads as a bug, so it names its price and the
   *  region it belongs to. Once per sector visit, the noticeSealedCache rule. */
  private noticeSealedVault(cache: ActiveSecretCache, remaining: number): void {
    if (cache.vaultNoticed) return;
    cache.vaultNoticed = true;
    const color = WORLD_GEOMETRY_COLORS.breakable.stroke;
    this.deps.showDamageNumber(cache.x, cache.y - 26, 'SEALED VAULT', color);
    const region = getStageById(cache.vault?.biomeId ?? '')?.name ?? 'this region';
    this.deps.showToast({
      tier: 'ambient',
      title: 'SEALED VAULT',
      description: remaining === 1
        ? `1 cache is still hidden in the ${region}.`
        : `${remaining} caches are still hidden in the ${region}.`,
      icon: 'gear',
      color,
      duration: 3200,
    });
  }

  /**
   * Walk-in claim, the claimVault shape. Permanent at the moment of the touch, not at
   * run end, so a death seconds later keeps the find. What it pays comes from the secret
   * reward table, which is econ-neutral by construction: no entry pays gold, and a chest
   * entry is the arena relic table at the arena rate (doc 04 econ rule 1).
   */
  private claimCache(index: number): void {
    const cache = this.caches[index];
    getDiscoveryManager().markSecretFound(cache.secretId);
    getAchievementManager().recordSecretFound();

    cache.graphics.destroy();
    cache.puzzle?.nodes.forEach(node => node.graphics.destroy());
    this.caches.splice(index, 1);
    this.puzzleProgress.delete(cache.secretId);

    const color = WORLD_GEOMETRY_COLORS.breakable.stroke;
    this.deps.playDeathBurst(cache.x, cache.y, color);
    this.scene.cameras.main.shake(140, 0.005);
    this.deps.playLevelUp();
    const description = this.deps.payReward(cache.reward, cache.x, cache.y);
    this.deps.showToast({
      tier: 'notable',
      title: cache.vault ? 'REGION VAULT OPEN'
        : cache.puzzle ? 'SEQUENCE UNSEALED' : 'HIDDEN CACHE FOUND',
      description,
      icon: cache.reward.icon,
      color,
      duration: 3200,
    });
    this.deps.recordExpeditionQuest({
      kind: 'findSecret',
      secretKind: cache.vault ? 'capstone' : cache.puzzle ? 'puzzle' : 'cache',
    });
    this.deps.grantSecretLead(cache.secretId);
  }

  private destroyCaches(): void {
    this.caches.forEach(cache => {
      cache.graphics.destroy();
      cache.puzzle?.nodes.forEach(node => node.graphics.destroy());
    });
    this.caches = [];
  }
}

/** The breakable amber rather than the vault's violet: a cache reads as terrain that is not
 *  terrain, which is the same lie a false wall tells, without inventing a third palette. A
 *  region vault carries one extra outer ring so it is distinguishable at a glance. */
function drawSecretCache(graphics: Phaser.GameObjects.Graphics, vault = false): void {
  const color = WORLD_GEOMETRY_COLORS.breakable.stroke;
  graphics.fillStyle(color, 0.14);
  graphics.fillCircle(0, 0, 26);
  if (vault) {
    graphics.lineStyle(2, color, 0.45);
    graphics.strokeCircle(0, 0, 34);
  }
  graphics.lineStyle(2, color, 0.9);
  const facets: Phaser.Geom.Point[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const angle = (Math.PI / 2) * corner - Math.PI / 2;
    facets.push(new Phaser.Geom.Point(Math.cos(angle) * 18, Math.sin(angle) * 18));
  }
  graphics.strokePoints(facets, true);
  graphics.fillStyle(0xffe8c0, 0.85);
  graphics.fillCircle(0, 0, 4);
}

/** The drawSecretCache idiom at a variable corner count, so the sigil a riddle names is
 *  legible without colour: three corners is the triangle, six is the hexagon. */
function drawPuzzleNode(node: ActivePuzzleNode): void {
  const color = WORLD_GEOMETRY_COLORS.breakable.stroke;
  const graphics = node.graphics;
  graphics.clear();
  graphics.fillStyle(color, node.lit ? 0.3 : 0.1);
  graphics.fillCircle(0, 0, PUZZLE_NODE_DRAW_RADIUS);
  graphics.lineStyle(2, color, node.lit ? 1 : 0.5);
  const corners: Phaser.Geom.Point[] = [];
  for (let corner = 0; corner < node.sides; corner++) {
    const angle = (Math.PI * 2 * corner) / node.sides - Math.PI / 2;
    corners.push(new Phaser.Geom.Point(
      Math.cos(angle) * PUZZLE_NODE_DRAW_RADIUS,
      Math.sin(angle) * PUZZLE_NODE_DRAW_RADIUS,
    ));
  }
  graphics.strokePoints(corners, true);
  if (node.lit) {
    graphics.fillStyle(0xffe8c0, 0.9);
    graphics.fillCircle(0, 0, 4);
  }
}
