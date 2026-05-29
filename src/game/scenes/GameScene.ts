import Phaser from 'phaser';
import { createIcon } from '../../utils/IconRenderer';
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
import { inputSystem, resetInputSystem } from '../../ecs/systems/InputSystem';
import { InputController } from '../managers/InputController';
import { movementSystem, clampPlayerToScreen } from '../../ecs/systems/MovementSystem';
import { enemyAISystem, getWardenSlowMultiplier } from '../../ecs/systems/EnemyAISystem';
import { setEnemyProjectileCallback, setMinionSpawnCallback, setXPGemCallbacks, recordEnemyDeath, linkTwins, unlinkTwin, setBossCallbacks, resetEnemyAISystem, resetBossCallbacks, getAllTwinLinks, setEnemyAIBounds, updateAIGameTime, setBossPhaseTransitionCallback } from '../../ecs/systems/enemy-ai/state';
import { resetBossPhaseTracking } from '../../ecs/systems/EnemyAISystem';
import { resetWeaponSystem } from '../../ecs/systems/WeaponSystem';
import { resetCollisionSystem, setCombatStats } from '../../ecs/systems/CollisionSystem';
import { statusEffectSystem, setStatusEffectSystemEffectsManager, setStatusEffectSystemDeathCallback, setStatusEffectDamageCallback, applyPoison, applyFreeze, resetStatusEffectSystem } from '../../ecs/systems/StatusEffectSystem';
import { getScaledStats, getEnemyType, getEnemyArmor, EnemyTypeDefinition, EnemyAIType } from '../../enemies/EnemyTypes';
import { spriteSystem, registerSprite, getSprite, unregisterSprite, resetSpriteSystem } from '../../ecs/systems/SpriteSystem';
import { xpGemSystem, spawnXPGem, setXPGemSystemScene, setXPCollectCallback, setXPGemEffectsManager, setXPGemSoundManager, setXPGemMagnetRange, setXPGemTrailManager, setXPGemWorldReference, getXPGemPositions, consumeXPGem, resetXPGemSystem, magnetizeAllGems, setXPGemQuality } from '../../ecs/systems/XPGemSystem';
import { healthPickupSystem, spawnHealthPickup, setHealthPickupSystemScene, setHealthCollectCallback, setHealthPickupEffectsManager, setHealthPickupSoundManager, setHealthPickupMagnetRange, resetHealthPickupSystem, magnetizeAllHealthPickups } from '../../ecs/systems/HealthPickupSystem';
import { magnetPickupSystem, spawnMagnetPickup, setMagnetPickupSystemScene, setMagnetPickupEffectsManager, setMagnetPickupSoundManager, resetMagnetPickupSystem } from '../../ecs/systems/MagnetPickupSystem';
import { consumablePickupSystem, spawnConsumablePickup, setConsumablePickupSystemScene, setConsumablePickupEffectsManager, setConsumableCollectCallback, resetConsumablePickupSystem, ConsumableKind } from '../../ecs/systems/ConsumablePickupSystem';
import { PlayerStats, createDefaultPlayerStats, calculateXPForLevel, Upgrade, createUpgrades, CombinedUpgrade, getRandomCombinedUpgrades } from '../../data/Upgrades';
import { EffectsManager } from '../../effects/EffectsManager';
import { getJuiceManager } from '../../effects/JuiceManager';
import { SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { WeaponManager, createWeapon, ProjectileWeapon } from '../../weapons';
import { toNeonPair, PLAYER_NEON, ENEMY_COLORS } from '../../visual/NeonColors';
import { resetShapeTextureCache, VisualQuality } from '../../visual/GlowGraphics';
import { createCachedEnemyVisual, resetEnemyTextureCache } from '../../visual/EnemyVisuals';
import { generateGemAtlases, destroyGemAtlases } from '../../visual/Gem3DRenderer';
import { generateProjectileAtlases, destroyProjectileAtlases } from '../../visual/ProjectileAtlasRenderer';
import { GridBackground } from '../../visual/GridBackground';
import { PlayerSpaceship } from '../../visual/PlayerSpaceship';
import { TrailManager } from '../../visual/TrailManager';
import { DeathRippleManager } from '../../visual/DeathRippleManager';
import { MasteryVisualsManager } from '../../visual/MasteryVisuals';
import { ShieldBarrierVisual } from '../../visual/ShieldBarrierVisual';
import { StatusEffectVisualManager } from '../../visual/StatusEffectVisualManager';
import { OffScreenIndicatorManager } from '../../visual/OffScreenIndicatorManager';
import { DistortionPipeline } from '../../visual/DistortionPipeline';
import { BloomPipeline } from '../../visual/BloomPipeline';
import { LightingSystem } from '../../visual/LightingSystem';
import { setBossArenaScene, activateBossArena, deactivateBossArena, updateBossArena, resetBossArenaSystem } from '../../systems/BossArenaSystem';
import { selectRunModifiers, getModifierById, type RunModifier } from '../../data/RunModifiers';
import { setHazardZoneScene, spawnHazardZone, updateHazardZones, updateHazardSpawner, applyIceHazardSlow, resetHazardZoneSystem, setHazardZoneWorldLevel, setHazardZoneEffectsManager, setHazardZoneQuality, setHazardZoneStage } from '../../systems/HazardZoneSystem';
import { getGameStateManager, GameSaveState } from '../../save/GameStateManager';
import { getSettingsManager } from '../../settings';
import { SecureStorage } from '../../storage';
import { updateFrameCache, resetFrameCache, getEnemyIds as getFrameCacheEnemyIds } from '../../ecs/FrameCache';
import { resetEnemySpatialHash, getEnemySpatialHash } from '../../utils/SpatialHash';
import { getAchievementManager, AchievementDefinition, MilestoneDefinition, MilestoneReward } from '../../achievements';
import { getToastManager, ToastManager } from '../../ui';
import { getCodexManager } from '../../codex';
import { resetComboSystem, recordComboKill, updateComboSystem, getComboCount, getHighestCombo, getComboTier, getComboDecayPercent, getComboBuffDamageMultiplier, isComboBuffActive, getComboBuffRemainingPercent, getComboState, restoreComboState, type ComboTier } from '../../systems/ComboSystem';
import { resetEventSystem, updateEventSystem, setSuppressEvents, getEventState, restoreEventState, getActiveEvent, RunEvent } from '../../systems/EventSystem';
import { resetDirectorSystem, updateDirector, pickEnemyFromDirector, getDirectorState, restoreDirectorState, getCurrentStrategy } from '../../systems/DirectorSystem';
import { getHiddenUnlockManager } from '../../meta/HiddenUnlocks';
import { getShipById, getDefaultShip } from '../../data/ShipCharacters';
import { SHIP_NEON_PALETTES } from '../../visual/NeonColors';
import { recordDailyRun } from '../../meta/DailyChallengeManager';
import { getRelicManager } from '../../meta/RelicManager';
import { getRelicRarityColor } from '../../data/Relics';
import { getStageById, getDefaultStage } from '../../data/Stages';
import { TUNING, STORAGE_KEY_AUTO_BUY } from '../../data/GameTuning';
import { HUDManager, UpgradeIconData, EvolutionInfo } from '../managers/HUDManager';
import { getEvolutionForWeapon } from '../../data/WeaponEvolutions';
import { PauseMenuManager } from '../managers/PauseMenuManager';

// Module-level queries (defined once, not per-frame)
const knockbackEnemyQuery = defineQuery([Transform, Knockback, EnemyTag]);

const PAUSE_MENU_DEPTH = 1100; // Shared depth constant for overlay rendering

// Combo-tier → visual intensity lookups (module-level to avoid per-frame literal allocation in updateGridBackground)
const COMBO_TIER_LIGHT_RADIUS: Record<string, number> = {
  none: 120, warm: 140, hot: 160, blazing: 180, inferno: 200,
};
const COMBO_TIER_LIGHT_INTENSITY: Record<string, number> = {
  none: 0.9, warm: 0.92, hot: 0.95, blazing: 0.97, inferno: 1.0,
};
const COMBO_TIER_BLOOM_STRENGTH: Record<string, number> = {
  none: 0.25, warm: 0.30, hot: 0.35, blazing: 0.40, inferno: 0.50,
};

// Radius around the player used to decide "in combat" for the Sprint (idle) vs
// Battle Flow (per-nearby-enemy) movement upgrades.
const PLAYER_COMBAT_RADIUS = 220;
// Battle Flow caps its bonus at +25% regardless of how many enemies are nearby.
const COMBAT_SPEED_BONUS_CAP = 0.25;

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

  // Deferred boss health bars (queued during restore before hudManager exists)
  private pendingBossHealthBars: { entityId: number; name: string; isBoss: boolean }[] = [];

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

  // Cached per-run meta-progression values (set once in create(); cannot change mid-run)
  private cachedGemMagnetInterval: number = 0;
  private cachedEmergencyHealPercent: number = 0;

  // Pooled boss-health HUD payload (reused each frame to avoid map() + object-literal allocation)
  private bossHealthPayload: Array<{ entityId: number; currentHP: number; maxHP: number }> = [];

  // Game over state
  private isGameOver: boolean = false;
  private deathSequenceActive: boolean = false;

  // Victory state (survived 10 minutes)
  private hasWon: boolean = false;

  // Pause menu manager (handles pause, victory, and game over screens)
  private pauseMenuManager!: PauseMenuManager;

  // ESC key handler reference for cleanup
  private escKey: Phaser.Input.Keyboard.Key | null = null;
  // Director debug overlay — toggled with F10, shows current spend strategy
  // and credit balance. Guarded behind a settings flag to avoid shipping noise.
  private directorDebugText: Phaser.GameObjects.Text | null = null;
  private directorDebugRefreshAccumulator: number = 0;
  private directorDebugKeyHandler: (() => void) | null = null;
  private dashRequestHandler: (() => void) | null = null;
  // First-run coach marks: cleanup hook exposed so shutdown can tear down
  // listeners and timers if the player restarts mid-tutorial.
  private coachMarksCleanup: (() => void) | null = null;
  private pauseRequestHandler: (() => void) | null = null;
  private autoBuyToggleHandler: (() => void) | null = null;

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

  // Weapon evolution level reduction from shop upgrade
  private evolutionLevelReduction: number = 0;

  // Boss warning sequence
  private bossWarningPhase: number = 0; // 0=none, 1=stirs, 2=trembles, 3=incoming
  private bossWarningText: Phaser.GameObjects.Text | null = null;
  private bossWarningVignette: Phaser.GameObjects.Graphics | null = null;
  private bossCountdownText: Phaser.GameObjects.Text | null = null;

  // Endless mode (post-victory continuation)
  private endlessModeActive = false;
  private endlessModeTime = 0;           // Time elapsed since continue was chosen
  private endlessMinibossTimer = 0;      // Countdown to next miniboss (60s intervals)
  private endlessBossTimer = 0;          // Countdown to next boss wave (escalating intervals)
  private endlessCycleNumber = 0;        // How many endless boss waves have been defeated
  private endlessBossIntervalSeconds = 300; // Starts at 5 min between waves, shortens per cycle

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


  // Active run modifiers
  private activeModifiers: RunModifier[] = [];

  // Boss arena hazard zone spawning
  private activeBossType: string | null = null;
  private bossHazardTimer: number = 0;
  private hazardDamageMultiplier: number = 1.0;

  // Post-processing pipelines (WebGL only)
  private distortionPipeline: DistortionPipeline | null = null;
  private bloomPipeline: BloomPipeline | null = null;
  private lightingSystem: LightingSystem | null = null;

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

  // Animated player visual (procedural neon spaceship)
  private playerSpaceship!: PlayerSpaceship;

  // Persistent low-HP danger vignette overlay
  private dangerVignette!: Phaser.GameObjects.Rectangle;

  // Dash afterimage pool
  private dashAfterimagePool: Phaser.GameObjects.Arc[] = [];
  private dashAfterimageTimer: number = 0;

  // Status effect visual overlays on enemies
  private statusEffectVisualManager!: StatusEffectVisualManager;

  // Off-screen threat directional arrows
  private offScreenIndicatorManager!: OffScreenIndicatorManager;

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
  private selectedShipId: string = 'ship_default';
  private dailyModeActive: boolean = false;
  private dailyDateString: string = '';
  private dailyChallengeType: 'daily' | 'weekly' = 'daily';
  private selectedStageId: string = 'stage_deep_void';

  init(data?: {
    restore?: boolean;
    startingWeapon?: string;
    modifierIds?: string[];
    shipId?: string;
    stageId?: string;
    dailyMode?: boolean;
    dailyDate?: string;
    dailyChallengeType?: 'daily' | 'weekly';
  }): void {
    this.shouldRestore = data?.restore === true;
    this.startingWeaponId = data?.startingWeapon || 'projectile';
    this.selectedShipId = data?.shipId || 'ship_default';
    this.selectedStageId = data?.stageId || 'stage_deep_void';
    this.dailyModeActive = data?.dailyMode === true;
    this.dailyDateString = data?.dailyDate ?? '';
    this.dailyChallengeType = data?.dailyChallengeType ?? 'daily';
    // Restore modifiers by ID, or select new random ones for fresh runs
    if (data?.modifierIds) {
      this.activeModifiers = data.modifierIds
        .map(id => getModifierById(id))
        .filter((modifier): modifier is RunModifier => modifier !== undefined);
    } else if (!this.shouldRestore) {
      this.activeModifiers = selectRunModifiers(2);
    }
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
    this.resetAllRunSystems();

    // Reset all instance properties for fresh game state
    // (Class property initializers only run once on instantiation, not on scene restart)
    this.gameTime = 0;
    this.spawnTimer = 0;
    this.enemyCount = 0;
    this.killCount = 0;
    this.totalDamageTaken = 0;
    this.totalDamageDealt = 0;
    this.lastAchievementTimeCheck = 0;
    this.pendingBossHealthBars = [];

    // Initialize achievement tracking for this run
    const achievementManager = getAchievementManager();
    achievementManager.startNewRun();
    this.toastManager = getToastManager(this);

    // Single-source hidden unlock toasts. Evaluator fires this per new unlock,
    // so the end-of-run loop no longer needs to iterate results itself.
    getHiddenUnlockManager().setOnNewUnlock((condition) => {
      this.toastManager.showToast({
        title: 'Hidden Unlock!',
        description: `${condition.displayName} — ${condition.hintText}`,
        icon: 'star',
        color: 0xffcc44,
        duration: 5500,
      });
    });

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
    // First-run coach marks replace the old single welcome toast. They cover
    // move, dash, XP, pause, and combos — each dismissible.
    if (!getSettingsManager().isTutorialSeen()) {
      this.time.delayedCall(1200, () => this.showFirstRunCoachMarks());
    }

    // Show active run modifiers as a centered banner overlay
    if (this.activeModifiers.length > 0) {
      this.showModifierBanner();
    }

    this.damageCooldown = 0;
    this.isGameOver = false;
    this.isPaused = false;
    this.hasWon = false;
    this.magnetSpawnTimer = 0;
    this.bossSpawned = false;
    this.bossWarningPhase = 0;
    this.bossCountdownText = null;
    this.endlessModeActive = false;
    this.endlessModeTime = 0;
    this.endlessMinibossTimer = 0;
    this.endlessBossTimer = 0;
    this.endlessCycleNumber = 0;
    this.endlessBossIntervalSeconds = 300;
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
    this.minibossSpawnTimes.forEach((entry, i) => { entry.typeId = typeIds[i]; });

    // Initialize ECS world
    this.world = createWorld();

    // Initialize Geometry Wars style warping grid background
    this.gridBackground = new GridBackground(this);
    this.applyStageVisuals();

    // Initialize motion trail system
    this.trailManager = new TrailManager(this);

    // Initialize death ripple system
    this.deathRippleManager = new DeathRippleManager(this);
    this.deathRippleManager.setWorld(this.world);
    this.deathRippleManager.setQuality(this.visualQuality);

    // Initialize boss arena and hazard zone systems
    setBossArenaScene(this);
    setHazardZoneScene(this);
    setHazardZoneQuality(this.visualQuality);
    this.activeBossType = null;
    this.bossHazardTimer = 0;
    this.hazardDamageMultiplier = 1.0;

    // Initialize post-processing pipelines (WebGL only)
    if (this.renderer.type === Phaser.WEBGL) {
      const pipelines = ['DistortionPipeline'];
      if (this.visualQuality !== 'low') {
        pipelines.push('BloomPipeline');
      }
      // ColorblindPipeline runs last so CVD correction / contrast applies to the
      // fully composited frame. It is a pass-through when the setting is off.
      pipelines.push('ColorblindPipeline');
      this.cameras.main.setPostPipeline(pipelines);
      const postPipelines = this.cameras.main.postPipelines;
      this.distortionPipeline = postPipelines.find(p => p.name === 'DistortionPipeline') as DistortionPipeline ?? null;
      this.bloomPipeline = postPipelines.find(p => p.name === 'BloomPipeline') as BloomPipeline ?? null;
      if (this.bloomPipeline) {
        const isHighQuality = this.visualQuality === 'high';
        this.bloomPipeline.setBloomStrength(isHighQuality ? 0.35 : 0.2);
        this.bloomPipeline.setBloomThreshold(isHighQuality ? 0.6 : 0.7);
      }
    }

    // Initialize dynamic lighting system
    this.lightingSystem = new LightingSystem(this);
    // Start with quality-appropriate settings
    if (this.visualQuality === 'low') {
      this.lightingSystem.setEnabled(false);
    }

    // Initialize status effect visual overlays (burn/freeze/poison on enemies)
    this.statusEffectVisualManager = new StatusEffectVisualManager(this);
    this.statusEffectVisualManager.setWorld(this.world);
    this.statusEffectVisualManager.setQuality(this.visualQuality);

    // Initialize off-screen threat indicators
    this.offScreenIndicatorManager = new OffScreenIndicatorManager(this);
    this.offScreenIndicatorManager.setWorld(this.world);

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
    this.evolutionLevelReduction = metaManager.getStartingEvolutionBonus();

    // ═══ ADVANCED ELEMENTAL ═══
    this.playerStats.shatterBonus += metaManager.getStartingShatterBonus();
    this.playerStats.pandemicSpread += metaManager.getStartingPandemicSpread();
    this.playerStats.overchargeStunDuration += metaManager.getStartingOverchargeStun();
    this.playerStats.explosionDamageMultiplier *= (1 + metaManager.getStartingExplosionDamage());

    // ═══ TIME/DIFFICULTY ═══
    this.playerStats.slowTimeRemaining = metaManager.getStartingSlowTimeMinutes() * 60; // Convert minutes to seconds
    this.playerStats.curseMultiplier *= (1 + metaManager.getStartingCurseLevel() * 0.15); // 15% per curse level

    // Cache per-run meta values read every frame in update() (shop upgrades are fixed at run start)
    this.cachedGemMagnetInterval = metaManager.getStartingGemMagnetInterval();
    this.cachedEmergencyHealPercent = metaManager.getStartingEmergencyHeal();

    // ═══ RUN MODIFIERS ═══
    for (const modifier of this.activeModifiers) {
      modifier.apply(this.playerStats);
    }

    // ═══ SHIP / CHARACTER BONUSES ═══
    const selectedShip = getShipById(this.selectedShipId) ?? getDefaultShip();
    this.playerStats.maxHealth = Math.round(this.playerStats.maxHealth * selectedShip.healthMultiplier);
    this.playerStats.currentHealth = this.playerStats.maxHealth;
    this.playerStats.moveSpeed *= selectedShip.moveSpeedMultiplier;
    this.playerStats.damageMultiplier *= selectedShip.damageMultiplier;
    this.playerStats.cooldownMultiplier *= selectedShip.cooldownMultiplier;
    this.playerStats.xpMultiplier *= selectedShip.xpMultiplier;
    this.playerStats.goldMultiplier *= selectedShip.goldMultiplier;
    if (selectedShip.knockbackImmune) {
      this.playerStats.knockbackImmunity = true;
    }
    if (selectedShip.bossDamageMultiplier !== undefined) {
      this.playerStats.bossDamageMultiplier = selectedShip.bossDamageMultiplier;
    }
    // Signature mechanics — each field maps to an existing PlayerStats channel
    // so the ship identity feels earned without introducing new combat code.
    if (selectedShip.critChanceBonus !== undefined) {
      this.playerStats.critChance += selectedShip.critChanceBonus;
    }
    if (selectedShip.regenPerSecondBonus !== undefined) {
      this.playerStats.regenPerSecond += selectedShip.regenPerSecondBonus;
    }
    if (selectedShip.armorBonus !== undefined) {
      this.playerStats.armor += selectedShip.armorBonus;
    }
    if (selectedShip.lifeStealBonus !== undefined) {
      this.playerStats.lifeStealPercent += selectedShip.lifeStealBonus;
    }
    if (selectedShip.startingRerollBonus !== undefined) {
      this.playerStats.rerollsRemaining += selectedShip.startingRerollBonus;
    }
    if (selectedShip.startingSkipBonus !== undefined) {
      this.playerStats.skipsRemaining += selectedShip.startingSkipBonus;
    }
    // Use the ship's starting weapon only when the player hasn't explicitly
    // picked a weapon (i.e. fell through the default path). This keeps
    // WeaponSelectScene's pick authoritative when it's provided.
    if (this.startingWeaponId === 'projectile' && selectedShip.startingWeaponId !== 'projectile') {
      this.startingWeaponId = selectedShip.startingWeaponId;
    }

    // ═══ WORLD LEVEL SCALING ═══
    this.worldLevel = metaManager.getWorldLevel();
    this.worldLevelHealthMult = metaManager.getWorldLevelEnemyHealthMultiplier();
    this.worldLevelDamageMult = metaManager.getWorldLevelEnemyDamageMultiplier();
    this.worldLevelSpawnReduction = metaManager.getWorldLevelSpawnTimeReduction();
    this.worldLevelXPMult = metaManager.getWorldLevelXPMultiplier();
    setHazardZoneWorldLevel(this.worldLevel);

    // ═══ STAGE MODIFIERS ═══
    const activeStage = getStageById(this.selectedStageId) ?? getDefaultStage();
    this.worldLevelHealthMult *= activeStage.enemyHealthMultiplier;
    this.worldLevelDamageMult *= activeStage.enemyDamageMultiplier;
    this.worldLevelXPMult *= activeStage.xpMultiplier;
    this.playerStats.goldMultiplier *= activeStage.goldMultiplier;
    // Bias the hazard spawner so each biome has a signature mix (Inferno →
    // burn, Crystal Caves → ice, Endless Void → void+energy).
    setHazardZoneStage(activeStage.id);

    // ═══ SPAWNING ═══
    this.playerStats.treasureInterval = metaManager.getStartingTreasureInterval();
    this.playerStats.chestDroneDelay = metaManager.getStartingChestDroneDelay();

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
    const startingLevel = metaManager.getStartingLevel()
      + achievementBonuses.startingLevel
      + ascensionManager.getBonusStartingLevel();
    if (startingLevel > 1) {
      this.pendingLevelUps += startingLevel - 1;
    }

    // Initialize effects and sound managers
    this.effectsManager = new EffectsManager(this);
    this.soundManager = new SoundManager(this);
    // Bind the shared JuiceManager to this scene so hitStop/screenShake/
    // impactFlash all have a scene context. Unbind on
    // scene shutdown so stale scene references don't leak into future runs.
    getJuiceManager().setScene(this);
    this.events.once('shutdown', () => {
      getJuiceManager().setScene(null);
    });

    // Pre-render gem rotation frames to GPU texture atlases
    generateGemAtlases(this);
    // Pre-render projectile shapes to GPU texture atlas
    generateProjectileAtlases(this);

    // Setup XP gem system
    setXPGemSystemScene(this);
    setXPGemEffectsManager(this.effectsManager);
    setXPGemSoundManager(this.soundManager);
    setXPGemTrailManager(this.trailManager);
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

    // Setup floor consumable system
    setConsumablePickupSystemScene(this);
    setConsumablePickupEffectsManager(this.effectsManager);
    setConsumableCollectCallback((kind, x, y, value) => this.activateConsumable(kind, x, y, value));

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

    // Fire a phase-transition effect when a boss crosses 66% / 33% HP.
    setBossPhaseTransitionCallback((bossId, newPhase) => this.handleBossPhaseTransition(bossId, newPhase));

    // Setup status effect system
    setStatusEffectSystemEffectsManager(this.effectsManager);
    setHazardZoneEffectsManager(this.effectsManager);
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

    // Load the persisted auto-buy preference and force the HUD to match the gameplay flag
    this.initAutoBuyFromStorage();
    this.hudManager.setAutoBuyEnabled(this.isAutoBuyEnabled);

    // Persistent strip of active modifiers and relics in the HUD
    this.refreshRelicStrip();

    // Persistent low-HP danger vignette (red screen-edge pulse)
    this.dangerVignette = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height,
      0xff0000, 0
    ).setScrollFactor(0).setDepth(1998);

    // Create pause menu manager
    this.pauseMenuManager = this.createPauseMenuManager();

    // Setup all input event handlers and input controller
    this.setupInputEventHandlers();

    // Director debug overlay — created once, toggled by settings flag (F10).
    this.createDirectorDebugOverlay();
  }

  /**
   * Builds the director debug text object (always present, visibility toggled).
   * Shows current spend strategy + credit balance so the developer can verify
   * the director is producing the variance the design intends.
   */
  private createDirectorDebugOverlay(): void {
    this.directorDebugText = this.add.text(8, 8, '', {
      fontSize: '12px',
      fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
      color: '#44ff99',
      backgroundColor: '#00000099',
      padding: { x: 6, y: 4 },
    });
    this.directorDebugText.setDepth(2500);
    this.directorDebugText.setScrollFactor(0);
    this.applyDirectorDebugVisibility(getSettingsManager().isDirectorDebugEnabled());
  }

  /** Show/hide the director debug overlay. */
  private applyDirectorDebugVisibility(visible: boolean): void {
    if (!this.directorDebugText) return;
    this.directorDebugText.setVisible(visible);
  }

  /** Refreshes the overlay text when active. Throttled to keep HUD cost trivial. */
  private updateDirectorDebugOverlay(deltaSeconds: number): void {
    if (!this.directorDebugText || !this.directorDebugText.visible) return;
    this.directorDebugRefreshAccumulator += deltaSeconds;
    if (this.directorDebugRefreshAccumulator < 0.25) return;
    this.directorDebugRefreshAccumulator = 0;

    const state = getDirectorState();
    const strategy = getCurrentStrategy().toUpperCase();
    this.directorDebugText.setText(
      `DIRECTOR  [${strategy}]\n` +
      `credits: ${state.creditBalance.toFixed(0)}  (earned ${state.creditsEarned.toFixed(0)})\n` +
      `enemies alive: ${this.enemyCount}   t=${this.gameTime.toFixed(0)}s   F10 to hide`
    );
  }

  /** Rebuilds the HUD's active-modifier/relic icon strip from current state. */
  private refreshRelicStrip(): void {
    if (!this.hudManager) return;
    this.hudManager.updateRelicModifierStrip(
      this.activeModifiers,
      getRelicManager().getEquippedRelics()
    );
  }

  /**
   * Sets up all input event handlers and initializes the input controller.
   * Shared between fresh start and restore paths to avoid duplicate registration.
   */
  private setupInputEventHandlers(): void {
    // Setup pause key (ESC) — polling via addKey is more reliable than keydown events
    this.escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC) ?? null;

    // Setup scene resume handler to show pause menu when returning from settings
    this.resumeHandler = () => {
      if (this.isPaused && !this.pauseMenuManager.isPauseMenuOpen) {
        this.pauseMenuManager.showPauseMenuFromSettings();
      }
    };
    this.events.on('resume', this.resumeHandler);

    // Setup auto-buy toggle key (T)
    this.autoBuyKeyHandler = () => {
      this.toggleAutoBuy();
    };
    this.input.keyboard?.on('keydown-T', this.autoBuyKeyHandler);

    // F10 toggles the director debug overlay and persists the choice.
    this.directorDebugKeyHandler = () => {
      const settingsManager = getSettingsManager();
      const nextEnabled = !settingsManager.isDirectorDebugEnabled();
      settingsManager.setDirectorDebugEnabled(nextEnabled);
      this.applyDirectorDebugVisibility(nextEnabled);
    };
    this.input.keyboard?.on('keydown-F10', this.directorDebugKeyHandler);

    // Setup beforeunload handler to save game state on page close/refresh
    this.setupBeforeUnloadHandler();

    // Initialize input controller (keyboard, mouse, joystick, focus-loss handlers)
    // Must be after pauseMenuManager is created since onFocusLost references it
    this.inputController.create();

    // Reserve the dash button region from joystick spawn so a finger tap on
    // dash doesn't also drop a joystick base there.
    this.inputController.addJoystickExclusionCheck((x, y) => {
      return this.hudManager.getTouchActionButtons()?.isPointInDashButton(x, y) ?? false;
    });
    // While first-run coach marks are showing, taps to advance shouldn't also
    // spawn the joystick (would leave ghost joysticks on screen).
    this.inputController.addJoystickExclusionCheck(() => !!this.coachMarksCleanup);

    // Listen for dash requests from InputController (triggered by Shift key)
    this.dashRequestHandler = () => {
      if (this.isPaused || this.isGameOver) return;
      if (this.playerId === -1) return;
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      this.inputController.tryDash(playerX, playerY, this.playerId);
    };
    this.events.on('input-dash-requested', this.dashRequestHandler);

    // Listen for pause requests from gamepad (Start button)
    this.pauseRequestHandler = () => {
      this.togglePauseMenu();
    };
    this.events.on('input-pause-requested', this.pauseRequestHandler);

    // Listen for auto-buy toggle from gamepad (Select button)
    this.autoBuyToggleHandler = () => {
      this.toggleAutoBuy();
    };
    this.events.on('input-autobuy-toggled', this.autoBuyToggleHandler);
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
      modifierIds: this.activeModifiers.map(m => m.id),
      stageId: this.selectedStageId,
      relicIds: getRelicManager().getEquippedRelics().map(r => r.id),
      directorState: getDirectorState(),
    });
  }

  /**
   * Restores a saved game state.
   * Called when the game is loaded with a valid save from page reload.
   */
  private restoreGameState(state: GameSaveState): void {
    // Restore run modifiers from save
    if (state.modifierIds) {
      this.activeModifiers = state.modifierIds
        .map(id => getModifierById(id))
        .filter((modifier): modifier is RunModifier => modifier !== undefined);
    }

    // Restore stage selection before anything that reads it (enemy scaling,
    // grid palette). Falls back to default if the save is pre-stageId.
    this.selectedStageId = state.stageId || 'stage_deep_void';

    // Reset all ECS systems — mirror the fresh-path reset block so stale
    // singleton state (director credit, boss phase tracker, cached textures,
    // combo/event counters, relic inventory) doesn't carry across restores.
    this.resetAllRunSystems();

    // Combo/event systems are overridden below when state.comboState / eventState
    // are applied; the resets above just give us a known baseline first.

    // Reset timers
    this.autoSaveTimer = 0;

    // Initialize ECS world
    this.world = createWorld();

    // Initialize visual systems
    this.gridBackground = new GridBackground(this);
    this.applyStageVisuals();
    this.trailManager = new TrailManager(this);
    this.deathRippleManager = new DeathRippleManager(this);
    this.deathRippleManager.setWorld(this.world);
    this.deathRippleManager.setQuality(this.visualQuality);

    // Re-bind scene refs on the boss-arena/hazard-zone modules. Our reset
    // block above nulled their sceneRef; without these, any post-reload boss
    // arena or hazard zone would silently no-op.
    setBossArenaScene(this);
    setHazardZoneScene(this);
    setHazardZoneQuality(this.visualQuality);

    this.statusEffectVisualManager = new StatusEffectVisualManager(this);
    this.statusEffectVisualManager.setWorld(this.world);
    this.statusEffectVisualManager.setQuality(this.visualQuality);
    this.offScreenIndicatorManager = new OffScreenIndicatorManager(this);
    this.offScreenIndicatorManager.setWorld(this.world);
    this.masteryVisualsManager = new MasteryVisualsManager(this);
    this.shieldBarrierVisual = new ShieldBarrierVisual(this);

    // Initialize toast manager early (needed before game loop starts)
    this.toastManager = getToastManager(this);

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
    // Director strategy + credit balance restore — without this, the reload
    // re-picks a random strategy, breaking mid-run spawn continuity.
    if (state.directorState) {
      restoreDirectorState(state.directorState);
    }
    this.minibossSpawnTimes = state.minibossSpawnTimes;

    // Restore player state
    this.playerStats = state.playerStats;
    this.banishedUpgradeIds = new Set(state.banishedUpgradeIds);
    this.isAutoBuyEnabled = state.isAutoBuyEnabled;

    // Rehydrate relic inventory without re-applying stats — the saved
    // playerStats already includes the relic bonuses, so we only restore the
    // inventory list for UI display + future drop dedup/cap.
    if (state.relicIds && state.relicIds.length > 0) {
      getRelicManager().restoreFromSave(state.relicIds);
    }

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
    // Hazard-zone scaling tracks world level; must be re-pushed after a
    // restore since the module was reset above. The stage bias also resets,
    // so re-apply it from the restored selected stage.
    setHazardZoneWorldLevel(this.worldLevel);
    const restoredStage = getStageById(this.selectedStageId) ?? getDefaultStage();
    setHazardZoneStage(restoredStage.id);

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
    // Bind the shared JuiceManager to this scene so hitStop/screenShake/
    // impactFlash all have a scene context.
    getJuiceManager().setScene(this);

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

    // Restored runs already loaded isAutoBuyEnabled from save state; keep the HUD toggle in sync
    this.hudManager.setAutoBuyEnabled(this.isAutoBuyEnabled);

    // Persistent strip of active modifiers and relics in the HUD (restore path)
    this.refreshRelicStrip();

    // Create any boss health bars that were deferred during entity restoration
    for (const pending of this.pendingBossHealthBars) {
      this.hudManager.createBossHealthBar(pending.entityId, pending.name, pending.isBoss);
    }
    this.pendingBossHealthBars = [];

    // Persistent low-HP danger vignette (restore path)
    this.dangerVignette = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height,
      0xff0000, 0
    ).setScrollFactor(0).setDepth(1998);

    // Populate upgrade icons with restored weapons and upgrades
    this.hudManager.updateUpgradeIcons(this.buildUpgradeIconData());

    // Create pause menu manager (restore path)
    this.pauseMenuManager = this.createPauseMenuManager();

    // Setup all input event handlers and input controller
    this.setupInputEventHandlers();

    // Restore dash state from save
    this.inputController.setDashCooldownTimer(state.dashCooldownTimer);
    this.inputController.resetDashState();
  }

  /**
   * Sets up all ECS system callbacks.
   * Extracted for reuse in both fresh start and restore.
   */
  private setupSystemCallbacks(): void {
    // Pre-render gem atlases (needed for restore path)
    generateGemAtlases(this);
    generateProjectileAtlases(this);

    // Setup XP gem system
    setXPGemSystemScene(this);
    setXPGemEffectsManager(this.effectsManager);
    setXPGemSoundManager(this.soundManager);
    setXPGemTrailManager(this.trailManager);
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

    // Setup floor consumable system
    setConsumablePickupSystemScene(this);
    setConsumablePickupEffectsManager(this.effectsManager);
    setConsumableCollectCallback((kind, x, y, value) => this.activateConsumable(kind, x, y, value));

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

    // Fire a phase-transition effect when a boss crosses 66% / 33% HP.
    // Registered here (not only in the fresh path) so mid-boss reloads still
    // trigger phase VFX on the restored encounter.
    setBossPhaseTransitionCallback((bossId, newPhase) => this.handleBossPhaseTransition(bossId, newPhase));

    // Setup status effect system
    setStatusEffectSystemEffectsManager(this.effectsManager);
    setHazardZoneEffectsManager(this.effectsManager);
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
    // (hudManager may not exist yet during restoreGameState — it's created after restoreEntities)
    if (this.hudManager?.getBossEntityIds().length > 0) {
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

    // Create player visual (procedural neon spaceship)
    this.playerSpaceship = new PlayerSpaceship(this, entity.transform.x, entity.transform.y, {
      baseRadius: 16,
      neonColor: this.getShipNeonColor(),
      quality: this.visualQuality,
    }, this.playerStats.level);
    const playerVisual = this.playerSpaceship.getContainer();
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
    // Armor is static per type — re-derive from the saved type id (not serialized separately)
    EnemyType.armor[entityId] = getEnemyArmor(entity.enemyData.typeId);
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

    // Queue boss health bar creation (hudManager may not exist yet during restore path)
    if (entity.enemyData.xpValue >= 30) {
      if (this.hudManager) {
        this.hudManager.createBossHealthBar(entityId, enemyType.name, entity.enemyData.xpValue >= 1000);
      } else {
        // Defer — will be created after hudManager initialization
        this.pendingBossHealthBars.push({ entityId, name: enemyType.name, isBoss: entity.enemyData.xpValue >= 1000 });
      }
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
    // Idempotency guard: bail if this entity is no longer a live enemy. All
    // current callers pre-check liveness, but this prevents double-processing
    // (double XP/combo/kill-count, removeEntity on a freed id) if a future
    // caller ever fires twice for the same death.
    if (!hasComponent(this.world, EnemyTag, enemyId)) return;

    this.enemyCount--;
    this.killCount++;

    // Track combo kill and handle threshold rewards
    const comboResult = recordComboKill();
    if (comboResult.triggeredThreshold) {
      this.handleComboThreshold(comboResult.triggeredThreshold);
    }
    // Juice on combo tier transitions (separate from threshold rewards)
    if (comboResult.tierChanged && !comboResult.triggeredThreshold) {
      this.handleComboTierChange(comboResult.tierChanged);
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

    // Rare floor-consumable drop. Tougher enemies drop more often; bosses/
    // minibosses are guaranteed a power-up.
    const consumableChance = xpValue >= 1000 ? 1 : xpValue >= 30 ? 0.18 : 0.012;
    if (Math.random() < consumableChance) {
      this.spawnRandomConsumable(x, y);
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
        // Find nearby enemies using spatial hash for O(nearby) instead of O(all)
        const spreadRadius = this.playerStats.pandemicSpread;
        const nearbyEnemies = getEnemySpatialHash().query(x, y, spreadRadius);
        for (const nearby of nearbyEnemies) {
          if (nearby.id === enemyId) continue;
          // Skip entities already removed this frame (stale spatial hash entries)
          if (!hasComponent(this.world, EnemyTag, nearby.id)) continue;
          // Spread half the stacks to nearby enemies
          const spreadStacks = Math.max(1, Math.floor(poisonStacks / 2));
          applyPoison(this.world, nearby.id, spreadStacks, 4000, this.playerStats.poisonMaxStacks);
          // Visual feedback for poison spread
          this.effectsManager.showDamageNumber(nearby.x, nearby.y - 10, spreadStacks, 0x66ff66);
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

      // Phase 3: Camera effects + slow-motion cinematic
      getJuiceManager().slowMotion(300, 0.25);
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.shakeCamera(500, 0.035);
      }
      this.cameras.main.flash(400, 255, 200, 200);
      this.effectsManager.playImpactFlash(0.4, 150);
      // Screen-space distortion shockwave from boss death
      this.distortionPipeline?.addDistortion(x, y, 400, 0.04, 500);

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

      // Deactivate boss arena atmosphere (plays cleansing flash)
      deactivateBossArena();
      this.activeBossType = null;

      // Gold sparkle rain across screen for boss death celebration
      for (let sparkleIndex = 0; sparkleIndex < 12; sparkleIndex++) {
        this.time.delayedCall(sparkleIndex * 60, () => {
          const rainX = Math.random() * this.scale.width;
          const rainY = Math.random() * this.scale.height * 0.6;
          this.effectsManager.playGoldSparkle(rainX, rainY, 4);
        });
      }

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
      getJuiceManager().slowMotion(150, 0.4);

      if (getSettingsManager().isScreenShakeEnabled()) {
        this.shakeCamera(250, 0.018);
      }
      this.effectsManager.playImpactFlash(0.15, 80);
      // Screen-space distortion shockwave from miniboss death
      this.distortionPipeline?.addDistortion(x, y, 250, 0.025, 400);

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

    // Read enemy size before removing entity (ECS data wiped on removeEntity)
    const killFlashSize = EnemyType.size[enemyId] || 1;

    // Clean up entity — unregister from ECS immediately, but let visual linger for kill flash
    this.deathRippleManager.unregisterEnemy(enemyId);
    this.statusEffectVisualManager.unregisterEnemy(enemyId);
    const sprite = getSprite(enemyId);
    unregisterSprite(enemyId);
    removeEntity(this.world, enemyId);

    if (sprite) {
      // Kill flash: white pop + scale burst before disappearing
      const flashRadius = 10 * killFlashSize;
      const flashOverlay = this.add.circle(0, 0, flashRadius, 0xffffff, 0.9);
      if (sprite instanceof Phaser.GameObjects.Container) {
        sprite.add(flashOverlay);
      }
      this.tweens.add({
        targets: sprite,
        scaleX: (sprite.scaleX || 1) * 1.3,
        scaleY: (sprite.scaleY || 1) * 1.3,
        alpha: 0,
        duration: 60,
        ease: 'Quad.easeOut',
        onComplete: () => sprite.destroy(),
      });
    }
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

        // Knockback from explosion (skipped when Juggernaut ship's immunity is active)
        if (!this.playerStats.knockbackImmunity) {
          const knockbackDir = Math.atan2(playerY - y, playerX - x);
          Knockback.velocityX[this.playerId] = Math.cos(knockbackDir) * 300;
          Knockback.velocityY[this.playerId] = Math.sin(knockbackDir) * 300;
        }
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

  /**
   * Spawns a weighted-random floor consumable at a position. GOLD caches carry
   * a payload that scales with run progress so they stay relevant late game.
   */
  private spawnRandomConsumable(x: number, y: number): void {
    const roll = Math.random();
    let kind: ConsumableKind;
    if (roll < 0.30) kind = ConsumableKind.BOMB;
    else if (roll < 0.58) kind = ConsumableKind.FREEZE;
    else if (roll < 0.80) kind = ConsumableKind.VACUUM;
    else kind = ConsumableKind.GOLD;

    const goldValue = kind === ConsumableKind.GOLD
      ? 25 + Math.floor(this.gameTime * 0.5) + this.worldLevel * 10
      : 0;
    spawnConsumablePickup(this.world, x, y, kind, goldValue);
  }

  /**
   * Applies a collected floor consumable's effect. Owned by GameScene because
   * activation needs the weapon/meta managers and run state.
   */
  private activateConsumable(kind: ConsumableKind, x: number, y: number, value: number): void {
    switch (kind) {
      case ConsumableKind.BOMB: {
        const playerX = this.playerId !== -1 ? Transform.x[this.playerId] : x;
        const playerY = this.playerId !== -1 ? Transform.y[this.playerId] : y;
        const bombDamage = 250 + this.gameTime * 3;
        this.weaponManager.detonateArea(playerX, playerY, 720, bombDamage, 320);
        this.effectsManager.playDeathBurst(playerX, playerY, 0xff7733);
        this.cameras.main.shake(280, 0.02);
        getJuiceManager().slowMotion(150, 0.45);
        this.soundManager.playComboThreshold();
        break;
      }
      case ConsumableKind.FREEZE: {
        const enemyIds = getFrameCacheEnemyIds();
        for (let i = 0; i < enemyIds.length; i++) {
          applyFreeze(this.world, enemyIds[i], 0.12, 2800);
        }
        this.cameras.main.flash(180, 120, 200, 255);
        this.soundManager.playFreezeApply();
        break;
      }
      case ConsumableKind.VACUUM: {
        magnetizeAllGems(this.world);
        magnetizeAllHealthPickups(this.world);
        this.soundManager.playMagnetActivation();
        break;
      }
      case ConsumableKind.GOLD: {
        const amount = value > 0 ? value : 50;
        getMetaProgressionManager().addGold(amount);
        this.soundManager.playPurchase();
        if (this.toastManager) {
          this.toastManager.showToast({
            title: `Gold Cache +${amount}`,
            description: 'Bonus gold banked for the shop.',
            icon: 'coins',
            color: 0xffd24a,
            duration: 2500,
          });
        }
        break;
      }
    }
  }

  // Pre-allocated pool for grid background enemy data (avoids per-frame allocation)
  private gridEnemyDataPool: { x: number; y: number; weight: number }[] = [];
  private gridEnemyDataLength: number = 0;

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
    // Enemy projectiles use a distinct signature: saturated crimson core with a
    // warm-gold ring. Ring color lies outside the player weapon palette (cyan /
    // violet / blue) so the player can recognize incoming threats even in dense
    // combat where orange fire weapons are active.
    const sprite = this.add.circle(x, y, 8, 0xff2233);
    sprite.setStrokeStyle(3, 0xffcc66);
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
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const playerX = this.playerId !== -1 ? Transform.x[this.playerId] : 0;
    const playerY = this.playerId !== -1 ? Transform.y[this.playerId] : 0;
    const hasPlayer = this.playerId !== -1;

    // Reverse iteration with swap-and-pop for O(1) removal
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const proj = this.enemyProjectiles[i];
      proj.lifetime -= deltaTime;

      let shouldRemove = proj.lifetime <= 0;

      if (!shouldRemove) {
        proj.sprite.x += proj.vx * deltaTime;
        proj.sprite.y += proj.vy * deltaTime;

        // Bounds check
        if (proj.sprite.x < -20 || proj.sprite.x > screenWidth + 20 ||
            proj.sprite.y < -20 || proj.sprite.y > screenHeight + 20) {
          shouldRemove = true;
        }
      }

      // Check collision with player (squared distance avoids sqrt)
      if (!shouldRemove && hasPlayer) {
        const dx = playerX - proj.sprite.x;
        const dy = playerY - proj.sprite.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 400) { // 20 * 20
          this.takeDamage(proj.damage);
          shouldRemove = true;
        }
      }

      if (shouldRemove) {
        proj.sprite.destroy();
        // Swap with last element and pop — O(1) removal
        const lastIndex = this.enemyProjectiles.length - 1;
        if (i < lastIndex) {
          this.enemyProjectiles[i] = this.enemyProjectiles[lastIndex];
        }
        this.enemyProjectiles.pop();
      }
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
      // Look up evolution requirements for this weapon
      let evolutionInfo: EvolutionInfo | undefined;
      const evolution = getEvolutionForWeapon(weapon.id);
      if (evolution) {
        const statUpgrade = this.upgrades.find(u => u.id === evolution.requiredStatId);
        evolutionInfo = {
          requiredWeaponLevel: Math.max(1, evolution.requiredWeaponLevel - this.evolutionLevelReduction),
          requiredStatName: statUpgrade?.name ?? evolution.requiredStatId,
          requiredStatLevel: evolution.requiredStatLevel,
          currentStatLevel: statUpgrade?.currentLevel ?? 0,
          isEvolved: weapon.isEvolved,
          evolvedName: evolution.evolvedName,
        };
      }
      result.push({
        id: weapon.id, icon: weapon.icon, name: weapon.name,
        description: weapon.description, currentLevel: weapon.getLevel(),
        maxLevel: weapon.maxLevel, type: 'weapon', evolutionInfo,
      });
    }
    return result;
  }

  /**
   * Toggles the auto-buy feature on/off.
   * Shows confirmation text and updates the UI.
   * Requires auto-upgrade to be purchased from the shop.
   */
  /**
   * Loads the persisted auto-buy preference into the gameplay flag for a fresh run.
   * HUDManager reads the same storage key for its toggle indicator, so without this
   * the HUD could show "AUTO-UPGRADE ON" while level-ups still opened the manual
   * prompt (the gameplay flag defaulted to false). Only applies when the Auto-Upgrade
   * shop upgrade is owned; otherwise the feature stays off.
   */
  private initAutoBuyFromStorage(): void {
    if (getMetaProgressionManager().getAutoUpgradeLevel() < 1) {
      this.isAutoBuyEnabled = false;
      return;
    }
    const savedAutoBuy = SecureStorage.getItem(STORAGE_KEY_AUTO_BUY);
    if (savedAutoBuy !== null) {
      this.isAutoBuyEnabled = savedAutoBuy === 'true';
    }
  }

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
    // Poll ESC key before pause/gameover guard so it can both open and close the menu.
    // Suppress while first-run coach marks are visible — ESC there skips the tutorial
    // and must not also trigger the pause menu.
    if (this.escKey && Phaser.Input.Keyboard.JustDown(this.escKey) && !this.coachMarksCleanup) {
      this.togglePauseMenu();
    }

    // Sync joystick enabled state (must run even when paused to disable during overlays)
    this.inputController.setEnabled(!this.isPaused && !this.isGameOver);

    // Skip update when paused or game over
    if (this.isPaused || this.isGameOver) return;

    // During death sequence, only run visual systems so particles animate
    if (this.deathSequenceActive) {
      const deathDelta = delta / 1000;
      if (this.deathRippleManager) this.deathRippleManager.update(deathDelta);
      if (this.gridBackground) this.gridBackground.update(deathDelta);
      return;
    }

    // ═══ FRAME CACHE UPDATE (must be first - populates spatial hash for all systems) ═══
    updateFrameCache(this.world);

    // Tick juice manager (reserved per-frame hook).
    getJuiceManager().update(delta);

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

    // ═══ LOW-HP DANGER STATE + I-FRAME VISUAL ═══
    if (this.playerId !== -1) {
      const hpRatio = this.playerStats.currentHealth / this.playerStats.maxHealth;

      // Persistent red vignette pulse when below 10% HP
      if (hpRatio < 0.1) {
        const pulseSpeed = 5;
        const baseAlpha = 0.12;
        const pulseAmplitude = 0.08;
        const vignetteAlpha = baseAlpha + Math.sin(this.gameTime * pulseSpeed) * pulseAmplitude;
        this.dangerVignette.setAlpha(vignetteAlpha);
      } else if (this.dangerVignette.alpha > 0.001) {
        // Smooth fade-out when health recovers
        this.dangerVignette.setAlpha(this.dangerVignette.alpha * 0.9);
      }

      // Ship color shift toward red at low HP
      const dangerLevel = Math.max(0, 1 - hpRatio / 0.25); // 0 at 25%+, 1 at 0%
      this.playerSpaceship.setDangerLevel(dangerLevel);


      // I-frame blink on player ship
      this.playerSpaceship.setInvulnerable(this.damageCooldown > 0);
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

      // Spawn afterimage ghosts every 30ms during dash
      this.dashAfterimageTimer += deltaSeconds;
      if (this.dashAfterimageTimer >= 0.03) {
        this.dashAfterimageTimer = 0;
        const playerX = Transform.x[this.playerId];
        const playerY = Transform.y[this.playerId];

        // Reuse from pool or create new
        let afterimage = this.dashAfterimagePool.pop();
        if (!afterimage) {
          afterimage = this.add.circle(playerX, playerY, 16, PLAYER_NEON.glow, 0.6);
          afterimage.setDepth(9);
        } else {
          afterimage.setPosition(playerX, playerY);
          afterimage.setAlpha(0.6);
          afterimage.setScale(1);
          afterimage.setVisible(true);
        }

        this.tweens.add({
          targets: afterimage,
          alpha: 0,
          scaleX: 0.7,
          scaleY: 0.7,
          duration: 200,
          ease: 'Quad.easeOut',
          onComplete: () => {
            afterimage!.setVisible(false);
            this.dashAfterimagePool.push(afterimage!);
          },
        });
      }
    } else {
      this.dashAfterimageTimer = 0;
    }

    // Update touch dash cooldown display
    this.hudManager.updateDashCooldown(
      dashState.cooldownRemaining,
      this.playerStats.dashCooldown
    );

    // ═══ GEM MAGNET (auto-vacuum at intervals) ═══
    const gemMagnetInterval = this.cachedGemMagnetInterval;
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
    const emergencyHealPercent = this.cachedEmergencyHealPercent;
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

    // Update boss arena atmosphere pulse
    updateBossArena(deltaSeconds);

    // Refresh director debug overlay (no-op when hidden)
    this.updateDirectorDebugOverlay(deltaSeconds);

    // Update hazard zones and apply effects
    this.hazardDamageMultiplier = 1.0;
    if (this.playerId !== -1) {
      const hazardResult = updateHazardZones(
        deltaSeconds, this.playerId,
        Transform.x[this.playerId], Transform.y[this.playerId]
      );
      this.hazardDamageMultiplier = hazardResult.playerDamageMultiplier;

      // Process enemies killed by hazard burn damage
      for (let i = 0; i < hazardResult.killedEnemyIds.length; i++) {
        const killedId = hazardResult.killedEnemyIds[i];
        this.handleEnemyDeath(killedId, Transform.x[killedId], Transform.y[killedId]);
      }

      // General hazard spawning (time-based, escalates throughout run)
      updateHazardSpawner(
        deltaSeconds, this.gameTime,
        Transform.x[this.playerId], Transform.y[this.playerId],
        this.scale.width, this.scale.height
      );
    }

    // Spawn boss-specific hazard zones during boss fights
    if (this.activeBossType) {
      this.bossHazardTimer -= deltaSeconds;
      if (this.bossHazardTimer <= 0) {
        this.spawnBossHazard();
      }
    }

    // Suppress events during boss warning phase 2+
    setSuppressEvents(this.bossWarningPhase >= 2);

    // Advance director credit budget (used by spawnEnemy to pick enemy types)
    updateDirector(this.gameTime, this.worldLevel);

    // Update event system and handle triggered events
    const triggeredEvent = updateEventSystem(deltaSeconds, this.gameTime);
    if (triggeredEvent) {
      this.handleRunEvent(triggeredEvent);
    }
    this.hudManager.updateEventIndicator(getActiveEvent()?.event ?? null);

    // Update laser beams
    this.updateLaserBeams(deltaSeconds);

    // Update input state (joystick, keyboard, mouse, gamepad sync)
    const inputState = this.inputController.update();

    // Update touch button visibility based on control mode
    this.hudManager.updateTouchButtonVisibility(inputState.controlMode);

    // Run ECS systems
    this.updatePlayerEffectiveMoveSpeed();
    inputSystem(this.world, inputState, deltaSeconds, this.playerStats.accelerationMultiplier);
    updateAIGameTime(this.gameTime);
    enemyAISystem(this.world, deltaSeconds);

    // Apply Warden slow aura to player velocity (computed inside enemyAISystem)
    if (this.playerId !== -1) {
      const wardenSlow = getWardenSlowMultiplier();
      if (wardenSlow < 1.0) {
        Velocity.x[this.playerId] *= wardenSlow;
        Velocity.y[this.playerId] *= wardenSlow;
      }
    }

    // Apply ice hazard slow to enemies (deferred from updateHazardZones, after AI sets velocities)
    applyIceHazardSlow();

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

    // XP gem system (with viewport culling)
    xpGemSystem(this.world, deltaSeconds, this.scale.width, this.scale.height);

    // Health pickup system
    healthPickupSystem(this.world, deltaSeconds, this.gameTime);

    // Magnet pickup system
    magnetPickupSystem(this.world, deltaSeconds, this.gameTime);

    // Floor consumable system (bomb/freeze/vacuum/gold)
    consumablePickupSystem(this.world, deltaSeconds, this.gameTime);

    // Status effect system (burn, freeze, poison damage over time)
    statusEffectSystem(this.world, delta);

    // Update enemy projectiles
    this.updateEnemyProjectiles(deltaSeconds);

    // Check player-enemy collision for damage
    this.checkPlayerEnemyCollision();

    // Sync sprites to ECS positions
    spriteSystem(this.world, this.scale.width, this.scale.height);

    // Update player spaceship visual effects (squash/stretch, fins, breathing)
    if (this.playerId !== -1 && this.playerSpaceship) {
      this.playerSpaceship.setComboTier(getComboTier());
      this.playerSpaceship.update(
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

    // Update status effect visuals (burn/freeze/poison overlays)
    this.statusEffectVisualManager.update(deltaSeconds);

    // Update off-screen threat indicators
    this.offScreenIndicatorManager.update(deltaSeconds);

    // Update visual quality based on FPS (auto-scaling)
    this.updateVisualQuality(delta);


    // Update HUD
    const bossEntityIds = this.hudManager.getBossEntityIds();
    // Reuse pooled payload objects in-place; truncate to active boss count (HUD consumes synchronously)
    const bossHealthPayload = this.bossHealthPayload;
    for (let i = 0; i < bossEntityIds.length; i++) {
      const bossEntityId = bossEntityIds[i];
      let entry = bossHealthPayload[i];
      if (!entry) {
        entry = { entityId: 0, currentHP: 0, maxHP: 0 };
        bossHealthPayload[i] = entry;
      }
      entry.entityId = bossEntityId;
      entry.currentHP = Health.current[bossEntityId];
      entry.maxHP = Health.max[bossEntityId];
    }
    bossHealthPayload.length = bossEntityIds.length;

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
      comboBuffActive: isComboBuffActive(),
      comboBuffPercent: getComboBuffRemainingPercent(),
      bossHealthData: bossHealthPayload,
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
    if (entities.length === 0) return;

    // Cache decay factor once per frame (same deltaSeconds for all entities)
    const decayFactor = Math.pow(0.001, deltaSeconds);

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

    // Geometry Wars-style impact feedback — scaled by severity
    const hpPercent = this.playerStats.currentHealth / this.playerStats.maxHealth;
    if (getSettingsManager().isScreenShakeEnabled()) {
      const shakeIntensity = hpPercent < 0.25 ? 0.012 : 0.008;
      const shakeDuration = hpPercent < 0.25 ? 200 : 100;
      this.shakeCamera(shakeDuration, shakeIntensity);
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
      this.playDeathSequence();
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
    magnetizeAllHealthPickups(this.world);
    this.soundManager.playMagnetActivation();

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

    // Chest drone: magnetize chest toward player after delay
    let magnetTimer: Phaser.Time.TimerEvent | null = null;
    if (this.playerStats.chestDroneDelay >= 0) {
      const magnetDelay = this.playerStats.chestDroneDelay * 1000;
      this.time.delayedCall(magnetDelay, () => {
        if (!chestGraphics.active || this.playerId === -1) return;
        magnetTimer = this.time.addEvent({
          delay: 16,
          callback: () => {
            if (!chestGraphics.active || this.playerId === -1) return;
            const playerX = Transform.x[this.playerId];
            const playerY = Transform.y[this.playerId];
            const dx = playerX - chestGraphics.x;
            const dy = playerY - chestGraphics.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 1) {
              const moveStep = 250 * 0.016;
              chestGraphics.x += (dx / dist) * moveStep;
              chestGraphics.y += (dy / dist) * moveStep;
            }
          },
          loop: true,
        });
      });
    }

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

          // Relic drop: 35% chance from regular chests, 100% from special chests.
          // Caps at 6 relics per run; additional drops convert back to XP.
          const shouldDropRelic = isSpecial || Math.random() < 0.35;
          if (shouldDropRelic) {
            const relic = getRelicManager().rollAndEquipRandomRelic(this.playerStats);
            if (relic) {
              this.syncStatsToPlayer();
              this.toastManager.showToast({
                title: `Relic: ${relic.name}`,
                description: relic.description,
                icon: relic.icon,
                color: getRelicRarityColor(relic.rarity),
                duration: 4500,
              });
              this.refreshRelicStrip();
            }
          }

          // Clean up
          pulseTimer.destroy();
          collectCheck.destroy();
          if (magnetTimer) magnetTimer.destroy();
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
        if (magnetTimer) magnetTimer.destroy();
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
        // Hide ship glow when paused so it doesn't bleed through the overlay
        if (this.playerSpaceship) {
          this.playerSpaceship.getContainer().setVisible(!isPaused);
        }
        // Suspend bloom while paused. The update loop (which sets bloom strength
        // per combo tier) halts when paused, so the last strength would keep
        // blooming the static menu — its box-blur smears a glow/halo over the
        // crisp button text. Restore explicitly on resume (updateGridBackground
        // can't be relied on — it early-returns when grid effects are disabled).
        if (this.bloomPipeline) {
          this.bloomPipeline.setBloomStrength(
            isPaused ? 0 : (COMBO_TIER_BLOOM_STRENGTH[getComboTier()] ?? 0.25)
          );
        }
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
        this.endlessMinibossTimer = 45;   // First miniboss in 45 seconds (faster than old 60)
        this.endlessBossTimer = this.endlessBossIntervalSeconds; // First post-victory boss in 5 min
        this.endlessCycleNumber = 0;
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
    }, this.soundManager);
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
    this.soundManager.playVictoryFanfare();

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
      highestCombo: getHighestCombo(),
    });

    // Evaluate hidden unlocks for victory path too
    this.evaluateHiddenUnlocks(getHighestCombo(), true);

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
  /**
   * Plays a cinematic death sequence before showing the game over screen.
   * Orchestrates hit-stop, slow-mo, particle explosion, and screen effects.
   */
  private playDeathSequence(): void {
    if (this.deathSequenceActive) return;
    this.deathSequenceActive = true;

    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];
    const juiceManager = getJuiceManager();

    // t=0: Hit stop freeze frame on the killing blow
    juiceManager.hitStop(120, 1);

    // t=150: Deep slow-motion + death sound + ship flash
    this.time.delayedCall(150, () => {
      juiceManager.slowMotion(800, 0.15, 300);
      this.soundManager.playGameOver();
      if (this.playerSpaceship) {
        this.playerSpaceship.playDeathFlash(150);
      }
    });

    // t=300: Player explosion + distortion + ripples
    this.time.delayedCall(300, () => {
      if (this.playerSpaceship) {
        this.playerSpaceship.explode();
      }
      this.effectsManager.playPlayerDeathExplosion(playerX, playerY);
      this.distortionPipeline?.addDistortion(playerX, playerY, 300, 0.03, 500);
      this.deathRippleManager.spawnRipple(playerX, playerY);
      this.deathRippleManager.spawnRipple(playerX + 30, playerY);
      this.gridBackground.applyExplosiveForce(8000, playerX, playerY, 900);
    });

    // t=500: Heavy screen shake + impact flash
    this.time.delayedCall(500, () => {
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.shakeCamera(600, 0.04);
      }
      this.effectsManager.playImpactFlash(0.5, 300);
    });

    // t=700: Dark vignette overlay fading in
    this.time.delayedCall(700, () => {
      const darkenOverlay = this.add.rectangle(
        this.scale.width / 2, this.scale.height / 2,
        this.scale.width, this.scale.height,
        0x000000, 0
      ).setDepth(900).setScrollFactor(0);
      this.tweens.add({
        targets: darkenOverlay,
        alpha: 0.85,
        duration: 800,
        ease: 'Quad.easeIn',
      });
    });

    // t=1500: Camera fade to black
    this.time.delayedCall(1500, () => {
      this.cameras.main.fadeOut(700, 0, 0, 0);
    });

    // t=2200: Show game over screen
    this.time.delayedCall(2200, () => {
      this.deathSequenceActive = false;
      this.cameras.main.resetFX();
      this.gameOver();
    });
  }

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

    // Snapshot personal bests BEFORE recordRunEnd mutates them, so the summary
    // screen can compare this run against prior records.
    const lifetimeStatsBeforeUpdate = getAchievementManager().getLifetimeStats();
    const personalBestsSnapshot = {
      longestSurvival: lifetimeStatsBeforeUpdate.longestSurvivalSeconds,
      mostKills: lifetimeStatsBeforeUpdate.mostKillsInRun,
      highestLevel: lifetimeStatsBeforeUpdate.highestLevel,
      highestCombo: lifetimeStatsBeforeUpdate.highestComboInRun,
    };

    const highestComboThisRun = getHighestCombo();

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
        highestCombo: highestComboThisRun,
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

    // Evaluate hidden unlocks and queue toast notifications for each new one.
    // After evaluation runs, compute the top locked-unlock progress entries so
    // the game over screen can surface "closest to unlocking" motivation.
    this.evaluateHiddenUnlocks(highestComboThisRun, this.hasWon);
    const unlockProgressForPanel = getHiddenUnlockManager().getTopProgress({
      run: {
        wasVictory: this.hasWon,
        killCount: this.killCount,
        levelReached: this.playerStats.level,
        survivalTimeSeconds: this.gameTime,
        highestCombo: highestComboThisRun,
        damageTaken: this.totalDamageTaken,
        damageDealt: this.totalDamageDealt,
        weaponIdsUsed: this.weaponManager?.getAllWeapons().map((weapon) => weapon.id) ?? [],
        worldLevel: metaManager.getWorldLevel(),
        noDamageTaken: this.totalDamageTaken === 0,
      },
      lifetime: getAchievementManager().getLifetimeStats(),
    }, 3);

    // Record daily leaderboard entry (only stores if it beats the prior best)
    if (this.dailyModeActive && this.dailyDateString) {
      recordDailyRun(this.dailyChallengeType, this.dailyDateString, {
        survivalSeconds: this.gameTime,
        killCount: this.killCount,
        levelReached: this.playerStats.level,
        wasVictory: this.hasWon,
      });
    }

    this.pauseMenuManager.gameOver({
      killCount: this.killCount,
      gameTime: this.gameTime,
      playerLevel: this.playerStats.level,
      goldEarned,
      previousStreak,
      highestCombo: highestComboThisRun,
      totalDamageDealt: this.totalDamageDealt,
      totalDamageTaken: this.totalDamageTaken,
      weaponStats: this.weaponManager?.getWeaponRunStats() ?? [],
      personalBests: personalBestsSnapshot,
      unlockProgress: unlockProgressForPanel,
    });
  }

  /**
   * Evaluates hidden unlock conditions after a run and fires toast notifications
   * for any newly earned unlocks.
   */
  private evaluateHiddenUnlocks(highestComboValue: number, wasVictory: boolean): void {
    const weaponIdsUsedThisRun = this.weaponManager?.getAllWeapons().map((weapon) => weapon.id) ?? [];
    const lifetimeStats = getAchievementManager().getLifetimeStats();
    // Toast dispatch lives on the onNewUnlock callback registered in create();
    // evaluatePostRun returns the list but we no longer iterate it here.
    getHiddenUnlockManager().evaluatePostRun({
      run: {
        wasVictory,
        killCount: this.killCount,
        levelReached: this.playerStats.level,
        survivalTimeSeconds: this.gameTime,
        highestCombo: highestComboValue,
        damageTaken: this.totalDamageTaken,
        damageDealt: this.totalDamageDealt,
        weaponIdsUsed: weaponIdsUsedThisRun,
        worldLevel: getMetaProgressionManager().getWorldLevel(),
        noDamageTaken: this.totalDamageTaken === 0,
      },
      lifetime: lifetimeStats,
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

    // Create visual - procedural neon spaceship
    this.playerSpaceship = new PlayerSpaceship(this, x, y, {
      baseRadius: 16,
      neonColor: this.getShipNeonColor(),
      quality: this.visualQuality,
    }, this.playerStats.level);
    const playerVisual = this.playerSpaceship.getContainer();
    playerVisual.setDepth(10);
    registerSprite(entityId, playerVisual);

    return entityId;
  }

  private spawnEnemy(typeOverride?: EnemyTypeDefinition): void {
    // Get enemy type:
    //  1) explicit override wins
    //  2) director picks from credit budget (may return null to save credits)
    //  3) fall back to legacy weighted random so we never skip a spawn slot
    let enemyType: EnemyTypeDefinition | null = typeOverride ?? null;
    if (!enemyType) {
      enemyType = pickEnemyFromDirector(this.gameTime, this.worldLevelSpawnReduction, this.worldLevel);
    }
    if (!enemyType) {
      // Director chose to save credits — skip this spawn slot entirely.
      return;
    }
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
    EnemyType.armor[entityId] = getEnemyArmor(enemyType.id);  // Flat damage reduction for tanky types

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
      this.shakeCamera(200, 0.005);
    }

    // Announce miniboss spawn with visual effect
    this.showMinibossWarning(enemyType.name);
  }

  /**
   * Shows a warning when a miniboss spawns. Depth/size matches boss warnings
   * so the alert isn't buried under other HUD elements mid-combat.
   */
  private showMinibossWarning(name: string): void {
    this.soundManager.playBossWarning();
    const warningDepth = PAUSE_MENU_DEPTH - 50;
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    // Red screen-edge vignette pulse to draw attention
    const edgeVignette = this.add.rectangle(
      centerX, centerY, this.scale.width, this.scale.height, 0xff3333, 0
    ).setScrollFactor(0).setDepth(warningDepth - 1);
    this.tweens.add({
      targets: edgeVignette,
      alpha: { from: 0, to: 0.22 },
      duration: 250,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => edgeVignette.destroy(),
    });

    const warningText = this.add.text(centerX, centerY - 50, `⚠ ${name.toUpperCase()} ⚠`, {
      fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
      fontSize: '32px',
      fontStyle: 'bold',
      color: '#ff6644',
      stroke: '#000000',
      strokeThickness: 5,
      align: 'center',
    });
    warningText.setOrigin(0.5);
    warningText.setDepth(warningDepth);
    warningText.setScrollFactor(0);
    warningText.setAlpha(0);

    // Punchy entrance, hold, then fade
    this.tweens.add({
      targets: warningText,
      alpha: 1,
      scale: { from: 0.6, to: 1 },
      duration: 220,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(1800, () => {
          if (warningText.scene) {
            this.tweens.add({
              targets: warningText,
              alpha: 0,
              y: centerY - 110,
              duration: 500,
              ease: 'Sine.easeOut',
              onComplete: () => warningText.destroy(),
            });
          }
        });
      },
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
        fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
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
        fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
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

    }

    // Periodic rumble shakes in last 10 seconds before boss
    if (this.bossWarningPhase >= 2 && !this.bossSpawned) {
      const timeRemaining = Math.max(0, Math.ceil(this.bossSpawnTime - this.gameTime));
      if (timeRemaining <= 10) {
        if (Math.abs(Math.sin(this.gameTime * 1.5)) < 0.05) {
          getJuiceManager().screenShake(0.003, 150);
        }
      }
    }

    // Phase 3: "BOSS INCOMING" at bossSpawnTime - 5
    if (this.bossWarningPhase < 3 && this.gameTime >= this.bossSpawnTime - 5) {
      this.bossWarningPhase = 3;
      this.soundManager.playBossWarning();
      getJuiceManager().screenShake(0.008, 400);
      getJuiceManager().impactFlash(0.15, 100);
      // Grid distortion pulse from screen center
      this.gridBackground.applyExplosiveForce(2000, screenCenterX, screenCenterY, 400);
      // Screen distortion shockwave
      this.distortionPipeline?.addDistortion(screenCenterX, screenCenterY, 300, 0.02, 350);

      // Destroy any existing warning text before creating new one
      if (this.bossWarningText) {
        this.bossWarningText.destroy();
      }

      this.bossWarningText = this.add.text(screenCenterX, screenCenterY, 'BOSS INCOMING', {
        fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
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

    }
  }

  /**
   * Shows a centered banner displaying active run modifiers at game start.
   * Each modifier shows its name, description, and category with color coding.
   */
  private showModifierBanner(): void {
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    const bannerElements: Phaser.GameObjects.GameObject[] = [];

    const categoryColors: Record<string, string> = {
      offense: '#ff6644',
      defense: '#44aaff',
      resources: '#ffcc22',
      chaos: '#aa44ff',
    };

    const categoryLabels: Record<string, string> = {
      offense: 'OFFENSE',
      defense: 'DEFENSE',
      resources: 'RESOURCES',
      chaos: 'CHAOS',
    };

    // Semi-transparent backdrop
    const backdrop = this.add.rectangle(centerX, centerY, this.scale.width, this.scale.height, 0x000000, 0.6);
    backdrop.setScrollFactor(0).setDepth(1990);
    bannerElements.push(backdrop);

    // Title
    const title = this.add.text(centerX, centerY - 120, 'RUN MODIFIERS', {
      fontSize: '24px',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      color: '#888888',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1991).setAlpha(0);
    bannerElements.push(title);

    // Modifier cards
    const cardSpacing = 100;
    const totalHeight = (this.activeModifiers.length - 1) * cardSpacing;
    const startY = centerY - totalHeight / 2;

    for (let modifierIndex = 0; modifierIndex < this.activeModifiers.length; modifierIndex++) {
      const modifier = this.activeModifiers[modifierIndex];
      const cardY = startY + modifierIndex * cardSpacing;
      const categoryColor = categoryColors[modifier.category] ?? '#ffffff';
      const categoryLabel = categoryLabels[modifier.category] ?? modifier.category.toUpperCase();

      // Category tag
      const tag = this.add.text(centerX, cardY - 18, categoryLabel, {
        fontSize: '11px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: categoryColor,
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1991).setAlpha(0);
      bannerElements.push(tag);

      // Modifier name
      const nameText = this.add.text(centerX, cardY + 2, modifier.name, {
        fontSize: '22px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1991).setAlpha(0);
      bannerElements.push(nameText);

      // Description with effects breakdown
      const descText = this.add.text(centerX, cardY + 28, modifier.description, {
        fontSize: '16px',
        fontFamily: 'Arial',
        color: '#cccccc',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1991).setAlpha(0);
      bannerElements.push(descText);

      // Decorative line under each card
      const lineGraphics = this.add.graphics();
      lineGraphics.setScrollFactor(0).setDepth(1991).setAlpha(0);
      const lineColor = parseInt(categoryColor.replace('#', ''), 16);
      lineGraphics.lineStyle(1, lineColor, 0.4);
      lineGraphics.lineBetween(centerX - 140, cardY + 48, centerX + 140, cardY + 48);
      bannerElements.push(lineGraphics);
    }

    // Fade in all elements
    for (const element of bannerElements) {
      if (element === backdrop) continue;
      this.tweens.add({
        targets: element,
        alpha: 1,
        duration: 400,
        delay: 200,
        ease: 'Cubic.easeOut',
      });
    }

    // Fade out everything after display
    this.time.delayedCall(3000, () => {
      for (const element of bannerElements) {
        this.tweens.add({
          targets: element,
          alpha: 0,
          duration: 500,
          onComplete: () => element.destroy(),
        });
      }
    });
  }

  /**
   * First-run coach-mark overlay. Shows a sequence of brief "card" tips
   * covering core controls. Each card advances on tap/click/enter, or
   * auto-advances after a timeout. Marks the tutorial as seen on completion.
   */
  private showFirstRunCoachMarks(): void {
    // Mark tutorial seen as soon as the overlay appears — if the player dies
    // or restarts mid-tutorial, we don't want to replay forever.
    getSettingsManager().setTutorialSeen(true);

    const isTouchDevice = this.input.manager.touch !== null && this.sys.game.device.input.touch;
    type Card = { title: string; body: string; icon: string };
    const cards: Card[] = [
      {
        title: 'MOVE',
        body: isTouchDevice ? 'Tap and drag anywhere to move. Survive the swarm.' : 'WASD or arrows to move. Mouse to aim cursor weapons.',
        icon: 'run',
      },
      {
        title: 'DASH',
        body: isTouchDevice ? 'Tap the dash button (bottom-right) for a quick blink through enemies.' : 'Shift to dash — a short burst that avoids damage.',
        icon: 'wind',
      },
      {
        title: 'COLLECT XP',
        body: 'Grab gems to level up. Every 5th level lets you pick a new weapon.',
        icon: 'gem',
      },
      {
        title: 'COMBOS',
        body: 'Chain kills to build combo. Thresholds at 25/50/100 unlock XP bursts, damage, and screen-clearing blasts.',
        icon: 'lightning',
      },
      {
        title: 'PAUSE',
        body: isTouchDevice ? 'Tap the pause button (top-right) anytime. Settings, shop, and run info live there.' : 'Escape or P to pause. Restart, settings, and shop live in the pause menu.',
        icon: 'clock',
      },
    ];

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    const coachDepth = PAUSE_MENU_DEPTH - 60;
    let cardIndex = 0;
    let currentElements: Phaser.GameObjects.GameObject[] = [];
    let autoAdvanceTimer: Phaser.Time.TimerEvent | null = null;
    let keyHandler: ((event: KeyboardEvent) => void) | null = null;
    let pointerHandler: (() => void) | null = null;

    const cleanup = () => {
      if (autoAdvanceTimer) { autoAdvanceTimer.destroy(); autoAdvanceTimer = null; }
      if (keyHandler) { this.input.keyboard?.off('keydown', keyHandler); keyHandler = null; }
      if (pointerHandler) { this.input.off('pointerdown', pointerHandler); pointerHandler = null; }
      for (const element of currentElements) {
        if (element && (element as Phaser.GameObjects.GameObject).active) element.destroy();
      }
      currentElements = [];
      this.coachMarksCleanup = null;
    };
    this.coachMarksCleanup = cleanup;

    const renderCard = (index: number) => {
      // Clear any current card elements first
      for (const element of currentElements) {
        if (element && (element as Phaser.GameObjects.GameObject).active) element.destroy();
      }
      currentElements = [];

      const card = cards[index];

      const dim = this.add.rectangle(centerX, centerY, this.scale.width, this.scale.height, 0x000000, 0.55)
        .setScrollFactor(0).setDepth(coachDepth);
      currentElements.push(dim);

      const panelWidth = Math.min(480, this.scale.width - 80);
      const panelHeight = 210;
      const panel = this.add.rectangle(centerX, centerY, panelWidth, panelHeight, 0x1a1a2e, 0.96)
        .setScrollFactor(0).setDepth(coachDepth + 1).setStrokeStyle(2, 0x5588ff);
      currentElements.push(panel);

      const iconSprite = createIcon(this, {
        x: centerX - panelWidth / 2 + 48,
        y: centerY - 38,
        iconKey: card.icon,
        size: 56,
        tint: 0x88ccff,
      });
      iconSprite.setScrollFactor(0).setDepth(coachDepth + 2);
      currentElements.push(iconSprite);

      const titleText = this.add.text(centerX - panelWidth / 2 + 90, centerY - 62, card.title, {
        fontSize: '28px',
        color: '#88ccff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      }).setOrigin(0, 0).setScrollFactor(0).setDepth(coachDepth + 2);
      currentElements.push(titleText);

      const bodyText = this.add.text(centerX, centerY + 4, card.body, {
        fontSize: '17px',
        color: '#dddddd',
        fontFamily: 'Arial',
        align: 'center',
        wordWrap: { width: panelWidth - 40 },
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(coachDepth + 2);
      currentElements.push(bodyText);

      const progressText = this.add.text(centerX, centerY + panelHeight / 2 - 30, `${index + 1} / ${cards.length}`, {
        fontSize: '13px',
        color: '#888899',
        fontFamily: 'Arial',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(coachDepth + 2);
      currentElements.push(progressText);

      const hint = isTouchDevice ? 'Tap anywhere to continue' : 'Click or press SPACE to continue  ·  ESC to skip';
      const hintText = this.add.text(centerX, centerY + panelHeight / 2 - 10, hint, {
        fontSize: '12px',
        color: '#667788',
        fontFamily: 'Arial',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(coachDepth + 2);
      currentElements.push(hintText);

      // Fade in panel contents
      for (const element of currentElements) {
        if (element === dim) continue;
        (element as unknown as { setAlpha: (a: number) => void }).setAlpha(0);
        this.tweens.add({ targets: element, alpha: 1, duration: 150, ease: 'Sine.easeOut' });
      }
    };

    const advance = () => {
      cardIndex++;
      if (cardIndex >= cards.length) {
        cleanup();
        return;
      }
      // Reset auto-advance timer for the new card
      if (autoAdvanceTimer) { autoAdvanceTimer.destroy(); }
      autoAdvanceTimer = this.time.delayedCall(6000, () => advance());
      renderCard(cardIndex);
    };

    const skipAll = () => {
      cleanup();
    };

    keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        skipAll();
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        advance();
      }
    };
    this.input.keyboard?.on('keydown', keyHandler);

    pointerHandler = () => advance();
    this.input.on('pointerdown', pointerHandler);

    // Kick off
    renderCard(cardIndex);
    autoAdvanceTimer = this.time.delayedCall(6000, () => advance());
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
    if (this.bossCountdownText) {
      this.bossCountdownText.destroy();
      this.bossCountdownText = null;
    }
  }

  /**
   * Handles combo threshold rewards (XP burst, damage boost, annihilation pulse).
   */
  private handleComboThreshold(threshold: { count: number; type: string }): void {
    if (!this.toastManager) return;
    const comboPlayerX = Transform.x[this.playerId];
    const comboPlayerY = Transform.y[this.playerId];

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
      this.soundManager.playComboThreshold();
      getJuiceManager().impactFlash(0.25, 100);
      // Death ripple cascade from the kill position
      this.deathRippleManager.spawnRipple(comboPlayerX, comboPlayerY);
      // Screen-wide cyan tint flash
      this.cameras.main.flash(250, 0, 200, 255);
      // Bigger text with scale-up
      this.showComboText('HOT STREAK!', '#00ddff', comboPlayerX, comboPlayerY, 34, 1.6);
    } else if (threshold.type === 'damage_boost') {
      // Damage buff is managed by ComboSystem's activeThresholdEffects
      getJuiceManager().hitStop(50, 0.85);
      getJuiceManager().impactFlash(0.35, 120);
      this.toastManager.showToast({
        title: `COMBO x${threshold.count}`,
        description: 'Power Surge! +50% damage',
        icon: 'sword',
        color: 0xff8844,
        duration: 3000,
      });
      this.soundManager.playComboThreshold();
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.shakeCamera(200, 0.015);
      }
      // Orange particle burst at player position for power surge feel
      this.effectsManager.playDeathBurst(comboPlayerX, comboPlayerY, 0xff8844);
      // Screen distortion shockwave
      this.distortionPipeline?.addDistortion(comboPlayerX, comboPlayerY, 280, 0.025, 400);
      // Chromatic aberration spike via grid combat intensity
      this.gridBackground.setCombatIntensity(1.0);
      // Grid shockwave from player position
      this.gridBackground.applyExplosiveForce(4000, comboPlayerX, comboPlayerY, 600);
      // Brief slow-motion: drop to 30% speed for 200ms then restore
      this.tweens.timeScale = 0.3;
      this.time.delayedCall(200, () => {
        this.tweens.timeScale = 1.0;
      });
      // Orange flash
      this.cameras.main.flash(200, 255, 136, 0);
      // Bigger orange text with scale-up animation
      this.showComboText('POWER SURGE!', '#ff8844', comboPlayerX, comboPlayerY, 38, 1.8);
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
          }
        }
      }
      getJuiceManager().hitStop(80, 0.95);
      this.toastManager.showToast({
        title: `COMBO x${threshold.count}`,
        description: 'ANNIHILATION!',
        icon: 'explosion',
        color: 0xff2244,
        duration: 3000,
      });
      this.soundManager.playComboThreshold();
      // Cinematic slow-motion with camera zoom
      getJuiceManager().slowMotion(500, 0.2, 300);
      // Massive radial shockwave from player position
      this.deathRippleManager.spawnRipple(comboPlayerX, comboPlayerY);
      this.deathRippleManager.spawnRipple(comboPlayerX + 30, comboPlayerY);
      this.deathRippleManager.spawnRipple(comboPlayerX - 30, comboPlayerY);
      // Multi-wave screen distortion
      this.distortionPipeline?.addDistortion(comboPlayerX, comboPlayerY, 350, 0.035, 450);
      this.time.delayedCall(100, () => {
        this.distortionPipeline?.addDistortion(comboPlayerX, comboPlayerY, 500, 0.025, 400);
      });
      this.time.delayedCall(250, () => {
        this.distortionPipeline?.addDistortion(comboPlayerX, comboPlayerY, 650, 0.015, 350);
      });
      // Grid shockwave
      this.gridBackground.applyExplosiveForce(6000, comboPlayerX, comboPlayerY, 800);
      this.gridBackground.setCombatIntensity(1.0);
      // White camera flash
      this.cameras.main.flash(500, 255, 255, 255);
      // Multi-wave screen shake for cascading impact
      if (getSettingsManager().isScreenShakeEnabled()) {
        this.shakeCamera(200, 0.035);
        this.time.delayedCall(150, () => {
          this.shakeCamera(200, 0.025);
        });
        this.time.delayedCall(300, () => {
          this.shakeCamera(200, 0.015);
        });
      }
      this.effectsManager.playImpactFlash(0.4, 150);
      this.effectsManager.playGoldSparkle(comboPlayerX, comboPlayerY, 15);
      // Delayed secondary sparkle bursts for cascading effect
      this.time.delayedCall(150, () => {
        this.effectsManager.playGoldSparkle(comboPlayerX + 40, comboPlayerY - 20, 8);
        this.effectsManager.playGoldSparkle(comboPlayerX - 40, comboPlayerY + 20, 8);
      });
      // Biggest text — starts red, with gold stroke for the red-to-gold feel
      this.showComboText('ANNIHILATION!', '#ff2244', comboPlayerX, comboPlayerY, 48, 2.2);
      // Delayed gold echo text for the color shift effect
      this.time.delayedCall(200, () => {
        this.showComboText('ANNIHILATION!', '#ffcc00', comboPlayerX, comboPlayerY, 44, 1.8);
      });
    }
  }

  /**
   * Handles combo tier transitions with scaled juice effects.
   * Separate from threshold rewards — fires when tier changes (e.g. none→warm).
   */
  /**
   * Shake the main camera, scaled by the player's screen-shake intensity
   * setting (0–1). All gameplay shakes route through here so the
   * accessibility slider applies globally; zero intensity becomes a no-op.
   */
  private shakeCamera(duration: number, intensity: number): void {
    const shakeScale = getSettingsManager().getScreenShakeIntensity();
    if (shakeScale <= 0) return;
    this.cameras.main.shake(duration, intensity * shakeScale);
  }

  private handleComboTierChange(tier: ComboTier): void {
    const tierJuiceConfig: Record<string, { shakeIntensity: number; shakeDuration: number; flashIntensity: number; flashDuration: number }> = {
      warm:    { shakeIntensity: 0.003, shakeDuration: 100, flashIntensity: 0.08, flashDuration: 50 },
      hot:     { shakeIntensity: 0.006, shakeDuration: 150, flashIntensity: 0.15, flashDuration: 70 },
      blazing: { shakeIntensity: 0.010, shakeDuration: 200, flashIntensity: 0.22, flashDuration: 90 },
      inferno: { shakeIntensity: 0.015, shakeDuration: 300, flashIntensity: 0.30, flashDuration: 120 },
    };
    const config = tierJuiceConfig[tier];
    if (!config) return;

    const juiceManager = getJuiceManager();
    juiceManager.screenShake(config.shakeIntensity, config.shakeDuration);
    juiceManager.impactFlash(config.flashIntensity, config.flashDuration);

    // Audio stinger for tier-up
    if (tier !== 'none') {
      this.soundManager.playComboTierUp(tier as 'warm' | 'hot' | 'blazing' | 'inferno');

      // Particle burst at player position with tier color
      const tierColors: Record<string, number> = {
        warm: 0xffdd44, hot: 0x00ddff, blazing: 0xff6622, inferno: 0xff2244,
      };
      const tierColor = tierColors[tier] ?? 0xffffff;
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      this.effectsManager.playDeathBurst(playerX, playerY, tierColor);

      // Brief freeze-frame for "moment of power"
      juiceManager.hitStop(40, 0.7);
    }
  }

  /**
   * Shows a dramatic combo milestone text popup at the player position.
   */
  private showComboText(
    text: string,
    color: string,
    positionX: number,
    positionY: number,
    fontSize: number = 26,
    finalScale: number = 1.3,
  ): void {
    const comboText = this.add.text(positionX, positionY - 50, text, {
      fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
      fontSize: `${fontSize}px`,
      color,
      stroke: '#000000',
      strokeThickness: 4,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(1500).setScale(0.5);

    this.tweens.add({
      targets: comboText,
      scale: finalScale,
      y: positionY - 90,
      duration: 300,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: comboText,
          alpha: 0,
          y: positionY - 110,
          duration: 500,
          ease: 'Quad.easeIn',
          onComplete: () => comboText.destroy(),
        });
      },
    });
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
        // Instant: magnetize all gems and health pickups
        magnetizeAllGems(this.world);
        magnetizeAllHealthPickups(this.world);
        this.soundManager.playMagnetActivation();
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

      case 'shrine_bargain':
        // Rolls one of three permanent-for-the-rest-of-this-run trade-offs.
        // Picked randomly to keep event surface small — the design intent is
        // to force a build-shaping decision *mid-run* that pure +stat picks
        // can't replicate.
        this.applyShrineBargain();
        break;
    }
  }

  /**
   * Fires a Shrine of Sacrifice bargain: rolls one of three trade-offs, applies
   * it immediately, and surfaces the specific deal via a toast so the player
   * can see what changed. Deals are permanent for the remainder of the run.
   */
  private applyShrineBargain(): void {
    const availableDeals: {
      id: string;
      title: string;
      detail: string;
      apply: () => void;
    }[] = [
      {
        id: 'blood_pact',
        title: 'Blood Pact',
        detail: 'HP halved, damage doubled',
        apply: () => {
          const halvedCurrent = Math.max(1, Math.floor(this.playerStats.currentHealth / 2));
          this.playerStats.currentHealth = halvedCurrent;
          this.playerStats.maxHealth = Math.max(halvedCurrent, Math.floor(this.playerStats.maxHealth / 2));
          this.playerStats.damageMultiplier *= 2;
        },
      },
      {
        id: 'frenzy',
        title: 'Frenzy Ritual',
        detail: '+60% attack speed, -25% move speed',
        apply: () => {
          this.playerStats.attackSpeedMultiplier *= 1.6;
          this.playerStats.moveSpeed = Math.max(60, this.playerStats.moveSpeed * 0.75);
        },
      },
      {
        id: 'relic_vow',
        title: 'Relic Vow',
        detail: 'Damage reduced 25%, two relics granted',
        apply: () => {
          this.playerStats.damageMultiplier *= 0.75;
          const relicManager = getRelicManager();
          const firstRelic = relicManager.rollAndEquipRandomRelic(this.playerStats);
          const secondRelic = relicManager.rollAndEquipRandomRelic(this.playerStats);
          const relicsGranted = [firstRelic, secondRelic].filter((relic) => relic !== null);
          if (relicsGranted.length > 0) {
            this.refreshRelicStrip();
          }
        },
      },
    ];

    const pickedDeal = availableDeals[Math.floor(Math.random() * availableDeals.length)];
    pickedDeal.apply();
    this.syncStatsToPlayer();

    // Surface exactly which deal fired so the player knows what changed.
    this.toastManager.showToast({
      title: pickedDeal.title,
      description: pickedDeal.detail,
      icon: 'star',
      color: 0xcc44ff,
      duration: 4000,
    });
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
      this.shakeCamera(400, 0.01);
    }

    // Show boss entrance
    this.showBossEntrance(enemyType.name);

    // Activate boss arena atmosphere
    activateBossArena(typeId);
    this.activeBossType = typeId;
    this.bossHazardTimer = 0;
  }

  /**
   * Spawns boss-specific hazard zones during boss fights.
   * Each boss type creates different hazard patterns.
   */
  private spawnBossHazard(): void {
    if (!this.activeBossType) return;

    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    switch (this.activeBossType) {
      case 'horde_king':
        // Burn zones at random positions — fire lord scorches the arena
        spawnHazardZone(
          100 + Math.random() * (screenWidth - 200),
          100 + Math.random() * (screenHeight - 200),
          80, 'burn', 6
        );
        this.bossHazardTimer = 4;
        break;

      case 'void_wyrm':
        // Void rifts near player — pulls enemies into gravity wells
        if (this.playerId !== -1) {
          const offsetX = (Math.random() - 0.5) * 300;
          const offsetY = (Math.random() - 0.5) * 300;
          spawnHazardZone(
            Transform.x[this.playerId] + offsetX,
            Transform.y[this.playerId] + offsetY,
            100, 'void', 8
          );
        }
        this.bossHazardTimer = 5;
        break;

      case 'the_machine':
        // Ice patches + energy wells — mechanical precision
        spawnHazardZone(
          100 + Math.random() * (screenWidth - 200),
          100 + Math.random() * (screenHeight - 200),
          70, 'ice', 8
        );
        // Occasional energy well (player buff zone)
        if (Math.random() < 0.4) {
          spawnHazardZone(
            100 + Math.random() * (screenWidth - 200),
            100 + Math.random() * (screenHeight - 200),
            60, 'energy', 10
          );
        }
        this.bossHazardTimer = 6;
        break;

      default:
        this.bossHazardTimer = 5;
        break;
    }
  }

  /**
   * Shows dramatic boss entrance warning.
   */
  private showBossEntrance(name: string): void {
    const bossJuice = getJuiceManager();

    // Hit stop for dramatic pause at spawn moment
    bossJuice.hitStop(60, 0.9);
    bossJuice.impactFlash(0.35, 120);
    bossJuice.screenShake(0.012, 400);


    // Grid distortion pulse from spawn point (top center)
    this.gridBackground.applyExplosiveForce(3000, this.scale.width / 2, 0, 500);

    // Darken screen briefly
    const overlay = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0.6);
    overlay.setDepth(90);

    // Warning text — slam in from above with scale overshoot
    const warningText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 80, 'BOSS BATTLE', {
      fontSize: '32px',
      color: '#ff0000',
      fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    warningText.setOrigin(0.5).setDepth(100).setScale(2.5).setAlpha(0);

    const nameText = this.add.text(this.scale.width / 2, this.scale.height / 2, name, {
      fontSize: '48px',
      color: '#ffcc00',
      fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    nameText.setOrigin(0.5).setDepth(100).setScale(0).setAlpha(0);

    // "BOSS BATTLE" slams in from large scale
    this.tweens.add({
      targets: warningText,
      scale: 1,
      alpha: 1,
      duration: 300,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Then boss name scales up
        this.tweens.add({
          targets: nameText,
          scale: 1,
          alpha: 1,
          duration: 400,
          ease: 'Back.easeOut',
        });
        // Both fade out after hold
        this.time.delayedCall(2500, () => {
          this.tweens.add({
            targets: [warningText, nameText],
            alpha: 0,
            duration: 500,
            ease: 'Sine.easeOut',
            onComplete: () => {
              warningText.destroy();
              nameText.destroy();
            },
          });
        });
      },
    });

    this.tweens.add({
      targets: overlay,
      alpha: 0,
      duration: 2500,
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

    // Miniboss cadence: starts at 45s, tightens by 5s per cycle (floor 20s).
    const minibossIntervalSeconds = Math.max(20, 45 - this.endlessCycleNumber * 5);
    if (this.endlessMinibossTimer <= 0) {
      this.endlessMinibossTimer = minibossIntervalSeconds;
      this.spawnRandomMiniboss();
      // Cycle 2+: spawn a second miniboss after a short delay for density.
      if (this.endlessCycleNumber >= 2) {
        this.time.delayedCall(3000, () => this.spawnRandomMiniboss());
      }
    }

    // Boss waves: interval shortens each cycle (5min → 4min → 3min → 2min floor).
    if (this.endlessBossTimer <= 0) {
      this.endlessCycleNumber += 1;
      // Each cycle tightens the next interval by 45s (minimum 120s = 2 min).
      this.endlessBossIntervalSeconds = Math.max(120, 300 - this.endlessCycleNumber * 45);
      this.endlessBossTimer = this.endlessBossIntervalSeconds;

      // Ramp world-level-style multipliers per cycle so each wave hits harder.
      this.worldLevelHealthMult *= 1.25;
      this.worldLevelDamageMult *= 1.15;
      this.worldLevelXPMult *= 1.10;

      this.showEndlessCycleBanner(this.endlessCycleNumber);

      // Boss wave composition escalates:
      //   cycle 1: +1 miniboss + boss
      //   cycle 2: +2 minibosses + boss
      //   cycle 3+: +3 minibosses + TWO bosses back-to-back
      const minibossCountPerWave = Math.min(3, 1 + this.endlessCycleNumber);
      for (let spawnIndex = 0; spawnIndex < minibossCountPerWave; spawnIndex++) {
        this.time.delayedCall(spawnIndex * 1500, () => this.spawnRandomMiniboss());
      }

      this.time.delayedCall(2500, () => this.spawnNextBoss());
      if (this.endlessCycleNumber >= 3) {
        this.time.delayedCall(7000, () => this.spawnNextBoss());
      }
    }
  }

  /**
   * Displays a large "CYCLE N — escalated" banner when a new endless wave starts.
   * Gives the player a clear landmark for their post-victory progression.
   */
  private showEndlessCycleBanner(cycleNumber: number): void {
    const bannerDepth = 1200;
    const bannerText = this.add.text(
      this.scale.width / 2,
      this.scale.height / 4,
      `CYCLE ${cycleNumber}\nESCALATION`,
      {
        fontSize: '48px',
        color: cycleNumber >= 3 ? '#ff3366' : '#ffaa44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        align: 'center',
        stroke: '#000000',
        strokeThickness: 5,
      }
    );
    bannerText.setOrigin(0.5);
    bannerText.setDepth(bannerDepth);
    bannerText.setScrollFactor(0);
    bannerText.setAlpha(0);

    this.tweens.add({
      targets: bannerText,
      alpha: 1,
      scale: 1.1,
      duration: 400,
      yoyo: true,
      hold: 1200,
      ease: 'Sine.easeOut',
      onComplete: () => bannerText.destroy(),
    });

    if (getSettingsManager().isScreenShakeEnabled()) {
      this.shakeCamera(400, 0.015);
    }
    this.effectsManager.playImpactFlash(0.18, 220);
    this.soundManager.playSynergyActivation();
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

        // Knockback from slam (skipped when Juggernaut ship's immunity is active)
        if (!this.playerStats.knockbackImmunity) {
          const knockbackDir = Math.atan2(playerY - y, playerX - x);
          Knockback.velocityX[this.playerId] = Math.cos(knockbackDir) * 400;
          Knockback.velocityY[this.playerId] = Math.sin(knockbackDir) * 400;
        }
      }
    }

    // Screen shake
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.shakeCamera(200, 0.02);
    }
  }

  /**
   * Fire a cinematic moment when a boss crosses a phase boundary (66% / 33% HP).
   * Triggers: heavy screen shake, impact flash, slow-mo hit-stop, expanding shockwave
   * ring centered on the boss, and a "PHASE N" floating text banner.
   */
  private handleBossPhaseTransition(bossId: number, newPhase: number): void {
    const bossX = Transform.x[bossId];
    const bossY = Transform.y[bossId];

    // Hit-stop feel
    getJuiceManager().hitStop(100, 0.2);
    getJuiceManager().slowMotion(450, 0.45, 250);

    // Heavy screen shake + chromatic flash
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.shakeCamera(260, 0.018);
    }
    this.effectsManager.playImpactFlash(0.22, 180);

    // Phase-gated arena hazards: phase 2 drops one hazard near the boss,
    // phase 3 drops two plus a ring of hazards at cardinal offsets. This
    // forces repositioning instead of simple circle-strafing and gives the
    // boss fights mechanical texture beyond raw HP + projectile patterns.
    this.spawnBossPhaseHazards(bossX, bossY, newPhase);

    // Expanding shockwave ring at boss position
    const transitionRing = this.add.circle(bossX, bossY, 40, 0xff3388, 0);
    transitionRing.setStrokeStyle(5, 0xffaa44);
    transitionRing.setDepth(20);
    this.tweens.add({
      targets: transitionRing,
      scaleX: 10,
      scaleY: 10,
      alpha: 0,
      duration: 600,
      ease: 'Cubic.easeOut',
      onComplete: () => transitionRing.destroy(),
    });

    // Phase banner
    const phaseBannerText = this.add.text(
      this.scale.width / 2,
      this.scale.height / 3,
      `PHASE ${newPhase}`,
      {
        fontSize: '64px',
        color: newPhase === 3 ? '#ff3366' : '#ffaa44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
      }
    );
    phaseBannerText.setOrigin(0.5);
    phaseBannerText.setDepth(1200);
    phaseBannerText.setScrollFactor(0);
    phaseBannerText.setAlpha(0);

    this.tweens.add({
      targets: phaseBannerText,
      alpha: 1,
      scale: 1.2,
      duration: 200,
      yoyo: true,
      hold: 400,
      ease: 'Sine.easeOut',
      onComplete: () => phaseBannerText.destroy(),
    });

    this.soundManager.playSynergyActivation();
  }

  /**
   * Spawns arena hazards on boss phase transitions. Phase 2 drops a single
   * hazard near the boss; phase 3 drops three spaced around the arena so the
   * player has to manage positioning through the final-stand pressure.
   *
   * Hazard type rotates (burn for phase 2, void for phase 3) to give each
   * phase a distinct mechanical feel.
   */
  private spawnBossPhaseHazards(bossX: number, bossY: number, phase: number): void {
    if (phase < 2) return;

    const arenaMargin = 120;
    const minX = arenaMargin;
    const maxX = this.scale.width - arenaMargin;
    const minY = arenaMargin;
    const maxY = this.scale.height - arenaMargin;

    if (phase === 2) {
      // One burn pool near the boss telegraphs escalating pressure.
      const offsetAngle = Math.random() * Math.PI * 2;
      const offsetDistance = 140;
      const hazardX = Math.max(minX, Math.min(maxX, bossX + Math.cos(offsetAngle) * offsetDistance));
      const hazardY = Math.max(minY, Math.min(maxY, bossY + Math.sin(offsetAngle) * offsetDistance));
      spawnHazardZone(hazardX, hazardY, 110, 'burn', 12);
    } else {
      // Phase 3: triangle of void pools across the arena forces the player
      // through narrower safe lanes.
      const ringRadius = 260;
      for (let offsetIndex = 0; offsetIndex < 3; offsetIndex++) {
        const ringAngle = (offsetIndex / 3) * Math.PI * 2 + Math.random() * 0.5;
        const hazardX = Math.max(minX, Math.min(maxX, bossX + Math.cos(ringAngle) * ringRadius));
        const hazardY = Math.max(minY, Math.min(maxY, bossY + Math.sin(ringAngle) * ringRadius));
        spawnHazardZone(hazardX, hazardY, 130, 'void', 15);
      }
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

          // Screen shake on laser hit
          if (getSettingsManager().isScreenShakeEnabled()) {
            this.shakeCamera(150, 0.008);
          }
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

    // Create custom enemy visual using cached texture system (batches in WebGL)
    const container = createCachedEnemyVisual(
      this,
      x, y,
      enemyType.id,
      baseSize,
      enemyType.shape,
      neonColor,
      this.visualQuality,
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

      // Trigger ship visual level-up (may trigger evolution)
      if (this.playerSpaceship) {
        const evolutionResult = this.playerSpaceship.onLevelUp(this.playerStats.level);
        if (evolutionResult.evolved) {
          // Extra celebration for ship evolution
          const evolveX = Transform.x[this.playerId];
          const evolveY = Transform.y[this.playerId];
          const juiceManager = getJuiceManager();
          juiceManager.impactFlash(0.4, 180);
          juiceManager.screenShake(0.006, 300);
          this.effectsManager.playGoldSparkle(evolveX, evolveY, 12);
          this.effectsManager.playGoldSparkle(evolveX - 20, evolveY - 15, 6);
          this.effectsManager.playGoldSparkle(evolveX + 20, evolveY + 15, 6);
          this.toastManager.showToast({
            title: 'Ship Evolved!',
            description: `${evolutionResult.tierName} form achieved`,
            icon: 'star',
            color: 0x44ffff,
            duration: 3000,
          });
        }
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

    // Level-up celebration effects
    const juiceManager = getJuiceManager();
    juiceManager.impactFlash(0.25, 100);
    const levelUpPlayerX = Transform.x[this.playerId];
    const levelUpPlayerY = Transform.y[this.playerId];
    this.effectsManager.playGoldSparkle(levelUpPlayerX, levelUpPlayerY, 6);

    // "LEVEL UP" text burst
    const levelUpText = this.add.text(levelUpPlayerX, levelUpPlayerY - 40, 'LEVEL UP', {
      fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
      fontSize: '22px',
      color: '#44ddff',
      stroke: '#000000',
      strokeThickness: 3,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(1500).setScale(0.3);
    this.tweens.add({
      targets: levelUpText,
      scale: 1.2,
      y: levelUpPlayerY - 70,
      duration: 300,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: levelUpText,
          alpha: 0,
          y: levelUpPlayerY - 90,
          duration: 400,
          ease: 'Quad.easeIn',
          onComplete: () => levelUpText.destroy(),
        });
      },
    });

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
      // Break gate and milestone data
      allStatUpgrades: this.upgrades,
      playerLevel: this.playerStats.level,
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
    const evolutionResult = this.weaponManager.checkEvolutions(statUpgrades, this.evolutionLevelReduction);
    if (evolutionResult && this.toastManager) {
      const evolvePlayerX = Transform.x[this.playerId];
      const evolvePlayerY = Transform.y[this.playerId];

      // --- Dramatic evolution visual overhaul ---
      this.soundManager.playWeaponEvolution();

      // 1. Freeze-frame: near-pause for dramatic weight
      this.tweens.timeScale = 0.05;
      this.time.delayedCall(500, () => {
        this.tweens.timeScale = 1.0;
      });

      // 2. Bright white camera flash
      this.cameras.main.flash(400, 255, 255, 200);

      // 3. Screen shake for impact
      this.shakeCamera(400, 0.02);

      // 4. Shockwave ripple from player position
      this.deathRippleManager.spawnRipple(evolvePlayerX, evolvePlayerY);

      // 5. Generous gold sparkle burst around player
      this.effectsManager.playGoldSparkle(evolvePlayerX, evolvePlayerY, 10);
      this.effectsManager.playGoldSparkle(evolvePlayerX - 20, evolvePlayerY - 15, 6);
      this.effectsManager.playGoldSparkle(evolvePlayerX + 20, evolvePlayerY + 15, 6);
      this.effectsManager.playGoldSparkle(evolvePlayerX - 15, evolvePlayerY + 20, 6);
      this.effectsManager.playGoldSparkle(evolvePlayerX + 15, evolvePlayerY - 20, 6);

      // 6. Big "WEAPON EVOLVED!" announcement text
      const evolvedAnnouncementText = this.add.text(
        this.cameras.main.centerX,
        this.cameras.main.centerY - 60,
        'WEAPON EVOLVED!',
        {
          fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
          fontSize: '48px',
          color: '#FFD700',
          stroke: '#000000',
          strokeThickness: 6,
          align: 'center',
        }
      );
      evolvedAnnouncementText.setOrigin(0.5, 0.5);
      evolvedAnnouncementText.setDepth(999);
      evolvedAnnouncementText.setScale(0.3);
      evolvedAnnouncementText.setScrollFactor(0);

      // Scale up dramatically
      this.tweens.add({
        targets: evolvedAnnouncementText,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 400,
        ease: 'Back.easeOut',
        onComplete: () => {
          // Then fade out
          this.tweens.add({
            targets: evolvedAnnouncementText,
            alpha: 0,
            scaleX: 1.8,
            scaleY: 1.8,
            duration: 600,
            ease: 'Quad.easeIn',
            onComplete: () => {
              evolvedAnnouncementText.destroy();
            },
          });
        },
      });

      // 7. Existing toast + sound
      this.toastManager.showToast({
        title: `EVOLVED: ${evolutionResult.evolution.evolvedName}`,
        description: evolutionResult.evolution.evolvedDescription,
        icon: evolutionResult.weapon.icon,
        color: 0xffd700,
        duration: 5000,
      });
      this.soundManager.playAchievementUnlock();
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

    // Sync to weapons (canonical path also applies range/speed/mastery + combo/hazard)
    this.syncStatsToPlayer();

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

      // Sync to weapons after buff expires (canonical path)
      this.syncStatsToPlayer();
    });
  }

  /**
   * Applies the selected stage's visual palette to the grid background and
   * adds an ambient color overlay. Safe to call after GridBackground is created.
   */
  private applyStageVisuals(): void {
    const stage = getStageById(this.selectedStageId) ?? getDefaultStage();
    if (this.gridBackground) {
      this.gridBackground.setColorPalette(
        stage.gridLineColor,
        stage.gridPulseColor,
        stage.gridWarpHighlightColor
      );
    }
    if (stage.ambientOverlayAlpha > 0) {
      const overlayDepth = 2; // above grid (depth 0-1), below gameplay
      this.add
        .rectangle(
          this.scale.width / 2,
          this.scale.height / 2,
          this.scale.width,
          this.scale.height,
          stage.ambientOverlayColor,
          stage.ambientOverlayAlpha
        )
        .setDepth(overlayDepth)
        .setScrollFactor(0)
        .setName('stageAmbientOverlay');
    }
  }

  /**
   * Resolves the neon color palette for the currently-selected ship,
   * falling back to default blue on unknown/missing ships.
   */
  private getShipNeonColor() {
    const ship = getShipById(this.selectedShipId) ?? getDefaultShip();
    return SHIP_NEON_PALETTES[ship.neonColorId] ?? SHIP_NEON_PALETTES.cyan;
  }

  /**
   * Resets every module-level / singleton system that holds run-scoped state so
   * a new run starts clean. Called from BOTH the fresh-start and save-restore
   * paths in create() — keep this the single source of truth so a newly added
   * system can never be reset on one path but not the other (a class of
   * stale-state bug CLAUDE.md explicitly warns about).
   */
  private resetAllRunSystems(): void {
    resetInputSystem();
    resetSpriteSystem();
    resetEnemyAISystem();
    resetBossCallbacks();
    resetXPGemSystem();
    resetHealthPickupSystem();
    resetMagnetPickupSystem();
    resetConsumablePickupSystem();
    resetWeaponSystem();
    resetCollisionSystem();
    resetStatusEffectSystem();
    resetFrameCache();
    resetEnemySpatialHash();
    resetShapeTextureCache(this);
    resetEnemyTextureCache(this);
    destroyGemAtlases(this);
    destroyProjectileAtlases(this);
    resetComboSystem();
    resetEventSystem();
    resetDirectorSystem();
    resetBossPhaseTracking();
    resetBossArenaSystem();
    resetHazardZoneSystem();
    getRelicManager().reset();
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
      this.playerStats.damageMultiplier * (1 + comboDamageBonus) * this.hazardDamageMultiplier,
      this.playerStats.attackSpeedMultiplier,
      this.playerStats.projectileCount - 1, // Bonus count (base is 1)
      this.playerStats.piercing,             // Bonus piercing (base is 0)
      this.playerStats.rangeMultiplier,      // Universal reach/area multiplier
      this.playerStats.projectileSpeedMultiplier, // Projectile-velocity multiplier
      {
        projectile: this.playerStats.projectileMastery,
        melee: this.playerStats.meleeMastery,
        aura: this.playerStats.auraMastery,
        summon: this.playerStats.summonMastery,
        orbital: this.playerStats.orbitalMastery,
        explosive: this.playerStats.explosiveMastery,
        beam: this.playerStats.beamMastery,
        ultimate: this.playerStats.ultimateMastery,
      },
      this.playerStats.explosionDamageMultiplier, // Explosive-weapon damage bonus
      this.playerStats.durationMultiplier          // Effect-lifetime multiplier
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
      bossDamageMultiplier: this.playerStats.bossDamageMultiplier,
    });
  }

  /**
   * Recomputes the player's effective move speed each frame for the Sprint and
   * Battle Flow movement upgrades, then writes it to Velocity.speed (consumed by
   * inputSystem). Sprint adds a flat bonus when no enemies are nearby; Battle
   * Flow adds a per-nearby-enemy bonus (capped) while in combat. Recomputed from
   * the authoritative base (playerStats.moveSpeed) so it never compounds.
   */
  private updatePlayerEffectiveMoveSpeed(): void {
    if (this.playerId === -1) return;

    const sprintBonus = this.playerStats.sprintBonus;
    const combatSpeedBonus = this.playerStats.combatSpeedBonus;

    // No movement upgrades owned — base speed, no spatial query.
    if (sprintBonus <= 0 && combatSpeedBonus <= 0) {
      Velocity.speed[this.playerId] = this.playerStats.moveSpeed;
      return;
    }

    // Count nearby enemies (zero-allocation iteration).
    let nearbyEnemyCount = 0;
    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];
    getEnemySpatialHash().queryPotentialForEach(playerX, playerY, PLAYER_COMBAT_RADIUS, () => {
      nearbyEnemyCount++;
    });

    let speedFactor = 1;
    if (nearbyEnemyCount > 0) {
      // Battle Flow: faster the more enemies surround you, capped.
      speedFactor += Math.min(combatSpeedBonus * nearbyEnemyCount, COMBAT_SPEED_BONUS_CAP);
    } else {
      // Sprint: bonus speed when out of combat.
      speedFactor += sprintBonus;
    }

    Velocity.speed[this.playerId] = this.playerStats.moveSpeed * speedFactor;
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

    // Add trails for fast-moving enemies (use FrameCache, avoid redundant query)
    const trailEnemies = getFrameCacheEnemyIds();
    for (let i = 0; i < trailEnemies.length; i++) {
      const enemyId = trailEnemies[i];

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

    // Get ALL enemy positions with weight (reuse pooled objects to avoid per-frame allocation)
    const enemies = getFrameCacheEnemyIds();
    const enemyCount = enemies.length;

    // Grow pool if needed
    while (this.gridEnemyDataPool.length < enemyCount) {
      this.gridEnemyDataPool.push({ x: 0, y: 0, weight: 0 });
    }
    this.gridEnemyDataLength = enemyCount;

    for (let i = 0; i < enemyCount; i++) {
      const enemyId = enemies[i];
      const size = EnemyType.size[enemyId];
      const aiType = EnemyAI.aiType[enemyId];
      let weight = Math.min(1.5, 0.25 + (size * 0.3));

      if (aiType >= 100) {
        weight *= 3.0;
      } else if (aiType >= 50) {
        weight *= 2.0;
      }

      // Reuse pooled object in-place
      const entry = this.gridEnemyDataPool[i];
      entry.x = Transform.x[enemyId];
      entry.y = Transform.y[enemyId];
      entry.weight = weight;
    }

    // Pass slice view of pool (only active entries)
    this.gridBackground.setGravityPoints(playerPos, this.gridEnemyDataPool, this.gridEnemyDataLength);

    // Dynamic grid intensity — scales with combat state
    const maxEnemies = 100;
    const enemyRatio = this.enemyCount / maxEnemies;
    const bossActive = this.bossSpawned ? 0.3 : 0;
    const combatIntensity = Math.min(1, enemyRatio * 0.5 + bossActive);
    this.gridBackground.setCombatIntensity(combatIntensity);

    // Update grid animation with actual delta for proper physics integration
    this.gridBackground.update(deltaSeconds);

    // Update dynamic lighting — clear lights, add sources, render
    if (this.lightingSystem) {
      this.lightingSystem.clearLights();
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];

      // Player light — scales with combo tier
      if (this.playerId !== -1) {
        const comboTier = getComboTier();
        this.lightingSystem.addLight(
          playerX, playerY,
          COMBO_TIER_LIGHT_RADIUS[comboTier] ?? 120,
          COMBO_TIER_LIGHT_INTENSITY[comboTier] ?? 0.9
        );
      }

      // Boss ambient light — ominous red glow
      if (this.bossSpawned) {
        for (const bossEntityId of this.hudManager.getBossEntityIds()) {
          this.lightingSystem.addLight(
            Transform.x[bossEntityId], Transform.y[bossEntityId],
            250, 0.5, 0xff4444
          );
        }
      }

      // Weapon hit flash lights (high quality only)
      if (this.visualQuality === 'high' && this.weaponManager.lightFlashes) {
        const flashes = this.weaponManager.lightFlashes;
        for (let flashIndex = flashes.length - 1; flashIndex >= 0; flashIndex--) {
          const flash = flashes[flashIndex];
          this.lightingSystem.addLight(flash.x, flash.y, flash.radius, flash.intensity);
          flash.ttl -= deltaSeconds * 1000;
          if (flash.ttl <= 0) {
            flashes.splice(flashIndex, 1);
          }
        }
      }

      this.lightingSystem.update();
    }

    // Modulate bloom based on game state
    if (this.bloomPipeline) {
      const comboTier = getComboTier();
      this.bloomPipeline.setBloomStrength(COMBO_TIER_BLOOM_STRENGTH[comboTier] ?? 0.25);
    }
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
      // Update status effect visual quality
      if (this.statusEffectVisualManager) {
        this.statusEffectVisualManager.setQuality(newQuality);
      }
      // Update hazard zone visual quality
      setHazardZoneQuality(newQuality);
      // Update player spaceship quality
      if (this.playerSpaceship) {
        this.playerSpaceship.setQuality(newQuality);
      }
      // Update weapon visual quality
      this.weaponManager.setVisualQuality(newQuality);
      // Update XP gem quality (spin animation, trail budget, merge aggressiveness)
      setXPGemQuality(newQuality);
      // Disable distortion on low quality
      // (DistortionPipeline auto-skips when no active sources, so no explicit disable needed)
      // Update lighting quality
      if (this.lightingSystem) {
        this.lightingSystem.setEnabled(newQuality !== 'low');
      }
      // Update bloom quality — remove on low, adjust parameters on medium/high
      if (this.renderer.type === Phaser.WEBGL) {
        if (newQuality === 'low' && this.bloomPipeline) {
          this.cameras.main.removePostPipeline('BloomPipeline');
          this.bloomPipeline = null;
        } else if (newQuality !== 'low' && !this.bloomPipeline) {
          this.cameras.main.setPostPipeline(['BloomPipeline']);
          const postPipelines = this.cameras.main.postPipelines;
          this.bloomPipeline = postPipelines.find(p => p.name === 'BloomPipeline') as BloomPipeline ?? null;
        }
        if (this.bloomPipeline) {
          const isHighQuality = newQuality === 'high';
          this.bloomPipeline.setBloomThreshold(isHighQuality ? 0.6 : 0.7);
        }
      }
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

    // Resize lighting render texture
    if (this.lightingSystem) {
      this.lightingSystem.resize(w, h);
    }

    // Resize trail render texture
    if (this.trailManager) {
      this.trailManager.resize(w, h);
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

    // Tear down coach marks overlay + its listeners if the scene exits
    // before the player finished dismissing them.
    if (this.coachMarksCleanup) {
      this.coachMarksCleanup();
      this.coachMarksCleanup = null;
    }

    // Remove ESC key to prevent it persisting across restarts
    if (this.escKey) {
      this.escKey.destroy();
      this.escKey = null;
    }

    // Remove auto-buy toggle key listener
    if (this.autoBuyKeyHandler) {
      this.input.keyboard?.off('keydown-T', this.autoBuyKeyHandler);
      this.autoBuyKeyHandler = null;
    }

    // Remove director debug hotkey + text
    if (this.directorDebugKeyHandler) {
      this.input.keyboard?.off('keydown-F10', this.directorDebugKeyHandler);
      this.directorDebugKeyHandler = null;
    }
    if (this.directorDebugText) {
      this.directorDebugText.destroy();
      this.directorDebugText = null;
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

    // Remove gamepad pause request handler
    if (this.pauseRequestHandler) {
      this.events.off('input-pause-requested', this.pauseRequestHandler);
      this.pauseRequestHandler = null;
    }

    // Remove gamepad auto-buy toggle handler
    if (this.autoBuyToggleHandler) {
      this.events.off('input-autobuy-toggled', this.autoBuyToggleHandler);
      this.autoBuyToggleHandler = null;
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


    // Clean up player spaceship visual
    if (this.playerSpaceship) {
      this.playerSpaceship.destroy();
    }

    // Clean up boss arena and hazard zones
    resetBossArenaSystem();
    resetHazardZoneSystem();
    this.activeBossType = null;

    // Clean up post-processing and lighting
    if (this.lightingSystem) {
      this.lightingSystem.destroy();
      this.lightingSystem = null;
    }
    this.distortionPipeline = null;
    if (this.renderer.type === Phaser.WEBGL && this.cameras?.main) {
      this.cameras.main.removePostPipeline('DistortionPipeline');
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
    if (this.statusEffectVisualManager) {
      this.statusEffectVisualManager.destroy();
    }
    if (this.offScreenIndicatorManager) {
      this.offScreenIndicatorManager.destroy();
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
