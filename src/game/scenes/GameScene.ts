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
import { inputSystem, InputState } from '../../ecs/systems/InputSystem';
import { JoystickManager } from '../../ui/JoystickManager';
import { movementSystem, clampPlayerToScreen } from '../../ecs/systems/MovementSystem';
import { enemyAISystem, setEnemyProjectileCallback, setMinionSpawnCallback, setXPGemCallbacks, recordEnemyDeath, linkTwins, unlinkTwin, setBossCallbacks, resetEnemyAISystem, resetBossCallbacks, getAllTwinLinks } from '../../ecs/systems/EnemyAISystem';
import { resetWeaponSystem } from '../../ecs/systems/WeaponSystem';
import { resetCollisionSystem, setCombatStats, setLifeStealCallback } from '../../ecs/systems/CollisionSystem';
import { statusEffectSystem, setStatusEffectSystemEffectsManager, setStatusEffectSystemDeathCallback, applyPoison } from '../../ecs/systems/StatusEffectSystem';
import { getRandomEnemyType, getScaledStats, getEnemyType, EnemyTypeDefinition } from '../../enemies/EnemyTypes';
import { spriteSystem, registerSprite, getSprite, unregisterSprite, resetSpriteSystem } from '../../ecs/systems/SpriteSystem';
import { xpGemSystem, spawnXPGem, setXPGemSystemScene, setXPCollectCallback, setXPGemEffectsManager, setXPGemSoundManager, setXPGemMagnetRange, setXPGemWorldReference, getXPGemPositions, consumeXPGem, resetXPGemSystem, magnetizeAllGems } from '../../ecs/systems/XPGemSystem';
import { healthPickupSystem, spawnHealthPickup, setHealthPickupSystemScene, setHealthCollectCallback, setHealthPickupEffectsManager, setHealthPickupSoundManager, setHealthPickupMagnetRange, resetHealthPickupSystem } from '../../ecs/systems/HealthPickupSystem';
import { magnetPickupSystem, spawnMagnetPickup, setMagnetPickupSystemScene, setMagnetPickupEffectsManager, setMagnetPickupSoundManager, resetMagnetPickupSystem } from '../../ecs/systems/MagnetPickupSystem';
import { PlayerStats, createDefaultPlayerStats, calculateXPForLevel, Upgrade, createUpgrades, CombinedUpgrade, getRandomCombinedUpgrades } from '../../data/Upgrades';
import { GAME_WIDTH, GAME_HEIGHT } from '../../GameConfig';
import { EffectsManager } from '../../effects/EffectsManager';
import { SoundManager } from '../../audio/SoundManager';
import { getMusicManager } from '../../audio/MusicManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { WeaponManager, createWeapon, ProjectileWeapon } from '../../weapons';
import { toNeonPair, PLAYER_NEON } from '../../visual/NeonColors';
import { createGlowingShape, VisualQuality } from '../../visual/GlowGraphics';
import { PlayerPlasmaCore } from '../../visual/PlayerPlasmaCore';
import { GridBackground } from '../../visual/GridBackground';
import { TrailManager } from '../../visual/TrailManager';
import { MasteryVisualsManager } from '../../visual/MasteryVisuals';
import { MasteryIconEffectsManager } from '../../visual/MasteryIconEffectsManager';
import { ShieldBarrierVisual } from '../../visual/ShieldBarrierVisual';
import { createIcon } from '../../utils/IconRenderer';
import { getGameStateManager, GameSaveState } from '../../save/GameStateManager';
import { getSettingsManager } from '../../settings';
import { SecureStorage } from '../../storage';
import { updateFrameCache, resetFrameCache, getEnemyIds as getFrameCacheEnemyIds } from '../../ecs/FrameCache';
import { resetEnemySpatialHash } from '../../utils/SpatialHash';
import { getAchievementManager, MilestoneDefinition, MilestoneReward } from '../../achievements';
import { getToastManager, ToastManager } from '../../ui';
import { getCodexManager } from '../../codex';

// Module-level queries (defined once, not per-frame)
const enemyQueryForCollision = defineQuery([Transform, EnemyTag]);
const knockbackEnemyQuery = defineQuery([Transform, Knockback, EnemyTag]);

// localStorage key for auto-buy setting persistence
const STORAGE_KEY_AUTO_BUY = 'game_autoBuyEnabled';

// HUD layout constants for consistent padding
const HUD_EDGE_PADDING = 16;  // Padding from screen edges
const HUD_ELEMENT_SPACING = 8; // Spacing between adjacent HUD elements
const HUD_DEPTH = 1000;        // Depth for all HUD elements (renders on top)
const HUD_ALPHA = 0.75;        // 75% opacity so gameplay is visible behind HUD
const PAUSE_MENU_DEPTH = 1100; // Pause menu renders above HUD

/**
 * Represents a boss/miniboss health bar UI element.
 */
interface BossHealthBar {
  entityId: number;
  name: string;
  isFinalBoss: boolean;
  container: Phaser.GameObjects.Container;
  nameText: Phaser.GameObjects.Text;
  barBackground: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
  healthText: Phaser.GameObjects.Text;
  glowGraphics: Phaser.GameObjects.Graphics;
}

/**
 * GameScene is the main gameplay scene.
 * Manages the ECS world, player, enemies, and game loop.
 */
export class GameScene extends Phaser.Scene {
  // ECS World
  private world!: IWorld;

  // Input
  private inputState!: InputState;
  private joystickManager: JoystickManager | null = null;

  // Player reference
  private playerId: number = -1;

  // Spawn timer
  private spawnTimer: number = 0;
  private spawnInterval: number = 1.0; // Spawn enemy every second

  // Game time
  private gameTime: number = 0;

  // Enemy count (for difficulty scaling)
  private enemyCount: number = 0;
  private maxEnemies: number = 1000;

  // Kill counter
  private killCount: number = 0;

  // Entity ID to enemy type ID mapping (for codex kill tracking)
  private enemyTypeMap: Map<number, string> = new Map();

  // Achievement tracking
  private toastManager!: ToastManager;
  private lastAchievementTimeCheck: number = 0; // For throttled time tracking
  private totalDamageTaken: number = 0;

  // Player stats and upgrades
  private playerStats!: PlayerStats;
  private upgrades!: Upgrade[];
  private isPaused: boolean = false;
  private pendingLevelUps: number = 0;

  // XP Bar UI elements
  private xpBarBackground!: Phaser.GameObjects.Rectangle;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;

  // HP Bar UI elements
  private hpBarBackground!: Phaser.GameObjects.Rectangle;
  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;

  // Upgrade icons UI
  private upgradeIconsContainer!: Phaser.GameObjects.Container;
  private upgradeTooltip!: Phaser.GameObjects.Container;
  private activeIconHighlights: Map<string, number> = new Map(); // upgradeId -> expiration gameTime

  // BGM UI elements
  private bgmContainer!: Phaser.GameObjects.Container;
  private bgmTrackText!: Phaser.GameObjects.Text;
  private bgmMuteButton!: Phaser.GameObjects.Image;
  private bgmMuteStrike!: Phaser.GameObjects.Graphics;
  private lastTrackId: string = '';

  // Damage cooldown (invincibility frames)
  private damageCooldown: number = 0;

  // Emergency heal cooldown (triggered at low HP)
  private emergencyHealCooldown: number = 0;

  // Banished upgrades (removed from pool permanently for this run)
  private banishedUpgradeIds: Set<string> = new Set();

  // Dash ability state
  private dashCooldownTimer: number = 0;     // Time until dash is available
  private isDashing: boolean = false;        // Currently dashing?
  private dashTimer: number = 0;             // Remaining dash duration
  private dashDirectionX: number = 0;        // Dash direction
  private dashDirectionY: number = 0;
  private readonly DASH_DURATION = 0.15;     // 150ms dash
  private readonly DASH_SPEED_MULT = 3.5;    // 3.5x speed during dash

  // Gem magnet timer (auto-vacuum interval)
  private gemMagnetTimer: number = 0;

  // Treasure chest spawn timer
  private treasureSpawnTimer: number = 0;

  // Game over state
  private isGameOver: boolean = false;

  // Victory state (survived 10 minutes)
  private hasWon: boolean = false;

  // Pause menu state (separate from isPaused which is used for upgrades/victory)
  private isPauseMenuOpen: boolean = false;

  // Shop confirmation state
  private isShopConfirmationOpen: boolean = false;

  // ESC key handler reference for cleanup
  private escKeyHandler: (() => void) | null = null;

  // Focus/visibility change handlers for auto-pause
  private handleVisibilityChange: (() => void) | null = null;
  private handleWindowBlur: (() => void) | null = null;

  // Health drop chance (percentage)
  private readonly HEALTH_DROP_CHANCE: number = 0.08; // 8% chance

  // Magnet pickup spawn timing (every 60 seconds, an enemy drops a magnet)
  private magnetSpawnTimer: number = 0;
  private readonly MAGNET_SPAWN_INTERVAL: number = 60; // seconds
  private nextEnemyDropsMagnet: boolean = false;

  // Effects and sound managers for game juice
  private effectsManager!: EffectsManager;
  private soundManager!: SoundManager;

  // Weapon system
  private weaponManager!: WeaponManager;

  // Miniboss spawn timing
  private minibossSpawnTimes: { typeId: string; time: number; spawned: boolean }[] = [
    { typeId: 'glutton', time: 180, spawned: false },      // 3 min
    { typeId: 'swarm_mother', time: 240, spawned: false }, // 4 min
    { typeId: 'charger', time: 300, spawned: false },      // 5 min
    { typeId: 'necromancer', time: 360, spawned: false },  // 6 min
    { typeId: 'twin_a', time: 420, spawned: false },       // 7 min (spawns both twins)
  ];

  // Boss cycling system - cycles through bosses each run
  private static bossOrder = ['horde_king', 'void_wyrm', 'the_machine'];
  private static currentBossIndex = 0;
  private bossSpawnTime = 600; // 10 minutes
  private bossSpawned = false;

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

  // Victory choice handlers (for cleanup)
  private victoryContinueHandler: (() => void) | null = null;
  private victoryNextWorldHandler: (() => void) | null = null;

  // Visual quality for Geometry Wars aesthetic (auto-scales based on FPS)
  private visualQuality: VisualQuality = 'high';
  private fpsHistory: number[] = [];
  private readonly FPS_HISTORY_SIZE = 30;
  // FPS counter display in lower-right corner
  private fpsText: Phaser.GameObjects.Text | null = null;

  // Geometry Wars style warping grid background
  private gridBackground!: GridBackground;

  // Motion trail system for player and fast enemies
  private trailManager!: TrailManager;

  // Mastery visuals for level 10 stat upgrades
  private masteryVisualsManager!: MasteryVisualsManager;

  // Shield barrier visual (honeycomb + charge dots)
  private shieldBarrierVisual!: ShieldBarrierVisual;

  // Mastery icon effects (glow + particles for maxed weapons/skills in HUD)
  private masteryIconEffects!: MasteryIconEffectsManager;

  // Animated player visual (velocity-responsive plasma core)
  private playerPlasmaCore!: PlayerPlasmaCore;

  // Auto-buy feature (auto-selects upgrades on level-up without pausing)
  private isAutoBuyEnabled: boolean = false;
  private autoBuyToggleText: Phaser.GameObjects.Text | null = null;
  private autoBuyToggleBg: Phaser.GameObjects.Rectangle | null = null;
  private autoBuyKeyHandler: (() => void) | null = null;

  // Health-Adaptive intelligence tracking (for auto-upgrade tier 3)
  private recentDamageTaken: number = 0; // Reset each level-up
  private isHealthStruggling: boolean = false; // True if took >50% max HP since last level

  // Game state persistence for page reload recovery
  private autoSaveTimer: number = 0;
  private readonly AUTO_SAVE_INTERVAL: number = 30; // seconds
  private beforeUnloadHandler: (() => void) | null = null;
  private shouldRestore: boolean = false;

  // Boss health bar UI tracking (stacked bars for multiple bosses)
  private activeBossHealthBars: BossHealthBar[] = [];
  private readonly BOSS_HEALTH_BAR_START_Y = 75; // Below timer (timer ends ~70px)
  private readonly BOSS_HEALTH_BAR_HEIGHT = 48;  // Height per bar (38) + 10px spacing between bars
  private readonly BOSS_HEALTH_BAR_WIDTH = 350;

  constructor() {
    super({ key: 'GameScene' });
  }

  /**
   * Called before create() to receive scene data.
   * Used to detect restore mode vs fresh start.
   */
  init(data?: { restore?: boolean }): void {
    this.shouldRestore = data?.restore === true;
  }

  create(): void {
    // Register shutdown event listener for proper cleanup on scene restart/stop
    // This is critical - Phaser doesn't automatically call shutdown() methods
    this.events.once('shutdown', this.shutdown, this);

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
    resetFrameCache();
    resetEnemySpatialHash();

    // Reset all instance properties for fresh game state
    // (Class property initializers only run once on instantiation, not on scene restart)
    this.gameTime = 0;
    this.spawnTimer = 0;
    this.enemyCount = 0;
    this.killCount = 0;
    this.totalDamageTaken = 0;
    this.lastAchievementTimeCheck = 0;

    // Initialize achievement tracking for this run
    const achievementManager = getAchievementManager();
    achievementManager.startNewRun();
    this.toastManager = getToastManager(this);

    // Set up milestone completion callback to show toast notifications
    achievementManager.setMilestoneCompleteCallback(
      (milestone: MilestoneDefinition, reward: MilestoneReward) => {
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
    this.damageCooldown = 0;
    this.lastTrackId = '';
    this.isGameOver = false;
    this.isPaused = false;
    this.isPauseMenuOpen = false;
    this.isShopConfirmationOpen = false;
    this.hasWon = false;
    this.magnetSpawnTimer = 0;
    this.bossSpawned = false;
    this.endlessModeActive = false;
    this.endlessModeTime = 0;
    this.endlessMinibossTimer = 0;
    this.endlessBossTimer = 0;
    this.fpsHistory = [];
    this.activeLasers = [];
    this.enemyProjectiles = [];
    // Reset boss health bars (destroy any existing containers)
    for (const bar of this.activeBossHealthBars) {
      bar.container.destroy();
    }
    this.activeBossHealthBars = [];
    // Reset miniboss spawn tracking
    for (const miniboss of this.minibossSpawnTimes) {
      miniboss.spawned = false;
    }

    // Initialize ECS world
    this.world = createWorld();

    // Initialize Geometry Wars style warping grid background
    this.gridBackground = new GridBackground(this);

    // Initialize motion trail system
    this.trailManager = new TrailManager(this);

    // Initialize mastery visuals manager for level 10 stat indicators
    this.masteryVisualsManager = new MasteryVisualsManager(this);

    // Initialize shield barrier visual (honeycomb + charge dots)
    this.shieldBarrierVisual = new ShieldBarrierVisual(this);

    // Initialize mastery icon effects (HUD glow + particles for maxed weapons/skills)
    this.masteryIconEffects = new MasteryIconEffectsManager(this);

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

    // ═══ STARTING LEVEL (triggers level-ups at start) ═══
    const startingLevel = metaManager.getStartingLevel();
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

    // Setup life steal callback for collision system
    setLifeStealCallback((amount) => {
      this.healPlayer(amount);
    });

    // Setup input
    this.setupInput();
    this.joystickManager = new JoystickManager(this);

    // Create player at center of screen
    this.playerId = this.createPlayer(GAME_WIDTH / 2, GAME_HEIGHT / 2);

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
      // onDamaged - visual feedback handled in WeaponManager
      () => {},
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

    // Give player the starting weapon
    const startingWeapon = new ProjectileWeapon();
    this.weaponManager.addWeapon(startingWeapon);
    // Discover the starting weapon in codex
    getCodexManager().discoverWeapon('projectile', startingWeapon.name);

    // Apply meta-progression stats to player and weapons
    this.syncStatsToPlayer();

    // Create UI
    this.createUI();

    // Setup pause key (ESC) - store handler reference for cleanup
    this.escKeyHandler = () => {
      this.togglePauseMenu();
    };
    this.input.keyboard?.on('keydown-ESC', this.escKeyHandler);

    // Setup scene resume handler to show pause menu when returning from settings
    this.events.on('resume', () => {
      // When resuming from SettingsScene, show pause menu again
      if (this.isPaused && !this.isPauseMenuOpen) {
        this.showPauseMenu();
      }
    });

    // Setup auto-buy toggle key (T) - store handler reference for cleanup
    this.autoBuyKeyHandler = () => {
      this.toggleAutoBuy();
    };
    this.input.keyboard?.on('keydown-T', this.autoBuyKeyHandler);

    // Setup beforeunload handler to save game state on page close/refresh
    this.setupBeforeUnloadHandler();

    // Setup auto-pause when tab/window loses focus
    this.setupFocusLossHandlers();
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
   * Sets up handlers to pause the game when tab/window loses focus.
   * Shows pause menu on focus loss, requiring manual resume.
   */
  private setupFocusLossHandlers(): void {
    this.handleVisibilityChange = () => {
      if (document.hidden && !this.isPaused && !this.isGameOver) {
        this.showPauseMenu();
      }
    };
    this.handleWindowBlur = () => {
      if (!this.isPaused && !this.isGameOver) {
        this.showPauseMenu();
      }
    };

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  /**
   * Saves the current game state to localStorage.
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
      dashCooldownTimer: this.dashCooldownTimer,
      damageCooldown: this.damageCooldown,
      bossSpawned: this.bossSpawned,
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
    resetFrameCache();
    resetEnemySpatialHash();

    // Reset timers
    this.autoSaveTimer = 0;

    // Initialize ECS world
    this.world = createWorld();

    // Initialize visual systems
    this.gridBackground = new GridBackground(this);
    this.trailManager = new TrailManager(this);
    this.masteryVisualsManager = new MasteryVisualsManager(this);
    this.shieldBarrierVisual = new ShieldBarrierVisual(this);
    this.masteryIconEffects = new MasteryIconEffectsManager(this);

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
    this.dashCooldownTimer = state.dashCooldownTimer;
    this.damageCooldown = state.damageCooldown;

    // Restore spawn tracking
    this.bossSpawned = state.bossSpawned;
    this.minibossSpawnTimes = state.minibossSpawnTimes;

    // Restore player state
    this.playerStats = state.playerStats;
    this.banishedUpgradeIds = new Set(state.banishedUpgradeIds);
    this.isAutoBuyEnabled = state.isAutoBuyEnabled;

    // Restore world level and multipliers
    this.worldLevel = state.worldLevel ?? 1;
    this.worldLevelHealthMult = state.worldLevelHealthMult;
    this.worldLevelDamageMult = state.worldLevelDamageMult;
    this.worldLevelSpawnReduction = state.worldLevelSpawnReduction;
    this.worldLevelXPMult = state.worldLevelXPMult;

    // Reset other state
    this.isGameOver = false;
    this.isPaused = false;
    this.isPauseMenuOpen = false;
    this.isShopConfirmationOpen = false;
    this.hasWon = false;
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashDirectionX = 0;
    this.dashDirectionY = 0;
    this.pendingLevelUps = 0;
    this.nextEnemyDropsMagnet = false;
    this.fpsHistory = [];
    this.activeLasers = [];
    this.enemyProjectiles = [];
    for (const bar of this.activeBossHealthBars) {
      bar.container.destroy();
    }
    this.activeBossHealthBars = [];

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

    // Setup input
    this.setupInput();

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

    // Restore weapons
    for (const weaponData of state.weapons) {
      const weapon = createWeapon(weaponData.id);
      if (weapon) {
        // Level up to saved level (weapons start at level 1)
        for (let i = 1; i < weaponData.level; i++) {
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
      () => {},
      (enemyId, x, y) => {
        this.handleEnemyDeath(enemyId, x, y);
      },
      (amount) => {
        this.healPlayer(amount);
      }
    );

    // Sync stats to player
    this.syncStatsToPlayer();

    // Create UI
    this.createUI();

    // Populate upgrade icons with restored weapons and upgrades
    this.updateUpgradeIcons();

    // Setup pause key
    this.escKeyHandler = () => {
      this.togglePauseMenu();
    };
    this.input.keyboard?.on('keydown-ESC', this.escKeyHandler);

    // Setup auto-buy toggle key
    this.autoBuyKeyHandler = () => {
      this.toggleAutoBuy();
    };
    this.input.keyboard?.on('keydown-T', this.autoBuyKeyHandler);

    // Setup beforeunload handler
    this.setupBeforeUnloadHandler();

    // Setup auto-pause when tab/window loses focus
    this.setupFocusLossHandlers();
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

    // Setup life steal callback
    setLifeStealCallback((amount) => {
      this.healPlayer(amount);
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
    if (this.activeBossHealthBars.length > 0) {
      this.repositionBossHealthBars();
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

    // Create player visual
    this.playerPlasmaCore = new PlayerPlasmaCore(this, entity.transform.x, entity.transform.y, {
      baseRadius: 16,
      neonColor: PLAYER_NEON,
      quality: this.visualQuality,
    });
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

    this.enemyCount++;

    // Create boss health bar if this is a boss/miniboss
    if (entity.enemyData.xpValue >= 30) {
      const bossBar = this.createBossHealthBar(entityId, enemyType.name, entity.enemyData.xpValue >= 1000);
      this.activeBossHealthBars.push(bossBar);
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
    this.removeBossHealthBar(enemyId);

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

    // Boss death has massive effect and triggers victory + world level advancement
    if (xpValue >= 1000) {
      // Multi-point explosion
      this.effectsManager.playDeathBurst(x, y);
      this.effectsManager.playDeathBurst(x + 20, y + 20);
      this.effectsManager.playDeathBurst(x - 20, y - 20);
      this.effectsManager.playDeathBurst(x + 20, y - 20);
      this.effectsManager.playDeathBurst(x - 20, y + 20);
      // Big screen shake and flash
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(300, 0.025);
      }
      this.effectsManager.playImpactFlash(0.3, 120);

      // Boss kill = Victory! Advance to next world level
      if (!this.hasWon) {
        const metaManager = getMetaProgressionManager();
        metaManager.advanceWorldLevel();
        this.showVictory();
      }
    }
    // Miniboss death has bigger effect
    else if (xpValue >= 30) {
      this.effectsManager.playDeathBurst(x, y);
      this.effectsManager.playDeathBurst(x + 10, y + 10);
      this.effectsManager.playDeathBurst(x - 10, y - 10);
      // Medium screen shake
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.cameras.main.shake(200, 0.015);
      }
    } else {
      // Normal death effect
      this.effectsManager.playDeathBurst(x, y);
    }

    // Clean up entity
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
      if (proj.sprite.x < -20 || proj.sprite.x > GAME_WIDTH + 20 ||
          proj.sprite.y < -20 || proj.sprite.y > GAME_HEIGHT + 20) {
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

  private createUI(): void {
    const leftMargin = HUD_EDGE_PADDING;
    let currentY = HUD_EDGE_PADDING;

    // === TOP LEFT: Level & Stats Panel ===

    // Level display (large)
    this.levelText = this.add.text(leftMargin, currentY, 'Level 1', {
      fontSize: '28px',
      color: '#ffdd44',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    });
    this.levelText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);
    currentY += 35;

    // HP Bar (above XP bar)
    const hpBarWidth = 180;
    const hpBarHeight = 14;

    this.hpBarBackground = this.add.rectangle(
      leftMargin + hpBarWidth / 2,
      currentY + hpBarHeight / 2,
      hpBarWidth,
      hpBarHeight,
      0x333333
    );
    this.hpBarBackground.setStrokeStyle(1, 0x666666);
    this.hpBarBackground.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    this.hpBarFill = this.add.rectangle(
      leftMargin + 1,
      currentY + hpBarHeight / 2,
      hpBarWidth - 2,
      hpBarHeight - 2,
      0x44ff44
    );
    this.hpBarFill.setOrigin(0, 0.5);
    this.hpBarFill.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // HP Text overlay
    this.hpText = this.add.text(
      leftMargin + hpBarWidth / 2,
      currentY + hpBarHeight / 2,
      '100/100',
      {
        fontSize: '11px',
        color: '#000000',
        fontFamily: 'Arial',
        stroke: '#ffffff',
        strokeThickness: 2,
      }
    );
    this.hpText.setOrigin(0.5);
    this.hpText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // HP label
    this.add.text(leftMargin + hpBarWidth + 8, currentY + hpBarHeight / 2, 'HP', {
      fontSize: '12px',
      color: '#ff6666',
      fontFamily: 'Arial',
    }).setOrigin(0, 0.5).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    currentY += hpBarHeight + HUD_ELEMENT_SPACING;

    // XP Bar (below HP bar)
    const xpBarWidth = 180;
    const xpBarHeight = 12;

    this.xpBarBackground = this.add.rectangle(
      leftMargin + xpBarWidth / 2,
      currentY + xpBarHeight / 2,
      xpBarWidth,
      xpBarHeight,
      0x333333
    );
    this.xpBarBackground.setStrokeStyle(1, 0x666666);
    this.xpBarBackground.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    this.xpBarFill = this.add.rectangle(
      leftMargin + 1,
      currentY + xpBarHeight / 2,
      0,
      xpBarHeight - 2,
      0x44ff44
    );
    this.xpBarFill.setOrigin(0, 0.5);
    this.xpBarFill.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // XP label
    this.add.text(leftMargin + xpBarWidth + 8, currentY + xpBarHeight / 2, 'XP', {
      fontSize: '12px',
      color: '#44ff44',
      fontFamily: 'Arial',
    }).setOrigin(0, 0.5).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    currentY += xpBarHeight + HUD_ELEMENT_SPACING * 2;

    // === Upgrade Icons Container ===
    this.upgradeIconsContainer = this.add.container(leftMargin, currentY);
    this.upgradeIconsContainer.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Create upgrade tooltip (hidden by default)
    this.upgradeTooltip = this.add.container(0, 0);
    this.upgradeTooltip.setVisible(false);
    this.upgradeTooltip.setDepth(HUD_DEPTH + 1); // Slightly above other HUD elements

    const tooltipBg = this.add.rectangle(0, 0, 180, 60, 0x222244, 0.95);
    tooltipBg.setStrokeStyle(2, 0x4444aa);
    tooltipBg.setOrigin(0, 0);

    const tooltipTitle = this.add.text(10, 8, '', {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setName('tooltipTitle');

    const tooltipDesc = this.add.text(10, 28, '', {
      fontSize: '11px',
      color: '#aaaaaa',
      fontFamily: 'Arial',
    }).setName('tooltipDesc');

    const tooltipLevel = this.add.text(10, 44, '', {
      fontSize: '11px',
      color: '#88aaff',
      fontFamily: 'Arial',
    }).setName('tooltipLevel');

    this.upgradeTooltip.add([tooltipBg, tooltipTitle, tooltipDesc, tooltipLevel]);

    // === TOP RIGHT: Pause Button & Game Stats ===

    // Pause button (top right corner)
    const pauseButtonSize = 36;
    const pauseButtonX = GAME_WIDTH - HUD_EDGE_PADDING - pauseButtonSize / 2;
    const pauseButtonY = HUD_EDGE_PADDING + pauseButtonSize / 2;

    // Stats positioned below the pause button, right-aligned to screen edge
    const statsRightX = GAME_WIDTH - HUD_EDGE_PADDING;
    const statsTopY = pauseButtonY + pauseButtonSize / 2 + 8;

    // World level display (centered, above timer)
    const worldLevel = getMetaProgressionManager().getWorldLevel();
    this.add.text(GAME_WIDTH / 2, HUD_EDGE_PADDING, `World ${worldLevel}`, {
      fontSize: '14px',
      color: '#88aaff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0).setName('worldLevelText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Game time display (centered top, below world level)
    this.add.text(GAME_WIDTH / 2, HUD_EDGE_PADDING + 18 + HUD_ELEMENT_SPACING, '', {
      fontSize: '28px',
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0).setName('timerText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Kill count display (below pause button, right-aligned)
    this.add.text(statsRightX, statsTopY, '', {
      fontSize: '16px',
      color: '#88ff88',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: 6, y: 3 },
    }).setOrigin(1, 0).setName('killCountText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Gold preview display (below kill count, right-aligned)
    this.add.text(statsRightX, statsTopY + 24, '', {
      fontSize: '14px',
      color: '#ffdd44',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: 6, y: 2 },
    }).setOrigin(1, 0).setName('goldPreviewText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    const pauseButtonBg = this.add.rectangle(
      pauseButtonX,
      pauseButtonY,
      pauseButtonSize,
      pauseButtonSize,
      0x333333,
      0.8
    );
    pauseButtonBg.setStrokeStyle(2, 0x666666);
    pauseButtonBg.setInteractive({ useHandCursor: true });
    pauseButtonBg.setName('pauseButtonBg');
    pauseButtonBg.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    const pauseButtonIcon = this.add.text(pauseButtonX, pauseButtonY, '⏸', {
      fontSize: '20px',
    });
    pauseButtonIcon.setOrigin(0.5);
    pauseButtonIcon.setName('pauseButtonIcon');
    pauseButtonIcon.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Pause button hover effects
    pauseButtonBg.on('pointerover', () => {
      pauseButtonBg.setFillStyle(0x555555, 0.9);
    });
    pauseButtonBg.on('pointerout', () => {
      pauseButtonBg.setFillStyle(0x333333, 0.8);
    });
    pauseButtonBg.on('pointerdown', () => {
      this.togglePauseMenu();
    });

    // Controls hint (bottom left)
    this.add.text(HUD_EDGE_PADDING, GAME_HEIGHT - HUD_EDGE_PADDING, 'WASD / Arrows to move', {
      fontSize: '14px',
      color: '#888888',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: 6, y: 3 },
    }).setOrigin(0, 1).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // BGM info display (bottom left, above controls hint)
    this.createBGMDisplay();
    this.updateBGMDisplay();

    // Auto-buy toggle UI (bottom right, above music controls)
    this.createAutoBuyToggle();

    // FPS counter (bottom right corner, above auto-buy toggle)
    // Auto-buy toggle is 26px tall, so FPS goes above it with spacing
    const autoBuyToggleHeight = 26;
    const fpsY = GAME_HEIGHT - HUD_EDGE_PADDING - autoBuyToggleHeight - HUD_ELEMENT_SPACING;
    this.fpsText = this.add.text(GAME_WIDTH - HUD_EDGE_PADDING, fpsY, 'FPS: --', {
      fontSize: '14px',
      color: '#00ff00',
      fontFamily: 'monospace',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
    });
    this.fpsText.setOrigin(1, 1);
    this.fpsText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);
    // Set initial visibility based on settings
    this.fpsText.setVisible(getSettingsManager().isFpsCounterEnabled());
  }

  /**
   * Creates the auto-buy toggle UI with clickable button.
   * Position: Bottom-right corner, matching the game's bracket-style UI.
   * Only shown if auto-upgrade is purchased from the shop.
   */
  private createAutoBuyToggle(): void {
    // Only show toggle if auto-upgrade is purchased (level >= 1)
    const autoUpgradeLevel = getMetaProgressionManager().getAutoUpgradeLevel();
    if (autoUpgradeLevel < 1) {
      return; // Toggle hidden until purchased
    }

    // Load saved auto-buy preference from secure storage
    const savedAutoBuy = SecureStorage.getItem(STORAGE_KEY_AUTO_BUY);
    if (savedAutoBuy !== null) {
      this.isAutoBuyEnabled = savedAutoBuy === 'true';
    }

    const toggleWidth = 190;
    const toggleHeight = 26;
    // Position with right edge at HUD_EDGE_PADDING from screen edge
    const toggleX = GAME_WIDTH - HUD_EDGE_PADDING - toggleWidth / 2;
    // Position with bottom edge at HUD_EDGE_PADDING from screen edge
    const toggleY = GAME_HEIGHT - HUD_EDGE_PADDING - toggleHeight / 2;

    // Background rectangle for the toggle button
    this.autoBuyToggleBg = this.add.rectangle(
      toggleX,
      toggleY,
      toggleWidth,
      toggleHeight,
      0x2a2a4a
    );
    this.autoBuyToggleBg.setStrokeStyle(2, 0x4a4a7a);
    this.autoBuyToggleBg.setInteractive({ useHandCursor: true });
    this.autoBuyToggleBg.setName('autoBuyToggleBg');
    this.autoBuyToggleBg.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Toggle text with bracket format matching existing UI
    this.autoBuyToggleText = this.add.text(
      toggleX,
      toggleY,
      '[ AUTO-UPGRADE: OFF ]',
      {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#888888',
      }
    );
    this.autoBuyToggleText.setOrigin(0.5);
    this.autoBuyToggleText.setName('autoBuyToggleText');
    this.autoBuyToggleText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Click handler
    this.autoBuyToggleBg.on('pointerdown', () => {
      this.toggleAutoBuy();
    });

    // Hover effects
    this.autoBuyToggleBg.on('pointerover', () => {
      this.autoBuyToggleBg?.setFillStyle(0x3a3a6a);
    });
    this.autoBuyToggleBg.on('pointerout', () => {
      this.autoBuyToggleBg?.setFillStyle(0x2a2a4a);
    });

    // Update visual state based on initial setting
    this.updateAutoBuyToggleVisual();
  }

  /**
   * Updates the auto-buy toggle visual state based on current setting.
   * Shows tier level when enabled (T2, T3, T4) for purchased intelligence upgrades.
   */
  private updateAutoBuyToggleVisual(): void {
    if (!this.autoBuyToggleText) return;

    const autoUpgradeLevel = getMetaProgressionManager().getAutoUpgradeLevel();

    if (this.isAutoBuyEnabled) {
      // Show tier indicator if level > 1 (has intelligence upgrades)
      const tierText = autoUpgradeLevel > 1 ? ` T${autoUpgradeLevel}` : '';
      this.autoBuyToggleText.setText(`[ AUTO${tierText}: ON ]`);
      this.autoBuyToggleText.setColor('#ffdd44'); // Gold for active
      this.autoBuyToggleBg?.setStrokeStyle(2, 0xffdd44);
    } else {
      this.autoBuyToggleText.setText('[ AUTO-UPGRADE: OFF ]');
      this.autoBuyToggleText.setColor('#888888'); // Gray for inactive
      this.autoBuyToggleBg?.setStrokeStyle(2, 0x4a4a7a);
    }
  }

  /**
   * Toggles the auto-buy feature on/off.
   * Shows confirmation text and updates the UI.
   * Requires auto-upgrade to be purchased from the shop.
   */
  private toggleAutoBuy(): void {
    // Don't toggle during pause menu or upgrade selection
    if (this.isPauseMenuOpen || this.scene.isActive('UpgradeScene')) {
      return;
    }

    // Don't toggle if auto-upgrade is not purchased
    if (getMetaProgressionManager().getAutoUpgradeLevel() < 1) {
      return;
    }

    this.isAutoBuyEnabled = !this.isAutoBuyEnabled;
    this.updateAutoBuyToggleVisual();

    // Persist setting to secure storage
    SecureStorage.setItem(STORAGE_KEY_AUTO_BUY, String(this.isAutoBuyEnabled));

    // Show confirmation floating text at screen center
    const confirmText = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
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
      y: GAME_HEIGHT / 2 - 50,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => confirmText.destroy(),
    });
  }

  /**
   * Creates the BGM info display with track info, mute, and skip controls.
   */
  private createBGMDisplay(): void {
    // Position BGM row above controls hint with consistent spacing
    // Controls hint is ~18px tall, BGM icons are ~14px, add double spacing for clarity
    const controlsHintHeight = 18;
    const bgmRowHeight = 14;
    const bottomY = GAME_HEIGHT - HUD_EDGE_PADDING - controlsHintHeight - HUD_ELEMENT_SPACING * 2 - bgmRowHeight;

    // Container for all BGM elements
    this.bgmContainer = this.add.container(HUD_EDGE_PADDING, bottomY);
    this.bgmContainer.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Mute button (sprite) - first element (always shows volume icon)
    this.bgmMuteButton = createIcon(this, {
      x: 7,
      y: 7,
      iconKey: 'volume',
      size: 14,
    });
    this.bgmMuteButton.setInteractive({ useHandCursor: true });
    this.bgmMuteButton.on('pointerover', () => {
      this.bgmMuteButton.setScale(this.bgmMuteButton.scaleX * 1.2);
    });
    this.bgmMuteButton.on('pointerout', () => {
      this.bgmMuteButton.setScale(14 / 64); // Reset to original scale
    });
    this.bgmMuteButton.on('pointerdown', () => {
      this.toggleBGMMute();
    });

    // Strikethrough line for muted state (diagonal from top-right to bottom-left)
    this.bgmMuteStrike = this.add.graphics();
    this.bgmMuteStrike.lineStyle(2, 0xff4444, 1);
    this.bgmMuteStrike.lineBetween(14, 0, 0, 14);
    this.bgmMuteStrike.setVisible(false);

    // Skip button (sprite) - after mute
    const skipButton = createIcon(this, {
      x: 25,
      y: 7,
      iconKey: 'forward',
      size: 14,
    });
    skipButton.setInteractive({ useHandCursor: true });
    skipButton.on('pointerover', () => {
      skipButton.setScale(skipButton.scaleX * 1.2);
    });
    skipButton.on('pointerout', () => {
      skipButton.setScale(14 / 64); // Reset to original scale
    });
    skipButton.on('pointerdown', () => {
      this.skipToNextTrack();
    });

    // Music note icon (sprite) - after controls with small gap
    const musicIcon = createIcon(this, {
      x: 50,
      y: 7,
      iconKey: 'music',
      size: 14,
      tint: 0x8888aa,
    });

    // Track info text - after music icon
    this.bgmTrackText = this.add.text(65, 0, 'Loading...', {
      fontSize: '12px',
      color: '#8888aa',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: 4, y: 2 },
    });

    this.bgmContainer.add([this.bgmMuteButton, this.bgmMuteStrike, skipButton, musicIcon, this.bgmTrackText]);
  }

  /**
   * Toggles BGM mute state.
   */
  private toggleBGMMute(): void {
    const musicManager = getMusicManager();
    const currentMode = musicManager.getPlaybackMode();

    if (currentMode === 'off') {
      // Unmute - restore to sequential
      musicManager.setPlaybackMode('sequential');
      musicManager.play();
      this.bgmMuteStrike.setVisible(false);
    } else {
      // Mute
      musicManager.setPlaybackMode('off');
      this.bgmMuteStrike.setVisible(true);
    }
  }

  /**
   * Skips to the next track in the playlist.
   */
  private skipToNextTrack(): void {
    const musicManager = getMusicManager();
    if (musicManager.getPlaybackMode() !== 'off') {
      musicManager.nextTrack();
    }
  }

  update(_time: number, delta: number): void {
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
    let highlightsExpired = false;
    for (const [upgradeId, expiresAt] of this.activeIconHighlights) {
      if (this.gameTime >= expiresAt) {
        this.activeIconHighlights.delete(upgradeId);
        highlightsExpired = true;
      }
    }
    if (highlightsExpired) {
      this.updateUpgradeIcons(); // Rebuild without expired glows
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
    // Update dash cooldown
    if (this.dashCooldownTimer > 0) {
      this.dashCooldownTimer -= deltaSeconds;
    }

    // Process active dash
    if (this.isDashing) {
      this.dashTimer -= deltaSeconds;

      // Apply dash velocity
      const dashSpeed = this.playerStats.moveSpeed * this.DASH_SPEED_MULT;
      Velocity.x[this.playerId] = this.dashDirectionX * dashSpeed;
      Velocity.y[this.playerId] = this.dashDirectionY * dashSpeed;

      // End dash when timer expires
      if (this.dashTimer <= 0) {
        this.isDashing = false;
      }
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
      this.spawnEnemy();
      this.spawnTimer = 0;

      // Increase spawn rate over time (faster spawning as game progresses)
      this.spawnInterval = Math.max(0.3, 1.0 - this.gameTime * 0.01);
    }

    // Check for miniboss spawns
    this.checkMinibossSpawns();

    // Check for boss spawn
    this.checkBossSpawn();

    // Check for endless mode spawns (post-victory)
    if (this.endlessModeActive) {
      this.checkEndlessModeSpawns(deltaSeconds);
    }

    // Update laser beams
    this.updateLaserBeams(deltaSeconds);

    // Update joystick input
    if (this.joystickManager) {
      const joystickDirection = this.joystickManager.getDirection();
      this.inputState.joystickX = joystickDirection.x;
      this.inputState.joystickY = joystickDirection.y;
    }

    // Run ECS systems
    inputSystem(this.world, this.inputState);
    enemyAISystem(this.world, deltaSeconds);
    movementSystem(this.world, deltaSeconds);

    // Process knockback for enemies
    this.processKnockback(deltaSeconds);

    // Keep player on screen
    if (this.playerId !== -1) {
      clampPlayerToScreen(this.world, this.playerId);
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
    this.updateGridBackground();

    // Update motion trails for player and fast enemies
    this.updateTrails(deltaSeconds);

    // Update effects (damage numbers, etc.)
    this.effectsManager.update(delta);

    // Update visual quality based on FPS (auto-scaling)
    this.updateVisualQuality(delta);

    // Update UI
    this.updateUI();
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
      const enemyX = Transform.x[enemyId];
      const enemyY = Transform.y[enemyId];

      const distanceX = playerX - enemyX;
      const distanceY = playerY - enemyY;
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;
      const collisionDistance = playerRadius + enemyRadius;

      if (distanceSquared < collisionDistance * collisionDistance) {
        // Collision! Take damage
        this.takeDamage(10); // 10 damage per hit
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
    if (this.isDashing) {
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
    const x = padding + Math.random() * (GAME_WIDTH - padding * 2);
    const y = padding + Math.random() * (GAME_HEIGHT - padding * 2);

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
   * Toggles the pause menu on/off.
   * Only works when not in upgrade selection, victory screen, or game over.
   */
  private togglePauseMenu(): void {
    if (this.isPauseMenuOpen) {
      this.hidePauseMenu();
    } else if (!this.isPaused && !this.isGameOver) {
      this.showPauseMenu();
    }
  }

  /**
   * Called by SettingsScene when returning to GameScene.
   * Ensures the pause menu is shown reliably (doesn't rely on resume event).
   */
  public showPauseMenuFromSettings(): void {
    if (!this.isPauseMenuOpen && !this.isGameOver) {
      this.isPaused = true;
      this.showPauseMenu();
    }
  }

  /**
   * Shows the pause menu with Resume and Restart options.
   */
  private showPauseMenu(): void {
    this.isPauseMenuOpen = true;
    this.isPaused = true;

    // Create pause overlay
    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.75
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);
    overlay.setName('pauseOverlay');

    // 8px grid spacing for pause menu
    const menuCenterY = GAME_HEIGHT / 2;
    const buttonSpacing = 64; // 8px aligned gap between button centers

    // Pause title
    const pauseTitle = this.add.text(GAME_WIDTH / 2, menuCenterY - 144, 'PAUSED', {
      fontSize: '56px',
      color: '#ffffff',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 4,
    });
    pauseTitle.setOrigin(0.5);
    pauseTitle.setDepth(PAUSE_MENU_DEPTH + 1);
    pauseTitle.setName('pauseTitle');

    // Gold display in pause menu (48px below title)
    const metaManager = getMetaProgressionManager();
    const pauseGoldDisplay = this.add.text(
      GAME_WIDTH / 2,
      menuCenterY - 88,
      `Gold: ${metaManager.getGold()}`,
      {
        fontSize: '24px',
        color: '#ffcc00',
        fontFamily: 'Arial',
      }
    );
    pauseGoldDisplay.setOrigin(0.5);
    pauseGoldDisplay.setDepth(PAUSE_MENU_DEPTH + 1);
    pauseGoldDisplay.setName('pauseGoldText');

    // Resume button (48px below gold)
    const resumeButtonWidth = 180;
    const resumeButtonHeight = 50;
    const resumeButtonY = menuCenterY - 32;

    const resumeButtonBg = this.add.rectangle(
      GAME_WIDTH / 2,
      resumeButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x44aa44
    );
    resumeButtonBg.setStrokeStyle(3, 0x66cc66);
    resumeButtonBg.setInteractive({ useHandCursor: true });
    resumeButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    resumeButtonBg.setName('resumeButtonBg');

    const resumeButtonText = this.add.text(GAME_WIDTH / 2, resumeButtonY, 'Resume', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    resumeButtonText.setOrigin(0.5);
    resumeButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    resumeButtonText.setName('resumeButtonText');

    // Resume button hover effects
    resumeButtonBg.on('pointerover', () => {
      resumeButtonBg.setFillStyle(0x55bb55);
    });
    resumeButtonBg.on('pointerout', () => {
      resumeButtonBg.setFillStyle(0x44aa44);
    });
    resumeButtonBg.on('pointerdown', () => {
      this.hidePauseMenu();
    });

    // Settings button (64px below resume)
    const settingsButtonY = resumeButtonY + buttonSpacing;

    const settingsButtonBg = this.add.rectangle(
      GAME_WIDTH / 2,
      settingsButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x446688
    );
    settingsButtonBg.setStrokeStyle(3, 0x6688aa);
    settingsButtonBg.setInteractive({ useHandCursor: true });
    settingsButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    settingsButtonBg.setName('settingsButtonBg');

    const settingsButtonText = this.add.text(GAME_WIDTH / 2, settingsButtonY, 'Settings', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    settingsButtonText.setOrigin(0.5);
    settingsButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    settingsButtonText.setName('settingsButtonText');

    // Settings button hover effects
    settingsButtonBg.on('pointerover', () => {
      settingsButtonBg.setFillStyle(0x5577aa);
    });
    settingsButtonBg.on('pointerout', () => {
      settingsButtonBg.setFillStyle(0x446688);
    });
    settingsButtonBg.on('pointerdown', () => {
      this.hidePauseMenu();
      this.isPaused = true; // Keep paused while in settings
      this.scene.launch('SettingsScene', { returnTo: 'GameScene' });
      this.scene.pause();
    });

    // Restart button (64px below settings)
    const restartButtonY = settingsButtonY + buttonSpacing;

    const restartButtonBg = this.add.rectangle(
      GAME_WIDTH / 2,
      restartButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x666666
    );
    restartButtonBg.setStrokeStyle(3, 0x888888);
    restartButtonBg.setInteractive({ useHandCursor: true });
    restartButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    restartButtonBg.setName('restartButtonBg');

    const restartButtonText = this.add.text(GAME_WIDTH / 2, restartButtonY, 'Restart', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    restartButtonText.setOrigin(0.5);
    restartButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    restartButtonText.setName('restartButtonText');

    // Restart button hover effects
    restartButtonBg.on('pointerover', () => {
      restartButtonBg.setFillStyle(0x884444);
    });
    restartButtonBg.on('pointerout', () => {
      restartButtonBg.setFillStyle(0x666666);
    });
    restartButtonBg.on('pointerdown', () => {
      this.showEndRunConfirmation('restart');
    });

    // Quit to Menu button (64px below restart)
    const quitMenuButtonY = restartButtonY + buttonSpacing;

    const quitMenuButtonBg = this.add.rectangle(
      GAME_WIDTH / 2,
      quitMenuButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x664444
    );
    quitMenuButtonBg.setStrokeStyle(3, 0x886666);
    quitMenuButtonBg.setInteractive({ useHandCursor: true });
    quitMenuButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    quitMenuButtonBg.setName('quitMenuButtonBg');

    const quitMenuButtonText = this.add.text(GAME_WIDTH / 2, quitMenuButtonY, 'Quit to Menu', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    quitMenuButtonText.setOrigin(0.5);
    quitMenuButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    quitMenuButtonText.setName('quitMenuButtonText');

    quitMenuButtonBg.on('pointerover', () => {
      quitMenuButtonBg.setFillStyle(0x885555);
    });
    quitMenuButtonBg.on('pointerout', () => {
      quitMenuButtonBg.setFillStyle(0x664444);
    });
    quitMenuButtonBg.on('pointerdown', () => {
      this.showEndRunConfirmation('menu');
    });

    // Quit to Shop button (64px below quit menu)
    const quitShopButtonY = quitMenuButtonY + buttonSpacing;

    const quitShopButtonBg = this.add.rectangle(
      GAME_WIDTH / 2,
      quitShopButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x666644
    );
    quitShopButtonBg.setStrokeStyle(3, 0x888866);
    quitShopButtonBg.setInteractive({ useHandCursor: true });
    quitShopButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    quitShopButtonBg.setName('quitShopButtonBg');

    const quitShopButtonText = this.add.text(GAME_WIDTH / 2, quitShopButtonY, 'Quit to Shop', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    quitShopButtonText.setOrigin(0.5);
    quitShopButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    quitShopButtonText.setName('quitShopButtonText');

    quitShopButtonBg.on('pointerover', () => {
      quitShopButtonBg.setFillStyle(0x888855);
    });
    quitShopButtonBg.on('pointerout', () => {
      quitShopButtonBg.setFillStyle(0x666644);
    });
    quitShopButtonBg.on('pointerdown', () => {
      this.showEndRunConfirmation('shop');
    });

    // Hint text (48px below last button)
    const hintText = this.add.text(GAME_WIDTH / 2, quitShopButtonY + 48, 'Press ESC to resume', {
      fontSize: '14px',
      color: '#888888',
      fontFamily: 'Arial',
    });
    hintText.setOrigin(0.5);
    hintText.setDepth(PAUSE_MENU_DEPTH + 1);
    hintText.setName('pauseHintText');
  }

  /**
   * Hides the pause menu and resumes gameplay.
   */
  private hidePauseMenu(): void {
    // Remove all pause menu UI elements
    const elementsToRemove = [
      'pauseOverlay',
      'pauseTitle',
      'pauseGoldText',
      'resumeButtonBg',
      'resumeButtonText',
      'settingsButtonBg',
      'settingsButtonText',
      'restartButtonBg',
      'restartButtonText',
      'quitMenuButtonBg',
      'quitMenuButtonText',
      'quitShopButtonBg',
      'quitShopButtonText',
      'pauseHintText',
    ];
    elementsToRemove.forEach((name) => {
      const element = this.children.getByName(name);
      if (element) element.destroy();
    });

    this.isPauseMenuOpen = false;
    this.isPaused = false;

    // Ensure scene is resumed at Phaser level (safe to call even if not paused)
    this.scene.resume();
  }

  /**
   * Shows the end run confirmation dialog with gold breakdown.
   * Allows player to confirm or cancel ending the run.
   * @param destination Where to go after confirming: 'shop', 'menu', or 'restart'
   */
  private showEndRunConfirmation(destination: 'shop' | 'menu' | 'restart'): void {
    // Hide pause menu first
    this.hidePauseMenu();
    this.isPaused = true; // Keep game paused
    this.isShopConfirmationOpen = true;

    // Calculate gold using the same formula as death (hasWon=false)
    const metaManager = getMetaProgressionManager();
    const finalTotal = metaManager.calculateRunGold(
      this.killCount,
      this.gameTime,
      this.playerStats.level,
      false  // Same as death, no victory bonus
    );

    // Calculate breakdown components for display
    const killGold = Math.floor(this.killCount * 2.5);
    const timeGold = Math.floor(this.gameTime / 10);
    const levelGold = this.playerStats.level * 10;
    const baseTotal = killGold + timeGold + levelGold;
    const goldMultiplier = metaManager.getStartingGoldMultiplier();
    const worldLevelMultiplier = metaManager.getWorldLevelGoldMultiplier();
    const streakMultiplier = metaManager.getStreakGoldMultiplier();

    // Create confirmation overlay
    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.85
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);
    overlay.setName('shopConfirmOverlay');

    // 8px grid spacing for confirmation dialog
    const dialogCenterY = GAME_HEIGHT / 2;

    // Title
    const titleText = this.add.text(GAME_WIDTH / 2, dialogCenterY - 168, 'End Run?', {
      fontSize: '48px',
      color: '#ffcc00',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 4,
    });
    titleText.setOrigin(0.5);
    titleText.setDepth(PAUSE_MENU_DEPTH + 1);
    titleText.setName('shopConfirmTitle');

    // Subtitle (56px below title)
    const subtitleText = this.add.text(
      GAME_WIDTH / 2,
      dialogCenterY - 104,
      'You will earn the following gold:',
      {
        fontSize: '20px',
        color: '#aaaaaa',
        fontFamily: 'Arial',
      }
    );
    subtitleText.setOrigin(0.5);
    subtitleText.setDepth(PAUSE_MENU_DEPTH + 1);
    subtitleText.setName('shopConfirmSubtitle');

    // Gold breakdown (32px below subtitle, using top-center origin for multi-line text)
    const breakdownLines = [
      `Kills: ${this.killCount} × 2.5 = ${killGold} gold`,
      `Time: ${Math.floor(this.gameTime)}s ÷ 10 = ${timeGold} gold`,
      `Level: ${this.playerStats.level} × 10 = ${levelGold} gold`,
      `Base: ${baseTotal} gold`,
    ];

    // Add multiplier lines if applicable
    if (goldMultiplier > 1) {
      breakdownLines.push(`Gold Bonus: ×${goldMultiplier.toFixed(2)}`);
    }
    if (worldLevelMultiplier > 1) {
      breakdownLines.push(`World Level: ×${worldLevelMultiplier.toFixed(2)}`);
    }
    if (streakMultiplier > 1) {
      breakdownLines.push(`Win Streak: ×${streakMultiplier.toFixed(2)}`);
    }

    const breakdownText = this.add.text(
      GAME_WIDTH / 2,
      dialogCenterY - 64,
      breakdownLines.join('\n'),
      {
        fontSize: '18px',
        color: '#cccccc',
        fontFamily: 'Arial',
        align: 'center',
        lineSpacing: 12,
      }
    );
    breakdownText.setOrigin(0.5, 0); // Top-center origin for proper multi-line positioning
    breakdownText.setDepth(PAUSE_MENU_DEPTH + 1);
    breakdownText.setName('shopConfirmBreakdown');

    // Total gold (40px below breakdown bottom)
    const totalText = this.add.text(
      GAME_WIDTH / 2,
      dialogCenterY + 72,
      `Total: +${finalTotal} gold`,
      {
        fontSize: '32px',
        color: '#ffdd44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      }
    );
    totalText.setOrigin(0.5);
    totalText.setDepth(PAUSE_MENU_DEPTH + 1);
    totalText.setName('shopConfirmTotal');

    // Buttons (72px below total)
    const confirmButtonWidth = 160;
    const confirmButtonHeight = 50;
    const buttonY = dialogCenterY + 152;

    const confirmButtonBg = this.add.rectangle(
      GAME_WIDTH / 2 - 100,
      buttonY,
      confirmButtonWidth,
      confirmButtonHeight,
      0x44aa44
    );
    confirmButtonBg.setStrokeStyle(3, 0x66cc66);
    confirmButtonBg.setInteractive({ useHandCursor: true });
    confirmButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    confirmButtonBg.setName('shopConfirmButtonBg');

    const confirmButtonText = this.add.text(GAME_WIDTH / 2 - 100, buttonY, 'Confirm', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    confirmButtonText.setOrigin(0.5);
    confirmButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    confirmButtonText.setName('shopConfirmButtonText');

    confirmButtonBg.on('pointerover', () => {
      confirmButtonBg.setFillStyle(0x55bb55);
    });
    confirmButtonBg.on('pointerout', () => {
      confirmButtonBg.setFillStyle(0x44aa44);
    });
    confirmButtonBg.on('pointerdown', () => {
      // Clear the save to prevent exploit (continuing after intentionally ending)
      getGameStateManager().clearSave();
      // Award gold and go to destination
      metaManager.addGold(finalTotal);
      if (destination === 'restart') {
        this.scene.restart();
      } else {
        this.scene.start(destination === 'shop' ? 'ShopScene' : 'BootScene');
      }
    });

    // Cancel button
    const cancelButtonBg = this.add.rectangle(
      GAME_WIDTH / 2 + 100,
      buttonY,
      confirmButtonWidth,
      confirmButtonHeight,
      0x664444
    );
    cancelButtonBg.setStrokeStyle(3, 0x886666);
    cancelButtonBg.setInteractive({ useHandCursor: true });
    cancelButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    cancelButtonBg.setName('shopCancelButtonBg');

    const cancelButtonText = this.add.text(GAME_WIDTH / 2 + 100, buttonY, 'Cancel', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    cancelButtonText.setOrigin(0.5);
    cancelButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    cancelButtonText.setName('shopCancelButtonText');

    cancelButtonBg.on('pointerover', () => {
      cancelButtonBg.setFillStyle(0x885555);
    });
    cancelButtonBg.on('pointerout', () => {
      cancelButtonBg.setFillStyle(0x664444);
    });
    cancelButtonBg.on('pointerdown', () => {
      this.hideShopConfirmation();
      this.showPauseMenu();
    });
  }

  /**
   * Hides the shop confirmation dialog.
   */
  private hideShopConfirmation(): void {
    const elementsToRemove = [
      'shopConfirmOverlay',
      'shopConfirmTitle',
      'shopConfirmSubtitle',
      'shopConfirmBreakdown',
      'shopConfirmTotal',
      'shopConfirmButtonBg',
      'shopConfirmButtonText',
      'shopCancelButtonBg',
      'shopCancelButtonText',
    ];
    elementsToRemove.forEach((name) => {
      const element = this.children.getByName(name);
      if (element) element.destroy();
    });

    this.isShopConfirmationOpen = false;
  }

  /**
   * Shows victory screen when player survives 10 minutes.
   * Game pauses to celebrate, then continues when player presses SPACE.
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
      damageDealt: 0, // TODO: track total damage dealt
      damageTaken: this.totalDamageTaken,
      goldEarned,
    });

    // Record run end statistics in codex
    getCodexManager().recordRunEnd(
      this.gameTime,
      this.killCount,
      0, // TODO: track total damage dealt
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

    // Create victory overlay
    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.8
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);
    overlay.setName('victoryOverlay');

    // World cleared text
    const worldClearedText = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 - 120,
      `WORLD ${clearedWorld} CLEARED!`,
      {
        fontSize: '32px',
        color: '#88aaff',
        fontFamily: 'Arial',
        stroke: '#000000',
        strokeThickness: 4,
      }
    );
    worldClearedText.setOrigin(0.5);
    worldClearedText.setDepth(PAUSE_MENU_DEPTH + 1);
    worldClearedText.setName('victoryWorldCleared');

    const victoryText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, 'VICTORY!', {
      fontSize: '72px',
      color: '#ffdd44',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 6,
    });
    victoryText.setOrigin(0.5);
    victoryText.setDepth(PAUSE_MENU_DEPTH + 1);
    victoryText.setName('victoryText');

    const messageText = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + 20,
      'Boss Defeated!',
      {
        fontSize: '28px',
        color: '#88ff88',
        fontFamily: 'Arial',
      }
    );
    messageText.setOrigin(0.5);
    messageText.setDepth(PAUSE_MENU_DEPTH + 1);
    messageText.setName('victoryMessage');

    // Next world text
    const nextWorldText = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + 60,
      `Next: World ${newWorldLevel}`,
      {
        fontSize: '22px',
        color: '#aaddff',
        fontFamily: 'Arial',
      }
    );
    nextWorldText.setOrigin(0.5);
    nextWorldText.setDepth(PAUSE_MENU_DEPTH + 1);
    nextWorldText.setName('victoryNextWorld');

    const statsText = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + 100,
      `Kills: ${this.killCount}  |  Level: ${this.playerStats.level}`,
      {
        fontSize: '20px',
        color: '#ffffff',
        fontFamily: 'Arial',
      }
    );
    statsText.setOrigin(0.5);
    statsText.setDepth(PAUSE_MENU_DEPTH + 1);
    statsText.setName('victoryStats');

    // Streak display
    const fireEmoji = newStreak >= 5 ? '🔥🔥' : '🔥';
    const streakText = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + 125,
      `${fireEmoji} Streak: ${previousStreak} → ${newStreak}! (+${metaManager.getStreakBonusPercent()}% gold)`,
      {
        fontSize: '18px',
        color: '#ffaa44',
        fontFamily: 'Arial',
      }
    );
    streakText.setOrigin(0.5);
    streakText.setDepth(PAUSE_MENU_DEPTH + 1);
    streakText.setName('victoryStreak');

    // Calculate gold reward for preview (with victory 1.5x bonus)
    const goldToEarn = metaManager.calculateRunGold(
      this.killCount,
      this.gameTime,
      this.playerStats.level,
      true // hasWon = true for victory bonus
    );

    // Button dimensions and positions
    const buttonWidth = 180;
    const buttonHeight = 45;
    const buttonY = GAME_HEIGHT / 2 + 150;
    const continueButtonX = GAME_WIDTH / 2 - 100;
    const nextWorldButtonX = GAME_WIDTH / 2 + 100;

    // Continue Run button (green, left)
    const continueButtonBg = this.add.rectangle(
      continueButtonX,
      buttonY,
      buttonWidth,
      buttonHeight,
      0x44aa44
    );
    continueButtonBg.setStrokeStyle(3, 0x66cc66);
    continueButtonBg.setInteractive({ useHandCursor: true });
    continueButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    continueButtonBg.setName('victoryContinueButtonBg');

    const continueButtonText = this.add.text(continueButtonX, buttonY, 'Continue [C]', {
      fontSize: '20px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    continueButtonText.setOrigin(0.5);
    continueButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    continueButtonText.setName('victoryContinueButtonText');

    // Next World button (blue, right)
    const nextWorldButtonBg = this.add.rectangle(
      nextWorldButtonX,
      buttonY,
      buttonWidth,
      buttonHeight,
      0x4488cc
    );
    nextWorldButtonBg.setStrokeStyle(3, 0x66aaee);
    nextWorldButtonBg.setInteractive({ useHandCursor: true });
    nextWorldButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    nextWorldButtonBg.setName('victoryNextWorldButtonBg');

    const nextWorldButtonText = this.add.text(nextWorldButtonX, buttonY, 'Next World [N]', {
      fontSize: '20px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    nextWorldButtonText.setOrigin(0.5);
    nextWorldButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    nextWorldButtonText.setName('victoryNextWorldButtonText');

    // Gold preview below Next World button
    const goldPreviewText = this.add.text(
      nextWorldButtonX,
      buttonY + 35,
      `+${goldToEarn} gold`,
      {
        fontSize: '16px',
        color: '#ffdd44',
        fontFamily: 'Arial',
      }
    );
    goldPreviewText.setOrigin(0.5);
    goldPreviewText.setDepth(PAUSE_MENU_DEPTH + 1);
    goldPreviewText.setName('victoryGoldPreview');

    // Hover effects
    continueButtonBg.on('pointerover', () => {
      continueButtonBg.setFillStyle(0x55bb55);
    });
    continueButtonBg.on('pointerout', () => {
      continueButtonBg.setFillStyle(0x44aa44);
    });
    nextWorldButtonBg.on('pointerover', () => {
      nextWorldButtonBg.setFillStyle(0x5599dd);
    });
    nextWorldButtonBg.on('pointerout', () => {
      nextWorldButtonBg.setFillStyle(0x4488cc);
    });

    // Click handlers
    continueButtonBg.on('pointerdown', () => {
      this.handleVictoryContinue();
    });
    nextWorldButtonBg.on('pointerdown', () => {
      this.handleVictoryNextWorld(goldToEarn);
    });

    // Keyboard handlers (store for cleanup)
    this.victoryContinueHandler = () => this.handleVictoryContinue();
    this.victoryNextWorldHandler = () => this.handleVictoryNextWorld(goldToEarn);

    this.input.keyboard?.on('keydown-C', this.victoryContinueHandler);
    this.input.keyboard?.on('keydown-N', this.victoryNextWorldHandler);
  }

  /**
   * Handles the "Continue Run" choice after boss victory.
   * Dismisses the victory overlay and resumes gameplay.
   */
  private handleVictoryContinue(): void {
    // Remove keyboard listeners first
    if (this.victoryContinueHandler) {
      this.input.keyboard?.off('keydown-C', this.victoryContinueHandler);
    }
    if (this.victoryNextWorldHandler) {
      this.input.keyboard?.off('keydown-N', this.victoryNextWorldHandler);
    }
    this.victoryContinueHandler = null;
    this.victoryNextWorldHandler = null;

    // Remove all victory UI elements
    const elementsToRemove = [
      'victoryOverlay',
      'victoryWorldCleared',
      'victoryText',
      'victoryMessage',
      'victoryNextWorld',
      'victoryStats',
      'victoryContinueButtonBg',
      'victoryContinueButtonText',
      'victoryNextWorldButtonBg',
      'victoryNextWorldButtonText',
      'victoryGoldPreview',
    ];
    elementsToRemove.forEach((name) => {
      const element = this.children.getByName(name);
      if (element) element.destroy();
    });

    // Enable endless mode spawning
    this.endlessModeActive = true;
    this.endlessModeTime = 0;
    this.endlessMinibossTimer = 60;   // First miniboss in 60 seconds
    this.endlessBossTimer = 600;      // First boss wave in 10 minutes
    console.log('[Endless Mode] Activated - miniboss in 60s, boss in 600s');

    // Resume gameplay
    this.isPaused = false;
  }

  /**
   * Handles the "Next World" choice after boss victory.
   * Awards gold and restarts the scene for a fresh run at the new world level.
   */
  private handleVictoryNextWorld(goldAmount: number): void {
    // Remove keyboard listeners
    if (this.victoryContinueHandler) {
      this.input.keyboard?.off('keydown-C', this.victoryContinueHandler);
    }
    if (this.victoryNextWorldHandler) {
      this.input.keyboard?.off('keydown-N', this.victoryNextWorldHandler);
    }
    this.victoryContinueHandler = null;
    this.victoryNextWorldHandler = null;

    // Award gold (world level already advanced before showVictory was called)
    const metaManager = getMetaProgressionManager();
    metaManager.addGold(goldAmount);

    // Restart scene for fresh run at new world level
    this.scene.restart();
  }

  /**
   * Handles game over state.
   */
  private gameOver(): void {
    this.isGameOver = true;

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

    // Record run end statistics in codex (only if not already recorded in showVictory)
    if (!this.hasWon) {
      getCodexManager().recordRunEnd(
        this.gameTime,
        this.killCount,
        0, // TODO: track total damage dealt
        goldEarned,
        false, // wasVictory
        metaManager.getWorldLevel(),
        this.playerStats.level
      );
    }

    // Prepare streak change text for display (only shown on death, not victory)
    const streakChangeText = previousStreak > 0 ? '\n💔 Streak broken!' : '';

    // Show game over UI
    const overlay = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.7
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);

    // Different display for winners vs non-winners
    const titleText = this.hasWon ? 'VICTORY!' : 'GAME OVER';
    const titleColor = this.hasWon ? '#ffdd44' : '#ff4444';

    const gameOverText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, titleText, {
      fontSize: '64px',
      color: titleColor,
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 4,
    });
    gameOverText.setOrigin(0.5);
    gameOverText.setDepth(PAUSE_MENU_DEPTH + 1);

    // Calculate bonus time (time survived past 10 minutes)
    const bonusTime = this.hasWon ? this.gameTime - 600 : 0;
    const bonusMinutes = Math.floor(bonusTime / 60);
    const bonusSeconds = Math.floor(bonusTime % 60);
    const bonusTimeStr = bonusTime > 0
      ? `\nBonus time: +${bonusMinutes}:${bonusSeconds.toString().padStart(2, '0')}`
      : '';

    const statsText = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + 30,
      `Survived: ${Math.floor(this.gameTime / 60)}:${Math.floor(this.gameTime % 60).toString().padStart(2, '0')}${bonusTimeStr}\nKills: ${this.killCount}\nLevel: ${this.playerStats.level}\nGold earned: +${goldEarned}${streakChangeText}`,
      {
        fontSize: '24px',
        color: '#ffffff',
        fontFamily: 'Arial',
        align: 'center',
      }
    );
    statsText.setOrigin(0.5);
    statsText.setDepth(PAUSE_MENU_DEPTH + 1);

    const restartText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 130, 'Press SPACE to restart', {
      fontSize: '20px',
      color: '#888888',
      fontFamily: 'Arial',
    });
    restartText.setOrigin(0.5);
    restartText.setDepth(PAUSE_MENU_DEPTH + 1);

    // Listen for restart
    this.input.keyboard?.once('keydown-SPACE', () => {
      this.scene.restart();
    });
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard!;

    this.inputState = {
      cursors: keyboard.createCursorKeys(),
      wasd: {
        W: keyboard.addKey('W'),
        A: keyboard.addKey('A'),
        S: keyboard.addKey('S'),
        D: keyboard.addKey('D'),
      },
      joystickX: 0,
      joystickY: 0,
    };

    // Shift key for dash ability
    keyboard.on('keydown-SHIFT', () => {
      this.tryDash();
    });
  }

  /**
   * Attempt to initiate a dash if the ability is available.
   */
  private tryDash(): void {
    // Check if dash ability is available (dashCooldown > 0 means they have dash)
    if (this.playerStats.dashCooldown <= 0) return;
    if (this.isDashing) return;
    if (this.dashCooldownTimer > 0) return;
    if (this.isPaused || this.isGameOver) return;

    // Get current movement direction
    let dirX = 0;
    let dirY = 0;

    if (this.inputState.cursors.left.isDown || this.inputState.wasd.A.isDown) dirX -= 1;
    if (this.inputState.cursors.right.isDown || this.inputState.wasd.D.isDown) dirX += 1;
    if (this.inputState.cursors.up.isDown || this.inputState.wasd.W.isDown) dirY -= 1;
    if (this.inputState.cursors.down.isDown || this.inputState.wasd.S.isDown) dirY += 1;

    // If not moving, dash toward cursor
    if (dirX === 0 && dirY === 0) {
      const pointer = this.input.activePointer;
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      dirX = pointer.worldX - playerX;
      dirY = pointer.worldY - playerY;
    }

    // Normalize direction
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    if (mag > 0) {
      dirX /= mag;
      dirY /= mag;
    } else {
      return; // No direction to dash
    }

    // Start dash
    this.isDashing = true;
    this.dashTimer = this.DASH_DURATION;
    this.dashDirectionX = dirX;
    this.dashDirectionY = dirY;
    this.dashCooldownTimer = this.playerStats.dashCooldown;

    // Visual feedback - brief player flash
    const playerSprite = getSprite(this.playerId);
    if (playerSprite && 'setFillStyle' in playerSprite) {
      const rect = playerSprite as Phaser.GameObjects.Rectangle;
      rect.setFillStyle(0xffffff);
      this.time.delayedCall(50, () => {
        if (this.playerId !== -1) {
          rect.setFillStyle(PLAYER_NEON.core);
        }
      });
    }
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
    });
    const playerVisual = this.playerPlasmaCore.getContainer();
    playerVisual.setDepth(10);
    registerSprite(entityId, playerVisual);

    return entityId;
  }

  private spawnEnemy(typeOverride?: EnemyTypeDefinition): void {
    // Get enemy type based on game time or override (world level makes elites spawn earlier)
    const enemyType = typeOverride || getRandomEnemyType(this.gameTime, this.worldLevelSpawnReduction);
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
        y = Phaser.Math.Between(0, GAME_HEIGHT);
        break;
      case 1: // Right
        x = GAME_WIDTH + spawnOffset;
        y = Phaser.Math.Between(0, GAME_HEIGHT);
        break;
      case 2: // Top
        x = Phaser.Math.Between(0, GAME_WIDTH);
        y = -spawnOffset;
        break;
      default: // Bottom
        x = Phaser.Math.Between(0, GAME_WIDTH);
        y = GAME_HEIGHT + spawnOffset;
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
      case 0: x = -spawnOffset; y = Phaser.Math.Between(100, GAME_HEIGHT - 100); break;
      case 1: x = GAME_WIDTH + spawnOffset; y = Phaser.Math.Between(100, GAME_HEIGHT - 100); break;
      case 2: x = Phaser.Math.Between(100, GAME_WIDTH - 100); y = -spawnOffset; break;
      default: x = Phaser.Math.Between(100, GAME_WIDTH - 100); y = GAME_HEIGHT + spawnOffset; break;
    }

    // Scale stats with both time and world level multipliers
    const scaledStats = getScaledStats(enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);

    // Special case: Twins spawn as a pair
    if (typeId === 'twin_a') {
      const twinA = this.createEnemy(x, y, enemyType, scaledStats);

      // Create health bar for Twin A
      const twinABar = this.createBossHealthBar(twinA, enemyType.name, false);
      this.activeBossHealthBars.push(twinABar);

      // Spawn Twin B nearby
      const twinBType = getEnemyType('twin_b');
      if (twinBType) {
        const offsetAngle = Math.random() * Math.PI * 2;
        const twinBX = x + Math.cos(offsetAngle) * 60;
        const twinBY = y + Math.sin(offsetAngle) * 60;
        const twinBStats = getScaledStats(twinBType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);
        const twinB = this.createEnemy(twinBX, twinBY, twinBType, twinBStats);

        // Create health bar for Twin B
        const twinBBar = this.createBossHealthBar(twinB, twinBType.name, false);
        this.activeBossHealthBars.push(twinBBar);

        // Link the twins
        linkTwins(twinA, twinB);
      }
    } else {
      const entityId = this.createEnemy(x, y, enemyType, scaledStats);

      // Create health bar for the miniboss
      const bossBar = this.createBossHealthBar(entityId, enemyType.name, false);
      this.activeBossHealthBars.push(bossBar);
    }

    // Reposition all boss health bars
    this.repositionBossHealthBars();

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
    const warningText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, `⚠️ ${name} approaches! ⚠️`, {
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
      y: GAME_HEIGHT / 2 - 100,
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
   * Check if it's time to spawn the boss (at 10 minutes).
   * Bosses cycle through Horde King -> Void Wyrm -> The Machine each run.
   */
  private checkBossSpawn(): void {
    if (this.bossSpawned || this.gameTime < this.bossSpawnTime) return;

    this.bossSpawned = true;

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
    const x = GAME_WIDTH / 2;
    const y = -100;

    // Scale stats with both time and world level multipliers
    const scaledStats = getScaledStats(enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);

    // Double boss health for challenge
    scaledStats.health *= 2;

    const entityId = this.createEnemy(x, y, enemyType, scaledStats);

    // Create health bar for the boss (isFinalBoss = true for purple color)
    const bossBar = this.createBossHealthBar(entityId, enemyType.name, true);
    this.activeBossHealthBars.push(bossBar);
    this.repositionBossHealthBars();

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
    const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.5);
    overlay.setDepth(90);

    // Warning text
    const warningText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, 'BOSS BATTLE', {
      fontSize: '32px',
      color: '#ff0000',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 6,
    });
    warningText.setOrigin(0.5);
    warningText.setDepth(100);

    const nameText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, name, {
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
   * Creates a boss health bar UI element for a miniboss or boss.
   * The bar includes a pulsing glow effect and displays name + health.
   */
  private createBossHealthBar(entityId: number, name: string, isFinalBoss: boolean): BossHealthBar {
    const centerX = GAME_WIDTH / 2;
    const barWidth = this.BOSS_HEALTH_BAR_WIDTH;
    const barHeight = 15;

    // Colors based on boss type
    const fillColor = isFinalBoss ? 0x990066 : 0xcc0000;
    const glowColor = isFinalBoss ? 0xcc00aa : 0xff4444;

    // Create container to hold all bar elements
    const container = this.add.container(centerX, 0);
    container.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Glow graphics (pulsing effect behind bar)
    const glowGraphics = this.add.graphics();
    glowGraphics.fillStyle(glowColor, 0.3);
    glowGraphics.fillRoundedRect(-barWidth / 2 - 6, 16, barWidth + 12, barHeight + 8, 6);
    container.add(glowGraphics);

    // Name text with decorative elements
    const nameText = this.add.text(0, 0, `═══ ${name.toUpperCase()} ═══`, {
      fontSize: '14px',
      color: isFinalBoss ? '#ff66cc' : '#ff6666',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    nameText.setOrigin(0.5, 0);
    container.add(nameText);

    // Bar background
    const barBackground = this.add.rectangle(0, 20 + barHeight / 2, barWidth, barHeight, 0x222222);
    barBackground.setStrokeStyle(1, 0x444444);
    container.add(barBackground);

    // Bar fill (starts at full width)
    const barFill = this.add.rectangle(
      -barWidth / 2 + barWidth / 2, // Start from left
      20 + barHeight / 2,
      barWidth,
      barHeight - 2,
      fillColor
    );
    barFill.setOrigin(0, 0.5); // Anchor left so it shrinks from right
    barFill.x = -barWidth / 2 + 1;
    container.add(barFill);

    // Health text (vertically centered in bar)
    const healthText = this.add.text(0, 20 + barHeight / 2, '', {
      fontSize: '11px',
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    });
    healthText.setOrigin(0.5, 0.5);
    container.add(healthText);

    // Start pulsing glow tween (pronounced effect)
    this.tweens.add({
      targets: glowGraphics,
      alpha: { from: 0.15, to: 0.9 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const bossBar: BossHealthBar = {
      entityId,
      name,
      isFinalBoss,
      container,
      nameText,
      barBackground,
      barFill,
      healthText,
      glowGraphics,
    };

    return bossBar;
  }

  /**
   * Removes a boss health bar when the boss dies.
   */
  private removeBossHealthBar(entityId: number): void {
    const index = this.activeBossHealthBars.findIndex(bar => bar.entityId === entityId);
    if (index === -1) return;

    const bar = this.activeBossHealthBars[index];

    // Stop any tweens on the glow
    this.tweens.killTweensOf(bar.glowGraphics);

    // Fade out and destroy
    this.tweens.add({
      targets: bar.container,
      alpha: 0,
      duration: 300,
      ease: 'Power2',
      onComplete: () => {
        bar.container.destroy();
      },
    });

    // Remove from array immediately so repositioning works
    this.activeBossHealthBars.splice(index, 1);

    // Reposition remaining bars
    this.repositionBossHealthBars();
  }

  /**
   * Repositions all boss health bars vertically (stacking).
   */
  private repositionBossHealthBars(): void {
    for (let i = 0; i < this.activeBossHealthBars.length; i++) {
      const bar = this.activeBossHealthBars[i];
      const targetY = this.BOSS_HEALTH_BAR_START_Y + i * this.BOSS_HEALTH_BAR_HEIGHT;

      // Animate to new position
      this.tweens.add({
        targets: bar.container,
        y: targetY,
        duration: 200,
        ease: 'Power2',
      });
    }
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

    // Highlight the upgrade icon for 5 seconds (also rebuilds icons)
    const highlightId = upgrade.upgradeType === 'stat' ? upgrade.id : upgrade.weaponId;
    this.highlightUpgradeIcon(highlightId);
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
    this.weaponManager.applyMultipliers(
      this.playerStats.damageMultiplier,
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
   * Updates the upgrade icons display to show current upgrades.
   * Skills have purple-blue backgrounds, weapons have gold backgrounds.
   */
  private updateUpgradeIcons(): void {
    // Clear existing icons
    this.upgradeIconsContainer.removeAll(true);

    // Build combined list of displayable upgrades with type tracking
    const displayableUpgrades: Array<{
      id: string;
      icon: string;
      name: string;
      description: string;
      currentLevel: number;
      maxLevel: number;
      type: 'skill' | 'weapon';
    }> = [];

    // Add stat upgrades (skills) that have been taken (currentLevel > 0)
    for (const upgrade of this.upgrades) {
      if (upgrade.currentLevel > 0) {
        displayableUpgrades.push({
          id: upgrade.id,
          icon: upgrade.icon,
          name: upgrade.name,
          description: upgrade.description,
          currentLevel: upgrade.currentLevel,
          maxLevel: upgrade.maxLevel,
          type: 'skill',
        });
      }
    }

    // Add weapons from WeaponManager
    const weapons = this.weaponManager.getAllWeapons();
    for (const weapon of weapons) {
      displayableUpgrades.push({
        id: weapon.id,
        icon: weapon.icon,
        name: weapon.name,
        description: weapon.description,
        currentLevel: weapon.getLevel(),
        maxLevel: weapon.maxLevel,
        type: 'weapon',
      });
    }

    // Layout constants
    const iconsPerRow = 5;
    const iconSize = 32;
    const iconSpacing = 8;

    // Color schemes for different types
    const skillColors = { bg: 0x2a2a5a, stroke: 0x5a5a9a, hover: 0x3a3a7a, badge: '#88aaff' };
    const weaponColors = { bg: 0x4a3a2a, stroke: 0x8a6a4a, hover: 0x5a4a3a, badge: '#ffcc88' };
    const masteryColors = { stroke: 0xffd700, badge: '#ffd700' }; // Gold for mastered icons

    // Track mastered icon positions for visual effects
    const masteredPositions = new Map<string, { x: number; y: number }>();

    // Get container position for calculating screen coordinates
    const containerX = this.upgradeIconsContainer.x;
    const containerY = this.upgradeIconsContainer.y;

    displayableUpgrades.forEach((upgrade, index) => {
      const row = Math.floor(index / iconsPerRow);
      const col = index % iconsPerRow;
      const iconX = col * (iconSize + iconSpacing);
      const iconY = row * (iconSize + iconSpacing);

      // Get colors based on type
      const colors = upgrade.type === 'weapon' ? weaponColors : skillColors;
      const isMastered = upgrade.currentLevel >= upgrade.maxLevel;

      // Track mastered icon positions for visual effects
      if (isMastered) {
        masteredPositions.set(upgrade.id, {
          x: containerX + iconX + iconSize / 2,
          y: containerY + iconY + iconSize / 2,
        });
      }

      // Check if this icon should be highlighted (recently acquired)
      const isHighlighted = this.activeIconHighlights.has(upgrade.id);
      let glowRect: Phaser.GameObjects.Rectangle | null = null;

      if (isHighlighted) {
        // Create glow rectangle behind the icon
        glowRect = this.add.rectangle(
          iconX + iconSize / 2,
          iconY + iconSize / 2,
          iconSize + 8,
          iconSize + 8,
          0xffdd44,  // Gold glow color
          0.6
        );
        glowRect.setStrokeStyle(3, 0xffffff, 0.8);

        // Pulsing animation
        this.tweens.add({
          targets: glowRect,
          alpha: { from: 0.6, to: 0.2 },
          scaleX: { from: 1.0, to: 1.15 },
          scaleY: { from: 1.0, to: 1.15 },
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }

      // Icon background with type-specific color
      const iconBg = this.add.rectangle(
        iconX + iconSize / 2,
        iconY + iconSize / 2,
        iconSize,
        iconSize,
        colors.bg
      );
      iconBg.setStrokeStyle(2, isMastered ? masteryColors.stroke : colors.stroke);
      iconBg.setInteractive({ useHandCursor: true });

      // Icon sprite
      const iconSprite = createIcon(this, {
        x: iconX + iconSize / 2,
        y: iconY + iconSize / 2,
        iconKey: upgrade.icon,
        size: 18,
      });

      // Level indicator badge with dark background for readability
      const badgeX = iconX + iconSize - 2;
      const badgeY = iconY + iconSize - 2;
      const badgeSize = 14;

      const levelBadgeBg = this.add.rectangle(
        badgeX,
        badgeY,
        badgeSize,
        badgeSize,
        0x000000,
        0.8
      );
      levelBadgeBg.setStrokeStyle(1, 0xffffff, 0.5);

      const levelBadge = this.add.text(
        badgeX,
        badgeY,
        isMastered ? '★' : `${upgrade.currentLevel}`,
        {
          fontSize: isMastered ? '14px' : '12px',
          color: isMastered ? '#ffd700' : '#ffffff',
          fontFamily: 'Arial',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 2,
        }
      );
      levelBadge.setOrigin(0.5, 0.5);

      // Hover events with type-specific highlight
      iconBg.on('pointerover', () => {
        iconBg.setFillStyle(colors.hover);
        this.showUpgradeTooltip(upgrade, iconX, iconY + iconSize + 10);
      });

      iconBg.on('pointerout', () => {
        iconBg.setFillStyle(colors.bg);
        this.upgradeTooltip.setVisible(false);
      });

      // Add to container - glow first (behind), then icon elements
      const elementsToAdd: Phaser.GameObjects.GameObject[] = [];
      if (glowRect) elementsToAdd.push(glowRect);
      elementsToAdd.push(iconBg, iconSprite, levelBadgeBg, levelBadge);
      this.upgradeIconsContainer.add(elementsToAdd);
    });

    // Update mastery icon effects with new positions
    this.masteryIconEffects.updateMasteredIcons(masteredPositions);
  }

  /**
   * Highlights an upgrade icon for 5 seconds (visual feedback for acquired upgrades).
   */
  private highlightUpgradeIcon(upgradeId: string): void {
    // Set expiration time (5 seconds from now)
    this.activeIconHighlights.set(upgradeId, this.gameTime + 5.0);
    // Rebuild icons to apply the highlight
    this.updateUpgradeIcons();
  }

  /**
   * Shows tooltip for an upgrade.
   */
  private showUpgradeTooltip(
    upgrade: { icon: string; name: string; description: string; currentLevel: number; maxLevel: number },
    offsetX: number,
    offsetY: number
  ): void {
    const containerPos = this.upgradeIconsContainer.getBounds();

    this.upgradeTooltip.setPosition(
      containerPos.x + offsetX,
      containerPos.y + offsetY
    );

    const titleText = this.upgradeTooltip.getByName('tooltipTitle') as Phaser.GameObjects.Text;
    const descText = this.upgradeTooltip.getByName('tooltipDesc') as Phaser.GameObjects.Text;
    const levelText = this.upgradeTooltip.getByName('tooltipLevel') as Phaser.GameObjects.Text;

    if (titleText) titleText.setText(upgrade.name);
    if (descText) descText.setText(upgrade.description);
    const isMastered = upgrade.currentLevel >= upgrade.maxLevel;
    if (levelText) levelText.setText(isMastered ? '★ MASTERED' : `Level ${upgrade.currentLevel}/${upgrade.maxLevel}`);

    this.upgradeTooltip.setVisible(true);
  }

  private updateUI(): void {
    // Update timer
    const timerText = this.children.getByName('timerText') as Phaser.GameObjects.Text;
    if (timerText) {
      const minutes = Math.floor(this.gameTime / 60);
      const seconds = Math.floor(this.gameTime % 60);
      timerText.setText(`${minutes}:${seconds.toString().padStart(2, '0')}`);

      // Gold timer after victory to indicate "bonus time"
      if (this.hasWon) {
        timerText.setColor('#ffdd44');
      }
    }

    // Update kill count
    const killCountText = this.children.getByName('killCountText') as Phaser.GameObjects.Text;
    if (killCountText) {
      killCountText.setText(`Kills: ${this.killCount}`);
    }

    // Update gold preview - show both death and victory amounts
    const goldPreviewText = this.children.getByName('goldPreviewText') as Phaser.GameObjects.Text;
    if (goldPreviewText) {
      const metaManager = getMetaProgressionManager();
      const deathGold = metaManager.calculateRunGold(
        this.killCount,
        this.gameTime,
        this.playerStats.level,
        false
      );
      const victoryGold = metaManager.calculateRunGold(
        this.killCount,
        this.gameTime,
        this.playerStats.level,
        true
      );
      goldPreviewText.setText(`Gold: ${deathGold} (win: ${victoryGold})`);
    }

    // Update XP bar
    const xpBarMaxWidth = 178; // 180 - 2 for padding
    const xpProgress = this.playerStats.xp / this.playerStats.xpToNextLevel;
    this.xpBarFill.width = xpBarMaxWidth * xpProgress;

    // Update level text
    this.levelText.setText(`Level ${this.playerStats.level}`);

    // Update HP bar
    const currentHP = Health.current[this.playerId];
    const maxHP = Health.max[this.playerId];
    const hpBarMaxWidth = 178; // 180 - 2 for padding
    const hpProgress = Math.max(0, currentHP / maxHP);
    this.hpBarFill.width = hpBarMaxWidth * hpProgress;

    // Update HP text
    this.hpText.setText(`${Math.ceil(currentHP)}/${Math.ceil(maxHP)}`);

    // Change HP bar color based on health percentage
    if (hpProgress > 0.5) {
      this.hpBarFill.setFillStyle(0x44ff44); // Green
    } else if (hpProgress > 0.25) {
      this.hpBarFill.setFillStyle(0xffff44); // Yellow
    } else {
      this.hpBarFill.setFillStyle(0xff4444); // Red
    }

    // Update boss health bars
    const barMaxWidth = this.BOSS_HEALTH_BAR_WIDTH - 2; // Account for padding
    for (const bossBar of this.activeBossHealthBars) {
      if (hasComponent(this.world, Health, bossBar.entityId)) {
        const bossCurrentHP = Health.current[bossBar.entityId];
        const bossMaxHP = Health.max[bossBar.entityId];
        const bossProgress = Math.max(0, bossCurrentHP / bossMaxHP);

        // Smooth health bar decrease with lerp
        const targetWidth = barMaxWidth * bossProgress;
        bossBar.barFill.width = Phaser.Math.Linear(bossBar.barFill.width, targetWidth, 0.1);

        // Update health text (pad current HP to match max HP width for alignment)
        const maxHPStr = Math.ceil(bossMaxHP).toString();
        const currentHPStr = Math.ceil(bossCurrentHP).toString().padStart(maxHPStr.length, ' ');
        bossBar.healthText.setText(`${currentHPStr} / ${maxHPStr}`);
      }
    }

    // Update BGM display
    this.updateBGMDisplay();
  }

  /**
   * Updates the BGM display with current track info and button states.
   */
  private updateBGMDisplay(): void {
    const musicManager = getMusicManager();
    const currentTrack = musicManager.getCurrentTrack();
    const isPlaying = musicManager.getPlaybackMode() !== 'off';

    // Update track text only when track changes (avoid unnecessary updates)
    if (currentTrack) {
      const trackId = currentTrack.id;
      if (trackId !== this.lastTrackId) {
        this.lastTrackId = trackId;
        // Truncate long names to fit the display
        const displayText = currentTrack.title;
        const truncatedText = displayText.length > 24
          ? displayText.substring(0, 22) + '...'
          : displayText;
        this.bgmTrackText.setText(truncatedText);
      }
    } else if (!isPlaying) {
      this.bgmTrackText.setText('Music Off');
      this.lastTrackId = '';
    } else {
      // Music is enabled but no track available (empty playlist)
      this.bgmTrackText.setText('No Tracks');
      this.lastTrackId = '';
    }

    // Sync mute button state (show/hide strikethrough line)
    this.bgmMuteStrike.setVisible(!isPlaying);
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

    // Update mastery icon effects (HUD glow + particles)
    this.masteryIconEffects.update(deltaSeconds);
  }

  /**
   * Updates the grid background with current entity positions for warping effect.
   * All entities contribute - weight is calculated from actual enemy size.
   */
  private updateGridBackground(): void {
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

    // Update grid animation (using fixed delta for consistency)
    this.gridBackground.update(1 / 60);
  }

  /**
   * Updates visual quality based on FPS for auto-scaling.
   * Reduces glow layers and effects when performance drops.
   */
  private updateVisualQuality(delta: number): void {
    // Calculate current FPS
    const fps = 1000 / delta;

    // Update FPS counter display and visibility
    if (this.fpsText) {
      const fpsEnabled = getSettingsManager().isFpsCounterEnabled();
      this.fpsText.setVisible(fpsEnabled);
      if (fpsEnabled) {
        this.fpsText.setText(`FPS: ${Math.round(fps)}`);
      }
    }

    // Add to history
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.FPS_HISTORY_SIZE) {
      this.fpsHistory.shift();
    }

    // Only adjust after we have enough samples
    if (this.fpsHistory.length < this.FPS_HISTORY_SIZE) return;

    // Calculate average FPS
    const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

    // Determine quality level based on FPS thresholds
    let newQuality: VisualQuality = this.visualQuality;

    if (avgFps < 40) {
      newQuality = 'low';
    } else if (avgFps < 50) {
      newQuality = 'medium';
    } else if (avgFps > 55) {
      newQuality = 'high';
    }

    // Only update if quality changed (avoid unnecessary work)
    if (newQuality !== this.visualQuality) {
      this.visualQuality = newQuality;
      // Update grid background quality
      this.gridBackground.setQuality(newQuality);
      // Update trail system quality
      this.trailManager.setQuality(newQuality);
      // Update player plasma core quality
      if (this.playerPlasmaCore) {
        this.playerPlasmaCore.setQuality(newQuality);
      }
      // Note: Existing entities keep their current quality
      // New entities will be created with the new quality level
    }
  }

  /**
   * Clean up event listeners and resources when scene shuts down.
   * Critical for preventing input conflicts and memory leaks on restart.
   */
  shutdown(): void {
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

    // Clean up joystick manager
    if (this.joystickManager) {
      this.joystickManager.destroy();
      this.joystickManager = null;
    }

    // Remove beforeunload handler for game state persistence
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    // Remove focus/visibility change handlers
    if (this.handleVisibilityChange) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.handleVisibilityChange = null;
    }
    if (this.handleWindowBlur) {
      window.removeEventListener('blur', this.handleWindowBlur);
      this.handleWindowBlur = null;
    }

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

    // Clean up mastery icon effects
    if (this.masteryIconEffects) {
      this.masteryIconEffects.destroy();
    }

    // Clean up player plasma core visual
    if (this.playerPlasmaCore) {
      this.playerPlasmaCore.destroy();
    }

    // Hide any open menus/dialogs (removes their listeners)
    if (this.isPauseMenuOpen) {
      this.hidePauseMenu();
    }
    if (this.isShopConfirmationOpen) {
      this.hideShopConfirmation();
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

    // Clean up FPS counter
    if (this.fpsText) {
      this.fpsText.destroy();
      this.fpsText = null;
    }
  }
}
