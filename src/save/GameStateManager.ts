/**
 * GameStateManager - Handles saving and loading game state for page reload recovery.
 *
 * Uses SecureStorage to persist game state, allowing players to resume
 * their game after accidental page reloads. Follows the singleton pattern similar to
 * MetaProgressionManager.
 */

import { IWorld, defineQuery, hasComponent } from 'bitecs';
import { SecureStorage } from '../storage';
import {
  Transform,
  Velocity,
  Health,
  PlayerTag,
  EnemyTag,
  XPGemTag,
  HealthPickupTag,
  MagnetPickupTag,
  EnemyAI,
  EnemyType,
  Knockback,
  StatusEffect,
  XPGem,
  HealthPickup,
  MagnetPickup,
  Destructible,
  EnemyAffix,
  Consumable,
  ConsumablePickupTag,
} from '../ecs/components';
import { PlayerStats } from '../data/Upgrades';
import { EnemyAIType, getTypeIdFromAIType } from '../enemies/EnemyTypes';
import { DirectorState } from '../systems/DirectorSystem';
import type { SerializedTimedStatBuff } from '../systems/TimedStatBuffs';
// Type-only import — HazardZoneSystem imports Phaser at runtime, but a type
// import is erased at compile time, keeping the save layer Phaser-free.
import type { SerializedHazardState } from '../systems/HazardZoneSystem';

// Storage key and version
const STORAGE_KEY = 'survivor-game-state';
const SAVE_VERSION = 1;

// Serialized entity types
type EntityTag = 'player' | 'enemy' | 'xpGem' | 'healthPickup' | 'magnetPickup' | 'consumable';

/**
 * Serialized transform data.
 */
interface SerializedTransform {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Serialized velocity data.
 */
interface SerializedVelocity {
  x: number;
  y: number;
  speed: number;
}

/**
 * Serialized health data.
 */
interface SerializedHealth {
  current: number;
  max: number;
}

/**
 * Serialized knockback data.
 */
interface SerializedKnockback {
  velocityX: number;
  velocityY: number;
  decay: number;
}

/**
 * Serialized status effect data.
 */
interface SerializedStatusEffect {
  burnDamage: number;
  burnDuration: number;
  burnTickTimer: number;
  freezeMultiplier: number;
  freezeDuration: number;
  poisonStacks: number;
  poisonDuration: number;
  poisonTickTimer: number;
  chainImmunity: number;
}

/**
 * Serialized enemy-specific data.
 */
interface SerializedEnemyData {
  typeId: string;
  aiType: number;
  state: number;
  timer: number;
  targetX: number;
  targetY: number;
  shootTimer: number;
  specialTimer: number;
  phase: number;
  xpValue: number;
  flags: number;
  baseDamage: number;
  baseHealth: number;
  size: number;
  shieldCurrent: number;
  shieldMax: number;
  shieldRegenTimer: number;
  // Elite affix type (EnemyAffixType). Optional for backward-compat with saves
  // written before affix persistence existed — absent/0 means "no affix".
  affixType?: number;
}

/**
 * Serialized XP gem data.
 */
interface SerializedXPGemData {
  value: number;
  magnetized: number;
}

/**
 * Serialized health pickup data.
 */
interface SerializedHealthPickupData {
  healAmount: number;
  magnetized: number;
}

/**
 * Serialized magnet pickup data.
 */
interface SerializedMagnetPickupData {
  magnetized: number;
}

/**
 * Serialized floor-consumable data (bomb/freeze/vacuum/gold cache).
 */
interface SerializedConsumableData {
  // ConsumableKind enum value (see ConsumablePickupSystem).
  kind: number;
  // GOLD payload amount; 0 for the effect kinds.
  value: number;
  // Whether the pickup was already homing toward the player.
  magnetized: number;
}

/**
 * Serialized entity with all possible component data.
 */
interface SerializedEntity {
  tag: EntityTag;
  transform: SerializedTransform;
  velocity?: SerializedVelocity;
  health?: SerializedHealth;
  knockback?: SerializedKnockback;
  statusEffect?: SerializedStatusEffect;
  enemyData?: SerializedEnemyData;
  xpGemData?: SerializedXPGemData;
  healthPickupData?: SerializedHealthPickupData;
  magnetPickupData?: SerializedMagnetPickupData;
  consumableData?: SerializedConsumableData;
}

/**
 * Serialized weapon data.
 */
interface SerializedWeapon {
  id: string;
  level: number;
  // Whether this weapon has evolved to its super-form. Persisted so a mid-run
  // refresh keeps the evolution instead of reverting to the base weapon. The
  // evolved name + permanent base-stat multipliers are re-derived from the
  // WeaponEvolutions recipe by id on restore (not serialized), keeping the save
  // small and the recipe the single source of truth — mirrors how restored
  // elite affixes re-derive their stats from the affix def. Absent on legacy
  // saves → treated as not evolved.
  evolved?: boolean;
}

/**
 * Serialized upgrade data.
 */
interface SerializedUpgrade {
  id: string;
  currentLevel: number;
}

/**
 * Miniboss spawn tracking data.
 */
interface MinibossSpawnTime {
  typeId: string;
  time: number;
  spawned: boolean;
}

/**
 * Serialized in-run bounty state. `kind` mirrors GameScene's `BountyKind`
 * ('kills' | 'elites' | 'flawless') but is typed as a plain string here to keep
 * the save layer decoupled from the scene; GameScene casts it back on restore.
 */
interface SerializedBountyState {
  bounty: { kind: string; target: number; progress: number; timeLeft: number } | null;
  cooldown: number;
  flawlessBroken: boolean;
}

/**
 * Serialized field-shrine state. `type` mirrors GameScene's `ShrineType`
 * ('cleanse' | 'power' | 'fortune' | 'sacrifice') but is typed as a plain string
 * here to keep the save layer decoupled from the scene; GameScene casts it back
 * (and validates against SHRINE_DEFS) on restore. `spawnTimer` carries the
 * inter-shrine spawn pacing so a refresh doesn't restart the spawn clock.
 */
interface SerializedShrineState {
  shrines: { type: string; x: number; y: number }[];
  spawnTimer: number;
}

/**
 * Serialized on-field treasure chest. Chests are GameScene-owned Phaser graphics
 * (the pattern shrines/bounties mirror) and were the last walk-in reward NOT
 * persisted — a mid-run refresh despawned any uncollected chest, losing its XP
 * burst and (35%/100%) relic. `x`/`y` are the chest's live position (it drifts
 * toward the player via the chest-drone); `isSpecial` is the rare 3x-reward flag.
 */
interface SerializedChestEntry {
  x: number;
  y: number;
  isSpecial: boolean;
}

/**
 * Complete game save state.
 */
export interface GameSaveState {
  version: number;
  timestamp: number;

  // Game progress
  gameTime: number;
  killCount: number;
  enemyCount: number;

  // Timers
  spawnTimer: number;
  spawnInterval: number;
  magnetSpawnTimer: number;
  treasureSpawnTimer: number;
  gemMagnetTimer: number;
  dashCooldownTimer: number;

  // Spawn tracking
  bossSpawned: boolean;
  bossWarningPhase?: number;
  comboState?: { comboCount: number; comboDecayTimer: number; highestCombo: number };
  // Ultimate ("Overdrive") charge, 0..MAX. Optional → legacy saves (written
  // before the ultimate ability) restore with an empty meter.
  ultimateCharge?: number;
  // `activeEvent` carries the currently-running timed event (id + remaining
  // time) so a mid-event refresh keeps the rest of the boon instead of dropping
  // it. Optional → legacy saves (written before active-event persistence) load
  // with no active event restored. The event def is re-derived from EventSystem's
  // pool by id (not serialised), keeping the save small and the pool authoritative.
  eventState?: {
    eventTimer: number;
    nextEventInterval: number;
    lastEventId: string;
    activeEvent?: { id: string; remainingTime: number } | null;
  };
  minibossSpawnTimes: MinibossSpawnTime[];

  // Player state
  playerStats: PlayerStats;
  banishedUpgradeIds: string[];
  isAutoBuyEnabled: boolean;

  // Player combat state
  damageCooldown: number;

  // World level (for display)
  worldLevel: number;

  // World level multipliers
  worldLevelHealthMult: number;
  worldLevelDamageMult: number;
  worldLevelSpawnReduction: number;
  worldLevelXPMult: number;

  // Weapons
  weapons: SerializedWeapon[];

  // Upgrades (stat upgrades like Might, Haste, etc.)
  upgrades: SerializedUpgrade[];

  // All ECS entities
  entities: SerializedEntity[];

  // Twin links (for Necromancer twins)
  twinLinks: [number, number][];

  // Run modifiers (IDs of active modifiers)
  modifierIds?: string[];

  // Stage/biome selected for this run — needed to restore visuals + enemy scaling.
  stageId?: string;

  // Equipped relics — so restoring mid-run shows inventory in the HUD strip
  // and keeps the inventory cap honored on subsequent drops.
  relicIds?: string[];

  // Director credit-budget state — preserves mid-run strategy + credit balance
  // so a reload doesn't re-roll the strategy or reset spawn economy.
  directorState?: DirectorState;

  // Active temporary timed stat buffs (Power Surge damage / Elite Surge XP /
  // Golden Tide gem value / Power shrine damage). `expiresAt` is an absolute run
  // `gameTime`; since gameTime is restored verbatim, each buff reverts at the
  // right moment after a refresh instead of sticking forever. `stat` is optional
  // for legacy saves written when this list was damage-only (restore defaults it
  // to damageMultiplier). Key kept as `timedDamageBuffs` for save back-compat.
  timedDamageBuffs?: SerializedTimedStatBuff[];

  // In-run bounty objective (rotating goal + reward) — `bounty` holds the live
  // objective or null during the inter-bounty cooldown; `cooldown`/`flawlessBroken`
  // carry the pacing + flawless-failure flag. Persisted so a mid-bounty refresh
  // keeps the player's progress instead of wiping it and restarting the timer.
  // Absent on legacy saves → no bounty restored (resetInRunFeatureState wins).
  bountyState?: SerializedBountyState;

  // On-field walk-in shrines (Cleanse/Power/Fortune/Sacrifice) + their spawn
  // timer. GameScene-owned and cleared by resetInRunFeatureState on restore, so
  // a mid-run refresh would otherwise despawn any placed shrines and restart the
  // spawn clock. Persisted so the altars + pacing survive refresh-recovery.
  // Absent on legacy saves → no shrines restored (resetInRunFeatureState wins).
  shrineState?: SerializedShrineState;

  // On-field treasure chests (uncollected XP/relic caches) + their live
  // positions and the rare "special" flag. GameScene-owned Phaser graphics
  // cleared by resetInRunFeatureState on restore, so a mid-run refresh would
  // otherwise despawn them and lose the reward. Persisted so the chests survive
  // refresh-recovery. Absent on legacy saves → no chests restored.
  chestState?: SerializedChestEntry[];

  // Live hazard zones (burn/ice/void/energy) + the auto-spawner pacing.
  // Module-owned by HazardZoneSystem and wiped by resetAllRunSystems on
  // restore, so a mid-run refresh would otherwise despawn every active zone
  // and restart the hazard spawn clock. Persisted so zones + pacing survive
  // refresh-recovery. Absent on legacy saves → reset defaults win.
  hazardState?: SerializedHazardState;
}

/**
 * Save info for menu display.
 */
export interface SaveInfo {
  exists: boolean;
  gameTime?: number;
  level?: number;
  worldLevel?: number;
  timestamp?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural validation for a parsed save. A save can pass the version check yet
 * still be corrupt — a quota-truncated write, NaN coordinates, a missing entity
 * array — and restoring such a save crashes the GameScene restore path, leaving
 * the player unable to start a run at all. We reject corrupt saves here so the
 * caller falls back to a clean fresh start instead of a broken restore.
 *
 * Only the always-written (non-optional) fields the restore path dereferences
 * unguarded are validated. Newer optional fields (directorState, eventState,
 * relicIds, …) are guarded at their own use sites and must stay optional here so
 * legacy saves keep loading.
 */
export function isStructurallyValidSaveState(parsed: unknown): parsed is GameSaveState {
  if (!isPlainObject(parsed)) return false;

  // Version: absent, non-numeric, or from a newer save format → unsupported.
  if (!isFiniteNumber(parsed.version) || parsed.version > SAVE_VERSION) return false;

  // Core run progress, timers, and world scaling — every one drives the game
  // loop, HUD, or enemy math, and a NaN propagates silently into a broken run.
  const requiredNumbers: (keyof GameSaveState)[] = [
    'gameTime', 'killCount', 'enemyCount',
    'spawnTimer', 'spawnInterval', 'magnetSpawnTimer', 'treasureSpawnTimer',
    'gemMagnetTimer', 'dashCooldownTimer', 'damageCooldown',
    'worldLevel', 'worldLevelHealthMult', 'worldLevelDamageMult',
    'worldLevelSpawnReduction', 'worldLevelXPMult',
  ];
  for (const key of requiredNumbers) {
    if (!isFiniteNumber(parsed[key])) return false;
  }

  // Player snapshot — dereferenced field-by-field across the whole restore path
  // (health bar, HUD, combat). A null or NaN-vital playerStats is fatal.
  const playerStats = parsed.playerStats;
  if (!isPlainObject(playerStats)) return false;
  if (!isFiniteNumber(playerStats.level) ||
      !isFiniteNumber(playerStats.maxHealth) ||
      !isFiniteNumber(playerStats.currentHealth)) {
    return false;
  }

  // Collections the restore path iterates — a non-array throws on for..of/forEach.
  const requiredArrays: (keyof GameSaveState)[] = [
    'entities', 'weapons', 'upgrades', 'twinLinks',
    'minibossSpawnTimes', 'banishedUpgradeIds',
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(parsed[key])) return false;
  }

  // Each entity must carry a transform with finite coordinates — a NaN here
  // propagates into Phaser positioning + physics, corrupting the whole run.
  for (const entity of parsed.entities as unknown[]) {
    if (!isPlainObject(entity)) return false;
    const transform = entity.transform;
    if (!isPlainObject(transform)) return false;
    if (!isFiniteNumber(transform.x) ||
        !isFiniteNumber(transform.y) ||
        !isFiniteNumber(transform.rotation)) {
      return false;
    }
  }

  return true;
}

// Define queries for serialization
const playerQuery = defineQuery([PlayerTag, Transform]);
const enemyQuery = defineQuery([EnemyTag, Transform]);
const xpGemQuery = defineQuery([XPGemTag, Transform]);
const healthPickupQuery = defineQuery([HealthPickupTag, Transform]);
const magnetPickupQuery = defineQuery([MagnetPickupTag, Transform]);
const consumablePickupQuery = defineQuery([ConsumablePickupTag, Transform]);

/**
 * GameStateManager singleton for save/load operations.
 */
export class GameStateManager {
  private static instance: GameStateManager | null = null;

  private constructor() {}

  /**
   * Get the singleton instance.
   */
  static getInstance(): GameStateManager {
    if (!GameStateManager.instance) {
      GameStateManager.instance = new GameStateManager();
    }
    return GameStateManager.instance;
  }

  /**
   * Read and validate the persisted save. Returns null on missing/invalid/unsupported versions.
   */
  private readValidSaveState(warnOnError = false): GameSaveState | null {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as unknown;
      // Reject not just unsupported versions but structurally corrupt saves
      // (truncated writes, NaN coords, missing arrays) — restoring one crashes
      // the GameScene restore path. A rejected save → clean fresh start.
      if (!isStructurallyValidSaveState(parsed)) {
        if (warnOnError) console.warn('Discarding corrupt or unsupported save state.');
        return null;
      }
      return parsed;
    } catch (error) {
      if (warnOnError) console.warn('Could not load game state from storage:', error);
      return null;
    }
  }

  /**
   * Check if a valid save exists.
   */
  hasSave(): boolean {
    return this.readValidSaveState() !== null;
  }

  /**
   * Get save metadata for menu display.
   */
  getSaveInfo(): SaveInfo {
    const saveState = this.readValidSaveState();
    if (!saveState) return { exists: false };
    return {
      exists: true,
      gameTime: saveState.gameTime,
      level: saveState.playerStats?.level,
      worldLevel: saveState.worldLevel,
      timestamp: saveState.timestamp,
    };
  }

  /**
   * Save current game state.
   * @param gameData Object containing all game state to save
   */
  save(gameData: {
    world: IWorld;
    playerId: number;
    playerStats: PlayerStats;
    gameTime: number;
    killCount: number;
    enemyCount: number;
    spawnTimer: number;
    spawnInterval: number;
    magnetSpawnTimer: number;
    treasureSpawnTimer: number;
    gemMagnetTimer: number;
    dashCooldownTimer: number;
    damageCooldown: number;
    bossSpawned: boolean;
    bossWarningPhase: number;
    comboState?: { comboCount: number; comboDecayTimer: number; highestCombo: number };
    ultimateCharge?: number;
    eventState?: {
      eventTimer: number;
      nextEventInterval: number;
      lastEventId: string;
      activeEvent?: { id: string; remainingTime: number } | null;
    };
    minibossSpawnTimes: MinibossSpawnTime[];
    banishedUpgradeIds: Set<string>;
    isAutoBuyEnabled: boolean;
    worldLevel: number;
    worldLevelHealthMult: number;
    worldLevelDamageMult: number;
    worldLevelSpawnReduction: number;
    worldLevelXPMult: number;
    weapons: { id: string; level: number; evolved?: boolean }[];
    upgrades: { id: string; currentLevel: number }[];
    twinLinks: [number, number][];
    modifierIds?: string[];
    stageId?: string;
    relicIds?: string[];
    directorState?: DirectorState;
    timedDamageBuffs?: SerializedTimedStatBuff[];
    bountyState?: SerializedBountyState;
    shrineState?: SerializedShrineState;
    chestState?: SerializedChestEntry[];
    hazardState?: SerializedHazardState;
  }): void {
    try {
      const state: GameSaveState = {
        version: SAVE_VERSION,
        timestamp: Date.now(),

        // Game progress
        gameTime: gameData.gameTime,
        killCount: gameData.killCount,
        enemyCount: gameData.enemyCount,

        // Timers
        spawnTimer: gameData.spawnTimer,
        spawnInterval: gameData.spawnInterval,
        magnetSpawnTimer: gameData.magnetSpawnTimer,
        treasureSpawnTimer: gameData.treasureSpawnTimer,
        gemMagnetTimer: gameData.gemMagnetTimer,
        dashCooldownTimer: gameData.dashCooldownTimer,
        damageCooldown: gameData.damageCooldown,

        // Spawn tracking
        bossSpawned: gameData.bossSpawned,
        bossWarningPhase: gameData.bossWarningPhase,
        comboState: gameData.comboState,
        // ultimateCharge was declared + accepted but never written here, so the
        // Overdrive meter silently emptied on every refresh. Persist it now.
        ultimateCharge: gameData.ultimateCharge,
        eventState: gameData.eventState,
        minibossSpawnTimes: gameData.minibossSpawnTimes,

        // Player state
        playerStats: gameData.playerStats,
        banishedUpgradeIds: Array.from(gameData.banishedUpgradeIds),
        isAutoBuyEnabled: gameData.isAutoBuyEnabled,

        // World level
        worldLevel: gameData.worldLevel,

        // World level multipliers
        worldLevelHealthMult: gameData.worldLevelHealthMult,
        worldLevelDamageMult: gameData.worldLevelDamageMult,
        worldLevelSpawnReduction: gameData.worldLevelSpawnReduction,
        worldLevelXPMult: gameData.worldLevelXPMult,

        // Weapons
        weapons: gameData.weapons,

        // Upgrades
        upgrades: gameData.upgrades,

        // Entities
        entities: this.serializeEntities(gameData.world, gameData.playerId),

        // Twin links
        twinLinks: gameData.twinLinks,

        // Run modifiers
        modifierIds: gameData.modifierIds,

        // Stage + relics
        stageId: gameData.stageId,
        relicIds: gameData.relicIds,
        directorState: gameData.directorState,
        timedDamageBuffs: gameData.timedDamageBuffs,
        bountyState: gameData.bountyState,
        shrineState: gameData.shrineState,
        chestState: gameData.chestState,
        hazardState: gameData.hazardState,
      };

      SecureStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Could not save game state to storage:', error);
    }
  }

  /**
   * Load saved game state.
   * @returns The saved state or null if no valid save exists
   */
  load(): GameSaveState | null {
    const saveState = this.readValidSaveState(true);
    return saveState ? this.migrateState(saveState) : null;
  }

  /**
   * Clear the saved game state.
   */
  clearSave(): void {
    try {
      SecureStorage.removeItem(STORAGE_KEY);
    } catch {
      console.warn('Could not clear game state from storage');
    }
  }

  /**
   * Migrate save state from older versions if needed.
   */
  private migrateState(state: GameSaveState): GameSaveState {
    // Currently no migrations needed (version 1)
    // Future migrations would be added here:
    // if (state.version === 1) { /* migrate to v2 */ state.version = 2; }
    return state;
  }

  /**
   * Read Transform component into a plain serialized object.
   */
  private readTransform(entityId: number): SerializedTransform {
    return {
      x: Transform.x[entityId],
      y: Transform.y[entityId],
      rotation: Transform.rotation[entityId],
    };
  }

  /**
   * Read Velocity component into a plain serialized object.
   */
  private readVelocity(entityId: number): SerializedVelocity {
    return {
      x: Velocity.x[entityId],
      y: Velocity.y[entityId],
      speed: Velocity.speed[entityId],
    };
  }

  /**
   * Serialize all ECS entities to JSON-compatible format.
   */
  private serializeEntities(world: IWorld, _playerId: number): SerializedEntity[] {
    const entities: SerializedEntity[] = [];
    for (const entityId of playerQuery(world)) entities.push(this.serializePlayer(world, entityId));
    for (const entityId of enemyQuery(world)) {
      // Destructibles share EnemyTag but are transient — don't persist them.
      if (hasComponent(world, Destructible, entityId)) continue;
      entities.push(this.serializeEnemy(world, entityId));
    }
    for (const entityId of xpGemQuery(world)) entities.push(this.serializeXPGem(world, entityId));
    for (const entityId of healthPickupQuery(world)) entities.push(this.serializeHealthPickup(world, entityId));
    for (const entityId of magnetPickupQuery(world)) entities.push(this.serializeMagnetPickup(world, entityId));
    for (const entityId of consumablePickupQuery(world)) entities.push(this.serializeConsumable(world, entityId));
    return entities;
  }

  /**
   * Serialize player entity.
   */
  private serializePlayer(_world: IWorld, entityId: number): SerializedEntity {
    return {
      tag: 'player',
      transform: this.readTransform(entityId),
      velocity: this.readVelocity(entityId),
      health: {
        current: Health.current[entityId],
        max: Health.max[entityId],
      },
    };
  }

  /**
   * Serialize enemy entity.
   */
  private serializeEnemy(world: IWorld, entityId: number): SerializedEntity {
    const entity: SerializedEntity = {
      tag: 'enemy',
      transform: this.readTransform(entityId),
      velocity: this.readVelocity(entityId),
      health: {
        current: Health.current[entityId],
        max: Health.max[entityId],
      },
      knockback: {
        velocityX: Knockback.velocityX[entityId],
        velocityY: Knockback.velocityY[entityId],
        decay: Knockback.decay[entityId],
      },
      enemyData: {
        typeId: getTypeIdFromAIType(EnemyAI.aiType[entityId] as EnemyAIType),
        aiType: EnemyAI.aiType[entityId],
        state: EnemyAI.state[entityId],
        timer: EnemyAI.timer[entityId],
        targetX: EnemyAI.targetX[entityId],
        targetY: EnemyAI.targetY[entityId],
        shootTimer: EnemyAI.shootTimer[entityId],
        specialTimer: EnemyAI.specialTimer[entityId],
        phase: EnemyAI.phase[entityId],
        xpValue: EnemyType.xpValue[entityId],
        flags: EnemyType.flags[entityId],
        baseDamage: EnemyType.baseDamage[entityId],
        baseHealth: EnemyType.baseHealth[entityId],
        size: EnemyType.size[entityId],
        shieldCurrent: EnemyType.shieldCurrent[entityId],
        shieldMax: EnemyType.shieldMax[entityId],
        shieldRegenTimer: EnemyType.shieldRegenTimer[entityId],
        // Elite affix (volatile/vampiric/blessed/titan/swift). Stat scaling is
        // already baked into the saved Health/EnemyType/Velocity above, so only
        // the type id needs persisting — the restore re-attaches the component
        // (which revives the ring/HP-bar visual + death/contact behaviours).
        affixType: hasComponent(world, EnemyAffix, entityId) ? EnemyAffix.affixType[entityId] : 0,
      },
    };

    if (hasComponent(world, StatusEffect, entityId)) {
      entity.statusEffect = {
        burnDamage: StatusEffect.burnDamage[entityId],
        burnDuration: StatusEffect.burnDuration[entityId],
        burnTickTimer: StatusEffect.burnTickTimer[entityId],
        freezeMultiplier: StatusEffect.freezeMultiplier[entityId],
        freezeDuration: StatusEffect.freezeDuration[entityId],
        poisonStacks: StatusEffect.poisonStacks[entityId],
        poisonDuration: StatusEffect.poisonDuration[entityId],
        poisonTickTimer: StatusEffect.poisonTickTimer[entityId],
        chainImmunity: StatusEffect.chainImmunity[entityId],
      };
    }

    return entity;
  }

  /**
   * Serialize XP gem entity.
   */
  private serializeXPGem(_world: IWorld, entityId: number): SerializedEntity {
    return {
      tag: 'xpGem',
      transform: this.readTransform(entityId),
      velocity: this.readVelocity(entityId),
      xpGemData: {
        value: XPGem.value[entityId],
        magnetized: XPGem.magnetized[entityId],
      },
    };
  }

  /**
   * Serialize health pickup entity.
   */
  private serializeHealthPickup(_world: IWorld, entityId: number): SerializedEntity {
    return {
      tag: 'healthPickup',
      transform: this.readTransform(entityId),
      velocity: this.readVelocity(entityId),
      healthPickupData: {
        healAmount: HealthPickup.healAmount[entityId],
        magnetized: HealthPickup.magnetized[entityId],
      },
    };
  }

  /**
   * Serialize magnet pickup entity.
   */
  private serializeMagnetPickup(_world: IWorld, entityId: number): SerializedEntity {
    return {
      tag: 'magnetPickup',
      transform: this.readTransform(entityId),
      velocity: this.readVelocity(entityId),
      magnetPickupData: {
        magnetized: MagnetPickup.magnetized[entityId],
      },
    };
  }

  /**
   * Serialize floor-consumable entity (bomb/freeze/vacuum/gold cache).
   */
  private serializeConsumable(_world: IWorld, entityId: number): SerializedEntity {
    return {
      tag: 'consumable',
      transform: this.readTransform(entityId),
      consumableData: {
        kind: Consumable.kind[entityId],
        value: Consumable.value[entityId],
        magnetized: Consumable.magnetized[entityId],
      },
    };
  }
}

/**
 * Get the GameStateManager singleton instance.
 */
export function getGameStateManager(): GameStateManager {
  return GameStateManager.getInstance();
}
