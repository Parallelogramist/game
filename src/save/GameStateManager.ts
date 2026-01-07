/**
 * GameStateManager - Handles saving and loading game state for page reload recovery.
 *
 * Uses encrypted localStorage to persist game state, allowing players to resume
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
} from '../ecs/components';
import { PlayerStats } from '../data/Upgrades';
import { EnemyAIType, getTypeIdFromAIType } from '../enemies/EnemyTypes';

// Storage key and version
const STORAGE_KEY = 'survivor-game-state';
const SAVE_VERSION = 1;

// Serialized entity types
type EntityTag = 'player' | 'enemy' | 'xpGem' | 'healthPickup' | 'magnetPickup';

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
}

/**
 * Serialized weapon data.
 */
interface SerializedWeapon {
  id: string;
  level: number;
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

// Define queries for serialization
const playerQuery = defineQuery([PlayerTag, Transform]);
const enemyQuery = defineQuery([EnemyTag, Transform]);
const xpGemQuery = defineQuery([XPGemTag, Transform]);
const healthPickupQuery = defineQuery([HealthPickupTag, Transform]);
const magnetPickupQuery = defineQuery([MagnetPickupTag, Transform]);

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
   * Check if a valid save exists.
   */
  hasSave(): boolean {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as GameSaveState;
        return parsed.version !== undefined && parsed.version <= SAVE_VERSION;
      }
    } catch {
      // Invalid or corrupted save
    }
    return false;
  }

  /**
   * Get save metadata for menu display.
   */
  getSaveInfo(): SaveInfo {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as GameSaveState;
        if (parsed.version !== undefined && parsed.version <= SAVE_VERSION) {
          return {
            exists: true,
            gameTime: parsed.gameTime,
            level: parsed.playerStats?.level,
            worldLevel: parsed.worldLevel,
            timestamp: parsed.timestamp,
          };
        }
      }
    } catch {
      // Invalid save
    }
    return { exists: false };
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
    minibossSpawnTimes: MinibossSpawnTime[];
    banishedUpgradeIds: Set<string>;
    isAutoBuyEnabled: boolean;
    worldLevel: number;
    worldLevelHealthMult: number;
    worldLevelDamageMult: number;
    worldLevelSpawnReduction: number;
    worldLevelXPMult: number;
    weapons: { id: string; level: number }[];
    upgrades: { id: string; currentLevel: number }[];
    twinLinks: [number, number][];
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
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as GameSaveState;
        if (parsed.version !== undefined && parsed.version <= SAVE_VERSION) {
          return this.migrateState(parsed);
        }
      }
    } catch (error) {
      console.warn('Could not load game state from storage:', error);
    }
    return null;
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
   * Serialize all ECS entities to JSON-compatible format.
   */
  private serializeEntities(world: IWorld, _playerId: number): SerializedEntity[] {
    const entities: SerializedEntity[] = [];

    // Serialize player
    const players = playerQuery(world);
    for (const entityId of players) {
      entities.push(this.serializePlayer(world, entityId));
    }

    // Serialize enemies
    const enemies = enemyQuery(world);
    for (const entityId of enemies) {
      entities.push(this.serializeEnemy(world, entityId));
    }

    // Serialize XP gems
    const xpGems = xpGemQuery(world);
    for (const entityId of xpGems) {
      entities.push(this.serializeXPGem(world, entityId));
    }

    // Serialize health pickups
    const healthPickups = healthPickupQuery(world);
    for (const entityId of healthPickups) {
      entities.push(this.serializeHealthPickup(world, entityId));
    }

    // Serialize magnet pickups
    const magnetPickups = magnetPickupQuery(world);
    for (const entityId of magnetPickups) {
      entities.push(this.serializeMagnetPickup(world, entityId));
    }

    return entities;
  }

  /**
   * Serialize player entity.
   */
  private serializePlayer(_world: IWorld, entityId: number): SerializedEntity {
    return {
      tag: 'player',
      transform: {
        x: Transform.x[entityId],
        y: Transform.y[entityId],
        rotation: Transform.rotation[entityId],
      },
      velocity: {
        x: Velocity.x[entityId],
        y: Velocity.y[entityId],
        speed: Velocity.speed[entityId],
      },
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
      transform: {
        x: Transform.x[entityId],
        y: Transform.y[entityId],
        rotation: Transform.rotation[entityId],
      },
      velocity: {
        x: Velocity.x[entityId],
        y: Velocity.y[entityId],
        speed: Velocity.speed[entityId],
      },
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
      },
    };

    // Add status effects if present
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
      transform: {
        x: Transform.x[entityId],
        y: Transform.y[entityId],
        rotation: Transform.rotation[entityId],
      },
      velocity: {
        x: Velocity.x[entityId],
        y: Velocity.y[entityId],
        speed: Velocity.speed[entityId],
      },
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
      transform: {
        x: Transform.x[entityId],
        y: Transform.y[entityId],
        rotation: Transform.rotation[entityId],
      },
      velocity: {
        x: Velocity.x[entityId],
        y: Velocity.y[entityId],
        speed: Velocity.speed[entityId],
      },
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
      transform: {
        x: Transform.x[entityId],
        y: Transform.y[entityId],
        rotation: Transform.rotation[entityId],
      },
      velocity: {
        x: Velocity.x[entityId],
        y: Velocity.y[entityId],
        speed: Velocity.speed[entityId],
      },
      magnetPickupData: {
        magnetized: MagnetPickup.magnetized[entityId],
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
