import Phaser from 'phaser';
import { createWorld, addEntity, addComponent, removeEntity, IWorld, defineQuery, hasComponent } from 'bitecs';
import {
  Transform,
  Velocity,
  Health,
  Weapon,
  PlayerTag,
  EnemyTag,
  SpriteRef,
  Knockback,
  EnemyAI,
  EnemyType,
  EnemyFlags,
  StatusEffect,
} from '../../ecs/components';
import { inputSystem } from '../../ecs/systems/InputSystem';
import { InputController } from '../managers/InputController';
import { movementSystem, clampPlayerToScreen } from '../../ecs/systems/MovementSystem';
import { enemyAISystem } from '../../ecs/systems/EnemyAISystem';
import { setEnemyProjectileCallback, setMinionSpawnCallback, setXPGemCallbacks, recordEnemyDeath, linkTwins, unlinkTwin, setBossCallbacks, resetEnemyAISystem, resetBossCallbacks, getAllTwinLinks, setEnemyAIBounds, updateAIGameTime } from '../../ecs/systems/enemy-ai/state';
import { resetWeaponSystem } from '../../ecs/systems/WeaponSystem';
import { resetCollisionSystem, setCombatStats } from '../../ecs/systems/CollisionSystem';
import { statusEffectSystem, setStatusEffectSystemEffectsManager, setStatusEffectSystemDeathCallback, setStatusEffectDamageCallback, applyPoison, resetStatusEffectSystem } from '../../ecs/systems/StatusEffectSystem';
import { getRandomEnemyType, getScaledStats, getEnemyType, EnemyTypeDefinition, EnemyAIType } from '../../enemies/EnemyTypes';
import { spriteSystem, registerSprite, getSprite, unregisterSprite, resetSpriteSystem } from '../../ecs/systems/SpriteSystem';
import { xpGemSystem, spawnXPGem, setXPGemSystemScene, setXPCollectCallback, setXPGemEffectsManager, setXPGemSoundManager, setXPGemMagnetRange, setXPGemWorldReference, getXPGemPositions, consumeXPGem, resetXPGemSystem, magnetizeAllGems } from '../../ecs/systems/XPGemSystem';
import { healthPickupSystem, spawnHealthPickup, setHealthPickupSystemScene, setHealthCollectCallback, setHealthPickupEffectsManager, setHealthPickupSoundManager, setHealthPickupMagnetRange, resetHealthPickupSystem } from '../../ecs/systems/HealthPickupSystem';
import { magnetPickupSystem, spawnMagnetPickup, setMagnetPickupSystemScene, setMagnetPickupEffectsManager, setMagnetPickupSoundManager, resetMagnetPickupSystem } from '../../ecs/systems/MagnetPickupSystem';
import { PlayerStats, createDefaultPlayerStats, calculateXPForLevel, Upgrade, createUpgrades, CombinedUpgrade, getRandomCombinedUpgrades } from '../../data/Upgrades';
import { EffectsManager } from '../../effects/EffectsManager';
import { SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { WeaponManager, createWeapon, ProjectileWeapon } from '../../weapons';
import { toNeonPair, PLAYER_NEON, ENEMY_COLORS } from '../../visual/NeonColors';
import { createGlowingShape, VisualQuality } from '../../visual/GlowGraphics';
import { PlayerPlasmaCore } from '../../visual/PlayerPlasmaCore';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import { DeathRippleManager } from '../../visual/DeathRippleManager';
import { MasteryVisualsManager } from '../../visual/MasteryVisuals';
import { ShieldBarrierVisual } from '../../visual/ShieldBarrierVisual';
import { getGameStateManager, GameSaveState } from '../../save/GameStateManager';
import { getSettingsManager } from '../../settings';
import { SecureStorage } from '../../storage';
import { updateFrameCache, resetFrameCache, getEnemyIds as getFrameCacheEnemyIds } from '../../ecs/FrameCache';
import { resetEnemySpatialHash } from '../../utils/SpatialHash';
import { getAchievementManager, AchievementDefinition, MilestoneDefinition, MilestoneReward } from '../../achievements';
import { getToastManager, ToastManager } from '../../ui';
import { getCodexManager } from '../../codex';
import { resetComboSystem, recordComboKill, updateComboSystem, getComboCount, getHighestCombo, getComboTier, getComboDecayPercent, getComboBuffDamageMultiplier, getComboState, restoreComboState } from '../../systems/ComboSystem';
import { resetEventSystem, updateEventSystem, setSuppressEvents, getEventState, restoreEventState, getActiveEvent, RunEvent } from '../../systems/EventSystem';
import { TUNING, STORAGE_KEY_AUTO_BUY } from '../../data/GameTuning';
import { HUDManager, UpgradeIconData } from '../managers/HUDManager';
import { PauseMenuManager } from '../managers/PauseMenuManager';

// Module-level queries (defined once, not per-frame)
const enemyQueryForCollision = defineQuery([Transform, EnemyTag]);
const knockbackEnemyQuery = defineQuery([Transform, Knockback, EnemyTag]);

const PAUSE_MENU_DEPTH = 1100; // Shared depth constant for overlay rendering

/**
 * GameScene is the main gameplay scene.
 * Manages the ECS world, player, enemies, and game loop.
 */
export class GameScene extends Phaser.Scene {
  // ECS World
  private world!: IWorld;

  // Input (keyboard, mouse, joystick, dash)
  private inputController!: InputController;

  // Player reference
  private playerId: number = -1;

  // Spawn timer
  private spawnTimer: number = 0;
  private spawnInterval: number = TUNING.spawn.baseInterval;

  // Game time
  private gameTime: number = 0;

  // Enemy count (for difficulty scaling)
  private enemyCount: number = 0;
  private maxEnemies: number = TUNING.spawn.maxEnemies;

  // Kill counter
  private killCount: number = 0;

  // Entity ID to enemy type ID mapping (for codex kill tracking)
  private enemyTypeMap: Map<number, string> = new Map();

  // Achievement tracking
  private toastManager!: ToastManager;
  private lastAchievementTimeCheck: number = 0; // For throttled time tracking
  private totalDamageTaken: number = 0;
  private totalDamageDealt: number = 0;

  // Player stats and upgrades
  private playerStats!: PlayerStats;
  private upgrades!: Upgrade[];
  private isPaused: boolean = false;
  private pendingLevelUps: number = 0;

  // Damage cooldown (invincibility frames)
  private damageCooldown: number = 0;

  // Emergency heal cooldown (triggered at low HP)
  private emergencyHealCooldown: number = 0;

  // Banished upgrades (removed from pool permanently for this run)
  private banishedUpgradeIds: Set<string> = new Set();

  // Gem magnet timer (auto-vacuum interval)
  private gemMagnetTimer: number = 0;

  // Treasure chest spawn timer
  private treasureSpawnTimer: number = 0;

  // Game over state
  private isGameOver: boolean = false;

  // Victory state (survived 10 minutes)
  private hasWon: boolean = false;

  // Pause menu manager (handles pause, victory, and game over screens)
  private pauseMenuManager!: PauseMenuManager;

  // ESC key handler reference for cleanup
  private escKeyHandler: (() => void) | null = null;
  private dashRequestHandler: (() => void) | null = null;

  // Health drop chance (percentage)
  private readonly HEALTH_DROP_CHANCE: number = TUNING.pickups.healthDropChance;

  // Magnet pickup spawn timing (every 60 seconds, an enemy drops a magnet)
  private magnetSpawnTimer: number = 0;
  private readonly MAGNET_SPAWN_INTERVAL: number = TUNING.pickups.magnetSpawnInterval;
  private nextEnemyDropsMagnet: boolean = false;

  // Effects and sound managers for game juice
  private effectsManager!: EffectsManager;
  private soundManager!: SoundManager;

  // Weapon system
  private weaponManager!: WeaponManager;

  // HUD management (extracted from GameScene)
  private hudManager!: HUDManager;

  // Miniboss spawn timing — typeIds are shuffled each run for variety
  private minibossSpawnTimes: { typeId: string; time: number; spawned: boolean }[] =
    TUNING.minibosses.schedule.map(entry => ({ ...entry, spawned: false }));

  // Boss cycling system - cycles through bosses each run
  private static bossOrder = [...TUNING.bosses.order];
  private static currentBossIndex = 0;
  private bossSpawnTime = TUNING.bosses.spawnTime;
  private bossSpawned = false;

  // Boss warning sequence
  private bossWarningPhase: number = 0; // 0=none, 1=stirs, 2=trembles, 3=incoming
  private bossWarningText: Phaser.GameObjects.Text | null = null;
  private bossWarningVignette: Phaser.GameObjects.Graphics | null = null;

  // Endless mode (post-victory continuation)
  private endlessModeActive = false;
  private endlessModeTime = 0;           // Time elapsed since continue was chosen
  private endlessMinibossTimer = 0;      // Countdown to next miniboss (60s intervals)
  private endlessBossTimer = 0;          // Countdown to next boss wave (600s intervals)

  // Active laser beams (for visual rendering)
  private activeLasers: { x1: number; y1: number; x2: number; y2: number; lifetime: number }[] = [];
  // Pooled graphics object for rendering lasers (avoids per-frame allocation)
  private laserGraphics: Phaser.GameObjects.Graphics | null = null;

  // World level scaling (loaded at start of run)
  private worldLevel: number = 1;
  private worldLevelHealthMult: number = 1;
  private worldLevelDamageMult: number = 1;
  private worldLevelSpawnReduction: number = 0;
  private worldLevelXPMult: number = 1;

  // Visual quality for Geometry Wars aesthetic (auto-scales based on FPS)
  private visualQuality: VisualQuality = 'high';

  // Geometry Wars style warping grid background
  private gridBackground!: GridBackground;

  // Motion trail system for player and fast enemies
  private trailManager!: TrailManager;

  // Death ripple waves propagating from enemy deaths
  private deathRippleManager!: DeathRippleManager;

  // Mastery visuals for level 10 stat upgrades
  private masteryVisualsManager!: MasteryVisualsManager;

  // Shield barrier visual (honeycomb + charge dots)
  private shieldBarrierVisual!: ShieldBarrierVisual;

  // Animated player visual (velocity-responsive plasma core)
  private playerPlasmaCore!: PlayerPlasmaCore;

  // Auto-buy feature (auto-selects upgrades on level-up without pausing)
  private isAutoBuyEnabled: boolean = false;
  private autoBuyKeyHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;

  // Health-Adaptive intelligence tracking (for auto-upgrade tier 3)
  private recentDamageTaken: number = 0; // Reset each level-up
  private isHealthStruggling: boolean = false; // True if took >50% max HP since last level

  // Game state persistence for page reload recovery
  private autoSaveTimer: number = 0;
  private readonly AUTO_SAVE_INTERVAL: number = 30; // seconds
  private beforeUnloadHandler: (() => void) | null = null;
  private shouldRestore: boolean = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  /**
   * Called before create() to receive scene data.
   * Used to detect restore mode vs fresh start.
   */
  private startingWeaponId: string = 'projectile';

  init(data?: { restore?: boolean; startingWeapon?: string }): void {
    this.shouldRestore = data?.restore === true;
    this.startingWeaponId = data?.startingWeapon || 'projectile';
  }

  create(): void {
    // Register shutdown event listener for proper cleanup on scene restart/stop
    // This is critical - Phaser doesn't automatically call shutdown() methods
    this.events.once('shutdown', this.shutdown, this);

    // Set dynamic game bounds for systems that need screen dimensions
    setEnemyAIBounds(this.scale.width, this.scale.height);

    // Listen for resize events (orientation change, Safari address bar collapse)
    this.scale.on('resize', this.handleResize, this);

    // Check for restore mode first
    if (this.shouldRestore) {
      const saveState = getGameStateManager().load();
      if (saveState) {
        this.restoreGameState(saveState);
        return;
      }
      // Fall through to normal init if load failed
      console.warn('Failed to load save state, starting fresh game');
      this.shouldRestore = false;
    }

    // Reset all ECS systems to clear state from previous runs
    // This is critical for ensuring each new game starts fresh
    resetSpriteSystem();
    resetEnemyAISystem();
    resetBossCallbacks();
    resetXPGemSystem();
    resetHealthPickupSystem();
    resetMagnetPickupSystem();
    resetWeaponSystem();
    resetCollisionSystem();
    resetStatusEffectSystem();
    resetFrameCache();
    resetEnemySpatialHash();
    resetComboSystem();
    resetEventSystem();

    // Reset all instance properties for fresh game state
    // (Class property initializers only run once on instantiation, not on scene restart)
    this.gameTime = 0;
    this.spawnTimer = 0;
    this.enemyCount = 0;
    this.killCount = 0;
    this.totalDamageTaken = 0;
    this.totalDamageDealt = 0;
    this.lastAchievementTimeCheck = 0;

    // Initialize achievement tracking for this run
    const achievementManager = getAchievementManager();
    achievementManager.startNewRun();
    this.toastManager = getToastManager(this);

    // Set up milestone completion callback to show toast notifications
    achievementManager.setMilestoneCompleteCallback(
      (milestone: MilestoneDefinition, reward: MilestoneReward) => {
        this.soundManager.playAchievementUnlock();
        this.toastManager.showMilestoneToast(
          milestone.name,
          milestone.description,
          milestone.icon,
          reward.description
        );
        // Apply milestone reward
        this.applyMilestoneReward(reward);
      }
    );

    // Set up achievement unlock callback to show toast and deliver rewards
    achievementManager.setAchievementUnlockCallback(
      (achievement: AchievementDefinition) => {
        const rewardParts: string[] = [];
        const metaMgr = getMetaProgressionManager();

        // Deliver primary reward
        if (achievement.reward.type === 'gold') {
          metaMgr.addGold(achievement.reward.value);
          rewardParts.push(achievement.reward.description);
        } else if (achievement.reward.type === 'stat_bonus' && achievement.reward.statBonusId) {
          metaMgr.addAchievementBonus(achievement.reward.statBonusId, achievement.reward.value);
          rewardParts.push(achievement.reward.description);
        }

        // Deliver bonus reward (achievements can have both gold + stat bonus)
        if (achievement.bonusReward) {
          if (achievement.bonusReward.type === 'gold') {
            metaMgr.addGold(achievement.bonusReward.value);
          } else if (achievement.bonusReward.type === 'stat_bonus' && achievement.bonusReward.statBonusId) {
            metaMgr.addAchievementBonus(achievement.bonusReward.statBonusId, achievement.bonusReward.value);
          }
          rewardParts.push(achievement.bonusReward.description);
        }

        this.soundManager.playAchievementUnlock();
        this.toastManager.showAchievementToast(
          achievement.name,
          rewardParts.join(' + '),
          achievement.icon
        );
      }
    );
    // Tutorial toast on first game start (touch-aware hint)
    if (!getSettingsManager().isTutorialSeen()) {
      const isTouchDevice = this.input.manager.touch !== null && this.sys.game.device.input.touch;
      const moveHint = isTouchDevice ? 'Touch to move. Survive!' : 'WASD or arrows to move. Survive!';
      this.time.delayedCall(2000, () => {
        this.toastManager.showToast({
          title: 'Welcome!',
          description: moveHint,
          icon: 'run',
          color: 0x44aaff,
          duration: 4000,
        });
      });
    }

    this.damageCooldown = 0;
    this.isGameOver = false;
    this.isPaused = false;
    this.hasWon = false;
    this.magnetSpawnTimer = 0;
    this.bossSpawned = false;
    this.bossWarningPhase = 0;
    this.endlessModeActive = false;
    this.endlessModeTime = 0;
    this.endlessMinibossTimer = 0;
    this.endlessBossTimer = 0;
    this.activeLasers = [];
    this.enemyProjectiles = [];
    // Reset miniboss spawn tracking and shuffle order for variety
    for (const miniboss of this.minibossSpawnTimes) {
      miniboss.spawned = false;
    }
    // Fisher-Yates shuffle of typeIds while keeping time slots fixed
    const typeIds = this.minibossSpawnTimes.map(entry => entry.typeId);
    for (let i = typeIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [typeIds[i], typeIds[j]] = [typeIds[j], typeIds[i]];
    }
    for (let i = 0; i < this.minibossSpawnTimes.length; i++) {
      this.minibossSpawnTimes[i].typeId = typeIds[i];
    }

    // Initialize ECS world
    this.world = createWorld();

    // Initialize Geometry Wars style warping grid background
    this.gridBackground = new GridBackground(this);

    // Initialize motion trail system
    this.trailManager = new TrailManager(this);

    // Initialize death ripple system
    this.deathRippleManager = new DeathRippleManager(this);
    this.deathRippleManager.setWorld(this.world);
    this.deathRippleManager.setQuality(this.visualQuality);

    // Initialize mastery visuals manager for level 10 stat indicators
    this.masteryVisualsManager = new MasteryVisualsManager(this);

    // Initialize shield barrier visual (honeycomb + charge dots)
    this.shieldBarrierVisual = new ShieldBarrierVisual(this);

    // Initialize player stats and upgrades
    this.playerStats = createDefaultPlayerStats();
    this.upgrades = createUpgrades();
    this.isPaused = false;

    // Apply permanent meta-progression bonuses
    const metaManager = getMetaProgressionManager();

    // ═══ OFFENSE ═══
    this.playerStats.damageMultiplier *= metaManager.getStartingDamageMultiplier();
    this.playerStats.attackSpeedMultiplier *= metaManager.getStartingAttackSpeedMultiplier();
    this.playerStats.projectileCount += metaManager.getStartingProjectileCount();
    this.playerStats.piercing += metaManager.getStartingPiercing();
    this.playerStats.critChance += metaManager.getStartingCritChance();
    this.playerStats.critDamage = metaManager.getStartingCritDamage();
    this.playerStats.projectileSpeedMultiplier *= metaManager.getStartingProjectileSpeed();
    this.playerStats.rangeMultiplier *= metaManager.getStartingArea();
    this.playerStats.durationMultiplier *= metaManager.getStartingDuration();
    this.playerStats.cooldownMultiplier *= metaManager.getStartingCooldownMultiplier();
    this.playerStats.knockbackMultiplier *= metaManager.getStartingKnockback();
    this.playerStats.executionBonus += metaManager.getStartingExecutionBonus();
    this.playerStats.overkillSplash += metaManager.getStartingOverkillSplash();
    this.playerStats.armorPenetration += metaManager.getStartingArmorPen();

    // ═══ DEFENSE ═══
    this.playerStats.maxHealth += metaManager.getStartingBonusHealth();
    this.playerStats.currentHealth = this.playerStats.maxHealth;
    this.playerStats.armor += metaManager.getStartingArmor();
    this.playerStats.regenPerSecond += metaManager.getStartingRegen();
    this.playerStats.dodgeChance += metaManager.getStartingDodgeChance();
    this.playerStats.lifeStealPercent += metaManager.getStartingLifeSteal();
    this.playerStats.iframeDuration += metaManager.getStartingIFrameBonus();
    this.playerStats.revivals += metaManager.getStartingRevivals();
    this.playerStats.thornsPercent += metaManager.getStartingThorns();
    this.playerStats.maxShield += metaManager.getStartingShield();
    this.playerStats.shield = this.playerStats.maxShield;
    this.playerStats.healingBoost *= metaManager.getStartingHealingBoost();
    this.playerStats.damageCap = metaManager.getStartingDamageCap();
    this.playerStats.maxShieldCharges += metaManager.getStartingBarrierCapacity();

    // ═══ MOVEMENT ═══
    this.playerStats.moveSpeed *= metaManager.getStartingMoveSpeedMultiplier();
    this.playerStats.accelerationMultiplier *= metaManager.getStartingAcceleration();
    this.playerStats.slowResistance += metaManager.getStartingSlowResist();
    this.playerStats.sprintBonus += metaManager.getStartingSprint();
    this.playerStats.combatSpeedBonus += metaManager.getStartingCombatSpeed();
    this.playerStats.dashCooldown = metaManager.getStartingDashCooldown();
    this.playerStats.phaseChance += metaManager.getStartingPhaseChance();

    // ═══ RESOURCES ═══
    this.playerStats.xpMultiplier *= metaManager.getStartingXPMultiplier();
    this.playerStats.pickupRange *= metaManager.getStartingPickupRangeMultiplier();
    this.playerStats.gemValueMultiplier *= metaManager.getStartingGemValueBonus();
    this.playerStats.dropRateMultiplier *= metaManager.getStartingDropRateBonus();
    this.playerStats.healthDropMultiplier *= metaManager.getStartingHealthDropBonus();
    this.playerStats.bossGoldMultiplier *= metaManager.getStartingBossGoldBonus();

    // ═══ UTILITY ═══
    this.playerStats.rerollsRemaining += metaManager.getStartingRerolls();
    this.playerStats.skipsRemaining += metaManager.getStartingSkips();
    this.playerStats.banishesRemaining += metaManager.getStartingBanishes();
    this.playerStats.luck += metaManager.getStartingLuckBonus();

    // ═══ ELEMENTAL ═══
    this.playerStats.burnChance += metaManager.getStartingBurnChance();
    this.playerStats.burnDamageMultiplier *= metaManager.getStartingBurnDamageBonus();
    this.playerStats.freezeChance += metaManager.getStartingFreezeChance();
    this.playerStats.freezeDurationMultiplier *= metaManager.getStartingFreezeDurationBonus();
    this.playerStats.chainLightningChance += metaManager.getStartingChainLightningChance();
    this.playerStats.chainLightningCount += metaManager.getStartingChainCount();
    this.playerStats.poisonChance += metaManager.getStartingPoisonChance();
    this.playerStats.poisonMaxStacks += metaManager.getStartingPoisonMaxStacks();

    // ═══ MASTERY ═══
    this.playerStats.projectileMastery *= metaManager.getStartingProjectileMastery();
    this.playerStats.meleeMastery *= metaManager.getStartingMeleeMastery();
    this.playerStats.auraMastery *= metaManager.getStartingAuraMastery();
    this.playerStats.summonMastery *= metaManager.getStartingSummonMastery();
    this.playerStats.orbitalMastery *= metaManager.getStartingOrbitalMastery();
    this.playerStats.explosiveMastery *= metaManager.getStartingExplosiveMastery();
    this.playerStats.beamMastery *= metaManager.getStartingBeamMastery();
    this.playerStats.ultimateMastery *= metaManager.getStartingUltimateMastery();
    this.playerStats.weaponSlots += metaManager.getStartingWeaponSlots();
    this.playerStats.weaponSynergy += metaManager.getStartingSynergyBonus();

    // ═══ ADVANCED ELEMENTAL ═══
    this.playerStats.shatterBonus += metaManager.getStartingShatterBonus();
    this.playerStats.pandemicSpread += metaManager.getStartingPandemicSpread();
    this.playerStats.overchargeStunDuration += metaManager.getStartingOverchargeStun();
    this.playerStats.explosionDamageMultiplier *= (1 + metaManager.getStartingExplosionDamage());

    // ═══ TIME/DIFFICULTY ═══
    this.playerStats.slowTimeRemaining = metaManager.getStartingSlowTimeMinutes() * 60; // Convert minutes to seconds
    this.playerStats.curseMultiplier *= (1 + metaManager.getStartingCurseLevel() * 0.15); // 15% per curse level

    // ═══ WORLD LEVEL SCALING ═══
    this.worldLevel = metaManager.getWorldLevel();
    this.worldLevelHealthMult = metaManager.getWorldLevelEnemyHealthMultiplier();
    this.worldLevelDamageMult = metaManager.getWorldLevelEnemyDamageMultiplier();
    this.worldLevelSpawnReduction = metaManager.getWorldLevelSpawnTimeReduction();
    this.worldLevelXPMult = metaManager.getWorldLevelXPMultiplier();

    // ═══ SPAWNING ═══
    this.playerStats.treasureInterval = metaManager.getStartingTreasureInterval();

    // ═══ ACHIEVEMENT BONUSES ═══
    const achievementBonuses = metaManager.getAchievementBonuses();
    const allStatsMult = 1 + achievementBonuses.allStats / 100;
    this.playerStats.damageMultiplier *= (1 + achievementBonuses.damage / 100) * allStatsMult;
    this.playerStats.maxHealth += achievementBonuses.health;
    this.playerStats.currentHealth = this.playerStats.maxHealth;
    this.playerStats.moveSpeed *= (1 + achievementBonuses.speed / 100) * allStatsMult;
    this.playerStats.xpMultiplier *= (1 + achievementBonuses.xp / 100);
    this.playerStats.critChance += achievementBonuses.critChance / 100;
    this.playerStats.cooldownMultiplier *= Math.max(0.5, 1 - achievementBonuses.cooldown / 100);
    this.playerStats.dodgeChance += achievementBonuses.dodge / 100;
    this.playerStats.attackSpeedMultiplier *= (1 + achievementBonuses.attackSpeed / 100) * allStatsMult;

    // ═══ ASCENSION BONUSES ═══
    const ascensionManager = getAscensionManager();
    const ascensionStatMult = ascensionManager.getStatMultiplier();
    if (ascensionStatMult > 1) {
      this.playerStats.damageMultiplier *= ascensionStatMult;
      this.playerStats.attackSpeedMultiplier *= ascensionStatMult;
      this.playerStats.moveSpeed *= ascensionStatMult;
    }
    this.playerStats.weaponSlots += ascensionManager.getBonusWeaponSlots();
    this.playerStats.gemValueMultiplier *= ascensionManager.getXPGemMultiplier();

    // ═══ STARTING LEVEL (triggers level-ups at start) ═══
    const achievementStartingLevelBonus = achievementBonuses.startingLevel;
    const ascensionStartingLevelBonus = ascensionManager.getBonusStartingLevel();
    const startingLevel = metaManager.getStartingLevel() + achievementStartingLevelBonus + ascensionStartingLevelBonus;
    if (startingLevel > 1) {
      // Queue up level-ups for starting level bonus
      for (let i = 1; i < startingLevel; i++) {
        this.pendingLevelUps++;
      }
    }

    // Initialize effects and sound managers
    this.effectsManager = new EffectsManager(this);
    this.soundManager = new SoundManager(this);

    // Setup XP gem system
    setXPGemSystemScene(this);
    setXPGemEffectsManager(this.effectsManager);
    setXPGemSoundManager(this.soundManager);
    setXPCollectCallback((xpValue) => {
      this.collectXP(xpValue);
    });

    // Setup health pickup system
    setHealthPickupSystemScene(this);
    setHealthPickupEffectsManager(this.effectsManager);
    setHealthPickupSoundManager(this.soundManager);
    setHealthCollectCallback((healAmount) => {
      this.healPlayer(healAmount);
    });

    // Setup magnet pickup system
    setMagnetPickupSystemScene(this);
    setMagnetPickupEffectsManager(this.effectsManager);
    setMagnetPickupSoundManager(this.soundManager);

    // Setup enemy projectile callback for shooter/sniper enemies
    setEnemyProjectileCallback((x, y, angle, speed, damage) => {
      this.spawnEnemyProjectile(x, y, angle, speed, damage);
    });

    // Setup minion spawn callback for SwarmMother and Necromancer
    setMinionSpawnCallback((x, y, typeId) => {
      this.spawnMinionEnemy(x, y, typeId);
    });

    // Setup XP gem callbacks for Glutton miniboss
    setXPGemWorldReference(this.world);
    setXPGemCallbacks(getXPGemPositions, consumeXPGem);

    // Setup boss callbacks for ground slam and laser beam
    setBossCallbacks(
      (x, y, radius, damage) => this.handleGroundSlam(x, y, radius, damage),
      (x1, y1, x2, y2, damage) => this.handleLaserBeam(x1, y1, x2, y2, damage)
    );

    // Setup status effect system
    setStatusEffectSystemEffectsManager(this.effectsManager);
    setStatusEffectSystemDeathCallback((entityId, x, y) => {
      this.handleEnemyDeath(entityId, x, y);
    });

    // Setup damage dealt tracking for status effects (burn/poison)
    setStatusEffectDamageCallback((amount) => {
      this.totalDamageDealt += amount;
      getAchievementManager().recordDamageDealt(amount);
    });

    // Setup input (keyboard, mouse, joystick, dash, focus-loss handlers)
    this.inputController = new InputController(this, {
      getDashCooldown: () => this.playerStats.dashCooldown,
      onFocusLost: () => {
        if (!this.isPaused && !this.isGameOver) {
          this.pauseMenuManager.togglePauseMenu();
        }
      },
    });

    // Create player at center of screen
    this.playerId = this.createPlayer(this.scale.width / 2, this.scale.height / 2);

    // Initialize weapon system
    this.weaponManager = new WeaponManager(
      this,
      this.world,
      this.playerId,
      this.effectsManager,
      this.soundManager
    );

    // Set up weapon manager callbacks for enemy death and player heal
    this.weaponManager.setCallbacks(
      // onDamaged - track total damage dealt
      (_enemyId, damage, isCrit) => {
        this.totalDamageDealt += damage;
        getAchievementManager().recordDamageDealt(damage, isCrit);
      },
      // onKilled - handle death
      (enemyId, x, y) => {
        this.handleEnemyDeath(enemyId, x, y);
      },
      // onHealed - heal player (for weapon mastery effects)
      (amount) => {
        this.healPlayer(amount);
      }
    );

    // Set weapon slot limit (base 4 = starter + 3 pickable, plus meta bonus)
    const baseWeaponSlots = 4;
    this.weaponManager.setMaxWeaponSlots(baseWeaponSlots + this.playerStats.weaponSlots);

    // Give player the starting weapon (selected in WeaponSelectScene or default projectile)
    const startingWeapon = createWeapon(this.startingWeaponId) || new ProjectileWeapon();
    this.weaponManager.addWeapon(startingWeapon);
    // Discover the starting weapon in codex
    const startingWeaponActualId = this.startingWeaponId || 'projectile';
    getCodexManager().discoverWeapon(startingWeaponActualId, startingWeapon.name);
    getCodexManager().recordWeaponUsage(startingWeaponActualId, 0, 0);

    // Apply meta-progression stats to player and weapons
    this.syncStatsToPlayer();

    // Create HUD manager and build all HUD elements
    this.hudManager = new HUDManager(this, {
      worldLevel: getMetaProgressionManager().getWorldLevel(),
      onPauseClicked: () => this.togglePauseMenu(),
      onAutoBuyToggled: () => this.toggleAutoBuy(),
    });
    this.hudManager.create();

    // Create pause menu manager
    this.pauseMenuManager = this.createPauseMenuManager();

    // Setup pause key (ESC) - store handler reference for cleanup
    this.escKeyHandler = () => {
      this.togglePauseMenu();
    };
    this.input.keyboard?.on('keydown-ESC', this.escKeyHandler);

    // Setup scene resume handler to show pause menu when returning from settings
    this.resumeHandler = () => {
      if (this.isPaused && !this.pauseMenuManager.isPauseMenuOpen) {
        this.pauseMenuManager.showPauseMenuFromSettings();
      }
    };
    this.events.on('resume', this.resumeHandler);

    // Setup auto-buy toggle key (T) - store handler reference for cleanup
    this.autoBuyKeyHandler = () => {
      this.toggleAutoBuy();
    };
    this.input.keyboard?.on('keydown-T', this.autoBuyKeyHandler);

    // Setup beforeunload handler to save game state on page close/refresh
    this.setupBeforeUnloadHandler();

    // Initialize input controller (keyboard, mouse, joystick, focus-loss handlers)
    // Must be after pauseMenuManager is created since onFocusLost references it
    this.inputController.create();

    // Listen for dash requests from InputController (triggered by Shift key)
    this.dashRequestHandler = () => {
      if (this.isPaused || this.isGameOver) return;
      if (this.playerId === -1) return;
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      this.inputController.tryDash(playerX, playerY, this.playerId);
    };
    this.events.on('input-dash-requested', this.dashRequestHandler);
  }

  /**
   * Sets up the beforeunload handler to save game state on page close/refresh.
   */
  private setupBeforeUnloadHandler(): void {
    this.beforeUnloadHandler = () => {
      if (!this.isGameOver && !this.hasWon) {
        this.saveGameState();
      }
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  /**
   * Saves the current game state via SecureStorage.
   * Called periodically during gameplay and on page unload.
   */
  private saveGameState(): void {
    const gameStateManager = getGameStateManager();
    gameStateManager.save({
      world: this.world,
      playerId: this.playerId,
      playerStats: this.playerStats,
      gameTime: this.gameTime,
      killCount: this.killCount,
      enemyCount: this.enemyCount,
      spawnTimer: this.spawnTimer,
      spawnInterval: this.spawnInterval,
      magnetSpawnTimer: this.magnetSpawnTimer,
      treasureSpawnTimer: this.treasureSpawnTimer,
      gemMagnetTimer: this.gemMagnetTimer,
      dashCooldownTimer: this.inputController.getDashCooldownRemaining(),
      damageCooldown: this.damageCooldown,
      bossSpawned: this.bossSpawned,
      bossWarningPhase: this.bossWarningPhase,
      comboState: getComboState(),
      eventState: getEventState(),
      minibossSpawnTimes: this.minibossSpawnTimes,
      banishedUpgradeIds: this.banishedUpgradeIds,
      isAutoBuyEnabled: this.isAutoBuyEnabled,
      worldLevel: this.worldLevel,
      worldLevelHealthMult: this.worldLevelHealthMult,
      worldLevelDamageMult: this.worldLevelDamageMult,
      worldLevelSpawnReduction: this.worldLevelSpawnReduction,
      worldLevelXPMult: this.worldLevelXPMult,
      weapons: this.weaponManager.getAllWeapons().map(w => ({
        id: w.id,
        level: w.getLevel(),
      })),
      upgrades: this.upgrades.map(u => ({
        id: u.id,
        currentLevel: u.currentLevel,
      })),
      twinLinks: getAllTwinLinks(),
    });
  }

  /**
   * Restores a saved game state.
   * Called when the game is loaded with a valid save from page reload.
   */
  private restoreGameState(state: GameSaveState): void {
    // Reset all ECS systems
    resetSpriteSystem();
    resetEnemyAISystem();
    resetBossCallbacks();
    resetXPGemSystem();
    resetHealthPickupSystem();
    resetMagnetPickupSystem();
    resetWeaponSystem();
    resetCollisionSystem();
    resetStatusEffectSystem();
    resetFrameCache();
    resetEnemySpatialHash();

    // Reset timers
    this.autoSaveTimer = 0;

    // Initialize ECS world
    this.world = createWorld();

    // Initialize visual systems
    this.gridBackground = new GridBackground(this);
    this.trailManager = new TrailManager(this);
    this.deathRippleManager = new DeathRippleManager(this);
    this.deathRippleManager.setWorld(this.world);
    this.deathRippleManager.setQuality(this.visualQuality);
    this.masteryVisualsManager = new MasteryVisualsManager(this);
    this.shieldBarrierVisual = new ShieldBarrierVisual(this);

    // Restore game progress
    this.gameTime = state.gameTime;
    this.killCount = state.killCount;
    this.enemyCount = 0; // Will be incremented as we restore enemies

    // Restore timers
    this.spawnTimer = state.spawnTimer;
    this.spawnInterval = state.spawnInterval;
    this.magnetSpawnTimer = state.magnetSpawnTimer;
    this.treasureSpawnTimer = state.treasureSpawnTimer;
    this.gemMagnetTimer = state.gemMagnetTimer;
    // Note: dashCooldownTimer is restored after inputController.create() below
    this.damageCooldown = state.damageCooldown;

    // Restore spawn tracking
    this.bossSpawned = state.bossSpawned;
    this.bossWarningPhase = state.bossWarningPhase ?? 0;
    if (state.comboState) {
      restoreComboState(state.comboState);
    }
    if (state.eventState) {
      restoreEventState(state.eventState);
    }
    this.minibossSpawnTimes = state.minibossSpawnTimes;

    // Restore player state
    this.playerStats = state.playerStats;
    this.banishedUpgradeIds = new Set(state.banishedUpgradeIds);
    this.isAutoBuyEnabled = state.isAutoBuyEnabled;

    // Clamp restored player stats to prevent save tampering
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    this.playerStats.maxHealth = clamp(this.playerStats.maxHealth, 1, 100_000);
    this.playerStats.currentHealth = clamp(this.playerStats.currentHealth, 0, this.playerStats.maxHealth);
    this.playerStats.level = clamp(this.playerStats.level, 1, 200);
    this.playerStats.xp = clamp(this.playerStats.xp, 0, this.playerStats.xpToNextLevel);
    this.playerStats.damageMultiplier = clamp(this.playerStats.damageMultiplier, 0, 100);
    this.playerStats.moveSpeed = clamp(this.playerStats.moveSpeed, 0, 2000);
    this.playerStats.attackSpeedMultiplier = clamp(this.playerStats.attackSpeedMultiplier, 0, 50);
    this.playerStats.critChance = clamp(this.playerStats.critChance, 0, 1);
    this.playerStats.critDamage = clamp(this.playerStats.critDamage, 0, 100);
    this.playerStats.dodgeChance = clamp(this.playerStats.dodgeChance, 0, 1);
    this.playerStats.lifeStealPercent = clamp(this.playerStats.lifeStealPercent, 0, 1);
    this.playerStats.phaseChance = clamp(this.playerStats.phaseChance, 0, 1);
    this.playerStats.armor = clamp(this.playerStats.armor, 0, 10_000);
    this.playerStats.shield = clamp(this.playerStats.shield, 0, 100_000);
    this.playerStats.maxShield = clamp(this.playerStats.maxShield, 0, 100_000);

    // Restore world level and multipliers (clamped)
    this.worldLevel = clamp(state.worldLevel ?? 1, 1, 50);
    this.worldLevelHealthMult = clamp(state.worldLevelHealthMult, 0.1, 100);
    this.worldLevelDamageMult = clamp(state.worldLevelDamageMult, 0.1, 100);
    this.worldLevelSpawnReduction = clamp(state.worldLevelSpawnReduction, 0, 1);
    this.worldLevelXPMult = clamp(state.worldLevelXPMult, 0.1, 100);

    // Reset other state
    this.isGameOver = false;
    this.isPaused = false;
    this.hasWon = false;
    this.pendingLevelUps = 0;
    this.nextEnemyDropsMagnet = false;
    this.activeLasers = [];
    this.enemyProjectiles = [];

    // Initialize upgrades list
    this.upgrades = createUpgrades();

    // Restore upgrade levels from save
    // Note: We only restore currentLevel, NOT re-apply bonuses.
    // The playerStats object already has bonuses baked in from when it was saved.
    if (state.upgrades && state.upgrades.length > 0) {
      for (const upgradeData of state.upgrades) {
        const upgrade = this.upgrades.find(u => u.id === upgradeData.id);
        if (upgrade && upgradeData.currentLevel > 0) {
          upgrade.currentLevel = upgradeData.currentLevel;
        }
      }
    }

    // Initialize effects and sound managers
    this.effectsManager = new EffectsManager(this);
    this.soundManager = new SoundManager(this);

    // Setup system callbacks
    this.setupSystemCallbacks();

    // Setup input controller (keyboard, mouse, joystick, dash)
    this.inputController = new InputController(this, {
      getDashCooldown: () => this.playerStats.dashCooldown,
      onFocusLost: () => {
        if (!this.isPaused && !this.isGameOver) {
          this.pauseMenuManager.togglePauseMenu();
        }
      },
    });

    // Restore all entities
    this.restoreEntities(state);

    // Note: Twin links cannot be restored because entity IDs change on recreation.
    // The twin link system uses runtime entity IDs which are not preserved.
    // Twins will need to be re-linked if both are still alive - this is an
    // acceptable limitation since twins are rare and their link is primarily
    // for the shared damage mechanic.

    // Initialize weapon system
    this.weaponManager = new WeaponManager(
      this,
      this.world,
      this.playerId,
      this.effectsManager,
      this.soundManager
    );

    // Set high limit temporarily for restoration (saved weapons are legitimate)
    this.weaponManager.setMaxWeaponSlots(999);

    // Restore weapons (cap level to prevent save tampering)
    const maxWeaponLevel = 10;
    for (const weaponData of state.weapons) {
      const weapon = createWeapon(weaponData.id);
      if (weapon) {
        const targetLevel = Math.min(weaponData.level, maxWeaponLevel);
        for (let i = 1; i < targetLevel; i++) {
          weapon.levelUp();
        }
        this.weaponManager.addWeapon(weapon);
      }
    }

    // Set proper weapon slot limit after restoration (base 4 + meta bonus)
    // Uses Math.max to ensure saved weapons are retained if meta state changed
    const baseWeaponSlots = 4;
    const metaBonus = this.playerStats.weaponSlots;
    const restoredCount = this.weaponManager.getWeaponCount();
    this.weaponManager.setMaxWeaponSlots(Math.max(baseWeaponSlots + metaBonus, restoredCount));

    // Set up weapon manager callbacks
    this.weaponManager.setCallbacks(
      (_enemyId, damage, isCrit) => {
        this.totalDamageDealt += damage;
        getAchievementManager().recordDamageDealt(damage, isCrit);
      },
      (enemyId, x, y) => {
        this.handleEnemyDeath(enemyId, x, y);
      },
      (amount) => {
        this.healPlayer(amount);
      }
    );

    // Sync stats to player
    this.syncStatsToPlayer();

    // Create HUD manager and build all HUD elements (restore path)
    this.hudManager = new HUDManager(this, {
      worldLevel: getMetaProgressionManager().getWorldLevel(),
      onPauseClicked: () => this.togglePauseMenu(),
      onAutoBuyToggled: () => this.toggleAutoBuy(),
    });
    this.hudManager.create();

    // Populate upgrade icons with restored weapons and upgrades
    this.hudManager.updateUpgradeIcons(this.buildUpgradeIconData());

    // Create pause menu manager (restore path)
    this.pauseMenuManager = this.createPauseMenuManager();

    // Setup pause key
    this.escKeyHandler = () => {
      this.togglePauseMenu();
    };
    this.input.keyboard?.on('keydown-ESC', this.escKeyHandler);

    // Setup scene resume handler to show pause menu when returning from settings
    this.resumeHandler = () => {
      if (this.isPaused && !this.pauseMenuManager.isPauseMenuOpen) {
        this.pauseMenuManager.showPauseMenuFromSettings();
      }
    };
    this.events.on('resume', this.resumeHandler);

    // Setup auto-buy toggle key
    this.autoBuyKeyHandler = () => {
      this.toggleAutoBuy();
    };
    this.input.keyboard?.on('keydown-T', this.autoBuyKeyHandler);

    // Setup beforeunload handler
    this.setupBeforeUnloadHandler();

    // Initialize input controller and restore dash state from save
    // Must be after pauseMenuManager is created since onFocusLost references it
    this.inputController.create();
    this.inputController.setDashCooldownTimer(state.dashCooldownTimer);
    this.inputController.resetDashState();

    // Listen for dash requests from InputController (triggered by Shift key)
    this.dashRequestHandler = () => {
      if (this.isPaused || this.isGameOver) return;
      if (this.playerId === -1) return;
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      this.inputController.tryDash(playerX, playerY, this.playerId);
    };
    this.events.on('input-dash-requested', this.dashRequestHandler);
  }

  /**
   * Sets up all ECS system callbacks.
   * Extracted for reuse in both fresh start and restore.
   */
  private setupSystemCallbacks(): void {
    // Setup XP gem system
    setXPGemSystemScene(this);
    setXPGemEffectsManager(this.effectsManager);
    setXPGemSoundManager(this.soundManager);
    setXPCollectCallback((xpValue) => {
      this.collectXP(xpValue);
    });

    // Setup health pickup system
    setHealthPickupSystemScene(this);
    setHealthPickupEffectsManager(this.effectsManager);
    setHealthPickupSoundManager(this.soundManager);
    setHealthCollectCallback((healAmount) => {
      this.healPlayer(healAmount);
    });

    // Setup magnet pickup system
    setMagnetPickupSystemScene(this);
    setMagnetPickupEffectsManager(this.effectsManager);
    setMagnetPickupSoundManager(this.soundManager);

    // Setup enemy projectile callback
    setEnemyProjectileCallback((x, y, angle, speed, damage) => {
      this.spawnEnemyProjectile(x, y, angle, speed, damage);
    });

    // Setup minion spawn callback
    setMinionSpawnCallback((x, y, typeId) => {
      this.spawnMinionEnemy(x, y, typeId);
    });

    // Setup XP gem callbacks for Glutton
    setXPGemWorldReference(this.world);
    setXPGemCallbacks(getXPGemPositions, consumeXPGem);

    // Setup boss callbacks
    setBossCallbacks(
      (x, y, radius, damage) => this.handleGroundSlam(x, y, radius, damage),
      (x1, y1, x2, y2, damage) => this.handleLaserBeam(x1, y1, x2, y2, damage)
    );

    // Setup status effect system
    setStatusEffectSystemEffectsManager(this.effectsManager);
    setStatusEffectSystemDeathCallback((entityId, x, y) => {
      this.handleEnemyDeath(entityId, x, y);
    });

    // Setup damage dealt tracking for status effects (burn/poison)
    setStatusEffectDamageCallback((amount) => {
      this.totalDamageDealt += amount;
      getAchievementManager().recordDamageDealt(amount);
    });
  }

  /**
   * Restores all entities from saved state.
   */
  private restoreEntities(state: GameSaveState): void {
    for (const entity of state.entities) {
      switch (entity.tag) {
        case 'player':
          this.restorePlayer(entity);
          break;
        case 'enemy':
          this.restoreEnemy(entity);
          break;
        case 'xpGem':
          this.restoreXPGem(entity);
          break;
        case 'healthPickup':
          this.restoreHealthPickup(entity);
          break;
        case 'magnetPickup':
          this.restoreMagnetPickup(entity);
          break;
      }
    }

    // Reposition any boss health bars that were restored
    if (this.hudManager.getBossEntityIds().length > 0) {
      this.hudManager.repositionBossHealthBars();
    }
  }

  /**
   * Restores the player entity from saved state.
   */
  private restorePlayer(entity: GameSaveState['entities'][0]): void {
    const entityId = addEntity(this.world);
    this.playerId = entityId;

    // Add components
    addComponent(this.world, Transform, entityId);
    addComponent(this.world, Velocity, entityId);
    addComponent(this.world, Health, entityId);
    addComponent(this.world, PlayerTag, entityId);
    addComponent(this.world, SpriteRef, entityId);

    // Restore transform
    Transform.x[entityId] = entity.transform.x;
    Transform.y[entityId] = entity.transform.y;
    Transform.rotation[entityId] = entity.transform.rotation;

    // Restore velocity
    if (entity.velocity) {
      Velocity.x[entityId] = entity.velocity.x;
      Velocity.y[entityId] = entity.velocity.y;
      Velocity.speed[entityId] = entity.velocity.speed;
    }

    // Restore health from playerStats (more reliable than entity data)
    Health.current[entityId] = this.playerStats.currentHealth;
    Health.max[entityId] = this.playerStats.maxHealth;

    // Create player visual (pass current level for particle growth system)
    this.playerPlasmaCore = new PlayerPlasmaCore(this, entity.transform.x, entity.transform.y, {
      baseRadius: 16,
      neonColor: PLAYER_NEON,
      quality: this.visualQuality,
    }, this.playerStats.level);
    const playerVisual = this.playerPlasmaCore.getContainer();
    playerVisual.setDepth(10);
    registerSprite(entityId, playerVisual);
  }

  /**
   * Restores an enemy entity from saved state.
   */
  private restoreEnemy(entity: GameSaveState['entities'][0]): void {
    if (!entity.enemyData) return;

    const enemyType = getEnemyType(entity.enemyData.typeId);
    if (!enemyType) return;

    const entityId = addEntity(this.world);

    // Add components
    addComponent(this.world, Transform, entityId);
    addComponent(this.world, Velocity, entityId);
    addComponent(this.world, Health, entityId);
    addComponent(this.world, EnemyTag, entityId);
    addComponent(this.world, SpriteRef, entityId);
    addComponent(this.world, Knockback, entityId);
    addComponent(this.world, EnemyAI, entityId);
    addComponent(this.world, EnemyType, entityId);

    // Restore transform
    Transform.x[entityId] = entity.transform.x;
    Transform.y[entityId] = entity.transform.y;
    Transform.rotation[entityId] = entity.transform.rotation;

    // Restore velocity
    if (entity.velocity) {
      Velocity.x[entityId] = entity.velocity.x;
      Velocity.y[entityId] = entity.velocity.y;
      Velocity.speed[entityId] = entity.velocity.speed;
    }

    // Restore health
    if (entity.health) {
      Health.current[entityId] = entity.health.current;
      Health.max[entityId] = entity.health.max;
    }

    // Restore knockback
    if (entity.knockback) {
      Knockback.velocityX[entityId] = entity.knockback.velocityX;
      Knockback.velocityY[entityId] = entity.knockback.velocityY;
      Knockback.decay[entityId] = entity.knockback.decay;
    }

    // Restore AI state
    EnemyAI.aiType[entityId] = entity.enemyData.aiType;
    EnemyAI.state[entityId] = entity.enemyData.state;
    EnemyAI.timer[entityId] = entity.enemyData.timer;
    EnemyAI.targetX[entityId] = entity.enemyData.targetX;
    EnemyAI.targetY[entityId] = entity.enemyData.targetY;
    EnemyAI.shootTimer[entityId] = entity.enemyData.shootTimer;
    EnemyAI.specialTimer[entityId] = entity.enemyData.specialTimer;
    EnemyAI.phase[entityId] = entity.enemyData.phase;

    // Restore enemy type data
    EnemyType.xpValue[entityId] = entity.enemyData.xpValue;
    EnemyType.flags[entityId] = entity.enemyData.flags;
    EnemyType.baseDamage[entityId] = entity.enemyData.baseDamage;
    EnemyType.baseHealth[entityId] = entity.enemyData.baseHealth;
    EnemyType.size[entityId] = entity.enemyData.size;
    EnemyType.shieldCurrent[entityId] = entity.enemyData.shieldCurrent;
    EnemyType.shieldMax[entityId] = entity.enemyData.shieldMax;
    EnemyType.shieldRegenTimer[entityId] = entity.enemyData.shieldRegenTimer;

    // Restore status effects if present
    if (entity.statusEffect) {
      addComponent(this.world, StatusEffect, entityId);
      StatusEffect.burnDamage[entityId] = entity.statusEffect.burnDamage;
      StatusEffect.burnDuration[entityId] = entity.statusEffect.burnDuration;
      StatusEffect.burnTickTimer[entityId] = entity.statusEffect.burnTickTimer;
      StatusEffect.freezeMultiplier[entityId] = entity.statusEffect.freezeMultiplier;
      StatusEffect.freezeDuration[entityId] = entity.statusEffect.freezeDuration;
      StatusEffect.poisonStacks[entityId] = entity.statusEffect.poisonStacks;
      StatusEffect.poisonDuration[entityId] = entity.statusEffect.poisonDuration;
      StatusEffect.poisonTickTimer[entityId] = entity.statusEffect.poisonTickTimer;
      StatusEffect.chainImmunity[entityId] = entity.statusEffect.chainImmunity;
    }

    // Create visual
    const sprite = this.createEnemyVisual(entity.transform.x, entity.transform.y, enemyType);
    registerSprite(entityId, sprite);
    this.deathRippleManager.registerEnemy(entityId, enemyType.shape, 10 * enemyType.size);

    this.enemyCount++;

    // Create boss health bar if this is a boss/miniboss
    if (entity.enemyData.xpValue >= 30) {
      this.hudManager.createBossHealthBar(entityId, enemyType.name, entity.enemyData.xpValue >= 1000);
    }
  }

  /**
   * Restores an XP gem entity from saved state.
   */
  private restoreXPGem(entity: GameSaveState['entities'][0]): void {
    if (!entity.xpGemData) return;
    spawnXPGem(this.world, entity.transform.x, entity.transform.y, entity.xpGemData.value);
  }

  /**
   * Restores a health pickup entity from saved state.
   */
  private restoreHealthPickup(entity: GameSaveState['entities'][0]): void {
    if (!entity.healthPickupData) return;
    spawnHealthPickup(this.world, entity.transform.x, entity.transform.y, entity.healthPickupData.healAmount);
  }

  /**
   * Restores a magnet pickup entity from saved state.
   */
  private restoreMagnetPickup(entity: GameSaveState['entities'][0]): void {
    spawnMagnetPickup(this.world, entity.transform.x, entity.transform.y);
  }

  /**
   * Handle enemy death - spawns XP, health pickups, special effects, and cleans up entity.
   */
  private handleEnemyDeath(enemyId: number, x: number, y: number): void {
    this.enemyCount--;
    this.killCount++;

    // Track combo kill and handle threshold rewards
    const comboResult = recordComboKill();
    if (comboResult.triggeredThreshold) {
      this.handleComboThreshold(comboResult.triggeredThreshold);
    }

    // Track kill for achievements
    const achievementManager = getAchievementManager();
    const xpValueForTracking = EnemyType.xpValue[enemyId] || 1;
    achievementManager.recordKill(xpValueForTracking);

    // Track miniboss and boss kills
    if (xpValueForTracking >= 1000) {
      achievementManager.recordBossKill();
    } else if (xpValueForTracking >= 30) {
      achievementManager.recordMinibossKill();
    }

    // Track kill in codex
    const enemyTypeId = this.enemyTypeMap.get(enemyId);
    if (enemyTypeId) {
      getCodexManager().recordEnemyKill(enemyTypeId);
      this.enemyTypeMap.delete(enemyId);
    }

    // Remove boss health bar if this enemy had one
    this.hudManager.removeBossHealthBar(enemyId);

    // Get enemy type info for XP value and special death effects
    const xpValue = EnemyType.xpValue[enemyId] || 1;
    const flags = EnemyType.flags[enemyId] || 0;

    // Record death position for Necromancer to potentially revive
    recordEnemyDeath(x, y);

    // Handle Twin unlinking - if this was a twin, unlink from its partner
    unlinkTwin(enemyId);

    // Spawn XP gem at enemy death position (scaled with curse bonus AND world level bonus)
    const baseXP = xpValue + Math.floor(this.gameTime * 0.05);
    const scaledXP = Math.floor(baseXP * this.playerStats.curseMultiplier * this.worldLevelXPMult);
    spawnXPGem(this.world, x, y, scaledXP);

    // Random chance to spawn health pickup (higher chance for minibosses)
    const dropChance = xpValue >= 30 ? this.HEALTH_DROP_CHANCE * 3 : this.HEALTH_DROP_CHANCE;
    if (Math.random() < dropChance) {
      const healAmount = 15 + Math.floor(Math.random() * 10);
      spawnHealthPickup(this.world, x, y, healAmount);
    }

    // Drop magnet pickup if timer triggered (every 60 seconds)
    if (this.nextEnemyDropsMagnet) {
      spawnMagnetPickup(this.world, x, y);
      this.nextEnemyDropsMagnet = false;
    }

    // Check for explosion on death
    if (flags & EnemyFlags.EXPLODES_ON_DEATH) {
      this.handleExplosion(x, y, 60, 20);
    }

    // Check for split on death
    if (flags & EnemyFlags.SPLITS_ON_DEATH) {
      this.handleSplit(x, y);
    }

    // ═══ PANDEMIC SPREAD (poison spreads to nearby enemies on death) ═══
    if (this.playerStats.pandemicSpread > 0 && hasComponent(this.world, StatusEffect, enemyId)) {
      const poisonStacks = StatusEffect.poisonStacks[enemyId];
      if (poisonStacks > 0) {
        // Find nearby enemies and spread poison
        const spreadRadius = this.playerStats.pandemicSpread;
        const enemies = enemyQueryForCollision(this.world);
        for (const nearbyId of enemies) {
          if (nearbyId === enemyId) continue;
          const nearbyX = Transform.x[nearbyId];
          const nearbyY = Transform.y[nearbyId];
          const dx = nearbyX - x;
          const dy = nearbyY - y;
          const distSq = dx * dx + dy * dy;
          if (distSq < spreadRadius * spreadRadius) {
            // Spread half the stacks to nearby enemies
            const spreadStacks = Math.max(1, Math.floor(poisonStacks / 2));
            applyPoison(this.world, nearbyId, spreadStacks, 4000, this.playerStats.poisonMaxStacks);
            // Visual feedback for poison spread
            this.effectsManager.showDamageNumber(nearbyX, nearbyY - 10, spreadStacks, 0x66ff66);
          }
        }
      }
    }

    // === TIERED DEATH EFFECTS ===
    if (xpValue >= 1000) {
      // ══════ BOSS DEATH — epic cascading explosion ══════
      const enemySize = EnemyType.size[enemyId] || 5;

      // Phase 1: Central explosion
      this.effectsManager.playDeathBurst(x, y);

      // Phase 2: Staggered radial bursts (spaced 20ms to bypass 16ms throttle)
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const innerOffset = enemySize * 6;
        this.time.delayedCall(i * 20, () => {
          this.effectsManager.playDeathBurst(
            x + Math.cos(angle) * innerOffset,
            y + Math.sin(angle) * innerOffset,
            ENEMY_COLORS.boss.core
          );
        });
      }
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const outerOffset = enemySize * 12;
        this.time.delayedCall(140 + i * 25, () => {
          this.effectsManager.playDeathBurst(
            x + Math.cos(angle) * outerOffset,
            y + Math.sin(angle) * outerOffset,
            ENEMY_COLORS.boss.glow
          );
        });
      }

      // Phase 3: Camera effects
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(500, 0.035);
      }
      this.cameras.main.flash(400, 255, 200, 200);
      this.effectsManager.playImpactFlash(0.4, 150);

      // Phase 4: Massive grid distortion
      this.gridBackground.applyExplosiveForce(5000, x, y, 700);
      this.gridBackground.applyDirectedForce(0, 0, 200, x, y, 500);

      // Phase 5: Dual death ripple waves
      this.deathRippleManager.spawnRipple(x, y);
      this.time.delayedCall(150, () => {
        this.deathRippleManager.spawnRipple(x, y);
      });

      // Phase 6: Triple expanding shockwave rings
      const bossShockwaveRadius = 40 * enemySize;
      for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
        this.time.delayedCall(ringIndex * 80, () => {
          const ring = this.add.circle(x, y, 15, undefined, 0);
          const strokeColor = ringIndex === 0 ? 0xffffff : ENEMY_COLORS.boss.glow;
          ring.setStrokeStyle(4 - ringIndex, strokeColor);
          ring.setDepth(15);
          this.tweens.add({
            targets: ring,
            scaleX: bossShockwaveRadius / 15,
            scaleY: bossShockwaveRadius / 15,
            alpha: 0,
            duration: 600 + ringIndex * 100,
            ease: 'Power2',
            onComplete: () => ring.destroy(),
          });
        });
      }

      // Phase 7: Gold sparkle reward feel
      this.effectsManager.playGoldSparkle(x, y, 8);
      this.time.delayedCall(100, () => {
        this.effectsManager.playGoldSparkle(x - 20, y - 15, 5);
        this.effectsManager.playGoldSparkle(x + 20, y + 15, 5);
      });

      // Boss kill = Victory! Advance to next world level
      if (!this.hasWon) {
        const metaManager = getMetaProgressionManager();
        metaManager.advanceWorldLevel();
        this.showVictory();
      }
    } else if (xpValue >= 30) {
      // ══════ MINIBOSS DEATH — shockwave ring + flash ══════
      const enemySize = EnemyType.size[enemyId] || 2;

      this.effectsManager.playDeathBurst(x, y, ENEMY_COLORS.miniboss.core);

      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(250, 0.018);
      }
      this.effectsManager.playImpactFlash(0.15, 80);

      this.gridBackground.applyExplosiveForce(2000, x, y, 350);
      this.deathRippleManager.spawnRipple(x, y);

      // Expanding shockwave ring
      const minibossShockwaveRadius = 30 * enemySize;
      const shockwave = this.add.circle(x, y, 10, undefined, 0);
      shockwave.setStrokeStyle(3, ENEMY_COLORS.miniboss.glow);
      shockwave.setDepth(15);
      this.tweens.add({
        targets: shockwave,
        scaleX: minibossShockwaveRadius / 10,
        scaleY: minibossShockwaveRadius / 10,
        alpha: 0,
        duration: 500,
        ease: 'Power2',
        onComplete: () => shockwave.destroy(),
      });
    } else {
      // ══════ REGULAR ENEMY DEATH ══════
      this.effectsManager.playDeathBurst(x, y);
      this.gridBackground.applyExplosiveForce(500, x, y, 200);
      this.deathRippleManager.spawnRipple(x, y);
    }

    // Clean up entity
    this.deathRippleManager.unregisterEnemy(enemyId);
    const sprite = getSprite(enemyId);
    if (sprite) {
      sprite.destroy();
      unregisterSprite(enemyId);
    }
    removeEntity(this.world, enemyId);
  }

  /**
   * Handle explosion effect - damages player if nearby
   */
  private handleExplosion(x: number, y: number, radius: number, damage: number): void {
    // Visual effect
    const explosion = this.add.circle(x, y, radius, 0xff6600, 0.6);
    this.tweens.add({
      targets: explosion,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 300,
      onComplete: () => explosion.destroy(),
    });

    // Check if player is in explosion range
    if (this.playerId !== -1) {
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      const dist = Math.sqrt((playerX - x) ** 2 + (playerY - y) ** 2);

      if (dist < radius) {
        // Damage player
        this.takeDamage(damage);

        // Knockback from explosion
        const knockbackDir = Math.atan2(playerY - y, playerX - x);
        Knockback.velocityX[this.playerId] = Math.cos(knockbackDir) * 300;
        Knockback.velocityY[this.playerId] = Math.sin(knockbackDir) * 300;
      }
    }
  }

  /**
   * Handle enemy split - spawns smaller enemies
   */
  private handleSplit(x: number, y: number): void {
    const miniType = getEnemyType('splitter_mini');
    if (!miniType) return;

    // Spawn 2 mini enemies at offset positions
    for (let i = 0; i < 2; i++) {
      const angle = (i / 2) * Math.PI * 2 + Math.random() * 0.5;
      const offsetX = Math.cos(angle) * 20;
      const offsetY = Math.sin(angle) * 20;

      // Scale stats with both time and world level multipliers
      const scaledStats = getScaledStats(miniType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);
      this.createEnemy(x + offsetX, y + offsetY, miniType, scaledStats);
    }
  }

  // Enemy projectiles storage
  private enemyProjectiles: {
    sprite: Phaser.GameObjects.Arc;
    vx: number;
    vy: number;
    damage: number;
    lifetime: number;
  }[] = [];

  /**
   * Spawn an enemy projectile that moves toward player.
   */
  private spawnEnemyProjectile(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number
  ): void {
    const sprite = this.add.circle(x, y, 6, 0xff4444);
    sprite.setStrokeStyle(2, 0xffaaaa);
    sprite.setDepth(5);

    this.enemyProjectiles.push({
      sprite,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage,
      lifetime: 4,
    });
  }

  /**
   * Update enemy projectiles - move and check collision with player.
   */
  private updateEnemyProjectiles(deltaTime: number): void {
    const toRemove: typeof this.enemyProjectiles = [];

    for (const proj of this.enemyProjectiles) {
      proj.lifetime -= deltaTime;
      if (proj.lifetime <= 0) {
        toRemove.push(proj);
        continue;
      }

      proj.sprite.x += proj.vx * deltaTime;
      proj.sprite.y += proj.vy * deltaTime;

      // Bounds check
      if (proj.sprite.x < -20 || proj.sprite.x > this.scale.width + 20 ||
          proj.sprite.y < -20 || proj.sprite.y > this.scale.height + 20) {
        toRemove.push(proj);
        continue;
      }

      // Check collision with player
      if (this.playerId !== -1) {
        const playerX = Transform.x[this.playerId];
        const playerY = Transform.y[this.playerId];
        const dist = Math.sqrt((playerX - proj.sprite.x) ** 2 + (playerY - proj.sprite.y) ** 2);

        if (dist < 20) {
          this.takeDamage(proj.damage);
          toRemove.push(proj);
        }
      }
    }

    // Clean up
    for (const proj of toRemove) {
      const idx = this.enemyProjectiles.indexOf(proj);
      if (idx !== -1) this.enemyProjectiles.splice(idx, 1);
      proj.sprite.destroy();
    }
  }


  /**
   * Builds the upgrade icon data array for the HUD manager.
   * Combines active stat upgrades and weapon data into a unified format.
   */
  private buildUpgradeIconData(): UpgradeIconData[] {
    const result: UpgradeIconData[] = [];
    for (const upgrade of this.upgrades) {
      if (upgrade.currentLevel > 0) {
        result.push({
          id: upgrade.id, icon: upgrade.icon, name: upgrade.name,
          description: upgrade.description, currentLevel: upgrade.currentLevel,
          maxLevel: upgrade.maxLevel, type: 'skill',
        });
      }
    }
    const weapons = this.weaponManager.getAllWeapons();
    for (const weapon of weapons) {
      result.push({
        id: weapon.id, icon: weapon.icon, name: weapon.name,
        description: weapon.description, currentLevel: weapon.getLevel(),
        maxLevel: weapon.maxLevel, type: 'weapon',
      });
    }
    return result;
  }

  /**
   * Toggles the auto-buy feature on/off.
   * Shows confirmation text and updates the UI.
   * Requires auto-upgrade to be purchased from the shop.
   */
  private toggleAutoBuy(): void {
    // Don't toggle during pause menu or upgrade selection
    if (this.pauseMenuManager.isPauseMenuOpen || this.scene.isActive('UpgradeScene')) {
      return;
    }

    // Don't toggle if auto-upgrade is not purchased
    if (getMetaProgressionManager().getAutoUpgradeLevel() < 1) {
      return;
    }

    this.isAutoBuyEnabled = !this.isAutoBuyEnabled;
    this.hudManager.setAutoBuyEnabled(this.isAutoBuyEnabled);

    // Persist setting to secure storage
    SecureStorage.setItem(STORAGE_KEY_AUTO_BUY, String(this.isAutoBuyEnabled));

    // Show confirmation floating text at screen center
    const confirmText = this.add.text(
      this.scale.width / 2,
      this.scale.height / 2,
      this.isAutoBuyEnabled ? 'AUTO-UPGRADE ENABLED' : 'AUTO-UPGRADE DISABLED',
      {
        fontSize: '24px',
        fontFamily: 'Arial',
        color: this.isAutoBuyEnabled ? '#ffdd44' : '#888888',
        stroke: '#000000',
        strokeThickness: 4,
      }
    );
    confirmText.setOrigin(0.5);
    confirmText.setDepth(300);

    // Animate: float up and fade out
    this.tweens.add({
      targets: confirmText,
      y: this.scale.height / 2 - 50,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => confirmText.destroy(),
    });
  }

  update(_time: number, delta: number): void {
    // Sync joystick enabled state (must run even when paused to disable during overlays)
    this.inputController.setEnabled(!this.isPaused && !this.isGameOver);

    // Skip update when paused or game over
    if (this.isPaused || this.isGameOver) return;

    // ═══ FRAME CACHE UPDATE (must be first - populates spatial hash for all systems) ═══
    updateFrameCache(this.world);

    let deltaSeconds = delta / 1000;

    // ═══ SLOW TIME (75% game speed during effect) ═══
    if (this.playerStats.slowTimeRemaining > 0) {
      this.playerStats.slowTimeRemaining -= deltaSeconds;
      deltaSeconds *= 0.75; // 75% speed = slower game
    }

    this.gameTime += deltaSeconds;

    // ═══ ACHIEVEMENT TIME TRACKING (throttled to once per second) ═══
    if (this.gameTime - this.lastAchievementTimeCheck >= 1.0) {
      this.lastAchievementTimeCheck = this.gameTime;
      getAchievementManager().recordTimeSurvived(Math.floor(this.gameTime));
    }

    // ═══ AUTO-SAVE (periodic save for page reload recovery) ═══
    this.autoSaveTimer += deltaSeconds;
    if (this.autoSaveTimer >= this.AUTO_SAVE_INTERVAL) {
      this.autoSaveTimer = 0;
      this.saveGameState();
    }

    // Victory is now triggered by killing the boss (in handleEnemyDeath)
    // The 10-minute mark just spawns the boss - defeating it advances world level

    // Update damage cooldown
    if (this.damageCooldown > 0) {
      this.damageCooldown -= deltaSeconds;
    }

    // ═══ UPGRADE ICON HIGHLIGHT EXPIRATION ═══
    if (this.hudManager.expireHighlights(this.gameTime)) {
      this.hudManager.updateUpgradeIcons(this.buildUpgradeIconData());
    }

    // ═══ SHIELD BARRIER RECHARGE ═══
    if (this.playerStats.shieldBarrierEnabled &&
        this.playerStats.shieldCharges < this.playerStats.maxShieldCharges) {
      this.playerStats.shieldRechargeProgress += deltaSeconds / this.playerStats.shieldRechargeTime;

      if (this.playerStats.shieldRechargeProgress >= 1.0) {
        this.playerStats.shieldCharges++;
        this.playerStats.shieldRechargeProgress = 0;
        this.soundManager.playPickupXP(10);  // Subtle sound for shield ready

        // Visual feedback
        if (this.shieldBarrierVisual) {
          this.shieldBarrierVisual.onChargeGained();
        }
      }
    }

    // ═══ DASH ABILITY ═══
    const dashState = this.inputController.updateDash(deltaSeconds);
    if (dashState.isDashing) {
      // Apply dash velocity (dashState velocities are multipliers, scale by moveSpeed)
      const dashSpeed = this.playerStats.moveSpeed;
      Velocity.x[this.playerId] = dashState.velocityX * dashSpeed;
      Velocity.y[this.playerId] = dashState.velocityY * dashSpeed;
    }

    // ═══ GEM MAGNET (auto-vacuum at intervals) ═══
    const gemMagnetInterval = getMetaProgressionManager().getStartingGemMagnetInterval();
    if (gemMagnetInterval > 0 && this.playerId !== -1) {
      this.gemMagnetTimer -= deltaSeconds;
      if (this.gemMagnetTimer <= 0) {
        // Trigger gem magnet - magnetize all XP gems
        this.triggerGemMagnet();
        this.gemMagnetTimer = gemMagnetInterval;
      }
    }

    // ═══ TREASURE CHEST SPAWNING ═══
    if (this.playerStats.treasureInterval > 0 && this.playerId !== -1) {
      this.treasureSpawnTimer -= deltaSeconds;
      if (this.treasureSpawnTimer <= 0) {
        this.spawnTreasureChest();
        this.treasureSpawnTimer = this.playerStats.treasureInterval;
      }
    }

    // ═══ HP REGENERATION ═══
    if (this.playerStats.regenPerSecond > 0 && this.playerId !== -1) {
      const currentHP = Health.current[this.playerId];
      const maxHP = Health.max[this.playerId];
      if (currentHP < maxHP) {
        const regenAmount = this.playerStats.regenPerSecond * deltaSeconds;
        Health.current[this.playerId] = Math.min(currentHP + regenAmount, maxHP);
        this.playerStats.currentHealth = Health.current[this.playerId];
      }
    }

    // ═══ EMERGENCY HEAL (trigger when HP drops below 20%) ═══
    if (this.emergencyHealCooldown > 0) {
      this.emergencyHealCooldown -= deltaSeconds;
    }
    const emergencyHealPercent = getMetaProgressionManager().getStartingEmergencyHeal();
    if (emergencyHealPercent > 0 && this.emergencyHealCooldown <= 0 && this.playerId !== -1) {
      const currentHP = Health.current[this.playerId];
      const maxHP = Health.max[this.playerId];
      if (currentHP > 0 && currentHP < maxHP * 0.2) {
        // Trigger emergency heal
        const healAmount = maxHP * emergencyHealPercent;
        this.healPlayer(healAmount);
        this.emergencyHealCooldown = 30; // 30 second cooldown

        // Visual feedback
        this.effectsManager.showDamageNumber(
          Transform.x[this.playerId],
          Transform.y[this.playerId] - 40,
          'EMERGENCY HEAL!',
          0x00ff00
        );
      }
    }

    // Update magnet spawn timer (every 60 seconds, flag next enemy to drop magnet)
    this.magnetSpawnTimer += deltaSeconds;
    if (this.magnetSpawnTimer >= this.MAGNET_SPAWN_INTERVAL) {
      this.nextEnemyDropsMagnet = true;
      this.magnetSpawnTimer = 0;
    }

    // Update spawn timer and spawn enemies
    this.spawnTimer += deltaSeconds;
    if (this.spawnTimer >= this.spawnInterval && this.enemyCount < this.maxEnemies) {
      // Batch spawning: late game spawns multiple enemies per tick
      let spawnCount = 1;
      const batchThresholds = TUNING.spawn.batchThresholds;
      if (this.gameTime >= batchThresholds[1].time) {
        spawnCount = 1 + Math.floor(Math.random() * batchThresholds[1].maxExtra);
      } else if (this.gameTime >= batchThresholds[0].time) {
        spawnCount = Math.random() < batchThresholds[0].extraChance ? 2 : 1;
      }
      for (let spawnIndex = 0; spawnIndex < spawnCount; spawnIndex++) {
        if (this.enemyCount < this.maxEnemies) {
          this.spawnEnemy();
        }
      }
      this.spawnTimer = 0;

      // Multi-phase spawn rate curve (keeps accelerating throughout the run)
      const spawnPhases = TUNING.spawn.phases;
      let baseInterval: number;
      if (this.gameTime < spawnPhases[0].endTime) {
        // Phase 1: Gentle ramp
        baseInterval = spawnPhases[0].startInterval - this.gameTime * ((spawnPhases[0].startInterval - spawnPhases[0].endInterval) / spawnPhases[0].endTime);
      } else if (this.gameTime < spawnPhases[1].endTime) {
        // Phase 2: Accelerating (quadratic)
        const spawnPhaseProgress = (this.gameTime - spawnPhases[0].endTime) / (spawnPhases[1].endTime - spawnPhases[0].endTime);
        baseInterval = spawnPhases[1].startInterval - spawnPhaseProgress * spawnPhaseProgress * (spawnPhases[1].startInterval - spawnPhases[1].endInterval);
      } else {
        // Phase 3: Intense
        const spawnPhaseProgress = Math.min((this.gameTime - spawnPhases[1].endTime) / (spawnPhases[2].endTime - spawnPhases[1].endTime), 1);
        baseInterval = spawnPhases[2].startInterval - spawnPhaseProgress * (spawnPhases[2].startInterval - spawnPhases[2].endInterval);
      }
      this.spawnInterval = Math.max(TUNING.spawn.minInterval, baseInterval);
    }

    // Check for miniboss spawns
    this.checkMinibossSpawns();

    // Update boss warning sequence
    this.updateBossWarning(deltaSeconds);

    // Check for boss spawn
    this.checkBossSpawn();

    // Check for endless mode spawns (post-victory)
    if (this.endlessModeActive) {
      this.checkEndlessModeSpawns(deltaSeconds);
    }

    // Update combo system (decay timer, threshold effect timers)
    updateComboSystem(deltaSeconds);

    // Suppress events during boss warning phase 2+
    setSuppressEvents(this.bossWarningPhase >= 2);

    // Update event system and handle triggered events
    const triggeredEvent = updateEventSystem(deltaSeconds, this.gameTime);
    if (triggeredEvent) {
      this.handleRunEvent(triggeredEvent);
    }
    this.hudManager.updateEventIndicator(getActiveEvent()?.event ?? null);

    // Update laser beams
    this.updateLaserBeams(deltaSeconds);

    // Update input state (joystick, keyboard, mouse sync)
    const inputState = this.inputController.update();

    // Run ECS systems
    inputSystem(this.world, inputState);
    updateAIGameTime(this.gameTime);
    enemyAISystem(this.world, deltaSeconds);

    // Update Wraith sprite alpha based on phase state
    const wraithCheckEnemies = getFrameCacheEnemyIds();
    for (const enemyId of wraithCheckEnemies) {
      if (EnemyAI.aiType[enemyId] === EnemyAIType.Wraith) {
        const wraithSprite = getSprite(enemyId);
        if (wraithSprite) {
          wraithSprite.alpha = EnemyAI.state[enemyId] === 1 ? 0.2 : 1.0;
        }
      }
    }

    movementSystem(this.world, deltaSeconds);

    // Process knockback for enemies
    this.processKnockback(deltaSeconds);

    // Keep player on screen
    if (this.playerId !== -1) {
      clampPlayerToScreen(this.world, this.playerId, this.scale.width, this.scale.height);
    }

    // Weapon system (handles all player weapons)
    this.weaponManager.update(this.gameTime, deltaSeconds);

    // XP gem system
    xpGemSystem(this.world, deltaSeconds);

    // Health pickup system
    healthPickupSystem(this.world, deltaSeconds, this.gameTime);

    // Magnet pickup system
    magnetPickupSystem(this.world, deltaSeconds, this.gameTime);

    // Status effect system (burn, freeze, poison damage over time)
    statusEffectSystem(this.world, delta);

    // Update enemy projectiles
    this.updateEnemyProjectiles(deltaSeconds);

    // Check player-enemy collision for damage
    this.checkPlayerEnemyCollision();

    // Sync sprites to ECS positions
    spriteSystem(this.world);

    // Update player plasma core visual effects (squash/stretch, fins, breathing)
    if (this.playerId !== -1 && this.playerPlasmaCore) {
      this.playerPlasmaCore.update(
        Velocity.x[this.playerId],
        Velocity.y[this.playerId],
        deltaSeconds
      );
    }

    // Update grid background with entity positions for warping effect
    this.updateGridBackground(deltaSeconds);

    // Update motion trails for player and fast enemies
    this.updateTrails(deltaSeconds);

    // Update effects (damage numbers, etc.)
    this.effectsManager.update(delta);

    // Update death ripple waves
    this.deathRippleManager.update(deltaSeconds);

    // Update visual quality based on FPS (auto-scaling)
    this.updateVisualQuality(delta);

    // Update HUD
    const bossEntityIds = this.hudManager.getBossEntityIds();
    this.hudManager.update({
      gameTime: this.gameTime,
      deltaSeconds,
      killCount: this.killCount,
      playerLevel: this.playerStats.level,
      xp: this.playerStats.xp,
      xpToNextLevel: this.playerStats.xpToNextLevel,
      currentHP: Health.current[this.playerId],
      maxHP: Health.max[this.playerId],
      hasWon: this.hasWon,
      comboCount: getComboCount(),
      comboTier: getComboTier(),
      comboDecayPercent: getComboDecayPercent(),
      bossHealthData: bossEntityIds.map(entityId => ({
        entityId,
        currentHP: Health.current[entityId],
        maxHP: Health.max[entityId],
      })),
    });
  }

  /**
   * Checks for collision between player and enemies, applies damage.
   */
  private checkPlayerEnemyCollision(): void {
    if (this.playerId === -1 || this.damageCooldown > 0) return;

    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];
    const playerRadius = 16; // Player circle radius
    const enemyRadius = 12; // Average enemy radius

    // OPTIMIZATION: Use FrameCache instead of creating new array
    const enemies = getFrameCacheEnemyIds();

    for (const enemyId of enemies) {
      // Skip phased Wraiths (state 1 = phased, no contact damage)
      if (EnemyAI.aiType[enemyId] === EnemyAIType.Wraith && EnemyAI.state[enemyId] === 1) {
        continue;
      }

      const enemyX = Transform.x[enemyId];
      const enemyY = Transform.y[enemyId];

      const distanceX = playerX - enemyX;
      const distanceY = playerY - enemyY;
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;
      const collisionDistance = playerRadius + enemyRadius;

      if (distanceSquared < collisionDistance * collisionDistance) {
        // Collision! Take damage
        this.takeDamage(EnemyType.baseDamage[enemyId] || 10, enemyId);
        break; // Only one hit per frame
      }
    }
  }

  /**
   * Processes knockback for all entities with Knockback component.
   * Applies velocity and exponential decay.
   */
  private processKnockback(deltaSeconds: number): void {
    const entities = knockbackEnemyQuery(this.world);

    for (const entityId of entities) {
      const velocityX = Knockback.velocityX[entityId];
      const velocityY = Knockback.velocityY[entityId];

      // Apply knockback to position
      Transform.x[entityId] += velocityX * deltaSeconds;
      Transform.y[entityId] += velocityY * deltaSeconds;

      // Clamp to screen bounds so enemies can't be knocked off-screen
      Transform.x[entityId] = Math.max(0, Math.min(this.scale.width, Transform.x[entityId]));
      Transform.y[entityId] = Math.max(0, Math.min(this.scale.height, Transform.y[entityId]));

      // Exponential decay (fast falloff)
      const decay = 0.001;
      const decayFactor = Math.pow(decay, deltaSeconds);
      Knockback.velocityX[entityId] *= decayFactor;
      Knockback.velocityY[entityId] *= decayFactor;

      // Zero out tiny values to prevent drift
      if (Math.abs(Knockback.velocityX[entityId]) < 1) {
        Knockback.velocityX[entityId] = 0;
      }
      if (Math.abs(Knockback.velocityY[entityId]) < 1) {
        Knockback.velocityY[entityId] = 0;
      }
    }
  }

  /**
   * Applies damage to the player with full defensive stat calculations.
   * @param amount Base damage amount
   * @param attackerEntity Optional entity ID for thorns damage
   */
  private takeDamage(amount: number, attackerEntity?: number): void {
    // ═══ SHIELD BARRIER CHECK (binary shield - blocks hit completely) ═══
    if (this.playerStats.shieldBarrierEnabled && this.playerStats.shieldCharges > 0) {
      this.playerStats.shieldCharges--;

      // Visual/audio feedback
      if (this.shieldBarrierVisual) {
        this.shieldBarrierVisual.onHit();
      }
      this.effectsManager.showDamageNumber(
        Transform.x[this.playerId],
        Transform.y[this.playerId] - 30,
        'BLOCKED',
        0x44ffff  // Cyan
      );
      this.soundManager.playPlayerHurt();
      return;  // Damage completely blocked
    }

    // ═══ DASH INVINCIBILITY ═══
    if (this.inputController.isDashActive()) {
      return; // Invincible while dashing
    }

    // ═══ DODGE CHECK ═══
    if (this.playerStats.dodgeChance > 0 && Math.random() < this.playerStats.dodgeChance) {
      // Show dodge text
      this.effectsManager.showDamageNumber(
        Transform.x[this.playerId],
        Transform.y[this.playerId] - 30,
        'DODGE',
        0x00ffff
      );
      return; // Completely avoid damage
    }

    // ═══ PHASE CHECK (while moving) ═══
    if (this.playerStats.phaseChance > 0) {
      const vx = Velocity.x[this.playerId];
      const vy = Velocity.y[this.playerId];
      const isMoving = vx !== 0 || vy !== 0;
      if (isMoving && Math.random() < this.playerStats.phaseChance) {
        this.effectsManager.showDamageNumber(
          Transform.x[this.playerId],
          Transform.y[this.playerId] - 30,
          'PHASE',
          0xff00ff
        );
        return;
      }
    }

    // ═══ CALCULATE REDUCED DAMAGE ═══
    let reducedDamage = amount;

    // Apply armor (flat reduction)
    if (this.playerStats.armor > 0) {
      reducedDamage = Math.max(1, reducedDamage - this.playerStats.armor);
    }

    // Apply damage cap (max damage as % of max HP)
    if (this.playerStats.damageCap < 1.0) {
      const maxDamage = this.playerStats.maxHealth * this.playerStats.damageCap;
      reducedDamage = Math.min(reducedDamage, maxDamage);
    }

    // ═══ SHIELD ABSORPTION ═══
    if (this.playerStats.shield > 0) {
      if (this.playerStats.shield >= reducedDamage) {
        // Shield absorbs all damage
        this.playerStats.shield -= reducedDamage;
        this.effectsManager.showDamageNumber(
          Transform.x[this.playerId],
          Transform.y[this.playerId] - 30,
          `SHIELD -${Math.floor(reducedDamage)}`,
          0x00aaff
        );
        reducedDamage = 0;
      } else {
        // Shield absorbs partial damage
        reducedDamage -= this.playerStats.shield;
        this.playerStats.shield = 0;
        this.effectsManager.showDamageNumber(
          Transform.x[this.playerId],
          Transform.y[this.playerId] - 30,
          'SHIELD BROKE',
          0x00aaff
        );
      }
    }

    // If no damage left after shield, return early
    if (reducedDamage <= 0) {
      return;
    }

    // ═══ APPLY DAMAGE ═══
    Health.current[this.playerId] -= reducedDamage;
    this.playerStats.currentHealth = Health.current[this.playerId];

    // Track damage for Health-Adaptive auto-upgrade intelligence (tier 3)
    this.recentDamageTaken += reducedDamage;
    this.isHealthStruggling = this.recentDamageTaken > this.playerStats.maxHealth * 0.5;

    // Track damage taken for achievements (perfect run tracking)
    this.totalDamageTaken += reducedDamage;
    const remainingHpPercent = this.playerStats.currentHealth / this.playerStats.maxHealth;
    getAchievementManager().recordDamageTaken(reducedDamage, remainingHpPercent);

    // Use iframeDuration from playerStats instead of hardcoded value
    this.damageCooldown = this.playerStats.iframeDuration;

    // Play hurt sound
    this.soundManager.playPlayerHurt();

    // Geometry Wars-style impact feedback
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.cameras.main.shake(100, 0.008);
    }
    this.effectsManager.playImpactFlash(0.15, 60);

    // ═══ THORNS DAMAGE ═══
    if (this.playerStats.thornsPercent > 0 && attackerEntity !== undefined) {
      const thornsDamage = Math.floor(amount * this.playerStats.thornsPercent);
      if (thornsDamage > 0 && hasComponent(this.world, Health, attackerEntity)) {
        Health.current[attackerEntity] -= thornsDamage;
        this.totalDamageDealt += thornsDamage;
        getAchievementManager().recordDamageDealt(thornsDamage);
        // Visual feedback for thorns
        this.effectsManager.showDamageNumber(
          Transform.x[attackerEntity],
          Transform.y[attackerEntity] - 20,
          thornsDamage,
          0xff8800 // Orange for thorns
        );
      }
    }

    // ═══ CHECK FOR DEATH ═══
    if (Health.current[this.playerId] <= 0) {
      // ═══ REVIVAL CHECK ═══
      if (this.playerStats.revivals > 0) {
        this.playerStats.revivals--;
        // Revive at 50% HP
        const reviveHP = Math.floor(this.playerStats.maxHealth * 0.5);
        Health.current[this.playerId] = reviveHP;
        this.playerStats.currentHealth = reviveHP;

        // Visual feedback for revival
        this.effectsManager.showDamageNumber(
          Transform.x[this.playerId],
          Transform.y[this.playerId] - 40,
          'REVIVED!',
          0xffff00
        );
        this.cameras.main.flash(500, 255, 255, 100);

        // Brief invincibility after revival
        this.damageCooldown = 2.0;
        return;
      }

      Health.current[this.playerId] = 0;
      this.playerStats.currentHealth = 0;
      // Big shake on death
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(400, 0.03);
      }
      this.effectsManager.playImpactFlash(0.4, 200);
      this.gameOver();
    }
  }

  /**
   * Heals the player with healingBoost multiplier applied.
   */
  private healPlayer(amount: number): void {
    if (this.playerId === -1) return;

    // Apply healing boost multiplier
    const boostedAmount = amount * this.playerStats.healingBoost;

    const currentHP = Health.current[this.playerId];
    const maxHP = Health.max[this.playerId];

    Health.current[this.playerId] = Math.min(currentHP + boostedAmount, maxHP);
    this.playerStats.currentHealth = Health.current[this.playerId];

    // Flash player green briefly
    const playerSprite = this.children.list.find(
      (child) => child instanceof Phaser.GameObjects.Arc
    ) as Phaser.GameObjects.Arc | undefined;

    if (playerSprite) {
      playerSprite.setFillStyle(0x88ddff); // Bright cyan-blue heal flash
      this.time.delayedCall(150, () => {
        playerSprite.setFillStyle(0x4488ff); // Return to normal blue
      });
    }
  }

  /**
   * Triggers the gem magnet effect, pulling all XP gems toward the player.
   * Called at intervals based on the gem magnet permanent upgrade.
   */
  private triggerGemMagnet(): void {
    magnetizeAllGems(this.world);

    // Visual feedback - brief screen pulse
    this.effectsManager.playImpactFlash(0.1, 100);
  }

  /**
   * Draws a treasure chest graphic with body, lid, and lock details.
   */
  private drawTreasureChest(graphics: Phaser.GameObjects.Graphics): void {
    const bodyWidth = 28;
    const bodyHeight = 14;
    const lidHeight = 8;
    const lockWidth = 8;
    const lockHeight = 6;

    // Body shadow (3D depth effect)
    graphics.fillStyle(0x8b4513, 0.5);
    graphics.fillRoundedRect(-bodyWidth / 2 + 2, lidHeight / 2 + 2, bodyWidth, bodyHeight, 2);

    // Main body fill
    graphics.fillStyle(0xffd700, 1);
    graphics.fillRoundedRect(-bodyWidth / 2, lidHeight / 2, bodyWidth, bodyHeight, 2);

    // Body right-side shading for 3D effect
    graphics.fillStyle(0xb8860b, 0.4);
    graphics.fillRect(bodyWidth / 2 - 4, lidHeight / 2, 4, bodyHeight);

    // Body outline
    graphics.lineStyle(1.5, 0x8b4513, 1);
    graphics.strokeRoundedRect(-bodyWidth / 2, lidHeight / 2, bodyWidth, bodyHeight, 2);

    // Lid base (darker gold)
    graphics.fillStyle(0xc9a800, 1);
    graphics.fillRoundedRect(-bodyWidth / 2, -lidHeight / 2, bodyWidth, lidHeight, { tl: 4, tr: 4, bl: 0, br: 0 });

    // Lid highlight (top lighter area)
    graphics.fillStyle(0xffdf40, 0.6);
    graphics.fillRoundedRect(-bodyWidth / 2 + 2, -lidHeight / 2 + 1, bodyWidth - 4, lidHeight / 2, { tl: 3, tr: 3, bl: 0, br: 0 });

    // Lid outline
    graphics.lineStyle(1.5, 0x8b4513, 1);
    graphics.strokeRoundedRect(-bodyWidth / 2, -lidHeight / 2, bodyWidth, lidHeight, { tl: 4, tr: 4, bl: 0, br: 0 });

    // Separation line between lid and body
    graphics.lineStyle(2, 0x8b4513, 0.8);
    graphics.lineBetween(-bodyWidth / 2, lidHeight / 2, bodyWidth / 2, lidHeight / 2);

    // Lock plate (silver rectangle)
    graphics.fillStyle(0xaaaaaa, 1);
    graphics.fillRect(-lockWidth / 2, -lockHeight / 2 + lidHeight / 4, lockWidth, lockHeight);

    // Lock plate border
    graphics.lineStyle(1, 0x555555, 1);
    graphics.strokeRect(-lockWidth / 2, -lockHeight / 2 + lidHeight / 4, lockWidth, lockHeight);

    // Keyhole (dark circle)
    graphics.fillStyle(0x333333, 1);
    graphics.fillCircle(0, lidHeight / 4, 2);

    // Decorative metal band across body
    graphics.lineStyle(1, 0xb8860b, 0.6);
    graphics.lineBetween(-bodyWidth / 2, lidHeight / 2 + bodyHeight / 2, bodyWidth / 2, lidHeight / 2 + bodyHeight / 2);
  }

  /**
   * Spawns a treasure chest at a random location within the play area.
   * When collected (player gets close), it spawns multiple XP gems.
   */
  private spawnTreasureChest(): void {
    // Spawn at random location within screen (avoiding edges)
    const padding = 80;
    const x = padding + Math.random() * (this.scale.width - padding * 2);
    const y = padding + Math.random() * (this.scale.height - padding * 2);

    // 15% chance for a special chest with 3x rewards
    const isSpecial = Math.random() < 0.15;

    // Create visual chest using Graphics for detailed drawing
    const chestGraphics = this.add.graphics();
    chestGraphics.setPosition(x, y);
    this.drawTreasureChest(chestGraphics);
    chestGraphics.setDepth(5);

    // Pulsating effect (and gold sparkles for special chests)
    const updatePulse = () => {
      if (!chestGraphics.active) return;
      const pulseScale = 0.95 + Math.sin(this.time.now * 0.008) * 0.05;
      chestGraphics.setScale(pulseScale);

      // Special chests emit gold sparkles continuously
      if (isSpecial) {
        this.effectsManager.playGoldSparkle(chestGraphics.x, chestGraphics.y, 2);
      }
    };
    const pulseTimer = this.time.addEvent({
      delay: 50,
      callback: updatePulse,
      loop: true,
    });

    // Check for player collection each frame
    const collectCheck = this.time.addEvent({
      delay: 100,
      callback: () => {
        if (!chestGraphics.active || this.playerId === -1) return;

        const playerX = Transform.x[this.playerId];
        const playerY = Transform.y[this.playerId];
        const dx = playerX - chestGraphics.x;
        const dy = playerY - chestGraphics.y;
        const distSq = dx * dx + dy * dy;
        const collectRadius = 40;

        if (distSq < collectRadius * collectRadius) {
          // Collect treasure! Spawn multiple XP gems (10x for special chests)
          // World level substantially increases rewards: gem count scales with world level,
          // and gem value also scales with world level XP multiplier
          const baseGemCount = 5 + Math.floor(Math.random() * 5); // 5-9 gems
          const rarityMultiplier = isSpecial ? 10 : 1;
          const gemCount = Math.floor(baseGemCount * rarityMultiplier * this.worldLevel);
          const baseGemValue = 10 + Math.floor(this.gameTime * 0.1);
          const gemValue = Math.floor(baseGemValue * this.worldLevel * this.worldLevelXPMult);
          for (let i = 0; i < gemCount; i++) {
            const angle = (i / gemCount) * Math.PI * 2;
            const spreadRadius = 30 + (gemCount > 20 ? 20 : 0); // Wider spread for many gems
            const offsetX = Math.cos(angle) * spreadRadius;
            const offsetY = Math.sin(angle) * spreadRadius;
            spawnXPGem(this.world, chestGraphics.x + offsetX, chestGraphics.y + offsetY, gemValue);
          }

          // Visual and audio feedback (bigger burst for special)
          this.effectsManager.playDeathBurst(chestGraphics.x, chestGraphics.y);
          if (isSpecial) {
            this.effectsManager.playGoldSparkle(chestGraphics.x, chestGraphics.y, 15);
          }
          this.soundManager.playLevelUp();

          // Clean up
          pulseTimer.destroy();
          collectCheck.destroy();
          chestGraphics.destroy();
        }
      },
      loop: true,
    });

    // Auto-despawn after 30 seconds if not collected
    this.time.delayedCall(30000, () => {
      if (chestGraphics.active) {
        pulseTimer.destroy();
        collectCheck.destroy();
        chestGraphics.destroy();
      }
    });
  }

  /**
   * Creates a PauseMenuManager with appropriate callbacks.
   * Used in both fresh start and restore create paths.
   */
  private createPauseMenuManager(): PauseMenuManager {
    return new PauseMenuManager(this, {
      onPauseStateChanged: (isPaused: boolean) => {
        this.isPaused = isPaused;
      },
      onRestart: () => {
        this.scene.restart();
      },
      onQuitToMenu: () => {
        this.scene.start('BootScene');
      },
      onQuitToShop: () => {
        this.scene.start('ShopScene');
      },
      onOpenSettings: () => {
        this.isPaused = true; // Keep paused while in settings
        this.scene.launch('SettingsScene', { returnTo: 'GameScene' });
        this.scene.pause();
      },
      onContinueRun: () => {
        // Enable endless mode spawning
        this.endlessModeActive = true;
        this.endlessModeTime = 0;
        this.endlessMinibossTimer = 60;   // First miniboss in 60 seconds
        this.endlessBossTimer = 600;      // First boss wave in 10 minutes
        console.log('[Endless Mode] Activated - miniboss in 60s, boss in 600s');

        // Reset grid physics - boss death applies massive forces that springs can't recover from
        this.gridBackground.reset();

        // Resume gameplay
        this.isPaused = false;
      },
      onNextWorld: (goldAmount: number) => {
        // Award gold (world level already advanced before showVictory was called)
        const metaManager = getMetaProgressionManager();
        metaManager.addGold(goldAmount);

        // Restart scene for fresh run at new world level
        this.scene.restart();
      },
      getGameState: () => ({
        killCount: this.killCount,
        gameTime: this.gameTime,
        playerLevel: this.playerStats.level,
        hasWon: this.hasWon,
        isGameOver: this.isGameOver,
        isPaused: this.isPaused,
        isPauseMenuOpen: this.pauseMenuManager?.isPauseMenuOpen ?? false,
      }),
    });
  }

  /**
   * Toggles the pause menu on/off.
   * Delegates to PauseMenuManager.
   */
  private togglePauseMenu(): void {
    this.pauseMenuManager.togglePauseMenu();
  }

  /**
   * Called by SettingsScene when returning to GameScene.
   * Ensures the pause menu is shown reliably (doesn't rely on resume event).
   */
  public showPauseMenuFromSettings(): void {
    this.pauseMenuManager.showPauseMenuFromSettings();
  }

  /**
   * Shows victory screen when player defeats boss.
   * Handles achievement recording, streak management, and delegates UI to PauseMenuManager.
   */
  private showVictory(): void {
    this.hasWon = true;
    this.isPaused = true;

    // Clear saved game state (run is over - victory!)
    getGameStateManager().clearSave();

    // Record run end for achievements
    const metaManager = getMetaProgressionManager();
    const goldEarned = metaManager.calculateRunGold(
      this.killCount,
      this.gameTime,
      this.playerStats.level,
      true // hasWon
    );
    getAchievementManager().recordRunEnd({
      wasVictory: true,
      killCount: this.killCount,
      levelReached: this.playerStats.level,
      survivalTimeSeconds: this.gameTime,
      worldLevel: metaManager.getWorldLevel(),
      damageDealt: this.totalDamageDealt,
      damageTaken: this.totalDamageTaken,
      goldEarned,
      accountLevel: metaManager.getAccountLevel(),
      bestStreak: metaManager.getBestStreak(),
    });

    // Record run end statistics in codex
    getCodexManager().recordRunEnd(
      this.gameTime,
      this.killCount,
      this.totalDamageDealt,
      goldEarned,
      true, // wasVictory
      metaManager.getWorldLevel(),
      this.playerStats.level
    );

    // Capture streak before incrementing for display
    const previousStreak = metaManager.getCurrentStreak();
    // Increment win streak on victory
    metaManager.incrementStreak();
    const newStreak = metaManager.getCurrentStreak();

    // Get world level (already advanced before showVictory is called)
    const newWorldLevel = metaManager.getWorldLevel();
    const clearedWorld = newWorldLevel - 1;

    this.pauseMenuManager.showVictory({
      killCount: this.killCount,
      gameTime: this.gameTime,
      playerLevel: this.playerStats.level,
      goldEarned,
      clearedWorld,
      newWorldLevel,
      previousStreak,
      newStreak,
      streakBonusPercent: metaManager.getStreakBonusPercent(),
    });
  }

  /**
   * Handles game over state.
   * Performs gold calculation, streak management, and delegates UI to PauseMenuManager.
   */
  private gameOver(): void {
    this.isGameOver = true;

    // Clean up boss warning elements
    this.cleanupBossWarning();

    // Clear saved game state (run is over)
    getGameStateManager().clearSave();

    // Calculate and award gold
    const metaManager = getMetaProgressionManager();

    // Capture streak state before any changes
    const previousStreak = metaManager.getCurrentStreak();

    // Break streak if player died (didn't win)
    // Note: Victory streak increment happens in showVictory(), not here
    if (!this.hasWon) {
      metaManager.breakStreak();
    }

    // Calculate gold (after streak update so multiplier is current)
    const goldEarned = metaManager.calculateRunGold(
      this.killCount,
      this.gameTime,
      this.playerStats.level,
      this.hasWon
    );
    metaManager.addGold(goldEarned);

    // Record run end statistics (only if not already recorded in showVictory)
    if (!this.hasWon) {
      getAchievementManager().recordRunEnd({
        wasVictory: false,
        killCount: this.killCount,
        levelReached: this.playerStats.level,
        survivalTimeSeconds: this.gameTime,
        worldLevel: metaManager.getWorldLevel(),
        damageDealt: this.totalDamageDealt,
        damageTaken: this.totalDamageTaken,
        goldEarned,
        accountLevel: metaManager.getAccountLevel(),
        bestStreak: metaManager.getBestStreak(),
      });

      getCodexManager().recordRunEnd(
        this.gameTime,
        this.killCount,
        this.totalDamageDealt,
        goldEarned,
        false, // wasVictory
        metaManager.getWorldLevel(),
        this.playerStats.level
      );
    }

    this.pauseMenuManager.gameOver({
      killCount: this.killCount,
      gameTime: this.gameTime,
      playerLevel: this.playerStats.level,
      goldEarned,
      previousStreak,
      highestCombo: getHighestCombo(),
      totalDamageDealt: this.totalDamageDealt,
      totalDamageTaken: this.totalDamageTaken,
    });
  }

  private createPlayer(x: number, y: number): number {
    const entityId = addEntity(this.world);

    // Add components
    addComponent(this.world, Transform, entityId);
    addComponent(this.world, Velocity, entityId);
    addComponent(this.world, Health, entityId);
    addComponent(this.world, PlayerTag, entityId);
    addComponent(this.world, SpriteRef, entityId);

    // Set component values
    Transform.x[entityId] = x;
    Transform.y[entityId] = y;
    Transform.rotation[entityId] = 0;

    Velocity.x[entityId] = 0;
    Velocity.y[entityId] = 0;
    Velocity.speed[entityId] = 200; // Pixels per second

    Health.current[entityId] = 100;
    Health.max[entityId] = 100;

    // Create visual - animated plasma core with velocity-responsive effects
    this.playerPlasmaCore = new PlayerPlasmaCore(this, x, y, {
      baseRadius: 16,
      neonColor: PLAYER_NEON,
      quality: this.visualQuality,
    }, this.playerStats.level);
    const playerVisual = this.playerPlasmaCore.getContainer();
    playerVisual.setDepth(10);
    registerSprite(entityId, playerVisual);

    return entityId;
  }

  private spawnEnemy(typeOverride?: EnemyTypeDefinition): void {
    // Get enemy type based on game time or override (world level makes elites spawn earlier)
    const enemyType = typeOverride || getRandomEnemyType(this.gameTime, this.worldLevelSpawnReduction, this.worldLevel);
    // Scale stats with both time and world level multipliers
    const scaledStats = getScaledStats(enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);

    // Spawn at random edge of screen (outside visible area)
    const side = Phaser.Math.Between(0, 3);
    let x: number;
    let y: number;
    const spawnOffset = 30;

    switch (side) {
      case 0: // Left
        x = -spawnOffset;
        y = Phaser.Math.Between(0, this.scale.height);
        break;
      case 1: // Right
        x = this.scale.width + spawnOffset;
        y = Phaser.Math.Between(0, this.scale.height);
        break;
      case 2: // Top
        x = Phaser.Math.Between(0, this.scale.width);
        y = -spawnOffset;
        break;
      default: // Bottom
        x = Phaser.Math.Between(0, this.scale.width);
        y = this.scale.height + spawnOffset;
        break;
    }

    this.createEnemy(x, y, enemyType, scaledStats);
  }

  /**
   * Creates an enemy at the specified position with the given type.
   */
  private createEnemy(
    x: number,
    y: number,
    enemyType: EnemyTypeDefinition,
    scaledStats: { health: number; speed: number; damage: number }
  ): number {
    const entityId = addEntity(this.world);

    // ═══ CURSE MULTIPLIER (enemies are stronger, but give more rewards) ═══
    const curseMult = this.playerStats.curseMultiplier;
    const cursedHealth = scaledStats.health * curseMult;
    const cursedDamage = scaledStats.damage * curseMult;

    // Add components
    addComponent(this.world, Transform, entityId);
    addComponent(this.world, Velocity, entityId);
    addComponent(this.world, Health, entityId);
    addComponent(this.world, EnemyTag, entityId);
    addComponent(this.world, SpriteRef, entityId);
    addComponent(this.world, Knockback, entityId);
    addComponent(this.world, EnemyAI, entityId);
    addComponent(this.world, EnemyType, entityId);

    // Set transform
    Transform.x[entityId] = x;
    Transform.y[entityId] = y;
    Transform.rotation[entityId] = 0;

    // Set velocity
    Velocity.x[entityId] = 0;
    Velocity.y[entityId] = 0;
    Velocity.speed[entityId] = scaledStats.speed * (0.9 + Math.random() * 0.2);

    // Initialize knockback
    Knockback.velocityX[entityId] = 0;
    Knockback.velocityY[entityId] = 0;
    Knockback.decay[entityId] = enemyType.size > 1.5 ? 0.0005 : 0.001; // Bigger enemies resist knockback

    // Set health (with curse multiplier)
    Health.current[entityId] = cursedHealth;
    Health.max[entityId] = cursedHealth;

    // Set AI properties
    EnemyAI.aiType[entityId] = enemyType.aiType;
    EnemyAI.state[entityId] = 0;
    EnemyAI.timer[entityId] = 0;
    EnemyAI.phase[entityId] = Math.random() * Math.PI * 2; // Random start phase
    EnemyAI.shootTimer[entityId] = enemyType.shootCooldown || 2.0;
    EnemyAI.specialTimer[entityId] = 1.0 + Math.random();

    // Set enemy type properties (with curse multiplier for damage)
    EnemyType.baseHealth[entityId] = cursedHealth;
    EnemyType.baseDamage[entityId] = cursedDamage;
    EnemyType.xpValue[entityId] = enemyType.xpValue;
    EnemyType.size[entityId] = enemyType.size;  // Store visual size for grid warping weight

    // Build flags
    let flags = 0;
    if (enemyType.explodeOnDeath) flags |= EnemyFlags.EXPLODES_ON_DEATH;
    if (enemyType.splitsOnDeath) flags |= EnemyFlags.SPLITS_ON_DEATH;
    if (enemyType.canShoot) flags |= EnemyFlags.CAN_SHOOT;
    if (enemyType.healsAllies) flags |= EnemyFlags.HEALS_ALLIES;
    if (enemyType.hasShield) flags |= EnemyFlags.HAS_SHIELD;
    if (enemyType.shape === 'triangle') flags |= EnemyFlags.NO_TRAIL;
    EnemyType.flags[entityId] = flags;

    // Shield properties
    if (enemyType.hasShield) {
      const shieldHP = (enemyType.shieldHealth || 30) * (1 + this.gameTime * 0.01);
      EnemyType.shieldCurrent[entityId] = shieldHP;
      EnemyType.shieldMax[entityId] = shieldHP;
      EnemyType.shieldRegenTimer[entityId] = 0;
    } else {
      EnemyType.shieldCurrent[entityId] = 0;
      EnemyType.shieldMax[entityId] = 0;
    }

    // Create visual based on type
    const sprite = this.createEnemyVisual(x, y, enemyType);
    registerSprite(entityId, sprite);
    this.deathRippleManager.registerEnemy(entityId, enemyType.shape, 10 * enemyType.size);

    // Track enemy discovery in the codex (first encounter triggers discovery)
    getCodexManager().discoverEnemy(enemyType.id, enemyType.name);

    // Store entity ID to enemy type ID mapping for codex kill tracking
    this.enemyTypeMap.set(entityId, enemyType.id);

    this.enemyCount++;
    return entityId;
  }

  /**
   * Spawns a minion enemy at a specific position (used by SwarmMother, Necromancer).
   */
  private spawnMinionEnemy(x: number, y: number, typeId: string): void {
    const enemyType = getEnemyType(typeId);
    if (!enemyType) return;

    // Don't exceed max enemies
    if (this.enemyCount >= this.maxEnemies) return;

    // Scale stats with both time and world level multipliers
    const scaledStats = getScaledStats(enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);
    this.createEnemy(x, y, enemyType, scaledStats);
  }

  /**
   * Spawns a miniboss at a random screen edge.
   * Handles special cases like the Twins which spawn as a pair.
   */
  private spawnMiniboss(typeId: string): void {
    const enemyType = getEnemyType(typeId);
    if (!enemyType) return;

    // Spawn at random screen edge
    const side = Phaser.Math.Between(0, 3);
    let x: number;
    let y: number;
    const spawnOffset = 50;

    switch (side) {
      case 0: x = -spawnOffset; y = Phaser.Math.Between(100, this.scale.height - 100); break;
      case 1: x = this.scale.width + spawnOffset; y = Phaser.Math.Between(100, this.scale.height - 100); break;
      case 2: x = Phaser.Math.Between(100, this.scale.width - 100); y = -spawnOffset; break;
      default: x = Phaser.Math.Between(100, this.scale.width - 100); y = this.scale.height + spawnOffset; break;
    }

    // Scale stats with both time and world level multipliers
    const scaledStats = getScaledStats(enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);

    // Special case: Twins spawn as a pair
    if (typeId === 'twin_a') {
      const twinA = this.createEnemy(x, y, enemyType, scaledStats);

      // Create health bar for Twin A
      this.hudManager.createBossHealthBar(twinA, enemyType.name, false);

      // Spawn Twin B nearby
      const twinBType = getEnemyType('twin_b');
      if (twinBType) {
        const offsetAngle = Math.random() * Math.PI * 2;
        const twinBX = x + Math.cos(offsetAngle) * 60;
        const twinBY = y + Math.sin(offsetAngle) * 60;
        const twinBStats = getScaledStats(twinBType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);
        const twinB = this.createEnemy(twinBX, twinBY, twinBType, twinBStats);

        // Create health bar for Twin B
        this.hudManager.createBossHealthBar(twinB, twinBType.name, false);

        // Link the twins
        linkTwins(twinA, twinB);
      }
    } else {
      const entityId = this.createEnemy(x, y, enemyType, scaledStats);

      // Create health bar for the miniboss
      this.hudManager.createBossHealthBar(entityId, enemyType.name, false);
    }

    // Reposition all boss health bars
    this.hudManager.repositionBossHealthBars();

    // Screen shake effect for miniboss spawn
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.cameras.main.shake(200, 0.005);
    }

    // Announce miniboss spawn with visual effect
    this.showMinibossWarning(enemyType.name);
  }

  /**
   * Shows a warning when a miniboss spawns.
   */
  private showMinibossWarning(name: string): void {
    this.soundManager.playBossWarning();
    const warningText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 50, `⚠️ ${name} approaches! ⚠️`, {
      fontSize: '24px',
      color: '#ff4444',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 4,
    });
    warningText.setOrigin(0.5);
    warningText.setDepth(100);

    // Animate and fade out
    this.tweens.add({
      targets: warningText,
      y: this.scale.height / 2 - 100,
      alpha: 0,
      duration: 2000,
      ease: 'Power2',
      onComplete: () => warningText.destroy(),
    });
  }

  /**
   * Check and spawn minibosses based on game time.
   */
  private checkMinibossSpawns(): void {
    for (const minibossEntry of this.minibossSpawnTimes) {
      if (!minibossEntry.spawned && this.gameTime >= minibossEntry.time) {
        minibossEntry.spawned = true;
        this.spawnMiniboss(minibossEntry.typeId);
      }
    }
  }

  /**
   * Updates the boss warning sequence, showing escalating warnings as the boss spawn time approaches.
   * Phase 1 at 2 min before boss, Phase 2 at 1 min, Phase 3 at 30 sec.
   */
  private updateBossWarning(_deltaSeconds: number): void {
    if (this.endlessModeActive || this.bossSpawned || this.bossSpawnTime <= 0) return;

    const warningDepth = PAUSE_MENU_DEPTH - 50;
    const screenCenterX = this.scale.width / 2;
    const screenCenterY = this.scale.height / 2;

    // Phase 1: "Something stirs in the void..." at bossSpawnTime - 120 (e.g. 8:00)
    if (this.bossWarningPhase < 1 && this.gameTime >= this.bossSpawnTime - 120) {
      this.bossWarningPhase = 1;

      // Destroy any existing warning text before creating new one
      if (this.bossWarningText) {
        this.bossWarningText.destroy();
      }

      this.bossWarningText = this.add.text(screenCenterX, screenCenterY, 'Something stirs in the void...', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffdd44',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
      }).setOrigin(0.5).setDepth(warningDepth).setAlpha(0);

      this.tweens.add({
        targets: this.bossWarningText,
        alpha: 1,
        duration: 500,
        ease: 'Sine.easeIn',
        onComplete: () => {
          // Hold for 2500ms then fade out
          this.time.delayedCall(2500, () => {
            if (this.bossWarningText) {
              this.tweens.add({
                targets: this.bossWarningText,
                alpha: 0,
                duration: 500,
                ease: 'Sine.easeOut',
              });
            }
          });
        },
      });
    }

    // Phase 2: "The ground trembles..." at bossSpawnTime - 60 (e.g. 9:00)
    if (this.bossWarningPhase < 2 && this.gameTime >= this.bossSpawnTime - 60) {
      this.bossWarningPhase = 2;

      // Destroy any existing warning text before creating new one
      if (this.bossWarningText) {
        this.bossWarningText.destroy();
      }

      this.bossWarningText = this.add.text(screenCenterX, screenCenterY, 'The ground trembles...', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ff8844',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
      }).setOrigin(0.5).setDepth(warningDepth).setAlpha(0);

      this.tweens.add({
        targets: this.bossWarningText,
        alpha: 1,
        duration: 500,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.time.delayedCall(2500, () => {
            if (this.bossWarningText) {
              this.tweens.add({
                targets: this.bossWarningText,
                alpha: 0,
                duration: 500,
                ease: 'Sine.easeOut',
              });
            }
          });
        },
      });

      // Create vignette overlay (semi-transparent dark edges)
      if (!this.bossWarningVignette) {
        this.bossWarningVignette = this.add.graphics();
        this.bossWarningVignette.setDepth(warningDepth);
      }
      const vignetteThickness = 80;
      const screenWidth = this.scale.width;
      const screenHeight = this.scale.height;
      this.bossWarningVignette.clear();
      this.bossWarningVignette.fillStyle(0x000000, 0.15);
      // Top edge
      this.bossWarningVignette.fillRect(0, 0, screenWidth, vignetteThickness);
      // Bottom edge
      this.bossWarningVignette.fillRect(0, screenHeight - vignetteThickness, screenWidth, vignetteThickness);
      // Left edge
      this.bossWarningVignette.fillRect(0, vignetteThickness, vignetteThickness, screenHeight - vignetteThickness * 2);
      // Right edge
      this.bossWarningVignette.fillRect(screenWidth - vignetteThickness, vignetteThickness, vignetteThickness, screenHeight - vignetteThickness * 2);
    }

    // Phase 3: "BOSS INCOMING" at bossSpawnTime - 5
    if (this.bossWarningPhase < 3 && this.gameTime >= this.bossSpawnTime - 5) {
      this.bossWarningPhase = 3;
      this.soundManager.playBossWarning();

      // Destroy any existing warning text before creating new one
      if (this.bossWarningText) {
        this.bossWarningText.destroy();
      }

      this.bossWarningText = this.add.text(screenCenterX, screenCenterY, 'BOSS INCOMING', {
        fontFamily: 'monospace',
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#ff4444',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center',
      }).setOrigin(0.5).setDepth(warningDepth).setAlpha(0);

      // Pulsing alpha tween (yoyo loop)
      this.tweens.add({
        targets: this.bossWarningText,
        alpha: { from: 0.3, to: 1 },
        duration: 600,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });

      // Intensify vignette (increase alpha to 0.3)
      if (this.bossWarningVignette) {
        const vignetteThickness = 80;
        const screenWidth = this.scale.width;
        const screenHeight = this.scale.height;
        this.bossWarningVignette.clear();
        this.bossWarningVignette.fillStyle(0x000000, 0.3);
        // Top edge
        this.bossWarningVignette.fillRect(0, 0, screenWidth, vignetteThickness);
        // Bottom edge
        this.bossWarningVignette.fillRect(0, screenHeight - vignetteThickness, screenWidth, vignetteThickness);
        // Left edge
        this.bossWarningVignette.fillRect(0, vignetteThickness, vignetteThickness, screenHeight - vignetteThickness * 2);
        // Right edge
        this.bossWarningVignette.fillRect(screenWidth - vignetteThickness, vignetteThickness, vignetteThickness, screenHeight - vignetteThickness * 2);
      }
    }
  }

  /**
   * Cleans up boss warning text, vignette, and related tweens.
   */
  private cleanupBossWarning(): void {
    if (this.bossWarningText) {
      this.tweens.killTweensOf(this.bossWarningText);
      this.bossWarningText.destroy();
      this.bossWarningText = null;
    }
    if (this.bossWarningVignette) {
      this.bossWarningVignette.destroy();
      this.bossWarningVignette = null;
    }
  }

  /**
   * Handles combo threshold rewards (XP burst, damage boost, annihilation pulse).
   */
  private handleComboThreshold(threshold: { count: number; type: string }): void {
    if (!this.toastManager) return;
    if (threshold.type === 'xp_burst') {
      // Award bonus XP
      this.playerStats.xp += 50;
      this.toastManager.showToast({
        title: `COMBO x${threshold.count}`,
        description: 'XP Burst!',
        icon: 'lightning',
        color: 0xffdd44,
        duration: 2000,
      });
      this.soundManager.playPickupXP(50);
    } else if (threshold.type === 'damage_boost') {
      // Damage buff is managed by ComboSystem's activeThresholdEffects
      this.toastManager.showToast({
        title: `COMBO x${threshold.count}`,
        description: 'Power Surge! +50% damage',
        icon: 'sword',
        color: 0xff8844,
        duration: 3000,
      });
      this.soundManager.playLevelUp();
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(150, 0.01);
      }
    } else if (threshold.type === 'annihilation') {
      // Screen-wide damage pulse — apply damage directly via ECS
      const enemies = getFrameCacheEnemyIds();
      for (const enemyId of enemies) {
        if (hasComponent(this.world, Health, enemyId)) {
          Health.current[enemyId] -= 50;
          if (Health.current[enemyId] <= 0) {
            const enemyX = Transform.x[enemyId];
            const enemyY = Transform.y[enemyId];
            this.handleEnemyDeath(enemyId, enemyX, enemyY);
            const sprite = getSprite(enemyId);
            if (sprite) sprite.destroy();
            unregisterSprite(enemyId);
            removeEntity(this.world, enemyId);
          }
        }
      }
      this.toastManager.showToast({
        title: `COMBO x${threshold.count}`,
        description: 'ANNIHILATION!',
        icon: 'explosion',
        color: 0xff2244,
        duration: 3000,
      });
      this.soundManager.playLevelUp();
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(300, 0.025);
      }
      this.effectsManager.playImpactFlash(0.2, 80);
    }
  }

  /**
   * Handles a triggered run event by applying its effects and showing a banner.
   */
  private handleRunEvent(event: RunEvent): void {
    // Show event banner
    this.showEventBanner(event);

    // Show persistent duration indicator for timed events
    if (event.duration > 0) {
      this.hudManager.createEventIndicator(event);
    }

    switch (event.id) {
      case 'elite_surge':
        // Double spawn rate for duration — halve spawn interval temporarily
        this.spawnInterval = Math.max(0.15, this.spawnInterval * 0.5);
        this.playerStats.xpMultiplier *= 2;
        this.time.delayedCall(event.duration * 1000, () => {
          this.spawnInterval = Math.max(0.3, 1.0 - this.gameTime * 0.01);
          this.playerStats.xpMultiplier /= 2;
        });
        break;

      case 'golden_tide':
        // Triple gem value for duration
        this.playerStats.gemValueMultiplier *= 3;
        this.time.delayedCall(event.duration * 1000, () => {
          this.playerStats.gemValueMultiplier /= 3;
        });
        break;

      case 'magnetic_storm':
        // Instant: magnetize all gems
        magnetizeAllGems(this.world);
        break;

      case 'treasure_rain':
        // Instant: spawn 3 treasure chests
        for (let chestIndex = 0; chestIndex < 3; chestIndex++) {
          this.time.delayedCall(chestIndex * 300, () => {
            this.spawnTreasureChest();
          });
        }
        break;

      case 'power_surge':
        // Temporary massive damage boost
        this.playerStats.damageMultiplier *= 2;
        this.syncStatsToPlayer();
        this.time.delayedCall(event.duration * 1000, () => {
          this.playerStats.damageMultiplier /= 2;
          this.syncStatsToPlayer();
        });
        break;
    }
  }

  /**
   * Shows a sliding event banner at the top of the screen.
   */
  private showEventBanner(event: RunEvent): void {
    const bannerWidth = 400;
    const bannerHeight = 50;
    const bannerX = this.scale.width / 2;
    const bannerY = -bannerHeight;
    const bannerDepth = PAUSE_MENU_DEPTH - 60;

    const bannerBg = this.add.rectangle(bannerX, bannerY, bannerWidth, bannerHeight, 0x000000, 0.85);
    bannerBg.setStrokeStyle(2, event.color);
    bannerBg.setDepth(bannerDepth);

    const eventNameText = this.add.text(bannerX, bannerY - 8, event.name, {
      fontSize: '20px',
      color: `#${event.color.toString(16).padStart(6, '0')}`,
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(bannerDepth + 1);

    const eventDescText = this.add.text(bannerX, bannerY + 12, event.description, {
      fontSize: '13px',
      color: '#ccccdd',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(bannerDepth + 1);

    const targetY = bannerHeight / 2 + 10;

    // Slide in
    this.tweens.add({
      targets: [bannerBg, eventNameText, eventDescText],
      y: `+=${targetY - bannerY}`,
      duration: 300,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Hold then slide out
        this.time.delayedCall(2000, () => {
          this.tweens.add({
            targets: [bannerBg, eventNameText, eventDescText],
            y: `-=${targetY - bannerY}`,
            alpha: 0,
            duration: 300,
            ease: 'Sine.easeIn',
            onComplete: () => {
              bannerBg.destroy();
              eventNameText.destroy();
              eventDescText.destroy();
            },
          });
        });
      },
    });
  }

  /**
   * Check if it's time to spawn the boss (at 10 minutes).
   * Bosses cycle through Horde King -> Void Wyrm -> The Machine each run.
   */
  private checkBossSpawn(): void {
    if (this.bossSpawned || this.gameTime < this.bossSpawnTime) return;

    this.bossSpawned = true;

    // Clean up boss warning elements
    this.cleanupBossWarning();

    // Get current boss from cycle
    const bossTypeId = GameScene.bossOrder[GameScene.currentBossIndex];
    GameScene.currentBossIndex = (GameScene.currentBossIndex + 1) % GameScene.bossOrder.length;

    this.spawnBoss(bossTypeId);
  }

  /**
   * Spawns a boss at screen center with dramatic entrance.
   */
  private spawnBoss(typeId: string): void {
    const enemyType = getEnemyType(typeId);
    if (!enemyType) return;

    // Boss spawns at top of screen
    const x = this.scale.width / 2;
    const y = -100;

    // Scale stats with both time and world level multipliers
    const scaledStats = getScaledStats(enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);

    // Double boss health for challenge
    scaledStats.health *= 2;

    const entityId = this.createEnemy(x, y, enemyType, scaledStats);

    // Create health bar for the boss (isFinalBoss = true for purple color)
    this.hudManager.createBossHealthBar(entityId, enemyType.name, true);
    this.hudManager.repositionBossHealthBars();

    // Stronger screen shake for final boss
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.cameras.main.shake(400, 0.01);
    }

    // Show boss entrance
    this.showBossEntrance(enemyType.name);
  }

  /**
   * Shows dramatic boss entrance warning.
   */
  private showBossEntrance(name: string): void {
    // Darken screen briefly
    const overlay = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0.5);
    overlay.setDepth(90);

    // Warning text
    const warningText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 80, 'BOSS BATTLE', {
      fontSize: '32px',
      color: '#ff0000',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 6,
    });
    warningText.setOrigin(0.5);
    warningText.setDepth(100);

    const nameText = this.add.text(this.scale.width / 2, this.scale.height / 2, name, {
      fontSize: '48px',
      color: '#ffcc00',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 6,
    });
    nameText.setOrigin(0.5);
    nameText.setDepth(100);

    // Animate and fade
    this.tweens.add({
      targets: [warningText, nameText],
      alpha: 0,
      duration: 3000,
      ease: 'Power2',
      onComplete: () => {
        warningText.destroy();
        nameText.destroy();
      },
    });

    this.tweens.add({
      targets: overlay,
      alpha: 0,
      duration: 2000,
      ease: 'Power2',
      onComplete: () => overlay.destroy(),
    });
  }

  /**
   * Checks and handles spawns for endless mode (post-victory continuation).
   * Spawns a random miniboss every 60 seconds.
   * Spawns a miniboss + boss every 600 seconds (10 minutes).
   */
  private checkEndlessModeSpawns(deltaSeconds: number): void {
    this.endlessModeTime += deltaSeconds;
    this.endlessMinibossTimer -= deltaSeconds;
    this.endlessBossTimer -= deltaSeconds;

    // Every 60 seconds: spawn random miniboss
    if (this.endlessMinibossTimer <= 0) {
      this.endlessMinibossTimer = 60;
      this.spawnRandomMiniboss();
    }

    // Every 600 seconds: spawn boss + miniboss
    if (this.endlessBossTimer <= 0) {
      this.endlessBossTimer = 600;
      this.spawnRandomMiniboss();
      this.spawnNextBoss();
    }
  }

  /**
   * Spawns a random miniboss for endless mode.
   */
  private spawnRandomMiniboss(): void {
    const minibossIds = ['glutton', 'swarm_mother', 'charger', 'necromancer', 'twin_a'];
    const randomId = minibossIds[Math.floor(Math.random() * minibossIds.length)];
    this.spawnMiniboss(randomId);
  }

  /**
   * Spawns the next boss in the cycle for endless mode.
   * Uses the existing boss rotation: Horde King -> Void Wyrm -> The Machine.
   */
  private spawnNextBoss(): void {
    const bossTypeId = GameScene.bossOrder[GameScene.currentBossIndex];
    GameScene.currentBossIndex = (GameScene.currentBossIndex + 1) % GameScene.bossOrder.length;
    this.spawnBoss(bossTypeId);
  }

  /**
   * Handle ground slam effect from Horde King.
   */
  private handleGroundSlam(x: number, y: number, radius: number, damage: number): void {
    // Visual: expanding shockwave
    const shockwave = this.add.circle(x, y, 20, 0xff6600, 0.8);
    shockwave.setStrokeStyle(4, 0xffaa00);
    shockwave.setDepth(15);

    this.tweens.add({
      targets: shockwave,
      scaleX: radius / 20,
      scaleY: radius / 20,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => shockwave.destroy(),
    });

    // Ground crack effect
    const crack = this.add.graphics();
    crack.setDepth(14);
    crack.lineStyle(3, 0x442200, 1);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
      const length = radius * (0.5 + Math.random() * 0.5);
      crack.moveTo(x, y);
      crack.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    }
    crack.strokePath();

    this.tweens.add({
      targets: crack,
      alpha: 0,
      duration: 1000,
      onComplete: () => crack.destroy(),
    });

    // Check player damage
    if (this.playerId !== -1 && this.damageCooldown <= 0) {
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      const dist = Math.sqrt((playerX - x) ** 2 + (playerY - y) ** 2);

      if (dist < radius) {
        this.takeDamage(damage);

        // Knockback from slam
        const knockbackDir = Math.atan2(playerY - y, playerX - x);
        Knockback.velocityX[this.playerId] = Math.cos(knockbackDir) * 400;
        Knockback.velocityY[this.playerId] = Math.sin(knockbackDir) * 400;
      }
    }

    // Screen shake
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.cameras.main.shake(200, 0.02);
    }
  }

  /**
   * Handle laser beam effect from The Machine.
   */
  private handleLaserBeam(x1: number, y1: number, x2: number, y2: number, damage: number): void {
    // Store laser for rendering
    this.activeLasers.push({ x1, y1, x2, y2, lifetime: 0.1 });

    // Check player collision with laser line
    if (this.playerId !== -1 && this.damageCooldown <= 0) {
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];

      // Point-to-line distance
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const t = Math.max(0, Math.min(1, ((playerX - x1) * dx + (playerY - y1) * dy) / (len * len)));
        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;
        const dist = Math.sqrt((playerX - closestX) ** 2 + (playerY - closestY) ** 2);

        if (dist < 25) {
          this.takeDamage(damage);
        }
      }
    }
  }

  /**
   * Update and render active laser beams.
   */
  private updateLaserBeams(deltaTime: number): void {
    // Update lifetimes and remove expired
    this.activeLasers = this.activeLasers.filter(laser => {
      laser.lifetime -= deltaTime;
      return laser.lifetime > 0;
    });

    // Create pooled graphics object if needed (reuse to avoid per-frame allocation)
    if (!this.laserGraphics) {
      this.laserGraphics = this.add.graphics();
      this.laserGraphics.setDepth(50);
    }

    // Clear previous frame and redraw all lasers
    this.laserGraphics.clear();

    for (const laser of this.activeLasers) {
      // Outer glow
      this.laserGraphics.lineStyle(12, 0xff4400, 0.3);
      this.laserGraphics.lineBetween(laser.x1, laser.y1, laser.x2, laser.y2);

      // Inner beam
      this.laserGraphics.lineStyle(4, 0xff8800, 1);
      this.laserGraphics.lineBetween(laser.x1, laser.y1, laser.x2, laser.y2);

      // Core
      this.laserGraphics.lineStyle(2, 0xffffff, 1);
      this.laserGraphics.lineBetween(laser.x1, laser.y1, laser.x2, laser.y2);
    }
  }

  /**
   * Creates the visual representation for an enemy based on its type.
   * Uses layered glow effects for Geometry Wars neon aesthetic.
   */
  private createEnemyVisual(
    x: number,
    y: number,
    enemyType: EnemyTypeDefinition
  ): Phaser.GameObjects.Container {
    const baseSize = 10 * enemyType.size;

    // Convert enemy color to neon pair (bright core + soft glow)
    const neonColor = toNeonPair(enemyType.color);

    // Create glowing shape using the visual system
    const container = createGlowingShape(
      this,
      x, y,
      baseSize,
      enemyType.shape,
      neonColor,
      this.visualQuality
    );

    // Set depth based on enemy category
    container.setDepth(8);

    return container;
  }

  /**
   * Collects XP and checks for level up.
   * Applies gem value multiplier and XP multiplier from permanent upgrades.
   * Queues multiple level-ups to show upgrade selections one at a time.
   */
  private collectXP(xpValue: number): void {
    // Apply gem value and XP multipliers
    const boostedXP = Math.floor(
      xpValue * this.playerStats.gemValueMultiplier * this.playerStats.xpMultiplier
    );
    this.playerStats.xp += boostedXP;

    // Count how many level-ups are pending (don't process all at once)
    while (this.playerStats.xp >= this.playerStats.xpToNextLevel) {
      this.playerStats.xp -= this.playerStats.xpToNextLevel;
      this.playerStats.level++;
      this.playerStats.xpToNextLevel = calculateXPForLevel(this.playerStats.level);
      this.pendingLevelUps++;

      // Grow player particle swarm on level-up
      if (this.playerPlasmaCore) {
        this.playerPlasmaCore.onLevelUp(this.playerStats.level);
      }

      // Track level up for achievements
      getAchievementManager().recordLevelUp(this.playerStats.level);
    }

    // Process one level-up at a time (only if not already showing upgrade UI)
    if (this.pendingLevelUps > 0 && !this.scene.isActive('UpgradeScene')) {
      this.processNextLevelUp();
    }
  }

  /**
   * Processes the next queued level-up.
   * Routes to either auto-buy (immediate selection) or manual selection (UpgradeScene).
   */
  private processNextLevelUp(): void {
    if (this.pendingLevelUps <= 0) return;

    this.pendingLevelUps--;
    this.soundManager.playLevelUp();

    // Tutorial toast on first level-up
    if (!getSettingsManager().isTutorialSeen() && this.playerStats.level === 2) {
      this.toastManager.showToast({
        title: 'Level Up!',
        description: 'Pick an upgrade to power up',
        icon: 'star',
        color: 0x44aaff,
        duration: 3000,
      });
    }

    // Reset Health-Adaptive tracking for next level
    this.recentDamageTaken = 0;
    this.isHealthStruggling = false;

    if (this.isAutoBuyEnabled) {
      this.processAutoBuyLevelUp();
    } else {
      this.showUpgradeSelection();
    }
  }

  /**
   * Processes level-up automatically without pausing the game.
   * Uses weighted smart selection to choose the best upgrade.
   */
  private processAutoBuyLevelUp(): void {
    // Calculate total upgrade choices (same as manual selection)
    const baseChoices = 3;
    const extraChoices = getMetaProgressionManager().getStartingExtraChoices();
    const totalChoices = baseChoices + extraChoices;

    // Get random combined upgrades (stats + weapons), excluding banished
    const availableUpgrades = getRandomCombinedUpgrades(
      this.upgrades,
      this.weaponManager,
      totalChoices,
      this.playerStats.level,
      this.banishedUpgradeIds
    );

    // If no upgrades available, continue without pausing
    if (availableUpgrades.length === 0) {
      this.processRemainingLevelUps();
      return;
    }

    // Use smart selection algorithm
    const selectedUpgrade = this.selectAutoBuyUpgrade(availableUpgrades);

    // Apply the upgrade
    this.applyCombinedUpgrade(selectedUpgrade);

    // Show floating notification
    this.showAutoBuyNotification(selectedUpgrade);

    // Process remaining level-ups
    this.processRemainingLevelUps();
  }

  /**
   * Processes any remaining queued level-ups with a small delay.
   * This prevents stack overflow and allows visual feedback to display.
   */
  private processRemainingLevelUps(): void {
    if (this.pendingLevelUps > 0) {
      this.time.delayedCall(100, () => {
        this.processNextLevelUp();
      });
    }
  }

  /**
   * Selects the best upgrade using tier-aware weighted selection.
   *
   * Base Strategy (Tier 1):
   * - Weapon milestones (5, 10, 15...): Prefer new weapons > weapon level-ups
   * - Normal levels: Balance stats, prefer lower-level stats for even distribution
   * - Priority stats get a bonus: might, haste, vitality, swiftness
   *
   * Intelligence Upgrades:
   * - Tier 2: Gate Planning - avoids break-level bottlenecks (3, 6, 9)
   * - Tier 3: Health-Adaptive - prioritizes defense when struggling
   * - Tier 4: Weapon Synergy - picks stats that match owned weapons
   */
  private selectAutoBuyUpgrade(availableUpgrades: CombinedUpgrade[]): CombinedUpgrade {
    const autoUpgradeLevel = getMetaProgressionManager().getAutoUpgradeLevel();

    // Calculate scores for each upgrade with tier-aware bonuses
    const scoredUpgrades = availableUpgrades.map(upgrade => {
      let score = this.calculateBaseScore(upgrade);

      // Tier 2+: Gate Planning Intelligence
      if (autoUpgradeLevel >= 2) {
        score += this.calculateGatePlanningBonus(upgrade);
      }

      // Tier 3+: Health-Adaptive Intelligence
      if (autoUpgradeLevel >= 3 && this.isHealthStruggling) {
        score += this.calculateHealthAdaptiveBonus(upgrade);
      }

      // Tier 4: Weapon Synergy Intelligence
      if (autoUpgradeLevel >= 4) {
        score += this.calculateWeaponSynergyBonus(upgrade);
      }

      return { upgrade, score };
    });

    // Sort by score descending
    scoredUpgrades.sort((a, b) => b.score - a.score);

    // Add small randomness to top choices to avoid predictability
    const topChoices = scoredUpgrades.filter(s => s.score >= scoredUpgrades[0].score - 10);
    const selectedIndex = Math.floor(Math.random() * Math.min(topChoices.length, 2));

    return topChoices[selectedIndex].upgrade;
  }

  /**
   * Calculates base score for an upgrade (Tier 1 logic).
   */
  private calculateBaseScore(upgrade: CombinedUpgrade): number {
    const playerLevel = this.playerStats.level;
    const isWeaponMilestone = playerLevel % 5 === 0;
    let score = 0;

    if (upgrade.upgradeType === 'weapon') {
      // Safety: Never auto-select new weapons when at max slots
      if (upgrade.type === 'add' && !this.weaponManager.canAddWeapon()) {
        return -1000; // Heavily penalize - should already be filtered, but safety check
      }

      // Weapon scoring
      if (isWeaponMilestone) {
        // On weapon milestones, strongly prefer new weapons
        if (upgrade.type === 'add') {
          score = 100; // New weapons get highest priority
        } else {
          score = 50 + (upgrade.maxLevel - upgrade.currentLevel); // Level-ups get medium priority
        }
      } else {
        // Normal levels: prefer leveling existing weapons
        if (upgrade.type === 'level') {
          score = 40 + (10 - upgrade.currentLevel); // Lower level weapons get priority
        } else {
          score = 20; // New weapons less preferred on non-milestones
        }
      }
    } else {
      // Stat upgrade scoring
      if (isWeaponMilestone) {
        score = 0; // Should not appear on weapon milestones, but safety
      } else {
        // Balance stats - prefer lower level stats for even distribution
        const levelDeficit = upgrade.maxLevel - upgrade.currentLevel;
        score = 30 + levelDeficit * 5;

        // Bonus for commonly useful stats
        const priorityStats = ['might', 'haste', 'vitality', 'swiftness'];
        if (priorityStats.includes(upgrade.id)) {
          score += 10;
        }
      }
    }

    return score;
  }

  /**
   * Tier 2: Gate Planning Intelligence.
   * Gives bonus to stats approaching break level gates (3, 6, 9) to prevent bottlenecks.
   * Smarter than basic - looks ahead and balances stats toward the next gate.
   */
  private calculateGatePlanningBonus(upgrade: CombinedUpgrade): number {
    if (upgrade.upgradeType !== 'stat') return 0;

    // Check if this is a stat upgrade subject to gates
    const upgradeData = this.upgrades.find(u => u.id === upgrade.id);
    if (!upgradeData || !upgradeData.isStatUpgrade) return 0;

    const GATES = [3, 6, 9];
    const currentLevel = upgrade.currentLevel;

    // Find the next gate this upgrade needs to reach
    const nextGate = GATES.find(g => g > currentLevel);
    if (!nextGate) return 0; // Past all gates

    // Find stats that are owned but below this gate
    const ownedStats = this.upgrades.filter(u => u.isStatUpgrade && u.currentLevel > 0);
    const statsBelowGate = ownedStats.filter(u => u.currentLevel < nextGate);

    // If this upgrade is at or approaching the gate, and other stats need catching up
    if (currentLevel === nextGate - 1 || currentLevel === nextGate) {
      // This stat is ready for the gate - deprioritize unless others are caught up
      if (statsBelowGate.length > 1) {
        return -10; // Wait for others to catch up
      }
    }

    // If this upgrade is below the next gate, give bonus to help reach it
    if (currentLevel < nextGate && statsBelowGate.length > 0) {
      return 15; // Bonus to help reach gate
    }

    return 0;
  }

  /**
   * Tier 3: Health-Adaptive Intelligence.
   * Prioritizes defensive stats when player has taken significant damage since last level-up.
   */
  private calculateHealthAdaptiveBonus(upgrade: CombinedUpgrade): number {
    if (upgrade.upgradeType !== 'stat') return 0;

    // Defensive stats that help survival
    const defensiveStats = ['vitality', 'shieldBarrier'];
    if (defensiveStats.includes(upgrade.id)) {
      return 30; // Strong preference for survival when struggling
    }

    return 0;
  }

  /**
   * Tier 4: Weapon Synergy Intelligence.
   * Picks stats that complement the player's current weapon loadout.
   */
  private calculateWeaponSynergyBonus(upgrade: CombinedUpgrade): number {
    if (upgrade.upgradeType !== 'stat') return 0;

    const ownedWeapons = this.weaponManager.getAllWeapons();
    const weaponIds = ownedWeapons.map(w => w.id);

    // Projectile weapons benefit from: multishot, piercing, velocity, reach
    const projectileWeapons = ['projectile', 'ricochet', 'homing_missile', 'shuriken'];
    const hasProjectileWeapons = projectileWeapons.some(id => weaponIds.includes(id));
    const projectileStats = ['multishot', 'piercing', 'velocity', 'reach'];

    // Melee/aura weapons benefit from: haste, might, swiftness
    const meleeAuraWeapons = ['katana', 'aura', 'orbiting_blades', 'frost_nova'];
    const hasMeleeAura = meleeAuraWeapons.some(id => weaponIds.includes(id));
    const meleeStats = ['haste', 'might', 'swiftness'];

    // Beam/AoE weapons benefit from: might, reach, haste
    const beamAoeWeapons = ['laser_beam', 'flamethrower', 'meteor', 'ground_spike', 'chain_lightning'];
    const hasBeamAoe = beamAoeWeapons.some(id => weaponIds.includes(id));
    const beamStats = ['might', 'reach', 'haste'];

    let bonus = 0;
    if (hasProjectileWeapons && projectileStats.includes(upgrade.id)) bonus += 15;
    if (hasMeleeAura && meleeStats.includes(upgrade.id)) bonus += 15;
    if (hasBeamAoe && beamStats.includes(upgrade.id)) bonus += 15;

    return bonus;
  }

  /**
   * Shows a floating notification when auto-buy selects an upgrade.
   * Displays near the player position with the upgrade name.
   */
  private showAutoBuyNotification(upgrade: CombinedUpgrade): void {
    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];

    const notificationY = playerY - 60;

    // Use gold color for weapon upgrades, green for stats
    const textColor = upgrade.upgradeType === 'weapon' ? '#ffdd44' : '#88ff88';

    // Create the notification text
    const notification = this.add.text(
      playerX,
      notificationY,
      `AUTO: ${upgrade.name}`,
      {
        fontSize: '18px',
        fontFamily: 'Arial',
        color: textColor,
        stroke: '#000000',
        strokeThickness: 3,
        fontStyle: 'bold',
      }
    );
    notification.setOrigin(0.5);
    notification.setDepth(PAUSE_MENU_DEPTH);

    // Animate: float up and fade out
    this.tweens.add({
      targets: notification,
      y: notificationY - 40,
      alpha: 0,
      duration: 1500,
      ease: 'Power2',
      onComplete: () => {
        notification.destroy();
      },
    });
  }

  /**
   * Shows the upgrade selection UI.
   */
  private showUpgradeSelection(): void {
    this.isPaused = true;

    // Calculate total upgrade choices (base 3 + extra from permanent upgrades)
    const baseChoices = 3;
    const extraChoices = getMetaProgressionManager().getStartingExtraChoices();
    const totalChoices = baseChoices + extraChoices;

    // Get random combined upgrades (stats + weapons), excluding banished
    const availableUpgrades = getRandomCombinedUpgrades(
      this.upgrades,
      this.weaponManager,
      totalChoices,
      this.playerStats.level,
      this.banishedUpgradeIds
    );

    // If no upgrades available (all maxed), just continue
    if (availableUpgrades.length === 0) {
      this.isPaused = false;
      return;
    }

    // Handler for after selection is complete (used by select, skip)
    const handleSelectionComplete = () => {
      this.isPaused = false;
      // Check for more pending level-ups
      if (this.pendingLevelUps > 0) {
        this.time.delayedCall(100, () => {
          this.processNextLevelUp();
        });
      }
    };

    // Calculate weapon slot info for final slot warning
    const isWeaponMilestone = this.playerStats.level % 5 === 0;
    const currentWeapons = this.weaponManager.getWeaponCount();
    const maxWeapons = this.weaponManager.getMaxWeaponSlots();
    const remainingSlots = maxWeapons - currentWeapons;
    // Show warning when on weapon milestone with exactly 1 slot left
    const isLastWeaponSlot = isWeaponMilestone && remainingSlots === 1;

    // Launch upgrade scene with combined upgrades and utility callbacks
    this.scene.launch('UpgradeScene', {
      upgrades: availableUpgrades,
      rerollsRemaining: this.playerStats.rerollsRemaining,
      skipsRemaining: this.playerStats.skipsRemaining,
      banishesRemaining: this.playerStats.banishesRemaining,
      // Weapon slot warning info
      isLastWeaponSlot,
      weaponSlotsInfo: { current: currentWeapons, max: maxWeapons },
      onSelect: (selectedUpgrade: CombinedUpgrade) => {
        this.applyCombinedUpgrade(selectedUpgrade);
        handleSelectionComplete();
      },
      onReroll: () => {
        // Decrement rerolls and refresh with new options
        this.playerStats.rerollsRemaining--;
        this.scene.stop('UpgradeScene');
        this.time.delayedCall(50, () => {
          this.showUpgradeSelection();
        });
      },
      onSkip: () => {
        // Decrement skips and continue without selecting
        this.playerStats.skipsRemaining--;
        this.scene.stop('UpgradeScene');
        handleSelectionComplete();
      },
      onBanish: (upgrade: CombinedUpgrade) => {
        // Add to banished set and refresh with new options
        this.banishedUpgradeIds.add(upgrade.id);
        this.playerStats.banishesRemaining--;
        this.scene.stop('UpgradeScene');
        this.time.delayedCall(50, () => {
          this.showUpgradeSelection();
        });
      },
    });
  }

  /**
   * Applies a combined upgrade (stat or weapon).
   */
  private applyCombinedUpgrade(upgrade: CombinedUpgrade): void {
    const achievementManager = getAchievementManager();

    if (upgrade.upgradeType === 'stat') {
      // Calculate the new level (current + 1)
      const newLevel = upgrade.currentLevel + 1;

      // Apply stat upgrade with the new level
      upgrade.apply(this.playerStats, newLevel);

      // Track upgrade acquisition for achievements
      achievementManager.recordUpgradeAcquired(upgrade.id);

      // Discover upgrade in codex
      getCodexManager().discoverUpgrade(upgrade.id, upgrade.name);

      // Find and update the original upgrade by ID (not the copy)
      const originalUpgrade = this.upgrades.find(u => u.id === upgrade.id);
      if (originalUpgrade) {
        originalUpgrade.currentLevel = newLevel;

        // Check if this stat reached mastery (level 10) - add visual indicator
        if (newLevel === 10 && originalUpgrade.isStatUpgrade) {
          this.masteryVisualsManager.addMasteryVisual(upgrade.id);
          // Play level-up sound for mastery celebration
          this.soundManager.playLevelUp();
        }
      }
    } else {
      // Apply weapon upgrade
      if (upgrade.type === 'add') {
        // Add new weapon
        const newWeapon = createWeapon(upgrade.weaponId);
        if (newWeapon) {
          this.weaponManager.addWeapon(newWeapon);
          // Track weapon acquisition for achievements
          achievementManager.recordWeaponAcquired(upgrade.weaponId);
          // Discover weapon in codex
          getCodexManager().discoverWeapon(upgrade.weaponId, newWeapon.name);
          getCodexManager().recordWeaponUsage(upgrade.weaponId, 0, 0);
        }
      } else {
        // Level up existing weapon
        this.weaponManager.levelUpWeapon(upgrade.weaponId);
        // Track as upgrade for achievements
        achievementManager.recordUpgradeAcquired(upgrade.weaponId);
      }
    }

    // Sync stats to ECS components and weapons
    this.syncStatsToPlayer();

    // Check for weapon evolutions after every upgrade
    const statUpgrades = this.upgrades.map(u => ({ id: u.id, currentLevel: u.currentLevel }));
    const evolutionResult = this.weaponManager.checkEvolutions(statUpgrades);
    if (evolutionResult && this.toastManager) {
      this.toastManager.showToast({
        title: `EVOLVED: ${evolutionResult.evolution.evolvedName}`,
        description: evolutionResult.evolution.evolvedDescription,
        icon: evolutionResult.weapon.icon,
        color: 0xff88ff,
        duration: 4000,
      });
      this.soundManager.playLevelUp();
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(200, 0.015);
      }
      this.effectsManager.playImpactFlash(0.15, 60);
    }

    // Highlight the upgrade icon for 5 seconds (also rebuilds icons)
    const highlightId = upgrade.upgradeType === 'stat' ? upgrade.id : upgrade.weaponId;
    this.hudManager.highlightUpgradeIcon(highlightId, this.gameTime);
    this.hudManager.updateUpgradeIcons(this.buildUpgradeIconData());
  }

  /**
   * Applies a milestone reward during gameplay.
   */
  private applyMilestoneReward(reward: MilestoneReward): void {
    switch (reward.type) {
      case 'xp_bonus':
        // Directly collect XP (will trigger level-up if threshold reached)
        this.collectXP(reward.value);
        break;

      case 'reroll_token':
        // Add reroll tokens for upgrade selection
        this.playerStats.rerollsRemaining += reward.value;
        break;

      case 'temp_buff':
        // Apply temporary stat buff
        this.applyTemporaryBuff(reward.buffType || 'damage', reward.value, reward.buffDuration || 60000);
        break;
    }
  }

  /**
   * Applies a temporary stat buff that expires after a duration.
   */
  private applyTemporaryBuff(
    buffType: 'damage' | 'speed' | 'all_stats',
    multiplier: number,
    durationMs: number
  ): void {
    const buffMultiplier = 1 + multiplier;

    switch (buffType) {
      case 'damage':
        this.playerStats.damageMultiplier *= buffMultiplier;
        break;
      case 'speed':
        this.playerStats.moveSpeed = Math.floor(this.playerStats.moveSpeed * buffMultiplier);
        Velocity.speed[this.playerId] = this.playerStats.moveSpeed;
        break;
      case 'all_stats':
        this.playerStats.damageMultiplier *= buffMultiplier;
        this.playerStats.attackSpeedMultiplier *= buffMultiplier;
        this.playerStats.moveSpeed = Math.floor(this.playerStats.moveSpeed * buffMultiplier);
        Velocity.speed[this.playerId] = this.playerStats.moveSpeed;
        break;
    }

    // Sync to weapons
    this.weaponManager.applyMultipliers(
      this.playerStats.damageMultiplier,
      this.playerStats.attackSpeedMultiplier,
      this.playerStats.projectileCount - 1,
      this.playerStats.piercing
    );

    // Schedule buff removal
    this.time.delayedCall(durationMs, () => {
      switch (buffType) {
        case 'damage':
          this.playerStats.damageMultiplier /= buffMultiplier;
          break;
        case 'speed':
          this.playerStats.moveSpeed = Math.floor(this.playerStats.moveSpeed / buffMultiplier);
          if (this.playerId !== -1) {
            Velocity.speed[this.playerId] = this.playerStats.moveSpeed;
          }
          break;
        case 'all_stats':
          this.playerStats.damageMultiplier /= buffMultiplier;
          this.playerStats.attackSpeedMultiplier /= buffMultiplier;
          this.playerStats.moveSpeed = Math.floor(this.playerStats.moveSpeed / buffMultiplier);
          if (this.playerId !== -1) {
            Velocity.speed[this.playerId] = this.playerStats.moveSpeed;
          }
          break;
      }

      // Sync to weapons after buff expires
      this.weaponManager.applyMultipliers(
        this.playerStats.damageMultiplier,
        this.playerStats.attackSpeedMultiplier,
        this.playerStats.projectileCount - 1,
        this.playerStats.piercing
      );
    });
  }

  /**
   * Syncs PlayerStats to the player's ECS components and weapon system.
   */
  private syncStatsToPlayer(): void {
    if (this.playerId === -1) return;

    // Movement speed
    Velocity.speed[this.playerId] = this.playerStats.moveSpeed;

    // Health
    Health.max[this.playerId] = this.playerStats.maxHealth;
    Health.current[this.playerId] = Math.min(
      Health.current[this.playerId],
      this.playerStats.maxHealth
    );

    // Apply global stat multipliers and bonuses to all weapons
    // Note: projectileCount starts at 1, so bonus is (current - 1)
    // piercing starts at 0, so bonus is just the current value
    const comboDamageBonus = getComboBuffDamageMultiplier();
    this.weaponManager.applyMultipliers(
      this.playerStats.damageMultiplier * (1 + comboDamageBonus),
      this.playerStats.attackSpeedMultiplier,
      this.playerStats.projectileCount - 1, // Bonus count (base is 1)
      this.playerStats.piercing              // Bonus piercing (base is 0)
    );

    // Set overcharge stun duration for chain lightning
    this.weaponManager.setOverchargeStunDuration(this.playerStats.overchargeStunDuration);

    // Also sync to ECS Weapon component for systems that read from there
    Weapon.projectileCount[this.playerId] = this.playerStats.projectileCount;
    Weapon.piercing[this.playerId] = this.playerStats.piercing;

    // Sync pickup magnet range to pickup systems
    setXPGemMagnetRange(this.playerStats.pickupRange);
    setHealthPickupMagnetRange(this.playerStats.pickupRange);

    // Sync combat stats to collision system (crit, elemental chances, life steal, advanced)
    setCombatStats({
      critChance: this.playerStats.critChance,
      critDamage: this.playerStats.critDamage,
      burnChance: this.playerStats.burnChance,
      burnDamageMultiplier: this.playerStats.burnDamageMultiplier,
      freezeChance: this.playerStats.freezeChance,
      freezeDurationMultiplier: this.playerStats.freezeDurationMultiplier,
      poisonChance: this.playerStats.poisonChance,
      poisonMaxStacks: this.playerStats.poisonMaxStacks,
      chainLightningChance: this.playerStats.chainLightningChance,
      lifeStealPercent: this.playerStats.lifeStealPercent,
      // Advanced mechanics
      executionBonus: this.playerStats.executionBonus,
      overkillSplash: this.playerStats.overkillSplash,
      armorPenetration: this.playerStats.armorPenetration,
      knockbackMultiplier: this.playerStats.knockbackMultiplier,
      shatterBonus: this.playerStats.shatterBonus,
    });
  }

  /**
   * Updates motion trails for player and fast-moving enemies.
   */
  private updateTrails(deltaSeconds: number): void {
    // Add trail for player
    if (this.playerId !== -1) {
      const px = Transform.x[this.playerId];
      const py = Transform.y[this.playerId];
      this.trailManager.addTrailPoint(this.playerId, px, py, PLAYER_NEON.glow, 8);
    }

    // Add trails for fast-moving enemies
    const enemies = enemyQueryForCollision(this.world);
    for (let i = 0; i < enemies.length; i++) {
      const enemyId = enemies[i];

      // Check velocity - only add trails for fast enemies
      const vx = Velocity.x[enemyId];
      const vy = Velocity.y[enemyId];
      const speedSq = vx * vx + vy * vy;

      // Only trail if moving fast (speed > 80) and not flagged NO_TRAIL
      const hasNoTrailFlag = (EnemyType.flags[enemyId] & EnemyFlags.NO_TRAIL) !== 0;
      if (speedSq > 6400 && !hasNoTrailFlag) {
        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];

        // Use a neon version of red for enemy trails
        this.trailManager.addTrailPoint(enemyId, ex, ey, 0xff6666, 5);
      }
    }

    // Update trail rendering
    this.trailManager.update(deltaSeconds);

    // Update mastery visuals (level 10 stat indicators)
    if (this.playerId !== -1) {
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      this.masteryVisualsManager.update(playerX, playerY, deltaSeconds);

      // Update shield barrier visual (honeycomb + charge dots)
      // Only show visual when shield barrier is actually enabled (in-run upgrade obtained)
      // This prevents permanent "Barrier Capacity" shop upgrades from showing shields prematurely
      this.shieldBarrierVisual.update(
        playerX,
        playerY,
        this.playerStats.shieldBarrierEnabled ? this.playerStats.shieldCharges : 0,
        this.playerStats.shieldBarrierEnabled ? this.playerStats.maxShieldCharges : 0,
        this.playerStats.shieldRechargeProgress
      );
    }

  }

  /**
   * Updates the grid background with current entity positions for warping effect.
   * All entities contribute - weight is calculated from actual enemy size.
   */
  private updateGridBackground(deltaSeconds: number): void {
    const gridEnabled = getSettingsManager().isGridEffectsEnabled();
    this.gridBackground.setEnabled(gridEnabled);
    if (!gridEnabled) return;

    // Get player position
    let playerPos: { x: number; y: number } | null = null;
    if (this.playerId !== -1) {
      playerPos = {
        x: Transform.x[this.playerId],
        y: Transform.y[this.playerId],
      };
    }

    // Get ALL enemy positions with weight calculated from their actual size
    const enemies = enemyQueryForCollision(this.world);
    const enemyData: { x: number; y: number; weight: number }[] = [];

    for (let i = 0; i < enemies.length; i++) {
      const enemyId = enemies[i];

      // Weight formula based on actual size (0.5-6.0 range):
      // Capped at 1.5 to prevent grid line crossing
      // size 0.5 → 0.4 weight (subtle ripple)
      // size 1.0 → 0.55 weight (normal warp)
      // size 6.0 → 1.5 weight (strong gravity well, capped)
      const size = EnemyType.size[enemyId];
      const aiType = EnemyAI.aiType[enemyId];
      let weight = Math.min(1.5, 0.25 + (size * 0.3));

      // Bosses (aiType >= 100) get 3x warp, minibosses (>= 50) get 2x
      if (aiType >= 100) {
        weight *= 3.0;
      } else if (aiType >= 50) {
        weight *= 2.0;
      }

      enemyData.push({
        x: Transform.x[enemyId],
        y: Transform.y[enemyId],
        weight,
      });
    }

    // Pass ALL enemies - no sorting, no limit for maximum visual effect
    this.gridBackground.setGravityPoints(playerPos, enemyData);

    // Update grid animation with actual delta for proper physics integration
    this.gridBackground.update(deltaSeconds);
  }

  /**
   * Updates visual quality based on FPS for auto-scaling.
   * Reduces glow layers and effects when performance drops.
   */
  private updateVisualQuality(delta: number): void {
    // Delegate FPS tracking and quality calculation to HUDManager
    const newQuality = this.hudManager.updateFPS(delta);

    // Only update if quality changed (avoid unnecessary work)
    if (newQuality !== null) {
      this.visualQuality = newQuality;
      // Update grid background quality
      this.gridBackground.setQuality(newQuality);
      // Update trail system quality
      this.trailManager.setQuality(newQuality);
      // Update death ripple quality
      if (this.deathRippleManager) {
        this.deathRippleManager.setQuality(newQuality);
      }
      // Update player plasma core quality
      if (this.playerPlasmaCore) {
        this.playerPlasmaCore.setQuality(newQuality);
      }
      // Update weapon visual quality
      this.weaponManager.setVisualQuality(newQuality);
      // Note: Existing entities keep their current quality
      // New entities will be created with the new quality level
    }
  }

  /**
   * Handles screen resize events (orientation change, Safari address bar, etc).
   * Repositions all HUD elements anchored to screen edges or center.
   */
  private handleResize(gameSize: Phaser.Structs.Size): void {
    const w = gameSize.width;
    const h = gameSize.height;

    // Update ECS system bounds
    setEnemyAIBounds(w, h);

    // Rebuild grid background for new screen dimensions
    if (this.gridBackground) {
      this.gridBackground.resize(w, h);
    }

    // Delegate all HUD repositioning to the HUD manager
    this.hudManager.handleResize(w, h);
  }

  /**
   * Clean up event listeners and resources when scene shuts down.
   * Critical for preventing input conflicts and memory leaks on restart.
   */
  shutdown(): void {
    // Remove resize listener
    this.scale.off('resize', this.handleResize, this);

    // Remove ESC key listener to prevent it persisting across restarts
    if (this.escKeyHandler) {
      this.input.keyboard?.off('keydown-ESC', this.escKeyHandler);
      this.escKeyHandler = null;
    }

    // Remove auto-buy toggle key listener
    if (this.autoBuyKeyHandler) {
      this.input.keyboard?.off('keydown-T', this.autoBuyKeyHandler);
      this.autoBuyKeyHandler = null;
    }

    // Remove resume handler
    if (this.resumeHandler) {
      this.events.off('resume', this.resumeHandler);
      this.resumeHandler = null;
    }

    // Remove dash request handler
    if (this.dashRequestHandler) {
      this.events.off('input-dash-requested', this.dashRequestHandler);
      this.dashRequestHandler = null;
    }

    // Clean up input controller (joystick, focus handlers, shift key)
    if (this.inputController) {
      this.inputController.destroy();
    }

    // Remove beforeunload handler for game state persistence
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    // Clean up event indicator
    this.hudManager.destroyEventIndicator();

    // Clean up weapon system
    if (this.weaponManager) {
      this.weaponManager.destroy();
    }

    // Clean up mastery visuals
    if (this.masteryVisualsManager) {
      this.masteryVisualsManager.destroy();
    }

    // Clean up shield barrier visual
    if (this.shieldBarrierVisual) {
      this.shieldBarrierVisual.destroy();
    }


    // Clean up player plasma core visual
    if (this.playerPlasmaCore) {
      this.playerPlasmaCore.destroy();
    }

    // Clean up grid background and trail manager
    if (this.gridBackground) {
      this.gridBackground.destroy();
    }
    if (this.trailManager) {
      this.trailManager.destroy();
    }
    if (this.deathRippleManager) {
      this.deathRippleManager.destroy();
    }

    // Clean up pause menu manager (removes keyboard handlers and open dialogs)
    if (this.pauseMenuManager) {
      this.pauseMenuManager.destroy();
    }

    // Clean up boss warning elements
    this.cleanupBossWarning();

    // Clean up HUD manager
    if (this.hudManager) {
      this.hudManager.destroy();
    }

    // Kill all active tweens to prevent them from continuing
    this.tweens.killAll();

    // Clear enemy projectiles
    for (const proj of this.enemyProjectiles) {
      proj.sprite.destroy();
    }
    this.enemyProjectiles = [];

    // Clear active lasers and destroy pooled graphics
    this.activeLasers = [];
    if (this.laserGraphics) {
      this.laserGraphics.destroy();
      this.laserGraphics = null;
    }

    // Clean up effects manager
    if (this.effectsManager) {
      this.effectsManager.destroy();
    }

  }
}
