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
  EnemyAffix,
  Destructible,
  StatusEffect,
  Consumable,
  ConsumablePickupTag,
  HealthPickupTag,
  MagnetPickupTag,
  NemesisTag,
  AmbushSpawnTag,
} from '../../ecs/components';
import { inputSystem, type DashVelocity } from '../../ecs/systems/InputSystem';
import { InputController } from '../managers/InputController';
import { movementSystem, clampPlayerToRect } from '../../ecs/systems/MovementSystem';
import type { WallCollisionContext } from '../../ecs/systems/MovementSystem';
import { setNavigationContext } from '../../ecs/systems/enemy-ai/common';
import { MoverKind, createCollisionResult, findNearestFreeCircleSpot, isSolidAtWorld, resolveCircleMove, tileKindAt } from '../../world/staticCollision';
import { isPhasedWraith } from '../../ecs/systems/enemy-ai/wraith';
import { setEnemyDecoy, clearEnemyDecoy, getDecoyFollowerCount } from '../../ecs/systems/enemy-ai/decoy';
import { enemyAISystem, getWardenSlowMultiplier, setTelegraphManager } from '../../ecs/systems/EnemyAISystem';
import { setEnemyProjectileCallback, setMinionSpawnCallback, setXPGemCallbacks, recordEnemyDeath, linkTwins, unlinkTwin, setBossCallbacks, getAllTwinLinks, setEnemyAIFieldRect, updateAIGameTime, setBossPhaseTransitionCallback } from '../../ecs/systems/enemy-ai/state';
import { exploderFuseTelegraph, spawnTelegraph } from '../../ecs/systems/enemy-ai/telegraphs';
import { armExploderFuse, tickExploderFuses, EXPLODER_BLAST_RADIUS, EXPLODER_BLAST_DAMAGE, type ExploderFuse } from '../../ecs/systems/enemy-ai/exploder-fuse';
import { registerLegionRoot, registerLegionChild, onLegionMemberDeath, registerRestoredLegionMembers, forEachLegionGroup, legionPotentialMultiplier, legionPoolFromMember, legionChildSpawnOffsets, legionGenerationForType } from '../../ecs/systems/EnemyAISystem';
import { setCombatStats } from '../../ecs/systems/CollisionSystem';
import { statusEffectSystem, setStatusEffectSystemEffectsManager, setStatusEffectSystemDeathCallback, setStatusEffectDamageCallback, applyPoison, applyFreeze, applyBurn } from '../../ecs/systems/StatusEffectSystem';
import { getScaledStats, getEnemyType, getEnemyArmor, EnemyTypeDefinition, EnemyAIType } from '../../enemies/EnemyTypes';
import { spriteSystem, registerSprite, getSprite, unregisterSprite } from '../../ecs/systems/SpriteSystem';
import { xpGemSystem, spawnXPGem, setXPGemSystemScene, setXPCollectCallback, setXPGemEffectsManager, setXPGemSoundManager, setXPGemMagnetRange, setXPGemTrailManager, setXPGemWorldReference, getXPGemPositions, consumeXPGem, magnetizeAllGems, setXPGemQuality } from '../../ecs/systems/XPGemSystem';
import { healthPickupSystem, spawnHealthPickup, setHealthPickupSystemScene, setHealthCollectCallback, setHealthPickupEffectsManager, setHealthPickupSoundManager, setHealthPickupMagnetRange, magnetizeAllHealthPickups } from '../../ecs/systems/HealthPickupSystem';
import { magnetPickupSystem, spawnMagnetPickup, setMagnetPickupSystemScene, setMagnetPickupEffectsManager, setMagnetPickupSoundManager } from '../../ecs/systems/MagnetPickupSystem';
import { consumablePickupSystem, spawnConsumablePickup, setConsumablePickupSystemScene, setConsumablePickupEffectsManager, setConsumableCollectCallback, ConsumableKind, getConsumableKindColor } from '../../ecs/systems/ConsumablePickupSystem';
import { PlayerStats, createDefaultPlayerStats, calculateXPForLevel, Upgrade, createUpgrades, CombinedUpgrade, getRandomCombinedUpgrades, getWeaponUpgrades, WeaponUpgrade } from '../../data/Upgrades';
import { selectAutoBuyUpgrade as selectBestAutoBuyUpgrade } from '../autobuy/autoBuyScoring';
import { mergeLockedIntoOffers } from '../../data/upgradeLocks';
import {
  buildMarketOffers,
  MarketOfferId,
  MarketOfferView,
  MarketStockContext,
  MarketStockSubject,
  MARKET_CONTRABAND_REROLLS,
  MARKET_CONTRABAND_BANISHES,
} from '../../data/MarketOffers';
import { EffectsManager } from '../../effects/EffectsManager';
import { getJuiceManager } from '../../effects/JuiceManager';
import { SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { WeaponManager, createWeapon, ProjectileWeapon, getWeaponInfoList } from '../../weapons';
import { WeaponSynergy } from '../../data/WeaponSynergies';
import { SECTOR_HEIGHT, SECTOR_WIDTH, WorldPoint, parseSectorKey, rectCenter, rectHeight, rectWidth, sectorCenterWorld, sectorKey, sectorOfWorldPoint, sectorOriginWorld } from '../../world/worldSpace';
import { planSectorRetire, type RetireCandidate } from '../../world/sectorRetire';
import { buildSectorSupply, sectorTagsOf } from '../../world/sectorTags';
import { SPINE_BIOME_ID } from '../../world/generateWorld';
import type { SectorSupplySnapshot } from '../../world/sectorTags';
import { findTetherCrossing, voidGapNearWorld } from '../../world/voidGaps';
import {
  clearSecurityGrid, findGridBreach, securityGridNearWorld,
} from '../../world/securityGrids';
import { EdgeKind, SECTOR_TILE_COLS, TILE_SIZE, TileKind, WORLDGEN_VERSION, isTileInBounds, tileIndex } from '../../world/worldTypes';
import type { SectorDef, WorldMap } from '../../world/worldTypes';
import { GATE_GLYPHS } from '../../expedition/gateGlyphs';
import { wardenBossIdForWorld } from '../../expedition/wardenIdentity';
import type { PoiHazardKind } from '../../expedition/sectorDetail';
import { rollPoiContents } from '../../world/poiRoll';
import { rollSecretReward } from '../../world/secretRewards';
import type { SecretRewardDefinition } from '../../world/secretRewards';
import { collectPhaseBleedTiles } from '../../world/phaseBleed';
import type { PhaseBleedTile } from '../../world/phaseBleed';
import { PhaseBleedRenderer } from '../../visual/PhaseBleedRenderer';
import type { PoiContentId } from '../../data/PoiCatalog';
import { AMBUSH_NEST_WAVES, ambushWaveTier } from '../../data/PoiCatalog';
import { biomeTintFor } from '../../visual/SectorMapRenderer';
import {
  EdgeSpawnConfig,
  isBeyondLeash,
  pickEdgeSpawnPoint,
  pickInteriorPoint,
  repositionOntoSpawnRing,
} from '../../world/spawnRing';
import { EnemyProjectileManager } from '../combat/EnemyProjectileManager';
import {
  ABILITY_DOOR_OPEN_RADIUS, clearBarrier, gatedDoorNearWorld, nearestBreakableBarrier,
  openAbilityGate, setBarrierEventSink,
} from '../../world/barrierState';
import type { BarrierEventSink } from '../../world/barrierState';
import {
  advanceExpeditionCount, getFieldAnchor, getSectorMarks, isWorldConquered, markWorldConquered,
  recordBrokenBarrier, recordDownedSecurityGrid, recordFieldAnchor,
} from '../../expedition/WorldProfileStore';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import {
  getCurrentExpeditionSeasonIndex, getCurrentExpeditionSeed, recordLiveWorldProgress,
} from '../../expedition/ExpeditionSeasonStore';
import { recordExpeditionCompletion } from '../../expedition/completionRecord';
import { buildSecretLead, chooseHintTarget, leadSectorDistance } from '../../expedition/secretHints';
import type { SecretLead } from '../../expedition/secretHints';
import { buildRunTickerRows } from '../../expedition/runTicker';
import type { RunTickerSiege } from '../../expedition/runTicker';
import { MAP_FRAGMENT_MAX_SECTORS, chooseMapFragmentGrant } from '../../expedition/mapFragments';
import { PoiFlags } from '../../expedition/DiscoveryTypes';
import type { DiscoveryChanges } from '../../expedition/DiscoveryTypes';
import { plotSectorCourse } from '../../expedition/sectorRoute';
import { consumePlannedSortie } from '../../expedition/pendingLaunch';
import type { PlannedSortie } from '../../expedition/pendingLaunch';
import { RunModeKind, WorldModeAdapter } from '../world/WorldModeAdapter';
import { ArenaModeAdapter } from '../world/ArenaModeAdapter';
import { ExpeditionModeAdapter } from '../world/ExpeditionModeAdapter';
import { toNeonPair, PLAYER_NEON, ENEMY_COLORS, WORLD_GEOMETRY_COLORS } from '../../visual/NeonColors';
import { resetShapeTextureCache, VisualQuality } from '../../visual/GlowGraphics';
import { createCachedEnemyVisual, resetEnemyTextureCache } from '../../visual/EnemyVisuals';
import { generateGemAtlases, destroyGemAtlases } from '../../visual/Gem3DRenderer';
import { generateProjectileAtlases, destroyProjectileAtlases } from '../../visual/ProjectileAtlasRenderer';
import { GridBackground } from '../../visual/GridBackground';
import { ParallaxBackground } from '../../visual/ParallaxBackground';
import { PlayerSpaceship } from '../../visual/PlayerSpaceship';
import { TrailManager } from '../../visual/TrailManager';
import { DeathRippleManager } from '../../visual/DeathRippleManager';
import { MasteryVisualsManager } from '../../visual/MasteryVisuals';
import { ShieldBarrierVisual } from '../../visual/ShieldBarrierVisual';
import { StatusEffectVisualManager } from '../../visual/StatusEffectVisualManager';
import { EliteAffixVisualManager } from '../../visual/EliteAffixVisualManager';
import { rollAffix, rollBossAffix, rollParagonAffix, affixDisplayName, softenBossAffixScale, vampiricHealFraction, AFFIX_META, EnemyAffixType } from '../../data/Affixes';
import { EndlessMutatorType, ENDLESS_MUTATOR_META } from '../../data/EndlessMutators';
import { TelegraphManager } from '../../effects/TelegraphManager';
import { DepthLayers, OverlayDepths } from '../../visual/DepthLayers';
import { getPaceGhost, paceDeltaKills, PACE_SAMPLE_INTERVAL_SECONDS, MAX_PACE_SAMPLES } from '../../meta/PaceGhostManager';
import {
  NEMESIS_SPAWN_TIME_SECONDS, NEMESIS_SPRITE_SCALE, NemesisRecord,
  clearNemesis, getNemesis, nemesisGoldReward, nemesisLabel, nemesisScaling, recordNemesisKill,
} from '../../meta/NemesisManager';
import {
  formatFightTime,
  getPracticeBest,
  practiceBestKey,
  savePracticeBestIfFaster,
} from '../../meta/PracticeBestTimes';
import { settleDailyQuests, createDailyQuestWatcher, claimDailyQuestGold, type DailyQuestWatcher } from '../../meta/DailyQuestManager';
import type { DailyQuestDefinition } from '../../data/DailyQuests';
import {
  beginExpeditionQuestRun,
  recordExpeditionQuestEvent,
  claimExpeditionQuestGold,
  claimExpeditionQuestRelicRolls,
  getActiveQuestHoldObjectives,
  getActiveQuestEscortObjectives,
  dropExpeditionQuestDrone,
  getActiveQuestStepViews,
  getHeldWorldKeyIds,
  getActiveQuestCargoDropObjectives,
  getExpeditionQuestCargoStatus,
  loadExpeditionQuestCargo,
  reclaimExpeditionQuestCargo,
  dropExpeditionQuestCargo,
  getExpeditionQuestFromCatalog,
  dropStaleExpeditionQuestWorldProgress,
} from '../../meta/ExpeditionQuestManager';
import { WARDEN_SEAL_KEY_ID, cargoLabelOf, droneLabelOf, getQuestForKeyId } from '../../data/ExpeditionQuests';
import type { ExpeditionQuestStep } from '../../data/ExpeditionQuests';
import { effectiveStepTarget, questWorldStamp, renderStepDescription } from '../../systems/QuestProgress';
import type { QuestEvent } from '../../systems/QuestProgress';
import type { ToastConfig } from '../../achievements/AchievementTypes';
import { buildRunEarnings, buildRunNotices, type EarlyRunEndRecord, type RunEarning } from '../../meta/RunEarnings';
import { OffScreenIndicatorManager } from '../../visual/OffScreenIndicatorManager';
import { MinimapManager } from '../../visual/MinimapManager';
import { MinimapFeed } from '../managers/MinimapFeed';
import { AbilityVaultManager } from '../expeditionField/AbilityVaultManager';
import { QuestBoardManager } from '../expeditionField/QuestBoardManager';
import {
  drawQuestCargoCrate,
  QUEST_CARGO_COLOR,
  QUEST_CARGO_PICKUP_RADIUS,
} from '../expeditionField/questCargoCrate';
import { SecretCacheManager } from '../expeditionField/SecretCacheManager';
import { SHRINE_DEFS, ShrineManager, type ShrineType } from '../managers/ShrineManager';
import { DistortionPipeline } from '../../visual/DistortionPipeline';
import { BloomPipeline } from '../../visual/BloomPipeline';
import { LightingSystem } from '../../visual/LightingSystem';
import { setBossArenaScene, activateBossArena, deactivateBossArena, updateBossArena, resetBossArenaSystem } from '../../systems/BossArenaSystem';
import { selectRunModifiers, getModifierById, type RunModifier } from '../../data/RunModifiers';
import { selectBlessings, getBlessingById, type Blessing } from '../../data/Blessings';
import { recordRunBuild, selectKeptUpgrades } from '../../data/KeptUpgrades';
import { getPactById, type Pact } from '../../data/Pacts';
import { setHazardZoneScene, spawnHazardZone, updateHazardZones, updateHazardSpawner, applyIceHazardSlow, resetHazardZoneSystem, setHazardZoneWorldLevel, setHazardZoneEffectsManager, setHazardZoneQuality, setHazardZoneStage, getHazardState, restoreHazardState, getActiveHazardZoneCount } from '../../systems/HazardZoneSystem';
import {
  getGameStateManager, GameSaveState, SerializedPoiSlotObject,
} from '../../save/GameStateManager';
import { getSettingsManager } from '../../settings';
import { SecureStorage, flushStorage } from '../../storage';
import { updateFrameCache, getEnemyIds as getFrameCacheEnemyIds } from '../../ecs/FrameCache';
import { loadGauntletBestWave } from '../gauntlet/GauntletBestWave';
import { GauntletDirector } from '../directors/GauntletDirector';
import { EndlessDirector } from '../directors/EndlessDirector';
import { BossFightDirector } from '../directors/BossFightDirector';
import { loadEndlessBestCycle } from '../endless/EndlessBestCycle';
import {
  buildQuestRunData,
  buildRunEndData,
  buildUnlockContext,
  recordCodexRunEnd,
  recordRunOutcome,
  type RunFacts,
} from '../runend/runSettlement';
import type { ExpeditionDebrief } from '../runend/expeditionDebrief';
import { getEnemySpatialHash } from '../../utils/SpatialHash';
import { getAchievementManager, AchievementDefinition, MilestoneDefinition, MilestoneReward } from '../../achievements';
import { getToastManager, ToastManager } from '../../ui';
import { getCodexManager } from '../../codex';
import { recordComboKill, updateComboSystem, getComboCount, getHighestCombo, getComboTier, getComboDecayPercent, getComboBuffDamageMultiplier, isComboBuffActive, getComboBuffRemainingPercent, getComboState, restoreComboState, type ComboTier } from '../../systems/ComboSystem';
import {
  addUltimateChargeFromKill,
  addUltimateChargeFromDamage,
  getUltimateChargeRatio,
  isUltimateReady,
  tryActivateUltimate,
  setUltimateChargeSuppressed,
  setUltimateChargeRateMultiplier,
  computeUltimateNova,
  getUltimateState,
  restoreUltimateState,
  fillUltimateCharge,
} from '../../systems/UltimateSystem';
import { resetMusicIntensityDriver, updateMusicIntensity } from '../../audio/MusicIntensityDriver';
import { updateEventSystem, setSuppressEvents, getEventState, restoreEventState, getActiveEvent, getEventStatBuff, RunEvent } from '../../systems/EventSystem';
import { runAllRunResets } from '../../systems/runResetRegistry';
import { expireTimedStatBuffs, normalizeTimedStatBuffs, applyFieldBoost, buildTimedBuffRows, type TimedStatBuff, type TimedStatField } from '../../systems/TimedStatBuffs';
import { FIELD_BOOSTS, getFieldBoostByKind, type FieldBoostDefinition } from '../../data/FieldBoosts';
import { resolveSlowAfterResistance } from '../../systems/SlowResistance';
import { resetDirectorSystem, updateDirector, pickEnemyFromDirector, getDirectorState, restoreDirectorState, getCurrentStrategy, isDirectorStrategy, setDirectorStage, type DirectorStrategy } from '../../systems/DirectorSystem';
import { describeRegionSignature } from '../../systems/regionSignature';
import { getThreatTier, clampThreatTier } from '../../data/ThreatTiers';
import { recordThreatCleared } from '../../meta/ThreatProgress';
import { getHiddenUnlockManager, type HiddenUnlockCondition } from '../../meta/HiddenUnlocks';
import { getShipById, getDefaultShip } from '../../data/ShipCharacters';
import { resolveActivePaint } from '../../data/ShipPaints';
import { getShipPaintManager } from '../../storage/ShipPaintManager';
import { getUltimateForShip, getShipUltimate, type ShipUltimateDefinition } from '../../data/ShipUltimates';
import type { PracticeUltimateChoice } from '../../data/PracticeUltimates';
import { SHIP_NEON_PALETTES } from '../../visual/NeonColors';
import {
  generateDailyChallenge,
  generateWeeklyChallenge,
} from '../../meta/DailyChallengeManager';
import { getRelicManager, relicRankNumeral } from '../../meta/RelicManager';
import { getCardCollectionManager } from '../../meta/CardCollectionManager';
import { getBoostCardManager } from '../../meta/BoostCardManager';
import { FLUX_CACHE_DROP_CHANCE } from '../../data/BoostCards';
import { getShipModManager } from '../../meta/ShipModManager';
import { getTraversalAbility, scanPulseGraphRadius } from '../../data/TraversalAbilities';
import { getOwnedTraversalAbilityIds } from '../../meta/TraversalAbilityManager';
import { computeHudScale } from '../../utils/HudScale';
import type { CardDefinition } from '../../data/Cards';
import { Relic, getRelicRarityColor, getBossTrophy, getUnlockedBossTrophies } from '../../data/Relics';
import { getStageById, getDefaultStage, resolveStageAmbientDarkness, resolveStageDriftFactor, resolveStageWallShiftSeconds, resolveStageDeathBloomSeconds, BASE_AMBIENT_DARKNESS } from '../../data/Stages';
import { signatureHazardType, type HazardType } from '../../systems/stageHazardBias';
import { applyLiveWallShift } from '../../world/ambientStir';
import { TUNING, STORAGE_KEY_AUTO_BUY } from '../../data/GameTuning';
import { HUDManager, UpgradeIconData, EvolutionInfo } from '../managers/HUDManager';
import { getEvolutionForWeapon } from '../../data/WeaponEvolutions';
import { setPracticeSession } from '../../utils/practiceSession';
import { PracticeDock, PracticeDockState } from '../../ui/PracticeDock';
import {
  isPracticeMinibossTarget,
  scheduledSpawnTime,
  toPracticeTargetId,
  type RematchTarget,
  type PracticeRematchSeed,
} from '../../data/PracticeTargets';
import { PracticeArenaRung } from '../../data/PracticeArena';
import { practiceBuildPlayerLevel } from '../../data/PracticeBuild';
import { evaluateDashDangerHint, expeditionCrossingHintId, findBlockedEvolution, formatEvolutionHint, getHintDescription, getTutorialHintDef } from '../../tutorial/TutorialHints';
import { getTutorialHintManager } from '../../tutorial/TutorialHintManager';
import { PauseMenuManager } from '../managers/PauseMenuManager';
import type { DamageSourceTally } from '../managers/buildStats';
import { RUN_TIMELINE_EVENT_CAP, type RunTimelineEvent, type RunTimelineEventKind } from '../managers/runTimeline';
import { ACCENT_COLORS, DISPLAY_FONT } from '../../visual/MenuStyle';

/** Chebyshev tiles around the ship that a live wall shift may never write. Two tiles is a clear
 *  ship-length on every side, so a region rearranging around the player never materialises rock
 *  on the hull, which reads as a bug rather than as the world moving. */
const LIVE_WALL_SHIFT_HULL_CLEARANCE_TILES = 2;

/** Live shifts one room may take in one run. The reachability proof keeps every route open, but
 *  nothing keeps a camped room legible: without this a player who stands still long enough
 *  rewrites the whole room. */
const LIVE_WALL_SHIFT_MAX_EVENTS_PER_SECTOR = 4;

// Module-level queries (defined once, not per-frame)
const knockbackEnemyQuery = defineQuery([Transform, Knockback, EnemyTag]);
const retireHealthQuery = defineQuery([Transform, HealthPickupTag]);
const retireMagnetQuery = defineQuery([Transform, MagnetPickupTag]);
const retireConsumableQuery = defineQuery([Transform, ConsumablePickupTag]);

const HUD_OVERLAY_DEPTH = OverlayDepths.HUD_OVERLAY; // Warnings / notifications / coach marks — above HUD, below minimap. NOT the pause menu (PauseMenuManager).

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

// The objective ticker borrows the bounty line while no bounty is running (doc 04 section 4:
// one line, never two). It re-reads the quest store on a timer instead of per frame, and only
// while the line is idle, so an active bounty pays nothing for it.
const QUEST_TICKER_REFRESH_SECONDS = 1;
const QUEST_TICKER_CYCLE_SECONDS = 5;

// In-run bounty objectives: rotating goals that reward a power-up burst.
type BountyKind = 'kills' | 'elites' | 'flawless';

// Power shrine: temporary damage buff. Persisted + reverted via gameTime (see
// TimedStatBuffs) so it survives refresh-recovery instead of sticking forever.
const POWER_SHRINE_BUFF_MULT = 2;
const POWER_SHRINE_BUFF_SECONDS = 8;

// Share of floor-consumable drops that come out as a timed field boost instead of one of
// the four instant effects. Every consumable source funnels through spawnRandomConsumable,
// so this one number is the whole drop rate.
const FIELD_BOOST_DROP_CHANCE = 0.20;

// Share of treasure chests that come out "special" (3x rewards, guaranteed relic). One
// number for the timer spawner and for map caches: expedition grants more chest ROLLS,
// never better odds (doc 04 section 6 rule 1).
const SPECIAL_CHEST_CHANCE = 0.15;

// A crate cache is three crates ringed around the slot; the ring radius stays inside the
// 3x3 tile pocket sectorInterior.openNeighbourhood guarantees around every POI slot, and
// freeSpotNear snaps each one anyway.
const POI_CRATE_FIELD_COUNT = 3;
const POI_CRATE_FIELD_RADIUS = 34;
const POI_CACHE_SPREAD = 22;
const POI_RELINK_TOLERANCE = 1;
const SECRET_REWARD_SPREAD = 26;
const SECRET_REWARD_RADIUS = 34;
const SECRET_REWARD_BUNDLE_COUNT = 3;
const SECRET_REWARD_HEAL = 25;

interface ActiveChestRecord {
  graphics: Phaser.GameObjects.Graphics;
  isSpecial: boolean;
  isPoiCache: boolean;
  /** Optional only because it closes over timers declared later in addTreasureChest; it is
   *  always assigned before that method returns. */
  cleanup?: () => void;
}

/** One field object a POI slot put on the floor, carrying the handle its liveness is read from. */
type PoiSlotObject =
  | { kind: 'chest'; chest: ActiveChestRecord }
  | { kind: 'crate'; entityId: number }
  | { kind: 'boost'; entityId: number; consumable: ConsumableKind }
  /** An altar owned by ShrineManager rather than by the ECS, so its handle is its point: the
   *  manager splices a shrine the moment the ship touches it, which is exactly the liveness
   *  test the retire pass needs. */
  | { kind: 'shrine'; shrineType: ShrineType; x: number; y: number };

interface PoiSlotRecord {
  sectorKey: string;
  objects: PoiSlotObject[];
  /** Restored from a save that had already been partly looted. Such a record exists only to
   *  protect its survivors from the loose-loot sweep: retiring it would delete the slot id and
   *  the next entry would re-roll it, paying the same slot twice. Always false in live play. */
  partlyLooted: boolean;
}

interface ActiveAmbushNest {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  /** SectorDef.depth at spawn, kept so a restored nest wakes with the wave it was placed with. */
  depth: number;
  awake: boolean;
  waveEntityIds: number[];
}

interface ActiveNemesisLair {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  /** True once the hunter has been stood up here. An awake lair holds no entity id: the
   *  nemesis is a serialized enemy that outlives a refresh on its own, so the kill is
   *  matched by NemesisTag in handleEnemyDeath, never by a remembered id. */
  awake: boolean;
}

// Pandemic: a poison death spreads to nearby enemies. pandemicSpread is a COUNT
// of enemies infected (shop "Pandemic" 1-3 + "Pandemic Engine" relic +2), not a
// radius -- so we query a fixed bloom radius here and cap infections to that count.
const PANDEMIC_SPREAD_RADIUS = 100;

/** One clocked sandbox fight: spawned in PRACTICE, resolved when nothing boss-tier lives. */
interface PracticeFightState {
  key: string;
  /** Run-clock seconds at the spawn that opened this fight. */
  startTime: number;
  /** Set once a boss-tier enemy has actually been seen alive (spawn is not same-frame). */
  live: boolean;
  /** Another spawn joined the fight — the elapsed time is no longer comparable. */
  dirty: boolean;
}

/** XP floor that marks an enemy boss-tier — the same threshold handleEnemyDeath uses. */
const PRACTICE_FIGHT_XP_FLOOR = 30;

/** The ring a regular enemy enters on: just off the view edge, corners included. */
const REGULAR_SPAWN_RING: EdgeSpawnConfig = { spawnOffset: 30, edgeInset: 0 };

/** Minibosses and the nemesis enter further out and clear of the corners. */
const MINIBOSS_SPAWN_RING: EdgeSpawnConfig = { spawnOffset: 50, edgeInset: 100 };

/**
 * Fresh edges tried before a spawn slot is abandoned. Only reachable in expedition,
 * where a view pressed against the world edge can offer a blocked side; four retries
 * make an all-blocked draw a 1-in-1024 event.
 */
const SPAWN_RING_ATTEMPTS = 5;
const PLAYER_COLLISION_RADIUS = 16;
const ENEMY_COLLISION_RADIUS = 12;
const BOSS_KNOCKBACK_AI_TYPE_FLOOR = 100;
const knockbackCollisionResult = createCollisionResult();
const wraithSnapSpot = { x: 0, y: 0 };
/** Per-frame scratch for the phased-Wraith wall tell. Refilled from zero every frame and
 *  cleared in shutdown(), so it carries nothing between runs and needs no reset function. */
const phaseBleedTiles: PhaseBleedTile[] = [];
const phaseBleedSeenTileKeys = new Set<number>();
/** ~1 Hz at 60fps: slow enough to read as a warning rather than a strobe. */
const PHASE_BLEED_PULSE_RATE = 0.006;
const enemySpawnSpot = { x: 0, y: 0 };
const apertureSpawnSpot = { x: 0, y: 0 };
const blinkCollisionResult = createCollisionResult();
const blinkDirection = { x: 0, y: 0 };
const dashFrameVelocity: DashVelocity = { velocityX: 0, velocityY: 0 };
const BLINK_DRIVE_ID = 'ability_blink_drive';
const MAGNO_TETHER_ID = 'ability_magno_tether';
const PHASE_CLOAK_ID = 'ability_phase_cloak';
const THERMAL_WARD_ID = 'ability_thermal_ward';
const SIGNAL_DECRYPTOR_ID = 'ability_signal_decryptor';

/** Boss-tier XP floor, the same threshold handleEnemyDeath uses; leash-exempt. */
const LEASH_EXEMPT_XP_FLOOR = 30;

/** XP floor that marks an enemy elite-or-better for the region death bloom, the same
 *  threshold handleEnemyDeath's own miniboss branch uses. */
const REGION_BLOOM_XP_FLOOR = 30;

/** A bloom is smaller than the ground's own rift (TUNING.hazards.baseRadius.void is 90): it is
 *  a mark left by one kill, not a hazard the region grew. */
const REGION_DEATH_BLOOM_RADIUS = 60;

/** A nest is legible long before it is live: the ship trips it well inside the vault's notice
 *  radius, so engaging is the player's decision and not the room's. */
const AMBUSH_NEST_TRIGGER_RADIUS = 150;
/** Where a woken nest's wave stands up, measured from the hive. */
const AMBUSH_NEST_RING_RADIUS = 130;
const AMBUSH_NEST_DRAW_RADIUS = 22;

/** A lair is legible from across the room like a nest, and trips a touch further out because
 *  what stands up is one large body rather than a ring the ship can thread. */
const NEMESIS_LAIR_TRIGGER_RADIUS = 160;
const NEMESIS_LAIR_DRAW_RADIUS = 26;
const NEMESIS_LAIR_COLOR = 0xff2233;
/** How long the hunter waits at home before giving up and coming to the player instead. Past
 *  this the shipped 150 s timer fires as it always has and every dormant lair stands down, so
 *  a player who never flies to the den still meets the nemesis. */
const NEMESIS_LAIR_PATIENCE_SECONDS = 360;

/** The world's boss waits in the room the generator built for it. The throne is legible from
 *  across the arena and trips inside the lair's radius: the sector is 1280 x 720, so a ship
 *  can still cross the room without taking the fight. */
const WARDEN_THRONE_TRIGGER_RADIUS = 150;
const WARDEN_THRONE_DRAW_RADIUS = 34;
/** Deliberately not the lair's crimson and not the nest's hazard orange: a den, a hive and a
 *  throne are three different fights, so they must not read the same across a room. */
const WARDEN_THRONE_COLOR = 0xcc44ff;
const WARDEN_THRONE_GLOW = 0xe6b3ff;

/** How the room answers a hold objective. The gap between waves shrinks as the hold nears its
 *  target, so the last stretch is the expensive one rather than the first. */
const SIEGE_WAVE_INTERVAL_START_SECONDS = 24;
const SIEGE_WAVE_INTERVAL_END_SECONDS = 12;
/** A ceiling on the siege's OWN live bodies, under the director's maxEnemies: a player slow to
 *  clear must not accumulate an unwinnable room across a 90 s hold. */
const SIEGE_MAX_LIVE_BESIEGERS = 14;

/** The drone rides slightly above the ship's base 150 px/s, so it keeps up on a cruise, falls
 *  behind a dash or a speed build, and closes the gap the moment the player stops. */
const ESCORT_DRONE_SPEED = 165;
const ESCORT_DRONE_FOLLOW_DISTANCE = 70;
/** Past this it is snapped to the ship: a seam crossing or an outrun must lose the drone to
 *  hostiles, never to geometry it cannot path around. */
const ESCORT_DRONE_TETHER_PX = 900;
const ESCORT_DRONE_MAX_HEALTH = 100;
const ESCORT_DRONE_CONTACT_RADIUS = 60;
const ESCORT_DRONE_DAMAGE_INTERVAL_SECONDS = 0.5;
const ESCORT_DRONE_DAMAGE_PER_ATTACKER = 4;
/** A swarm cannot delete it instantly: at most this many bodies bill it in one tick, so the
 *  worst case is 16 dps and the drone lives 6 s inside a full room. */
const ESCORT_DRONE_MAX_ATTACKERS = 2;
/** A room the player has cleared around the drone heals it, which is what makes a long trip a
 *  thing to manage rather than an attrition timer with one outcome. */
const ESCORT_DRONE_REGEN_PER_SECOND = 3;
const ESCORT_DRONE_DRAW_RADIUS = 11;
/** The player's own projectile core (PROJECTILE_NEON.player.core), so the drone reads as YOURS
 *  against every hostile palette in the game. */
const ESCORT_DRONE_COLOR = 0x66ccff;
/** The drone can be off-camera inside its 900 px tether, so the ring alone is not enough: one
 *  toast says it is under fire, rate-limited so a running fight beside it cannot spam the queue. */
const ESCORT_DRONE_ALERT_COOLDOWN_SECONDS = 20;
/** Contact already suppresses regen while it lasts; a projectile has no duration, so it suppresses
 *  it for a window instead. Without this a lone Shooter's 6 dps loses to a 3 hp/s regen that
 *  resumes the same frame and being shot would cost the drone nothing. */
const ESCORT_DRONE_PROJECTILE_REGEN_LOCKOUT_SECONDS = 2;

/** Doc 03 section 7 moment 2. Ascending, so the highest threshold crossed is the one that
 *  toasts even when a single find jumps two of them. */
const MAP_COMPLETION_MILESTONES = [25, 50, 75, 100] as const;

function highestCompletionMilestone(percent: number): number {
  let reached = 0;
  for (const milestone of MAP_COMPLETION_MILESTONES) {
    if (percent >= milestone) reached = milestone;
  }
  return reached;
}

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

  // Legion members collected during restoreEntities — group state is module-level
  // and does not survive a refresh, so it is rebuilt after the entity pass.
  private restoredLegionMembers: Array<{ entityId: number; generation: number }> = [];

  // Kill counter
  private killCount: number = 0;

  // Entity ID to enemy type ID mapping (for codex kill tracking)
  private enemyTypeMap: Map<number, string> = new Map();

  // Achievement tracking
  private toastManager!: ToastManager;
  private lastAchievementTimeCheck: number = 0; // For throttled time tracking
  private totalDamageTaken: number = 0;
  private totalDamageDealt: number = 0;
  private damageTakenBySource: Map<string, number> = new Map();
  /** Attribution bucket of the lethal hit, set only past the revival branch in takeDamage. */
  private killedBySourceName: string | null = null;
  /** The hunter this run fields, snapshotted at create() so mid-run writes can't swap it. */
  private nemesisRecord: NemesisRecord | null = null;
  /** True once the hunter has been spawned this run (persisted — a refresh must not re-spawn it). */
  private nemesisSpawned = false;
  /** ENEMY_TYPES id of the entity that landed the lethal hit, or null (attacker-less damage). */
  private pendingNemesisTypeId: string | null = null;
  /** Trophy relic unlocked by this run's first-ever kill of its boss, for the victory kicker. */
  private trophyUnlockedThisRun: string | null = null;
  /**
   * Achievements unlocked by the run-end settle, captured for the end screen because
   * their toast draws under it. Null except while a run-end path has armed it, so
   * mid-run unlocks (whose toast IS visible) are never re-listed.
   */
  private runEndAchievements: { name: string; detail: string }[] | null = null;
  /** Per-run beat log for the run-end RUN TIMELINE ribbon. Never persisted. */
  private runTimelineEvents: RunTimelineEvent[] = [];
  /** False while the player is already in the close-call band, so one dip logs one marker. */
  private closeCallArmed: boolean = true;
  /** False for a restored run, whose early beats died with the page. */
  private runTimelineComplete: boolean = true;

  // Player stats and upgrades
  private playerStats!: PlayerStats;
  private upgrades!: Upgrade[];
  private isPaused: boolean = false;
  private pendingLevelUps: number = 0;
  // Relic draft (FEAT-RELIC-DRAFT) — per-run queue of owed relic-choice rounds.
  // pendingRelicChoices: rounds still owed; relicDraftActive: an overlay round is
  // on screen; relicDraftOwnsPause: this flow set isPaused and must release it
  // when the queue drains. Pumped every frame by processRelicChoiceQueue().
  private pendingRelicChoices: number = 0;
  private relicDraftActive: boolean = false;
  private relicDraftOwnsPause: boolean = false;
  // Black Market (FEAT-MARKET) — true while the MarketScene overlay owns the
  // screen and this flow holds isPaused.
  private marketActive: boolean = false;

  // Quest board (FEAT-QUEST-BOARD): true while the QuestBoardScene overlay owns the screen and
  // this flow holds isPaused.
  private questBoardActive: boolean = false;

  // The world map (FEAT-MAPUI-MAPSCENE-04) is a sibling overlay to the pause menu, never a
  // child: exactly one of them owns isPaused at a time.
  private mapOverlayActive: boolean = false;

  // Damage cooldown (invincibility frames)
  private damageCooldown: number = 0;

  // Emergency heal cooldown (triggered at low HP)
  private emergencyHealCooldown: number = 0;

  // Banished upgrades (removed from pool permanently for this run)
  private banishedUpgradeIds: Set<string> = new Set();

  /** Weapons traded away by a REFIT this run. Kept because they were still used this run. */
  private scrappedWeaponIds: string[] = [];

  // Cards the player locked in the current level-up modal — pinned across rerolls
  // and banishes of that same level-up, cleared when a fresh level-up begins.
  private lockedUpgrades: CombinedUpgrade[] = [];

  // Gem magnet timer (auto-vacuum interval)
  private gemMagnetTimer: number = 0;

  // Treasure chest spawn timer
  private treasureSpawnTimer: number = 0;
  // On-field treasure chests (walk-in XP/relic caches). Tracked so they can be
  // persisted across refresh-recovery (mirrors the field shrines) and torn down on
  // reset/shutdown. Position is read live from the graphics (chests drift toward
  // the player via the chest-drone), `isSpecial` is the rare 3x-reward flag.
  private activeChests: ActiveChestRecord[] = [];

  // Environmental destructibles (barrels/crates)
  private destructibleSpawnTimer: number = 12;
  private destructibleCount: number = 0;
  private static readonly DESTRUCTIBLE_INTERVAL = 14;
  private static readonly MAX_DESTRUCTIBLES = 6;

  // Active temporary timed stat buffs (Power shrine + Power Surge damage, Elite
  // Surge XP, Golden Tide gem value). Driven off gameTime so they persist across
  // refresh and revert at the correct moment.
  private timedStatBuffs: TimedStatBuff[] = [];

  /** Scratch the HUD buff strip's bar width is measured against. `buildTimedBuffRows` owns its
   *  contents; the scene only has to hold it across frames and clear it with the buff list. */
  private timedBuffPeakSeconds: Partial<Record<TimedStatField, number>> = {};

  /** Ambush nests, expedition only. World-space and run-scoped like a chest rather than rebuilt
   *  per sector like a vault: a nest carries no per-profile state, so leaving the room must not
   *  reset a fight the player half-won. */
  private activeAmbushNests: ActiveAmbushNest[] = [];
  /** The nemesis lair, expedition only and at most one per world per run. World-space and
   *  run-scoped like a nest. */
  private activeNemesisLairs: ActiveNemesisLair[] = [];
  /** The world's boss, waiting in its arena. Expedition only, one per world, and rebuilt per
   *  sector like a vault rather than kept for the run: nothing about it is persisted, because
   *  `bossSpawned` (which the run save already carries) is the whole of its state. */
  private wardenThrone: {
    graphics: Phaser.GameObjects.Graphics; x: number; y: number;
  } | null = null;
  private wardenThroneSectorKey: string | null = null;
  private escortDrone: {
    graphics: Phaser.GameObjects.Graphics;
    questId: string;
    droneId: string;
    x: number;
    y: number;
    health: number;
  } | null = null;
  private escortDroneSectorKey: string | null = null;
  private escortDroneNextDamageAtSeconds = 0;
  private escortDroneUnderFire = false;
  private escortDroneNextAlertAtSeconds = 0;
  private escortDroneRegenBlockedUntilSeconds = 0;
  /** The blast path's own i-frame clock. The barrage families land many strike points in one
   *  burst, so an ungated path would spend the drone's whole 100 HP in a few frames. */
  private escortDroneNextBlastAtSeconds = 0;
  /** A saved drone waiting for syncEscortDrone to adopt it, keyed by its quest. Held rather than
   *  applied at restore time because the drone is derived from the quest store on the next frame,
   *  never rebuilt by the restore path itself. */
  private restoredEscortDrone: { questId: string; x: number; y: number; health: number } | null = null;
  /** The crate a previous run left behind, while the ship is in the room holding it. Derived
   *  from the quest store like the drone above, never persisted here. */
  private questCargoDrop: {
    graphics: Phaser.GameObjects.Graphics;
    questId: string;
    itemId: string;
    x: number;
    y: number;
  } | null = null;
  private questCargoDropSectorKey: string | null = null;
  // Expedition POI slots already stocked this run, the run's content salt, and whether the
  // one-per-run Black Market has been placed. Persisted (poiState) so a refresh neither
  // re-stocks a looted sector nor re-rolls an unvisited one.
  private spawnedPoiSlotIds: Set<string> = new Set();
  /** Live objects per stocked POI slot, keyed by slot id. Persisted through `poiState.slots`
   *  and rebuilt by relinkRestoredPoiSlots, so a refresh keeps a room's placed rewards. */
  private readonly poiSlotObjects: Map<string, PoiSlotRecord> = new Map();
  private readonly retireCandidates: RetireCandidate[] = [];
  private poiRunSalt: number = 0;
  private poiOncePerRunSpawned: boolean = false;
  /** Owned traversal abilities, cached for the run: every read of the real store is a
   *  SecureStorage decrypt, and both consumers here run per frame. */
  private ownedTraversalAbilityIds: Set<string> = new Set();
  /** Quest keys this profile has earned, cached for the run for the same reason as
   *  ownedTraversalAbilityIds: the real read is a SecureStorage decrypt. */
  private earnedQuestKeyIds: Set<string> = new Set();
  /** Sector keys the player marked on the chart. Cached rather than read in syncRadarWaypoints:
   *  that runs on a timer and each read is a SecureStorage decrypt. Marks can only change while
   *  MapScene holds the pause, so refreshing on its close is exact. */
  private markedSectorKeys: string[] = [];
  /** Sectors already charted in this world when the run bound it, so the run-end debrief can
   *  report what THIS run added. Null on an arena run and on a reload-restored run, which
   *  binds mid-run and would otherwise report the gain since the reload as the run's own. */
  private chartedSectorsAtRunStart: number | null = null;
  /** Wider than ABILITY_DOOR_OPEN_RADIUS (60) on purpose: the notice has to land while the
   *  door is still on screen and before the ship is nose-first against it. */
  private static readonly SEALED_DOOR_NOTICE_RADIUS = 150;
  /** A six-gate world puts the ship back against the same sealed door many times in one run,
   *  so the same edge re-announces only after this much run time. */
  private static readonly SEALED_DOOR_REANNOUNCE_SECONDS = 30;
  private sealedDoorNoticeEdgeId: string | null = null;
  private sealedDoorNoticeAt = 0;
  /** Tight on purpose: PLAYER_COLLISION_RADIUS is 16, so a ship this close to a seam is
   *  nose-first against it rather than merely passing by a sector border. */
  private static readonly BREACH_CHARGE_PLANT_RADIUS = 40;
  /** Doc 04 row 2's "placement delay". The fuse runs on gameTime and is deliberately not
   *  cancelled when the ship leaves: a planted charge is planted. */
  private static readonly BREACH_CHARGE_FUSE_SECONDS = 1.0;
  private breachChargeBarrierId: string | null = null;
  private breachChargeX = 0;
  private breachChargeY = 0;
  private breachChargeDetonatesAt = 0;
  /** Doc 04 section 2 row 3. sprintLevel is the tether's synergy hook and shortens the
   *  re-arm; at that upgrade's maxLevel of 5 it lands exactly on the floor. */
  private static readonly TETHER_COOLDOWN_BASE_SECONDS = 1.2;
  private static readonly TETHER_COOLDOWN_MIN_SECONDS = 0.5;
  private static readonly TETHER_COOLDOWN_PER_SPRINT_LEVEL = 0.14;
  private tetherReadyAt = 0;
  /** A world puts the ship back against the same chasm many times in one run, so the notice
   *  re-arms on run time rather than per gap. */
  private static readonly VOID_GAP_NOTICE_REANNOUNCE_SECONDS = 25;
  private voidGapNoticeAt = Number.NEGATIVE_INFINITY;
  private static readonly PHASE_IFRAME_BASE_SECONDS = 0.5;
  private static readonly PHASE_IFRAME_PER_PHASE_LEVEL = 0.25;
  private static readonly SECURITY_GRID_NOTICE_REANNOUNCE_SECONDS = 25;
  private securityGridNoticeAt = Number.NEGATIVE_INFINITY;

  /** Armed, not zeroed, so entering a strip costs a tick immediately: a 3-tile strip crossed
   *  at base speed would otherwise be free. */
  private hazardFloorTickTimer = TUNING.hazards.floorTickSeconds;
  private static readonly HAZARD_NOTICE_REANNOUNCE_SECONDS = 30;
  private hazardNoticeAt = Number.NEGATIVE_INFINITY;

  // Volatile-affix explosion queue (drained iteratively to avoid recursion)
  private volatileQueue: { x: number; y: number }[] = [];
  private drainingVolatile: boolean = false;

  // Armed Exploder death fuses (BALANCE-EXPLODER-FUSE) — ticked with gameplay
  // delta in update(), cleared in resetInRunFeatureState()
  private exploderFuses: ExploderFuse[] = [];

  // In-run bounties (rotating objectives with rewards)
  private bounty: { kind: BountyKind; target: number; progress: number; timeLeft: number } | null = null;
  private bountyCooldown: number = 20;
  private bountyText: Phaser.GameObjects.Text | null = null;
  private bountyFlawlessBroken: boolean = false;

  // Daily quests, live: folded into the in-progress run once a second so a quest
  // can complete, toast and pay mid-run instead of only at run end.
  private dailyQuestWatcher: DailyQuestWatcher | null = null;
  private lastDailyQuestCheck: number = 0;

  // Expedition quests read kills as a DELTA off this baseline, so a restored run resumes
  // from its saved killCount instead of re-crediting the whole run's kills.
  private expeditionQuestKillBaseline: number = 0;
  // The sector the ship is currently holding and the run time it arrived, so a dwell is
  // derived (gameTime - start) rather than accumulated: no drift, and no per-frame work.
  private expeditionDwellSectorKey: string | null = null;
  private expeditionDwellStartSeconds: number = 0;
  /** The sector the live siege answers for, so re-polling the same room does not re-announce it
   *  and leaving ends it. */
  private siegeSectorKey: string | null = null;
  private siegeNextWaveAtSeconds: number = 0;
  private siegeBesiegerIds: number[] = [];
  private expeditionTickerRows: string[] = [];
  private questTickerRefreshTimer: number = 0;
  private questTickerCycleTimer: number = 0;
  private questTickerIndex: number = 0;

  // Highest map-completion milestone this profile has already been shown for the bound world.
  // Seeded from the live percent at bind time, so a threshold crossed on an earlier run never
  // re-toasts and no storage key is needed to remember it.
  private mapCompletionMilestoneShown: number = 0;
  private sectorBannerText: Phaser.GameObjects.Text | null = null;

  // Pace ghost: the kill curve of the best-scoring run at this world level, and
  // this run's own samples, which replace it if this run scores a new best.
  private paceGhostCurve: number[] | null = null;
  private paceSamples: number[] = [];
  private paceRecordingEnabled: boolean = true;
  private lastPaceCheck: number = 0;
  private paceGhostReplaced: boolean = false;

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
  private ultimateRequestHandler: (() => void) | null = null;
  // Rising-edge tracker for the one-time "ultimate ready" tutorial hint.
  private ultimateWasReady: boolean = false;
  // First-run coach marks: cleanup hook exposed so shutdown can tear down
  // listeners and timers if the player restarts mid-tutorial.
  private coachMarksCleanup: (() => void) | null = null;
  // Run-modifier banner: cleanup hook so shutdown can tear it down if the
  // player restarts before dismissing it.
  private modifierBannerCleanup: (() => void) | null = null;
  // True while any blocking pre-run intro overlay (coach marks / modifier
  // banner) is on screen. Gameplay stays soft-paused until it clears, and
  // input gating (ESC→pause, joystick) is suppressed for the duration.
  private introOverlayActive: boolean = false;
  private pauseRequestHandler: (() => void) | null = null;
  private mapRequestHandler: (() => void) | null = null;
  private autoBuyToggleHandler: (() => void) | null = null;

  // Health drop chance (percentage)
  private readonly HEALTH_DROP_CHANCE: number = TUNING.pickups.healthDropChance;

  // Magnet pickup spawn timing (every 60 seconds, an enemy drops a magnet)
  private magnetSpawnTimer: number = 0;
  private readonly MAGNET_SPAWN_INTERVAL: number = TUNING.pickups.magnetSpawnInterval;
  private nextEnemyDropsMagnet: boolean = false;

  // Card-collection data cache guard: at most ONE cache pickup per run (the
  // reveal is a single end-screen moment). Synced with the manager's persisted
  // pending reveal in both create paths — see syncCacheGuardWithPendingReveal.
  private cacheFoundThisRun: boolean = false;
  /** Orientation flipped while the level-up modal was open — relayout deferred. */
  private pendingOrientationRelayout: boolean = false;

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

  // Weapon evolution level reduction from shop upgrade
  private evolutionLevelReduction: number = 0;

  // Boss warning sequence
  private bossWarningText: Phaser.GameObjects.Text | null = null;
  private bossWarningVignette: Phaser.GameObjects.Graphics | null = null;
  private bossIntroObjects: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text | Phaser.GameObjects.Graphics> = [];
  /** Tween target proxy for the boss-intro accent rules (see showBossEntrance) — tracked separately since it isn't a GameObject. */
  private bossIntroRuleState: { spread: number } | null = null;
  private bossCountdownText: Phaser.GameObjects.Text | null = null;

  // GAUNTLET mode (boss-rush waves; replaces the stage's timed miniboss/boss
  // schedule — trash spawns keep flowing for the XP economy)
  private gauntletModeActive = false;
  private practiceModeActive = false;
  private practiceWeaponLevel = 1;
  private practiceEvolved = false;
  private practiceInvincible = false;
  private practiceBuildDepth = 0;
  private practiceSpawnAffix: EnemyAffixType = EnemyAffixType.NONE;
  private practiceSpawnAffix2: EnemyAffixType = EnemyAffixType.NONE;
  private practiceDock: PracticeDock | null = null;
  private practiceSpawnKeyHandler: (() => void) | null = null;
  private practiceUltimateOverride: PracticeUltimateChoice = null;
  private practiceUltimateKeyHandler: (() => void) | null = null;
  private practiceFight: PracticeFightState | null = null;
  private practiceFightSpawning = false;
  private rematchTarget: RematchTarget | null = null;
  private practiceRematchSeed: PracticeRematchSeed | null = null;
  private pendingRematchSpawn: PracticeDockState | null = null;
  private pendingRematchLaunch: PracticeRematchSeed | null = null;
  private readonly endlessDirector = new EndlessDirector({
    spawnWaveEntry: (kind) => {
      if (kind === 'boss') this.spawnNextBoss();
      else this.spawnRandomMiniboss();
    },
    scheduleWaveEntry: (kind, delayMs) => {
      this.time.delayedCall(delayMs, () => {
        if (kind === 'boss') this.spawnNextBoss();
        else this.spawnRandomMiniboss();
      });
    },
    showWaveBanner: (message, color) => this.showWaveBanner(message, color),
    hudReady: () => !!this.hudManager,
    setTopCenterLabel: (label) => this.hudManager.setTopCenterLabel(label),
    escalateWorldMultipliers: (healthMult, damageMult, xpMult) => {
      this.worldLevelHealthMult *= healthMult;
      this.worldLevelDamageMult *= damageMult;
      this.worldLevelXPMult *= xpMult;
    },
    isPracticeMode: () => this.practiceModeActive,
  });
  private readonly gauntletDirector = new GauntletDirector({
    hasAliveThreat: () => this.hasAliveGauntletThreat(),
    spawnWaveEntry: (kind) => {
      if (kind === 'boss') this.spawnNextBoss();
      else this.spawnRandomMiniboss();
    },
    showWaveBanner: (message, color) => this.showWaveBanner(message, color),
    hudReady: () => !!this.hudManager,
    setTopCenterLabel: (label) => this.hudManager.setTopCenterLabel(label),
    escalateWorldMultipliers: (healthMult, damageMult, xpMult) => {
      this.worldLevelHealthMult *= healthMult;
      this.worldLevelDamageMult *= damageMult;
      this.worldLevelXPMult *= xpMult;
    },
    playerPosition: () => this.playerId === -1
      ? null
      : { x: Transform.x[this.playerId], y: Transform.y[this.playerId] },
    spawnHealthPickup: (x, y, healAmount) => spawnHealthPickup(this.world, x, y, healAmount),
    playGoldSparkle: (x, y, particleCount) => this.effectsManager.playGoldSparkle(x, y, particleCount),
  });

  private readonly bossFightDirector = new BossFightDirector({
    gameTime: () => this.gameTime,
    wardenThroneStanding: () => this.wardenThrone !== null,
    wardenBossTypeId: () => this.expeditionWardenBossTypeId(),
    isDailyMode: () => this.dailyModeActive,
    dailyDateString: () => this.dailyDateString,
    isPracticeMode: () => this.practiceModeActive,
    cleanupBossWarning: () => this.cleanupBossWarning(),
    spawnBoss: (typeId) => this.spawnBoss(typeId),
    spawnBossHazard: (bossTypeId) => this.spawnBossHazard(bossTypeId),
  });

  private enemyProjectileManager!: EnemyProjectileManager;

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
  private activePacts: Pact[] = [];
  private directorStrategy?: DirectorStrategy;
  private threatLevel: number = 0;
  private activeBlessings: Blessing[] = [];

  /** Seconds left on a live recall channel, 0 when none is running. Run-scoped and not
   *  serialized: a reload cancels the channel, it never lands the jump for you. */
  private recallChannelRemaining = 0;
  /** Where the live channel will put the ship, captured when it starts. */
  private recallChannelTarget: { x: number; y: number } | null = null;
  /** Whether the live channel is the outbound leg, so the copy and the anchor bookkeeping can
   *  tell the two directions apart. */
  private recallChannelIsSortie = false;
  /** Where the last recall departed from, and the only place SORTIE will ever put the ship.
   *  Null until a recall leaves a sector other than the hangar; spent by the return leg. */
  private sortieAnchor: { x: number; y: number } | null = null;
  private recallRing: Phaser.GameObjects.Graphics | null = null;
  private phaseBleedRenderer: PhaseBleedRenderer | null = null;
  private hazardDamageMultiplier: number = 1.0;

  // Post-processing pipelines (WebGL only)
  private distortionPipeline: DistortionPipeline | null = null;
  private bloomPipeline: BloomPipeline | null = null;
  private lightingSystem: LightingSystem | null = null;

  // Geometry Wars style warping grid background
  private gridBackground!: GridBackground;
  private parallaxBackground!: ParallaxBackground;

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
  // True once the player has dashed this run — silences the dash tutorial hint.
  private hasDashedThisRun: boolean = false;

  // Status effect visual overlays on enemies
  private statusEffectVisualManager!: StatusEffectVisualManager;
  private eliteAffixVisualManager!: EliteAffixVisualManager;
  private telegraphManager!: TelegraphManager;

  // Off-screen threat directional arrows
  private offScreenIndicatorManager!: OffScreenIndicatorManager;

  // Tactical minimap / threat radar (mid-right HUD edge)
  private minimapManager!: MinimapManager;
  private minimapFeed!: MinimapFeed;
  private abilityVaultManager!: AbilityVaultManager;
  private questBoardManager!: QuestBoardManager;
  private secretCacheManager!: SecretCacheManager;
  private shrineManager!: ShrineManager;

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
  private visibilitySaveHandler: (() => void) | null = null;
  private shouldRestore: boolean = false;
  private resumeIntoPauseMenu: boolean = false;

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
  /** The stage whose palette and hazard bias are in force right now. Equals selectedStageId
   *  in every arena-substrate mode; an expedition moves it as the ship crosses regions. */
  private activeStageId: string = 'stage_deep_void';
  /** The active region's ambient darkness, resolved by applyStageVisuals. Held on the scene
   *  because applyStageVisuals runs BEFORE the LightingSystem is constructed on the
   *  fresh-start path, so the system reads it at construction instead of being pushed to. */
  private activeStageAmbientDarkness: number = BASE_AMBIENT_DARKNESS;
  /** The active region's drift factor, resolved by applyStageVisuals and multiplied into the
   *  player's acceleration every frame. 1 in every region that does not author one. */
  private activeStageDriftFactor: number = 1;
  /** The active region's live wall-shift interval in seconds, resolved by applyStageVisuals.
   *  0 in every region that does not author one, which switches the whole mechanic off. */
  private activeStageWallShiftSeconds: number = 0;
  /** The active region's death-bloom duration in seconds, resolved by applyStageVisuals.
   *  0 in every region that does not author one, which switches the whole mechanic off. */
  private activeStageDeathBloomSeconds: number = 0;
  /** The hazard an elite kill opens in the active region: the region's own signature hazard,
   *  so a bloom can never be a type the ground and the banner do not already promise. */
  private activeStageDeathBloomType: HazardType | null = null;
  /** Seconds in the current room since the last shift. Reset on every sector entry, so a room
   *  the ship only crosses never moves and only a room it stands in does. */
  private regionWallShiftTimer: number = 0;
  /** Live shifts each room has already taken this run, capped per room. Never persisted: the
   *  writes live on the run's WorldMap and are regenerated fresh next expedition. */
  private readonly wallShiftsBySector = new Map<string, number>();
  private draftedBlessingIds: string[] | null = null;
  private worldMode!: WorldModeAdapter;
  // Bound once: updateHazardSpawner takes it every frame and an inline arrow would allocate.
  private readonly hazardSpawnLegality = (x: number, y: number): boolean =>
    this.worldMode.isSpawnableWorldPoint(x, y);
  private playerWallCollision: WallCollisionContext | null = null;

  /**
   * The one place a broken wall becomes permanent. Persisting here rather than inside
   * barrierState is what keeps src/world/ free of the storage layer, and the write happens
   * on the break rather than at run end because a wall broken in a run that ends in death
   * is still broken.
   */
  private readonly barrierEventSink: BarrierEventSink = {
    onBarrierChipped: (x, y) => {
      this.effectsManager.playHitSparks(x, y, Math.random() * Math.PI * 2);
    },
    onBarrierBroken: (x, y, barrierId) => {
      const map = this.worldMode.worldMap();
      if (map) recordBrokenBarrier(map.seed, map.worldGenVersion, barrierId);
      this.worldMode.notifyGeometryChanged();
      this.minimapFeed.invalidateUnderlay();   // a collapsed wall changes the tiles the radar drew
      this.effectsManager.playDeathBurst(x, y, 0xffaa44);
      this.cameras.main.shake(120, 0.008);
      this.soundManager.playComboThreshold();
    },
  };

  /**
   * Discovery is profile memory, so the manager outlives the scene while this handler must
   * not: Phaser reuses the scene's emitter across a restart, so it is added in create and
   * removed in shutdown like every other GameScene subscription.
   */
  private readonly sectorEnteredHandler = (
    payload: { sectorKey: string; viaEdgeId: string | null; fromSectorKey: string | null },
  ): void => {
    const discovery = getDiscoveryManager();
    const changes = discovery.markSectorEntered(payload.sectorKey);
    if (payload.viaEdgeId) discovery.markEdgeTraversed(payload.viaEdgeId);
    this.retireDepartedSector(payload.fromSectorKey);
    this.stockSectorPois(payload.sectorKey);
    // Re-entering the room you are already holding does not restart the hold. Normal play always
    // changes the key, so this only fires after a restore, where the adapter re-announces the
    // current sector on its first frame and would otherwise reset a nearly finished hold to zero.
    if (this.expeditionDwellSectorKey !== payload.sectorKey) {
      this.expeditionDwellSectorKey = payload.sectorKey;
      this.expeditionDwellStartSeconds = this.gameTime;
    }
    const map = this.worldMode.worldMap();
    const sector = map?.sectors.get(payload.sectorKey);
    if (map && sector) {
      const tags = sectorTagsOf(sector);
      this.recordExpeditionQuest({ kind: 'reachDepth', depth: sector.depth });
      this.recordExpeditionQuest({
        kind: 'reachSector',
        sectorKey: payload.sectorKey,
        sectorTags: tags,
        worldStamp: questWorldStamp(map),
      });
      // A delivery lands on ARRIVAL, so the entry event is the producer. An arrival with an empty
      // hold folds to nothing, which is why this is unconditional like the two above it.
      this.recordExpeditionQuest({ kind: 'deliverItem', sectorTags: tags });
      // The chart remembers where the ship got to, so the next expedition's SORTIE has
      // somewhere to go. Never the hangar (a jump into the room a run already starts in is not
      // a trip) and never the boss arena (dropping a level-1 ship into the warden's room at
      // t=0 is the sealed-fight problem beginExpeditionJump already refuses from inside).
      if (payload.sectorKey !== map.startKey && payload.sectorKey !== map.bossArenaKey) {
        recordFieldAnchor(map.seed, map.worldGenVersion, payload.sectorKey);
      }
    }
    // A room the ship only crosses never moves: the interval starts again at every arrival.
    this.regionWallShiftTimer = 0;
    const regionChanged = sector ? this.applySectorStage(sector) : false;
    if (map && sector?.hidden === true && changes.sectorsVisited.includes(payload.sectorKey)) {
      this.announceHiddenSector(sector, map.seed);
    }
    if (sector && changes.sectorsVisited.includes(payload.sectorKey)) {
      this.showSectorBanner(
        sector, regionChanged,
        this.worldMode.bloomedSectorKeys().includes(payload.sectorKey),
        this.worldMode.shiftedSectorKeys().includes(payload.sectorKey),
      );
    }
    this.runDecryptorScan(payload.sectorKey);
    if (payload.viaEdgeId) this.maybeShowExpeditionCrossingHint();
  };

  /** The three discovery events with a live consequence: new outlines pulse the radar, and a
   *  find that moves the completion percent both feeds the lifetime chart record and may cross
   *  a milestone. */
  private readonly discoveryPulseHandler = (changes: DiscoveryChanges): void => {
    if (changes.sectorsVisited.length > 0 || changes.secretsFound.length > 0) {
      const completionPercent = getDiscoveryManager().getCompletionPercent();
      getAchievementManager().recordWorldCompletionPercent(completionPercent);
      this.checkMapCompletionMilestone(completionPercent);
    }
    if (changes.sectorsDiscovered.length === 0) return;
    this.minimapManager?.notifyDiscoveryPulse(changes.sectorsDiscovered.length);
  };

  init(data?: {
    restore?: boolean;
    runMode?: 'arena' | 'expedition';
    /** After a restore, come back up inside the pause menu (UI-scale flow). */
    resumePaused?: boolean;
    startingWeapon?: string;
    modifierIds?: string[];
    blessingIds?: string[];
    pactIds?: string[];
    shipId?: string;
    stageId?: string;
    dailyMode?: boolean;
    dailyDate?: string;
    dailyChallengeType?: 'daily' | 'weekly';
    gauntletMode?: boolean;
    directorStrategy?: DirectorStrategy;
    threatLevel?: number;
    practiceMode?: boolean;
    practiceWeaponLevel?: number;
    practiceEvolved?: boolean;
    practiceRematch?: PracticeRematchSeed;
  }): void {
    this.shouldRestore = data?.restore === true;
    const runMode = this.resolveRunMode(data);
    // Before createWorldMode, because the expedition adapter builds the world in its constructor
    // and reads this count to decide which rooms bloom. Fresh runs only: a restore is the same
    // expedition continuing, and a bump there would move the blooms under the ship mid-run.
    if (runMode === 'expedition' && !this.shouldRestore) {
      advanceExpeditionCount(getCurrentExpeditionSeed(), WORLDGEN_VERSION);
    }
    this.worldMode = this.createWorldMode(runMode);
    this.resumeIntoPauseMenu = data?.resumePaused === true;
    this.startingWeaponId = data?.startingWeapon || 'projectile';
    this.selectedShipId = data?.shipId || 'ship_default';
    this.selectedStageId = data?.stageId || 'stage_deep_void';
    this.dailyModeActive = data?.dailyMode === true;
    // On restore the mode comes from the save's gauntletState, not init data.
    this.gauntletModeActive = data?.gauntletMode === true;
    this.practiceModeActive = data?.practiceMode === true;
    this.practiceWeaponLevel = data?.practiceWeaponLevel ?? 1;
    this.practiceEvolved = data?.practiceEvolved === true;
    this.practiceRematchSeed = data?.practiceRematch ?? null;
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
    // Player-chosen pacts (PactSelectScene). Applied on fresh runs only; on
    // restore the pact effects are already baked into the saved PlayerStats.
    this.activePacts = (data?.pactIds ?? [])
      .map(id => getPactById(id))
      .filter((pact): pact is Pact => pact !== undefined);
    // Player-chosen director strategy (DirectorSelectScene). Undefined on daily/
    // practice/restore, and on "Random" — all of which keep the random roll.
    const requestedStrategy = data?.directorStrategy;
    this.directorStrategy = isDirectorStrategy(requestedStrategy) ? requestedStrategy : undefined;
    this.threatLevel = clampThreatTier(data?.threatLevel);
    // Blessings drafted in BlessingDraftScene (funnel only). Null on every other
    // fresh path (daily/weekly/replay/surprise/practice) -> the create() block
    // auto-rolls as before. Absent on restore (that path reads state.blessingIds).
    this.draftedBlessingIds = Array.isArray(data?.blessingIds) ? data.blessingIds : null;
  }

  /**
   * FEAT-EXPEDITION-PROMOTE (operator decision 2026-07-27, flipped 2026-07-31):
   * expedition IS the default run. An explicit runMode always wins; the fixed-room
   * modes — daily/weekly, practice, gauntlet — stay on the arena substrate they are
   * tuned for; everything else, including a cold profile's first run and the
   * replay/surprise shortcut, starts an expedition. A restore guesses expedition too
   * and create() rebuilds from the save's own mode, so a corrupt save falls through
   * to a fresh run in the correct default rather than in yesterday's.
   */
  private resolveRunMode(data?: {
    runMode?: RunModeKind;
    dailyMode?: boolean;
    gauntletMode?: boolean;
    practiceMode?: boolean;
  }): RunModeKind {
    if (data?.runMode) return data.runMode;
    if (data?.dailyMode || data?.gauntletMode || data?.practiceMode) return 'arena';
    return 'expedition';
  }

  private createWorldMode(mode: RunModeKind): WorldModeAdapter {
    return mode === 'expedition' ? new ExpeditionModeAdapter(this) : new ArenaModeAdapter(this);
  }

  /** Arena has no world map, so it never binds and never subscribes: an arena run cannot
   *  write the discovery key, and the event it would carry is never emitted there. */
  private bindExpeditionDiscovery(): void {
    this.markedSectorKeys = [];
    this.chartedSectorsAtRunStart = null;
    const map = this.worldMode.worldMap();
    if (!map) return;
    this.ownedTraversalAbilityIds = new Set(getOwnedTraversalAbilityIds());
    this.earnedQuestKeyIds = new Set(
      getHeldWorldKeyIds(map.seed, map.worldGenVersion));
    this.markedSectorKeys = [...getSectorMarks(map.seed, map.worldGenVersion).keys()];
    getDiscoveryManager().bindWorld(map);
    if (!this.shouldRestore) {
      this.chartedSectorsAtRunStart = getDiscoveryManager().getVisitedSectorCount();
    }
    // A fresh expedition inherits one jump back to where the last one ended. Never on a
    // restore: that run's own anchor is already in the save, spent or unspent, and re-seeding
    // here would refund a jump the player has taken every time the page reloads.
    // The survey's plan is drained on BOTH paths and only used on the fresh one: pressing LAUNCH
    // and then cancelling the save-loss confirmation must not leave a pick armed for some later
    // run. An arena run never reaches here (no map), which is why a daily challenge taken between
    // planning and launching does not eat the plan.
    const plannedSortie = consumePlannedSortie();
    if (!this.shouldRestore) this.seedSortieAnchorFromChart(map, plannedSortie);
    const completionPercent = getDiscoveryManager().getCompletionPercent();
    this.mapCompletionMilestoneShown = highestCompletionMilestone(completionPercent);
    // A profile that charted before this shipped reads correct on its first bind instead of
    // only after its next find. Monotone, so a bind can never lower the record.
    getAchievementManager().recordWorldCompletionPercent(completionPercent);
    getDiscoveryManager().onDiscovery(this.discoveryPulseHandler);
    this.events.on('expedition:sector-entered', this.sectorEnteredHandler);
  }

  /**
   * Where the between-runs survey pointed this run's seeded sortie, or null when it pointed
   * nowhere legal. Re-checked here rather than trusted from MapScene for the reason
   * resolveSortieDestination records: the ability-gate ordering is a solvability invariant
   * (README sections 1.5 and 3.6), and this input arrives through a module-level global.
   *
   * Plotted from map.startKey and not from the player, because a fresh expedition always starts
   * at the hangar and the survey measured its own course from there too, so both ends judge the
   * identical trip. The boss arena is refused for the reason the field anchor refuses to record
   * it: arriving spawns the Warden and the seal then blocks recall.
   */
  private resolvePlannedSortieKey(map: WorldMap, plan: PlannedSortie | null): string | null {
    if (plan === null) return null;
    if (plan.worldSeed !== map.seed || plan.worldGenVersion !== map.worldGenVersion) return null;
    if (plan.sectorKey === map.bossArenaKey) return null;
    if (!map.sectors.has(plan.sectorKey)) return null;
    const discovery = getDiscoveryManager();
    const course = plotSectorCourse({
      map,
      fromSectorKey: map.startKey,
      toSectorKey: plan.sectorKey,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      edgeFlagsOf: (edgeId) => discovery.getEdgeFlags(edgeId),
      holdsAbility: (abilityId) => this.ownedTraversalAbilityIds.has(abilityId),
      holdsQuestKey: (keyId) => this.earnedQuestKeyIds.has(keyId),
    });
    return course.kind === 'plotted' ? plan.sectorKey : null;
  }

  /**
   * The one SORTIE a fresh expedition starts with: the room the survey picked, or the chart's
   * field anchor, the last room a previous run reached in this world. The anchor is the PERMIT
   * either way — no anchor, no sortie, whatever was planned — so picking a destination between
   * runs can never buy a jump the profile had not already earned.
   *
   * The sector CENTRE rather than a remembered point, because a stored point can be inside rock
   * that an ambient stir dropped on it while the room's key cannot move; the arrival snaps
   * through the same freeSpotNear a recall does.
   */
  private seedSortieAnchorFromChart(map: WorldMap, plan: PlannedSortie | null): void {
    const anchorKey = getFieldAnchor(map.seed, map.worldGenVersion);
    if (anchorKey === null) return;
    const plannedKey = this.resolvePlannedSortieKey(map, plan);
    const destinationKey = plannedKey ?? anchorKey;
    const sector = map.sectors.get(destinationKey);
    const coord = parseSectorKey(destinationKey);
    if (!sector || !coord) return;
    const centre = sectorCenterWorld(coord);
    this.sortieAnchor = { x: centre.x, y: centre.y };
    this.toastManager?.showToast({
      tier: 'notable',
      title: plannedKey === null ? 'SORTIE READY' : 'SORTIE PLOTTED',
      description: plannedKey === null
        ? `The chart holds SECTOR ${destinationKey}, DEPTH ${sector.depth}.`
          + ' Open the map to fly straight back.'
        : `You picked SECTOR ${destinationKey}, DEPTH ${sector.depth}.`
          + ' Open the map and SORTIE to fly straight there.',
      icon: 'rocket',
      color: ACCENT_COLORS.primary,
      duration: 3600,
    });
  }

  /** What the death screen says about the world. Undefined in every arena-substrate mode,
   *  where there is no world: the adapter is rebuilt from the save's own runMode on a
   *  restore, so `kind` is right on both paths. */
  private buildExpeditionDebrief(): ExpeditionDebrief | undefined {
    if (this.worldMode.kind !== 'expedition') return undefined;
    const discovery = getDiscoveryManager();
    const sectorsCharted = discovery.getVisitedSectorCount();
    const completionPercent = discovery.getCompletionPercent();
    const seasonIndex = getCurrentExpeditionSeasonIndex();
    // The menu cannot generate a world in create(), and a run is the only thing that moves these
    // numbers, so the run end is where the between-runs surfaces get them from.
    const map = this.worldMode.worldMap();
    if (map) {
      recordLiveWorldProgress({
        seed: map.seed,
        worldGenVersion: map.worldGenVersion,
        completionPercent,
        sectorsCharted,
        secretsFound: discovery.getFoundSecretCount(),
      });
    }
    const { record, isNewBest } = recordExpeditionCompletion(completionPercent, seasonIndex);
    return {
      seasonIndex,
      completionPercent,
      sectorsCharted,
      knowableSectors: discovery.getKnowableSectorCount(),
      chartedThisRun: this.chartedSectorsAtRunStart === null
        ? null
        : sectorsCharted - this.chartedSectorsAtRunStart,
      bestPercent: record.bestPercent,
      bestSeasonIndex: record.bestSeasonIndex,
      isNewBest,
    };
  }

  /**
   * The map pauses the game (03-discovery-map-ui.md section 4.2): at 100+ live enemies a map
   * you cannot afford to read punishes the exploration loop it exists to reward.
   */
  private openExpeditionMap(): void {
    const map = this.worldMode.worldMap();
    if (!map) return;
    if (this.isPaused || this.isGameOver || this.mapOverlayActive) return;
    if (this.introOverlayActive || this.playerId === -1) return;
    const container = this.playerSpaceship.getContainer();
    this.mapOverlayActive = true;
    this.isPaused = true;
    this.scene.launch('MapScene', {
      returnTo: 'GameScene',
      map,
      playerWorldX: container.x,
      playerWorldY: container.y,
      playerFacing: this.playerSpaceship.getFacingAngle(),
      ownedAbilityIds: [...this.ownedTraversalAbilityIds],
      earnedQuestKeyIds: [...this.earnedQuestKeyIds],
      hazardSectors: this.dormantHazardSectors(),
      spentNestSectorKeys: this.spentAmbushNestSectorKeys(),
      bloomedSectors: this.worldMode.bloomedSectorKeys(),
      shiftedSectors: this.worldMode.shiftedSectorKeys(),
      recallAvailable: !this.worldMode.isSectorLocked(),
      sortieAvailable: this.sortieAnchor !== null,
      sortieAnchorSectorKey: this.sortieAnchor === null
        ? null
        : sectorKey(sectorOfWorldPoint(this.sortieAnchor.x, this.sortieAnchor.y)),
    });
    this.scene.pause();
  }

  /** Which rooms the chart may name as holding a dormant risk room. Nests first, then lairs,
   *  then the warden, so a sector holding more than one reads as the rarest and most
   *  dangerous of them. The warden is derived from the map rather than from a materialized
   *  throne (which exists only while the ship is in the room) because the arena is already
   *  named on the chart: saying the fight is still standing there leaks nothing. */
  private dormantHazardSectors(): { sectorKey: string; kind: PoiHazardKind }[] {
    const byKey = new Map<string, PoiHazardKind>();
    for (const nest of this.activeAmbushNests) {
      if (nest.awake) continue;
      byKey.set(sectorKey(sectorOfWorldPoint(nest.x, nest.y)), 'nest');
    }
    for (const lair of this.activeNemesisLairs) {
      if (lair.awake) continue;
      byKey.set(sectorKey(sectorOfWorldPoint(lair.x, lair.y)), 'lair');
    }
    const map = this.worldMode.worldMap();
    if (map && !this.bossFightDirector.hasSpawned()) byKey.set(map.bossArenaKey, 'warden');
    return [...byKey].map(([key, kind]) => ({ sectorKey: key, kind }));
  }

  /** Rooms whose permanent hive this run has already taken: the slot was stocked (spawnedPoiSlotIds
   *  is per-run and persisted) and no hive stands there now. A slot is stocked once per run, so a
   *  cleared hive does not re-arm until the next expedition and a pin on it would point at a broken
   *  chest. A WOKEN nest is deliberately not spent: the fight the objective wants is still live. */
  private spentAmbushNestSectorKeys(): string[] {
    const map = this.worldMode.worldMap();
    if (!map) return [];
    const liveNestSectorKeys = new Set(
      this.activeAmbushNests.map(nest => sectorKey(sectorOfWorldPoint(nest.x, nest.y))),
    );
    const discovery = getDiscoveryManager();
    const spent: string[] = [];
    for (const sector of map.sectors.values()) {
      if (liveNestSectorKeys.has(sector.key)) continue;
      for (const slot of sector.poiSlots) {
        if (!this.spawnedPoiSlotIds.has(slot.id)) continue;
        if ((discovery.getPoiFlags(slot.id) & PoiFlags.HAZARD_NEST) === 0) continue;
        spent.push(sector.key);
        break;
      }
    }
    return spent;
  }

  /** Called by MapScene before it resumes this scene, so the resume handler sees no pause
   *  left to explain and the run comes straight back live instead of into the pause menu. */
  closeExpeditionMap(): void {
    this.mapOverlayActive = false;
    this.isPaused = false;
    const map = this.worldMode.worldMap();
    if (map) this.markedSectorKeys = [...getSectorMarks(map.seed, map.worldGenVersion).keys()];
    this.minimapFeed.invalidateWaypoints();
  }

  /**
   * Where a chart-chosen SORTIE lands. Null destination, an unknown room, an uncharted room, the
   * boss arena, or a room this profile cannot currently fly to all fall back to the anchor, so the
   * jump is never worse than the one that shipped.
   *
   * The course is re-plotted here rather than trusted from MapScene because this method is reached
   * through a public one and the ability-gate ordering is a solvability invariant (README sections
   * 1.5 and 3.6): a destination behind a door this profile cannot open would skip a gate the whole
   * generator exists to guarantee. MapScene checking it too is what makes the button honest; this
   * check is what makes the API safe.
   *
   * The sector CENTRE and not a point inside it, for the reason seedSortieAnchorFromChart records:
   * a stored point can be inside rock an ambient stir or a live wall shift dropped on it, while a
   * room's key cannot move.
   */
  private resolveSortieDestination(destinationSectorKey?: string): { x: number; y: number } | null {
    if (destinationSectorKey === undefined) return this.sortieAnchor;
    const map = this.worldMode.worldMap();
    if (map === null) return this.sortieAnchor;
    // The same room the field anchor refuses to record (:1186): arriving spawns the Warden and the
    // seal then blocks recall, so a one-press path into it from the hangar is the trap that rule
    // already prevents.
    if (destinationSectorKey === map.bossArenaKey) return this.sortieAnchor;
    const coord = parseSectorKey(destinationSectorKey);
    if (coord === null || !map.sectors.has(destinationSectorKey)) return this.sortieAnchor;
    const discovery = getDiscoveryManager();
    const course = plotSectorCourse({
      map,
      fromSectorKey: sectorKey(sectorOfWorldPoint(
        Transform.x[this.playerId], Transform.y[this.playerId])),
      toSectorKey: destinationSectorKey,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      edgeFlagsOf: (edgeId) => discovery.getEdgeFlags(edgeId),
      holdsAbility: (abilityId) => this.ownedTraversalAbilityIds.has(abilityId),
      holdsQuestKey: (keyId) => this.earnedQuestKeyIds.has(keyId),
    });
    if (course.kind !== 'plotted') return this.sortieAnchor;
    const centre = sectorCenterWorld(coord);
    return { x: centre.x, y: centre.y };
  }

  /**
   * The body both directions share. Recall and sortie are one verb with one cost, so a player
   * learns the rule once and neither direction can drift away from the other.
   *
   * The boss-lock refusal is a correctness constraint and not a balance taste (README section
   * 4.1): teleporting out of a sealed room strands the lock with the boss alive inside it.
   */
  private beginExpeditionJump(kind: 'recall' | 'sortie', destinationSectorKey?: string): boolean {
    const isSortie = kind === 'sortie';
    // The anchor is the PERMIT and not only the address: it is read before any chosen destination
    // is, so picking where to land can never buy a jump the run had not already earned.
    if (isSortie && this.sortieAnchor === null) return false;
    const target = isSortie
      ? this.resolveSortieDestination(destinationSectorKey)
      : this.worldMode.playerStartPoint();
    if (target === null) return false;
    if (this.worldMode.worldMap() === null) return false;
    if (this.isGameOver || this.playerId === -1) return false;
    if (this.recallChannelRemaining > 0) return false;
    const label = isSortie ? 'SORTIE' : 'RECALL';
    if (this.worldMode.isSectorLocked()) {
      this.soundManager.playError();
      this.toastManager?.showToast({
        tier: 'critical',
        title: `${label} BLOCKED`,
        description: 'The room is sealed. Finish the fight first.',
        icon: 'rocket',
        color: ACCENT_COLORS.danger,
        duration: 2800,
      });
      return false;
    }

    this.recallChannelTarget = { x: target.x, y: target.y };
    this.recallChannelIsSortie = isSortie;
    this.recallChannelRemaining = TUNING.player.recallChannelSeconds;
    this.toastManager?.showToast({
      tier: 'critical',
      title: `${label} ENGAGED`,
      description: `Hold steady for ${TUNING.player.recallChannelSeconds} seconds.`
        + ' A hit breaks the lock.',
      icon: 'rocket',
      color: ACCENT_COLORS.primary,
      duration: 2600,
    });
    return true;
  }

  /** Called by MapScene when the player triggers RECALL. Returns false when the run refuses it. */
  beginExpeditionRecall(): boolean {
    return this.beginExpeditionJump('recall');
  }

  /**
   * Called by MapScene when the player triggers SORTIE, the return leg of a recall. Returns false
   * when the run refuses it, including when no recall has left an anchor this run. The optional
   * destination is the chart's focused room; anything the resolver rejects falls back to the anchor.
   */
  beginExpeditionSortie(destinationSectorKey?: string): boolean {
    return this.beginExpeditionJump('sortie', destinationSectorKey);
  }

  private cancelExpeditionRecall(reason: string): void {
    if (this.recallChannelRemaining <= 0) return;
    const label = this.recallChannelIsSortie ? 'SORTIE' : 'RECALL';
    this.recallChannelRemaining = 0;
    this.recallChannelTarget = null;
    this.recallChannelIsSortie = false;
    this.recallRing?.setVisible(false);
    this.soundManager.playError();
    this.toastManager?.showToast({
      tier: 'critical',
      title: `${label} BROKEN`,
      description: reason,
      icon: 'rocket',
      color: ACCENT_COLORS.danger,
      duration: 2600,
    });
  }

  /** Where a recall departed from, so the return leg has somewhere to go. A departure from the
   *  hangar itself records nothing: a sortie into the room the ship is already standing in is not
   *  a trip, and keeping the previous anchor would be worse, because it would fly the ship
   *  somewhere it never asked to return to. */
  private rememberSortieAnchor(): void {
    const map = this.worldMode.worldMap();
    if (!map) {
      this.sortieAnchor = null;
      return;
    }
    const fromX = Transform.x[this.playerId];
    const fromY = Transform.y[this.playerId];
    this.sortieAnchor = sectorKey(sectorOfWorldPoint(fromX, fromY)) === map.startKey
      ? null
      : { x: fromX, y: fromY };
  }

  /**
   * Ticked before worldMode.update so the arrival frame is the frame the adapter sees the new
   * sector in, which is what makes the arrival's expedition:sector-entered land immediately
   * rather than a frame later.
   */
  private updateExpeditionRecall(deltaSeconds: number): void {
    this.recallChannelRemaining -= deltaSeconds;
    if (this.recallChannelRemaining > 0) {
      this.drawRecallRing(
        1 - this.recallChannelRemaining / TUNING.player.recallChannelSeconds,
      );
      return;
    }

    this.recallChannelRemaining = 0;
    this.recallRing?.setVisible(false);

    const isSortie = this.recallChannelIsSortie;
    const target = this.recallChannelTarget ?? this.worldMode.playerStartPoint();
    this.recallChannelTarget = null;
    this.recallChannelIsSortie = false;

    // Read before the ship moves. The outbound leg spends the anchor, because a recall buys one
    // return and not a shuttle; the inbound leg records a fresh one.
    if (isSortie) this.sortieAnchor = null;
    else this.rememberSortieAnchor();

    // Snapped the way a restored transform is: a saved point can be stale against geometry that
    // changed under it, and freeSpotNear is this repo's single answer for "where does the ship
    // fit". A fresh recall target is already legal, so the snap is a no-op there.
    const arrival: WorldPoint = { x: target.x, y: target.y };
    this.worldMode.freeSpotNear(target.x, target.y, arrival);

    Transform.x[this.playerId] = arrival.x;
    Transform.y[this.playerId] = arrival.y;
    Velocity.x[this.playerId] = 0;
    Velocity.y[this.playerId] = 0;
    this.clearPlayerKnockback();
    // The container as well as the Transform, the restoreGameState precedent: the adapter
    // reads the container to decide which sector the ship is in, and the camera follows it.
    this.playerSpaceship.getContainer().setPosition(arrival.x, arrival.y);
    this.worldMode.jumpViewTo(arrival.x, arrival.y);

    this.effectsManager.playDeathBurst(arrival.x, arrival.y, PLAYER_NEON.glow);
    this.cameras.main.shake(120, 0.004);
    this.soundManager.playSynergyActivation();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: isSortie ? 'BACK IN THE FIELD' : 'RECALLED',
      description: isSortie
        ? `The ship is in SECTOR ${sectorKey(sectorOfWorldPoint(arrival.x, arrival.y))}.`
          + ' The push continues.'
        : 'The hangar has the ship. The expedition continues.',
      icon: 'rocket',
      color: ACCENT_COLORS.primary,
      duration: 3000,
    });
    // Autosave is on a 30 s timer, so without this a reload seconds after arriving would
    // resume the run wherever the ship was before the jump.
    this.saveGameState();
  }

  private drawRecallRing(fraction: number): void {
    if (!this.recallRing) {
      this.recallRing = this.add.graphics();
      this.recallRing.setDepth(9);
    }
    const ring = this.recallRing;
    ring.setVisible(true);
    ring.clear();
    ring.lineStyle(3, PLAYER_NEON.glow, 0.9);
    ring.beginPath();
    ring.arc(
      Transform.x[this.playerId],
      Transform.y[this.playerId],
      34,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * fraction,
    );
    ring.strokePath();
  }

  create(): void {
    // Register shutdown event listener for proper cleanup on scene restart/stop
    // This is critical - Phaser doesn't automatically call shutdown() methods
    this.events.once('shutdown', this.shutdown, this);
    this.playerWallCollision = null;

    // Ahead of the restore branch below, which returns early: both paths need it.
    this.enemyProjectileManager = new EnemyProjectileManager(this, {
      worldMap: () => this.worldMode.worldMap(),
      viewRect: () => this.worldMode.viewRect(),
      playerPosition: () => this.playerId === -1
        ? null
        : { x: Transform.x[this.playerId], y: Transform.y[this.playerId] },
      escortDronePosition: () => this.escortDrone,
      damagePlayer: (amount, sourceLabel) => this.takeDamage(amount, undefined, sourceLabel),
      damageEscortDrone: (damage, hitX, hitY, travelAngle) =>
        this.damageEscortDroneByProjectile(damage, hitX, hitY, travelAngle),
      playerDamageReady: () => this.damageCooldown <= 0,
      shakeCamera: (durationMs, intensity) => this.shakeCamera(durationMs, intensity),
    });

    // Check for restore mode first
    let saveState: GameSaveState | null = null;
    if (this.shouldRestore) {
      saveState = getGameStateManager().load();
      if (saveState) {
        // A restored run's mode is the one it was saved in, never the one init() guessed,
        // and the adapter has to exist before the field rect below is read off it. A
        // refresh, a UI-scale change and an orientation flip all land here. Rebuilt only
        // on a real mismatch: an expedition adapter generates its whole world in its
        // constructor (~32 ms measured), and init() already built the right one whenever
        // the guess and the save agree. `?? 'arena'` is the documented v1/v2 contract: an
        // arena save of either version stores no runMode at all.
        if ((saveState.runMode ?? 'arena') !== this.worldMode.kind) {
          this.worldMode = this.createWorldMode(saveState.runMode ?? 'arena');
        }
      } else {
        // Fall through to normal init if load failed
        console.warn('Failed to load save state, starting fresh game');
        this.shouldRestore = false;
      }
    }

    // Set dynamic game bounds for systems that need screen dimensions
    setEnemyAIFieldRect(this.worldMode.fieldRect());

    // Listen for resize events (orientation change, Safari address bar collapse)
    this.scale.on('resize', this.handleResize, this);

    // Above the restore branch on purpose: Phaser reuses the scene instance across a restart, so
    // a restored run would otherwise inherit the previous run's spent wall-shift budget.
    this.regionWallShiftTimer = 0;
    this.wallShiftsBySector.clear();

    if (saveState) {
      this.restoreGameState(saveState);
      return;
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
    // Built before the reset below, which is the first thing that clears a field POI.
    this.createFieldPoiManagers();
    this.resetInRunFeatureState();
    this.totalDamageTaken = 0;
    this.totalDamageDealt = 0;
    this.damageTakenBySource.clear();
    this.killedBySourceName = null;
    this.pendingNemesisTypeId = null;
    this.nemesisSpawned = false;
    this.nemesisRecord = this.loadRunNemesis();
    this.lastAchievementTimeCheck = 0;
    this.runEndAchievements = null;
    this.pendingBossHealthBars = [];

    // Initialize achievement tracking for this run
    const achievementManager = getAchievementManager();
    achievementManager.startNewRun();
    this.toastManager = getToastManager(this);
    this.toastManager.resetSession();

    // Single-source hidden unlocks. Evaluator fires this per new unlock, so the end-of-run
    // loop no longer needs to iterate results itself. Tiered `notable` because it only ever
    // fires at run end, under the pause overlay (HUD depth 1000 vs 2100), where a toast has
    // never been visible: the unlock is kept for the run-end screen instead.
    getHiddenUnlockManager().setOnNewUnlock((condition) => {
      this.toastManager.showToast({
        tier: 'notable',
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
        // Only non-null while a run-end path has armed it: that toast is drawn under
        // the end overlay, so the end screen names it instead.
        this.runEndAchievements?.push({
          name: achievement.name,
          detail: rewardParts.join(' + ') || achievement.description,
        });
      }
    );

    this.damageCooldown = 0;
    this.hazardFloorTickTimer = TUNING.hazards.floorTickSeconds;
    this.hazardNoticeAt = Number.NEGATIVE_INFINITY;
    // Carried over from FEAT-BARRIER-DOOR-READOUT (49a71a8), which assumed a restart cleared
    // these: a stale gameTime here suppresses the first sealed-door notice of the next run.
    this.sealedDoorNoticeEdgeId = null;
    this.sealedDoorNoticeAt = 0;
    this.breachChargeBarrierId = null;
    this.breachChargeDetonatesAt = 0;
    this.tetherReadyAt = 0;
    this.voidGapNoticeAt = Number.NEGATIVE_INFINITY;
    this.securityGridNoticeAt = Number.NEGATIVE_INFINITY;
    this.isGameOver = false;
    this.isPaused = false;
    // Scene restarts reuse this instance — a restart IS the flip's relayout,
    // so any deferred-orientation flag is stale by definition here.
    this.pendingOrientationRelayout = false;
    this.introOverlayActive = false;
    this.hasWon = false;
    this.practiceInvincible = false;
    this.practiceBuildDepth = 0;
    this.practiceSpawnAffix = EnemyAffixType.NONE;
    this.practiceSpawnAffix2 = EnemyAffixType.NONE;
    this.practiceFight = null;
    this.practiceFightSpawning = false;
    this.rematchTarget = null;
    this.pendingRematchSpawn = null;
    this.pendingRematchLaunch = null;
    this.syncCacheGuardWithPendingReveal();
    this.magnetSpawnTimer = 0;
    this.bossFightDirector.resetForNewRun();
    // Scene restarts reuse this instance — drop refs to intro objects the
    // previous run's shutdown already destroyed.
    this.bossIntroObjects = [];
    this.bossIntroRuleState = null;
    this.bossCountdownText = null;
    this.endlessDirector.resetForNewRun();
    // gauntletModeActive itself comes from init data — only the progression resets.
    this.gauntletDirector.resetForNewRun(this.gauntletModeActive);
    this.enemyProjectileManager.clear();
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
    // Parallax depth layers behind the grid (fixed camera → driven by player offset)
    this.parallaxBackground = new ParallaxBackground(this);
    this.parallaxBackground.setQuality(this.visualQuality);
    this.applyStageVisuals();

    // Initialize motion trail system
    this.trailManager = new TrailManager(this);

    // Initialize death ripple system
    this.deathRippleManager = new DeathRippleManager(this);
    this.deathRippleManager.setWorld(this.world);
    this.deathRippleManager.setQuality(this.visualQuality);
    this.deathRippleManager.setViewRectProvider(() => this.worldMode.viewRect());

    // Initialize boss arena and hazard zone systems
    setBossArenaScene(this);
    setHazardZoneScene(this);
    setHazardZoneQuality(this.visualQuality);
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
    // applyStageVisuals runs before this on the fresh-start path, so the region's darkness
    // is already resolved and has to be read here rather than pushed from there.
    this.lightingSystem.setAmbientDarkness(this.activeStageAmbientDarkness);
    // Start with quality-appropriate settings
    if (this.visualQuality === 'low') {
      this.lightingSystem.setEnabled(false);
    }

    // Initialize status effect visual overlays (burn/freeze/poison on enemies)
    this.statusEffectVisualManager = new StatusEffectVisualManager(this);
    this.statusEffectVisualManager.setWorld(this.world);
    this.statusEffectVisualManager.setQuality(this.visualQuality);

    this.eliteAffixVisualManager = new EliteAffixVisualManager(this);
    this.eliteAffixVisualManager.setWorld(this.world);
    this.eliteAffixVisualManager.setQuality(this.visualQuality);

    this.telegraphManager = new TelegraphManager(this);
    this.telegraphManager.setQuality(this.visualQuality);
    setTelegraphManager(this.telegraphManager);
    setNavigationContext(this.worldMode.navigationContext());
    setBarrierEventSink(this.barrierEventSink);
    this.bindExpeditionDiscovery();
    this.startExpeditionQuestRun();

    // Initialize off-screen threat indicators
    this.offScreenIndicatorManager = new OffScreenIndicatorManager(this);
    this.offScreenIndicatorManager.setWorld(this.world);

    // Initialize the tactical minimap / threat radar
    this.createMinimapFeed();

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
    // Barrier Capacity sells "+N max shield charges" outright, so they must be real
    // without also winning the rare in-run Shield Barrier roll — every reader of a
    // charge is gated on shieldBarrierEnabled. Recharge stays at the 8.0s default,
    // which is exactly Shield Barrier level 1: that upgrade still sells the speed.
    if (this.playerStats.maxShieldCharges > 0) {
      this.playerStats.shieldBarrierEnabled = true;
      this.playerStats.shieldCharges = this.playerStats.maxShieldCharges;
    }

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

    // ═══ CARD COLLECTION BONUSES ═══
    // Small permanent passives from discovered cards, layered multiplicatively
    // on top of the shop tracks (cards are seasoning, the shop is the meal).
    // startAtLevel feeds the STARTING LEVEL block below.
    const cardBonuses = getCardCollectionManager().getAggregatedBonuses();
    setUltimateChargeRateMultiplier(cardBonuses.ultChargeRateMult);
    this.playerStats.damageMultiplier *= cardBonuses.damageMult;
    this.playerStats.attackSpeedMultiplier *= cardBonuses.attackSpeedMult;
    this.playerStats.goldMultiplier *= cardBonuses.goldMult;
    this.playerStats.xpMultiplier *= cardBonuses.xpMult;
    this.playerStats.pickupRange *= cardBonuses.magnetRadiusMult;
    this.playerStats.moveSpeed *= cardBonuses.moveSpeedMult;
    this.playerStats.maxHealth += cardBonuses.maxHealthAdd;
    this.playerStats.currentHealth = this.playerStats.maxHealth;
    this.playerStats.critChance += cardBonuses.critChanceAdd;
    this.playerStats.armor += cardBonuses.armorAdd;
    this.playerStats.luck += cardBonuses.luckAdd;
    this.playerStats.rerollsRemaining += cardBonuses.rerollsAdd;
    this.playerStats.banishesRemaining += cardBonuses.banishesAdd;

    // ═══ BOOST CARD (one-run consumable — flux cache, FEAT-CARDS-3) ═══
    // Consumed on FRESH starts only — the restore path returns early above,
    // so a boost armed mid-run survives save-restore of the CURRENT run
    // untouched. Applied the same way as the permanent card bonuses (mults
    // multiply, adds add); startAtLevel maxes into the STARTING LEVEL block
    // below alongside the cards' contribution.
    const armedBoost = getBoostCardManager().consumePending();
    if (armedBoost) {
      const boostBonus = armedBoost.bonus;
      setUltimateChargeRateMultiplier(
        cardBonuses.ultChargeRateMult * (boostBonus.ultChargeRateMult ?? 1)
      );
      this.playerStats.damageMultiplier *= boostBonus.damageMult ?? 1;
      this.playerStats.attackSpeedMultiplier *= boostBonus.attackSpeedMult ?? 1;
      this.playerStats.goldMultiplier *= boostBonus.goldMult ?? 1;
      this.playerStats.xpMultiplier *= boostBonus.xpMult ?? 1;
      this.playerStats.pickupRange *= boostBonus.magnetRadiusMult ?? 1;
      this.playerStats.moveSpeed *= boostBonus.moveSpeedMult ?? 1;
      this.playerStats.maxHealth += boostBonus.maxHealthAdd ?? 0;
      this.playerStats.currentHealth = this.playerStats.maxHealth;
      this.playerStats.critChance += boostBonus.critChanceAdd ?? 0;
      this.playerStats.armor += boostBonus.armorAdd ?? 0;
      this.playerStats.luck += boostBonus.luckAdd ?? 0;
      this.playerStats.rerollsRemaining += boostBonus.rerollsAdd ?? 0;
      this.playerStats.banishesRemaining += boostBonus.banishesAdd ?? 0;
      this.toastManager.showToast({
        tier: 'notable',
        title: 'BOOST ACTIVE',
        description: `${armedBoost.name} — ${armedBoost.description} this run`,
        icon: armedBoost.icon,
        color: 0xffd24a,
        duration: 4000,
      });
    }

    // ═══ RUN MODIFIERS ═══
    for (const modifier of this.activeModifiers) {
      modifier.apply(this.playerStats);
    }

    // ═══ PRE-RUN PACTS (player-chosen curses for bigger rewards) ═══
    for (const pact of this.activePacts) {
      pact.apply(this.playerStats);
    }

    // ═══ BLESSINGS (shop `blessingLevel` — N run-start gifts) ═══
    // Drafted in BlessingDraftScene when the funnel offered a choice; otherwise
    // auto-rolled (daily/weekly/replay/surprise/practice). An unbought profile
    // gets none either way. PLAY AGAIN re-enters via the funnel or re-rolls.
    this.activeBlessings = this.draftedBlessingIds !== null
      ? this.draftedBlessingIds
          .map(id => getBlessingById(id))
          .filter((blessing): blessing is Blessing => blessing !== undefined)
      : selectBlessings(metaManager.getStartingBlessingCount());
    for (const blessing of this.activeBlessings) {
      blessing.apply(this.playerStats);
    }
    if (this.activeBlessings.length > 0) {
      const firstBlessing = this.activeBlessings[0];
      this.toastManager.showToast({
        tier: 'notable',
        title: this.activeBlessings.length === 1 ? 'BLESSED' : `BLESSED ×${this.activeBlessings.length}`,
        description: this.activeBlessings.map(blessing => `${blessing.name} (${blessing.description})`).join(' · '),
        icon: firstBlessing.icon,
        color: firstBlessing.color,
        duration: 4000,
      });
    }

    // ═══ MEMORY (shop `upgradeKeepLevel` — the last run's N lowest upgrades) ═══
    // Sits with the other run-start gifts, ahead of the SHIP block on purpose: a
    // kept Vitality's flat HP is hull-scaled the way a card's maxHealthAdd is, and
    // the ship block's unconditional `currentHealth = maxHealth` then fills the new
    // headroom — so this block needs no health code of its own.
    const keptUpgrades = selectKeptUpgrades(
      metaManager.getLastRunUpgrades(),
      metaManager.getStartingUpgradeKeep()
    );
    const carriedOverLabels: string[] = [];
    for (const kept of keptUpgrades) {
      const upgrade = this.upgrades.find(u => u.id === kept.id);
      if (!upgrade) continue;
      const target = Math.min(kept.level, upgrade.maxLevel);
      for (let level = 1; level <= target; level++) {
        upgrade.apply(this.playerStats, level);
      }
      upgrade.currentLevel = target;
      // Mirrors applyCombinedUpgrade's mastery branch, minus its playLevelUp() —
      // soundManager is not constructed until later in create().
      if (target === 10 && upgrade.isStatUpgrade) {
        this.masteryVisualsManager.addMasteryVisual(upgrade.id);
      }
      carriedOverLabels.push(`${upgrade.name} Lv${target}`);
    }
    if (carriedOverLabels.length > 0) {
      this.toastManager.showToast({
        tier: 'notable',
        title: carriedOverLabels.length === 1 ? 'REMEMBERED' : `REMEMBERED ×${carriedOverLabels.length}`,
        description: `${carriedOverLabels.join(' · ')} carried over from your last run`,
        icon: 'brain',
        color: 0x9a7bff,
        duration: 4000,
      });
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
    if (!this.practiceModeActive && this.startingWeaponId === 'projectile' && selectedShip.startingWeaponId !== 'projectile') {
      this.startingWeaponId = selectedShip.startingWeaponId;
    }

    // ═══ SHIP MOD TRACKS ═══
    // Per-ship HANGAR upgrades — small identity-reinforcing bonuses layered
    // on the ship you're flying, right after its own bonuses (spec:
    // docs/superpowers/specs/2026-07-03-ship-mod-tracks-design.md).
    const shipMods = getShipModManager().getAggregatedBonuses(selectedShip.id);
    this.playerStats.maxHealth = Math.round(this.playerStats.maxHealth * shipMods.maxHealthMult);
    this.playerStats.currentHealth = this.playerStats.maxHealth;
    this.playerStats.moveSpeed *= shipMods.moveSpeedMult;
    this.playerStats.damageMultiplier *= shipMods.damageMult;
    this.playerStats.cooldownMultiplier *= shipMods.cooldownMult;
    this.playerStats.goldMultiplier *= shipMods.goldMult;
    this.playerStats.xpMultiplier *= shipMods.xpMult;
    this.playerStats.critChance += shipMods.critChanceAdd;
    this.playerStats.armor += shipMods.armorAdd;
    this.playerStats.regenPerSecond += shipMods.regenAdd;
    this.playerStats.lifeStealPercent += shipMods.lifeStealAdd;
    this.playerStats.luck += shipMods.luckAdd;
    this.playerStats.bossDamageMultiplier += shipMods.bossDamageAdd;

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
    setDirectorStage(activeStage.id);

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

    // ═══ THREAT LEVEL (opt-in campaign difficulty ladder) ═══
    // curseMultiplier is ADDED to (matches pacts: `stats.curseMultiplier += …`) so
    // it composes additively with pact curses; it scales every enemy's HP+damage in
    // createEnemy and XP reward. goldMultiplier is multiplied (matches every other
    // gold source). This site runs on FRESH starts only (restore returns early
    // above), so a restored run never re-applies its already-scaled playerStats.
    const threatTier = getThreatTier(this.threatLevel);
    this.playerStats.curseMultiplier += threatTier.curseAdd;
    this.playerStats.goldMultiplier *= threatTier.goldMult;

    // ═══ STARTING LEVEL (triggers level-ups at start) ═══
    const startingLevel = metaManager.getStartingLevel()
      + achievementBonuses.startingLevel
      + ascensionManager.getBonusStartingLevel()
      // Cards and an armed boost share the startAtLevel channel — max, not
      // sum (start levels don't stack; the best source wins).
      + Math.max(0, Math.max(cardBonuses.startAtLevel, armedBoost?.bonus.startAtLevel ?? 1) - 1);
    if (startingLevel > 1) {
      this.pendingLevelUps += startingLevel - 1;
    }

    // Initialize effects and sound managers
    this.effectsManager = new EffectsManager(this);
    this.soundManager = new SoundManager(this);
    // Bind the shared JuiceManager to this scene so hitStop/screenShake/
    // impactFlash all have a scene context. The unbind lives in shutdown()
    // proper so the fresh and restore create paths share one teardown.
    getJuiceManager().setScene(this);

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
      this.enemyProjectileManager.spawn(x, y, angle, speed, damage);
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
      (x1, y1, x2, y2, damage) => this.enemyProjectileManager.fireLaser(x1, y1, x2, y2, damage)
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

    // Create the player at the mode's start point (arena: screen centre).
    const playerStart = this.worldMode.playerStartPoint();
    this.playerId = this.createPlayer(playerStart.x, playerStart.y);
    this.worldMode.setupCamera(
      this.playerSpaceship.getContainer(),
      this.gridBackground,
      this.trailManager,
    );

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
        addUltimateChargeFromDamage(damage);
        getAchievementManager().recordDamageDealt(damage, isCrit);
      },
      // onKilled - handle death
      (enemyId, x, y) => {
        addUltimateChargeFromKill();
        this.handleEnemyDeath(enemyId, x, y);
      },
      // onHealed - heal player (for weapon mastery effects)
      (amount) => {
        this.healPlayer(amount);
      },
      // onSynergyActivated - announce a newly-completed weapon synergy
      (synergy) => {
        getCodexManager().discoverSynergy(synergy);
        this.showSynergyToast(synergy);
      }
    );

    // Set weapon slot limit (base 4 = starter + 3 pickable, plus meta bonus)
    const baseWeaponSlots = 4;
    this.weaponManager.setMaxWeaponSlots(baseWeaponSlots + this.playerStats.weaponSlots);

    // Give player the starting weapon (selected in WeaponSelectScene or default projectile)
    const startingWeapon = createWeapon(this.startingWeaponId) || new ProjectileWeapon();
    this.weaponManager.addWeapon(startingWeapon);

    const rematchLoadout = this.practiceRematchSeed?.loadout;
    if (rematchLoadout) {
      this.weaponManager.setMaxWeaponSlots(
        Math.max(this.weaponManager.getMaxWeaponSlots(), rematchLoadout.length),
      );
      for (const entry of rematchLoadout) {
        const weapon = entry.weaponId === startingWeapon.id
          ? startingWeapon
          : createWeapon(entry.weaponId);
        if (!weapon) continue;
        if (weapon !== startingWeapon) this.weaponManager.addWeapon(weapon);
        for (let level = 1; level < entry.level; level++) {
          this.weaponManager.levelUpWeapon(weapon.id);
        }
        if (entry.evolved) {
          const evolution = getEvolutionForWeapon(weapon.id);
          if (evolution) weapon.evolve(evolution.evolvedName, evolution.statMultipliers);
        }
      }
    } else if (this.practiceModeActive) {
      for (let level = 1; level < this.practiceWeaponLevel; level++) {
        this.weaponManager.levelUpWeapon(startingWeapon.id);
      }
      if (this.practiceEvolved) {
        const evolution = getEvolutionForWeapon(startingWeapon.id);
        if (evolution) startingWeapon.evolve(evolution.evolvedName, evolution.statMultipliers);
      }
    }
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
      hasWorldMap: () => this.worldMode.worldMap() !== null,
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
      // Atmosphere band: above the lighting layer, below all UI — the
      // low-HP pulse must not tint the HP bar it points at.
    ).setScrollFactor(0).setDepth(OverlayDepths.DANGER_VIGNETTE);

    // Create pause menu manager
    this.pauseMenuManager = this.createPauseMenuManager();

    // Setup all input event handlers and input controller
    this.setupInputEventHandlers();

    // Director debug overlay — created once, toggled by settings flag (F10).
    this.createDirectorDebugOverlay();

    // Pre-run intro overlays (first-run coach marks + active run modifiers).
    // Runs last so all systems exist; soft-pauses gameplay until the player
    // has acknowledged and dismissed every overlay, so no tips are missed.
    this.startRunIntro();
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
    this.directorDebugText.setDepth(OverlayDepths.DEBUG);
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
      getRelicManager().getEquippedRelics(),
      this.activeBlessings,
      getRelicManager().getRelicRanks(),
    );
  }

  /**
   * Queues `count` relic-draft rounds (FEAT-RELIC-DRAFT). The per-frame pump
   * (processRelicChoiceQueue, called from update) opens each round's 1-of-3
   * choice overlay when the screen is free and a relic slot is open. Used by the
   * fortune shrine, treasure chests and the miniboss Relic Vow deal — the three
   * former auto-grant sites.
   */
  private grantRelicChoice(count: number): void {
    this.pendingRelicChoices += count;
  }

  /**
   * Per-frame pump for the relic-draft queue. Opens the next owed round as a
   * pausing RelicDraftScene overlay, equips the player's pick, and releases the
   * pause once every owed round resolves. Defers (retries next frame) while a
   * level-up / settings / pause menu owns the screen, and drops owed rounds only
   * when nothing at all can be granted (no new relic and every relic capped).
   */
  private processRelicChoiceQueue(): void {
    // A draft round is on screen (or still tearing down) — wait for it to close;
    // its onSelect re-pumps when the player picks.
    if (this.relicDraftActive || this.scene.isActive('RelicDraftScene')) return;

    if (
      this.pendingRelicChoices > 0 &&
      !this.isGameOver &&
      !this.hasWon &&
      !this.deathSequenceActive &&
      !this.pauseMenuManager.isPauseMenuOpen &&
      !this.scene.isActive('UpgradeScene') &&
      !this.scene.isActive('SettingsScene')
    ) {
      const relicManager = getRelicManager();
      if (!relicManager.isFull()) {
        const choices = relicManager.rollRelicChoices(this.playerStats);
        if (choices.length > 0) {
          this.openRelicDraftRound(choices, false);
          return;
        }
      }
      // Slots full (or the pool is exhausted): the award becomes a rank on a relic
      // already carried, instead of being discarded (FEAT-RELIC-REINFORCE).
      const reinforceChoices = relicManager.reinforceChoices();
      if (reinforceChoices.length > 0) {
        this.openRelicDraftRound(reinforceChoices, true);
        return;
      }
      // Every equipped relic is capped and no new one can be rolled: drop the rounds.
      this.pendingRelicChoices = 0;
    }

    // No round is open and none can be. Release the pause if this draft flow held
    // it, then settle any orientation flip deferred while the draft was up.
    if (this.relicDraftOwnsPause && this.pendingRelicChoices <= 0) {
      this.relicDraftOwnsPause = false;
      this.isPaused = false;
      if (this.pendingOrientationRelayout) {
        this.pendingOrientationRelayout = false;
        this.handleOrientationFlip();
      }
    }
  }

  /**
   * Opens one relic-draft round as a pausing overlay. `isReinforce` switches the
   * copy and routes the pick to a rank-up instead of an equip; everything else
   * (pause ownership, decrement, re-pump) is identical for both kinds.
   */
  private openRelicDraftRound(choices: Relic[], isReinforce: boolean): void {
    const relicManager = getRelicManager();
    this.pendingRelicChoices--;
    this.relicDraftActive = true;
    this.relicDraftOwnsPause = true;
    this.isPaused = true;
    this.scene.launch('RelicDraftScene', {
      choices,
      title: isReinforce ? 'REINFORCE A RELIC' : 'CHOOSE A RELIC',
      subtitle: isReinforce
        ? 'Slots are full. Pick one to raise it one rank.'
        : 'Pick one to add to your build',
      rankLabels: isReinforce
        ? Object.fromEntries(
            choices.map((relic) => [
              relic.id,
              `RANK ${relicRankNumeral(relicManager.getRelicRank(relic.id))}`,
            ]),
          )
        : undefined,
      onSelect: (chosen: Relic) => {
        this.relicDraftActive = false;
        if (isReinforce) this.reinforceDraftedRelic(chosen);
        else this.equipDraftedRelic(chosen);
        // Re-pump a beat later so the overlay has fully stopped before a
        // possible relaunch of the next owed round.
        this.time.delayedCall(60, () => this.processRelicChoiceQueue());
      },
    });
  }

  /**
   * Equips a relic the player drafted: applies its stat effect + pity-streak
   * update (RelicManager.equipDraftedRelic), tops up health for any maxHealth gain
   * (grantBuildHeal on the currentHealth delta, exactly like the former auto-grant
   * sites), shows the pickup toast and refreshes the relic HUD strip.
   */
  private equipDraftedRelic(relic: Relic): void {
    const healthBeforeRelic = this.playerStats.currentHealth;
    const equipped = getRelicManager().equipDraftedRelic(relic, this.playerStats);
    if (!equipped) return;
    this.syncStatsToPlayer();
    this.grantBuildHeal(this.playerStats.currentHealth - healthBeforeRelic);
    this.toastManager.showToast({
      tier: 'notable',
      title: `Relic: ${equipped.name}`,
      description: equipped.description,
      icon: equipped.icon,
      color: getRelicRarityColor(equipped.rarity),
      duration: 4500,
    });
    this.refreshRelicStrip();
  }

  /**
   * Raises a relic the player already carries by one rank: re-applies its effect
   * (RelicManager.reinforceRelic) with the same heal accounting, toast and HUD
   * refresh as a fresh equip.
   */
  private reinforceDraftedRelic(relic: Relic): void {
    const healthBeforeRelic = this.playerStats.currentHealth;
    const newRank = getRelicManager().reinforceRelic(relic, this.playerStats);
    if (newRank === null) return;
    this.syncStatsToPlayer();
    this.grantBuildHeal(this.playerStats.currentHealth - healthBeforeRelic);
    this.toastManager.showToast({
      tier: 'notable',
      title: `${relic.name} · Rank ${relicRankNumeral(newRank)}`,
      description: relic.description,
      icon: relic.icon,
      color: getRelicRarityColor(relic.rarity),
      duration: 4500,
    });
    this.refreshRelicStrip();
  }

  /**
   * Opens the Black Market as a pausing overlay (FEAT-MARKET). Mirrors
   * openRelicDraftRound's pause ownership: this flow sets isPaused and the
   * single onClose callback releases it, whichever way the player exits.
   */
  /**
   * Snapshots what this run lacks for the market's 4th slot (FEAT-MARKET-STOCK).
   * The recruit weapon is rolled HERE, once per visit, and the card carries its id
   * — so the player is always sold the weapon the card named.
   */
  private buildMarketStockContext(): MarketStockContext {
    const weaponUpgrades = getWeaponUpgrades(this.weaponManager);

    const addable = weaponUpgrades.filter(
      candidate => candidate.type === 'add' && !this.banishedUpgradeIds.has(candidate.id),
    );
    const rolled = addable.length > 0 ? Phaser.Utils.Array.GetRandom(addable) : null;
    const recruit: MarketStockSubject | null = rolled
      ? { weaponId: rolled.weaponId, name: rolled.name, icon: rolled.icon, level: 0 }
      : null;

    let arsenal: MarketStockSubject | null = null;
    for (const candidate of weaponUpgrades) {
      if (candidate.type !== 'level') continue;
      if (!arsenal || candidate.currentLevel < arsenal.level) {
        arsenal = {
          weaponId: candidate.weaponId,
          name: candidate.name,
          icon: candidate.icon,
          level: candidate.currentLevel,
        };
      }
    }

    return {
      freeWeaponSlots: this.weaponManager.getRemainingSlots(),
      recruit,
      arsenal,
      draftCharges: this.playerStats.rerollsRemaining + this.playerStats.banishesRemaining,
    };
  }

  /** Re-resolves a stock card's weapon into the upgrade the shared apply path takes. */
  private findWeaponUpgrade(type: 'add' | 'level', weaponId: string | undefined): CombinedUpgrade | null {
    if (!weaponId) return null;
    const match = getWeaponUpgrades(this.weaponManager).find(
      candidate => candidate.type === type && candidate.weaponId === weaponId,
    );
    return match ? { ...match, upgradeType: 'weapon' as const } : null;
  }

  private openMarket(shrineX: number, shrineY: number): void {
    if (this.marketActive || this.scene.isActive('MarketScene')) return;
    const relicManager = getRelicManager();
    const offers = buildMarketOffers({
      worldLevel: this.worldLevel,
      gold: getMetaProgressionManager().getGold(),
      atFullHealth:
        this.playerId !== -1 && Health.current[this.playerId] >= Health.max[this.playerId],
      relicsMaxed: relicManager.isFull() && !relicManager.hasReinforceCandidates(),
      stock: this.buildMarketStockContext(),
    });

    this.marketActive = true;
    this.isPaused = true;
    this.scene.launch('MarketScene', {
      offers,
      gold: getMetaProgressionManager().getGold(),
      onClose: (purchased: MarketOfferId | null) => {
        this.marketActive = false;
        this.isPaused = false;
        if (purchased) {
          const offer = offers.find(candidate => candidate.id === purchased);
          if (offer && !offer.locked) this.applyMarketPurchase(offer, shrineX, shrineY);
        }
        // An orientation flip while the overlay was up deferred its relayout
        // (a restart underneath would have orphaned this callback) — settle it.
        if (this.pendingOrientationRelayout) {
          this.pendingOrientationRelayout = false;
          this.handleOrientationFlip();
        }
      },
    });
  }

  /**
   * Charges the wallet and delivers one market purchase. The spend is
   * authoritative: nothing is granted unless spendGold() actually succeeded.
   */
  private applyMarketPurchase(offer: MarketOfferView, x: number, y: number): void {
    const metaManager = getMetaProgressionManager();

    // Resolve a weapon purchase BEFORE charging — the wallet is never debited for
    // an effect that cannot land.
    let stockUpgrade: CombinedUpgrade | null = null;
    if (offer.id === 'recruit' || offer.id === 'arsenal') {
      stockUpgrade = this.findWeaponUpgrade(
        offer.id === 'recruit' ? 'add' : 'level',
        offer.stockWeaponId,
      );
      if (!stockUpgrade) return;
    }

    if (!metaManager.spendGold(offer.price)) return;

    switch (offer.id) {
      case 'repair':
        this.healPlayer(this.playerStats.maxHealth * 0.5);
        break;
      case 'supply':
        this.spawnRandomConsumable(x - 20, y);
        this.spawnRandomConsumable(x + 20, y);
        break;
      case 'relic':
        // Queued, not opened inline: processRelicChoiceQueue owns draft rounds
        // and takes the pause back on the next frame.
        this.grantRelicChoice(1);
        break;
      case 'recruit':
      case 'arsenal':
        // The shared level-up path: achievements, codex discovery, stat sync,
        // build heal and the evolution check all come with it.
        if (stockUpgrade) this.applyCombinedUpgrade(stockUpgrade);
        break;
      case 'contraband':
        this.playerStats.rerollsRemaining += MARKET_CONTRABAND_REROLLS;
        this.playerStats.banishesRemaining += MARKET_CONTRABAND_BANISHES;
        break;
    }

    this.effectsManager.playDeathBurst(x, y, offer.color);
    this.soundManager.playLevelUp();
    this.toastManager?.showToast({
      tier: 'notable',
      title: `Bought: ${offer.name}`,
      description: `${offer.price} gold spent — ${metaManager.getGold()} left.`,
      icon: offer.icon,
      color: offer.color,
      duration: 3200,
    });
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

    this.practiceUltimateOverride = null;
    if (this.practiceModeActive) {
      this.practiceDock = new PracticeDock(this, {
        hudScale: computeHudScale(this.scale.width, this.scale.height, getSettingsManager().getUiScale()),
        initialTarget: this.practiceRematchSeed?.target,
        initialBuildDepth: this.practiceRematchSeed?.buildDepth,
        onSpawn: (state) => this.spawnPracticeTarget(state),
        onInvincibleChange: (invincible) => { this.practiceInvincible = invincible; },
        onBuildChange: (depth) => this.applyPracticeBuild(depth),
        onArenaChange: (rung) => this.applyPracticeArena(rung),
        onMutatorChange: (mutator) => this.setPracticeMutator(mutator),
        onUltimateChange: (choice) => { this.practiceUltimateOverride = choice; },
        onFireUltimate: () => this.firePracticeUltimate(),
      });

      this.practiceSpawnKeyHandler = () => {
        const dock = this.practiceDock;
        if (dock) this.spawnPracticeTarget(dock.getState());
      };
      this.input.keyboard?.on('keydown-B', this.practiceSpawnKeyHandler);

      this.practiceUltimateKeyHandler = () => this.firePracticeUltimate();
      this.input.keyboard?.on('keydown-U', this.practiceUltimateKeyHandler);

      const rematchSeed = this.practiceRematchSeed;
      if (rematchSeed) {
        this.applyPracticeBuild(rematchSeed.buildDepth);
        this.pendingRematchSpawn = { ...rematchSeed.target, invincible: false };
      }
    }

    // Setup beforeunload handler to save game state on page close/refresh
    this.setupBeforeUnloadHandler();

    // Initialize input controller (keyboard, mouse, joystick, focus-loss handlers)
    // Must be after pauseMenuManager is created since onFocusLost references it
    this.inputController.create();

    // Reserve the dash + ultimate button regions from joystick spawn so a finger
    // tap on a button doesn't also drop a joystick base there.
    this.inputController.addJoystickExclusionCheck((x, y) => {
      const buttons = this.hudManager.getTouchActionButtons();
      return (buttons?.isPointInDashButton(x, y) ?? false)
        || (buttons?.isPointInUltimateButton(x, y) ?? false);
    });
    // While any intro overlay (coach marks / modifier banner) is showing, taps
    // to dismiss shouldn't also spawn the joystick (would leave ghost joysticks).
    this.inputController.addJoystickExclusionCheck(() => this.introOverlayActive);
    this.inputController.addJoystickExclusionCheck((x, y) => this.practiceDock?.containsPoint(x, y) ?? false);

    // Listen for dash requests from InputController (triggered by Shift key)
    this.dashRequestHandler = () => {
      if (this.isPaused || this.isGameOver) return;
      if (this.playerId === -1) return;
      if (this.tryBlink()) return;
      const playerX = Transform.x[this.playerId];
      const playerY = Transform.y[this.playerId];
      this.inputController.tryDash(playerX, playerY, this.playerId);
    };
    this.events.on('input-dash-requested', this.dashRequestHandler);

    // Listen for ultimate requests from InputController (Q / gamepad Y / touch)
    this.ultimateRequestHandler = () => {
      if (this.isPaused || this.isGameOver) return;
      if (this.playerId === -1) return;
      this.activateUltimate();
    };
    this.events.on('input-ultimate-requested', this.ultimateRequestHandler);

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

    // Listen for world-map requests (M key / gamepad LB). Arena runs have no world map,
    // so openExpeditionMap returns immediately and the binding is inert there.
    this.mapRequestHandler = () => {
      this.openExpeditionMap();
    };
    this.events.on('input-map-requested', this.mapRequestHandler);
  }

  /**
   * Sets up the beforeunload handler to save game state on page close/refresh.
   */
  private setupBeforeUnloadHandler(): void {
    this.beforeUnloadHandler = () => {
      if (!this.isGameOver && !this.hasWon) {
        this.saveGameState();
        // Force pending encrypted writes out now — on iOS the page may be
        // frozen or killed the moment this handler returns.
        flushStorage();
      }
    };
    // iOS Safari rarely fires beforeunload; pagehide + visibilitychange
    // (hidden) cover backgrounding, tab switches, and swipe-away there.
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    window.addEventListener('pagehide', this.beforeUnloadHandler);
    this.visibilitySaveHandler = () => {
      if (document.visibilityState === 'hidden') {
        this.beforeUnloadHandler?.();
      }
    };
    document.addEventListener('visibilitychange', this.visibilitySaveHandler);
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
      bossSpawned: this.bossFightDirector.hasSpawned(),
      bossWarningPhase: this.bossFightDirector.getWarningPhase(),
      activeBossType: this.bossFightDirector.getActiveBossType() ?? undefined,
      comboState: getComboState(),
      ultimateCharge: getUltimateState().charge,
      cacheFoundThisRun: this.cacheFoundThisRun,
      eventState: getEventState(),
      minibossSpawnTimes: this.minibossSpawnTimes,
      nemesisSpawned: this.nemesisSpawned,
      banishedUpgradeIds: this.banishedUpgradeIds,
      scrappedWeaponIds: this.scrappedWeaponIds,
      isAutoBuyEnabled: this.isAutoBuyEnabled,
      worldLevel: this.worldLevel,
      worldLevelHealthMult: this.worldLevelHealthMult,
      worldLevelDamageMult: this.worldLevelDamageMult,
      worldLevelSpawnReduction: this.worldLevelSpawnReduction,
      worldLevelXPMult: this.worldLevelXPMult,
      weapons: this.weaponManager.getAllWeapons().map(w => ({
        id: w.id,
        level: w.getLevel(),
        evolved: w.isEvolved,
      })),
      upgrades: this.upgrades.map(u => ({
        id: u.id,
        currentLevel: u.currentLevel,
      })),
      twinLinks: getAllTwinLinks(),
      modifierIds: this.activeModifiers.map(m => m.id),
      blessingIds: this.activeBlessings.map(blessing => blessing.id),
      stageId: this.selectedStageId,
      relicIds: getRelicManager().getEquippedRelics().map(r => r.id),
      relicRanks: getRelicManager().getRelicRanks(),
      directorState: getDirectorState(),
      threatLevel: this.threatLevel,
      // Save key kept as `timedDamageBuffs` for back-compat (the list was
      // damage-only before generalisation); entries now carry a `stat` field.
      timedDamageBuffs: this.timedStatBuffs,
      bountyState: {
        bounty: this.bounty,
        cooldown: this.bountyCooldown,
        flawlessBroken: this.bountyFlawlessBroken,
      },
      shrineState: this.shrineManager.serialize(),
      // Read each chest's live position from its graphics (chests drift toward
      // the player via the chest-drone, so the spawn coords would be stale).
      chestState: this.activeChests.map(chest => ({
        x: chest.graphics.x,
        y: chest.graphics.y,
        isSpecial: chest.isSpecial,
        isPoiCache: chest.isPoiCache,
      })),
      // Expedition only: an arena run has no slots, so it writes no block (same shape as
      // `expedition:` below).
      poiState: this.worldMode.worldMap()
        ? {
            runSalt: this.poiRunSalt,
            spawnedSlotIds: Array.from(this.spawnedPoiSlotIds),
            oncePerRunSpawned: this.poiOncePerRunSpawned,
            nests: this.activeAmbushNests.map(nest => ({
              x: nest.x, y: nest.y, depth: nest.depth,
            })),
            lairs: this.activeNemesisLairs.map(lair => ({
              x: lair.x, y: lair.y, awake: lair.awake,
            })),
            puzzles: this.secretCacheManager.serializePuzzleProgress(),
            slots: Array.from(this.poiSlotObjects, ([id, record]) => ({
              id,
              sectorKey: record.sectorKey,
              intact: !record.partlyLooted
                && record.objects.every(object => this.isPoiObjectAlive(object)),
              objects: this.serializePoiSlotObjects(record),
            })).filter(slot => slot.objects.length > 0),
          }
        : undefined,
      // Expedition only, the poiState rule: an arena run holds no expedition objective, so it
      // writes no block at all.
      questRunState: this.worldMode.worldMap()
        ? {
            dwellSectorKey: this.expeditionDwellSectorKey ?? undefined,
            dwellStartSeconds: this.expeditionDwellStartSeconds,
            siegeSectorKey: this.siegeSectorKey ?? undefined,
            siegeNextWaveAtSeconds: this.siegeNextWaveAtSeconds,
            escortDrone: this.escortDrone
              ? {
                  questId: this.escortDrone.questId,
                  x: this.escortDrone.x,
                  y: this.escortDrone.y,
                  health: this.escortDrone.health,
                }
              : undefined,
          }
        : undefined,
      // Expedition only, the poiState rule. Persisted because a return trip is a promise the
      // player already paid a 3 second channel for, so a refresh must not silently cancel it.
      sortieAnchor: this.sortieAnchor && this.worldMode.worldMap()
        ? { x: this.sortieAnchor.x, y: this.sortieAnchor.y }
        : undefined,
      hazardState: getHazardState(),
      hasWon: this.hasWon,
      endlessState: this.endlessDirector.serialize(),
      gauntletState: {
        active: this.gauntletModeActive,
        ...this.gauntletDirector.serialize(),
      },
      dailyState: {
        active: this.dailyModeActive,
        date: this.dailyDateString,
        challengeType: this.dailyChallengeType,
      },
      shipId: this.selectedShipId,
      startingWeaponId: this.startingWeaponId,
      pactIds: this.activePacts.map(pact => pact.id),
      expedition: this.worldMode.saveViewState() ?? undefined,
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

    // Blessings are display-only on restore — their stat effects are already
    // baked into the saved playerStats, so nothing is re-applied here (same
    // contract as pactIds below). Absent on legacy saves → strip shows none.
    this.activeBlessings = (Array.isArray(state.blessingIds) ? state.blessingIds : [])
      .map(id => getBlessingById(id))
      .filter((blessing): blessing is Blessing => blessing !== undefined);

    // Restore stage selection before anything that reads it (enemy scaling,
    // grid palette). Falls back to default if the save is pre-stageId.
    this.selectedStageId = state.stageId || 'stage_deep_void';

    // Restore run launch identity. The ship id drives the hull family + neon
    // palette the player visual is built from (getShipHullId/getShipNeonColor),
    // so it must land before restoreEntities; ship/pact stat bonuses are
    // already baked into the saved playerStats, so nothing is re-applied here.
    // An unknown ship id is harmless — every consumer falls back via
    // `getShipById(...) ?? getDefaultShip()` — and an unknown weapon id only
    // reaches the fresh path's `createWeapon(...) || new ProjectileWeapon()`
    // guard on PLAY AGAIN. Absent on legacy saves → defaults (pre-fix behavior).
    const sanitizeIdentityId = (value: unknown): string =>
      typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : '';
    this.selectedShipId = sanitizeIdentityId(state.shipId) || 'ship_default';
    this.startingWeaponId = sanitizeIdentityId(state.startingWeaponId) || 'projectile';
    this.activePacts = (Array.isArray(state.pactIds) ? state.pactIds : [])
      .map(id => getPactById(sanitizeIdentityId(id)))
      .filter((pact): pact is Pact => pact !== undefined);

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
    // Parallax depth layers behind the grid (fixed camera → driven by player offset)
    this.parallaxBackground = new ParallaxBackground(this);
    this.parallaxBackground.setQuality(this.visualQuality);
    this.applyStageVisuals();
    this.trailManager = new TrailManager(this);
    this.deathRippleManager = new DeathRippleManager(this);
    this.deathRippleManager.setWorld(this.world);
    this.deathRippleManager.setQuality(this.visualQuality);
    this.deathRippleManager.setViewRectProvider(() => this.worldMode.viewRect());

    // Re-bind scene refs on the boss-arena/hazard-zone modules. Our reset
    // block above nulled their sceneRef; without these, any post-reload boss
    // arena or hazard zone would silently no-op.
    setBossArenaScene(this);
    setHazardZoneScene(this);
    setHazardZoneQuality(this.visualQuality);

    this.statusEffectVisualManager = new StatusEffectVisualManager(this);
    this.statusEffectVisualManager.setWorld(this.world);
    this.statusEffectVisualManager.setQuality(this.visualQuality);

    this.eliteAffixVisualManager = new EliteAffixVisualManager(this);
    this.eliteAffixVisualManager.setWorld(this.world);
    this.eliteAffixVisualManager.setQuality(this.visualQuality);

    this.telegraphManager = new TelegraphManager(this);
    this.telegraphManager.setQuality(this.visualQuality);
    setTelegraphManager(this.telegraphManager);
    setNavigationContext(this.worldMode.navigationContext());
    setBarrierEventSink(this.barrierEventSink);
    this.bindExpeditionDiscovery();
    this.offScreenIndicatorManager = new OffScreenIndicatorManager(this);
    this.offScreenIndicatorManager.setWorld(this.world);
    this.createFieldPoiManagers();
    this.createMinimapFeed();
    this.masteryVisualsManager = new MasteryVisualsManager(this);
    this.shieldBarrierVisual = new ShieldBarrierVisual(this);

    // Initialize toast manager early (needed before game loop starts)
    this.toastManager = getToastManager(this);
    this.toastManager.resetSession();

    // Restore game progress
    this.gameTime = state.gameTime;
    this.killCount = state.killCount;
    this.enemyCount = 0; // Will be incremented as we restore enemies
    this.resetInRunFeatureState(); // destructibles/shrines/bounties (not persisted)

    // Restore timers
    this.spawnTimer = state.spawnTimer;
    this.spawnInterval = state.spawnInterval;
    this.magnetSpawnTimer = state.magnetSpawnTimer;
    this.treasureSpawnTimer = state.treasureSpawnTimer;
    this.gemMagnetTimer = state.gemMagnetTimer;
    // Note: dashCooldownTimer is restored after inputController.create() below
    this.damageCooldown = state.damageCooldown;

    // Restore active timed stat buffs (Power Surge damage / Elite Surge XP /
    // Golden Tide gem value / Power shrine). The restored playerStats already
    // carry the multiplied stat; updateTimedStatBuffs reverts it once gameTime
    // passes each buff's (absolute) expiry — fixing the stuck-forever boon after
    // a mid-buff refresh. normalizeTimedStatBuffs defaults a missing `stat` to
    // damageMultiplier so legacy (damage-only) saves keep working. Absent on
    // legacy saves → no buffs.
    this.timedStatBuffs = normalizeTimedStatBuffs(state.timedDamageBuffs);

    // Restore the in-run bounty objective + pacing. resetInRunFeatureState above
    // cleared it to fresh-run defaults; re-apply the saved progress so a refresh
    // mid-bounty keeps the player's tally instead of wiping it and restarting the
    // cooldown. Absent on legacy saves → keep the reset defaults. The bountyText
    // HUD label is recreated lazily by updateBounties on the next frame.
    if (state.bountyState) {
      this.bounty = state.bountyState.bounty
        ? { ...state.bountyState.bounty, kind: state.bountyState.bounty.kind as BountyKind }
        : null;
      this.bountyCooldown = state.bountyState.cooldown;
      this.bountyFlawlessBroken = state.bountyState.flawlessBroken;
    }

    // Restore on-field shrines + spawn pacing. resetInRunFeatureState above destroyed any altars
    // and reset the timer to fresh-run defaults, so this only re-adds. Absent on legacy saves →
    // keep the reset defaults.
    if (state.shrineState) {
      this.shrineManager.restore(state.shrineState);
    }

    // Restore the run's POI memory. resetInRunFeatureState above cleared the spawned set and
    // rolled a fresh salt; a restored run must keep the old salt (so an unvisited sector rolls
    // the same contents it would have) and the old set (so a looted sector is not re-stocked).
    // Ids are length-capped to guard a tampered save from growing an unbounded set. Absent on
    // legacy + arena saves, where the fresh values win.
    if (state.poiState && Number.isFinite(state.poiState.runSalt)) {
      this.poiRunSalt = state.poiState.runSalt;
      this.poiOncePerRunSpawned = state.poiState.oncePerRunSpawned === true;
      this.spawnedPoiSlotIds = new Set(
        (Array.isArray(state.poiState.spawnedSlotIds) ? state.poiState.spawnedSlotIds : [])
          .filter(id => typeof id === 'string' && id.length > 0 && id.length <= 64));
      // Restored dormant on purpose: the wave is not persisted, so a refresh mid-fight re-arms
      // the ambush rather than leaving an unclearable hive. Coords and depth are sanitized the
      // way chestState's are, against a tampered save.
      for (const nest of Array.isArray(state.poiState.nests) ? state.poiState.nests : []) {
        if (Number.isFinite(nest.x) && Number.isFinite(nest.y) && Number.isFinite(nest.depth)) {
          this.addAmbushNest(nest.x, nest.y, nest.depth);
        }
      }
      // Never re-spawns a hunter: a NemesisTag enemy is serialized like any other and is
      // restored by the entity pass, so a woken den comes back awake and empty and its only
      // remaining job is the chest its kill pays.
      for (const lair of Array.isArray(state.poiState.lairs) ? state.poiState.lairs : []) {
        if (Number.isFinite(lair.x) && Number.isFinite(lair.y)) {
          this.addNemesisLair(lair.x, lair.y, lair.awake === true);
        }
      }
      // A ring the ship half woke and then left survives the refresh: the count alone relights it,
      // because a ring's glyph ids are unique. Sanitized the way the nests above are, against a
      // tampered save, and length-capped so it cannot grow an unbounded map. The ring itself
      // clamps a count at or past its own length, which is the only bound that needs to know how
      // many pylons it has.
      const restoredPuzzles = Array.isArray(state.poiState.puzzles)
        ? state.poiState.puzzles.slice(0, 64)
        : [];
      for (const puzzle of restoredPuzzles) {
        if (typeof puzzle.secretId === 'string'
          && puzzle.secretId.length > 0 && puzzle.secretId.length <= 64
          && Number.isInteger(puzzle.progress) && puzzle.progress > 0) {
          this.secretCacheManager.restorePuzzleProgress(puzzle.secretId, puzzle.progress);
        }
      }
    }

    // Coords sanitized the way chestState's are, against a tampered save. Absent on legacy and
    // arena saves, where resetInRunFeatureState's null wins.
    const savedSortieAnchor = state.sortieAnchor;
    this.sortieAnchor = savedSortieAnchor
      && Number.isFinite(savedSortieAnchor.x) && Number.isFinite(savedSortieAnchor.y)
      ? { x: savedSortieAnchor.x, y: savedSortieAnchor.y }
      : null;

    // Restore the run's live quest objective. resetInRunFeatureState above cleared the dwell stamp,
    // ended the siege and destroyed the drone, so a refresh mid-objective restarted a 90 s hold at
    // zero, re-announced THE ROOM ANSWERS with a fresh wave clock, and handed back a full-health
    // drone. gameTime is already restored above, so the absolute stamps land against the right
    // clock. Every field is sanitized the way poiState's are, against a tampered save. Absent on
    // legacy + arena saves, where the reset defaults win.
    const questRun = state.questRunState;
    if (questRun) {
      if (typeof questRun.dwellSectorKey === 'string'
        && questRun.dwellSectorKey.length > 0
        && Number.isFinite(questRun.dwellStartSeconds)) {
        this.expeditionDwellSectorKey = questRun.dwellSectorKey;
        this.expeditionDwellStartSeconds = Math.max(
          0,
          Math.min(this.gameTime, questRun.dwellStartSeconds as number),
        );
      }
      // Restored WITHOUT its besiegers, which is the honest half: the wave carries AmbushSpawnTag
      // and the serializer skips it, so what survives is the room's identity and its cadence. The
      // key matching the dwell key above is what keeps beginExpeditionSiege from re-announcing.
      if (typeof questRun.siegeSectorKey === 'string'
        && questRun.siegeSectorKey.length > 0
        && Number.isFinite(questRun.siegeNextWaveAtSeconds)) {
        this.siegeSectorKey = questRun.siegeSectorKey;
        this.siegeNextWaveAtSeconds = Math.max(0, questRun.siegeNextWaveAtSeconds as number);
      }
      const savedDrone = questRun.escortDrone;
      this.restoredEscortDrone = savedDrone
        && typeof savedDrone.questId === 'string'
        && savedDrone.questId.length > 0
        && Number.isFinite(savedDrone.x)
        && Number.isFinite(savedDrone.y)
        && Number.isFinite(savedDrone.health)
        ? savedDrone
        : null;
    }

    // Restore spawn tracking
    this.bossFightDirector.restoreSpawnTracking(state.bossSpawned, state.bossWarningPhase ?? 0);
    if (state.comboState) {
      restoreComboState(state.comboState);
    }
    // Legacy saves predate the ultimate meter → start empty.
    restoreUltimateState({ charge: state.ultimateCharge ?? 0 });
    // Card charge-rate bonus is meta state, not save state — resetAllRunSystems
    // above zeroed it back to 1, so re-derive it or the card goes inert on
    // restored runs (the fresh path sets it in the meta-progression block).
    setUltimateChargeRateMultiplier(getCardCollectionManager().getAggregatedBonuses().ultChargeRateMult);
    if (state.eventState) {
      restoreEventState(state.eventState);
    }
    // Director strategy + credit balance restore — without this, the reload
    // re-picks a random strategy, breaking mid-run spawn continuity.
    if (state.directorState) {
      restoreDirectorState(state.directorState);
    }
    if (typeof state.threatLevel === 'number') {
      this.threatLevel = clampThreatTier(state.threatLevel);
    }
    this.minibossSpawnTimes = state.minibossSpawnTimes;
    // Legacy saves (no field) read as "not yet spawned" — correct for any save
    // written before 2:30, and at worst fields the hunter once after a refresh.
    this.nemesisSpawned = state.nemesisSpawned === true;
    this.pendingNemesisTypeId = null;

    // Restore post-victory / endless-mode progression. These are GameScene-local
    // instance fields (reset to fresh defaults above), so without this a refresh
    // deep in endless mode reverts to plain spawns — losing the boss/miniboss
    // wave cadence + cycle escalation — and drops the won flag, which would let a
    // later death be miscounted as a fresh loss. The difficulty ramp itself rides
    // on worldLevel*Mult (restored below). Absent on legacy + normal mid-run
    // saves → endless stays inactive. Values are sanitized (corruption/tamper):
    // a non-finite entry falls back to its fresh default instead of poisoning the
    // run loop with NaN timers.
    this.hasWon = state.hasWon === true;
    this.endlessDirector.restore(state.endlessState);

    // Restore GAUNTLET progression. Assigned unconditionally (scene restarts
    // reuse this instance, so stale fields from a prior gauntlet run must not
    // leak into a restored standard run). Pending staggered spawns are not
    // persisted — the alive-scan finishes the wave off whatever enemies were
    // restored, and if none survived the save window the wave re-queues in
    // full (gauntletRestoredMidCombat) rather than granting a free clear.
    const savedGauntlet = state.gauntletState;
    this.gauntletModeActive = savedGauntlet?.active === true;
    this.gauntletDirector.restore(savedGauntlet, this.gauntletModeActive);

    // Restore daily/weekly challenge identity. Assigned unconditionally (scene
    // restarts reuse this instance, so a prior daily run's fields must not
    // leak into a restored standard run). Without this a mid-challenge refresh
    // silently demoted the run to standard and the death/victory never posted
    // the day's leaderboard entry. A tampered date fails the shape check and
    // the run restores as standard (recordDailyRun requires a non-empty date).
    const savedDaily = state.dailyState;
    const savedDailyDate =
      typeof savedDaily?.date === 'string' &&
      savedDaily.date.length > 0 &&
      savedDaily.date.length <= 32
        ? savedDaily.date
        : '';
    this.dailyModeActive = savedDaily?.active === true && savedDailyDate !== '';
    this.dailyDateString = this.dailyModeActive ? savedDailyDate : '';
    this.dailyChallengeType = savedDaily?.challengeType === 'weekly' ? 'weekly' : 'daily';

    // The fresh path's reset block is unreachable here (create() returns after
    // restoreGameState), so the run's hunter is loaded on this path too — after
    // the gauntlet/daily flags above, which the mode gate reads, and before
    // restoreEntities below, whose health-bar label reads the grudge.
    this.nemesisRecord = this.loadRunNemesis();

    // PLAY AGAIN calls scene.restart() with no data, which reuses this scene's
    // settings.data — for a restored run that is just {restore: true}, and the
    // save is cleared on death, so the restart would silently fall back to a
    // default standard run. Rewrite the payload with the original launch
    // identity (stage + mode + ship/weapon/modifiers/pacts, all restored from
    // the save above), matching what a non-restored PLAY AGAIN reuses. A
    // daily/weekly whose challenge is still current is regenerated instead —
    // the config is deterministic from the date (modifiers, ship, weapon),
    // matching what the menu deck card would launch. A rolled-over date drops
    // to a standard run, same as the menu.
    const currentChallenge = this.dailyModeActive
      ? this.dailyChallengeType === 'weekly'
        ? generateWeeklyChallenge()
        : generateDailyChallenge()
      : null;
    if (currentChallenge && currentChallenge.dateString === this.dailyDateString) {
      this.scene.settings.data = {
        restore: false,
        stageId: this.selectedStageId,
        startingWeapon: currentChallenge.startingWeaponId,
        shipId: currentChallenge.shipId,
        modifierIds: currentChallenge.modifierIds,
        dailyMode: true,
        dailyDate: currentChallenge.dateString,
        dailyChallengeType: currentChallenge.challengeType,
      };
    } else {
      this.scene.settings.data = {
        restore: false,
        stageId: this.selectedStageId,
        startingWeapon: this.startingWeaponId,
        shipId: this.selectedShipId,
        modifierIds: this.activeModifiers.map(modifier => modifier.id),
        pactIds: this.activePacts.map(pact => pact.id),
        gauntletMode: this.gauntletModeActive,
        runMode: this.worldMode.kind,
      };
    }

    // Restore player state
    this.playerStats = state.playerStats;
    this.banishedUpgradeIds = new Set(state.banishedUpgradeIds);
    this.scrappedWeaponIds = state.scrappedWeaponIds ?? [];
    this.isAutoBuyEnabled = state.isAutoBuyEnabled;

    // Rehydrate relic inventory without re-applying stats — the saved
    // playerStats already includes the relic bonuses, so we only restore the
    // inventory list for UI display + future drop dedup/cap.
    if (state.relicIds && state.relicIds.length > 0) {
      getRelicManager().restoreFromSave(state.relicIds, state.relicRanks);
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
    setDirectorStage(restoredStage.id);

    // Restore live hazard zones + the auto-spawner pacing. resetAllRunSystems
    // above wiped the module (setHazardZoneScene re-initialized the pool), so a
    // mid-run refresh would otherwise despawn every active burn/ice/void/energy
    // zone and restart the hazard spawn clock. Zone radius/duration were
    // world-level-scaled at spawn time and round-trip verbatim; corrupt entries
    // are skipped inside restoreHazardState. Absent on legacy saves → reset
    // defaults win (no zones, fresh spawn timer).
    if (state.hazardState) {
      restoreHazardState(state.hazardState);
    }

    // Restore on-field treasure chests. resetInRunFeatureState above destroyed
    // any chests and cleared activeChests; re-add the saved ones at their last
    // position so a mid-run refresh doesn't despawn an uncollected XP/relic cache
    // and restart the spawn clock (treasureSpawnTimer already restored above).
    // Deferred to here (vs the shrine block) because addTreasureChest reads
    // playerStats.chestDroneDelay, which is only set after playerStats is applied.
    // Coords are sanitized to guard against a tampered/corrupt save. Absent on
    // legacy saves → no chests restored (resetInRunFeatureState wins).
    if (state.chestState) {
      for (const chest of state.chestState) {
        if (Number.isFinite(chest.x) && Number.isFinite(chest.y)) {
          this.addTreasureChest(
            chest.x, chest.y, chest.isSpecial === true, chest.isPoiCache === true);
        }
      }
    }

    // Reset other state. Note: hasWon is NOT reset here — it was restored from
    // the save above (a refresh during post-victory endless mode must keep the
    // won flag) and resetting it here would clobber that.
    this.isGameOver = false;
    this.isPaused = false;
    this.pendingLevelUps = 0;
    this.pendingOrientationRelayout = false;
    this.nextEnemyDropsMagnet = false;
    // Cache-drop guard: the pending reveal persisted by CardCollectionManager
    // is one authority, but showVictory() consumes it while the run continues
    // into endless — the saved flag covers that window so a reload can't
    // re-arm the once-per-run cache. OR the two sources (legacy saves lack
    // the flag; an abandoned-run pending reveal lacks the save).
    this.syncCacheGuardWithPendingReveal();
    this.cacheFoundThisRun = this.cacheFoundThisRun || state.cacheFoundThisRun === true;
    this.enemyProjectileManager.clear();

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

    // After the entity + chest passes, never before: the POI records re-link to the handles
    // those passes create.
    this.relinkRestoredPoiSlots(state);

    // The boss restores as an ordinary enemy, so without this the fight comes back with its
    // health bar and nothing else: no arena tint, no boss hazards at all (the hazard cadence
    // returns early with no live boss), no bossActive music cue, and no siege suppression.
    // Cleared unconditionally first because create() returns at the restore branch and never
    // reaches the fresh block that zeroes this, so on a scene restart it can still hold the
    // previous run's values.
    this.bossFightDirector.clearActiveBoss();
    const savedBossType = typeof state.activeBossType === 'string'
      && state.activeBossType.length > 0
      && state.activeBossType.length <= 64
      && getEnemyType(state.activeBossType) !== undefined
      ? state.activeBossType
      : '';
    // A tampered save must not be able to pin a permanent overlay on a bossless run: the
    // arena is only re-entered when a boss really did come back, tested the way restoreEnemy
    // and hasOtherAliveBoss test it.
    const restoredBossIsAlive = state.entities.some(
      entity => entity.enemyData !== undefined && entity.enemyData.xpValue >= 1000,
    );
    if (savedBossType !== '' && restoredBossIsAlive) {
      activateBossArena(savedBossType);
      this.bossFightDirector.setActiveBoss(savedBossType);
    }

    // The camera and the two screen-sized view layers are wired only once the player
    // visual exists, exactly as the fresh path does it, and the saved view is then
    // re-applied on top. A following camera with a deadzone is not necessarily
    // player-centred, so re-centring on the player instead would snap the world by up to
    // half a deadzone on every refresh. Arena: both calls are no-ops.
    if (this.playerId !== -1 && this.playerSpaceship) {
      // A save written before this world's geometry existed names a point the tiles may
      // now fill, which would resume the run with the ship inside a wall. Arena's
      // freeSpotNear is the identity, so this is inert there.
      const freeSpot = { x: 0, y: 0 };
      this.worldMode.freeSpotNear(
        Transform.x[this.playerId], Transform.y[this.playerId], freeSpot,
      );
      Transform.x[this.playerId] = freeSpot.x;
      Transform.y[this.playerId] = freeSpot.y;
      this.playerSpaceship.getContainer().setPosition(freeSpot.x, freeSpot.y);
      this.worldMode.setupCamera(
        this.playerSpaceship.getContainer(),
        this.gridBackground,
        this.trailManager,
      );
      if (state.expedition) {
        this.worldMode.restoreViewState(state.expedition);
      }
    }

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
        // Re-apply the evolution if this weapon was evolved before the refresh.
        // The recipe (evolved name + permanent base-stat multipliers) is looked
        // up by id rather than serialized, so the save stays small and the
        // multipliers can't drift from the source-of-truth recipe. evolve()
        // mutates baseStats independent of level, so applying it after the
        // levelUp loop yields the same final stats regardless of the order it
        // happened during play. Marking the weapon evolved also stops the next
        // level-up's checkEvolutions from spuriously re-firing the EVOLVED modal.
        if (weaponData.evolved) {
          const evolution = getEvolutionForWeapon(weaponData.id);
          if (evolution) {
            weapon.evolve(evolution.evolvedName, evolution.statMultipliers);
          }
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
        addUltimateChargeFromDamage(damage);
        getAchievementManager().recordDamageDealt(damage, isCrit);
      },
      (enemyId, x, y) => {
        addUltimateChargeFromKill();
        this.handleEnemyDeath(enemyId, x, y);
      },
      (amount) => {
        this.healPlayer(amount);
      },
      // Wired after the restore weapon loop above, so re-equipping a synergized
      // build on save-restore does not fire activation toasts.
      (synergy) => {
        this.showSynergyToast(synergy);
      }
    );

    // Sync stats to player
    this.syncStatsToPlayer();

    // Create HUD manager and build all HUD elements (restore path)
    this.hudManager = new HUDManager(this, {
      worldLevel: getMetaProgressionManager().getWorldLevel(),
      onPauseClicked: () => this.togglePauseMenu(),
      onAutoBuyToggled: () => this.toggleAutoBuy(),
      hasWorldMap: () => this.worldMode.worldMap() !== null,
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
      // Atmosphere band: above the lighting layer, below all UI — the
      // low-HP pulse must not tint the HP bar it points at.
    ).setScrollFactor(0).setDepth(OverlayDepths.DANGER_VIGNETTE);

    // Populate upgrade icons with restored weapons and upgrades
    this.hudManager.updateUpgradeIcons(this.buildUpgradeIconData());

    // Create pause menu manager (restore path)
    this.pauseMenuManager = this.createPauseMenuManager();

    // Setup all input event handlers and input controller
    this.setupInputEventHandlers();

    // Mirror the fresh path: without this, F10 flips the persisted setting
    // but applyDirectorDebugVisibility null-guards and shows nothing for the
    // entire restored run.
    this.createDirectorDebugOverlay();

    // Restore dash state from save
    this.inputController.setDashCooldownTimer(state.dashCooldownTimer);
    this.inputController.resetDashState();

    // UI-scale flow: the player was inside the pause menu when the scale
    // changed — don't ambush them with live combat after the rebuild.
    if (this.resumeIntoPauseMenu) {
      this.resumeIntoPauseMenu = false;
      this.togglePauseMenu();
    }
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
      this.enemyProjectileManager.spawn(x, y, angle, speed, damage);
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
      (x1, y1, x2, y2, damage) => this.enemyProjectileManager.fireLaser(x1, y1, x2, y2, damage)
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
   * Rebuilds `poiSlotObjects` from `poiState.slots` after the entity and chest passes have run.
   * Chests and boosts are RE-LINKED to the handles those passes already created (re-spawning
   * them would put two of each in the room), while crates are re-spawned here because
   * serializeEntities skips every Destructible as transient, which is the whole reason a POI
   * crate cache did not survive a refresh.
   */
  private relinkRestoredPoiSlots(state: GameSaveState): void {
    const slots = state.poiState?.slots;
    if (!Array.isArray(slots)) return;

    const unclaimedChests = this.activeChests.filter(chest => chest.isPoiCache);
    const unclaimedBoosts: number[] = [];
    for (const entityId of retireConsumableQuery(this.world)) unclaimedBoosts.push(entityId);

    for (const slot of slots) {
      if (typeof slot?.id !== 'string' || !this.spawnedPoiSlotIds.has(slot.id)) continue;
      if (typeof slot.sectorKey !== 'string' || slot.sectorKey.length === 0) continue;
      if (!Array.isArray(slot.objects)) continue;

      const objects: PoiSlotObject[] = [];
      let missingHandle = false;
      for (const saved of slot.objects) {
        if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
          missingHandle = true;
          continue;
        }
        if (saved.kind === 'chest') {
          const index = unclaimedChests.findIndex(chest =>
            Math.abs(chest.graphics.x - saved.x) <= POI_RELINK_TOLERANCE
            && Math.abs(chest.graphics.y - saved.y) <= POI_RELINK_TOLERANCE);
          if (index < 0) { missingHandle = true; continue; }
          objects.push({ kind: 'chest', chest: unclaimedChests[index] });
          unclaimedChests.splice(index, 1);
        } else if (saved.kind === 'crate') {
          objects.push({ kind: 'crate', entityId: this.addDestructible(saved.x, saved.y) });
        } else if (saved.kind === 'shrine') {
          // The altar is already back: shrineManager.restore ran at the top of restoreGameState,
          // long before this pass. Re-adding it here would stand two altars on the same tile.
          if (!this.shrineManager.hasShrineAt(saved.x, saved.y)) { missingHandle = true; continue; }
          objects.push({
            kind: 'shrine',
            shrineType: saved.shrineType as ShrineType,
            x: saved.x,
            y: saved.y,
          });
        } else if (saved.kind === 'boost') {
          const index = unclaimedBoosts.findIndex(entityId =>
            Consumable.kind[entityId] === saved.consumable
            && Math.abs(Transform.x[entityId] - saved.x) <= POI_RELINK_TOLERANCE
            && Math.abs(Transform.y[entityId] - saved.y) <= POI_RELINK_TOLERANCE);
          if (index < 0) { missingHandle = true; continue; }
          objects.push({
            kind: 'boost',
            entityId: unclaimedBoosts[index],
            consumable: saved.consumable as ConsumableKind,
          });
          unclaimedBoosts.splice(index, 1);
        } else {
          missingHandle = true;
        }
      }

      if (objects.length === 0) continue;
      // A handle the save promised and the restore did not produce means this record is no
      // longer a faithful picture of the slot, so it is treated as partly looted: protected,
      // never retired. Same conservative side as `intact: false`.
      this.poiSlotObjects.set(slot.id, {
        sectorKey: slot.sectorKey,
        objects,
        partlyLooted: slot.intact !== true || missingHandle,
      });
    }
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
        case 'consumable':
          this.restoreConsumable(entity);
          break;
      }
    }

    if (this.restoredLegionMembers.length > 0) {
      const rebuiltLegion = registerRestoredLegionMembers(this.restoredLegionMembers);
      this.restoredLegionMembers.length = 0;
      if (rebuiltLegion) {
        const legionName = getEnemyType('the_legion')?.name ?? 'The Legion';
        if (this.hudManager) {
          this.hudManager.createBossHealthBar(rebuiltLegion.anchorId, legionName, true);
        } else {
          this.pendingBossHealthBars.push({ entityId: rebuiltLegion.anchorId, name: legionName, isBoss: true });
        }
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
    addComponent(this.world, Knockback, entityId);

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

    // Not restored, deliberately: the save has no player knockback field (serializeEnemy
    // is the only writer of one), and a mid-shove resume should start the ship at rest.
    Knockback.velocityX[entityId] = 0;
    Knockback.velocityY[entityId] = 0;
    Knockback.decay[entityId] = 0.001;

    // Restore health from playerStats (more reliable than entity data)
    Health.current[entityId] = this.playerStats.currentHealth;
    Health.max[entityId] = this.playerStats.maxHealth;

    // Create player visual (procedural neon spaceship)
    this.playerSpaceship = new PlayerSpaceship(this, entity.transform.x, entity.transform.y, {
      baseRadius: 16,
      neonColor: this.getShipNeonColor(),
      quality: this.visualQuality,
      hullId: this.getShipHullId(),
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

    // Restore elite affix. Stats (HP/XP/armor/speed) are already baked into the
    // saved values above, so we only re-attach the component + type — this is
    // enough for the query-driven EliteAffixVisualManager to redraw the
    // ring/HP-bar/label, and for volatile/vampiric/blessed death + contact
    // behaviours and elite-kill bounty tracking to recognise it again.
    const restoredAffix = entity.enemyData.affixType ?? EnemyAffixType.NONE;
    const restoredAffix2 = (entity.enemyData.affixType2 ?? EnemyAffixType.NONE) as EnemyAffixType;
    if (restoredAffix !== EnemyAffixType.NONE) {
      addComponent(this.world, EnemyAffix, entityId);
      EnemyAffix.affixType[entityId] = restoredAffix;
      EnemyAffix.affixType2[entityId] = restoredAffix2;
      // HP/XP/speed are captured in the serialized Health/EnemyType/Velocity, but
      // armor was re-derived from the base type above — so re-apply the affix's
      // flat armor bonus (only TITAN is non-zero; a no-op for the others).
      EnemyType.armor[entityId] += AFFIX_META[restoredAffix as EnemyAffixType].bonusArmor;
      EnemyType.armor[entityId] += AFFIX_META[restoredAffix2].bonusArmor;
    }

    const restoredNemesis = entity.enemyData.nemesis === true;
    if (restoredNemesis) {
      addComponent(this.world, NemesisTag, entityId);
    }

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

    // EnemyType.size IS serialized (already carries the bump), but the sprite is
    // rebuilt from the base type — re-scale it so a refreshed hunter still reads as one.
    if (restoredNemesis) {
      sprite.setScale((sprite.scaleX || 1) * NEMESIS_SPRITE_SCALE);
    }

    this.enemyCount++;

    // Queue boss health bar creation (hudManager may not exist yet during restore path)
    const restoredLegionGeneration = legionGenerationForType(entity.enemyData.typeId);
    if (restoredLegionGeneration !== null) {
      this.restoredLegionMembers.push({ entityId, generation: restoredLegionGeneration });
    }
    // Legion members share ONE rebuilt group bar (created after the entity
    // pass) instead of a per-member bar each.
    if (entity.enemyData.xpValue >= 30 && restoredLegionGeneration === null) {
      // Affixed bosses/minibosses keep their title-prefixed bar across a refresh.
      const affixName = affixDisplayName(enemyType.name, restoredAffix as EnemyAffixType, restoredAffix2);
      const bossBarName = restoredNemesis
        ? nemesisLabel(affixName, this.nemesisRecord?.grudge ?? 1)
        : affixName;
      if (this.hudManager) {
        this.hudManager.createBossHealthBar(entityId, bossBarName, entity.enemyData.xpValue >= 1000);
      } else {
        // Defer — will be created after hudManager initialization
        this.pendingBossHealthBars.push({ entityId, name: bossBarName, isBoss: entity.enemyData.xpValue >= 1000 });
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
   * Restores a floor consumable (bomb/freeze/vacuum/gold cache/field boost) from saved state.
   * Mirrors the magnet/health pickup pattern: re-spawn at the saved position with
   * its kind + gold payload. The magnetized flag is intentionally not restored —
   * like the sibling pickups, it simply re-arms when the player nears it.
   */
  private restoreConsumable(entity: GameSaveState['entities'][0]): void {
    if (!entity.consumableData) return;
    spawnConsumablePickup(
      this.world,
      entity.transform.x,
      entity.transform.y,
      entity.consumableData.kind as ConsumableKind,
      entity.consumableData.value,
    );
  }

  /**
   * Syncs the per-run cache-drop guard with CardCollectionManager's persisted
   * pending reveal. The manager is authoritative (it survives refresh and
   * abandoned runs): a leftover pending card keeps its end-screen reveal and
   * blocks this run from rolling a second cache over it.
   */
  private syncCacheGuardWithPendingReveal(): void {
    this.cacheFoundThisRun = getCardCollectionManager().peekPendingReveal() !== null;
  }

  /**
   * Consume the queued data-cache reveal for an end screen. Consumption IS
   * the discovery moment (the card becomes visible in the archive and its
   * bonus starts counting), so the collection milestones are fed here — while
   * this scene's achievement unlock callback is wired to deliver toast+gold.
   */
  private consumeCardRevealForEndScreen(): CardDefinition | null {
    const cardManager = getCardCollectionManager();
    const card = cardManager.consumePendingReveal();
    if (card) {
      getAchievementManager().recordCardsDiscovered(cardManager.getDiscoveredIds().size);
    }
    return card;
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

    // Destructibles share the EnemyTag pipeline (so weapons can hit them) but
    // are not kills — drop loot + AOE and bail before any combo/XP/kill logic.
    if (hasComponent(this.world, Destructible, enemyId)) {
      this.handleDestructibleDestroyed(enemyId, x, y);
      return;
    }

    // The Legion splits on death: mid-tree deaths spawn children and pay no
    // rewards; the last member is promoted in place and falls through to the
    // normal boss-death path (full XP, drops, victory).
    if (this.resolveLegionDeath(enemyId, x, y)) return;

    this.enemyCount--;
    this.killCount++;

    // Track bounty progress (elite kills detected via the affix component).
    const isEliteKill = hasComponent(this.world, EnemyAffix, enemyId);
    this.recordBountyKill(isEliteKill);

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
      this.recordRunTimelineEvent('bossDown');
    } else if (xpValueForTracking >= 30) {
      achievementManager.recordMinibossKill();
      this.recordRunTimelineEvent('bossDown');
    }

    this.spawnRegionDeathBloom(x, y, isEliteKill || xpValueForTracking >= REGION_BLOOM_XP_FLOOR);

    // Paragon = a second affix (applyDampedAffixStats zeroes affixType2 when it
    // applies a primary, so a recycled entity id can't read as one).
    if (hasComponent(this.world, EnemyAffix, enemyId)
      && EnemyAffix.affixType2[enemyId] !== EnemyAffixType.NONE) {
      achievementManager.recordParagonKill();
    }

    // Track kill in codex
    const enemyTypeId = this.enemyTypeMap.get(enemyId);
    if (enemyTypeId) {
      const codexManager = getCodexManager();
      // Read the count BEFORE recording this kill: recordEnemyKill increments it,
      // so afterwards a first kill is indistinguishable from a hundredth.
      const priorKills = codexManager.getEnemyEntry(enemyTypeId)?.timesKilled ?? 0;
      codexManager.recordEnemyKill(enemyTypeId);
      achievementManager.recordBossTypeKills(
        enemyTypeId,
        codexManager.getEnemyEntry(enemyTypeId)?.timesKilled ?? 0,
      );
      if (priorKills === 0) {
        const trophy = getBossTrophy(enemyTypeId);
        if (trophy) this.trophyUnlockedThisRun = trophy.relic.name;
      }
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
    const dropChance =
      (xpValue >= 30 ? this.HEALTH_DROP_CHANCE * 3 : this.HEALTH_DROP_CHANCE)
      * this.playerStats.healthDropMultiplier;
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
    const consumableChance =
      (xpValue >= 1000 ? 1 : xpValue >= 30 ? 0.18 : 0.012)
      * this.playerStats.dropRateMultiplier;
    if (Math.random() < consumableChance) {
      this.spawnRandomConsumable(x, y, xpValue);
    }

    // Check for explosion on death. Not instant (BALANCE-EXPLODER-FUSE): the
    // corpse arms a 0.4s fuse, telegraphed by a danger ring over the blast
    // footprint, then update() detonates it via the fuse tick below. Each
    // death arms its own independent fuse. VOLATILE affix detonations (next
    // block) intentionally stay instant — parked in BACKLOG.md.
    if (flags & EnemyFlags.EXPLODES_ON_DEATH) {
      spawnTelegraph(this.telegraphManager, x, y, exploderFuseTelegraph());
      armExploderFuse(this.exploderFuses, x, y);
    }

    // Check for split on death
    if (flags & EnemyFlags.SPLITS_ON_DEATH) {
      this.handleSplit(x, y);
    }

    // ═══ ELITE AFFIX DEATH EFFECTS ═══
    if (hasComponent(this.world, EnemyAffix, enemyId)) {
      const deathAffix = EnemyAffix.affixType[enemyId];
      const deathAffix2 = EnemyAffix.affixType2[enemyId];
      if (deathAffix === EnemyAffixType.VOLATILE || deathAffix2 === EnemyAffixType.VOLATILE) {
        // Queue the detonation and drain iteratively — detonateArea can kill
        // other volatile elites, which would otherwise re-enter handleEnemyDeath
        // recursively. The drain serializes any chain reaction.
        this.volatileQueue.push({ x, y });
        this.drainVolatileExplosions();
      } else if (deathAffix === EnemyAffixType.BLESSED) {
        this.spawnRandomConsumable(x, y, xpValue);           // guaranteed power-up
      }
    }

    // ═══ DATA CACHE DROPS (card collection discovery) ═══
    // One roll per death at the highest applicable tier only: boss always,
    // miniboss 20%, elite 2%. At most one cache per run — the reveal is a
    // single end-screen moment (SFR-style), so the card itself stays hidden
    // behind a teaser toast until death/victory.
    let dataCacheDroppedThisDeath = false;
    if (!this.cacheFoundThisRun) {
      const cacheChance = xpValue >= 1000 ? 1
        : xpValue >= 30 ? 0.2
        : hasComponent(this.world, EnemyAffix, enemyId) ? 0.02
        : 0;
      if (cacheChance > 0 && Math.random() < cacheChance) {
        this.cacheFoundThisRun = true;
        dataCacheDroppedThisDeath = true;
        const cacheCard = getCardCollectionManager().rollCacheDiscovery();
        if (cacheCard) {
          this.toastManager?.showToast({
            tier: 'rare',
            title: 'DATA CACHE RECOVERED',
            description: 'Decrypting at run end…',
            icon: 'star',
            color: 0x66ddff,
            duration: 3200,
          });
        } else {
          // Archive complete — pay the cache out in gold instead.
          getMetaProgressionManager().addGold(250);
          this.toastManager?.showToast({
            tier: 'rare',
            title: 'DATA CACHE RECOVERED',
            description: 'Archive complete — salvaged for +250 gold.',
            icon: 'coins',
            color: 0xffd24a,
            duration: 3200,
          });
        }
      }
    }

    // ═══ FLUX CACHE DROPS (one-run boost cards — FEAT-CARDS-3) ═══
    // Miniboss-only, mutually exclusive with the data-cache roll above (data
    // cache wins the death). rollFluxCache() itself returns null while a
    // boost is already armed — a held boost is never re-rolled or replaced,
    // so the drop simply stays silent until it's spent on a fresh run.
    const isMiniboss = xpValue >= 30 && xpValue < 1000;
    if (!dataCacheDroppedThisDeath && isMiniboss && Math.random() < FLUX_CACHE_DROP_CHANCE) {
      const boost = getBoostCardManager().rollFluxCache();
      if (boost) {
        this.toastManager?.showToast({
          tier: 'notable',
          title: 'FLUX CACHE',
          description: `${boost.name} armed for next run`,
          icon: boost.icon,
          color: 0xffaa22,
          duration: 3200,
        });
      }
    }

    // ═══ PANDEMIC SPREAD (poison spreads to nearby enemies on death) ═══
    if (this.playerStats.pandemicSpread > 0 && hasComponent(this.world, StatusEffect, enemyId)) {
      const poisonStacks = StatusEffect.poisonStacks[enemyId];
      if (poisonStacks > 0) {
        // pandemicSpread is the COUNT of enemies to infect, not a radius (max 5) --
        // query a fixed bloom radius and stop once that many have caught it.
        const maxInfections = this.playerStats.pandemicSpread;
        const nearbyEnemies = getEnemySpatialHash().query(x, y, PANDEMIC_SPREAD_RADIUS);
        const spreadStacks = Math.max(1, Math.floor(poisonStacks / 2));
        let infected = 0;
        for (const nearby of nearbyEnemies) {
          if (infected >= maxInfections) break;
          if (nearby.id === enemyId) continue;
          // Skip entities already removed this frame (stale spatial hash entries)
          if (!hasComponent(this.world, EnemyTag, nearby.id)) continue;
          applyPoison(this.world, nearby.id, spreadStacks, 4000, this.playerStats.poisonMaxStacks);
          // Visual feedback for poison spread
          this.effectsManager.showDamageNumber(nearby.x, nearby.y - 10, spreadStacks, 0x66ff66);
          infected++;
        }
      }
    }

    // ═══ NEMESIS SLAIN (FEAT-NEMESIS) ═══
    // The grudge is dropped the moment the hunter dies, so a later death in the
    // same run starts a fresh record instead of re-escalating the one just settled.
    if (hasComponent(this.world, NemesisTag, enemyId)) {
      const grudge = this.nemesisRecord?.grudge ?? 1;
      clearNemesis();
      this.nemesisRecord = null;
      getMetaProgressionManager().addGold(nemesisGoldReward(grudge));
      this.grantRelicChoice(1);
      this.toastManager?.showToast({
        tier: 'rare',
        title: 'NEMESIS SLAIN',
        description: `+${nemesisGoldReward(grudge)} gold  ·  relic recovered`,
        icon: 'skull',
        color: 0xff6644,
        duration: 3200,
      });
      // Killed at its den, so the den breaks open. The chest lands where the hunter fell, not
      // at the lair: the leash drags a chasing nemesis across the world, so a chest at the den
      // could be a reward the player never returns for.
      if (this.breakOpenNemesisLair()) {
        this.addTreasureChest(x, y, true, true);
        this.recordExpeditionQuest({ kind: 'clearHazard', hazardKind: 'lair' });
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
      this.addWorldDistortion(x, y, 400, 0.04, 500);

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

      // Deactivate boss arena atmosphere (plays cleansing flash) — but only
      // when this was the LAST boss standing. Gauntlet waves (and endless
      // cycle 3+) field several bosses at once; the first kill must not strip
      // the fight's atmosphere/lighting while its siblings live.
      if (!this.hasOtherAliveBoss(enemyId)) {
        deactivateBossArena();
        this.bossFightDirector.clearActiveBoss();
        this.worldMode.releaseSectorLock();
      }

      // Gold sparkle rain across the room for boss death celebration. The view rect is a
      // reused instance, so its numbers are read out now rather than inside the delayed
      // calls that fire over the next 720 ms.
      const rainView = this.worldMode.viewRect();
      const rainMinX = rainView.minX;
      const rainSpanX = rectWidth(rainView);
      const rainMinY = rainView.minY;
      const rainSpanY = rectHeight(rainView) * 0.6;
      for (let sparkleIndex = 0; sparkleIndex < 12; sparkleIndex++) {
        this.time.delayedCall(sparkleIndex * 60, () => {
          const rainX = rainMinX + Math.random() * rainSpanX;
          const rainY = rainMinY + Math.random() * rainSpanY;
          this.effectsManager.playGoldSparkle(rainX, rainY, 4);
        });
      }

      // Boss kill = Victory! Advance to next world level. GAUNTLET waves and
      // PRACTICE spawns keep going instead — bosses there are fodder, not the
      // win condition.
      if (!this.hasWon && !this.gauntletModeActive && !this.practiceModeActive) {
        const metaManager = getMetaProgressionManager();
        metaManager.advanceWorldLevel();
        this.showVictory(this.recordWorldConquered());
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
      this.addWorldDistortion(x, y, 250, 0.025, 400);

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

    this.finalizeEnemyEntityRemoval(enemyId);
  }

  /**
   * Unregisters an enemy from every visual manager, removes the ECS entity, and
   * plays the kill-flash pop on its lingering sprite. Shared by the normal
   * death path and the Legion split branch.
   */
  private finalizeEnemyEntityRemoval(enemyId: number): void {
    // Read enemy size before removing entity (ECS data wiped on removeEntity)
    const killFlashSize = EnemyType.size[enemyId] || 1;

    // Clean up entity — unregister from ECS immediately, but let visual linger for kill flash
    this.deathRippleManager.unregisterEnemy(enemyId);
    this.statusEffectVisualManager.unregisterEnemy(enemyId);
    this.eliteAffixVisualManager.unregisterEnemy(enemyId);
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
        this.takeDamage(damage, undefined, 'Explosion');

        // Knockback from explosion (skipped when Juggernaut ship's immunity is active)
        if (!this.playerStats.knockbackImmunity) {
          const knockbackDir = Math.atan2(playerY - y, playerX - x);
          Knockback.velocityX[this.playerId] = Math.cos(knockbackDir) * 300;
          Knockback.velocityY[this.playerId] = Math.sin(knockbackDir) * 300;
        }
      }
    }

    this.damageEscortDroneByBlast(damage, x, y, radius);
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
   * Routes a Legion member death. Returns true when the death was fully handled
   * here (mid-tree split — no rewards); returns false for non-legion enemies AND
   * for the final member, which is promoted to boss xpValue so the normal
   * boss-death path pays out exactly once.
   */
  private resolveLegionDeath(enemyId: number, x: number, y: number): boolean {
    const outcome = onLegionMemberDeath(enemyId);
    if (!outcome) return false;

    if (outcome.isLastMember) {
      const legionBossType = getEnemyType('the_legion');
      EnemyType.xpValue[enemyId] = legionBossType ? legionBossType.xpValue : 1000;
      this.enemyTypeMap.set(enemyId, 'the_legion');
      this.hudManager.removeBossHealthBar(outcome.anchorId);
      return false;
    }

    // Split: children partition the parent's pool. Parent max HP includes the
    // curse multiplier; divide it out because createEnemy curses again.
    if (outcome.childTypeId) {
      const childType = getEnemyType(outcome.childTypeId);
      if (childType) {
        const curseMultiplier = this.playerStats.curseMultiplier || 1;
        const parentMaxHealth = Health.max[enemyId];
        const offsets = legionChildSpawnOffsets(
          outcome.childCount,
          outcome.spawnOffsetRadius,
          Math.random() * Math.PI * 2
        );
        for (const offset of offsets) {
          const childStats = getScaledStats(childType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult);
          childStats.health = (parentMaxHealth * outcome.childHealthFraction) / curseMultiplier;
          const childId = this.createEnemy(x + offset.x, y + offset.y, childType, childStats);
          registerLegionChild(childId, outcome.groupId, outcome.generation + 1);
        }
      }
    }

    // Reward-free bookkeeping — mirrors the normal path minus XP/drops/cache,
    // and deliberately skips removeBossHealthBar: the group bar stays anchored
    // to the (now dead) root until the last member falls.
    this.enemyCount--;
    this.killCount++;
    const comboResult = recordComboKill();
    if (comboResult.triggeredThreshold) {
      this.handleComboThreshold(comboResult.triggeredThreshold);
    }
    if (comboResult.tierChanged && !comboResult.triggeredThreshold) {
      this.handleComboTierChange(comboResult.tierChanged);
    }
    getAchievementManager().recordKill(1);
    const legionTypeId = this.enemyTypeMap.get(enemyId);
    if (legionTypeId) {
      getCodexManager().recordEnemyKill(legionTypeId);
      this.enemyTypeMap.delete(enemyId);
    }
    recordEnemyDeath(x, y);

    // Split burst — bigger than a trash death, smaller than the boss cascade.
    this.effectsManager.playDeathBurst(x, y, 0xdd33bb);
    this.deathRippleManager.spawnRipple(x, y);
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.shakeCamera(180, 0.012);
    }

    this.finalizeEnemyEntityRemoval(enemyId);
    return true;
  }

  /**
   * Spawns a weighted-random floor consumable at a position. GOLD caches carry
   * a payload that scales with run progress so they stay relevant late game.
   */
  private spawnRandomConsumable(x: number, y: number, sourceXpValue = 0): void {
    if (Math.random() < FIELD_BOOST_DROP_CHANCE) {
      this.spawnFieldBoostPickup(x, y);
      return;
    }

    const roll = Math.random();
    let kind: ConsumableKind;
    if (roll < 0.30) kind = ConsumableKind.BOMB;
    else if (roll < 0.58) kind = ConsumableKind.FREEZE;
    else if (roll < 0.80) kind = ConsumableKind.VACUUM;
    else kind = ConsumableKind.GOLD;

    // A boss's guaranteed cache is the only gold a boss produces, so it is what
    // "bonus gold from bosses" has to scale. Non-enemy drops (shrine, bounty,
    // crate) pass no source and are unaffected.
    const bossGoldScale = sourceXpValue >= 1000 ? this.playerStats.bossGoldMultiplier : 1;
    const goldValue = kind === ConsumableKind.GOLD
      ? Math.round(
          (25 + Math.floor(this.gameTime * 0.5) + this.worldLevel * 10)
            * ENDLESS_MUTATOR_META[this.endlessDirector.getMutator()].goldDropScale
            * bossGoldScale,
        )
      : 0;
    spawnConsumablePickup(this.world, x, y, kind, goldValue);
  }

  /** Spawns one uniformly-chosen field boost pickup. */
  private spawnFieldBoostPickup(x: number, y: number): { entityId: number; consumableKind: ConsumableKind } {
    const boost = FIELD_BOOSTS[Math.floor(Math.random() * FIELD_BOOSTS.length)];
    return {
      entityId: spawnConsumablePickup(this.world, x, y, boost.kind, 0),
      consumableKind: boost.kind,
    };
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
            tier: 'ambient',
            title: `Gold Cache +${amount}`,
            description: 'Bonus gold banked for the shop.',
            icon: 'coins',
            color: 0xffd24a,
            duration: 2500,
          });
        }
        break;
      }
      default: {
        const boost = getFieldBoostByKind(kind);
        if (boost) this.collectFieldBoost(boost);
        break;
      }
    }
  }

  /**
   * Applies a collected field boost: a timed PlayerStats surge that reverts on the run
   * clock. A duplicate pickup refreshes the existing buff rather than stacking a second
   * multiply, so the stat can never compound past one application.
   */
  private collectFieldBoost(boost: FieldBoostDefinition): void {
    const { buffs, applied } = applyFieldBoost(
      this.timedStatBuffs,
      boost.stat,
      boost.magnitude,
      boost.durationSeconds,
      this.gameTime,
    );
    this.timedStatBuffs = buffs;
    if (applied) {
      this.playerStats[boost.stat] *= boost.magnitude;
      this.syncStatsToPlayer();
    }
    this.soundManager.playSynergyActivation();
    if (this.toastManager) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: boost.name,
        description: `+${Math.round((boost.magnitude - 1) * 100)}% ${boost.effectLabel} for ${boost.durationSeconds}s.`,
        icon: boost.icon,
        color: getConsumableKindColor(boost.kind),
        duration: 2500,
      });
    }
  }

  /**
   * Fires the charged ultimate if the meter is full. What it *does* comes from the
   * flown ship's entry in ShipUltimates.ts; the meter, the nova scaling and the
   * charge suppression stay shared (UltimateSystem.ts). Charge gain is suppressed
   * during the nova so its own damage (which routes back through damageEnemy)
   * cannot instantly refill the meter. No-op when not ready — the input event fires
   * on every Q/Y press.
   */
  private activateUltimate(): void {
    if (this.playerId === -1) return;
    if (!tryActivateUltimate()) return;
    this.recordRunTimelineEvent('ultimate');

    const ultimate = this.practiceUltimateOverride
      ? getShipUltimate(this.practiceUltimateOverride)
      : getUltimateForShip(getShipById(this.selectedShipId) ?? getDefaultShip());
    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];
    const nova = computeUltimateNova(this.playerStats.damageMultiplier, this.gameTime);
    const radius = nova.radius * ultimate.nova.radiusMultiplier;

    setUltimateChargeSuppressed(true);
    this.weaponManager.detonateArea(
      playerX,
      playerY,
      radius,
      nova.damage * ultimate.nova.damageMultiplier,
      ultimate.nova.knockback
    );
    this.applyUltimateStatusEffects(ultimate, playerX, playerY, radius);
    setUltimateChargeSuppressed(false);

    if (ultimate.healFraction) {
      this.healPlayer(this.playerStats.maxHealth * ultimate.healFraction);
    }
    if (ultimate.iframeSeconds) {
      this.damageCooldown = Math.max(this.damageCooldown, ultimate.iframeSeconds);
    }
    if (ultimate.slowTimeSeconds) {
      this.playerStats.slowTimeRemaining += ultimate.slowTimeSeconds;
    }
    for (const buff of ultimate.statBuffs ?? []) {
      this.applyTimedStatBuff(buff.stat, buff.magnitude, buff.seconds);
    }

    this.effectsManager.playDeathBurst(playerX, playerY, ultimate.burstColor);
    this.cameras.main.flash(
      ultimate.flash.durationMs,
      ultimate.flash.red,
      ultimate.flash.green,
      ultimate.flash.blue
    );
    this.cameras.main.shake(ultimate.shake.durationMs, ultimate.shake.intensity);
    getJuiceManager().slowMotion(
      ultimate.slowMo.durationMs,
      ultimate.slowMo.scale,
      ultimate.slowMo.rampMs
    );
    this.soundManager.playUltimate();

    this.toastManager.showToast({
      tier: 'ambient',
      title: ultimate.name.toUpperCase(),
      description: ultimate.description,
      icon: 'lightning',
      color: ultimate.burstColor,
      duration: 2200,
    });
  }

  /**
   * PRACTICE only — fill the meter and fire immediately. Judging the 11 ultimates
   * otherwise costs ~40 kills per shot. fillUltimateCharge() (not addUltimateCharge)
   * because the latter is scaled by the charge-rate multiplier and dropped while
   * suppressed.
   */
  private firePracticeUltimate(): void {
    if (!this.practiceModeActive) return;
    fillUltimateCharge();
    this.activateUltimate();
  }

  /**
   * Lands the ultimate's status effects on enemies still alive inside the nova.
   * Called inside the charge-suppression window: burn/poison tick back through
   * damageEnemy and would otherwise start refilling the meter the nova just spent.
   */
  private applyUltimateStatusEffects(
    ultimate: ShipUltimateDefinition,
    centerX: number,
    centerY: number,
    radius: number
  ): void {
    if (!ultimate.freeze && !ultimate.burn && !ultimate.poison) return;
    for (const target of getEnemySpatialHash().query(centerX, centerY, radius)) {
      const enemyId = target.id;
      if (!hasComponent(this.world, EnemyTag, enemyId) || Health.current[enemyId] <= 0) continue;
      if (ultimate.freeze) {
        applyFreeze(
          this.world,
          enemyId,
          ultimate.freeze.slowMultiplier,
          ultimate.freeze.durationMs,
          this.playerStats.freezeDurationMultiplier
        );
      }
      if (ultimate.burn) {
        applyBurn(
          this.world,
          enemyId,
          ultimate.burn.damage,
          ultimate.burn.durationMs,
          this.playerStats.burnDamageMultiplier
        );
      }
      if (ultimate.poison) {
        applyPoison(
          this.world,
          enemyId,
          ultimate.poison.stacks,
          ultimate.poison.durationMs,
          this.playerStats.poisonMaxStacks
        );
      }
    }
  }

  /**
   * Spawns an environmental destructible (crate). It shares the EnemyTag
   * pipeline so weapons auto-target and destroy it, but has no EnemyAI
   * (stationary) and deals no contact damage. On destruction it bursts for AOE
   * + drops loot.
   */
  private spawnDestructible(): boolean {
    const { x, y } = pickInteriorPoint(this.worldMode.viewRect(), 70, Math.random);
    // Don't spawn right on top of the player.
    if (this.playerId !== -1) {
      const pdx = x - Transform.x[this.playerId];
      const pdy = y - Transform.y[this.playerId];
      if (pdx * pdx + pdy * pdy < 120 * 120) return false; // retry soon
    }
    this.addDestructible(x, y);
    return true;
  }

  /** Builds one crate at a fixed point. Shared by the ambient timer spawner and by map
   *  caches, which place theirs and therefore skip the player-proximity retry. */
  private addDestructible(x: number, y: number): number {
    const entityId = addEntity(this.world);
    addComponent(this.world, Transform, entityId);
    addComponent(this.world, Health, entityId);
    addComponent(this.world, EnemyTag, entityId);
    addComponent(this.world, EnemyType, entityId);
    addComponent(this.world, SpriteRef, entityId);
    addComponent(this.world, Destructible, entityId);

    Transform.x[entityId] = x;
    Transform.y[entityId] = y;
    Transform.rotation[entityId] = 0;

    const hp = 30 + this.gameTime * 0.6;
    Health.current[entityId] = hp;
    Health.max[entityId] = hp;
    EnemyType.typeId[entityId] = 0;
    EnemyType.baseHealth[entityId] = hp;
    EnemyType.baseDamage[entityId] = 0;
    EnemyType.xpValue[entityId] = 0;
    EnemyType.size[entityId] = 1.2;
    EnemyType.armor[entityId] = 0;
    EnemyType.shieldCurrent[entityId] = 0;
    EnemyType.shieldMax[entityId] = 0;
    EnemyType.flags[entityId] = 0;

    // Crate visual: wooden box with cross-bracing.
    const crate = this.add.graphics();
    crate.setPosition(x, y);
    const half = 13;
    crate.fillStyle(0x7a4a22, 1);
    crate.fillRect(-half, -half, half * 2, half * 2);
    crate.lineStyle(2, 0xc98a48, 1);
    crate.strokeRect(-half, -half, half * 2, half * 2);
    crate.lineBetween(-half, -half, half, half);
    crate.lineBetween(half, -half, -half, half);
    crate.setDepth(5);
    registerSprite(entityId, crate);

    this.destructibleCount++;
    return entityId;
  }

  /**
   * Drains queued VOLATILE-affix explosions iteratively. detonateArea can kill
   * other volatile elites whose deaths enqueue more explosions; the re-entrancy
   * guard funnels those into this single loop instead of recursing.
   */
  private drainVolatileExplosions(): void {
    if (this.drainingVolatile) return;
    this.drainingVolatile = true;
    let processed = 0;
    while (this.volatileQueue.length > 0 && processed < 64) {
      const blast = this.volatileQueue.shift()!;
      processed++;
      this.handleExplosion(blast.x, blast.y, 95, 22);           // hurt the player if close
      this.effectsManager.playDeathBurst(blast.x, blast.y, 0xffaa00);
      this.weaponManager.detonateArea(blast.x, blast.y, 95, 45, 220); // chains to nearby enemies
    }
    this.volatileQueue.length = 0; // safety: drop any overflow past the cap
    this.drainingVolatile = false;
  }

  /** Destroys a destructible: AOE damage to nearby enemies + a loot drop. */
  private handleDestructibleDestroyed(enemyId: number, x: number, y: number): void {
    this.destructibleCount = Math.max(0, this.destructibleCount - 1);

    // Burst damages nearby enemies — the payoff for shooting a crate.
    this.weaponManager.detonateArea(x, y, 110, 60 + this.gameTime * 1.5, 260);
    this.effectsManager.playDeathBurst(x, y, 0xffaa44);
    this.cameras.main.shake(120, 0.008);
    this.soundManager.playComboThreshold();

    // Loot: always a gem, frequently a floor consumable or health pack.
    spawnXPGem(this.world, x, y, 8 + Math.floor(this.gameTime * 0.05));
    if (Math.random() < 0.5) {
      this.spawnRandomConsumable(x, y);
    } else if (Math.random() < 0.4) {
      spawnHealthPickup(this.world, x, y, 15 + Math.floor(Math.random() * 10));
    }

    // Cleanup (destructibles aren't registered with ripple/affix systems).
    const sprite = getSprite(enemyId);
    if (sprite) {
      sprite.destroy();
      unregisterSprite(enemyId);
    }
    removeEntity(this.world, enemyId);
  }

  /** One place, called from both create paths before anything can clear or draw a field POI. */
  private createFieldPoiManagers(): void {
    this.abilityVaultManager = new AbilityVaultManager(this, {
      world: () => this.world,
      gameTime: () => this.gameTime,
      worldLevelHealthMult: () => this.worldLevelHealthMult,
      worldLevelDamageMult: () => this.worldLevelDamageMult,
      holdsAbility: (abilityId) => this.ownedTraversalAbilityIds.has(abilityId),
      noteAbilityClaimed: (abilityId) => { this.ownedTraversalAbilityIds.add(abilityId); },
      createEnemy: (x, y, enemyType, scaledStats) =>
        this.createEnemy(x, y, enemyType, scaledStats),
      applyDampedAffixStats: (entityId, affix) => this.applyDampedAffixStats(entityId, affix),
      createGuardHealthBar: (entityId, name) =>
        { this.hudManager?.createBossHealthBar(entityId, name, false); },
      despawnGuard: (entityId) => this.despawnVaultGuard(entityId),
      playDeathBurst: (x, y, color) => this.effectsManager.playDeathBurst(x, y, color),
      showDamageNumber: (x, y, text, color) =>
        this.effectsManager.showDamageNumber(x, y, text, color),
      playLevelUp: () => this.soundManager.playLevelUp(),
      playPurchase: () => this.soundManager.playPurchase(),
      showToast: (config) => this.toastManager?.showToast(config),
      announceNewRoutes: (gainedId, sourceName, icon) =>
        this.announceNewRoutes(gainedId, sourceName, icon),
      recordExpeditionQuest: (event) => this.recordExpeditionQuest(event),
    });
    this.questBoardManager = new QuestBoardManager(this, {
      gameTime: () => this.gameTime,
      openBoard: () => this.openQuestBoard(),
      cargoPending: () => {
        const map = this.worldMode.worldMap();
        if (!map) return false;
        return getExpeditionQuestCargoStatus(questWorldStamp(map)).pending.length > 0;
      },
      collectCargo: (crateX: number, crateY: number) => this.collectQuestBoardCargo(crateX, crateY),
    });
    this.secretCacheManager = new SecretCacheManager(this, {
      gameTime: () => this.gameTime,
      freeSpotNear: (x, y, out) => this.worldMode.freeSpotNear(x, y, out),
      shakeCamera: (duration, intensity) => this.shakeCamera(duration, intensity),
      playDeathBurst: (x, y, color) => this.effectsManager.playDeathBurst(x, y, color),
      showDamageNumber: (x, y, text, color) =>
        this.effectsManager.showDamageNumber(x, y, text, color),
      playError: () => this.soundManager.playError(),
      playPurchase: () => this.soundManager.playPurchase(),
      playLevelUp: () => this.soundManager.playLevelUp(),
      showToast: (config) => this.toastManager?.showToast(config),
      payReward: (reward, x, y) => this.paySecretReward(reward, x, y),
      grantSecretLead: (secretId) => this.grantSecretLead(secretId),
      recordExpeditionQuest: (event) => this.recordExpeditionQuest(event),
    });
    // Not a FieldPoiManager: shrines are timer-paced into the view rect in both modes and carry
    // run-save state. Built here because both create paths already call this exactly once, before
    // the first resetInRunFeatureState.
    this.shrineManager = new ShrineManager(this, {
      gameTime: () => this.gameTime,
      viewRect: () => this.worldMode.viewRect(),
      practiceMode: () => this.practiceModeActive,
      showToast: (config) => this.toastManager?.showToast(config),
      trigger: (type, x, y) => this.triggerShrine(type, x, y),
    });
  }

  /** One place, called from both create paths: the fresh run and the restore. */
  private createMinimapFeed(): void {
    this.minimapManager = new MinimapManager(this);
    this.minimapFeed = new MinimapFeed(this.minimapManager, {
      world: () => this.world,
      playerId: () => this.playerId,
      minimapEnabled: () => getSettingsManager().isMinimapEnabled(),
      worldMap: () => this.worldMode.worldMap(),
      biomeTint: biomeTintFor,
      chests: () => this.activeChests,
      vaults: () => this.abilityVaultManager.contacts(),
      questBoards: () => this.questBoardManager.contacts(),
      ambushNests: () => this.activeAmbushNests,
      nemesisLairs: () => this.activeNemesisLairs,
      secretCaches: () => this.secretCacheManager.contacts(),
      decryptorOwned: () => this.decryptorOwned(),
      spentNestSectorKeys: () => this.spentAmbushNestSectorKeys(),
      markedSectorKeys: () => this.markedSectorKeys,
      holdsAbility: (abilityId) => this.ownedTraversalAbilityIds.has(abilityId),
    });
  }

  /**
   * Resets per-run state for the session's new field systems (destructibles,
   * shrines, bounties). Called on BOTH the fresh-start and restore paths so
   * stale graphics/timers/counters never carry across runs.
   */
  private resetInRunFeatureState(): void {
    getMetaProgressionManager().beginRunLedger();
    this.hasDashedThisRun = false;
    this.ultimateWasReady = false;
    this.destructibleCount = 0;
    this.destructibleSpawnTimer = 12;
    this.shrineManager.clear();
    this.activeChests.forEach(chest => chest.graphics.destroy());
    this.activeChests = [];
    this.abilityVaultManager.clear();
    this.secretCacheManager.clear();
    this.questBoardManager.clear();
    this.clearAmbushNests();
    this.clearNemesisLairs();
    this.clearWardenThrone();
    this.wardenThroneSectorKey = null;
    this.clearEscortDrone();
    this.restoredEscortDrone = null;
    this.clearQuestCargoDrop();
    this.questCargoDropSectorKey = null;
    this.spawnedPoiSlotIds.clear();
    this.poiSlotObjects.clear();
    this.poiOncePerRunSpawned = false;
    this.poiRunSalt = Math.floor(Math.random() * 0x7fffffff);
    this.bounty = null;
    this.bountyCooldown = 20;
    this.bountyFlawlessBroken = false;
    this.bountyText?.destroy();
    this.bountyText = null;
    this.dailyQuestWatcher = null;
    this.lastDailyQuestCheck = 0;
    this.expeditionQuestKillBaseline = this.killCount;
    this.expeditionDwellSectorKey = null;
    this.expeditionDwellStartSeconds = 0;
    this.siegeSectorKey = null;
    this.siegeNextWaveAtSeconds = 0;
    this.siegeBesiegerIds = [];
    this.recallChannelRemaining = 0;
    this.recallChannelTarget = null;
    this.recallChannelIsSortie = false;
    this.sortieAnchor = null;
    this.recallRing?.setVisible(false);
    this.expeditionTickerRows = [];
    this.questTickerRefreshTimer = 0;
    this.questTickerCycleTimer = 0;
    this.questTickerIndex = 0;
    // Optional: the fresh path runs this before createMinimapFeed(), and a feed built after it
    // starts with the timer already zero anyway.
    this.minimapFeed?.invalidateWaypoints();
    this.bossFightDirector.resetRotationCursor();
    // Pace ghost. Practice and gauntlet get no ghost because neither writes a
    // best score, so there is nothing to race. A restored run lost its early
    // samples with the page, so it still races the ghost but records no curve.
    this.paceSamples = [];
    this.lastPaceCheck = 0;
    this.paceGhostReplaced = false;
    this.paceRecordingEnabled = !this.shouldRestore;
    this.paceGhostCurve = this.practiceModeActive || this.gauntletModeActive
      ? null
      : getPaceGhost(getMetaProgressionManager().getWorldLevel());
    // Run timeline. Same restore rule as the pace curve above: a resumed run only
    // saw the beats after the reload, so its ribbon would read as an empty run.
    this.runTimelineEvents = [];
    this.closeCallArmed = true;
    this.runTimelineComplete = !this.shouldRestore;
    this.scrappedWeaponIds = [];
    // Cleared on fresh start; the restore path re-populates from the save after.
    this.timedStatBuffs = [];
    this.timedBuffPeakSeconds = {};
    // Armed Exploder fuses are transient combat state (not persisted): clearing
    // on both paths means a scene restart mid-fuse can never detonate stale
    // fuses into the new run.
    this.exploderFuses = [];
    // Relic-draft queue is per-run transient state (never persisted).
    this.pendingRelicChoices = 0;
    this.relicDraftActive = false;
    this.relicDraftOwnsPause = false;
    this.marketActive = false;
    this.questBoardActive = false;
  }

  /** Applies a shrine's effect on touch. */
  private triggerShrine(type: ShrineType, x: number, y: number): void {
    const def = SHRINE_DEFS.find(d => d.type === type)!;
    this.effectsManager.playDeathBurst(x, y, def.color);
    this.soundManager.playLevelUp();

    let title = def.label;
    let description = '';
    // Suppressed for the fortune→draft branch: the relic draft shows its own
    // pickup toast, so the generic shrine toast must not also fire.
    let showToast = true;

    switch (type) {
      case 'cleanse': {
        this.healPlayer(this.playerStats.maxHealth * 0.45);
        description = 'Restored 45% of your health.';
        break;
      }
      case 'power': {
        this.applyTimedStatBuff('damageMultiplier', POWER_SHRINE_BUFF_MULT, POWER_SHRINE_BUFF_SECONDS);
        description = `Double damage for ${POWER_SHRINE_BUFF_SECONDS} seconds!`;
        break;
      }
      case 'fortune': {
        const relicManager = getRelicManager();
        if (relicManager.isFull() && !relicManager.hasReinforceCandidates()) {
          // Relic slots full and every relic capped — pay out gold + consumables instead.
          getMetaProgressionManager().addGold(80 + this.worldLevel * 15);
          this.spawnRandomConsumable(x - 20, y);
          this.spawnRandomConsumable(x + 20, y);
          description = 'Relics maxed — fortune paid in gold + power-ups.';
        } else {
          // Draft a relic (1-of-3), or a rank when slots are full. The choice
          // overlay shows its own toast, so suppress the generic shrine toast.
          this.grantRelicChoice(1);
          showToast = false;
        }
        break;
      }
      case 'sacrifice': {
        // Authoritative HP is the ECS Health component — mutate it directly.
        let cost = 1;
        if (this.playerId !== -1) {
          cost = Math.max(1, Math.floor(Health.current[this.playerId] * 0.25));
          Health.current[this.playerId] = Math.max(1, Health.current[this.playerId] - cost);
          this.playerStats.currentHealth = Health.current[this.playerId];
        }
        this.playerStats.damageMultiplier *= 1.18;
        this.syncStatsToPlayer();
        description = `Sacrificed ${cost} HP for +18% damage (rest of run).`;
        break;
      }
      case 'market': {
        // The overlay carries its own header + prices, so the generic shrine
        // toast would just be noise (same call as the fortune→draft branch).
        showToast = false;
        this.openMarket(x, y);
        break;
      }
    }

    if (this.toastManager && showToast) {
      this.toastManager.showToast({ title, description, tier: 'ambient', icon: 'star', color: def.color, duration: 3200 });
    }
  }

  /** Silent removal: no rewards, no kill flash, no kill/combo credit. A guard that was not
   *  beaten was not killed, so it must not route through handleEnemyDeath. */
  private despawnVaultGuard(enemyId: number): void {
    if (!hasComponent(this.world, EnemyTag, enemyId)) return;
    this.hudManager?.removeBossHealthBar(enemyId);
    this.deathRippleManager.unregisterEnemy(enemyId);
    this.statusEffectVisualManager.unregisterEnemy(enemyId);
    this.eliteAffixVisualManager.unregisterEnemy(enemyId);
    const sprite = getSprite(enemyId);
    if (sprite) sprite.destroy();
    unregisterSprite(enemyId);
    removeEntity(this.world, enemyId);
    this.enemyCount--;
  }

  /**
   * FEAT-WORLDGEN-STREAM: the room the ship just left gives up its loose floor loot, and any
   * POI slot in it whose reward the player never touched (FEAT-WORLDGEN-STREAM-POI-RETIRE).
   * A partly-looted slot keeps what is left of it: re-arming it would pay its reward twice.
   */
  private retireDepartedSector(fromSectorKey: string | null): void {
    if (!fromSectorKey || this.playerId < 0) return;
    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];

    this.retirePoiSlots(fromSectorKey);
    const protectedPoiIds = this.protectedPoiEntityIds();

    this.retireCandidates.length = 0;
    for (const gem of getXPGemPositions()) {
      this.retireCandidates.push({ entityId: gem.entityId, x: gem.x, y: gem.y });
    }
    for (const gemId of planSectorRetire({
      fromSectorKey, playerX, playerY, candidates: this.retireCandidates,
    })) {
      consumeXPGem(gemId);
    }

    for (const query of [retireHealthQuery, retireMagnetQuery, retireConsumableQuery]) {
      this.retireCandidates.length = 0;
      for (const entityId of query(this.world)) {
        if (protectedPoiIds.has(entityId)) continue;
        this.retireCandidates.push({
          entityId, x: Transform.x[entityId], y: Transform.y[entityId],
        });
      }
      for (const entityId of planSectorRetire({
        fromSectorKey, playerX, playerY, candidates: this.retireCandidates,
      })) {
        this.destroyRetiredPickup(entityId);
      }
    }
  }

  /** Sprite first, then the registration, then the entity: the removal order this repo's
   *  CLAUDE.md pins, and the one healthPickupSystem already uses on collection. */
  private destroyRetiredPickup(entityId: number): void {
    const sprite = getSprite(entityId);
    if (sprite) {
      sprite.destroy();
      unregisterSprite(entityId);
    }
    removeEntity(this.world, entityId);
  }

  /** A slot is untouched only while every object it spawned is still on the floor. */
  private isPoiObjectAlive(object: PoiSlotObject): boolean {
    switch (object.kind) {
      case 'chest':
        return this.activeChests.includes(object.chest);
      case 'crate':
        return hasComponent(this.world, Destructible, object.entityId);
      case 'boost':
        // The kind comparison closes the one way a bitECS id can lie here: it was recycled
        // onto a different pickup after this one was collected.
        return hasComponent(this.world, ConsumablePickupTag, object.entityId)
          && Consumable.kind[object.entityId] === object.consumable;
      case 'shrine':
        return this.shrineManager.hasShrineAt(object.x, object.y);
    }
  }

  private destroyPoiObject(object: PoiSlotObject): void {
    switch (object.kind) {
      case 'chest':
        object.chest.cleanup?.();
        return;
      case 'crate':
        this.destroyRetiredPickup(object.entityId);
        this.destructibleCount = Math.max(0, this.destructibleCount - 1);
        return;
      case 'boost':
        this.destroyRetiredPickup(object.entityId);
        return;
      case 'shrine':
        this.shrineManager.removeShrineAt(object.x, object.y);
        // The once-per-run cap is one market TAKEN, not one drawn. This runs only while
        // destroying an untouched market, so at most one is ever alive; a market the player
        // walked into fails the every-alive test above and is never retired, so the flag it
        // set stays true for the rest of the run.
        if (object.shrineType === 'market') this.poiOncePerRunSpawned = false;
        return;
    }
  }

  /**
   * Untouched slots in the departed room give their reward back to the generator: the objects
   * go away and the slot leaves `spawnedPoiSlotIds`, so the next entry stocks it again. A slot
   * the player took part of is left alone, because re-arming it would pay it twice.
   */
  private retirePoiSlots(fromSectorKey: string): void {
    for (const [slotId, record] of this.poiSlotObjects) {
      if (record.sectorKey !== fromSectorKey) continue;
      // A restored partly-looted slot passes the every-alive test below, because only its
      // survivors were ever written: retiring it would re-roll a slot the player already
      // took part of.
      if (record.partlyLooted) continue;
      if (!record.objects.every(object => this.isPoiObjectAlive(object))) continue;
      for (const object of record.objects) this.destroyPoiObject(object);
      this.poiSlotObjects.delete(slotId);
      this.spawnedPoiSlotIds.delete(slotId);
    }
  }

  /** Entity ids the loose-loot sweep must not take: a placed POI reward is not floor litter. */
  private protectedPoiEntityIds(): Set<number> {
    const protectedIds = new Set<number>();
    for (const record of this.poiSlotObjects.values()) {
      for (const object of record.objects) {
        if (object.kind === 'crate' || object.kind === 'boost') protectedIds.add(object.entityId);
      }
    }
    return protectedIds;
  }

  /** The still-alive objects of one slot, with their live positions, for `poiState.slots`. */
  private serializePoiSlotObjects(record: PoiSlotRecord): SerializedPoiSlotObject[] {
    const serialized: SerializedPoiSlotObject[] = [];
    for (const object of record.objects) {
      if (!this.isPoiObjectAlive(object)) continue;
      if (object.kind === 'chest') {
        serialized.push({
          kind: 'chest' as const,
          x: object.chest.graphics.x,
          y: object.chest.graphics.y,
          isSpecial: object.chest.isSpecial,
        });
      } else if (object.kind === 'crate') {
        serialized.push({
          kind: 'crate' as const,
          x: Transform.x[object.entityId],
          y: Transform.y[object.entityId],
        });
      } else if (object.kind === 'shrine') {
        serialized.push({
          kind: 'shrine' as const,
          x: object.x,
          y: object.y,
          shrineType: object.shrineType,
        });
      } else {
        serialized.push({
          kind: 'boost' as const,
          x: Transform.x[object.entityId],
          y: Transform.y[object.entityId],
          consumable: object.consumable,
        });
      }
    }
    return serialized;
  }

  /**
   * Stocks a sector the first time this run's ship enters it. A slot pays out once per run:
   * the spawned set is the memory, so walking back through a looted room re-stocks nothing.
   * Slot kinds the catalog does not cover (ability vault, quest anchor, secret) are left
   * unspawned for the chunks that own them, which is why they are never added to the set.
   */
  private stockSectorPois(sectorKey: string): void {
    const map = this.worldMode.worldMap();
    if (!map) return;
    const sector = map.sectors.get(sectorKey);
    if (!sector) return;

    const pending = sector.poiSlots.filter(slot => !this.spawnedPoiSlotIds.has(slot.id));
    if (pending.length === 0) return;

    const rolled = rollPoiContents({
      worldSeed: map.seed,
      runSalt: this.poiRunSalt,
      depth: sector.depth,
      slots: pending,
      oncePerRunAvailable: !this.poiOncePerRunSpawned,
      nemesisAvailable: this.nemesisRecord !== null
        && !this.nemesisSpawned
        && this.activeNemesisLairs.length === 0,
    });

    for (const entry of rolled) {
      this.spawnedPoiSlotIds.add(entry.slot.id);
      const spawnedObjects = this.spawnPoiContent(
        entry.contentId,
        sector.sx * SECTOR_WIDTH + entry.slot.tileX * TILE_SIZE + TILE_SIZE / 2,
        sector.sy * SECTOR_HEIGHT + entry.slot.tileY * TILE_SIZE + TILE_SIZE / 2,
        sector.depth,
      );
      if (spawnedObjects.length > 0) {
        this.poiSlotObjects.set(entry.slot.id, {
          sectorKey, objects: spawnedObjects, partlyLooted: false,
        });
      }
      if (entry.contentId === 'poi_ambush_nest') {
        getDiscoveryManager().markAmbushNestSighted(entry.slot.id);
      }
    }
  }

  /** Every content id maps to an existing reward path; the `never` default makes a future
   *  catalog entry with no spawn a compile error rather than a silently empty room. */
  private spawnPoiContent(contentId: PoiContentId, x: number, y: number, depth: number): PoiSlotObject[] {
    switch (contentId) {
      case 'poi_treasure_chest':
        return [{
          kind: 'chest',
          chest: this.addTreasureChest(x, y, Math.random() < SPECIAL_CHEST_CHANCE, true),
        }];
      case 'poi_crate_field': {
        const spot = { x: 0, y: 0 };
        const crates: PoiSlotObject[] = [];
        for (let index = 0; index < POI_CRATE_FIELD_COUNT; index++) {
          const angle = (Math.PI * 2 * index) / POI_CRATE_FIELD_COUNT - Math.PI / 2;
          this.worldMode.freeSpotNear(
            x + Math.cos(angle) * POI_CRATE_FIELD_RADIUS,
            y + Math.sin(angle) * POI_CRATE_FIELD_RADIUS,
            spot,
          );
          crates.push({ kind: 'crate', entityId: this.addDestructible(spot.x, spot.y) });
        }
        return crates;
      }
      case 'poi_field_boost_cache': {
        const left = this.spawnFieldBoostPickup(x - POI_CACHE_SPREAD, y);
        const right = this.spawnFieldBoostPickup(x + POI_CACHE_SPREAD, y);
        return [
          { kind: 'boost', entityId: left.entityId, consumable: left.consumableKind },
          { kind: 'boost', entityId: right.entityId, consumable: right.consumableKind },
        ];
      }
      case 'poi_black_market':
        this.poiOncePerRunSpawned = true;
        return [this.addPoiShrine('market', x, y)];
      // A dormant hive and a dormant den are charted destinations, not furniture:
      // dormantHazardSectors derives the map's hazard markers live from these arrays, so
      // retiring one would delete a place the game told the player to come back to.
      case 'poi_ambush_nest':
        this.addAmbushNest(x, y, depth);
        return [];
      case 'poi_nemesis_lair':
        this.addNemesisLair(x, y, false);
        return [];
      case 'poi_shrine_cleanse':   return [this.addPoiShrine('cleanse', x, y)];
      case 'poi_shrine_power':     return [this.addPoiShrine('power', x, y)];
      case 'poi_shrine_fortune':   return [this.addPoiShrine('fortune', x, y)];
      case 'poi_shrine_sacrifice': return [this.addPoiShrine('sacrifice', x, y)];
      default: {
        const unhandled: never = contentId;
        console.warn(`Unhandled POI content id: ${String(unhandled)}`);
        return [];
      }
    }
  }

  /** Places a slot's altar and hands back the record that lets the retire pass put it away. */
  private addPoiShrine(shrineType: ShrineType, x: number, y: number): PoiSlotObject {
    this.shrineManager.addShrine(shrineType, x, y);
    return { kind: 'shrine', shrineType, x, y };
  }

  /** A dormant hive on a Treasure slot. Alpha and a pulse only: nothing is added to physics and
   *  no entity exists until the ship trips it. */
  private addAmbushNest(x: number, y: number, depth: number): void {
    const graphics = this.add.graphics();
    graphics.setPosition(x, y);
    graphics.setDepth(4);
    const nest: ActiveAmbushNest = {
      graphics, x, y, depth, awake: false, waveEntityIds: [],
    };
    this.drawAmbushNest(nest);
    this.activeAmbushNests.push(nest);
  }

  /** The drawAbilityVault idiom in the hazard palette, so a room that bites reads as the same
   *  system as a hazard strip rather than as a second vocabulary. A woken hive is opaque. */
  private drawAmbushNest(nest: ActiveAmbushNest): void {
    const color = WORLD_GEOMETRY_COLORS.hazard.stroke;
    const graphics = nest.graphics;
    graphics.clear();
    graphics.setAlpha(nest.awake ? 1 : 0.55);
    graphics.fillStyle(color, nest.awake ? 0.3 : 0.14);
    graphics.fillCircle(0, 0, AMBUSH_NEST_DRAW_RADIUS + 8);
    graphics.lineStyle(3, color, nest.awake ? 1 : 0.7);
    graphics.strokeCircle(0, 0, AMBUSH_NEST_DRAW_RADIUS);
    for (let spike = 0; spike < 5; spike++) {
      const angle = (Math.PI * 2 * spike) / 5 - Math.PI / 2;
      graphics.lineBetween(
        Math.cos(angle) * AMBUSH_NEST_DRAW_RADIUS,
        Math.sin(angle) * AMBUSH_NEST_DRAW_RADIUS,
        Math.cos(angle) * (AMBUSH_NEST_DRAW_RADIUS + 10),
        Math.sin(angle) * (AMBUSH_NEST_DRAW_RADIUS + 10),
      );
    }
    graphics.fillStyle(nest.awake ? 0xffe8c0 : color, 0.9);
    graphics.fillCircle(0, 0, 5);
  }

  /**
   * The nest's pack, standing in an even ring around the hive. The spawnVaultGuards shape with
   * two deliberate differences: no forced affix (a nest is a numbers fight, not an elite one)
   * and no boss health bar (it would put five bars on screen at once). createEnemy runs
   * freeSpotNear, so a ring point inside rock is shoved to open floor.
   */
  private spawnAmbushWave(nest: ActiveAmbushNest): void {
    const pack = AMBUSH_NEST_WAVES[ambushWaveTier(nest.depth)];
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
          enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult,
        );
        const entityId = this.createEnemy(
          nest.x + Math.cos(angle) * AMBUSH_NEST_RING_RADIUS,
          nest.y + Math.sin(angle) * AMBUSH_NEST_RING_RADIUS,
          enemyType, scaledStats,
        );
        addComponent(this.world, AmbushSpawnTag, entityId);
        nest.waveEntityIds.push(entityId);
      }
    }
  }

  /** The trip. A wave that produced no entity is not a soft-lock: updateAmbushNests sees an
   *  empty id list on the very next tick and pays the chest, so the failure mode of a placed
   *  encounter is open, never sealed. */
  private wakeAmbushNest(nest: ActiveAmbushNest): void {
    nest.awake = true;
    this.spawnAmbushWave(nest);
    this.drawAmbushNest(nest);

    const color = WORLD_GEOMETRY_COLORS.hazard.stroke;
    this.effectsManager.playDeathBurst(nest.x, nest.y, color);
    if (!getSettingsManager().isReducedMotionEnabled()) this.cameras.main.shake(200, 0.008);
    this.soundManager.playBossWarning();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'NEST DISTURBED',
      description: 'Clear the swarm and the hive is yours.',
      icon: 'warning',
      color,
      duration: 3200,
    });
  }

  /** The last of the wave fell. The hive bursts into the guaranteed special chest that is the
   *  whole point of taking the fight; isPoiCache keeps the 30 s despawn and the chest drone off
   *  it, the same as every other placed cache in a world-sized map. */
  private clearAmbushNest(index: number): void {
    const nest = this.activeAmbushNests[index];
    const color = WORLD_GEOMETRY_COLORS.hazard.stroke;
    this.effectsManager.playDeathBurst(nest.x, nest.y, color);
    if (!getSettingsManager().isReducedMotionEnabled()) this.cameras.main.shake(180, 0.007);
    this.soundManager.playPurchase();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'NEST CLEARED',
      description: 'The hive breaks open.',
      icon: 'gem',
      color: WORLD_GEOMETRY_COLORS.gate.stroke,
      duration: 3000,
    });

    nest.graphics.destroy();
    this.activeAmbushNests.splice(index, 1);
    this.addTreasureChest(nest.x, nest.y, true, true);
    this.recordExpeditionQuest({ kind: 'clearHazard', hazardKind: 'nest' });
  }

  /** Teardown only: the wave is left to the world's own enemy teardown, because a nest's wave
   *  are real enemies that already died or already count, unlike a vault's silent guards. */
  private clearAmbushNests(): void {
    for (const nest of this.activeAmbushNests) nest.graphics.destroy();
    this.activeAmbushNests = [];
  }

  /** A dormant den on a Treasure slot. Alpha and a pulse only: nothing is added to physics and
   *  no entity exists until the ship trips it. `awake` is a parameter because the restore path
   *  rebuilds a woken den without re-spawning its hunter. */
  private addNemesisLair(x: number, y: number, awake: boolean): void {
    const graphics = this.add.graphics();
    graphics.setPosition(x, y);
    graphics.setDepth(4);
    const lair: ActiveNemesisLair = { graphics, x, y, awake };
    this.drawNemesisLair(lair);
    this.activeNemesisLairs.push(lair);
  }

  /** The drawAmbushNest idiom in enemy crimson with inward barbs rather than outward spikes:
   *  a den and a hive are different fights, so they must not read the same across a room. */
  private drawNemesisLair(lair: ActiveNemesisLair): void {
    const color = NEMESIS_LAIR_COLOR;
    const graphics = lair.graphics;
    graphics.clear();
    graphics.setAlpha(lair.awake ? 1 : 0.55);
    graphics.fillStyle(color, lair.awake ? 0.3 : 0.14);
    graphics.fillCircle(0, 0, NEMESIS_LAIR_DRAW_RADIUS + 8);
    graphics.lineStyle(3, color, lair.awake ? 1 : 0.7);
    graphics.strokeCircle(0, 0, NEMESIS_LAIR_DRAW_RADIUS);
    graphics.lineStyle(2, color, lair.awake ? 0.9 : 0.6);
    graphics.strokeCircle(0, 0, NEMESIS_LAIR_DRAW_RADIUS - 9);
    for (let barb = 0; barb < 6; barb++) {
      const angle = (Math.PI * 2 * barb) / 6 - Math.PI / 2;
      graphics.lineBetween(
        Math.cos(angle) * NEMESIS_LAIR_DRAW_RADIUS,
        Math.sin(angle) * NEMESIS_LAIR_DRAW_RADIUS,
        Math.cos(angle) * (NEMESIS_LAIR_DRAW_RADIUS - 9),
        Math.sin(angle) * (NEMESIS_LAIR_DRAW_RADIUS - 9),
      );
    }
    graphics.fillStyle(lair.awake ? 0xffe8c0 : color, 0.9);
    graphics.fillCircle(0, 0, 5);
  }

  /** The trip. The hunter is stood up AT the den through the shipped spawn path, so it arrives
   *  with the same grudge scaling, boss bar, timeline marker and warning the timed spawn gives
   *  it. A spawn that fails leaves the den dormant and the timer to handle it, so a failure is
   *  a delay and never a dead room. */
  private wakeNemesisLair(lair: ActiveNemesisLair): void {
    if (!this.nemesisRecord || this.nemesisSpawned) return;
    if (!this.spawnNemesis(this.nemesisRecord, { x: lair.x, y: lair.y })) return;
    this.nemesisSpawned = true;
    lair.awake = true;
    this.drawNemesisLair(lair);

    this.effectsManager.playDeathBurst(lair.x, lair.y, NEMESIS_LAIR_COLOR);
    if (!getSettingsManager().isReducedMotionEnabled()) this.cameras.main.shake(220, 0.009);
    this.soundManager.playBossWarning();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'THE LAIR STIRS',
      description: 'It has been waiting for you.',
      icon: 'skull',
      color: NEMESIS_LAIR_COLOR,
      duration: 3200,
    });
  }

  /** Teardown only: the hunter is a real enemy the world's own teardown already owns. */
  private clearNemesisLairs(): void {
    for (const lair of this.activeNemesisLairs) lair.graphics.destroy();
    this.activeNemesisLairs = [];
  }

  /** The timer beat the player to it, so the den is empty. Returns nothing: a stood-down lair
   *  pays no chest, because the fight it was the price of never happened there. */
  private standDownNemesisLairs(): void {
    for (const lair of this.activeNemesisLairs) {
      if (lair.awake) continue;
      this.effectsManager.playDeathBurst(lair.x, lair.y, NEMESIS_LAIR_COLOR);
      lair.graphics.destroy();
    }
    this.activeNemesisLairs = this.activeNemesisLairs.filter(lair => lair.awake);
  }

  /** The hunter fell. Returns true if a woken den was standing, so the caller pays the
   *  guaranteed special chest that is the whole reason to take the fight at the den rather
   *  than wait for the hunter to come to you. */
  private breakOpenNemesisLair(): boolean {
    const index = this.activeNemesisLairs.findIndex(lair => lair.awake);
    if (index === -1) return false;
    const lair = this.activeNemesisLairs[index];
    this.effectsManager.playDeathBurst(lair.x, lair.y, NEMESIS_LAIR_COLOR);
    lair.graphics.destroy();
    this.activeNemesisLairs.splice(index, 1);
    return true;
  }

  /** Trip test while dormant, pulse only once awake: a woken den holds no wave to watch, since
   *  the hunter's death is matched in handleEnemyDeath. */
  private updateNemesisLairs(playerX: number, playerY: number): void {
    if (this.activeNemesisLairs.length === 0) return;
    const pulse = 1 + Math.sin(this.gameTime * 2.3) * 0.09;
    for (const lair of this.activeNemesisLairs) {
      lair.graphics.setScale(pulse);
      if (lair.awake) continue;
      const dx = playerX - lair.x;
      const dy = playerY - lair.y;
      if (dx * dx + dy * dy < NEMESIS_LAIR_TRIGGER_RADIUS * NEMESIS_LAIR_TRIGGER_RADIUS) {
        this.wakeNemesisLair(lair);
      }
    }
  }

  /** Null outside an expedition, which is what keeps arena, daily, weekly, gauntlet and
   *  practice on the rotation exactly as they are today. */
  private expeditionWardenBossTypeId(): string | null {
    const map = this.worldMode.worldMap();
    return map ? wardenBossIdForWorld(map.seed, map.worldGenVersion) : null;
  }

  /** The throne exists only while the ship is in the arena, the syncAbilityVaults idiom: it is
   *  a fixed structure of the world, not a run-scoped body, so it needs no save field. */
  private syncWardenThrone(map: WorldMap, playerX: number, playerY: number): void {
    if (this.bossFightDirector.hasSpawned()) {
      this.clearWardenThrone();
      return;
    }
    const key = `${Math.floor(playerX / SECTOR_WIDTH)},${Math.floor(playerY / SECTOR_HEIGHT)}`;
    if (key === this.wardenThroneSectorKey) return;
    this.wardenThroneSectorKey = key;
    this.clearWardenThrone();
    const sector = map.sectors.get(key);
    if (!sector?.isBossArena) return;
    const spot = { x: 0, y: 0 };
    this.worldMode.freeSpotNear(
      sector.sx * SECTOR_WIDTH + SECTOR_WIDTH / 2,
      sector.sy * SECTOR_HEIGHT + SECTOR_HEIGHT / 2,
      spot,
    );
    this.addWardenThrone(spot.x, spot.y);
  }

  private addWardenThrone(x: number, y: number): void {
    const graphics = this.add.graphics();
    graphics.setPosition(x, y);
    graphics.setDepth(4);
    this.wardenThrone = { graphics, x, y };
    this.drawWardenThrone();
  }

  /** The drawNemesisLair idiom, spokes rather than barbs and in the seal's violet, so the
   *  throne reads as the room's own machinery instead of as another body to fight. */
  private drawWardenThrone(): void {
    if (!this.wardenThrone) return;
    const graphics = this.wardenThrone.graphics;
    graphics.clear();
    graphics.setAlpha(0.55);
    graphics.fillStyle(WARDEN_THRONE_COLOR, 0.14);
    graphics.fillCircle(0, 0, WARDEN_THRONE_DRAW_RADIUS + 10);
    graphics.lineStyle(3, WARDEN_THRONE_COLOR, 0.8);
    graphics.strokeCircle(0, 0, WARDEN_THRONE_DRAW_RADIUS);
    graphics.lineStyle(2, WARDEN_THRONE_GLOW, 0.7);
    for (let spoke = 0; spoke < 8; spoke++) {
      const angle = (Math.PI * 2 * spoke) / 8 - Math.PI / 2;
      graphics.lineBetween(
        Math.cos(angle) * (WARDEN_THRONE_DRAW_RADIUS + 10),
        Math.sin(angle) * (WARDEN_THRONE_DRAW_RADIUS + 10),
        Math.cos(angle) * (WARDEN_THRONE_DRAW_RADIUS - 6),
        Math.sin(angle) * (WARDEN_THRONE_DRAW_RADIUS - 6),
      );
    }
    graphics.fillStyle(WARDEN_THRONE_GLOW, 0.9);
    graphics.fillCircle(0, 0, 6);
  }

  private clearWardenThrone(): void {
    this.wardenThrone?.graphics.destroy();
    this.wardenThrone = null;
  }

  /** Trip test and pulse, the updateNemesisLairs shape. The throne is consumed by the trip:
   *  what stands up is the boss itself, so there is nothing left to watch. */
  private updateWardenThrone(playerX: number, playerY: number): void {
    const throne = this.wardenThrone;
    if (!throne) return;
    throne.graphics.setScale(1 + Math.sin(this.gameTime * 1.7) * 0.07);
    const dx = playerX - throne.x;
    const dy = playerY - throne.y;
    if (dx * dx + dy * dy >= WARDEN_THRONE_TRIGGER_RADIUS * WARDEN_THRONE_TRIGGER_RADIUS) return;
    this.wakeWardenThrone(throne.x, throne.y);
  }

  /** The trip. The run's OWN boss is fielded here through the shipped accounting, so it
   *  arrives with the same rotation spend, entrance, sector seal and health bar the timed
   *  spawn gives it. No extra shake or sting: spawnBoss's entrance already carries both. */
  private wakeWardenThrone(x: number, y: number): void {
    if (this.bossFightDirector.hasSpawned()) return;
    this.clearWardenThrone();
    this.effectsManager.playDeathBurst(x, y, WARDEN_THRONE_COLOR);
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'THE WARDEN RISES',
      description: 'The heart of the world answers.',
      icon: 'skull',
      color: WARDEN_THRONE_COLOR,
      duration: 3200,
    });
    this.bossFightDirector.beginFight();
  }

  /** The drone exists exactly while one active objective says it should, the syncWardenThrone
   *  idiom: state is the truth and the object is derived, so a refresh mid-escort rebuilds it and
   *  an arrival that spends it removes it, both without a second code path. */
  private syncEscortDrone(playerX: number, playerY: number): void {
    const objective = getActiveQuestEscortObjectives()[0];
    if (!objective) {
      this.clearEscortDrone();
      return;
    }
    if (this.escortDrone?.questId === objective.questId) return;
    this.clearEscortDrone();
    // Consumed on the first assignment whether or not it matched, so a saved drone can never be
    // adopted by a later quest's drone. freeSpotNear runs on the saved point too: a legal spot
    // then is not guaranteed legal now, and a tampered save must not park it inside a wall.
    const restored = this.restoredEscortDrone;
    this.restoredEscortDrone = null;
    const resumed = restored && restored.questId === objective.questId ? restored : null;
    const spot = { x: 0, y: 0 };
    this.worldMode.freeSpotNear(
      resumed ? resumed.x : playerX,
      resumed ? resumed.y : playerY,
      spot,
    );
    const graphics = this.add.graphics();
    graphics.setPosition(spot.x, spot.y);
    graphics.setDepth(4);
    this.escortDrone = {
      graphics,
      questId: objective.questId,
      droneId: objective.droneId,
      x: spot.x,
      y: spot.y,
      health: resumed
        ? Math.max(1, Math.min(ESCORT_DRONE_MAX_HEALTH, resumed.health))
        : ESCORT_DRONE_MAX_HEALTH,
    };
    this.escortDroneSectorKey = null;
    this.escortDroneNextDamageAtSeconds = 0;
    this.escortDroneUnderFire = false;
    this.escortDroneNextAlertAtSeconds = 0;
    this.escortDroneRegenBlockedUntilSeconds = 0;
    this.escortDroneNextBlastAtSeconds = 0;
    this.drawEscortDrone();
    // A drone that was already under way does not announce itself again.
    if (resumed) return;
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'ESCORT UNDER WAY',
      description: `${droneLabelOf(objective.droneId)} is following you. Keep it alive.`,
      icon: 'rocket',
      color: ESCORT_DRONE_COLOR,
      duration: 3000,
    });
  }

  /**
   * Follow, bill, heal, then report where it is. The ARRIVAL is produced here and not by
   * sectorEnteredHandler, which is the whole difference between an escort and a delivery: the
   * ship reaching the destination is not the objective, the drone reaching it is. The sector-key
   * compare is what keeps this off the store on the common frame (syncQuestBoards' idiom).
   */
  private updateEscortDrone(playerX: number, playerY: number, deltaSeconds: number): void {
    const drone = this.escortDrone;
    if (!drone) return;

    const toPlayerX = playerX - drone.x;
    const toPlayerY = playerY - drone.y;
    const distance = Math.hypot(toPlayerX, toPlayerY);
    const spot = { x: 0, y: 0 };
    if (distance > ESCORT_DRONE_TETHER_PX) {
      this.worldMode.freeSpotNear(playerX, playerY, spot);
    } else if (distance > ESCORT_DRONE_FOLLOW_DISTANCE) {
      const step = Math.min(ESCORT_DRONE_SPEED * deltaSeconds, distance - ESCORT_DRONE_FOLLOW_DISTANCE);
      this.worldMode.freeSpotNear(
        drone.x + (toPlayerX / distance) * step,
        drone.y + (toPlayerY / distance) * step,
        spot,
      );
    } else {
      spot.x = drone.x;
      spot.y = drone.y;
    }
    drone.x = spot.x;
    drone.y = spot.y;
    drone.graphics.setPosition(spot.x, spot.y);
    setEnemyDecoy(spot.x, spot.y);

    let attackers = 0;
    for (const enemyId of getFrameCacheEnemyIds()) {
      // The frame cache is [Transform, Health, EnemyTag], which crates carry too, so an inert
      // crate parked beside the drone was billing it 4 HP every half second.
      if (hasComponent(this.world, Destructible, enemyId)) continue;
      const dx = Transform.x[enemyId] - drone.x;
      const dy = Transform.y[enemyId] - drone.y;
      if (dx * dx + dy * dy > ESCORT_DRONE_CONTACT_RADIUS * ESCORT_DRONE_CONTACT_RADIUS) continue;
      attackers++;
      if (attackers >= ESCORT_DRONE_MAX_ATTACKERS) break;
    }
    if (attackers > 0) {
      if (this.gameTime >= this.escortDroneNextDamageAtSeconds) {
        this.escortDroneNextDamageAtSeconds = this.gameTime + ESCORT_DRONE_DAMAGE_INTERVAL_SECONDS;
        drone.health -= attackers * ESCORT_DRONE_DAMAGE_PER_ATTACKER;
      }
    } else if (this.gameTime >= this.escortDroneRegenBlockedUntilSeconds) {
      drone.health = Math.min(
        ESCORT_DRONE_MAX_HEALTH,
        drone.health + ESCORT_DRONE_REGEN_PER_SECOND * deltaSeconds,
      );
    }
    const underFire = getDecoyFollowerCount() > 0;
    if (underFire && !this.escortDroneUnderFire && this.gameTime >= this.escortDroneNextAlertAtSeconds) {
      this.escortDroneNextAlertAtSeconds = this.gameTime + ESCORT_DRONE_ALERT_COOLDOWN_SECONDS;
      this.soundManager.playError();
      this.toastManager?.showToast({
        tier: 'critical',
        title: 'DRONE UNDER FIRE',
        description: `${droneLabelOf(drone.droneId)} has hostiles on it. Get back to it.`,
        icon: 'warning',
        color: WORLD_GEOMETRY_COLORS.hazard.stroke,
        duration: 2600,
      });
    }
    this.escortDroneUnderFire = underFire;
    this.drawEscortDrone();
    if (drone.health <= 0) {
      this.loseEscortDrone();
      return;
    }

    const map = this.worldMode.worldMap();
    if (!map) return;
    const key = `${Math.floor(drone.x / SECTOR_WIDTH)},${Math.floor(drone.y / SECTOR_HEIGHT)}`;
    if (key === this.escortDroneSectorKey) return;
    this.escortDroneSectorKey = key;
    const sector = map.sectors.get(key);
    if (!sector) return;
    this.recordExpeditionQuest({ kind: 'escortDrone', sectorTags: sectorTagsOf(sector) });
  }

  /** The drone's instantaneous damage path: pooled enemy fire, boss beams, and every blast through
   *  damageEscortDroneByBlast below. Separate from the contact billing above on purpose: a hit is
   *  instantaneous, so it blocks regen for a window rather than for as long as it lasts, and
   *  BALANCE-QUEST-ESCORT-DRONE's contact numbers are left exactly as shipped. */
  private damageEscortDroneByProjectile(damage: number, hitX: number, hitY: number, travelAngle: number): void {
    const drone = this.escortDrone;
    if (!drone) return;
    drone.health -= damage;
    this.escortDroneRegenBlockedUntilSeconds =
      this.gameTime + ESCORT_DRONE_PROJECTILE_REGEN_LOCKOUT_SECONDS;
    this.effectsManager.playHitSparks(hitX, hitY, travelAngle);
    this.drawEscortDrone();
    if (drone.health <= 0) this.loseEscortDrone();
  }

  /** The two blast choke points, handleGroundSlam and handleExplosion, applied to the drone at its
   *  centre against the same radius the player is tested with, so a blast bills it over exactly the
   *  footprint the telegraph drew. Gated at the contact path's own cadence because a barrage lands
   *  many strike points in one burst. */
  private damageEscortDroneByBlast(damage: number, blastX: number, blastY: number, radius: number): void {
    const drone = this.escortDrone;
    if (!drone) return;
    const gapX = drone.x - blastX;
    const gapY = drone.y - blastY;
    if (gapX * gapX + gapY * gapY >= radius * radius) return;
    if (this.gameTime < this.escortDroneNextBlastAtSeconds) return;
    this.escortDroneNextBlastAtSeconds = this.gameTime + ESCORT_DRONE_DAMAGE_INTERVAL_SECONDS;
    this.damageEscortDroneByProjectile(damage, drone.x, drone.y, Math.atan2(gapY, gapX));
  }

  /** Fail-and-retry, never fail-forever (doc 04 section 4): the flag is cleared and nothing the
   *  chain earned is touched, so the next board hands over another drone. */
  private loseEscortDrone(): void {
    const drone = this.escortDrone;
    if (!drone) return;
    this.effectsManager.playDeathBurst(drone.x, drone.y, ESCORT_DRONE_COLOR);
    this.soundManager.playError();
    const dropped = dropExpeditionQuestDrone();
    this.clearEscortDrone();
    this.toastManager?.showToast({
      tier: 'critical',
      title: 'ESCORT LOST',
      description: `${droneLabelOf(drone.droneId)} is down. Pick up another at any board.`,
      icon: 'warning',
      color: WORLD_GEOMETRY_COLORS.hazard.stroke,
      duration: 3200,
    });
    for (const row of dropped) getDiscoveryManager().noteObjectiveUpdated(row.questId);
  }

  /** A ring in the player's own projectile colour with a damage arc, so its state is legible
   *  from the ship without a HUD line: the top band is already bars, world, timer, kills and
   *  gold, the same call FEAT-QUEST-SIEGE-HUD-TELL was cut on. */
  private drawEscortDrone(): void {
    const drone = this.escortDrone;
    if (!drone) return;
    const fraction = Math.max(0, Math.min(1, drone.health / ESCORT_DRONE_MAX_HEALTH));
    const graphics = drone.graphics;
    graphics.clear();
    graphics.fillStyle(ESCORT_DRONE_COLOR, 0.16);
    graphics.fillCircle(0, 0, ESCORT_DRONE_DRAW_RADIUS + 6);
    graphics.lineStyle(2, ESCORT_DRONE_COLOR, 0.9);
    graphics.strokeCircle(0, 0, ESCORT_DRONE_DRAW_RADIUS);
    graphics.fillStyle(0xffffff, 0.9);
    graphics.fillCircle(0, 0, 3);
    graphics.lineStyle(
      3,
      fraction > 0.35 ? ESCORT_DRONE_COLOR : WORLD_GEOMETRY_COLORS.hazard.stroke,
      0.95,
    );
    graphics.beginPath();
    graphics.arc(0, 0, ESCORT_DRONE_DRAW_RADIUS + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
    graphics.strokePath();
    if (getDecoyFollowerCount() > 0) {
      const alertPulse = 0.45 + Math.sin(this.gameTime * 7) * 0.25;
      graphics.lineStyle(2, WORLD_GEOMETRY_COLORS.hazard.stroke, alertPulse);
      graphics.strokeCircle(0, 0, ESCORT_DRONE_DRAW_RADIUS + 13);
    }
  }

  private clearEscortDrone(): void {
    this.escortDrone?.graphics.destroy();
    this.escortDrone = null;
    this.escortDroneSectorKey = null;
    this.escortDroneNextDamageAtSeconds = 0;
    this.escortDroneUnderFire = false;
    this.escortDroneNextAlertAtSeconds = 0;
    this.escortDroneRegenBlockedUntilSeconds = 0;
    this.escortDroneNextBlastAtSeconds = 0;
    clearEnemyDecoy();
  }

  /** The crate exists exactly while a dropped-cargo objective names the room the ship is in, the
   *  syncSecretCaches idiom: the store is the truth and the object is derived, so a refresh
   *  mid-recovery rebuilds it and a reclaim removes it without a second code path. */
  private syncQuestCargoDrop(map: WorldMap, playerX: number, playerY: number): void {
    const key = `${Math.floor(playerX / SECTOR_WIDTH)},${Math.floor(playerY / SECTOR_HEIGHT)}`;
    if (key === this.questCargoDropSectorKey) return;
    this.questCargoDropSectorKey = key;
    this.clearQuestCargoDrop();
    const objective = getActiveQuestCargoDropObjectives(questWorldStamp(map))
      .find((entry) => entry.drop.sectorKey === key);
    if (!objective) return;
    const graphics = this.add.graphics();
    graphics.setPosition(objective.drop.x, objective.drop.y);
    graphics.setDepth(4);
    drawQuestCargoCrate(graphics);
    this.questCargoDrop = {
      graphics,
      questId: objective.questId,
      itemId: objective.itemId,
      x: objective.drop.x,
      y: objective.drop.y,
    };
  }

  private updateQuestCargoDrop(playerX: number, playerY: number): void {
    const crate = this.questCargoDrop;
    if (!crate) return;
    crate.graphics.setScale(1 + Math.sin(this.gameTime * 3.1) * 0.08);
    const dx = playerX - crate.x;
    const dy = playerY - crate.y;
    if (dx * dx + dy * dy > QUEST_CARGO_PICKUP_RADIUS * QUEST_CARGO_PICKUP_RADIUS) return;
    const reclaimed = reclaimExpeditionQuestCargo(crate.questId);
    this.clearQuestCargoDrop();
    if (!reclaimed) return;
    this.effectsManager.playDeathBurst(crate.x, crate.y, QUEST_CARGO_COLOR);
    this.soundManager.playPickupHealth();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'CARGO RECOVERED',
      description: `${cargoLabelOf(reclaimed.itemId)} is back aboard. Finish the delivery.`,
      icon: 'backpack',
      color: QUEST_CARGO_COLOR,
      duration: 3000,
    });
  }

  /** The walk-in that replaced the board overlay's silent hand-over. loadExpeditionQuestCargo is
   *  idempotent and loads every waiting delivery at once, which is the contract the overlay
   *  already had: one crate is the board's pallet, not one crate per contract. */
  private collectQuestBoardCargo(crateX: number, crateY: number): void {
    const loaded = loadExpeditionQuestCargo().loaded;
    if (loaded.length === 0) return;
    for (const row of loaded) getDiscoveryManager().noteObjectiveUpdated(row.questId);
    this.questTickerRefreshTimer = 0;
    this.effectsManager.playDeathBurst(crateX, crateY, QUEST_CARGO_COLOR);
    this.soundManager.playPickupHealth();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'CARGO LOADED',
      description: `${loaded.map((row) => cargoLabelOf(row.itemId)).join(', ')} is aboard.`
        + ' Make the delivery.',
      icon: 'backpack',
      color: QUEST_CARGO_COLOR,
      duration: 3000,
    });
  }

  private clearQuestCargoDrop(): void {
    this.questCargoDrop?.graphics.destroy();
    this.questCargoDrop = null;
  }

  private dropQuestCargoWhereShipDied(playerX: number, playerY: number): void {
    const map = this.worldMode.worldMap();
    if (!map) return;
    dropExpeditionQuestCargo({
      worldStamp: questWorldStamp(map),
      sectorKey: `${Math.floor(playerX / SECTOR_WIDTH)},${Math.floor(playerY / SECTOR_HEIGHT)}`,
      x: playerX,
      y: playerY,
    });
  }

  /** Trip test while dormant, liveness filter while awake. Iterated backwards because a clear
   *  splices the entry out, the updateAbilityVaults shape. */
  private updateAmbushNests(playerX: number, playerY: number): void {
    if (this.activeAmbushNests.length === 0) return;
    const pulse = 1 + Math.sin(this.gameTime * 3.1) * 0.08;
    for (let i = this.activeAmbushNests.length - 1; i >= 0; i--) {
      const nest = this.activeAmbushNests[i];
      nest.graphics.setScale(pulse);

      if (!nest.awake) {
        const dx = playerX - nest.x;
        const dy = playerY - nest.y;
        if (dx * dx + dy * dy < AMBUSH_NEST_TRIGGER_RADIUS * AMBUSH_NEST_TRIGGER_RADIUS) {
          this.wakeAmbushNest(nest);
        }
        continue;
      }

      nest.waveEntityIds = nest.waveEntityIds.filter(entityId =>
        hasComponent(this.world, AmbushSpawnTag, entityId)
        && hasComponent(this.world, EnemyTag, entityId));
      if (nest.waveEntityIds.length === 0) this.clearAmbushNest(i);
    }
  }

  /**
   * Doc 03 section 7 moment 6, the loudest moment by design: it converts a power-up into an
   * itinerary. Silent when nothing the player has actually charted is keyed to the gain, so a
   * first-hour claim does not promise routes the map has never drawn.
   */
  private announceNewRoutes(gainedId: string, sourceName: string, icon: string): void {
    const opened = getDiscoveryManager().noteGainedPassKey(gainedId);
    if (opened.length === 0) return;
    this.toastManager?.showToast({
      tier: 'notable',
      title: 'NEW ROUTES ONLINE',
      description: opened.length === 1
        ? `1 sealed gate responds to ${sourceName}.`
        : `${opened.length} sealed gates respond to ${sourceName}.`,
      icon,
      color: WORLD_GEOMETRY_COLORS.gate.stroke,
      duration: 3600,
    });
  }

  /** Doc 03 section 7 moment 2. Fires on the run that crosses a threshold and never again,
   *  because the floor is seeded from the live percent when the world binds. */
  private checkMapCompletionMilestone(completionPercent: number): void {
    const discovery = getDiscoveryManager();
    const reached = highestCompletionMilestone(completionPercent);
    if (reached <= this.mapCompletionMilestoneShown) return;
    this.mapCompletionMilestoneShown = reached;
    this.toastManager?.showMilestoneToast(
      `${reached}% CHARTED`,
      'This world is opening up.',
      'radar',
      `${discovery.getVisitedSectorCount()} of ${discovery.getKnowableSectorCount()} sectors`
      + `  ·  ${discovery.getFoundSecretCount()} of ${discovery.getKnowableSecretCount()} secrets`,
    );
  }

  /** Opens the objective board over a paused run, openMarket's contract exactly. update() returns
   *  early while isPaused, so nothing here can re-enter while the overlay is up. */
  private openQuestBoard(): void {
    if (this.questBoardActive || this.scene.isActive('QuestBoardScene')) return;
    this.questBoardActive = true;
    this.isPaused = true;
    const map = this.worldMode.worldMap();
    this.scene.launch('QuestBoardScene', {
      worldStamp: map ? questWorldStamp(map) : '',
      sectorSupply: map ? buildSectorSupply(map) : null,
      onClose: (changed: boolean) => {
        this.questBoardActive = false;
        this.isPaused = false;
        // The ticker re-reads on its own timer; zeroing it puts an accept on the HUD next frame
        // instead of up to QUEST_TICKER_REFRESH_SECONDS later.
        if (changed) {
          this.questTickerRefreshTimer = 0;
          this.questBoardManager.refreshCargo();
        }
        if (this.pendingOrientationRelayout) {
          this.pendingOrientationRelayout = false;
          this.handleOrientationFlip();
        }
      },
    });
  }

  /**
   * Every reward id spends a rail that already exists. A special chest is the arena relic
   * table at the arena rate, so depth pays in chest COUNT and never in better odds (doc 04
   * econ rule 1), and nothing here pays gold, so a found secret still adds nothing to the
   * expedition gold budget. The `never` default makes a future table entry with no payout a
   * compile error rather than a secret that silently pays nothing. The one entry that pays no
   * object is the map fragment, which spends itself into the discovery store and reports what
   * it charted. The armory pays no object either: it spends the shared weapon-upgrade path and
   * reports what it armed.
   */
  private paySecretReward(reward: SecretRewardDefinition, x: number, y: number): string {
    const spot = { x: 0, y: 0 };
    switch (reward.id) {
      case 'secret_relic_chest':
        this.addTreasureChest(x, y, true, true);
        return reward.description;
      case 'secret_twin_chests':
        this.addTreasureChest(x - SECRET_REWARD_SPREAD, y, true, true);
        this.addTreasureChest(x + SECRET_REWARD_SPREAD, y, true, true);
        return reward.description;
      case 'secret_boost_bundle':
        for (let index = 0; index < SECRET_REWARD_BUNDLE_COUNT; index++) {
          this.secretRewardSpot(x, y, index, SECRET_REWARD_BUNDLE_COUNT, spot);
          this.spawnFieldBoostPickup(spot.x, spot.y);
        }
        return reward.description;
      case 'secret_ordnance_pack': {
        const kinds = [ConsumableKind.BOMB, ConsumableKind.FREEZE, ConsumableKind.VACUUM];
        for (let index = 0; index < kinds.length; index++) {
          this.secretRewardSpot(x, y, index, kinds.length, spot);
          spawnConsumablePickup(this.world, spot.x, spot.y, kinds[index], 0);
        }
        return reward.description;
      }
      case 'secret_repair_bay':
        for (let index = 0; index < SECRET_REWARD_BUNDLE_COUNT; index++) {
          this.secretRewardSpot(x, y, index, SECRET_REWARD_BUNDLE_COUNT, spot);
          spawnHealthPickup(this.world, spot.x, spot.y, SECRET_REWARD_HEAL);
        }
        return reward.description;
      case 'secret_map_fragment': {
        const charted = this.grantMapFragment(x, y);
        if (charted) return charted;
        // A fully charted world still owes the player a find, so the fragment falls back to
        // the payout a cache hands out most often rather than paying nothing.
        this.addTreasureChest(x, y, true, true);
        return 'Survey data, and nothing left to chart. A sealed chest instead.';
      }
      case 'secret_armory_cache': {
        const armed = this.grantArmoryWeapon();
        if (armed) return armed;
        // Nothing left to arm or refit, so the armory falls back the way the fragment does.
        this.addTreasureChest(x, y, true, true);
        return 'The racks are welded shut. A sealed chest instead.';
      }
      default: {
        const unhandled: never = reward.id;
        console.warn(`Unhandled secret reward id: ${String(unhandled)}`);
        return reward.description;
      }
    }
  }

  /**
   * Hint tier 2's map half: a fragment charts a slice of a region the player has not flown,
   * as outlines only. Returns the toast line naming the place, or null when there is nothing
   * left to chart, which the caller pays as a chest instead so a find never pays nothing.
   */
  private grantMapFragment(x: number, y: number): string | null {
    const map = this.worldMode.worldMap();
    if (!map) return null;
    const discovery = getDiscoveryManager();
    const origin = sectorOfWorldPoint(x, y);
    const grant = chooseMapFragmentGrant({
      map,
      discoveredSectorKeys: discovery.getDiscoveredSectorKeys(),
      visitedSectorKeys: discovery.getVisitedSectorKeys(),
      originSectorKey: `${origin.col},${origin.row}`,
      maxSectors: MAP_FRAGMENT_MAX_SECTORS,
    });
    if (!grant) return null;
    const charted = discovery.applyMapFragment(grant.sectorKeys).sectorsDiscovered.length;
    if (charted === 0) return null;
    getCodexManager().recordRegionSurveyed(grant.stageId, charted);
    return `Survey data: ${grant.regionName} charted, `
      + `${charted} new sector${charted === 1 ? '' : 's'}.`;
  }

  /**
   * The one payout that changes the build rather than the inventory. A new weapon is otherwise
   * milestone-only (`getRandomCombinedUpgrades` gates `type: 'add'` behind `level % 5`), so a
   * deep cache is the only free off-milestone source of one.
   *
   * It spends the shared apply path `applyMarketPurchase` spends, so achievements, codex
   * discovery, stat sync, build heal and the evolution check all come with it. A banished or
   * scrapped weapon is refused for `scrapWeapon`'s own reason: re-taking one at level 1 would
   * launder the trade. Returns null only when there is nothing left to arm or refit, and the
   * caller pays a chest instead so a find never pays nothing.
   */
  private grantArmoryWeapon(): string | null {
    const weaponUpgrades = getWeaponUpgrades(this.weaponManager);
    if (this.weaponManager.canAddWeapon()) {
      const addable = weaponUpgrades.filter(
        candidate => candidate.type === 'add' && !this.banishedUpgradeIds.has(candidate.id),
      );
      if (addable.length > 0) {
        const rolled = Phaser.Utils.Array.GetRandom(addable);
        const recruit = this.findWeaponUpgrade('add', rolled.weaponId);
        if (recruit) {
          this.applyCombinedUpgrade(recruit);
          return `${rolled.name} comes online, still in its shipping seals.`;
        }
      }
    }
    // A full or exhausted arsenal is refitted instead, on the least-invested system: the rule
    // the Black Market's arsenal card already picks by, so the two never disagree.
    let leastInvested: WeaponUpgrade | null = null;
    for (const candidate of weaponUpgrades) {
      if (candidate.type !== 'level') continue;
      if (!leastInvested || candidate.currentLevel < leastInvested.currentLevel) {
        leastInvested = candidate;
      }
    }
    if (!leastInvested) return null;
    const refit = this.findWeaponUpgrade('level', leastInvested.weaponId);
    if (!refit) return null;
    this.applyCombinedUpgrade(refit);
    return `${leastInvested.name} refitted to level ${leastInvested.currentLevel + 1}.`;
  }

  /** Ring layout, the poi_crate_field shape: freeSpotNear keeps a pickup out of rock even
   *  when the cache sat against a wall. */
  private secretRewardSpot(
    x: number, y: number, index: number, count: number, out: { x: number; y: number },
  ): void {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    this.worldMode.freeSpotNear(
      x + Math.cos(angle) * SECRET_REWARD_RADIUS,
      y + Math.sin(angle) * SECRET_REWARD_RADIUS,
      out,
    );
  }

  /** The one moment a room that was never drawn becomes permanent. Deliberately the same
   *  beat as claimSecretCache so the two find-shapes read as one language, and now the same
   *  reward table, at the richer hiddenSector tier. */
  private announceHiddenSector(sector: SectorDef, worldSeed: number): void {
    getAchievementManager().recordHiddenSectorFound();
    const color = WORLD_GEOMETRY_COLORS.breakable.stroke;
    const spawnX = this.playerId !== -1
      ? Transform.x[this.playerId]
      : sector.sx * SECTOR_WIDTH + SECTOR_WIDTH / 2;
    const spawnY = this.playerId !== -1
      ? Transform.y[this.playerId]
      : sector.sy * SECTOR_HEIGHT + SECTOR_HEIGHT / 2;
    const reward = rollSecretReward({
      worldSeed, secretId: sector.key, depth: sector.depth, tier: 'hiddenSector',
    });

    this.effectsManager.playDeathBurst(spawnX, spawnY, color);
    this.cameras.main.shake(140, 0.005);
    this.soundManager.playLevelUp();
    const description = this.paySecretReward(reward, spawnX, spawnY);
    this.toastManager?.showToast({
      tier: 'notable',
      title: 'HIDDEN SECTOR FOUND',
      description,
      icon: reward.icon,
      color,
      duration: 3200,
    });
    this.recordExpeditionQuest({ kind: 'findSecret', secretKind: 'hiddenSector' });
    this.grantSecretLead(sector.key);
  }

  /**
   * Doc 03 section 7 moment 1: a banner, deliberately not a toast, because at expedition pace a
   * toast per room is spam and would push the toasts that actually pay out down a queue. It
   * sits above the bounty line rather than top-centre as section 7 asks, for the reason
   * updateBounties already records: in portrait the top band is bars left, world and timer
   * centre, kills and gold right, with no room for a centred line.
   * The second line states the region's pack and the hazard its ground grows, and only fires on
   * a region change: repeating it per room would make a rule read as noise.
   */
  private showSectorBanner(
    sector: SectorDef, regionChanged: boolean, bloomed: boolean, shifted: boolean,
  ): void {
    const hudScale = computeHudScale(
      this.scale.width, this.scale.height, getSettingsManager().getUiScale(),
    );
    // activeStageId, not sector.biomeId: a spine sector is stamped stage_deep_void but runs
    // the funnel pick, so the biomeId would name a region the room does not behave like.
    const biomeName = getStageById(this.activeStageId)?.name ?? 'Uncharted Space';
    const headline =
      `${biomeName.toUpperCase()}  ·  SECTOR ${sector.key}  ·  DEPTH ${sector.depth}`;
    const signature = regionChanged ? describeRegionSignature(this.activeStageId) : null;
    // Its own line rather than a fourth clause on the signature: a bloom is a fact about THIS
    // room, and the signature line is a rule about the whole region. Three lines only in the rare
    // room that is both a region border and a bloom.
    const lines = [headline];
    if (signature !== null) lines.push(signature);
    if (bloomed) lines.push('THE GROUND HAS BLOOMED');
    if (shifted) lines.push('THE WALLS HAVE SHIFTED');
    const banner = this.add.text(
      this.scale.width / 2,
      this.scale.height - Math.round((96 + 40 + 26) * hudScale),
      lines.join('\n'),
      {
        fontSize: `${Math.round(15 * hudScale)}px`,
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
        color: '#7fd4ff',
        stroke: '#000000',
        strokeThickness: Math.max(2, Math.round(3 * hudScale)),
        align: 'center',
      },
    ).setOrigin(0.5, 1).setScrollFactor(0).setDepth(DepthLayers.UI_OVERLAY);
    banner.setLetterSpacing(1);
    // Two rooms crossed inside one banner's life would otherwise draw both on the same line.
    this.sectorBannerText?.destroy();
    this.sectorBannerText = banner;

    const clear = (): void => {
      banner.destroy();
      if (this.sectorBannerText === banner) this.sectorBannerText = null;
    };
    if (getSettingsManager().isReducedMotionEnabled()) {
      this.time.delayedCall(1600, clear);
      return;
    }
    banner.setAlpha(0);
    this.tweens.add({
      targets: banner, alpha: 1, duration: 260, ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: banner, alpha: 0, duration: 340, delay: 1000, ease: 'Sine.easeIn',
          onComplete: clear,
        });
      },
    });
  }

  /**
   * Hint tier 2: a find hands over a lore fragment naming the next secret, so a chain of finds
   * leads somewhere instead of each one starting from nothing. The pointer is the discovery
   * store's HINTED flag, which persists per world with everything else the chart knows, so this
   * adds no storage key and no save field. A secret inside an unvisited hidden sector is never
   * named: that would hand back exactly what the breakable wall is hiding.
   */
  private grantSecretLead(sourceSecretId: string): void {
    const map = this.worldMode.worldMap();
    if (!map) return;
    const discovery = getDiscoveryManager();
    const targetSecretId = chooseHintTarget({
      map,
      knownSecretIds: discovery.getKnownSecretIds(),
      visitedSectorKeys: discovery.getVisitedSectorKeys(),
      sourceSecretId,
    });
    if (!targetSecretId) return;
    const lead = buildSecretLead(map, targetSecretId);
    if (!lead) return;

    discovery.markSecretHinted(targetSecretId);
    const codex = getCodexManager();
    if (codex.discoverLoreFragment(lead.fragment.id)) {
      getAchievementManager().setLoreFragmentsFound(codex.getDiscoveredLoreCount());
    }
    this.toastManager?.showToast({
      tier: 'notable',
      title: lead.fragment.title.toUpperCase(),
      description: [lead.riddle, lead.sigils, lead.wall, lead.gap].filter(Boolean).join('  '),
      icon: lead.fragment.icon,
      color: WORLD_GEOMETRY_COLORS.breakable.stroke,
      duration: 4600,
    });
    if (getTutorialHintManager().maybeShow('secret-lead')) {
      const leadHint = getTutorialHintDef('secret-lead');
      this.toastManager?.showToast({
        title: leadHint.title,
        description: leadHint.description,
        tier: 'critical',
        icon: leadHint.icon,
        color: leadHint.color,
        duration: leadHint.duration,
      });
    }
  }

  /** Arena is inert by construction: ArenaModeAdapter.worldMap() is null, so an arena run
   *  can never own the blink even on a profile that has claimed it. */
  private blinkDriveOwned(): boolean {
    return this.worldMode.worldMap() !== null
      && this.ownedTraversalAbilityIds.has(BLINK_DRIVE_ID);
  }

  private thermalWardOwned(): boolean {
    return this.ownedTraversalAbilityIds.has(THERMAL_WARD_ID);
  }

  /** The same arena guard blinkDriveOwned carries: ArenaModeAdapter.worldMap() is null, so an
   *  arena run never sweeps even on a profile that has claimed the decryptor. */
  private decryptorOwned(): boolean {
    return this.worldMode.worldMap() !== null
      && this.ownedTraversalAbilityIds.has(SIGNAL_DECRYPTOR_ID);
  }

  /**
   * Hint tier 3 (doc 04 section 5): entering a room sweeps the neighbourhood. Sectors in range
   * come back as outlines, never interiors, and this room's own unfound caches are pointed at.
   *
   * It fires on entry rather than on a button because a keyboard-only active would hand the
   * ability to one of the three input paths; the radar blip in updateMinimap is the responsive
   * half the spec's "active" was reaching for, and it is live on every input device.
   *
   * The fragment grant is not a bonus: MapScene's LEADS panel prints a fragment's text for every
   * HINTED secret, so hinting without granting would spoil in LEADS what the Codex still lists
   * as unrecovered.
   */
  private runDecryptorScan(sectorKey: string): void {
    if (!this.decryptorOwned()) return;
    const map = this.worldMode.worldMap();
    if (!map) return;

    const changes = getDiscoveryManager().applyScanPulse(
      sectorKey,
      scanPulseGraphRadius(getMetaProgressionManager().getUpgradeLevel('luckLevel')),
    );
    if (changes.secretsHinted.length === 0) return;

    const codex = getCodexManager();
    let loggedAnyFragment = false;
    for (const secretId of changes.secretsHinted) {
      const lead = buildSecretLead(map, secretId);
      if (lead && codex.discoverLoreFragment(lead.fragment.id)) loggedAnyFragment = true;
    }
    if (loggedAnyFragment) {
      getAchievementManager().setLoreFragmentsFound(codex.getDiscoveredLoreCount());
    }

    const hintedCount = changes.secretsHinted.length;
    this.toastManager?.showToast({
      tier: 'notable',
      title: 'SIGNAL DECRYPTED',
      description: hintedCount === 1
        ? 'A cache is concealed in this sector.'
        : `${hintedCount} caches are concealed in this sector.`,
      icon: 'radar',
      color: WORLD_GEOMETRY_COLORS.breakable.stroke,
      duration: 3200,
    });
  }

  /** dashLevel is Blink Drive's synergy hook (doc 04 section 2): -1s per purchased level.
   *  The floor only bites if that upgrade's maxLevel is ever raised past the base. */
  private blinkCooldownSeconds(): number {
    return Math.max(
      TUNING.player.blinkCooldownMin,
      TUNING.player.blinkCooldownBase - getMetaProgressionManager().getUpgradeLevel('dashLevel'),
    );
  }

  /** One pooled ghost at a world point. Shared by the dash trail and by Blink Drive. */
  private spawnDashAfterimage(x: number, y: number): void {
    let afterimage = this.dashAfterimagePool.pop();
    if (!afterimage) {
      afterimage = this.add.circle(x, y, 16, PLAYER_NEON.glow, 0.6);
      afterimage.setDepth(9);
    } else {
      afterimage.setPosition(x, y);
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

  /**
   * Blink Drive (doc 04 section 2, ability 1): in an expedition run the dash button becomes a
   * short teleport with i-frames. Returns true when the press belongs to the blink, so the
   * caller does not also fire a dash: an owner blinks instead of dashing, cooling down or not.
   *
   * The landing point comes from resolveCircleMove, the same resolver ordinary movement uses:
   * that is what makes a blink physically unable to cross a wall or a closed gate mouth, which
   * would otherwise bypass every ability door in the world and dissolve the whole gate order.
   */
  private tryBlink(): boolean {
    if (!this.blinkDriveOwned()) return false;
    const map = this.worldMode.worldMap();
    if (map === null) return false;
    if (this.inputController.isDashActive()) return true;
    if (this.inputController.getDashCooldownRemaining() > 0) return true;

    const originX = Transform.x[this.playerId];
    const originY = Transform.y[this.playerId];
    if (!this.inputController.resolveActionDirection(originX, originY, blinkDirection)) return true;

    const range = TUNING.player.blinkRange;
    resolveCircleMove(
      map,
      originX,
      originY,
      originX + blinkDirection.x * range,
      originY + blinkDirection.y * range,
      PLAYER_COLLISION_RADIUS,
      MoverKind.Player,
      blinkCollisionResult,
    );

    const travelX = blinkCollisionResult.x - originX;
    const travelY = blinkCollisionResult.y - originY;
    const minTravel = TUNING.player.blinkMinTravel;
    if (travelX * travelX + travelY * travelY < minTravel * minTravel) {
      // Nose against a wall: refused rather than spent, so a blocked blink never eats the cooldown.
      this.soundManager.playError();
      return true;
    }

    Transform.x[this.playerId] = blinkCollisionResult.x;
    Transform.y[this.playerId] = blinkCollisionResult.y;
    clampPlayerToRect(this.world, this.playerId, this.worldMode.fieldRect());
    this.clearPlayerKnockback();

    this.damageCooldown = Math.max(this.damageCooldown, TUNING.player.blinkIframeSeconds);
    this.inputController.setDashCooldownTimer(this.blinkCooldownSeconds());
    this.hasDashedThisRun = true;

    const ghostCount = TUNING.player.blinkGhostCount;
    const landedX = Transform.x[this.playerId];
    const landedY = Transform.y[this.playerId];
    for (let ghost = 0; ghost < ghostCount; ghost++) {
      const along = ghost / (ghostCount - 1);
      this.spawnDashAfterimage(
        originX + (landedX - originX) * along,
        originY + (landedY - originY) * along,
      );
    }
    this.effectsManager.playDeathBurst(originX, originY, PLAYER_NEON.glow);
    this.cameras.main.shake(90, 0.003);
    this.soundManager.playSynergyActivation();
    return true;
  }

  /**
   * Doc 02 section 4.3. The ownership test runs only once a closed door is actually in reach,
   * and against the cached id set rather than the store, so the common frame is four edge
   * checks in one sector and no storage read.
   */
  private tryOpenAbilityDoor(map: WorldMap, playerX: number, playerY: number): void {
    if (this.ownedTraversalAbilityIds.size === 0) return;
    const door = gatedDoorNearWorld(
      map, playerX, playerY, ABILITY_DOOR_OPEN_RADIUS, EdgeKind.AbilityDoor,
    );
    if (!door || !this.ownedTraversalAbilityIds.has(door.requiredId)) return;
    if (!openAbilityGate(map, door.edgeId)) return;

    // Same two lines as onBarrierBroken: the geometry layer caches its drawn window and the
    // radar underlay is drawn once and only translated, so a tile change invalidates both.
    this.worldMode.notifyGeometryChanged();
    this.minimapFeed.invalidateUnderlay();

    const definition = getTraversalAbility(door.requiredId);
    this.effectsManager.playDeathBurst(door.x, door.y, WORLD_GEOMETRY_COLORS.gate.stroke);
    this.cameras.main.shake(140, 0.006);
    this.soundManager.playComboThreshold();
    if (this.toastManager && definition) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: 'ROUTE OPEN',
        description: `${definition.name} unsealed this door.`,
        icon: definition.icon,
        color: WORLD_GEOMETRY_COLORS.gate.stroke,
        duration: 2800,
      });
    }
    this.recordExpeditionQuest({ kind: 'openGate' });
  }

  /** tryOpenAbilityDoor's quest-key twin: same radius, same cache-not-store test, same two
   *  invalidations, and it feeds the openGate trigger the same way an ability door does. */
  private tryOpenQuestDoor(map: WorldMap, playerX: number, playerY: number): void {
    if (this.earnedQuestKeyIds.size === 0) return;
    const door = gatedDoorNearWorld(
      map, playerX, playerY, ABILITY_DOOR_OPEN_RADIUS, EdgeKind.KeyDoor,
    );
    if (!door || !this.earnedQuestKeyIds.has(door.requiredId)) return;
    if (!openAbilityGate(map, door.edgeId)) return;

    this.worldMode.notifyGeometryChanged();
    this.minimapFeed.invalidateUnderlay();

    const wardenSeal = door.requiredId === WARDEN_SEAL_KEY_ID;
    const quest = wardenSeal ? undefined : getQuestForKeyId(door.requiredId);
    const color = GATE_GLYPHS[EdgeKind.KeyDoor].color;
    this.effectsManager.playDeathBurst(door.x, door.y, color);
    this.cameras.main.shake(140, 0.006);
    this.soundManager.playComboThreshold();
    if (this.toastManager) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: 'ROUTE OPEN',
        description: wardenSeal
          ? 'The fall of the Warden unsealed this door.'
          : quest
            ? `${quest.name} keyed this door.`
            : 'A quest key unsealed this door.',
        icon: wardenSeal ? 'skull' : quest?.icon ?? 'warning',
        color,
        duration: 2800,
      });
    }
    this.recordExpeditionQuest({ kind: 'openGate' });
  }

  /**
   * Doc 04 section 2 row 2, the rubble half. The detonation hands the break to
   * barrierEventSink rather than repeating its body, so a charged break and a projectile
   * break persist, invalidate and sound exactly the same by construction.
   */
  private updateBreachCharges(map: WorldMap, playerX: number, playerY: number): void {
    if (!this.ownedTraversalAbilityIds.has('ability_breach_charges')) return;

    if (this.breachChargeBarrierId !== null) {
      if (this.gameTime < this.breachChargeDetonatesAt) return;
      const barrierId = this.breachChargeBarrierId;
      this.breachChargeBarrierId = null;
      if (clearBarrier(map, barrierId)) {
        this.barrierEventSink.onBarrierBroken(this.breachChargeX, this.breachChargeY, barrierId);
      }
      return;
    }

    const target = nearestBreakableBarrier(
      map, playerX, playerY, GameScene.BREACH_CHARGE_PLANT_RADIUS,
    );
    if (target === null) return;

    this.breachChargeBarrierId = target.barrierId;
    this.breachChargeX = target.x;
    this.breachChargeY = target.y;
    this.breachChargeDetonatesAt = this.gameTime + GameScene.BREACH_CHARGE_FUSE_SECONDS;
    this.effectsManager.playHitSparks(target.x, target.y, Math.random() * Math.PI * 2);
    this.effectsManager.showDamageNumber(
      target.x, target.y - 20, 'BREACH', WORLD_GEOMETRY_COLORS.breakable.stroke,
    );
    this.soundManager.playUIClick();
  }

  /** sprintLevel is the tether's synergy hook (doc 04 section 2 row 3): the reel re-arms
   *  faster. The floor only bites if that upgrade's maxLevel is ever raised past 5. */
  private magnoTetherCooldownSeconds(): number {
    return Math.max(
      GameScene.TETHER_COOLDOWN_MIN_SECONDS,
      GameScene.TETHER_COOLDOWN_BASE_SECONDS
        - GameScene.TETHER_COOLDOWN_PER_SPRINT_LEVEL
          * getMetaProgressionManager().getUpgradeLevel('sprintLevel'),
    );
  }

  /**
   * Doc 04 section 2 row 3, the crossing half. The hop is instant, the tryBlink precedent: a
   * ship suspended over a chasm would be a state the run save, the boss seal and the death
   * path each need an answer for, and the reel is over in less time than any of them notices.
   *
   * The heading is Velocity, not an aim stick, the breach-charge precedent: a pressable
   * ability would have to reach all three input paths plus a cooldown readout, which is a
   * HUD-layout change larger than the feature.
   */
  private tryMagnoTether(map: WorldMap, playerX: number, playerY: number): void {
    if (!this.ownedTraversalAbilityIds.has(MAGNO_TETHER_ID)) {
      this.reportVoidGap(map, playerX, playerY);
      return;
    }
    if (this.gameTime < this.tetherReadyAt) return;

    const crossing = findTetherCrossing(
      map, playerX, playerY, Velocity.x[this.playerId], Velocity.y[this.playerId],
    );
    if (crossing === null) return;

    Transform.x[this.playerId] = crossing.x;
    Transform.y[this.playerId] = crossing.y;
    clampPlayerToRect(this.world, this.playerId, this.worldMode.fieldRect());
    this.clearPlayerKnockback();
    this.tetherReadyAt = this.gameTime + this.magnoTetherCooldownSeconds();

    const ghostCount = TUNING.player.blinkGhostCount;
    for (let ghost = 0; ghost < ghostCount; ghost++) {
      const along = ghost / (ghostCount - 1);
      this.spawnDashAfterimage(
        playerX + (crossing.x - playerX) * along,
        playerY + (crossing.y - playerY) * along,
      );
    }
    this.effectsManager.playHitSparks(crossing.anchorX, crossing.anchorY, 0);
    this.cameras.main.shake(70, 0.002);
    this.soundManager.playSynergyActivation();
  }

  /** Names the key the way a sealed door and a hazard strip already do: a barrier is only
   *  fair if the player can learn what answers it. */
  private reportVoidGap(map: WorldMap, playerX: number, playerY: number): void {
    if (this.gameTime - this.voidGapNoticeAt
      < GameScene.VOID_GAP_NOTICE_REANNOUNCE_SECONDS) return;
    if (!voidGapNearWorld(map, playerX, playerY)) return;
    this.voidGapNoticeAt = this.gameTime;

    const definition = getTraversalAbility(MAGNO_TETHER_ID);
    this.effectsManager.showDamageNumber(
      playerX, playerY - 26, 'VOID GAP', WORLD_GEOMETRY_COLORS.voidGap.stroke,
    );
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'VOID GAP',
      description: definition
        ? `${definition.name} would reel the ship across.`
        : 'Nothing the ship carries crosses this.',
      icon: 'chain',
      color: WORLD_GEOMETRY_COLORS.voidGap.stroke,
      duration: 2800,
    });
  }

  /** phaseLevel is the cloak's synergy hook (doc 04 section 2 row 4, "+0.25 s cloak
   *  duration per level"): the ship stays intangible longer on the way through. */
  private phaseCloakIframeSeconds(): number {
    return GameScene.PHASE_IFRAME_BASE_SECONDS
      + GameScene.PHASE_IFRAME_PER_PHASE_LEVEL
        * getMetaProgressionManager().getUpgradeLevel('phaseLevel');
  }

  /**
   * Doc 04 section 2 row 4. The pass is instant on the tryBlink precedent, and it needs no
   * cooldown because the fence does not come back: passing trips its kill-switch, which is
   * the row's own anti-soft-lock rule and is also why a fenced pocket can never become a
   * room with no way home.
   *
   * The heading is Velocity, not an aim stick, the breach-charge and tether precedent: a
   * pressable ability would have to reach all three input paths plus a cooldown readout,
   * which is a HUD-layout change larger than the feature.
   */
  private tryPhaseCloak(map: WorldMap, playerX: number, playerY: number): void {
    if (!this.ownedTraversalAbilityIds.has(PHASE_CLOAK_ID)) {
      this.reportSecurityGrid(map, playerX, playerY);
      return;
    }
    const breach = findGridBreach(
      map, playerX, playerY, Velocity.x[this.playerId], Velocity.y[this.playerId],
    );
    if (breach === null) return;
    // Ordered so nothing is recorded that did not happen: the tile write is the authority
    // and it refuses a fence that is already dark.
    if (!clearSecurityGrid(map, breach.gridId)) return;
    recordDownedSecurityGrid(map.seed, map.worldGenVersion, breach.gridId);

    Transform.x[this.playerId] = breach.x;
    Transform.y[this.playerId] = breach.y;
    clampPlayerToRect(this.world, this.playerId, this.worldMode.fieldRect());
    this.clearPlayerKnockback();
    this.damageCooldown = Math.max(this.damageCooldown, this.phaseCloakIframeSeconds());

    // Same two lines as onBarrierBroken: the geometry layer caches its drawn window and
    // the radar underlay is drawn once and only translated.
    this.worldMode.notifyGeometryChanged();
    this.minimapFeed.invalidateUnderlay();

    const ghostCount = TUNING.player.blinkGhostCount;
    for (let ghost = 0; ghost < ghostCount; ghost++) {
      const along = ghost / (ghostCount - 1);
      this.spawnDashAfterimage(
        playerX + (breach.x - playerX) * along,
        playerY + (breach.y - playerY) * along,
      );
    }
    this.effectsManager.playDeathBurst(
      breach.fenceX, breach.fenceY, WORLD_GEOMETRY_COLORS.securityGrid.stroke,
    );
    this.cameras.main.shake(120, 0.004);
    this.soundManager.playComboThreshold();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'GRID DOWN',
      description: breach.kind === 'corridor'
        ? 'The corridor is open for good: the cloak tripped its kill-switch.'
        : 'The fence is dark for good: the cloak tripped its kill-switch.',
      icon: 'ghost',
      color: WORLD_GEOMETRY_COLORS.securityGrid.stroke,
      duration: 2800,
    });
  }

  /** Names the key the way a sealed door, a hazard strip and a void gap already do: a
   *  barrier is only fair if the player can learn what answers it. */
  private reportSecurityGrid(map: WorldMap, playerX: number, playerY: number): void {
    if (this.gameTime - this.securityGridNoticeAt
      < GameScene.SECURITY_GRID_NOTICE_REANNOUNCE_SECONDS) return;
    if (!securityGridNearWorld(map, playerX, playerY)) return;
    this.securityGridNoticeAt = this.gameTime;

    const definition = getTraversalAbility(PHASE_CLOAK_ID);
    this.effectsManager.showDamageNumber(
      playerX, playerY - 26, 'SECURITY GRID', WORLD_GEOMETRY_COLORS.securityGrid.stroke,
    );
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'SECURITY GRID',
      description: definition
        ? `${definition.name} would carry the ship through.`
        : 'Nothing the ship carries passes this.',
      icon: 'ghost',
      color: WORLD_GEOMETRY_COLORS.securityGrid.stroke,
      duration: 2800,
    });
  }

  /**
   * Doc 03 section 4.5's Metroid moment, delivered at the door instead of in a map tooltip:
   * a sealed door names what opens it the first time the ship comes near it.
   *
   * Runs AFTER tryOpenAbilityDoor, never before: that call clears the mouth tiles of a door
   * this profile can pass, so by the time this scan runs, gateStillClosed() already rejects
   * it and the nearest remaining closed door is the one actually worth naming.
   */
  private reportSealedDoor(map: WorldMap, playerX: number, playerY: number): void {
    const abilityDoor = gatedDoorNearWorld(
      map, playerX, playerY, GameScene.SEALED_DOOR_NOTICE_RADIUS, EdgeKind.AbilityDoor,
    );
    if (abilityDoor && !this.ownedTraversalAbilityIds.has(abilityDoor.requiredId)) {
      if (this.alreadyAnnouncedSealedDoor(abilityDoor.edgeId)) return;
      const definition = getTraversalAbility(abilityDoor.requiredId);
      const color = WORLD_GEOMETRY_COLORS.gate.stroke;
      this.effectsManager.showDamageNumber(abilityDoor.x, abilityDoor.y - 20, 'SEALED', color);
      this.soundManager.playError();
      if (this.toastManager) {
        this.toastManager.showToast({
          tier: 'ambient',
          title: 'SEALED DOOR',
          description: definition
            ? `${definition.name} opens this route.`
            : 'Mechanism unknown.',
          icon: definition?.icon ?? 'warning',
          color,
          duration: 2800,
        });
      }
      return;
    }

    const questDoor = gatedDoorNearWorld(
      map, playerX, playerY, GameScene.SEALED_DOOR_NOTICE_RADIUS, EdgeKind.KeyDoor,
    );
    if (!questDoor || this.earnedQuestKeyIds.has(questDoor.requiredId)) return;
    if (this.alreadyAnnouncedSealedDoor(questDoor.edgeId)) return;

    const wardenSealed = questDoor.requiredId === WARDEN_SEAL_KEY_ID;
    const quest = wardenSealed ? undefined : getQuestForKeyId(questDoor.requiredId);
    const color = GATE_GLYPHS[EdgeKind.KeyDoor].color;
    this.effectsManager.showDamageNumber(questDoor.x, questDoor.y - 20, 'SEALED', color);
    this.soundManager.playError();
    if (this.toastManager) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: wardenSealed ? 'WARDEN SEAL' : 'QUEST DOOR',
        description: wardenSealed
          ? 'Conquer this world to open this route.'
          : quest
            ? `Finish ${quest.name} to key this route.`
            : 'A quest key opens this route.',
        icon: wardenSealed ? 'skull' : quest?.icon ?? 'warning',
        color,
        duration: 2800,
      });
    }
  }

  /** True when this edge already announced itself inside the re-announce window; stamps the
   *  dedup fields otherwise. Shared by both door kinds so only one notice runs at a time. */
  private alreadyAnnouncedSealedDoor(edgeId: string): boolean {
    if (edgeId === this.sealedDoorNoticeEdgeId
      && this.gameTime - this.sealedDoorNoticeAt
        < GameScene.SEALED_DOOR_REANNOUNCE_SECONDS) {
      return true;
    }
    this.sealedDoorNoticeEdgeId = edgeId;
    this.sealedDoorNoticeAt = this.gameTime;
    return false;
  }

  /**
   * Doc 02 section 4.6. HazardFloor gates by cost, never by blocking: the tile is walkable to
   * the resolver and to the flow field, and only the player pays for standing on it.
   */
  private updateHazardFloorDamage(
    map: WorldMap, playerX: number, playerY: number, deltaSeconds: number,
  ): void {
    const onHazard = tileKindAt(
      map, Math.floor(playerX / TILE_SIZE), Math.floor(playerY / TILE_SIZE),
    ) === TileKind.HazardFloor;
    if (!onHazard) {
      this.hazardFloorTickTimer = TUNING.hazards.floorTickSeconds;
      return;
    }

    if (this.thermalWardOwned()) {
      this.reportThermalWard(playerX, playerY);
      return;
    }

    this.hazardFloorTickTimer += deltaSeconds;
    if (this.hazardFloorTickTimer < TUNING.hazards.floorTickSeconds) return;
    this.hazardFloorTickTimer -= TUNING.hazards.floorTickSeconds;

    // Spent, not banked: an i-frame window (a blink, an ultimate, a hit just taken) skips this
    // tick rather than stacking one up to land the instant the window closes.
    if (this.damageCooldown > 0) return;

    this.takeDamage(TUNING.hazards.floorTickDamage, undefined, 'Hazard Floor');
    this.reportHazardField(playerX, playerY);
  }

  /** The ward is silent otherwise: a floor that visibly costs hull and then does not has to say
   *  why, or it reads as a bug. Same 30 s re-arm and same field as the unwarded notice, so the
   *  two can never both fire in one window. */
  private reportThermalWard(playerX: number, playerY: number): void {
    if (this.gameTime - this.hazardNoticeAt < GameScene.HAZARD_NOTICE_REANNOUNCE_SECONDS) return;
    this.hazardNoticeAt = this.gameTime;
    this.effectsManager.showDamageNumber(playerX, playerY - 26, 'WARDED', PLAYER_NEON.glow);
  }

  /** Names the key the same way a sealed door does: the cost is only fair if the player can
   *  learn what answers it. Re-armed on run time, per run, not per strip. */
  private reportHazardField(playerX: number, playerY: number): void {
    if (this.gameTime - this.hazardNoticeAt < GameScene.HAZARD_NOTICE_REANNOUNCE_SECONDS) return;
    this.hazardNoticeAt = this.gameTime;

    const definition = getTraversalAbility(THERMAL_WARD_ID);
    this.effectsManager.showDamageNumber(
      playerX, playerY - 26, 'HAZARD', WORLD_GEOMETRY_COLORS.hazard.stroke,
    );
    if (this.toastManager) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: 'HAZARD FIELD',
        description: definition
          ? `${definition.name} would ward this floor.`
          : 'The hull is taking damage here.',
        icon: 'warning',
        color: WORLD_GEOMETRY_COLORS.hazard.stroke,
        duration: 2800,
      });
    }
  }

  /** Arena is inert by construction, not by care: ArenaModeAdapter.worldMap() is null, so an
   *  arena run never reaches a vault, a door or the sector key. */
  private updateExpeditionAbilities(deltaSeconds: number): void {
    if (this.playerId === -1) return;
    const map = this.worldMode.worldMap();
    if (!map) return;
    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];
    // Under a boss seal the door machinery stands down: tryOpenAbilityDoor would clear
    // the sealed mouth of an owned ability door mid-fight, and the readout would name a
    // requirement the seal, not the door, is enforcing.
    if (!this.worldMode.isSectorLocked()) {
      this.abilityVaultManager.sync(map, playerX, playerY);
      this.abilityVaultManager.update(playerX, playerY);
      this.questBoardManager.sync(map, playerX, playerY);
      this.questBoardManager.update(playerX, playerY);
      this.secretCacheManager.sync(map, playerX, playerY);
      this.secretCacheManager.update(playerX, playerY);
      this.updateAmbushNests(playerX, playerY);
      this.updateNemesisLairs(playerX, playerY);
      this.syncWardenThrone(map, playerX, playerY);
      this.updateWardenThrone(playerX, playerY);
      this.syncEscortDrone(playerX, playerY);
      this.updateEscortDrone(playerX, playerY, deltaSeconds);
      this.syncQuestCargoDrop(map, playerX, playerY);
      this.updateQuestCargoDrop(playerX, playerY);
      this.tryOpenAbilityDoor(map, playerX, playerY);
      this.tryOpenQuestDoor(map, playerX, playerY);
      this.updateBreachCharges(map, playerX, playerY);
      this.tryMagnoTether(map, playerX, playerY);
      this.tryPhaseCloak(map, playerX, playerY);
      this.reportSealedDoor(map, playerX, playerY);
    }
    this.updateHazardFloorDamage(map, playerX, playerY, deltaSeconds);
  }

  /**
   * Applies a temporary multiplicative buff to a PlayerStats multiplier field
   * (damage / XP / gem value) that reverts after `durationSeconds` of run time.
   * Tracked against gameTime (not a Phaser timer) so it survives refresh-recovery
   * — see updateTimedStatBuffs.
   */
  private applyTimedStatBuff(stat: TimedStatField, magnitude: number, durationSeconds: number): void {
    this.playerStats[stat] *= magnitude;
    this.syncStatsToPlayer();
    this.timedStatBuffs.push({ stat, magnitude, expiresAt: this.gameTime + durationSeconds });
  }

  /** Per-frame: reverts any timed stat buffs whose gameTime expiry has passed. */
  private updateTimedStatBuffs(): void {
    if (this.timedStatBuffs.length === 0) return;
    const { active, revertByStat } = expireTimedStatBuffs(this.timedStatBuffs, this.gameTime);
    const expiredStats = Object.keys(revertByStat) as TimedStatField[];
    if (expiredStats.length === 0) return;
    for (const stat of expiredStats) {
      this.playerStats[stat] /= revertByStat[stat]!;
    }
    this.timedStatBuffs = active;
    this.syncStatsToPlayer();
  }

  /**
   * Per-frame bounty update: paces a rotating objective, tracks its timer, and
   * resolves success/failure. Progress for kill objectives is incremented in
   * handleEnemyDeath; flawless failure is flagged in takeDamage.
   */
  private updateBounties(deltaSeconds: number): void {
    if (this.playerId === -1) return;

    if (!this.bountyText) {
      // Bottom-center, above the combo counter. The top band has no room for
      // a centered line in portrait — bars left, world+timer center, and
      // kills/gold right all share that vertical range, so any "below the
      // timer" y lands across the XP bar or the upgrade chip rows.
      const hudScale = computeHudScale(
        this.scale.width,
        this.scale.height,
        getSettingsManager().getUiScale(),
      );
      // Combo counter bottoms at height − 96·s (see HUDManager); sit above it.
      const bountyBottomY = this.scale.height - Math.round((96 + 40) * hudScale);
      this.bountyText = this.add.text(this.scale.width / 2, bountyBottomY, '', {
        fontSize: `${Math.round(14 * hudScale)}px`,
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
        color: '#ffe26a',
        stroke: '#000000',
        strokeThickness: Math.max(2, Math.round(3 * hudScale)),
        align: 'center',
        // A lead row runs about 95 characters. Origin is (0.5, 1), so a second line grows
        // upward from the same bottom edge and cannot reach the combo counter below.
        wordWrap: { width: Math.min(this.scale.width - 48, 560) },
      }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(DepthLayers.UI_OVERLAY);
      this.bountyText.setLetterSpacing(1);
    }

    if (this.bounty === null) {
      this.updateObjectiveTicker(deltaSeconds);
      this.bountyCooldown -= deltaSeconds;
      if (this.bountyCooldown <= 0) this.startBounty();
      return;
    }

    this.bounty.timeLeft -= deltaSeconds;

    if (this.bounty.kind === 'flawless') {
      if (this.bountyFlawlessBroken) { this.failBounty(); return; }
      if (this.bounty.timeLeft <= 0) { this.completeBounty(); return; }
    } else {
      if (this.bounty.progress >= this.bounty.target) { this.completeBounty(); return; }
      if (this.bounty.timeLeft <= 0) { this.failBounty(); return; }
    }

    const seconds = Math.ceil(this.bounty.timeLeft);
    if (this.bounty.kind === 'flawless') {
      this.bountyText.setText(`BOUNTY · Flawless — avoid damage for ${seconds}s`);
    } else {
      const label = this.bounty.kind === 'elites' ? 'Slay elites' : 'Slay enemies';
      this.bountyText.setText(`BOUNTY · ${label} ${this.bounty.progress}/${this.bounty.target} · ${seconds}s`);
    }
  }

  /**
   * Fills the bounty line while no bounty is running, rotating every active objective and the
   * two nearest open leads. Arena, daily, gauntlet and practice runs have no world map, so the
   * guard here is what keeps the line empty for them without a mode flag. Both the cycle step
   * and the read are taken modulo the live length, because a quest completing or a lead being
   * claimed between two frames shortens the array under the index.
   */
  private updateObjectiveTicker(deltaSeconds: number): void {
    if (!this.bountyText) return;
    const map = this.worldMode.worldMap();
    if (!map) {
      this.bountyText.setText('');
      return;
    }

    this.questTickerRefreshTimer -= deltaSeconds;
    if (this.questTickerRefreshTimer <= 0) {
      this.questTickerRefreshTimer = QUEST_TICKER_REFRESH_SECONDS;
      this.expeditionTickerRows = buildRunTickerRows({
        views: getActiveQuestStepViews(questWorldStamp(map), buildSectorSupply(map)),
        // Read, never clear. MapScene.create is the sole clearer of this overlay; clearing it
        // here would retire the chart badge within a second of the step that raised it.
        updatedQuestIds: getDiscoveryManager().getUpdatedObjectiveQuestIds(),
        leads: this.buildTickerLeads(map),
        siege: this.buildTickerSiege(),
      });
    }
    if (this.expeditionTickerRows.length === 0) {
      this.bountyText.setText('');
      return;
    }

    this.questTickerCycleTimer -= deltaSeconds;
    if (this.questTickerCycleTimer <= 0) {
      this.questTickerCycleTimer = QUEST_TICKER_CYCLE_SECONDS;
      this.questTickerIndex = (this.questTickerIndex + 1) % this.expeditionTickerRows.length;
    }

    this.bountyText.setText(
      this.expeditionTickerRows[this.questTickerIndex % this.expeditionTickerRows.length]);
  }

  /** The live siege as the ticker needs it, or null while no room is answering. The cap and the
   *  boss are the two reasons a wave does NOT come, and updateExpeditionSiege returns on both, so
   *  the line must be able to say so rather than count down to a wave that will not land. */
  private buildTickerSiege(): RunTickerSiege | null {
    if (this.siegeSectorKey === null) return null;
    return {
      liveBesiegers: this.siegeBesiegerIds.length,
      maxBesiegers: SIEGE_MAX_LIVE_BESIEGERS,
      secondsToNextWave: Math.max(0, Math.ceil(this.siegeNextWaveAtSeconds - this.gameTime)),
      suppressedByBoss: this.bossFightDirector.isBossActive(),
    };
  }

  /** Open leads, nearest first, resolved through the same buildSecretLead the map screen's
   *  LEADS panel calls, so the two surfaces name the same lead first. */
  private buildTickerLeads(map: WorldMap): SecretLead[] {
    const shipCell = sectorOfWorldPoint(
      Transform.x[this.playerId], Transform.y[this.playerId]);
    return getDiscoveryManager().getHintedSecretIds()
      .map(secretId => buildSecretLead(map, secretId))
      .filter((lead): lead is SecretLead => lead !== null)
      .sort((a, b) => leadSectorDistance(a, shipCell) - leadSectorDistance(b, shipCell)
        || (a.secretId < b.secretId ? -1 : a.secretId > b.secretId ? 1 : 0));
  }

  /** The bounty cycle lost its toasts to the diet, so the beat lands in-world instead. */
  private showBountyBanner(text: string, color: number): void {
    if (this.playerId === -1) return;
    this.effectsManager.showDamageNumber(
      Transform.x[this.playerId], Transform.y[this.playerId] - 34, text, color,
    );
  }

  /** Starts a fresh random bounty. */
  private startBounty(): void {
    const kinds: BountyKind[] = ['kills', 'elites', 'flawless'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    this.bountyFlawlessBroken = false;
    if (kind === 'kills') {
      this.bounty = { kind, target: 25 + this.worldLevel * 5, progress: 0, timeLeft: 25 };
    } else if (kind === 'elites') {
      this.bounty = { kind, target: 3, progress: 0, timeLeft: 45 };
    } else {
      this.bounty = { kind, target: 0, progress: 0, timeLeft: 15 };
    }
    this.showBountyBanner(
      this.bounty.kind === 'flawless'
        ? 'BOUNTY: NO HITS 15s'
        : this.bounty.kind === 'elites'
          ? 'BOUNTY: 3 ELITES'
          : `BOUNTY: ${this.bounty.target} KILLS`,
      0xffe26a,
    );
    if (this.toastManager) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: 'New Bounty',
        description: kind === 'flawless'
          ? 'Survive 15s without taking damage.'
          : kind === 'elites'
            ? 'Slay 3 elite enemies.'
            : `Slay ${this.bounty.target} enemies in 25s.`,
        icon: 'skull',
        color: 0xffe26a,
        duration: 3000,
      });
    }
  }

  /** Records a kill toward the active bounty (called from handleEnemyDeath). */
  private recordBountyKill(wasElite: boolean): void {
    if (!this.bounty) return;
    if (this.bounty.kind === 'kills') this.bounty.progress++;
    else if (this.bounty.kind === 'elites' && wasElite) this.bounty.progress++;
  }

  private completeBounty(): void {
    const viewCentre = rectCenter(this.worldMode.viewRect());
    const playerX = this.playerId !== -1 ? Transform.x[this.playerId] : viewCentre.x;
    const playerY = this.playerId !== -1 ? Transform.y[this.playerId] : viewCentre.y;
    // Reward: two power-ups + a gold + XP burst.
    this.spawnRandomConsumable(playerX - 30, playerY);
    this.spawnRandomConsumable(playerX + 30, playerY);
    getMetaProgressionManager().addGold(60 + this.worldLevel * 12);
    this.effectsManager.playGoldSparkle(playerX, playerY, 12);
    this.soundManager.playComboThreshold();
    this.showBountyBanner('BOUNTY CLEAR', 0x66ff99);
    if (this.toastManager) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: 'Bounty Complete!',
        description: 'Reward dropped: power-ups + gold.',
        icon: 'star',
        color: 0x66ff99,
        duration: 3000,
      });
    }
    this.bounty = null;
    this.bountyCooldown = 18;
  }

  private failBounty(): void {
    this.showBountyBanner('BOUNTY LOST', 0xff6666);
    if (this.toastManager) {
      this.toastManager.showToast({
        tier: 'ambient',
        title: 'Bounty Failed',
        description: 'Another will appear shortly.',
        icon: 'skull',
        color: 0xff6666,
        duration: 2200,
      });
    }
    this.bounty = null;
    this.bountyCooldown = 12;
  }

  /**
   * Announce a weapon synergy the moment its pair completes. Until now the
   * synergy system (real passive damage/cooldown bonuses) was invisible — only
   * a sound played — so players couldn't tell a synergy had triggered or what it
   * did. Surfacing the name + effect turns it into a legible build-crafting
   * moment. Fired from the WeaponManager `onSynergyActivated` callback, which
   * only reports pairs that newly completed (never re-fires for active ones).
   */
  private showSynergyToast(synergy: WeaponSynergy): void {
    if (!this.toastManager) return;
    this.toastManager.showToast({
      tier: 'notable',
      title: `Synergy: ${synergy.name}`,
      description: synergy.description,
      icon: 'chain',
      color: 0x66ddff,
      duration: 3200,
    });
  }

  // Pre-allocated pool for grid background enemy data (avoids per-frame allocation)
  private gridEnemyDataPool: { x: number; y: number; weight: number }[] = [];
  private gridEnemyDataLength: number = 0;

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
    // Suppress while an intro overlay is visible — ESC there dismisses the overlay
    // (skips coach marks / closes the modifier banner) and must not also open pause.
    if (this.escKey && Phaser.Input.Keyboard.JustDown(this.escKey) && !this.introOverlayActive) {
      this.togglePauseMenu();
    }

    // Sync joystick enabled state (must run even when paused to disable during overlays)
    this.inputController.setEnabled(!this.isPaused && !this.isGameOver);

    // Relic draft (FEAT-RELIC-DRAFT): start/advance/close owed relic-choice rounds.
    // Runs BEFORE the isPaused guard so it can open a round (which sets isPaused)
    // and later release the pause when the queue drains.
    this.processRelicChoiceQueue();

    // Skip update when paused or game over
    if (this.isPaused || this.isGameOver) return;

    // During death sequence, only run visual systems so particles animate
    if (this.deathSequenceActive) {
      const deathDelta = delta / 1000;
      if (this.deathRippleManager) this.deathRippleManager.update(deathDelta);
      if (this.gridBackground) this.gridBackground.update(deathDelta);
      if (this.telegraphManager) this.telegraphManager.update(deathDelta); // let telegraphs fade out
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
    if (this.recallChannelRemaining > 0) this.updateExpeditionRecall(deltaSeconds);
    this.worldMode.update(deltaSeconds);
    this.applyEnemyLeash();
    this.updateRegionWallShift(deltaSeconds);
    this.updateCloseCallWatch();

    // Deferred to update() rather than fired in create(): the run-modifier banner
    // holds introOverlayActive for a beat, and spawnPracticeTarget no-ops under it.
    if (this.pendingRematchSpawn && !this.introOverlayActive && this.gameTime >= 1.0) {
      const rematchSpawn = this.pendingRematchSpawn;
      this.pendingRematchSpawn = null;
      this.spawnPracticeTarget(rematchSpawn);
    }

    if (this.practiceFight) this.updatePracticeFightClock();

    // ═══ ACHIEVEMENT TIME TRACKING (throttled to once per second) ═══
    // Practice is a sandbox and its clock jumps: crediting it would complete the
    // whole time ladder in one tick, and practice writes no-op regardless.
    if (!this.practiceModeActive && this.gameTime - this.lastAchievementTimeCheck >= 1.0) {
      this.lastAchievementTimeCheck = this.gameTime;
      getAchievementManager().recordTimeSurvived(Math.floor(this.gameTime));
    }

    // ═══ DAILY + EXPEDITION QUESTS (live, throttled to once per second) ═══
    // Practice is excluded for the same reason as the line above and to match the
    // run-end settle sites 1:1: a sandbox run must never move the day's board.
    if (!this.practiceModeActive && this.gameTime - this.lastDailyQuestCheck >= 1.0) {
      this.lastDailyQuestCheck = this.gameTime;
      this.checkDailyQuestsLive();
      this.checkExpeditionQuestKills();
      this.checkExpeditionQuestDwell();
      this.questBoardManager.refreshCargo();
      this.updateExpeditionSiege();
    }

    // ═══ PACE GHOST (fixed 15 s sample grid, HUD refreshed once per second) ═══
    // The while-loop samples on absolute grid points rather than a drifting
    // timer, so a slow frame fills the gap instead of shifting every later
    // sample. Practice is excluded like the blocks above; gauntlet has no ghost,
    // so its delta is null and the HUD line stays empty.
    if (!this.practiceModeActive) {
      while (
        this.paceRecordingEnabled
        && this.paceSamples.length < MAX_PACE_SAMPLES
        && (this.paceSamples.length + 1) * PACE_SAMPLE_INTERVAL_SECONDS <= this.gameTime
      ) {
        this.paceSamples.push(this.killCount);
      }
      if (this.gameTime - this.lastPaceCheck >= 1.0) {
        this.lastPaceCheck = this.gameTime;
        this.hudManager.setPaceDelta(paceDeltaKills(this.paceGhostCurve, this.gameTime, this.killCount));
      }
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
    let dashVelocityThisFrame: DashVelocity | null = null;
    if (dashState.isDashing) {
      this.hasDashedThisRun = true;
      // Handed to inputSystem below rather than written into Velocity here: inputSystem runs
      // later in this same frame and assigns every player's velocity unconditionally, so a
      // write here would never survive to MovementSystem.
      const dashSpeed = this.playerStats.moveSpeed;
      dashFrameVelocity.velocityX = dashState.velocityX * dashSpeed;
      dashFrameVelocity.velocityY = dashState.velocityY * dashSpeed;
      dashVelocityThisFrame = dashFrameVelocity;

      // Spawn afterimage ghosts every 30ms during dash
      this.dashAfterimageTimer += deltaSeconds;
      if (this.dashAfterimageTimer >= 0.03) {
        this.dashAfterimageTimer = 0;
        this.spawnDashAfterimage(Transform.x[this.playerId], Transform.y[this.playerId]);
      }
    } else {
      this.dashAfterimageTimer = 0;
    }

    // Update touch dash cooldown display
    this.hudManager.updateDashCooldown(
      dashState.cooldownRemaining,
      this.blinkDriveOwned() ? this.blinkCooldownSeconds() : this.playerStats.dashCooldown,
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

    // ═══ DESTRUCTIBLE SPAWNING (barrels/crates) ═══
    if (this.playerId !== -1 && this.destructibleCount < GameScene.MAX_DESTRUCTIBLES) {
      this.destructibleSpawnTimer -= deltaSeconds;
      if (this.destructibleSpawnTimer <= 0) {
        // Only reset the full interval on a successful spawn; a player-proximity
        // skip retries shortly instead of wasting the whole interval.
        this.destructibleSpawnTimer = this.spawnDestructible() ? GameScene.DESTRUCTIBLE_INTERVAL : 1.5;
      }
    }

    // ═══ FIELD SHRINES ═══
    if (this.playerId !== -1) {
      this.shrineManager.update(deltaSeconds, Transform.x[this.playerId], Transform.y[this.playerId]);
    }

    // ═══ EXPEDITION: ABILITY VAULTS AND THE DOORS THEY OPEN ═══
    this.updateExpeditionAbilities(deltaSeconds);

    // ═══ IN-RUN BOUNTIES ═══
    this.updateBounties(deltaSeconds);

    // ═══ TIMED STAT BUFFS (Power shrine / Power Surge / Elite Surge / Golden Tide) ═══
    this.updateTimedStatBuffs();

    // ═══ DYNAMIC MUSIC INTENSITY ═══
    updateMusicIntensity(deltaSeconds, {
      comboCount: getComboCount(),
      enemyCount: this.enemyCount,
      hpFraction: this.playerId !== -1 && Health.max[this.playerId] > 0
        ? Health.current[this.playerId] / Health.max[this.playerId]
        : 1,
      bossActive: this.bossFightDirector.isBossActive(),
    });

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

    // GAUNTLET replaces the stage's timed miniboss/boss schedule with its own
    // wave loop; the schedule checks below would double-spawn on top of it.
    if (this.gauntletModeActive) {
      this.gauntletDirector.update(deltaSeconds);
    } else {
      // Check for miniboss spawns
      this.checkMinibossSpawns();
      this.checkNemesisSpawn();

      // Update boss warning sequence
      this.updateBossWarning(deltaSeconds);

      // Check for boss spawn
      this.bossFightDirector.checkTimedSpawn();

      // Check for endless mode spawns (post-victory)
      if (this.endlessDirector.isActive()) {
        this.endlessDirector.update(deltaSeconds);
      }
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
        this.worldMode.viewRect(),
        this.hazardSpawnLegality
      );
    }

    // Spawn boss-specific hazard zones during boss fights
    this.bossFightDirector.updateHazardCadence(deltaSeconds);

    // Suppress events during boss warning phase 2+
    setSuppressEvents(this.bossFightDirector.getWarningPhase() >= 2);

    // Advance director credit budget (used by spawnEnemy to pick enemy types)
    updateDirector(this.gameTime, this.worldLevel);

    // Update event system and handle triggered events
    const triggeredEvent = updateEventSystem(deltaSeconds, this.gameTime);
    if (triggeredEvent) {
      this.handleRunEvent(triggeredEvent);
    }
    this.hudManager.updateEventIndicator(getActiveEvent()?.event ?? null);

    // Update laser beams
    this.enemyProjectileManager.updateLasers(deltaSeconds);

    // Update input state (joystick, keyboard, mouse, gamepad sync)
    const inputState = this.inputController.update();

    // Update touch button visibility based on control mode
    this.hudManager.updateTouchButtonVisibility(inputState.controlMode);
    this.hudManager.updateControlsHint(inputState.controlMode);

    // Run ECS systems
    this.updatePlayerEffectiveMoveSpeed();
    // A region's drift rides the same product the Quick Start upgrade does, so a player who
    // bought acceleration flies out of the slippery region's grip rather than being taxed twice.
    inputSystem(this.world, inputState, deltaSeconds,
      this.playerStats.accelerationMultiplier * this.activeStageDriftFactor,
      dashVelocityThisFrame);
    updateAIGameTime(this.gameTime);
    enemyAISystem(this.world, deltaSeconds);

    // Update attack telegraphs (spawned by enemy AI windups above)
    this.telegraphManager.update(deltaSeconds);

    // Detonate armed Exploder death fuses (BALANCE-EXPLODER-FUSE). Ticked here
    // — NOT via delayedCall — so fuses freeze with the pause/game-over/victory
    // early-returns above (a blast can never land during a menu or after the
    // run ends) and share deltaSeconds' slow-time scaling with the telegraph
    // ring, keeping the warning honest.
    tickExploderFuses(this.exploderFuses, deltaSeconds, (fuseX, fuseY) =>
      this.handleExplosion(fuseX, fuseY, EXPLODER_BLAST_RADIUS, EXPLODER_BLAST_DAMAGE)
    );

    // Apply Warden slow aura to player velocity (computed inside enemyAISystem),
    // reduced by the player's slowResistance stat (slowResistLevel upgrade + Frost
    // Ward relic). At slowResistance 0 the resisted value equals wardenSlow exactly.
    if (this.playerId !== -1) {
      const wardenSlow = getWardenSlowMultiplier();
      if (wardenSlow < 1.0) {
        const resistedSlow = resolveSlowAfterResistance(wardenSlow, this.playerStats.slowResistance);
        if (resistedSlow < 1.0) {
          Velocity.x[this.playerId] *= resistedSlow;
          Velocity.y[this.playerId] *= resistedSlow;
        }
      }
    }

    // Apply ice hazard slow to enemies (deferred from updateHazardZones, after AI sets velocities)
    applyIceHazardSlow();

    // Wraith phase state drives two things: the sprite alpha, and whether the wraith is allowed
    // to be standing in rock (doc 02 section 5.3). The snap tests the state rather than a
    // transition on purpose: a wraith that is corporeal and inside geometry is wrong however it
    // got there, and retrying every frame costs one tile read and self-heals a knockback or a
    // door that closed on it.
    const wraithWorldMap = this.worldMode.worldMap();
    phaseBleedSeenTileKeys.clear();
    let phaseBleedCount = 0;
    const wraithCheckEnemies = getFrameCacheEnemyIds();
    for (const enemyId of wraithCheckEnemies) {
      if (EnemyAI.aiType[enemyId] !== EnemyAIType.Wraith) continue;
      const wraithSprite = getSprite(enemyId);
      if (wraithSprite) {
        wraithSprite.alpha = EnemyAI.state[enemyId] === 1 ? 0.2 : 1.0;
      }
      if (wraithWorldMap && EnemyAI.state[enemyId] === 1) {
        phaseBleedCount = collectPhaseBleedTiles(
          wraithWorldMap, Transform.x[enemyId], Transform.y[enemyId],
          ENEMY_COLLISION_RADIUS, phaseBleedSeenTileKeys, phaseBleedTiles, phaseBleedCount,
        );
      }
      if (!wraithWorldMap || EnemyAI.state[enemyId] !== 0) continue;
      const wraithX = Transform.x[enemyId];
      const wraithY = Transform.y[enemyId];
      if (!isSolidAtWorld(wraithWorldMap, wraithX, wraithY, MoverKind.Enemy)) continue;
      if (findNearestFreeCircleSpot(
        wraithWorldMap, wraithX, wraithY, ENEMY_COLLISION_RADIUS, wraithSnapSpot,
      )) {
        Transform.x[enemyId] = wraithSnapSpot.x;
        Transform.y[enemyId] = wraithSnapSpot.y;
      } else {
        // Nowhere legal to put it, which means it is outside the generated world. Send it back
        // through the wall it came from rather than freezing it there: it chases the player, so
        // the next phase walks it home.
        EnemyAI.state[enemyId] = 1;
        EnemyAI.timer[enemyId] = 0;
      }
    }

    // Expedition-only without a mode branch: arena's worldMap() is null, so an arena run
    // never allocates the layer and never draws.
    if (wraithWorldMap) {
      if (!this.phaseBleedRenderer) this.phaseBleedRenderer = new PhaseBleedRenderer(this);
      const pulse = getSettingsManager().isReducedMotionEnabled()
        ? 1
        : 0.5 + 0.5 * Math.sin(this.time.now * PHASE_BLEED_PULSE_RATE);
      this.phaseBleedRenderer.draw(phaseBleedTiles, phaseBleedCount, pulse);
    }

    movementSystem(this.world, deltaSeconds, this.syncPlayerWallCollision());

    // Process knockback for enemies
    this.processKnockback(deltaSeconds);
    this.processPlayerKnockback(deltaSeconds);

    // Keep player on screen
    if (this.playerId !== -1) {
      clampPlayerToRect(this.world, this.playerId, this.worldMode.fieldRect());
    }

    // Weapon system (handles all player weapons)
    this.weaponManager.update(this.gameTime, deltaSeconds, this.worldMode.viewRect(), this.worldMode.worldMap());

    // XP gem system (with viewport culling)
    xpGemSystem(this.world, deltaSeconds, this.worldMode.viewRect());

    // Health pickup system
    healthPickupSystem(this.world, deltaSeconds, this.gameTime);

    // Magnet pickup system
    magnetPickupSystem(this.world, deltaSeconds, this.gameTime);

    // Floor consumable system (bomb/freeze/vacuum/gold)
    consumablePickupSystem(this.world, deltaSeconds, this.gameTime);

    // Status effect system (burn, freeze, poison damage over time)
    statusEffectSystem(this.world, delta);

    // Update enemy projectiles
    this.enemyProjectileManager.update(deltaSeconds);

    // Check player-enemy collision for damage
    this.checkPlayerEnemyCollision();

    // Sync sprites to ECS positions
    spriteSystem(this.world, this.worldMode.viewRect());

    // Update player spaceship visual effects (squash/stretch, fins, breathing)
    if (this.playerId !== -1 && this.playerSpaceship) {
      this.playerSpaceship.setComboTier(getComboTier());
      this.playerSpaceship.update(
        Velocity.x[this.playerId],
        Velocity.y[this.playerId],
        deltaSeconds
      );
    }

    // Update parallax depth layers (behind grid) from player position
    if (this.parallaxBackground && this.playerId !== -1) {
      this.parallaxBackground.update(deltaSeconds, Transform.x[this.playerId], Transform.y[this.playerId]);
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
    this.eliteAffixVisualManager.update(deltaSeconds);

    // Update off-screen threat indicators
    this.offScreenIndicatorManager.update(deltaSeconds);

    this.minimapFeed.update(deltaSeconds);

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

    // The Legion renders ONE summed bar for the whole split tree, anchored to
    // the root's entity id — which may already be dead. Overwrite that entry
    // with the remaining pool (living HP + unspawned descendants' HP).
    forEachLegionGroup((anchorId, members) => {
      let remainingPool = 0;
      let totalPool = 0;
      for (const [memberId, generation] of members) {
        const memberMax = Health.max[memberId];
        remainingPool += Health.current[memberId] + legionPotentialMultiplier(generation) * memberMax;
        totalPool = Math.max(totalPool, legionPoolFromMember(generation, memberMax));
      }
      for (let payloadIndex = 0; payloadIndex < bossHealthPayload.length; payloadIndex++) {
        if (bossHealthPayload[payloadIndex].entityId === anchorId) {
          bossHealthPayload[payloadIndex].currentHP = remainingPool;
          bossHealthPayload[payloadIndex].maxHP = totalPool;
        }
      }
    });

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
      ultimateChargeRatio: getUltimateChargeRatio(),
      ultimateReady: isUltimateReady(),
      bossHealthData: bossHealthPayload,
      runGoldMultiplier: this.playerStats.goldMultiplier,
      timedBuffRows: buildTimedBuffRows(this.timedStatBuffs, this.gameTime, this.timedBuffPeakSeconds),
    });

    // One-time teach on the rising edge: the first time the ultimate charges,
    // tell the player which key/button fires it (a brand-new control).
    const ultimateReadyNow = isUltimateReady();
    if (ultimateReadyNow && !this.ultimateWasReady && !this.isGameOver && this.toastManager
        && getTutorialHintManager().maybeShow('ultimate-ready')) {
      const ultHint = getTutorialHintDef('ultimate-ready');
      const isTouchDevice = this.input.manager.touch !== null && this.sys.game.device.input.touch;
      this.toastManager.showToast({
        tier: 'critical',
        title: ultHint.title,
        description: getHintDescription(ultHint, isTouchDevice),
        icon: ultHint.icon,
        color: ultHint.color,
        duration: ultHint.duration,
      });
    }
    this.ultimateWasReady = ultimateReadyNow;
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
      // Destructibles (barrels/crates) deal no contact damage.
      if (hasComponent(this.world, Destructible, enemyId)) {
        continue;
      }
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
        // Vampiric elites heal a chunk when they land a hit on the player;
        // fraction shrinks by tier (boss 5% / miniboss 10% / trash 20%).
        if (hasComponent(this.world, EnemyAffix, enemyId)
          && (EnemyAffix.affixType[enemyId] === EnemyAffixType.VAMPIRIC
            || EnemyAffix.affixType2[enemyId] === EnemyAffixType.VAMPIRIC)) {
          const healFraction = vampiricHealFraction(EnemyType.xpValue[enemyId]);
          Health.current[enemyId] = Math.min(Health.max[enemyId], Health.current[enemyId] + Health.max[enemyId] * healFraction);
        }
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
    const field = this.worldMode.fieldRect();
    const worldMap = this.worldMode.worldMap();

    for (const entityId of entities) {
      const velocityX = Knockback.velocityX[entityId];
      const velocityY = Knockback.velocityY[entityId];

      // Apply knockback to position
      const nextX = Transform.x[entityId] + velocityX * deltaSeconds;
      const nextY = Transform.y[entityId] + velocityY * deltaSeconds;

      if (worldMap && EnemyAI.aiType[entityId] < BOSS_KNOCKBACK_AI_TYPE_FLOOR
        && !isPhasedWraith(entityId)) {
        resolveCircleMove(
          worldMap, Transform.x[entityId], Transform.y[entityId], nextX, nextY,
          ENEMY_COLLISION_RADIUS, MoverKind.Enemy, knockbackCollisionResult,
        );
        Transform.x[entityId] = knockbackCollisionResult.x;
        Transform.y[entityId] = knockbackCollisionResult.y;
        if (knockbackCollisionResult.hitX) Knockback.velocityX[entityId] = 0;
        if (knockbackCollisionResult.hitY) Knockback.velocityY[entityId] = 0;
      } else {
        Transform.x[entityId] = nextX;
        Transform.y[entityId] = nextY;
      }

      // Clamp to the playfield so enemies can't be knocked out of bounds
      Transform.x[entityId] = Math.max(field.minX, Math.min(field.maxX, Transform.x[entityId]));
      Transform.y[entityId] = Math.max(field.minY, Math.min(field.maxY, Transform.y[entityId]));

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
   * Cancels an in-flight shove. Called from every deliberate player relocation: a
   * teleport that still drags the ship for a beat afterwards reads as the ability
   * having failed.
   */
  private clearPlayerKnockback(): void {
    Knockback.velocityX[this.playerId] = 0;
    Knockback.velocityY[this.playerId] = 0;
  }

  /**
   * Player half of processKnockback. Separate because the enemy loop's query requires
   * EnemyTag and its body is enemy-shaped (enemy radius, enemy mover kind, the boss and
   * phased-Wraith exemptions), none of which apply to the ship.
   */
  private processPlayerKnockback(deltaSeconds: number): void {
    if (this.playerId === -1) return;

    const velocityX = Knockback.velocityX[this.playerId];
    const velocityY = Knockback.velocityY[this.playerId];
    if (velocityX === 0 && velocityY === 0) return;

    const nextX = Transform.x[this.playerId] + velocityX * deltaSeconds;
    const nextY = Transform.y[this.playerId] + velocityY * deltaSeconds;
    const worldMap = this.worldMode.worldMap();

    if (worldMap) {
      resolveCircleMove(
        worldMap, Transform.x[this.playerId], Transform.y[this.playerId], nextX, nextY,
        PLAYER_COLLISION_RADIUS, MoverKind.Player, knockbackCollisionResult,
      );
      Transform.x[this.playerId] = knockbackCollisionResult.x;
      Transform.y[this.playerId] = knockbackCollisionResult.y;
      if (knockbackCollisionResult.hitX) Knockback.velocityX[this.playerId] = 0;
      if (knockbackCollisionResult.hitY) Knockback.velocityY[this.playerId] = 0;
    } else {
      Transform.x[this.playerId] = nextX;
      Transform.y[this.playerId] = nextY;
    }

    const decayFactor = Math.pow(0.001, deltaSeconds);
    Knockback.velocityX[this.playerId] *= decayFactor;
    Knockback.velocityY[this.playerId] *= decayFactor;
    if (Math.abs(Knockback.velocityX[this.playerId]) < 1) {
      Knockback.velocityX[this.playerId] = 0;
    }
    if (Math.abs(Knockback.velocityY[this.playerId]) < 1) {
      Knockback.velocityY[this.playerId] = 0;
    }
  }

  /** The expedition's two unstated rules, taught on the rail that already teaches the arena.
   *  Both fire at most once per install through the shared hint store, so a player who knows
   *  the chart is never told about it twice and never told about it during a restore. */
  private maybeShowExpeditionCrossingHint(): void {
    if (!this.toastManager || this.isGameOver) return;
    const hintManager = getTutorialHintManager();
    const hintId = expeditionCrossingHintId({
      chartedSectorsAtRunStart: this.chartedSectorsAtRunStart,
      chartHintSeen: hintManager.hasSeen('expedition-chart'),
    });
    if (!hintId || !hintManager.maybeShow(hintId)) return;
    const def = getTutorialHintDef(hintId);
    const isTouchDevice = this.input.manager.touch !== null && this.sys.game.device.input.touch;
    this.toastManager.showToast({
      tier: 'critical',
      title: def.title,
      description: getHintDescription(def, isTouchDevice),
      icon: def.icon,
      color: def.color,
      duration: def.duration,
    });
  }

  /**
   * One-time dash tutorial hint, fired the first time real damage lands while
   * dash sits ready. Defers while dash is cooling down (the hit that finally
   * lands with dash available teaches the lesson); dismisses silently once the
   * player dashes on their own.
   */
  private maybeShowDashHint(): void {
    const hintManager = getTutorialHintManager();
    if (hintManager.hasSeen('dash-danger')) return;

    const outcome = evaluateDashDangerHint({
      dashReady: this.inputController.getDashCooldownRemaining() <= 0,
      hasDashedThisRun: this.hasDashedThisRun,
    });
    if (outcome === 'dismiss') {
      hintManager.markSeen('dash-danger');
    } else if (outcome === 'show' && hintManager.maybeShow('dash-danger')) {
      const def = getTutorialHintDef('dash-danger');
      const isTouchDevice = this.input.manager.touch !== null && this.sys.game.device.input.touch;
      this.toastManager.showToast({
        tier: 'critical',
        title: def.title,
        description: getHintDescription(def, isTouchDevice),
        icon: def.icon,
        color: def.color,
        duration: def.duration,
      });
    }
  }

  /**
   * Buckets a landed hit by what dealt it. Only ever reached after every
   * avoidance branch in takeDamage, so a blocked / dashed / dodged / phased hit
   * is never attributed and the buckets always sum to `totalDamageTaken`.
   * Returns the bucket it wrote so the caller can name the killing blow without
   * re-deriving the label.
   */
  private recordDamageTakenSource(
    attackerEntity: number | undefined,
    sourceLabel: string | undefined,
    damage: number,
  ): string | null {
    if (!(damage > 0)) return null;

    let bucketName = sourceLabel;
    if (bucketName === undefined && attackerEntity !== undefined) {
      const enemyTypeId = this.enemyTypeMap.get(attackerEntity);
      bucketName = (enemyTypeId ? getEnemyType(enemyTypeId)?.name : undefined) ?? 'Unknown';
    }
    if (bucketName === undefined) bucketName = 'Unknown';

    this.damageTakenBySource.set(
      bucketName,
      (this.damageTakenBySource.get(bucketName) ?? 0) + damage,
    );

    return bucketName;
  }

  private getDamageTakenBySource(): DamageSourceTally[] {
    const tallies: DamageSourceTally[] = [];
    this.damageTakenBySource.forEach((totalDamage, sourceName) => {
      tallies.push({ sourceName, totalDamage });
    });
    return tallies;
  }

  private recordRunTimelineEvent(kind: RunTimelineEventKind): void {
    if (this.runTimelineEvents.length >= RUN_TIMELINE_EVENT_CAP) return;
    this.runTimelineEvents.push({ kind, atSeconds: this.gameTime });
  }

  /**
   * Logs one close call per dip into the bottom quarter of the health bar. The
   * re-arm at 40% is what stops a long fight held at low HP from logging a marker
   * every frame. Reads ECS Health directly: playerStats.currentHealth is a
   * write-through mirror.
   */
  private updateCloseCallWatch(): void {
    if (this.playerId === -1) return;
    const maxHealth = Health.max[this.playerId];
    if (!(maxHealth > 0)) return;

    const healthPercent = Health.current[this.playerId] / maxHealth;
    if (healthPercent <= 0.25) {
      if (this.closeCallArmed) {
        this.closeCallArmed = false;
        this.recordRunTimelineEvent('closeCall');
      }
    } else if (healthPercent > 0.4) {
      this.closeCallArmed = true;
    }
  }

  /**
   * The boss-tier enemy a REMATCH would re-field. Prefers whatever landed the lethal
   * hit; falls back to any boss-tier enemy still on the field, because the boss
   * attacks that kill most often (Ground Slam / Laser Beam / Enemy Fire) carry a
   * label rather than an attacker entity.
   */
  private resolveRematchTarget(attackerEntity: number | undefined): RematchTarget | null {
    const fromAttacker = this.describeRematchTarget(attackerEntity);
    if (fromAttacker) return fromAttacker;
    for (const bossEntityId of this.hudManager?.getBossEntityIds() ?? []) {
      const fromField = this.describeRematchTarget(bossEntityId);
      if (fromField) return fromField;
    }
    return null;
  }

  private describeRematchTarget(entityId: number | undefined): RematchTarget | null {
    if (entityId === undefined) return null;
    const targetId = toPracticeTargetId(this.enemyTypeMap.get(entityId));
    if (!targetId) return null;
    const affixesApply = targetId !== 'the_legion';
    return {
      targetId,
      affix: affixesApply ? EnemyAffix.affixType[entityId] as EnemyAffixType : EnemyAffixType.NONE,
      affix2: affixesApply ? EnemyAffix.affixType2[entityId] as EnemyAffixType : EnemyAffixType.NONE,
    };
  }

  /**
   * The run's stat investment expressed as the flat per-stat level PRACTICE uses.
   * A real build is uneven, but BREAK_LEVEL_GATES makes only an even spread
   * reachable (see PracticeBuild.ts), so the mean is the gate-legal projection.
   */
  private computeRematchBuildDepth(): number {
    const statUpgrades = this.upgrades.filter((upgrade) => upgrade.isStatUpgrade);
    if (statUpgrades.length === 0) return 0;
    const totalLevels = statUpgrades.reduce((sum, upgrade) => sum + upgrade.currentLevel, 0);
    return Math.min(10, Math.round(totalLevels / statUpgrades.length));
  }

  private buildRematchSeed(): PracticeRematchSeed | null {
    if (this.practiceModeActive || !this.rematchTarget) return null;
    const loadout = (this.weaponManager?.getAllWeapons() ?? []).map((weapon) => ({
      weaponId: weapon.id,
      level: weapon.getLevel(),
      evolved: weapon.isEvolved,
    }));
    if (loadout.length === 0) return null;
    return { target: this.rematchTarget, buildDepth: this.computeRematchBuildDepth(), loadout };
  }

  /**
   * Applies damage to the player with full defensive stat calculations.
   * @param amount Base damage amount
   * @param attackerEntity Optional entity ID for thorns damage; also names the
   *   threat bucket when no explicit label is given
   * @param sourceLabel Threat bucket for attacks that have no attacker entity
   *   (explosions, enemy fire, boss slams and lasers)
   */
  private takeDamage(amount: number, attackerEntity?: number, sourceLabel?: string): void {
    // Ahead of the shield branch on purpose: a practice invincibility that burned
    // shield charges would quietly change the build being judged.
    if (this.practiceInvincible) return;

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

    // A flawless bounty fails the moment real damage lands.
    if (this.bounty?.kind === 'flawless') {
      this.bountyFlawlessBroken = true;
    }

    // Same line the flawless bounty breaks on, and for the same reason: a blocked, dodged,
    // phased or fully shielded hit is not a hit, so it must not break the channel either.
    if (this.recallChannelRemaining > 0) {
      this.cancelExpeditionRecall('A hit broke the recall lock.');
    }

    // Track damage for Health-Adaptive auto-upgrade intelligence (tier 3)
    this.recentDamageTaken += reducedDamage;
    this.isHealthStruggling = this.recentDamageTaken > this.playerStats.maxHealth * 0.5;

    // Track damage taken for achievements (perfect run tracking)
    this.totalDamageTaken += reducedDamage;
    const damageBucketName = this.recordDamageTakenSource(attackerEntity, sourceLabel, reducedDamage);
    const remainingHpPercent = this.playerStats.currentHealth / this.playerStats.maxHealth;
    getAchievementManager().recordDamageTaken(reducedDamage, remainingHpPercent);

    // Use iframeDuration from playerStats instead of hardcoded value
    this.damageCooldown = this.playerStats.iframeDuration;

    // Guardian (reactive weapon): retaliate with a nova scaled by the hit taken.
    // Its Bulwark mastery returns bonus i-frames — extend the cooldown, don't shorten.
    const guardianInvuln = this.weaponManager.notifyPlayerDamaged(reducedDamage);
    if (guardianInvuln > this.damageCooldown) {
      this.damageCooldown = guardianInvuln;
    }

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

    this.maybeShowDashHint();

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
      // Past the revival branch on purpose: a hit the player was revived from
      // never claims the kill.
      this.killedBySourceName = damageBucketName ?? 'Unknown';
      // Only a contact/attacker-bound hit names a type; the four attacker-less
      // buckets (Explosion / Enemy Fire / Ground Slam / Laser Beam) leave this null
      // and therefore leave any standing nemesis untouched.
      this.pendingNemesisTypeId = attackerEntity !== undefined
        ? this.enemyTypeMap.get(attackerEntity) ?? null
        : null;
      this.rematchTarget = this.resolveRematchTarget(attackerEntity);
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
    // Spawn at a random spot in the view, clear of the edges.
    const { x, y } = pickInteriorPoint(this.worldMode.viewRect(), 80, Math.random);

    const isSpecial = Math.random() < SPECIAL_CHEST_CHANCE;

    this.addTreasureChest(x, y, isSpecial);
  }

  /**
   * Builds a treasure chest's graphics + timers at a fixed position and registers
   * it in activeChests. Shared by fresh spawns (spawnTreasureChest) and refresh-
   * restore (restoreGameState) so both paths produce an identical collectable
   * chest. When collected (player gets close) it spawns XP gems and may drop a
   * relic; uncollected it auto-despawns after 30s. Tracking in activeChests lets
   * the chest survive refresh-recovery (mirrors addShrine).
   *
   * A POI cache is a placed map reward, so it keeps neither the 30s despawn (which would
   * delete a reward the player is fighting his way toward) nor the chest-drone magnet
   * (which would drag every cache in the world at the player, through walls).
   */
  private addTreasureChest(x: number, y: number, isSpecial: boolean, isPoiCache = false): ActiveChestRecord {
    // Create visual chest using Graphics for detailed drawing
    const chestGraphics = this.add.graphics();
    chestGraphics.setPosition(x, y);
    this.drawTreasureChest(chestGraphics);
    chestGraphics.setDepth(5);

    // Register for persistence (saved by position + special flag) and teardown.
    const chestRecord: ActiveChestRecord = { graphics: chestGraphics, isSpecial, isPoiCache };
    this.activeChests.push(chestRecord);

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
    if (!isPoiCache && this.playerStats.chestDroneDelay >= 0) {
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
          // A drop opens a 1-of-3 relic draft; with slots full it becomes a
          // reinforce round, and only a fully capped inventory falls through to
          // the XP gems already spawned above.
          const shouldDropRelic = isSpecial || Math.random() < 0.35;
          if (shouldDropRelic) {
            this.grantRelicChoice(1);
          }

          // Clean up
          cleanup();
        }
      },
      loop: true,
    });

    // Destroys the chest's timers + graphics and unregisters it from
    // activeChests. Shared by the collect and auto-despawn paths; idempotent
    // (a second call no-ops since indexOf returns -1 and destroy() is guarded).
    const cleanup = () => {
      pulseTimer.destroy();
      collectCheck.destroy();
      if (magnetTimer) magnetTimer.destroy();
      const chestIndex = this.activeChests.indexOf(chestRecord);
      if (chestIndex !== -1) this.activeChests.splice(chestIndex, 1);
      chestGraphics.destroy();
    };

    // Auto-despawn after 30 seconds if not collected
    if (!isPoiCache) {
      this.time.delayedCall(30000, () => {
        if (chestGraphics.active) cleanup();
      });
    }

    chestRecord.cleanup = cleanup;
    return chestRecord;
  }

  /**
   * Leave a practice session by reloading the page.
   *
   * Practice blocks storage *writes*, but the managers still mutated in memory
   * (a max-level weapon trips achievements and hidden unlocks). Returning to the
   * menu in-process would leave that polluted state to be flushed to disk by the
   * next real run's first write. A reload drops it and re-reads clean state.
   */
  private exitPracticeSession(): void {
    setPracticeSession(false);
    window.location.reload();
  }

  private startRematchPractice(): void {
    const seed = this.pendingRematchLaunch;
    if (!seed) return;
    setPracticeSession(true);
    this.scene.restart({
      practiceMode: true,
      practiceRematch: seed,
      startingWeapon: seed.loadout[0].weaponId,
      shipId: this.selectedShipId,
      stageId: this.selectedStageId,
      modifierIds: this.activeModifiers.map((modifier) => modifier.id),
    });
  }

  private spawnPracticeTarget(state: PracticeDockState): void {
    if (!this.practiceModeActive) return;
    if (this.isPaused || this.isGameOver || this.introOverlayActive) return;
    this.practiceSpawnAffix = state.affix;
    this.practiceSpawnAffix2 = state.affix2;
    this.practiceFightSpawning = true;
    try {
      if (isPracticeMinibossTarget(state.targetId)) {
        this.spawnMiniboss(state.targetId);
      } else {
        this.spawnBoss(state.targetId);
      }
    } finally {
      this.practiceFightSpawning = false;
    }
    this.startPracticeFight(state);
  }

  /**
   * A spawn on top of a live fight does not restart the clock — both enemies share
   * the kill, so the time stops being comparable and the fight is marked instead.
   */
  private startPracticeFight(state: PracticeDockState): void {
    const fight = this.practiceFight;
    if (fight) {
      fight.dirty = true;
      return;
    }
    this.practiceFight = {
      key: practiceBestKey(state.targetId, state.affix, state.affix2, this.practiceBuildDepth),
      startTime: this.gameTime,
      live: false,
      dirty: false,
    };
  }

  /**
   * The fight ends the frame nothing boss-tier is left alive. `live` exists because
   * the spawn and the entity are not the same frame — without it an empty first
   * frame would resolve the fight instantly.
   */
  private updatePracticeFightClock(): void {
    const fight = this.practiceFight;
    if (!fight) return;

    let bossTierAlive = 0;
    for (const enemyId of getFrameCacheEnemyIds()) {
      if (EnemyType.xpValue[enemyId] >= PRACTICE_FIGHT_XP_FLOOR) bossTierAlive++;
    }

    if (!fight.live) {
      if (bossTierAlive > 0) fight.live = true;
      return;
    }
    if (bossTierAlive > 0) return;

    this.practiceFight = null;
    this.resolvePracticeFight(fight);
  }

  private resolvePracticeFight(fight: PracticeFightState): void {
    const elapsedMs = Math.max(0, (this.gameTime - fight.startTime) * 1000);
    const timeText = formatFightTime(elapsedMs);

    if (fight.dirty) {
      this.toastManager.showToast({
        tier: 'critical',
        title: `FIGHT ${timeText}`,
        description: 'Other spawns joined this fight — not recorded.',
        icon: 'target',
        color: 0x8899aa,
        duration: 3000,
      });
      return;
    }

    const previous = getPracticeBest(fight.key);
    const isNewBest = savePracticeBestIfFaster(fight.key, {
      ms: elapsedMs,
      shipId: this.selectedShipId,
      weaponId: this.startingWeaponId,
      weaponLevel: this.practiceWeaponLevel,
      evolved: this.practiceEvolved,
    });

    let description: string;
    if (!previous) {
      description = 'First clear of this fight.';
    } else {
      const weaponName =
        getWeaponInfoList().find((info) => info.id === previous.weaponId)?.name ?? previous.weaponId;
      const shipName = getShipById(previous.shipId)?.name ?? previous.shipId;
      description =
        `Best ${formatFightTime(previous.ms)} — ${shipName} · ${weaponName} L${previous.weaponLevel}` +
        (previous.evolved ? '+' : '');
    }

    this.toastManager.showToast({
      tier: 'critical',
      title: isNewBest ? `NEW BEST ${timeText}` : `FIGHT ${timeText}`,
      description,
      icon: 'target',
      color: isNewBest ? 0xffd24a : 0xbbddff,
      duration: 4000,
    });
  }

  /**
   * Field the passive build a real run would have by this point. Monotonic:
   * upgrade.apply is additive, so a build can be raised but never rolled back —
   * the same way a real run's build only grows. Reload to start over.
   */
  private applyPracticeBuild(depth: number): void {
    if (!this.practiceModeActive || depth <= this.practiceBuildDepth) return;

    const statUpgrades = this.upgrades.filter((upgrade) => upgrade.isStatUpgrade);
    for (const upgrade of statUpgrades) {
      const target = Math.min(depth, upgrade.maxLevel);
      for (let level = upgrade.currentLevel + 1; level <= target; level++) {
        upgrade.apply(this.playerStats, level);
      }
      upgrade.currentLevel = Math.max(upgrade.currentLevel, target);
    }
    this.practiceBuildDepth = depth;

    // Without a matching level the XP threshold stays at 10 while a boss drops
    // 1000+, cascading dozens of level-up modals over the fight being measured.
    const playerLevel = practiceBuildPlayerLevel(depth, statUpgrades.length);
    this.playerStats.level = playerLevel;
    this.playerStats.xp = 0;
    this.playerStats.xpToNextLevel = calculateXPForLevel(playerLevel);
    this.playerSpaceship?.onLevelUp(playerLevel);

    this.syncStatsToPlayer();

    // A build is a chassis configuration, not a damage event: syncStatsToPlayer
    // only clamps current HP downward, so vitality's new headroom starts empty.
    Health.current[this.playerId] = Health.max[this.playerId];
    this.playerStats.currentHealth = Health.current[this.playerId];
  }

  /**
   * Field the arena a real run would have at this depth. Monotonic like the build
   * ladder: the clock and the cycle only move forward, since neither a spawned wave
   * nor a compounded escalation can be taken back. Reload to start over.
   */
  private applyPracticeArena(rung: PracticeArenaRung): void {
    if (!this.practiceModeActive) return;
    if (rung.gameTime <= this.gameTime && rung.endlessCycle <= this.endlessDirector.getCycle()) return;

    if (rung.gameTime > this.gameTime) {
      this.gameTime = rung.gameTime;

      // The jump lands past scheduled spawn times the run never played through;
      // without this every skipped miniboss and the boss all fire on the next
      // update, burying the target the dock is there to spawn on demand.
      for (const minibossEntry of this.minibossSpawnTimes) {
        if (minibossEntry.time <= this.gameTime) minibossEntry.spawned = true;
      }
      this.bossFightDirector.skipTimedSpawnIfDue();
    }

    this.endlessDirector.applyPracticeRung(rung.endlessCycle);
  }

  /**
   * Pin the endless mutator the operator wants to judge. Freely reversible: the
   * mutator is only read at spawn time, so flipping it changes the next spawn and
   * nothing already on the field.
   */
  private setPracticeMutator(mutator: EndlessMutatorType): void {
    if (!this.practiceModeActive) return;
    this.endlessDirector.setMutator(mutator);
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
          this.bloomPipeline.setBloomStrength(isPaused ? 0 : this.comboBloomStrength());
        }
      },
      onRestart: () => {
        if (this.practiceModeActive) { this.exitPracticeSession(); return; }
        this.scene.restart();
      },
      onRematch: () => {
        this.startRematchPractice();
      },
      onQuitToMenu: () => {
        if (this.practiceModeActive) { this.exitPracticeSession(); return; }
        this.scene.start('BootScene');
      },
      onQuitToShop: () => {
        if (this.practiceModeActive) { this.exitPracticeSession(); return; }
        this.scene.start('ShopScene');
      },
      onRecordRunEnd: (goldEarned: number) => this.recordEarlyRunEnd(goldEarned),
      hasWorldMap: () => this.worldMode.worldMap() !== null,
      // The row's onActivate hides the menu first, so isPaused is already false and
      // openExpeditionMap's guard passes; MapScene then re-pauses the scene itself.
      onOpenMap: () => this.openExpeditionMap(),
      onOpenSettings: () => {
        this.isPaused = true; // Keep paused while in settings
        this.scene.launch('SettingsScene', { returnTo: 'GameScene' });
        this.scene.pause();
      },
      onContinueRun: () => {
        // Enable endless mode spawning
        this.endlessDirector.activateForContinue();
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
        weaponStats: this.weaponManager?.getWeaponRunStats() ?? [],
        totalDamageTaken: this.totalDamageTaken,
        damageBySource: this.getDamageTakenBySource(),
        activeSynergies: this.weaponManager?.getActiveSynergies() ?? [],
        totalDamageDealt: this.totalDamageDealt,
        highestCombo: getHighestCombo(),
        practiceModeActive: this.practiceModeActive,
        runGoldMultiplier: this.playerStats.goldMultiplier,
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
   * Called by SettingsScene when the UI-scale setting changed mid-run.
   * HUD, minimap, and touch-control sizes are baked at creation, so the
   * change can't be applied in place — round-trip the proven save-restore
   * path instead: persist the run, restart the scene, and restore at the
   * new scale, coming back up inside the pause menu the player left.
   */
  public applyUiScaleChange(): void {
    if (this.isGameOver) return;
    this.saveGameState();
    this.scene.restart({ restore: true, resumePaused: true });
  }

  /**
   * Device orientation flipped (main.ts watcher swapped the base game size).
   * The live resize path repositions HUD anchors, but creation-baked sizes
   * and layout groupings are only fully consistent after a rebuild — reuse
   * the UI-scale save-restore round trip, which also resumes into the pause
   * menu (the player is mid-rotation; silently continuing combat would be
   * hostile).
   */
  public handleOrientationFlip(): void {
    // End screens are run-over states: the death path has no save to
    // round-trip and the victory path already CLEARED the save — restarting
    // with restore would resurrect a finished run. Their overlays are
    // center-anchored, so a flip there is cosmetic only.
    if (this.isGameOver) return;
    if (this.hasWon && this.isPaused && !this.pauseMenuManager.isPauseMenuOpen) return;
    // Level-up modal or the quest board open: a GameScene restart underneath
    // would orphan it. Defer, since the HUD keeps itself anchored via the live
    // resize path meanwhile, and the closing handler (selection-complete, or
    // the board's onClose) settles the relayout once the last one closes.
    if (
      this.scene.isActive('UpgradeScene') ||
      this.scene.isActive('RelicDraftScene') ||
      this.scene.isActive('MarketScene') ||
      this.scene.isActive('QuestBoardScene')
    ) {
      this.pendingOrientationRelayout = true;
      return;
    }
    this.saveGameState();
    this.scene.restart({ restore: true, resumePaused: true });
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
  private runHistoryMode(): 'normal' | 'gauntlet' | 'daily' | 'endless' {
    if (this.dailyModeActive) return 'daily';
    if (this.gauntletModeActive) return 'gauntlet';
    if (this.endlessDirector.isActive()) return 'endless';
    return 'normal';
  }

  private runHistoryBuild() {
    return {
      startingWeapon: this.startingWeaponId,
      shipId: this.selectedShipId,
      stageId: this.selectedStageId,
      threatLevel: this.threatLevel,
      pactIds: this.activePacts.map((pact) => pact.id),
      mode: this.runHistoryMode(),
    };
  }

  /** The world's boss is dead, so this world is conquered: a permanent property of the WORLD
   *  (like a broken wall), not of the run, which is why it goes to the world profile and never
   *  to the save. Arena is inert by construction: worldMap() is null there. Written before
   *  showVictory so the run-end unlock pass sees the new count in the same frame.
   *  Returns null outside expedition, else whether this win was this world's FIRST conquest,
   *  which is what the victory kicker names. */
  private recordWorldConquered(): boolean | null {
    const map = this.worldMode.worldMap();
    if (!map) return null;
    // Read before the write: markWorldConquered also returns false when the profile SAVE
    // fails, which is a different fact from "this world was already conquered".
    const alreadyConquered = isWorldConquered(map.seed, map.worldGenVersion);
    if (markWorldConquered(map.seed, map.worldGenVersion)) {
      getAchievementManager().recordWorldConquered();
    }
    // Outside the markWorldConquered guard on purpose: the roster is about which guardian died,
    // not about which world. Re-conquering a world still fells its Warden, and a Warden already
    // on the roster is a no-op.
    const wardenBossTypeId = this.expeditionWardenBossTypeId();
    if (wardenBossTypeId) getAchievementManager().recordWardenFelled(wardenBossTypeId);
    // The Warden is dead whether or not the profile write landed, so the chain counts the kill
    // rather than the save. Raised as notices: showVictory is the caller's very next statement.
    this.recordExpeditionQuest({ kind: 'conquerWorld', firstConquest: !alreadyConquered }, true);
    return !alreadyConquered;
  }

  private showVictory(firstConquest: boolean | null): void {
    const runNoticeRows = this.collectRunNotices();
    // A conquest is a run end too, and it is the one most likely to set the record. Built here
    // rather than inline in the payload below because this is the run's ONE fold: the record is
    // a strictly-greater max, so a second call would return isNewBest false and lose the tell.
    const expeditionDebrief = this.buildExpeditionDebrief();
    recordThreatCleared(this.threatLevel);
    this.hasWon = true;
    this.isPaused = true;
    this.soundManager.playVictoryFanfare();

    // Clear saved game state (run is over - victory!)
    getGameStateManager().clearSave();

    // Record run end for achievements
    const metaManager = getMetaProgressionManager();

    // Bank this run's build for Memory (`upgradeKeepLevel`) to carry into the next
    // run. Recorded on both run-end paths — here and gameOver() — the same way
    // recordRunEnd is, because victories never flow through gameOver().
    metaManager.recordRunUpgrades(recordRunBuild(this.upgrades));
    const goldEarned = metaManager.calculateRunGold(
      this.killCount,
      this.gameTime,
      this.playerStats.level,
      true, // hasWon
      this.playerStats.goldMultiplier // ship/stage/pact/modifier gold bonuses
    );
    // Snapshot before the quest settle below pays into the wallet: the ledger must hold
    // only what the RUN itself moved (bounties, shrines, caches, market spends).
    // Parity with gameOver()'s snapshot — the victory payout itself is banked later, by
    // the NEXT WORLD handler, so it is never in here either.
    const runGoldLedger = metaManager.getRunLedger();
    // hasWon is already true above, so these facts carry wasVictory. Their worldLevel is
    // the ADVANCED one (the boss-kill site advanced it before calling here), which is what
    // the achievement, codex and unlock records on this path have always used;
    // scoreWorldLevel below sends the score-side records to the level actually played.
    const runFacts = this.buildRunFacts(goldEarned, metaManager.getCurrentStreak());
    const victoryWorldLevel = Math.max(1, metaManager.getWorldLevel() - 1);

    // Victory is unreachable in gauntlet and in practice (the boss-kill site guards on
    // both), and endless is only ever entered AFTER a victory, so all three are constants.
    const runOutcome = recordRunOutcome(runFacts, {
      practice: false,
      gauntlet: false,
      gauntletWave: 0,
      endless: false,
      endlessCycle: 0,
      daily: this.dailyModeActive && this.dailyDateString
        ? { challengeType: this.dailyChallengeType, dateString: this.dailyDateString }
        : null,
      paceSamples: this.paceRecordingEnabled ? this.paceSamples : null,
      shipId: this.selectedShipId,
      build: this.runHistoryBuild(),
      scoreWorldLevel: victoryWorldLevel,
    });
    // Never assign the flag directly — parity with gameOver().
    if (runOutcome.paceGhostReplaced) this.paceGhostReplaced = true;
    const {
      score: victoryScoreResult,
      grade: victoryGrade,
      priorRuns: victoryPriorRuns,
    } = runOutcome;

    // Armed before recordRunEnd so the achievements this win unlocks are captured for
    // the overlay; their toast is drawn under it.
    this.runEndAchievements = [];

    getAchievementManager().recordRunEnd(buildRunEndData(runFacts, {
      shipId: this.selectedShipId,
      stageId: this.selectedStageId,
    }));

    // Fold this run into today's quest board. Hooked at the exact recordRunEnd
    // sites so quest eligibility matches achievement eligibility 1:1 — practice
    // runs never reach here, gauntlet/daily runs do.
    const runEndQuests = settleDailyQuests(buildQuestRunData(runFacts));
    const runEndQuestGold = this.payDailyQuests(runEndQuests);

    recordCodexRunEnd(runFacts);

    // Capture streak before incrementing for display
    const previousStreak = metaManager.getCurrentStreak();
    // Increment win streak on victory
    metaManager.incrementStreak();
    const newStreak = metaManager.getCurrentStreak();

    // Evaluate hidden unlocks for the victory path. Done *after* incrementStreak()
    // so streak-based unlocks (e.g. Streak Flame) see the streak this win produced
    // rather than the pre-victory value.
    const newHiddenUnlocks = getHiddenUnlockManager().evaluatePostRun(
      buildUnlockContext(this.buildRunFacts(goldEarned, newStreak))
    );
    const runEarnings = buildRunEarnings({
      unlocks: newHiddenUnlocks,
      achievements: this.runEndAchievements ?? [],
      quests: runEndQuests,
    });

    // Get world level (already advanced before showVictory is called)
    const newWorldLevel = metaManager.getWorldLevel();
    const clearedWorld = newWorldLevel - 1;

    this.pauseMenuManager.showVictory({
      killCount: this.killCount,
      gameTime: this.gameTime,
      playerLevel: this.playerStats.level,
      goldEarned,
      goldLedger: runGoldLedger,
      questGold: runEndQuestGold,
      runEarnings,
      runNotices: runNoticeRows,
      clearedWorld,
      newWorldLevel,
      previousStreak,
      newStreak,
      streakBonusPercent: metaManager.getStreakBonusPercent(),
      trophyUnlockedName: this.trophyUnlockedThisRun ?? undefined,
      expedition: expeditionDebrief,
      expeditionConquest: firstConquest === null ? undefined : {
        seasonIndex: getCurrentExpeditionSeasonIndex(),
        completionPercent: getDiscoveryManager().getCompletionPercent(),
        firstConquest,
        worldsConqueredTotal: getAchievementManager().getLifetimeStats().worldsConqueredTotal,
      },
      performanceGrade: victoryGrade,
      // Reveal (and consume) the data-cache card here. A won run that continues
      // into endless and later dies hits gameOver() with the reveal already
      // consumed, so it can't double-fire.
      discoveredCard: this.consumeCardRevealForEndScreen(),
      runScore: victoryScoreResult?.score,
      bestScore: victoryScoreResult?.best,
      isNewBest: victoryScoreResult?.isNewBest,
      recentRuns: victoryPriorRuns,
      daily: this.dailyModeActive && this.dailyDateString && victoryGrade && victoryScoreResult
        ? {
            challengeType: this.dailyChallengeType,
            dateString: this.dailyDateString,
            modifierNames: this.activeModifiers.map((modifier) => modifier.name),
            grade: victoryGrade.grade,
            survivalSeconds: this.gameTime,
            score: victoryScoreResult.score,
            wasVictory: true,
          }
        : undefined,
    });

    // Count this run toward the newcomer-bonus taper exactly once. showVictory()
    // fires at most once per run (guarded by !hasWon at the boss-kill site), so a
    // win that continues into endless mode and later dies is only counted here —
    // the gameOver() path skips the count when hasWon. Done after the result is
    // shown so the displayed newcomer multiplier matches the gold just computed.
    metaManager.recordRunCompleted();
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
    // The crate is left in the room that killed you rather than returning to the boards: a
    // delivery you lost is something to go back for. Taken HERE, at the killing blow, because
    // gameOver() runs 2200 ms later from a delayedCall and the ship's transform is the position
    // that matters. PRACTICE saves nothing, so it drops nothing.
    if (!this.practiceModeActive) this.dropQuestCargoWhereShipDied(playerX, playerY);
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
      this.addWorldDistortion(playerX, playerY, 300, 0.03, 500);
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
      // Above all in-run UI (HUD, minimap, arrows) so the whole frame dims
      // together; below the game-over overlay.
      const darkenOverlay = this.add.rectangle(
        this.scale.width / 2, this.scale.height / 2,
        this.scale.width, this.scale.height,
        0x000000, 0
      ).setDepth(OverlayDepths.DEATH_DARKEN).setScrollFactor(0);
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
    const runNoticeRows = this.collectRunNotices();

    // Clean up boss warning elements
    this.cleanupBossWarning();

    // Clear saved game state (run is over)
    getGameStateManager().clearSave();

    // Calculate and award gold
    const metaManager = getMetaProgressionManager();

    // PRACTICE hands out max-level weapons and spawns bosses on demand, and its menu
    // promises "Nothing here is saved — no gold, no unlocks, no records."
    // SecureStorage already blocks the writes, but every recorder below still mutates
    // the in-memory singletons, so the run-end screen announced gold, a broken streak,
    // unlocks and a new best that exitPracticeSession's reload then threw away.
    // A practice run end records nothing and claims nothing.
    const practiceRun = this.practiceModeActive;

    // Bank this run's build for Memory (`upgradeKeepLevel`) — see showVictory().
    // A won run that continued into endless and then died records here too; the
    // later, deeper build is the right one to carry forward.
    if (!practiceRun) {
      metaManager.recordRunUpgrades(recordRunBuild(this.upgrades));
    }

    // Capture streak state before any changes
    const previousStreak = metaManager.getCurrentStreak();

    // Break streak if player died (didn't win)
    // Note: Victory streak increment happens in showVictory(), not here.
    // GAUNTLET has no victory to streak, so dying in it never punishes the
    // standard-mode win streak.
    if (!this.hasWon && !this.gauntletModeActive && !practiceRun) {
      metaManager.breakStreak();
    }

    // Calculate gold (after streak update so multiplier is current)
    const goldEarned = practiceRun
      ? 0
      : metaManager.calculateRunGold(
          this.killCount,
          this.gameTime,
          this.playerStats.level,
          this.hasWon,
          this.playerStats.goldMultiplier // ship/stage/pact/modifier gold bonuses
        );
    // Snapshot before the payout lands: the ledger must hold only what the RUN itself
    // moved (bounties, shrines, caches, market spends). The payout is the pill's own
    // number and would otherwise be double-counted as "found".
    const runGoldLedger = practiceRun ? undefined : metaManager.getRunLedger();
    if (!practiceRun) {
      metaManager.addGold(goldEarned);
    }

    // Snapshot personal bests BEFORE recordRunEnd mutates them, so the summary
    // screen can compare this run against prior records.
    const lifetimeStatsBeforeUpdate = getAchievementManager().getLifetimeStats();
    const personalBestsSnapshot = {
      longestSurvival: lifetimeStatsBeforeUpdate.longestSurvivalSeconds,
      mostKills: lifetimeStatsBeforeUpdate.mostKillsInRun,
      highestLevel: lifetimeStatsBeforeUpdate.highestLevel,
      highestCombo: lifetimeStatsBeforeUpdate.highestComboInRun,
    };

    const runFacts = this.buildRunFacts(goldEarned, metaManager.getCurrentStreak());

    // Run-end quest settle is paid AFTER the ledger snapshot above, so it is in no
    // other run-end number. Reported as its own recap row.
    let runEndQuestGold = 0;
    let runEndQuests: DailyQuestDefinition[] = [];

    // Armed here so recordRunEnd's achievement unlocks below are captured; a won-then-died
    // endless run skips that block and simply earns none.
    this.runEndAchievements = [];

    // Record run end statistics (only if not already recorded in showVictory)
    if (!this.hasWon && !practiceRun) {
      getAchievementManager().recordRunEnd(buildRunEndData(runFacts));
      recordCodexRunEnd(runFacts);
      runEndQuests = settleDailyQuests(buildQuestRunData(runFacts));
      runEndQuestGold = this.payDailyQuests(runEndQuests);
    }

    // Evaluate hidden unlocks and queue toast notifications for each new one.
    // After evaluation runs, compute the top locked-unlock progress entries so
    // the game over screen can surface "closest to unlocking" motivation.
    // Streak is already broken above on a loss, or intact for a won-then-died
    // endless run, so getCurrentStreak() reflects this run's true streak here.
    const newHiddenUnlocks: HiddenUnlockCondition[] = practiceRun
      ? []
      : getHiddenUnlockManager().evaluatePostRun(buildUnlockContext(runFacts));
    const runEarnings = buildRunEarnings({
      unlocks: newHiddenUnlocks,
      achievements: this.runEndAchievements ?? [],
      quests: runEndQuests,
    });
    const unlockProgressForPanel = getHiddenUnlockManager().getTopProgress(
      buildUnlockContext(runFacts),
      3
    );

    // Performance grade + per-run best score (persisted by world level).
    // GAUNTLET runs are measured in waves reached instead — they skip the
    // composite score, the per-world-level best table, the daily leaderboard,
    // and the recent-runs strip so boss-rush results never pollute
    // standard-mode records.
    const runOutcome = recordRunOutcome(runFacts, {
      practice: practiceRun,
      gauntlet: this.gauntletModeActive,
      gauntletWave: this.gauntletDirector.getWave(),
      endless: this.endlessDirector.isActive(),
      endlessCycle: this.endlessDirector.getCycle(),
      daily: this.dailyModeActive && this.dailyDateString
        ? { challengeType: this.dailyChallengeType, dateString: this.dailyDateString }
        : null,
      paceSamples: this.paceRecordingEnabled ? this.paceSamples : null,
      shipId: this.selectedShipId,
      build: this.runHistoryBuild(),
    });
    // Never assign the flag directly: a won-then-died endless run had showVictory set it first.
    if (runOutcome.paceGhostReplaced) this.paceGhostReplaced = true;
    const {
      score: scoreResult,
      grade: performanceGrade,
      priorRuns: gameOverPriorRuns,
    } = runOutcome;

    this.pendingRematchLaunch = this.buildRematchSeed();
    // Persist the grudge exactly once per death, and show only what was stored —
    // recordNemesisKill returns the persisted record, so the panel can never
    // announce a hunter the storage refused.
    const nemesisAfterDeath = this.practiceModeActive
      ? null
      : recordNemesisKill(this.pendingNemesisTypeId);
    const nemesisName = nemesisAfterDeath
      ? getEnemyType(nemesisAfterDeath.typeId)?.name ?? null
      : null;
    this.pauseMenuManager.gameOver({
      killCount: this.killCount,
      gameTime: this.gameTime,
      playerLevel: this.playerStats.level,
      goldEarned,
      goldLedger: runGoldLedger,
      questGold: runEndQuestGold,
      runEarnings,
      runNotices: runNoticeRows,
      // Gauntlet deaths leave the streak untouched, so never show "Streak broken!" —
      // and neither does a practice death, which no longer breaks it.
      previousStreak: this.gauntletModeActive || practiceRun ? 0 : previousStreak,
      highestCombo: runFacts.highestCombo,
      totalDamageDealt: this.totalDamageDealt,
      totalDamageTaken: this.totalDamageTaken,
      damageBySource: this.getDamageTakenBySource(),
      expedition: this.buildExpeditionDebrief(),
      killedBy: this.killedBySourceName,
      nemesis: nemesisAfterDeath && nemesisName
        ? { name: nemesisName, grudge: nemesisAfterDeath.grudge }
        : null,
      pace: {
        ghost: this.paceGhostCurve,
        runSamples: this.paceSamples,
        ghostReplaced: this.paceGhostReplaced,
      },
      rematch: this.pendingRematchLaunch
        ? { targetName: getEnemyType(this.pendingRematchLaunch.target.targetId)?.name ?? 'the boss' }
        : undefined,
      runTimeline: this.runTimelineComplete ? this.runTimelineEvents : undefined,
      weaponStats: this.weaponManager?.getWeaponRunStats() ?? [],
      personalBests: practiceRun ? undefined : personalBestsSnapshot,
      unlockProgress: practiceRun ? undefined : unlockProgressForPanel,
      performanceGrade,
      // Reveal (and consume) the data-cache card. Null on a post-victory
      // endless death — showVictory() already consumed it, and the per-run
      // guard stops endless play from queueing a second one.
      discoveredCard: this.consumeCardRevealForEndScreen(),
      runScore: scoreResult?.score,
      bestScore: scoreResult?.best,
      isNewBest: scoreResult?.isNewBest,
      recentRuns: gameOverPriorRuns,
      gauntlet: this.gauntletModeActive
        ? {
            wave: Math.max(1, this.gauntletDirector.getWave()),
            bestWave: loadGauntletBestWave(),
            isNewBest: this.gauntletDirector.isNewBestThisRun(),
          }
        : undefined,
      endless: this.endlessDirector.isActive() && this.endlessDirector.getCycle() >= 1
        ? {
            cycle: this.endlessDirector.getCycle(),
            bestCycle: loadEndlessBestCycle(),
            isNewBest: this.endlessDirector.isNewBestThisRun(),
          }
        : undefined,
      daily: this.dailyModeActive && this.dailyDateString && performanceGrade && scoreResult
        ? {
            challengeType: this.dailyChallengeType,
            dateString: this.dailyDateString,
            modifierNames: this.activeModifiers.map((modifier) => modifier.name),
            grade: performanceGrade.grade,
            survivalSeconds: this.gameTime,
            score: scoreResult.score,
            wasVictory: this.hasWon,
          }
        : undefined,
    });

    // Count this run toward the newcomer-bonus taper exactly once. A won run that
    // continued into endless mode and then died was already counted in
    // showVictory(), so only count here on a loss (mirrors the streak/recordRunEnd
    // guards above). Done after the result is shown so the displayed newcomer
    // multiplier matches the gold just computed.
    if (!this.hasWon && !practiceRun) {
      metaManager.recordRunCompleted();
    }
  }

  /**
   * The run's measured numbers at run end — the one snapshot every settlement path reads.
   * `winStreak` is a parameter because each path has to read it at a different moment relative
   * to its own streak mutation.
   */
  private buildRunFacts(goldEarned: number, winStreak: number): RunFacts {
    return {
      wasVictory: this.hasWon,
      killCount: this.killCount,
      levelReached: this.playerStats.level,
      survivalTimeSeconds: this.gameTime,
      damageDealt: this.totalDamageDealt,
      damageTaken: this.totalDamageTaken,
      highestCombo: getHighestCombo(),
      goldEarned,
      worldLevel: getMetaProgressionManager().getWorldLevel(),
      weaponIdsUsed: [
        ...(this.weaponManager?.getAllWeapons().map((weapon) => weapon.id) ?? []),
        ...this.scrappedWeaponIds,
      ],
      winStreak,
    };
  }

  /**
   * What the toast diet recorded instead of drawing this run. Read at the TOP of each
   * run-end path, before the settle raises its own toasts: those become their own tagged
   * rows, and reading afterwards would list every settled unlock and quest twice.
   */
  private collectRunNotices(): RunEarning[] {
    if (this.practiceModeActive) return [];
    return buildRunNotices(this.toastManager?.getSuppressed() ?? []);
  }

  /**
   * Records an early run end: pause menu, END RUN, Confirm. Ending a run is a real
   * run end (the save is cleared and the run's gold is banked), so it writes what
   * gameOver() writes, under the same `hasWon` guards: a run that already won and
   * continued into endless was recorded by showVictory() and must not count twice.
   * Death-only work is absent on purpose. Nothing killed the player, so there is no
   * nemesis to persist, and the win streak is left intact (see POLISH-GOLD-TRUTH (h)).
   */
  private recordEarlyRunEnd(goldEarned: number): EarlyRunEndRecord {
    // A practice run end records nothing — same reason as gameOver(). The gold and the
    // day's quest board are banked by the pause menu on this path, so it skips those
    // itself; everything else is skipped here.
    if (this.practiceModeActive) return { unlocks: [], achievements: [], notices: [] };

    const runNoticeRows = this.collectRunNotices();
    const metaManager = getMetaProgressionManager();
    const runFacts = this.buildRunFacts(goldEarned, metaManager.getCurrentStreak());

    // Armed before recordRunEnd so the achievement-unlock callback captures what this
    // run end earns; gameOver() arms it the same way, for the same reason.
    this.runEndAchievements = [];

    // Not behind the hasWon guard, exactly as gameOver() has it: the later, deeper
    // build is the right one for Memory to carry into the next run.
    metaManager.recordRunUpgrades(recordRunBuild(this.upgrades));

    if (!this.hasWon) {
      getAchievementManager().recordRunEnd(buildRunEndData(runFacts));
      recordCodexRunEnd(runFacts);
    }

    // After recordRunEnd so the lifetime-stat conditions see this run, the order
    // gameOver() uses. The toast this raises lands at HUD depth under the confirm
    // dialog, so the names are returned for the dialog to report instead.
    const newHiddenUnlocks = getHiddenUnlockManager().evaluatePostRun(buildUnlockContext(runFacts));

    recordRunOutcome(runFacts, {
      practice: false,
      gauntlet: this.gauntletModeActive,
      gauntletWave: this.gauntletDirector.getWave(),
      endless: this.endlessDirector.isActive(),
      endlessCycle: this.endlessDirector.getCycle(),
      daily: this.dailyModeActive && this.dailyDateString
        ? { challengeType: this.dailyChallengeType, dateString: this.dailyDateString }
        : null,
      paceSamples: this.paceRecordingEnabled ? this.paceSamples : null,
      shipId: this.selectedShipId,
      build: this.runHistoryBuild(),
    });

    if (!this.hasWon) {
      metaManager.recordRunCompleted();
    }

    return {
      unlocks: newHiddenUnlocks,
      achievements: this.runEndAchievements ?? [],
      notices: runNoticeRows,
    };
  }

  /**
   * Folds the in-progress run into today's quest board and pays anything it
   * completes on the spot. `wasVictory`/`goldEarned` are the two facts that only
   * exist at run end, so they go in as false/0 — the quests measuring them simply
   * never fire live and settle at run end instead.
   */
  private checkDailyQuestsLive(): void {
    if (!this.dailyQuestWatcher) {
      this.dailyQuestWatcher = createDailyQuestWatcher();
    }
    this.payDailyQuests(this.dailyQuestWatcher.check({
      wasVictory: false,
      killCount: this.killCount,
      levelReached: this.playerStats.level,
      survivalTimeSeconds: this.gameTime,
      damageDealt: this.totalDamageDealt,
      damageTaken: this.totalDamageTaken,
      goldEarned: 0,
      highestCombo: getHighestCombo(),
    }));
  }

  /**
   * Pays out quest gold banked by a live completion or a run-end settle and
   * toasts each quest. Claiming (rather than adding each quest's gold directly)
   * also sweeps up anything an earlier failed payout left pending. Returns the
   * gold actually claimed, so a run-end settle can be reported on the end screen.
   */
  private payDailyQuests(completed: DailyQuestDefinition[]): number {
    if (completed.length === 0) return 0;
    const owed = claimDailyQuestGold();
    if (owed > 0) {
      getMetaProgressionManager().addGold(owed);
    }
    for (const quest of completed) {
      this.toastManager?.showToast({
        tier: 'notable',
        title: 'Daily Quest Complete',
        description: `${quest.name} · +${quest.gold} gold`,
        icon: quest.icon,
        color: 0xffe26a,
        duration: 3600,
      });
    }
    return owed;
  }

  /**
   * Starts a fresh expedition's quest chains and announces anything new. Fresh runs only:
   * a refresh-restore is the same run continuing, and re-running this would clear the
   * run-scope counters the player already earned.
   */
  private startExpeditionQuestRun(): void {
    const boundWorldMap = this.worldMode.worldMap();
    if (!boundWorldMap) return;
    // A chain that finished at the victory frame banked its roll rather than losing it: the
    // draft queue is dead once hasWon is set. It arrives here, on the next flight out.
    const carriedRelicRolls = claimExpeditionQuestRelicRolls();
    if (carriedRelicRolls > 0) {
      this.grantRelicChoice(carriedRelicRolls);
      this.toastManager?.showToast({
        tier: 'notable',
        title: 'QUEST REWARD',
        description: carriedRelicRolls === 1
          ? 'A finished chain sends a relic with you'
          : `${carriedRelicRolls} finished chains send relics with you`,
        icon: 'crown',
        color: 0xffe26a,
        duration: 3600,
      });
    }
    // A distinct sweep's rooms belong to the world they were charted in: a sector key names a
    // different room in a regenerated map. Dropping them here rather than on the first room
    // entry is what keeps the ticker from reading the world the player left.
    for (const restarted of dropStaleExpeditionQuestWorldProgress(
      questWorldStamp(boundWorldMap),
    )) {
      getDiscoveryManager().noteObjectiveUpdated(restarted.questId);
      this.toastManager?.showToast({
        tier: 'notable',
        title: 'OBJECTIVE RESTARTED',
        description: `${restarted.questName}: ${restarted.stepDescription}`,
        icon: 'radar',
        color: 0x9fe8a0,
        duration: 3600,
      });
    }
    for (const quest of beginExpeditionQuestRun()) {
      getDiscoveryManager().noteObjectiveUpdated(quest.id);
      this.toastManager?.showToast({
        tier: 'notable',
        title: 'NEW OBJECTIVE',
        description: `${quest.name}: ${this.questStepText(quest.steps[0])}`,
        icon: quest.icon,
        color: 0x9fe8a0,
        duration: 3600,
      });
    }
  }

  /** Null outside an expedition, which is what makes the arena, daily, gauntlet and practice
   *  runs keep their authored targets. */
  private questSectorSupply(): SectorSupplySnapshot | null {
    const map = this.worldMode.worldMap();
    return map ? buildSectorSupply(map) : null;
  }

  private questStepText(step: ExpeditionQuestStep): string {
    return renderStepDescription(step, effectiveStepTarget(step, this.questSectorSupply()));
  }

  /** A quest toast raised at the conquest would never be seen: showVictory is one statement
   *  later, and it pauses the scene and draws its overlay over the HUD. Routed to the run-end
   *  notice rows instead, which is where the victory screen already reports what the toast diet
   *  held back. */
  private raiseQuestToast(config: ToastConfig, asNotice: boolean): void {
    if (asNotice) this.toastManager?.recordNotice(config);
    else this.toastManager?.showToast(config);
  }

  /**
   * The one door every expedition quest event goes through. Arena, daily, gauntlet and
   * practice runs have no world map, so the guard here is what keeps them out of the
   * expedition chains without a mode flag at each call site.
   */
  private recordExpeditionQuest(event: QuestEvent, asNotice = false): void {
    if (!this.worldMode.worldMap()) return;
    const rewards = recordExpeditionQuestEvent(event, this.questSectorSupply());
    if (rewards.stepCompletions.length === 0
      && rewards.questCompletions.length === 0
      && rewards.activatedQuestIds.length === 0) {
      return;
    }

    const owed = claimExpeditionQuestGold();
    if (owed > 0) getMetaProgressionManager().addGold(owed);

    // Queued, not opened: processRelicChoiceQueue owns when a draft may take the screen, and
    // refuses while the level-up, settings or pause overlays hold it.
    const owedRelicRolls = claimExpeditionQuestRelicRolls();
    if (owedRelicRolls > 0) this.grantRelicChoice(owedRelicRolls);

    const discovery = getDiscoveryManager();
    // A finished quest is deliberately not badged: it has no pin and no panel row left, so the
    // badge would name something the chart has stopped drawing. Its successor is badged below.
    const finishedQuestIds = new Set(rewards.questCompletions.map(entry => entry.questId));
    for (const completion of rewards.stepCompletions) {
      if (finishedQuestIds.has(completion.questId)) continue;
      discovery.noteObjectiveUpdated(completion.questId);
    }
    for (const questId of rewards.activatedQuestIds) discovery.noteObjectiveUpdated(questId);

    for (const completion of rewards.stepCompletions) {
      const quest = getExpeditionQuestFromCatalog(completion.questId);
      const step = quest?.steps.find((entry) => entry.id === completion.stepId);
      if (!quest || !step) continue;
      this.raiseQuestToast({
        tier: 'notable',
        title: 'OBJECTIVE COMPLETE',
        description: `${this.questStepText(step)} · +${completion.goldReward} gold`,
        icon: quest.icon,
        color: 0x7fd7ff,
        duration: 3200,
      }, asNotice);
    }
    for (const completion of rewards.questCompletions) {
      const quest = getExpeditionQuestFromCatalog(completion.questId);
      if (!quest) continue;
      const grantedKeyId = quest.grantsKeyId;
      if (grantedKeyId !== undefined) {
        this.earnedQuestKeyIds.add(grantedKeyId);
        this.announceNewRoutes(grantedKeyId, quest.name, quest.icon);
      }
      this.raiseQuestToast({
        tier: 'notable',
        title: 'QUEST COMPLETE',
        description: `${quest.name} · +${completion.goldReward} gold`
          + (completion.relicRoll === true ? ' · relic recovered' : ''),
        icon: quest.icon,
        color: 0xffe26a,
        duration: 3600,
      }, asNotice);
    }
    for (const questId of rewards.activatedQuestIds) {
      const quest = getExpeditionQuestFromCatalog(questId);
      if (!quest) continue;
      this.raiseQuestToast({
        tier: 'notable',
        title: 'NEW OBJECTIVE',
        description: `${quest.name}: ${this.questStepText(quest.steps[0])}`,
        icon: quest.icon,
        color: 0x9fe8a0,
        duration: 3600,
      }, asNotice);
    }
  }

  /** Kills reach quests as a delta, so the once-a-second poll cannot double-credit. */
  private checkExpeditionQuestKills(): void {
    const delta = this.killCount - this.expeditionQuestKillBaseline;
    if (delta <= 0) return;
    this.expeditionQuestKillBaseline = this.killCount;
    this.recordExpeditionQuest({ kind: 'kill', amount: delta });
  }

  /** Dwell reaches quests as the ABSOLUTE seconds held in the current sector, so the
   *  once-a-second poll cannot double-credit and leaving restarts the count. */
  private checkExpeditionQuestDwell(): void {
    const heldSectorKey = this.expeditionDwellSectorKey;
    if (heldSectorKey === null) return;
    const sector = this.worldMode.worldMap()?.sectors.get(heldSectorKey);
    if (!sector) return;
    const secondsHeld = Math.floor(this.gameTime - this.expeditionDwellStartSeconds);
    if (secondsHeld <= 0) return;
    this.recordExpeditionQuest({
      kind: 'surviveInSector',
      sectorTags: sectorTagsOf(sector),
      seconds: secondsHeld,
    });
  }

  /**
   * The room answers a hold objective. Without this a 'survive' step is a 'stand' step: the
   * director spawns on the view ring wherever the ship is, so waiting out 90 s in a cleared
   * corner costs exactly what flying costs. The dwell itself is untouched (absolute seconds
   * folded with max, a853c83): pressure is the feature, never a new gate on the count, because
   * gating it on live hostiles would stop the clock for the player who clears fastest.
   */
  private updateExpeditionSiege(): void {
    const heldSectorKey = this.expeditionDwellSectorKey;
    const sector = heldSectorKey === null
      ? undefined
      : this.worldMode.worldMap()?.sectors.get(heldSectorKey);
    if (!sector || heldSectorKey === null) { this.endExpeditionSiege(); return; }

    const holdObjectives = getActiveQuestHoldObjectives();
    const sectorTags = sectorTagsOf(sector);
    const heldObjective = holdObjectives.find(
      (objective) => sectorTags.includes(objective.sectorTag),
    );
    if (!heldObjective) { this.endExpeditionSiege(); return; }

    if (this.siegeSectorKey !== heldSectorKey) this.beginExpeditionSiege(heldSectorKey);

    this.siegeBesiegerIds = this.siegeBesiegerIds.filter((entityId) =>
      hasComponent(this.world, AmbushSpawnTag, entityId)
      && hasComponent(this.world, EnemyTag, entityId));

    // A boss owns the room while it lives, and the one arena hold in the catalog shares its
    // sector: stacking a siege on top would make that step the hardest fight in the game by
    // accident rather than by design.
    if (this.bossFightDirector.isBossActive()) return;
    if (this.gameTime < this.siegeNextWaveAtSeconds) return;
    if (this.siegeBesiegerIds.length >= SIEGE_MAX_LIVE_BESIEGERS) return;

    const secondsHeld = Math.max(0, this.gameTime - this.expeditionDwellStartSeconds);
    const holdFraction = Math.min(1, secondsHeld / Math.max(1, heldObjective.target));
    this.siegeNextWaveAtSeconds = this.gameTime
      + SIEGE_WAVE_INTERVAL_START_SECONDS
      + (SIEGE_WAVE_INTERVAL_END_SECONDS - SIEGE_WAVE_INTERVAL_START_SECONDS) * holdFraction;
    this.spawnSiegeWave(sector.depth);
  }

  /** One announcement per room, and then a standing tell. The toast is the moment; the ticker's
   *  `SIEGE ·` row is what is still there thirty seconds later, and it costs no new HUD line
   *  because buildRunTickerRows deals it into the line the bounty and the objectives already
   *  share. */
  private beginExpeditionSiege(sectorKey: string): void {
    this.siegeSectorKey = sectorKey;
    this.siegeNextWaveAtSeconds = this.gameTime;
    this.siegeBesiegerIds = [];
    // The row lands with the toast rather than up to a full cycle later: rebuild next frame and
    // open the cycle on slot 0, which is the siege row while a siege is live.
    this.questTickerRefreshTimer = 0;
    this.questTickerIndex = 0;
    this.questTickerCycleTimer = QUEST_TICKER_CYCLE_SECONDS;
    this.soundManager.playBossWarning();
    this.toastManager?.showToast({
      tier: 'ambient',
      title: 'THE ROOM ANSWERS',
      description: 'Hold this sector and it will not let you.',
      icon: 'warning',
      color: WORLD_GEOMETRY_COLORS.hazard.stroke,
      duration: 3200,
    });
  }

  /** Tracking only. The besiegers are real enemies and are left to the world's own teardown, the
   *  clearAmbushNest rule: a wave that already spawned is the player's fight, not the
   *  objective's bookkeeping. */
  private endExpeditionSiege(): void {
    if (this.siegeSectorKey === null) return;
    this.siegeSectorKey = null;
    this.siegeNextWaveAtSeconds = 0;
    this.siegeBesiegerIds = [];
    this.questTickerRefreshTimer = 0;
  }

  /** The nest's pack, entering from the room's edges instead of standing up in a ring: a siege
   *  closes in, an ambush is already there. AmbushSpawnTag rather than a new component because
   *  both of its meanings are wanted verbatim: leash-exempt, so fleeing leaves the fight in the
   *  room it belongs to, and skipped by the serializer, so a refresh cannot double the wave. */
  private spawnSiegeWave(depth: number): void {
    const pack = AMBUSH_NEST_WAVES[ambushWaveTier(depth)];
    for (const member of pack) {
      const enemyType = getEnemyType(member.typeId);
      if (!enemyType) continue;
      for (let index = 0; index < member.count; index++) {
        if (this.siegeBesiegerIds.length >= SIEGE_MAX_LIVE_BESIEGERS) return;
        if (this.enemyCount >= this.maxEnemies) return;
        const spawnPoint = this.pickSpawnRingPoint(REGULAR_SPAWN_RING);
        if (!spawnPoint) return;
        const scaledStats = getScaledStats(
          enemyType, this.gameTime, this.worldLevelHealthMult, this.worldLevelDamageMult,
        );
        const entityId = this.createEnemy(spawnPoint.x, spawnPoint.y, enemyType, scaledStats);
        addComponent(this.world, AmbushSpawnTag, entityId);
        this.siegeBesiegerIds.push(entityId);
      }
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
    addComponent(this.world, Knockback, entityId);

    // Set component values
    Transform.x[entityId] = x;
    Transform.y[entityId] = y;
    Transform.rotation[entityId] = 0;

    Velocity.x[entityId] = 0;
    Velocity.y[entityId] = 0;
    Velocity.speed[entityId] = 200; // Pixels per second

    // bitECS recycles entity ids and never clears a store on addComponent, so a fresh
    // player can inherit the shove a dead enemy was carrying on that id.
    Knockback.velocityX[entityId] = 0;
    Knockback.velocityY[entityId] = 0;
    Knockback.decay[entityId] = 0.001;

    // Seed health from the built stats, never a placeholder: syncStatsToPlayer only
    // ever clamps current HP *downward* (correct mid-run — new max HP must not heal
    // you), so whatever is written here is the hard cap on run-start HP. A literal
    // 100 silently capped every build whose max exceeds it. Mirrors restorePlayer.
    Health.current[entityId] = this.playerStats.currentHealth;
    Health.max[entityId] = this.playerStats.maxHealth;

    // Create visual - procedural neon spaceship
    this.playerSpaceship = new PlayerSpaceship(this, x, y, {
      baseRadius: 16,
      neonColor: this.getShipNeonColor(),
      quality: this.visualQuality,
      hullId: this.getShipHullId(),
    }, this.playerStats.level);
    const playerVisual = this.playerSpaceship.getContainer();
    playerVisual.setDepth(10);
    registerSprite(entityId, playerVisual);

    return entityId;
  }

  /**
   * The wall-collision context, rebuilt in place rather than allocated: this is
   * a per-frame call. Null in arena, which is what keeps its movement integration the
   * arithmetic it always was.
   */
  private syncPlayerWallCollision(): WallCollisionContext | null {
    const worldMap = this.worldMode.worldMap();
    if (!worldMap || this.playerId === -1) return null;
    const context = this.playerWallCollision ?? {
      worldMap,
      playerId: this.playerId,
      playerRadius: PLAYER_COLLISION_RADIUS,
      enemyRadius: ENEMY_COLLISION_RADIUS,
    };
    context.worldMap = worldMap;
    context.playerId = this.playerId;
    this.playerWallCollision = context;
    return context;
  }

  /**
   * A ring point the world will accept, or null when SPAWN_RING_ATTEMPTS fresh edges
   * all landed outside it. Arena always succeeds on the first attempt, so its two
   * random draws and its distribution are exactly what they were before this seam.
   */
  private pickSpawnRingPoint(config: EdgeSpawnConfig): WorldPoint | null {
    const view = this.worldMode.viewRect();
    for (let attempt = 0; attempt < SPAWN_RING_ATTEMPTS; attempt++) {
      const point = pickEdgeSpawnPoint(view, config, Math.random);
      if (this.worldMode.isSpawnableWorldPoint(point.x, point.y)) return point;
    }
    // A heavily walled sector can reject the whole ring; enemies then enter through the
    // room's doors instead (doc 02 section 8), which also reads as intent rather than luck.
    if (this.worldMode.apertureSpawnPoint(apertureSpawnSpot)) return apertureSpawnSpot;
    return null;
  }

  private applyEnemyLeash(): void {
    const leashRadius = this.worldMode.leashRadius();
    if (leashRadius === null) return;

    const view = this.worldMode.viewRect();
    const centre = rectCenter(view);

    for (const enemyId of getFrameCacheEnemyIds()) {
      if (EnemyType.xpValue[enemyId] >= LEASH_EXEMPT_XP_FLOOR) continue;
      if (hasComponent(this.world, Destructible, enemyId)) continue;
      // A nest's wave belongs to the room the player chose to enter. Without this, fleeing a
      // woken nest teleports the whole wave onto the spawn ring beside the player and the
      // ambush follows them into unrelated sectors.
      if (hasComponent(this.world, AmbushSpawnTag, enemyId)) continue;
      if (!isBeyondLeash(
        Transform.x[enemyId], Transform.y[enemyId], centre.x, centre.y, leashRadius,
      )) continue;

      const ringPoint = repositionOntoSpawnRing(
        view, REGULAR_SPAWN_RING.spawnOffset, Math.random,
      );
      if (!this.worldMode.isSpawnableWorldPoint(ringPoint.x, ringPoint.y)) continue;

      Transform.x[enemyId] = ringPoint.x;
      Transform.y[enemyId] = ringPoint.y;
      Knockback.velocityX[enemyId] = 0;
      Knockback.velocityY[enemyId] = 0;
    }
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

    // Spawn just outside the visible area, on a random edge.
    const spawnPoint = this.pickSpawnRingPoint(REGULAR_SPAWN_RING);
    if (!spawnPoint) return;

    this.createEnemy(spawnPoint.x, spawnPoint.y, enemyType, scaledStats);
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
    // Ring spawns are filtered by isSpawnableWorldPoint, but minion, splitter and legion
    // children are placed at an offset from a parent and can land in rock, which now means
    // a mover the resolver has to shove out on its first step.
    this.worldMode.freeSpotNear(x, y, enemySpawnSpot);
    x = enemySpawnSpot.x;
    y = enemySpawnSpot.y;

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

    // ═══ ELITE AFFIX (natural regular spawns only) ═══
    // Exclude minibosses/bosses (xp >= 30) AND spawned-only minions, which route
    // through createEnemy too (ghost/splitter_mini/turret) — an elite ghost is odd.
    const mutatorMeta = ENDLESS_MUTATOR_META[this.endlessDirector.getMutator()];
    const isSpawnedOnly = enemyType.id === 'ghost' || enemyType.id === 'splitter_mini' || enemyType.id === 'turret';
    if (enemyType.xpValue < 30 && !isSpawnedOnly) {
      const affix = rollAffix(mutatorMeta.affixChanceMultiplier);
      if (affix !== EnemyAffixType.NONE) {
        const affixMeta = AFFIX_META[affix];
        addComponent(this.world, EnemyAffix, entityId);
        EnemyAffix.affixType[entityId] = affix;
        EnemyAffix.affixType2[entityId] = EnemyAffixType.NONE;
        Health.max[entityId] *= affixMeta.healthScale;
        Health.current[entityId] = Health.max[entityId];
        EnemyType.baseHealth[entityId] *= affixMeta.healthScale;
        EnemyType.xpValue[entityId] = Math.min(65535, Math.round(EnemyType.xpValue[entityId] * affixMeta.xpScale));
        EnemyType.armor[entityId] += affixMeta.bonusArmor;
        Velocity.speed[entityId] *= affixMeta.speedScale;
      }
    }

    // Endless-cycle mutator: trash-tier spawn effects only (boss/miniboss feel is
    // owned by the affix system; xpValue >= 30 stays untouched).
    if (enemyType.xpValue < 30 && this.endlessDirector.getMutator() !== EndlessMutatorType.NONE) {
      Velocity.speed[entityId] *= mutatorMeta.trashSpeedScale;
      EnemyType.xpValue[entityId] = Math.min(65535, Math.round(EnemyType.xpValue[entityId] * mutatorMeta.trashXpScale));
      EnemyType.armor[entityId] += mutatorMeta.trashArmorBonus;
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
    if (this.practiceFight && !this.practiceFightSpawning) this.practiceFight.dirty = true;
    const enemyType = getEnemyType(typeId);
    if (!enemyType) return;
    this.recordRunTimelineEvent('miniboss');

    // Spawn just outside the visible area, inset from the corners.
    const spawnPoint = this.pickSpawnRingPoint(MINIBOSS_SPAWN_RING);
    if (!spawnPoint) return;
    const { x, y } = spawnPoint;

    // Scale stats with both time and world level multipliers
    const scalingTime = this.spawnScalingTime(typeId);
    const scaledStats = getScaledStats(enemyType, scalingTime, this.worldLevelHealthMult, this.worldLevelDamageMult);

    // ═══ MINIBOSS AFFIX (endless cycle-2+ / gauntlet wave-4+ replay variety) ═══
    // One roll per spawn call: the twins are a single setpiece, so both carry
    // the same affix rather than rolling independently.
    const minibossAffix = this.minibossAffixEligible() ? this.practiceOrRolledAffix() : EnemyAffixType.NONE;
    const minibossParagonAffix = minibossAffix !== EnemyAffixType.NONE && this.paragonEligible()
      ? this.practiceOrRolledParagonAffix(minibossAffix)
      : EnemyAffixType.NONE;

    // Special case: Twins spawn as a pair
    if (typeId === 'twin_a') {
      const twinA = this.createEnemy(x, y, enemyType, scaledStats);
      if (minibossAffix !== EnemyAffixType.NONE) {
        this.applyDampedAffixStats(twinA, minibossAffix);
        if (minibossParagonAffix !== EnemyAffixType.NONE) this.applyDampedAffixStats(twinA, minibossParagonAffix, true);
      }

      // Create health bar for Twin A
      this.hudManager.createBossHealthBar(twinA, affixDisplayName(enemyType.name, minibossAffix, minibossParagonAffix), false);

      // Spawn Twin B nearby
      const twinBType = getEnemyType('twin_b');
      if (twinBType) {
        const offsetAngle = Math.random() * Math.PI * 2;
        const twinBX = x + Math.cos(offsetAngle) * 60;
        const twinBY = y + Math.sin(offsetAngle) * 60;
        const twinBStats = getScaledStats(twinBType, scalingTime, this.worldLevelHealthMult, this.worldLevelDamageMult);
        const twinB = this.createEnemy(twinBX, twinBY, twinBType, twinBStats);
        if (minibossAffix !== EnemyAffixType.NONE) {
          this.applyDampedAffixStats(twinB, minibossAffix);
          if (minibossParagonAffix !== EnemyAffixType.NONE) this.applyDampedAffixStats(twinB, minibossParagonAffix, true);
        }

        // Create health bar for Twin B
        this.hudManager.createBossHealthBar(twinB, affixDisplayName(twinBType.name, minibossAffix, minibossParagonAffix), false);

        // Link the twins
        linkTwins(twinA, twinB);
      }
    } else {
      const entityId = this.createEnemy(x, y, enemyType, scaledStats);
      if (minibossAffix !== EnemyAffixType.NONE) {
        this.applyDampedAffixStats(entityId, minibossAffix);
        if (minibossParagonAffix !== EnemyAffixType.NONE) this.applyDampedAffixStats(entityId, minibossParagonAffix, true);
      }

      // Create health bar for the miniboss
      this.hudManager.createBossHealthBar(entityId, affixDisplayName(enemyType.name, minibossAffix, minibossParagonAffix), false);
    }

    // Reposition all boss health bars
    this.hudManager.repositionBossHealthBars();

    // Screen shake effect for miniboss spawn
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.shakeCamera(200, 0.005);
    }

    // Announce miniboss spawn with visual effect
    this.showMinibossWarning(affixDisplayName(enemyType.name, minibossAffix, minibossParagonAffix));

    // One-time teach on the very first miniboss ever: the warning banner says
    // "danger", this toast says "worth fighting" (relic/consumable rewards).
    if (getTutorialHintManager().maybeShow('first-miniboss')) {
      const minibossHint = getTutorialHintDef('first-miniboss');
      this.toastManager.showToast({
        tier: 'critical',
        title: minibossHint.title,
        description: minibossHint.description,
        icon: minibossHint.icon,
        color: minibossHint.color,
        duration: minibossHint.duration,
      });
    }
  }

  /**
   * Shows a warning when a miniboss spawns. Depth/size matches boss warnings
   * so the alert isn't buried under other HUD elements mid-combat.
   */
  private showMinibossWarning(name: string): void {
    this.soundManager.playBossWarning();
    const warningDepth = HUD_OVERLAY_DEPTH - 50;
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

    // No warning glyphs — the red vignette pulse + color carry the alarm;
    // letter-spaced display type keeps it on-brand.
    const warningText = this.add.text(centerX, centerY - 50, name.toUpperCase(), {
      fontFamily: DISPLAY_FONT,
      fontSize: '32px',
      fontStyle: 'bold',
      color: '#ff6644',
      stroke: '#000000',
      strokeThickness: 5,
      align: 'center',
    });
    warningText.setLetterSpacing(4);
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
   * The hunter this run fields, or null. Shared by the fresh and restore paths
   * (which reset different blocks) so the mode gate can never diverge between
   * them: practice/gauntlet/daily never field a hunter — a sandbox has no
   * stakes, the gauntlet has its own pacing, and a seeded challenge board must
   * not be skewed by private profile state.
   */
  private loadRunNemesis(): NemesisRecord | null {
    if (this.practiceModeActive || this.gauntletModeActive || this.dailyModeActive) return null;
    return getNemesis();
  }

  /**
   * Fields the cross-run hunter once, at NEMESIS_SPAWN_TIME_SECONDS, or later, if a lair
   * is standing and the patience window has not run out (the lair is the preferred
   * arrival). Held back (rather than skipped) while the field is full, so a swarm at 2:30
   * delays the hunter instead of cancelling it.
   */
  private checkNemesisSpawn(): void {
    if (this.nemesisSpawned || !this.nemesisRecord) return;
    if (this.gameTime < NEMESIS_SPAWN_TIME_SECONDS) return;
    // A standing den holds the timer off: the hunter is at home and going there is the
    // point. Past the patience window it stops waiting, and every empty den stands down.
    if (this.gameTime < NEMESIS_LAIR_PATIENCE_SECONDS
      && this.activeNemesisLairs.some(lair => !lair.awake)) return;
    if (this.enemyCount >= this.maxEnemies) return;
    this.nemesisSpawned = this.spawnNemesis(this.nemesisRecord);
    if (this.nemesisSpawned) this.standDownNemesisLairs();
  }

  /**
   * Spawns the run's nemesis at a screen edge, or at a lair when one is given. Scaling is
   * applied AFTER createEnemy so time/world-level/curse scaling and any natural elite affix
   * roll are already baked in and the grudge multiplies the finished enemy.
   *
   * xpValue is floored at 30 on purpose: that is this codebase's miniboss test
   * (`handleEnemyDeath`'s loot tiers, the run-timeline 'bossDown' marker, and the
   * restore path's health-bar rule all read it), and a hunter is a miniboss-tier
   * setpiece. Without the floor a nemesis built from a Shambler would silently
   * drop out of all three.
   */
  private spawnNemesis(record: NemesisRecord, at?: { x: number; y: number }): boolean {
    const enemyType = getEnemyType(record.typeId);
    if (!enemyType) return false;
    this.recordRunTimelineEvent('miniboss');

    const spawnPoint = at ?? this.pickSpawnRingPoint(MINIBOSS_SPAWN_RING);
    if (!spawnPoint) return false;
    const { x, y } = spawnPoint;

    const scaledStats = getScaledStats(
      enemyType, this.spawnScalingTime(record.typeId),
      this.worldLevelHealthMult, this.worldLevelDamageMult,
    );
    const entityId = this.createEnemy(x, y, enemyType, scaledStats);
    addComponent(this.world, NemesisTag, entityId);
    this.applyNemesisScaling(entityId, record.grudge);

    const label = nemesisLabel(enemyType.name, record.grudge);
    this.hudManager.createBossHealthBar(entityId, label, false);
    this.hudManager.repositionBossHealthBars();
    if (getSettingsManager().isScreenShakeEnabled()) this.shakeCamera(200, 0.005);
    this.showMinibossWarning(label);
    return true;
  }

  /**
   * The grudge multipliers + the cosmetic size bump. Shared by the fresh spawn and
   * the save-restore path, which re-derives the sprite scale (sprites are rebuilt
   * from the base type on restore, so the scale is not carried by the save).
   */
  private applyNemesisScaling(entityId: number, grudge: number): void {
    const scaling = nemesisScaling(grudge);
    Health.max[entityId] *= scaling.health;
    Health.current[entityId] = Health.max[entityId];
    EnemyType.baseHealth[entityId] *= scaling.health;
    EnemyType.baseDamage[entityId] *= scaling.damage;
    Velocity.speed[entityId] *= scaling.speed;
    EnemyType.xpValue[entityId] = Math.min(
      65535, Math.max(30, Math.round(EnemyType.xpValue[entityId] * scaling.xp)),
    );
    this.applyNemesisVisualScale(entityId);
  }

  /**
   * Size bump only. Contact damage uses a flat 12-unit enemy radius
   * (`checkPlayerEnemyCollision`), so this is cosmetic — the hitbox is unchanged,
   * exactly as it already is for a Giant.
   */
  private applyNemesisVisualScale(entityId: number): void {
    EnemyType.size[entityId] *= NEMESIS_SPRITE_SCALE;
    const sprite = getSprite(entityId);
    if (sprite) sprite.setScale((sprite.scaleX || 1) * NEMESIS_SPRITE_SCALE);
    this.deathRippleManager.unregisterEnemy(entityId);
    this.deathRippleManager.registerEnemy(
      entityId, getEnemyType(this.enemyTypeMap.get(entityId) ?? '')?.shape ?? 'circle',
      10 * EnemyType.size[entityId],
    );
  }

  /**
   * Updates the boss warning sequence, showing escalating warnings as the boss spawn time approaches.
   * Phase 1 at 2 min before boss, Phase 2 at 1 min, Phase 3 at 30 sec.
   */
  private updateBossWarning(_deltaSeconds: number): void {
    if (this.endlessDirector.isActive()
      || this.bossFightDirector.hasSpawned()
      || !this.bossFightDirector.hasScheduledSpawn()) return;

    const warningDepth = HUD_OVERLAY_DEPTH - 50;
    const screenCenterX = this.scale.width / 2;
    const screenCenterY = this.scale.height / 2;

    // Phase 1: "Something stirs in the void..." at bossSpawnTime - 120 (e.g. 8:00)
    if (this.bossFightDirector.claimWarningPhase(1)) {
      // Destroy any existing warning text before creating new one
      if (this.bossWarningText) {
        this.bossWarningText.destroy();
      }

      const upcomingBossName =
        getEnemyType(this.bossFightDirector.upcomingBossTypeId())?.name ?? 'Something';
      this.bossWarningText = this.add.text(screenCenterX, screenCenterY, `${upcomingBossName} stirs in the void...`, {
        fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
        fontSize: '28px',
        color: '#ffdd44',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
      }).setOrigin(0.5).setDepth(warningDepth).setAlpha(0).setScrollFactor(0);

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
    if (this.bossFightDirector.claimWarningPhase(2)) {
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
      }).setOrigin(0.5).setDepth(warningDepth).setAlpha(0).setScrollFactor(0);

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
    if (this.bossFightDirector.getWarningPhase() >= 2 && !this.bossFightDirector.hasSpawned()) {
      const timeRemaining = Math.max(0, Math.ceil(this.bossFightDirector.secondsUntilSpawn()));
      if (timeRemaining <= 10) {
        if (Math.abs(Math.sin(this.gameTime * 1.5)) < 0.05) {
          getJuiceManager().screenShake(0.003, 150);
        }
      }
    }

    // Phase 3: "BOSS INCOMING" at bossSpawnTime - 5
    if (this.bossFightDirector.claimWarningPhase(3)) {
      this.soundManager.playBossWarning();
      getJuiceManager().screenShake(0.008, 400);
      getJuiceManager().impactFlash(0.15, 100);
      // Grid distortion pulse from screen center
      this.gridBackground.applyExplosiveForce(
        2000,
        screenCenterX + this.cameras.main.scrollX,
        screenCenterY + this.cameras.main.scrollY,
        400,
      );
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
      }).setOrigin(0.5).setDepth(warningDepth).setAlpha(0).setScrollFactor(0);

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
  /**
   * Runs the pre-run intro overlays in sequence and keeps the simulation
   * soft-paused until the player has dismissed every one of them. Coach marks
   * (first run only) come first, then the active run-modifier banner. If there
   * is nothing to show, the game starts immediately with no added friction.
   */
  private startRunIntro(): void {
    const steps: Array<(done: () => void) => void> = [];

    if (!getSettingsManager().isTutorialSeen()) {
      steps.push((done) => this.showFirstRunCoachMarks(done));
    }
    if (this.activeModifiers.length > 0) {
      steps.push((done) => this.showModifierBanner(done));
    }

    if (steps.length === 0) return;

    // Soft-pause: the update loop early-returns while isPaused, so no enemies
    // spawn and the player takes no damage behind the overlays.
    this.isPaused = true;
    this.introOverlayActive = true;

    let stepIndex = 0;
    const runNext = () => {
      if (stepIndex >= steps.length) {
        this.introOverlayActive = false;
        this.isPaused = false;
        return;
      }
      const step = steps[stepIndex++];
      step(runNext);
    };

    // Brief beat so the scene fade-in settles before the first overlay appears.
    this.time.delayedCall(400, runNext);
  }

  private showModifierBanner(onComplete?: () => void): void {
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
    backdrop.setScrollFactor(0).setDepth(OverlayDepths.INTRO_BACKDROP);
    bannerElements.push(backdrop);

    // Title
    const title = this.add.text(centerX, centerY - 120, 'RUN MODIFIERS', {
      fontSize: '24px',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      color: '#888888',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(OverlayDepths.INTRO_TEXT).setAlpha(0);
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
      }).setOrigin(0.5).setScrollFactor(0).setDepth(OverlayDepths.INTRO_TEXT).setAlpha(0);
      bannerElements.push(tag);

      // Modifier name
      const nameText = this.add.text(centerX, cardY + 2, modifier.name, {
        fontSize: '22px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(OverlayDepths.INTRO_TEXT).setAlpha(0);
      bannerElements.push(nameText);

      // Description with effects breakdown
      const descText = this.add.text(centerX, cardY + 28, modifier.description, {
        fontSize: '16px',
        fontFamily: 'Arial',
        color: '#cccccc',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(OverlayDepths.INTRO_TEXT).setAlpha(0);
      bannerElements.push(descText);

      // Decorative line under each card
      const lineGraphics = this.add.graphics();
      lineGraphics.setScrollFactor(0).setDepth(OverlayDepths.INTRO_TEXT).setAlpha(0);
      const lineColor = parseInt(categoryColor.replace('#', ''), 16);
      lineGraphics.lineStyle(1, lineColor, 0.4);
      lineGraphics.lineBetween(centerX - 140, cardY + 48, centerX + 140, cardY + 48);
      bannerElements.push(lineGraphics);
    }

    // Dismissal prompt — the banner stays up until the player acknowledges it.
    const isTouchDevice = this.input.manager.touch !== null && this.sys.game.device.input.touch;
    const promptText = this.add.text(
      centerX,
      startY + totalHeight + 90,
      isTouchDevice ? 'Tap anywhere to start' : 'Click or press SPACE to start',
      {
        fontSize: '15px',
        fontFamily: 'Arial',
        color: '#99ccff',
        stroke: '#000000',
        strokeThickness: 2,
      }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(OverlayDepths.INTRO_TEXT).setAlpha(0);
    bannerElements.push(promptText);

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

    let dismissed = false;
    let keyHandler: ((event: KeyboardEvent) => void) | null = null;
    let pointerHandler: (() => void) | null = null;

    // Teardown: remove listeners + destroy elements. Idempotent. Called either
    // on dismissal (after the fade-out) or directly from scene shutdown.
    const teardown = () => {
      if (keyHandler) { this.input.keyboard?.off('keydown', keyHandler); keyHandler = null; }
      if (pointerHandler) { this.input.off('pointerdown', pointerHandler); pointerHandler = null; }
      for (const element of bannerElements) {
        if (element && (element as Phaser.GameObjects.GameObject).active) element.destroy();
      }
      this.modifierBannerCleanup = null;
    };
    this.modifierBannerCleanup = teardown;

    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      if (keyHandler) { this.input.keyboard?.off('keydown', keyHandler); keyHandler = null; }
      if (pointerHandler) { this.input.off('pointerdown', pointerHandler); pointerHandler = null; }
      this.tweens.add({
        targets: bannerElements,
        alpha: 0,
        duration: 350,
        onComplete: () => {
          teardown();
          onComplete?.();
        },
      });
    };

    keyHandler = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    this.input.keyboard?.on('keydown', keyHandler);

    pointerHandler = () => dismiss();
    this.input.on('pointerdown', pointerHandler);
  }

  /**
   * First-run coach-mark overlay. Shows a sequence of brief "card" tips
   * covering core controls. Each card requires an explicit tap/click/Enter to
   * advance (ESC skips the rest); there is no auto-advance, so the player must
   * acknowledge each tip. Marks the tutorial as seen on appearance and invokes
   * `onComplete` once the player has dismissed the sequence.
   */
  private showFirstRunCoachMarks(onComplete?: () => void): void {
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
    const coachDepth = HUD_OVERLAY_DEPTH - 60;
    let cardIndex = 0;
    let currentElements: Phaser.GameObjects.GameObject[] = [];
    let keyHandler: ((event: KeyboardEvent) => void) | null = null;
    let pointerHandler: (() => void) | null = null;

    // Teardown only — removes listeners + visuals. Idempotent. Used directly by
    // scene shutdown, which must NOT trigger onComplete (the run is ending).
    const cleanup = () => {
      if (keyHandler) { this.input.keyboard?.off('keydown', keyHandler); keyHandler = null; }
      if (pointerHandler) { this.input.off('pointerdown', pointerHandler); pointerHandler = null; }
      for (const element of currentElements) {
        if (element && (element as Phaser.GameObjects.GameObject).active) element.destroy();
      }
      currentElements = [];
      this.coachMarksCleanup = null;
    };
    this.coachMarksCleanup = cleanup;

    // Natural dismissal (finished all cards or skipped) → teardown + start game.
    const finish = () => {
      cleanup();
      onComplete?.();
    };

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
        finish();
        return;
      }
      renderCard(cardIndex);
    };

    const skipAll = () => {
      finish();
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

    // Kick off — no auto-advance; each card waits for an explicit dismissal.
    renderCard(cardIndex);
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
    this.cleanupBossIntro();
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
        tier: 'ambient',
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
        tier: 'ambient',
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
      this.addWorldDistortion(comboPlayerX, comboPlayerY, 280, 0.025, 400);
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
      // Screen-wide damage pulse — apply damage directly via ECS.
      // getFrameCacheEnemyIds() returns bitECS's LIVE query array (see the
      // "do NOT modify this array!" warning in FrameCache.ts); handleEnemyDeath
      // can both remove the dying entity and — for Splitter enemies — spawn new
      // ones via handleSplit synchronously. Snapshot into a plain copy first
      // (the safe pattern already used by StatusEffectSystem/HazardZoneSystem
      // for this exact hazard) and re-check liveness per entry, since an id in
      // the snapshot may already have died to a domino effect (poison spread,
      // chained explosion) earlier in this same loop.
      const enemies = [...getFrameCacheEnemyIds()];
      for (const enemyId of enemies) {
        if (!hasComponent(this.world, EnemyTag, enemyId)) continue;
        if (!hasComponent(this.world, Health, enemyId)) continue;
        Health.current[enemyId] -= 50;
        if (Health.current[enemyId] <= 0) {
          const enemyX = Transform.x[enemyId];
          const enemyY = Transform.y[enemyId];
          this.handleEnemyDeath(enemyId, enemyX, enemyY);
        }
      }
      getJuiceManager().hitStop(80, 0.95);
      this.toastManager.showToast({
        tier: 'ambient',
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
      this.addWorldDistortion(comboPlayerX, comboPlayerY, 350, 0.035, 450);
      this.time.delayedCall(100, () => {
        this.addWorldDistortion(comboPlayerX, comboPlayerY, 500, 0.025, 400);
      });
      this.time.delayedCall(250, () => {
        this.addWorldDistortion(comboPlayerX, comboPlayerY, 650, 0.015, 350);
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
  /**
   * DistortionPipeline consumes screen coordinates. Under a static camera that is the
   * same thing as world coordinates, which is why every call site passes a world
   * position; once the camera scrolls it is not.
   */
  private addWorldDistortion(
    worldX: number,
    worldY: number,
    radius: number,
    strength: number,
    durationMs: number,
  ): void {
    const camera = this.cameras.main;
    this.distortionPipeline?.addDistortion(
      worldX - camera.scrollX,
      worldY - camera.scrollY,
      radius,
      strength,
      durationMs,
    );
  }

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

    // Timed multiplicative stat boons (Power Surge → damage, Elite Surge → XP,
    // Golden Tide → gem value) all route through the gameTime-keyed timed-stat-
    // buff list — NOT a Phaser delayedCall — so they revert at the right moment
    // even across a mid-event refresh. A delayedCall dies on reload while the
    // save bakes the already-multiplied stat, which used to leave the boon
    // permanent (BUG-EVENT-BUFF-REVERT; cf. eb16e16 power-shrine, d7ab577 Power
    // Surge). getEventStatBuff is the single source of which stat / how much.
    const statBuff = getEventStatBuff(event);
    if (statBuff) {
      this.applyTimedStatBuff(statBuff.stat, statBuff.magnitude, statBuff.durationSeconds);
    }

    switch (event.id) {
      case 'elite_surge':
        // Transient spawn-rate kick: pull the next wave in sooner. Not persisted
        // and needs no revert timer — the spawn loop recomputes spawnInterval
        // from the phase curve on its next spawn tick, so this self-corrects in
        // ~1 tick. (The XP boon is handled by getEventStatBuff above.)
        this.spawnInterval = Math.max(0.15, this.spawnInterval * 0.5);
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

      // power_surge & golden_tide: the timed stat boon is fully applied by
      // getEventStatBuff above — no extra side effects, so no case needed here.

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
          // Authoritative HP is the ECS Health component — mutate it directly. The
          // playerStats mirror alone never charges the cost: syncStatsToPlayer only
          // clamps HP *down to max*, and grantBuildHeal is heal-only by design.
          const liveHealth = this.playerId === -1
            ? this.playerStats.currentHealth
            : Health.current[this.playerId];
          const halvedCurrent = Math.max(1, Math.floor(liveHealth / 2));
          this.playerStats.currentHealth = halvedCurrent;
          this.playerStats.maxHealth = Math.max(halvedCurrent, Math.floor(this.playerStats.maxHealth / 2));
          if (this.playerId !== -1) {
            Health.current[this.playerId] = halvedCurrent;
          }
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
          // Draft two relics (two sequential 1-of-3 choices; rounds where relic
          // slots are full are skipped by the queue).
          this.grantRelicChoice(2);
        },
      },
    ];

    const pickedDeal = availableDeals[Math.floor(Math.random() * availableDeals.length)];
    const healthBeforeDeal = this.playerStats.currentHealth;
    pickedDeal.apply();
    this.syncStatsToPlayer();
    this.grantBuildHeal(this.playerStats.currentHealth - healthBeforeDeal);

    // Surface exactly which deal fired so the player knows what changed.
    this.toastManager.showToast({
      tier: 'notable',
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
    const bannerDepth = HUD_OVERLAY_DEPTH - 60;

    const bannerBg = this.add.rectangle(bannerX, bannerY, bannerWidth, bannerHeight, 0x000000, 0.85);
    bannerBg.setStrokeStyle(2, event.color);
    bannerBg.setDepth(bannerDepth).setScrollFactor(0);

    const eventNameText = this.add.text(bannerX, bannerY - 8, event.name, {
      fontSize: '20px',
      color: `#${event.color.toString(16).padStart(6, '0')}`,
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(bannerDepth + 1).setScrollFactor(0);

    const eventDescText = this.add.text(bannerX, bannerY + 12, event.description, {
      fontSize: '13px',
      color: '#ccccdd',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(bannerDepth + 1).setScrollFactor(0);

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

  /** Affixed bosses are replay-variety only: endless cycle 2+ / gauntlet wave 6+. */
  private bossAffixEligible(): boolean {
    if (this.practiceModeActive) return true;
    if (this.gauntletModeActive) return this.gauntletDirector.getWave() >= 6;
    return this.endlessDirector.isActive() && this.endlessDirector.getCycle() >= 2;
  }

  /** Affixed minibosses are replay-variety only: endless cycle 2+ / gauntlet wave 4+. */
  private minibossAffixEligible(): boolean {
    if (this.practiceModeActive) return true;
    if (this.gauntletModeActive) return this.gauntletDirector.getWave() >= 4;
    return this.endlessDirector.isActive() && this.endlessDirector.getCycle() >= 2;
  }

  /** Paragon (double-affix) elites: deep runs only — endless cycle 4+ / gauntlet wave 10+. */
  private paragonEligible(): boolean {
    if (this.practiceModeActive) return true;
    if (this.gauntletModeActive) return this.gauntletDirector.getWave() >= 10;
    return this.endlessDirector.isActive() && this.endlessDirector.getCycle() >= 4;
  }

  /** Practice fields the affix the operator picked; every other mode rolls. */
  private practiceOrRolledAffix(): EnemyAffixType {
    return this.practiceModeActive ? this.practiceSpawnAffix : rollBossAffix();
  }

  private practiceOrRolledParagonAffix(firstAffix: EnemyAffixType): EnemyAffixType {
    return this.practiceModeActive ? this.practiceSpawnAffix2 : rollParagonAffix(firstAffix);
  }

  /**
   * The clock a boss-tier spawn scales against. A practice spawn lands at ~t=0,
   * where time-scaled stats would field a far weaker enemy than the one being
   * judged — so it scales at the time you'd really meet it instead.
   */
  private spawnScalingTime(typeId: string): number {
    return this.practiceModeActive ? scheduledSpawnTime(typeId) : this.gameTime;
  }

  /**
   * Applies an elite affix to a boss-tier entity (boss or miniboss) with stat
   * multipliers dampened via softenBossAffixScale — these pools/speeds are
   * already large, full trash-tier scales would drag or break chase feel.
   * XP scale and flat armor stay full. Must run AFTER createEnemy has set the
   * entity's scaled stats.
   */
  private applyDampedAffixStats(entityId: number, affix: EnemyAffixType, secondary: boolean = false): void {
    const affixMeta = AFFIX_META[affix];
    addComponent(this.world, EnemyAffix, entityId);
    if (secondary) {
      EnemyAffix.affixType2[entityId] = affix;
    } else {
      EnemyAffix.affixType[entityId] = affix;
      // Recycled-id hygiene: bitECS keeps stale array data across entity reuse.
      EnemyAffix.affixType2[entityId] = EnemyAffixType.NONE;
    }
    const dampedHealthScale = softenBossAffixScale(affixMeta.healthScale);
    Health.max[entityId] *= dampedHealthScale;
    Health.current[entityId] = Health.max[entityId];
    EnemyType.baseHealth[entityId] *= dampedHealthScale;
    EnemyType.xpValue[entityId] = Math.min(65535, Math.round(EnemyType.xpValue[entityId] * affixMeta.xpScale));
    EnemyType.armor[entityId] += affixMeta.bonusArmor;
    Velocity.speed[entityId] *= softenBossAffixScale(affixMeta.speedScale);
  }

  /**
   * Spawns a boss above the top edge of the room with a dramatic entrance. In arena the
   * room is the screen; in expedition the fight first seals to one sector, which is what
   * recovers the tuned entrance, centre-seeking and hazard geometry for every boss.
   */
  private spawnBoss(typeId: string): void {
    if (this.practiceFight && !this.practiceFightSpawning) this.practiceFight.dirty = true;
    const enemyType = getEnemyType(typeId);
    if (!enemyType) return;
    this.recordRunTimelineEvent('boss');

    // The room is the sector the player is standing in when the fight starts. A second
    // boss in the same fight (gauntlet waves, endless cycle 3+) joins that room instead
    // of moving it, which is why this is latched on activeBossType and not unconditional.
    if (!this.bossFightDirector.getActiveBossType()) {
      const anchor = this.playerId !== -1
        ? { x: Transform.x[this.playerId], y: Transform.y[this.playerId] }
        : rectCenter(this.worldMode.viewRect());
      this.worldMode.lockToSector(sectorOfWorldPoint(anchor.x, anchor.y));
    }

    // A seal that closed under a live channel has to break it: beginExpeditionRecall refuses
    // to start one inside a lock, and letting an in-flight one land would be the same escape.
    if (this.recallChannelRemaining > 0) {
      this.cancelExpeditionRecall('The room sealed around the ship.');
    }

    const room = this.worldMode.fieldRect();
    const x = rectCenter(room).x;
    const y = room.minY - 100;

    // Scale stats with both time and world level multipliers
    const scaledStats = getScaledStats(enemyType, this.spawnScalingTime(typeId), this.worldLevelHealthMult, this.worldLevelDamageMult);

    // Double boss health for challenge
    scaledStats.health *= 2;

    const entityId = this.createEnemy(x, y, enemyType, scaledStats);

    // ═══ BOSS AFFIX (endless cycle-2+ / gauntlet wave-6+ replay variety) ═══
    // The Legion is excluded: split children wouldn't inherit the affix and the
    // shared-pool math must not absorb a root-only health multiplier.
    let bossDisplayName = enemyType.name;
    if (typeId !== 'the_legion' && this.bossAffixEligible()) {
      const bossAffix = this.practiceOrRolledAffix();
      if (bossAffix !== EnemyAffixType.NONE) {
        this.applyDampedAffixStats(entityId, bossAffix);
        const paragonAffix = this.paragonEligible() ? this.practiceOrRolledParagonAffix(bossAffix) : EnemyAffixType.NONE;
        if (paragonAffix !== EnemyAffixType.NONE) {
          this.applyDampedAffixStats(entityId, paragonAffix, true);
        }
        bossDisplayName = affixDisplayName(enemyType.name, bossAffix, paragonAffix);
      }
    }

    // Create health bar for the boss (isFinalBoss = true for purple color)
    this.hudManager.createBossHealthBar(entityId, bossDisplayName, true);
    this.hudManager.repositionBossHealthBars();

    if (typeId === 'the_legion') {
      registerLegionRoot(entityId);
    }

    // Stronger screen shake for final boss
    if (getSettingsManager().isScreenShakeEnabled()) {
      this.shakeCamera(400, 0.01);
    }

    // Show boss entrance
    this.showBossEntrance(bossDisplayName);

    // Activate boss arena atmosphere
    activateBossArena(typeId);
    this.bossFightDirector.setActiveBoss(typeId);
  }

  /**
   * Spawns boss-specific hazard zones during boss fights.
   * Each boss type creates different hazard patterns.
   */
  private spawnBossHazard(bossTypeId: string): number {
    const field = this.worldMode.fieldRect();

    switch (bossTypeId) {
      case 'horde_king':
        // Burn zones at random positions, the fire lord scorches the room
        const burnPoint = pickInteriorPoint(field, 100, Math.random);
        spawnHazardZone(burnPoint.x, burnPoint.y, 80, 'burn', 6);
        return 4;

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
        return 5;

      case 'the_machine':
        // Ice patches + energy wells — mechanical precision
        const icePoint = pickInteriorPoint(field, 100, Math.random);
        spawnHazardZone(icePoint.x, icePoint.y, 70, 'ice', 8);
        // Occasional energy well (player buff zone)
        if (Math.random() < 0.4) {
          const energyPoint = pickInteriorPoint(field, 100, Math.random);
          spawnHazardZone(energyPoint.x, energyPoint.y, 60, 'energy', 10);
        }
        return 6;

      case 'the_bastion':
        // Smouldering shell craters near the player — lingering siege scars
        if (this.playerId !== -1) {
          const craterOffsetX = (Math.random() - 0.5) * 400;
          const craterOffsetY = (Math.random() - 0.5) * 400;
          spawnHazardZone(
            Transform.x[this.playerId] + craterOffsetX,
            Transform.y[this.playerId] + craterOffsetY,
            70, 'burn', 6
          );
        }
        return 5;

      case 'the_pulsar':
        // Warped-space wells around the player — the collapsed star bends space
        if (this.playerId !== -1) {
          const wellOffsetX = (Math.random() - 0.5) * 360;
          const wellOffsetY = (Math.random() - 0.5) * 360;
          spawnHazardZone(
            Transform.x[this.playerId] + wellOffsetX,
            Transform.y[this.playerId] + wellOffsetY,
            90, 'void', 7
          );
        }
        return 5;

      case 'the_obelisk':
        // Leaking containment energy — scattered charged wells the player can use.
        const wellPoint = pickInteriorPoint(field, 100, Math.random);
        spawnHazardZone(wellPoint.x, wellPoint.y, 70, 'energy', 9);
        return 6;

      case 'the_helix':
        // Spiralling energy collapses matter inward — a swirling void well.
        const spiralPoint = pickInteriorPoint(field, 120, Math.random);
        spawnHazardZone(spiralPoint.x, spiralPoint.y, 80, 'void', 8);
        return 6;

      case 'the_tessellator':
        // Crystalline shards frost the tiles between barrages — a slick ice patch.
        const frostPoint = pickInteriorPoint(field, 100, Math.random);
        spawnHazardZone(frostPoint.x, frostPoint.y, 70, 'ice', 8);
        return 6;

      case 'the_tremor':
        // Seismic fissures crack the arena floor between shockwaves — scorched ground.
        const fissurePoint = pickInteriorPoint(field, 100, Math.random);
        spawnHazardZone(fissurePoint.x, fissurePoint.y, 80, 'burn', 6);
        return 6;

      case 'the_diviner':
        // Warped void rifts tear open where the eye's gaze lingers between cages.
        const riftPoint = pickInteriorPoint(field, 100, Math.random);
        spawnHazardZone(riftPoint.x, riftPoint.y, 80, 'void', 6);
        return 6;

      case 'the_eclipse':
        // Umbral cold lingers where the shadow fell between pulses — a slick frost patch.
        const umbralPoint = pickInteriorPoint(field, 100, Math.random);
        spawnHazardZone(umbralPoint.x, umbralPoint.y, 80, 'ice', 6);
        return 6;

      default:
        return 5;
    }
  }

  /**
   * Shows dramatic boss entrance warning.
   */
  private showBossEntrance(name: string): void {
    // Defense-in-depth: if a previous intro's objects are still alive (e.g.
    // two boss spawns land close enough together that the first intro's
    // ~2.1s runtime hasn't finished — endless mode, or slow-motion/hit-stop
    // stretching it), tear them down instead of overwriting the reference
    // and orphaning them (leak) plus leaving their tweens targeting whatever
    // this call reassigns bossIntroObjects/bossIntroRuleState to.
    if (this.bossIntroObjects.length > 0) {
      this.cleanupBossIntro();
    }

    const bossJuice = getJuiceManager();

    // Hit stop for dramatic pause at spawn moment
    bossJuice.hitStop(60, 0.9);
    bossJuice.impactFlash(0.35, 120);
    bossJuice.screenShake(0.012, 400);

    // Grid distortion pulse from spawn point (top center)
    this.gridBackground.applyExplosiveForce(
      3000,
      this.scale.width / 2 + this.cameras.main.scrollX,
      this.cameras.main.scrollY,
      500,
    );

    // ── Letterboxed intro ───────────────────────────────────────────────
    // Bars slide in from the screen edges, the boss name lands between them
    // flanked by expanding accent rules, everything holds then slides away.
    // Lives in the HUD-warning band (above lighting/flashes, below minimap).
    const introDepth = HUD_OVERLAY_DEPTH - 50;
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    const barHeight = 54;
    const reducedMotion = getSettingsManager().isReducedMotionEnabled();

    const topBar = this.add.rectangle(centerX, -barHeight / 2, this.scale.width, barHeight, 0x000008, 0.85)
      .setScrollFactor(0).setDepth(introDepth);
    const bottomBar = this.add.rectangle(centerX, this.scale.height + barHeight / 2, this.scale.width, barHeight, 0x000008, 0.85)
      .setScrollFactor(0).setDepth(introDepth);

    const kicker = this.add.text(centerX, centerY - 44, 'WARNING', {
      fontSize: '14px',
      color: '#ff9999',
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(introDepth + 1).setScrollFactor(0).setAlpha(0);
    kicker.setLetterSpacing(6);

    const nameText = this.add.text(centerX, centerY, name.toUpperCase(), {
      fontSize: '40px',
      color: '#ff5566',
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(introDepth + 1).setScrollFactor(0).setAlpha(0);
    nameText.setLetterSpacing(8);

    // Accent rules flanking the name — expand from the center outward.
    const rules = this.add.graphics().setDepth(introDepth + 1).setScrollFactor(0);
    const ruleY = centerY + 34;
    const ruleMax = Math.min(260, this.scale.width * 0.2);
    // Tween target is this plain proxy (Graphics has no tweenable "spread"
    // property) — NOT `rules` itself, so it must be tracked and killed
    // separately from the bossIntroObjects array below. Missing this was a
    // real bug: if the intro was torn down (player death) while this tween
    // was running, drawRules kept calling .clear()/.fillStyle()/.fillRect()
    // on the already-destroyed `rules` Graphics every frame until the tween
    // finished.
    const ruleState = { spread: reducedMotion ? ruleMax : 0 };
    this.bossIntroRuleState = ruleState;
    const drawRules = () => {
      rules.clear();
      rules.fillStyle(0xff5566, 0.8);
      rules.fillRect(centerX - ruleState.spread, ruleY, ruleState.spread * 2, 2);
    };
    drawRules();
    rules.setAlpha(0);

    this.bossIntroObjects = [topBar, bottomBar, kicker, nameText, rules];

    const holdThenExit = () => {
      this.time.delayedCall(1400, () => {
        if (!topBar.scene) return; // already cleaned up (death / restart)
        if (reducedMotion) {
          this.tweens.add({
            targets: [topBar, bottomBar, kicker, nameText, rules],
            alpha: 0,
            duration: 150,
            onComplete: () => this.cleanupBossIntro(),
          });
          return;
        }
        this.tweens.add({
          targets: topBar,
          y: -barHeight / 2,
          duration: 300,
          ease: 'Cubic.easeIn',
        });
        this.tweens.add({
          targets: bottomBar,
          y: this.scale.height + barHeight / 2,
          duration: 300,
          ease: 'Cubic.easeIn',
        });
        this.tweens.add({
          targets: [kicker, nameText, rules],
          alpha: 0,
          duration: 260,
          ease: 'Sine.easeIn',
          onComplete: () => this.cleanupBossIntro(),
        });
      });
    };

    if (reducedMotion) {
      topBar.setY(barHeight / 2);
      bottomBar.setY(this.scale.height - barHeight / 2);
      this.tweens.add({
        targets: [kicker, nameText, rules],
        alpha: 1,
        duration: 150,
        onComplete: holdThenExit,
      });
      return;
    }

    this.tweens.add({
      targets: topBar,
      y: barHeight / 2,
      duration: 260,
      ease: 'Cubic.easeOut',
    });
    this.tweens.add({
      targets: bottomBar,
      y: this.scale.height - barHeight / 2,
      duration: 260,
      ease: 'Cubic.easeOut',
    });
    this.tweens.add({
      targets: [kicker, nameText],
      alpha: 1,
      duration: 240,
      delay: 140,
      ease: 'Sine.easeOut',
    });
    rules.setAlpha(1);
    this.tweens.add({
      targets: ruleState,
      spread: ruleMax,
      duration: 300,
      delay: 180,
      ease: 'Cubic.easeOut',
      onUpdate: drawRules,
      onComplete: holdThenExit,
    });
  }

  /** Tears down the boss-intro letterbox (also runs on death/restart via cleanupBossWarning). */
  private cleanupBossIntro(): void {
    if (this.bossIntroRuleState) {
      this.tweens.killTweensOf(this.bossIntroRuleState);
      this.bossIntroRuleState = null;
    }
    for (const obj of this.bossIntroObjects) {
      this.tweens.killTweensOf(obj);
      obj.destroy();
    }
    this.bossIntroObjects = [];
  }

  /** Large center-screen wave landmark banner (endless cycles + gauntlet waves). */
  private showWaveBanner(bannerMessage: string, bannerColor: string): void {
    const bannerDepth = 1200;
    const bannerText = this.add.text(
      this.scale.width / 2,
      this.scale.height / 4,
      bannerMessage,
      {
        fontSize: '48px',
        color: bannerColor,
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
    const minibossIds = ['glutton', 'swarm_mother', 'charger', 'necromancer', 'twin_a', 'bombard', 'stalker'];
    const randomId = minibossIds[Math.floor(Math.random() * minibossIds.length)];
    this.spawnMiniboss(randomId);
  }

  /**
   * Variety boss for an endless wave or a gauntlet wave. Walks a run-local
   * cursor so a long run keeps rotating without spending the persisted
   * rotation, which belongs to the 10-minute boss.
   */
  private spawnNextBoss(): void {
    this.spawnBoss(this.bossFightDirector.nextVarietyBossTypeId());
  }

  /** True while any miniboss/boss-tier enemy (xpValue >= 30) is alive. */
  private hasAliveGauntletThreat(): boolean {
    const enemyIds = getFrameCacheEnemyIds();
    for (let enemyIndex = 0; enemyIndex < enemyIds.length; enemyIndex++) {
      if ((EnemyType.xpValue[enemyIds[enemyIndex]] || 0) >= 30) return true;
    }
    return false;
  }

  /** True while a boss-tier enemy (xpValue >= 1000) other than `dyingBossId` is alive. */
  private hasOtherAliveBoss(dyingBossId: number): boolean {
    const enemyIds = getFrameCacheEnemyIds();
    for (let enemyIndex = 0; enemyIndex < enemyIds.length; enemyIndex++) {
      const enemyId = enemyIds[enemyIndex];
      if (enemyId !== dyingBossId && (EnemyType.xpValue[enemyId] || 0) >= 1000) return true;
    }
    return false;
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
        this.takeDamage(damage, undefined, 'Ground Slam');

        // Knockback from slam (skipped when Juggernaut ship's immunity is active)
        if (!this.playerStats.knockbackImmunity) {
          const knockbackDir = Math.atan2(playerY - y, playerX - x);
          Knockback.velocityX[this.playerId] = Math.cos(knockbackDir) * 400;
          Knockback.velocityY[this.playerId] = Math.sin(knockbackDir) * 400;
        }
      }
    }

    this.damageEscortDroneByBlast(damage, x, y, radius);

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
    const field = this.worldMode.fieldRect();
    const minX = field.minX + arenaMargin;
    const maxX = field.maxX - arenaMargin;
    const minY = field.minY + arenaMargin;
    const maxY = field.maxY - arenaMargin;

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
      this.recordRunTimelineEvent('level');

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
            tier: 'rare',
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

    // A fresh level-up starts with an unlocked hand — locks only pin across the
    // reroll/banish refreshes of one modal session.
    this.lockedUpgrades = [];

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

    // One-time tutorial toast on the first level-up ever. Previously gated on
    // !isTutorialSeen(), which the coach marks set true at run start — so it
    // never fired. The per-hint flag actually shows it once.
    if (this.playerStats.level === 2 && getTutorialHintManager().maybeShow('first-level-up')) {
      const levelUpHint = getTutorialHintDef('first-level-up');
      this.toastManager.showToast({
        tier: 'critical',
        title: levelUpHint.title,
        description: levelUpHint.description,
        icon: levelUpHint.icon,
        color: levelUpHint.color,
        duration: levelUpHint.duration,
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

    // Get random combined upgrades (stats + weapons), excluding banished;
    // luck biases offers toward rare/epic upgrades
    const availableUpgrades = getRandomCombinedUpgrades(
      this.upgrades,
      this.weaponManager,
      totalChoices,
      this.playerStats.level,
      this.banishedUpgradeIds,
      this.playerStats.luck
    ).filter(u => !(u.upgradeType === 'weapon' && u.requiresSwap));

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
   * Selects the best upgrade for auto-buy. The scoring lives in
   * `src/game/autobuy/autoBuyScoring.ts`; the scene only supplies the run snapshot.
   */
  private selectAutoBuyUpgrade(availableUpgrades: CombinedUpgrade[]): CombinedUpgrade {
    return selectBestAutoBuyUpgrade(availableUpgrades, {
      playerLevel: this.playerStats.level,
      autoUpgradeLevel: getMetaProgressionManager().getAutoUpgradeLevel(),
      isHealthStruggling: this.isHealthStruggling,
      canAddWeapon: this.weaponManager.canAddWeapon(),
      ownedWeaponIds: this.weaponManager.getAllWeapons().map(weapon => weapon.id),
      upgrades: this.upgrades,
    });
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
    notification.setDepth(HUD_OVERLAY_DEPTH);

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

    // Get random combined upgrades (stats + weapons), excluding banished;
    // luck biases offers toward rare/epic upgrades
    const freshUpgrades = getRandomCombinedUpgrades(
      this.upgrades,
      this.weaponManager,
      totalChoices,
      this.playerStats.level,
      this.banishedUpgradeIds,
      this.playerStats.luck
    );

    // Pin any locked cards from a prior reroll/banish of this same level-up to
    // the front, then fill the rest from the fresh roll.
    const availableUpgrades = mergeLockedIntoOffers(this.lockedUpgrades, freshUpgrades, totalChoices);

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
        return;
      }
      // An orientation flip during the modal deferred its relayout (a
      // restart underneath would have orphaned the modal) — settle it now.
      if (this.pendingOrientationRelayout) {
        this.pendingOrientationRelayout = false;
        this.handleOrientationFlip();
      }
    };

    // Calculate weapon slot info for final slot warning
    const isWeaponMilestone = this.playerStats.level % 5 === 0;
    const currentWeapons = this.weaponManager.getWeaponCount();
    const maxWeapons = this.weaponManager.getMaxWeaponSlots();
    const remainingSlots = maxWeapons - currentWeapons;
    // Show warning when on weapon milestone with exactly 1 slot left
    const isLastWeaponSlot = isWeaponMilestone && remainingSlots === 1;

    const equippedWeapons = this.weaponManager.getAllWeapons().map((weapon) => ({
      id: weapon.id,
      name: weapon.name,
      level: weapon.getLevel(),
    }));

    // Launch upgrade scene with combined upgrades and utility callbacks
    this.scene.launch('UpgradeScene', {
      upgrades: availableUpgrades,
      rerollsRemaining: this.playerStats.rerollsRemaining,
      skipsRemaining: this.playerStats.skipsRemaining,
      banishesRemaining: this.playerStats.banishesRemaining,
      lockedUpgradeIds: this.lockedUpgrades.map(u => u.id),
      // Weapon slot warning info
      isLastWeaponSlot,
      weaponSlotsInfo: { current: currentWeapons, max: maxWeapons },
      // Break gate and milestone data
      allStatUpgrades: this.upgrades,
      playerLevel: this.playerStats.level,
      equippedWeapons,
      onSelect: (selectedUpgrade: CombinedUpgrade, scrapWeaponId?: string) => {
        // Free the slot before applying, so the new weapon's addWeapon() finds room.
        if (scrapWeaponId) this.scrapWeapon(scrapWeaponId);
        this.applyCombinedUpgrade(selectedUpgrade);
        handleSelectionComplete();
      },
      onReroll: (lockedUpgrades: Upgrade[]) => {
        // Keep the player's locked cards, decrement rerolls, refresh the rest.
        this.lockedUpgrades = lockedUpgrades as CombinedUpgrade[];
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
      onBanish: (upgrade: CombinedUpgrade, lockedUpgrades: Upgrade[]) => {
        // Add to banished set, keep surviving locks, refresh with new options.
        this.banishedUpgradeIds.add(upgrade.id);
        this.lockedUpgrades = lockedUpgrades as CombinedUpgrade[];
        this.playerStats.banishesRemaining--;
        this.scene.stop('UpgradeScene');
        this.time.delayedCall(50, () => {
          this.showUpgradeSelection();
        });
      },
    });
  }

  /**
   * Trade an equipped weapon away for a REFIT pick: the slot frees, the invested levels are
   * lost, and the weapon is banished for the rest of the run so it cannot be re-taken at
   * level 1 to launder the trade.
   */
  private scrapWeapon(weaponId: string): void {
    const weapon = this.weaponManager.getWeapon(weaponId);
    if (!weapon) return;
    const scrappedName = weapon.displayName;
    const scrappedIcon = weapon.icon;
    if (!this.weaponManager.removeWeapon(weaponId)) return;
    this.scrappedWeaponIds.push(weaponId);
    this.banishedUpgradeIds.add(`add_${weaponId}`);
    this.toastManager?.showToast({
      tier: 'notable',
      title: `SCRAPPED: ${scrappedName}`,
      description: 'Slot freed for the refit',
      icon: scrappedIcon,
      color: 0xff8844,
      duration: 3000,
    });
  }

  /**
   * Applies a combined upgrade (stat or weapon).
   */
  private applyCombinedUpgrade(upgrade: CombinedUpgrade): void {
    const achievementManager = getAchievementManager();
    const healthBeforeUpgrade = this.playerStats.currentHealth;

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
    this.grantBuildHeal(this.playerStats.currentHealth - healthBeforeUpgrade);

    // Check for weapon evolutions after every upgrade
    const statUpgrades = this.upgrades.map(u => ({ id: u.id, currentLevel: u.currentLevel }));
    const evolutionResult = this.weaponManager.checkEvolutions(statUpgrades, this.evolutionLevelReduction);
    if (evolutionResult) {
      getCodexManager().discoverEvolution(evolutionResult.evolution);
    }
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
        tier: 'rare',
        title: `EVOLVED: ${evolutionResult.evolution.evolvedName}`,
        description: evolutionResult.evolution.evolvedDescription,
        icon: evolutionResult.weapon.icon,
        color: 0xffd700,
        duration: 5000,
      });
      this.soundManager.playAchievementUnlock();
    } else if (this.toastManager && !getTutorialHintManager().hasSeen('evolution-progress')) {
      // One-time teach: a weapon just reached its evolution level but the
      // required stat lags — point the player at the missing half.
      const blocked = findBlockedEvolution(
        this.weaponManager.getAllWeapons().map(w => ({
          id: w.id, name: w.name, level: w.getLevel(), isEvolved: w.isEvolved,
        })),
        this.upgrades.map(u => ({ id: u.id, name: u.name, currentLevel: u.currentLevel })),
        this.evolutionLevelReduction
      );
      if (blocked && getTutorialHintManager().maybeShow('evolution-progress')) {
        const evolutionHint = getTutorialHintDef('evolution-progress');
        this.toastManager.showToast({
          tier: 'critical',
          title: evolutionHint.title,
          description: formatEvolutionHint(blocked),
          icon: evolutionHint.icon,
          color: evolutionHint.color,
          duration: evolutionHint.duration,
        });
      }
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
   * Applies a stage's visual palette to the grid background and adds its ambient color
   * overlay. Safe to call after GridBackground is created, and safe to call repeatedly:
   * an expedition re-applies it per region, so the previous overlay has to be destroyed
   * first or every region border would stack another tinted rectangle over the run.
   */
  private applyStageVisuals(stageId: string = this.selectedStageId): void {
    const stage = getStageById(stageId) ?? getDefaultStage();
    this.activeStageId = stage.id;
    this.activeStageDriftFactor = resolveStageDriftFactor(stage);
    this.activeStageWallShiftSeconds = resolveStageWallShiftSeconds(stage);
    this.activeStageDeathBloomSeconds = resolveStageDeathBloomSeconds(stage);
    this.activeStageDeathBloomType = signatureHazardType(stage.id);
    for (const overlayName of ['stageAmbientOverlay', 'stageDarknessOverlay']) {
      const previousOverlay = this.children.getByName(overlayName);
      if (previousOverlay) previousOverlay.destroy();
    }
    if (this.gridBackground) {
      this.gridBackground.setColorPalette(
        stage.gridLineColor,
        stage.gridPulseColor,
        stage.gridWarpHighlightColor
      );
    }
    const overlayDepth = 2; // above grid (depth 0-1), below gameplay
    if (stage.ambientOverlayAlpha > 0) {
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

    this.activeStageAmbientDarkness = resolveStageAmbientDarkness(stage);
    this.lightingSystem?.setAmbientDarkness(this.activeStageAmbientDarkness);
    // The lighting pass is switched off entirely on low quality, so a dark region would
    // silently be no region at all there. The fallback is a flat black plate at the ambient
    // overlay's depth: it reads as an unlit place without hiding a single threat, because
    // depth 2 is under gameplay. A low-end device gets the atmosphere, never a harder game.
    const darknessBoost = this.activeStageAmbientDarkness - BASE_AMBIENT_DARKNESS;
    if (darknessBoost > 0 && this.visualQuality === 'low') {
      this.add
        .rectangle(
          this.scale.width / 2,
          this.scale.height / 2,
          this.scale.width,
          this.scale.height,
          0x000000,
          darknessBoost
        )
        .setDepth(overlayDepth)
        .setScrollFactor(0)
        .setName('stageDarknessOverlay');
    }
  }

  /**
   * An expedition's named regions ARE stages: the room takes its palette, its ambient light,
   * its hazard signature and its pack from the region it belongs to. The spine keeps whatever the
   * player launched with, so a funnel stage pick still governs the world's home region
   * instead of being overwritten a frame after launch.
   * Returns whether this entry actually crossed a region border, which is the banner's cue
   * to state the new region's signature instead of repeating it room by room.
   */
  private applySectorStage(sector: SectorDef): boolean {
    const regionStageId = sector.biomeId === SPINE_BIOME_ID
      ? this.selectedStageId
      : sector.biomeId;
    const stage = getStageById(regionStageId) ?? getDefaultStage();
    if (stage.id === this.activeStageId) return false;
    setHazardZoneStage(stage.id);
    setDirectorStage(stage.id);
    this.applyStageVisuals(stage.id);
    return true;
  }

  /**
   * README section 6's third named sector-scale mechanic: a region that rearranges itself while
   * the ship is inside it. The write is the ambient shift's own pair of runs under its own
   * exactness proof, so a live shift cannot seal a route, strand a POI or close a doorway; the
   * two invalidations after it are the same pair every mid-run tile writer in this scene runs
   * (a broken wall, an ability door, a quest door, a breached grid). Math.random rather than a
   * seeded stream on purpose: nothing here is persisted or replayed, so no save has to agree
   * with it, unlike every generator in ambientStir.
   */
  private updateRegionWallShift(deltaSeconds: number): void {
    if (this.activeStageWallShiftSeconds <= 0 || this.playerId === -1) return;
    const map = this.worldMode.worldMap();
    if (!map || this.worldMode.isSectorLocked()) return;

    this.regionWallShiftTimer += deltaSeconds;
    if (this.regionWallShiftTimer < this.activeStageWallShiftSeconds) return;
    this.regionWallShiftTimer = 0;

    const playerX = Transform.x[this.playerId];
    const playerY = Transform.y[this.playerId];
    const coord = sectorOfWorldPoint(playerX, playerY);
    const key = sectorKey(coord);
    const sector = map.sectors.get(key);
    // The same three rooms pickStirredSectorKeys refuses: the hangar is the one room a recall
    // guarantees is safe, the arena's floor is scripted by its own seal, and a hidden room's
    // first entry is already its own event.
    if (!sector || sector.isStart || sector.isBossArena || sector.hidden === true) return;
    const spent = this.wallShiftsBySector.get(key) ?? 0;
    if (spent >= LIVE_WALL_SHIFT_MAX_EVENTS_PER_SECTOR) return;

    const origin = sectorOriginWorld(coord);
    const shipTileX = Math.floor((playerX - origin.x) / TILE_SIZE);
    const shipTileY = Math.floor((playerY - origin.y) / TILE_SIZE);
    const hullClearance = new Set<number>();
    for (let y = shipTileY - LIVE_WALL_SHIFT_HULL_CLEARANCE_TILES;
      y <= shipTileY + LIVE_WALL_SHIFT_HULL_CLEARANCE_TILES; y++) {
      for (let x = shipTileX - LIVE_WALL_SHIFT_HULL_CLEARANCE_TILES;
        x <= shipTileX + LIVE_WALL_SHIFT_HULL_CLEARANCE_TILES; x++) {
        if (isTileInBounds(x, y)) hullClearance.add(tileIndex(x, y));
      }
    }

    const runs = applyLiveWallShift(sector, Math.random, hullClearance);
    if (!runs) return;
    this.wallShiftsBySector.set(key, spent + 1);

    this.worldMode.notifyGeometryChanged();
    this.minimapFeed.invalidateUnderlay();
    for (const run of [...runs.opened, ...runs.collapsed]) {
      const centre = run[Math.floor(run.length / 2)];
      this.effectsManager.playDeathBurst(
        origin.x + (centre % SECTOR_TILE_COLS) * TILE_SIZE + TILE_SIZE / 2,
        origin.y + Math.floor(centre / SECTOR_TILE_COLS) * TILE_SIZE + TILE_SIZE / 2,
        WORLD_GEOMETRY_COLORS.solid.stroke,
      );
    }
    this.cameras.main.shake(160, 0.005);
    this.soundManager.playComboThreshold();
  }

  /** A region that authors a bloom keeps what dies in it: an elite kill opens the region's own
   *  signature hazard where it fell. Elite-or-better only, so a swarm cannot carpet a room, and
   *  capped at the ambient spawner's own concurrency cap so blooms can never starve it. */
  private spawnRegionDeathBloom(x: number, y: number, isEliteOrBetter: boolean): void {
    if (!isEliteOrBetter) return;
    if (this.activeStageDeathBloomSeconds <= 0) return;
    if (this.activeStageDeathBloomType === null) return;
    if (this.worldMode.worldMap() === null) return;
    if (getActiveHazardZoneCount() >= TUNING.hazards.maxConcurrentZones) return;

    spawnHazardZone(
      x, y,
      REGION_DEATH_BLOOM_RADIUS,
      this.activeStageDeathBloomType,
      this.activeStageDeathBloomSeconds,
    );
  }

  /**
   * Resolves the neon color palette for the currently-selected ship,
   * falling back to default blue on unknown/missing ships.
   */
  private getShipNeonColor() {
    const ship = getShipById(this.selectedShipId) ?? getDefaultShip();
    const shipPalette = SHIP_NEON_PALETTES[ship.neonColorId] ?? SHIP_NEON_PALETTES.cyan;
    const equippedPaint = resolveActivePaint(
      getHiddenUnlockManager().getUnlockedTargetIds(),
      getShipPaintManager().getSelectedPaintId(),
    );
    return equippedPaint ? equippedPaint.color : shipPalette;
  }

  /**
   * Resolves the hull family for the currently-selected ship — the unique
   * per-ship silhouette PlayerSpaceship draws across all evolution tiers.
   */
  private getShipHullId(): string {
    const ship = getShipById(this.selectedShipId) ?? getDefaultShip();
    return ship.hullId;
  }

  /**
   * Resets every module-level / singleton system that holds run-scoped state so
   * a new run starts clean. Called from BOTH the fresh-start and save-restore
   * paths in create(). The zero-argument module resets live in
   * `src/systems/runResetRegistry.ts`, where `runResetRegistry.test.ts` fails the
   * build if a `reset*` export under src/systems or src/ecs is missing from the
   * list; only the calls that need the scene or the run's strategy stay here.
   */
  private resetAllRunSystems(): void {
    runAllRunResets();
    resetShapeTextureCache(this);
    resetEnemyTextureCache(this);
    destroyGemAtlases(this);
    destroyProjectileAtlases(this);
    resetDirectorSystem(this.directorStrategy);
    this.trophyUnlockedThisRun = null;
    // A boss's trophy is earned by beating it and spends from the NEXT run
    // onward: the boss kill ends this one. The codex's persisted per-enemy kill
    // count is already the durable record of "have I beaten this boss", so no
    // new storage key is needed.
    getRelicManager().reset(
      getUnlockedBossTrophies(
        (bossEnemyTypeId) => (getCodexManager().getEnemyEntry(bossEnemyTypeId)?.timesKilled ?? 0) > 0,
      ),
    );
  }

  /**
   * Lands a heal produced by a build change (Vitality, Fortify, heal-granting relics) on
   * the ECS Health component. `playerStats.currentHealth` is only a lagging mirror of
   * `Health.current`: syncStatsToPlayer clamps it downward and never raises it, so a grant
   * written to the mirror is dropped, then overwritten from the ECS on the next takeDamage.
   * Callers pass the mirror's delta measured across the grant, and only after
   * syncStatsToPlayer has widened Health.max — otherwise the new headroom clamps the heal away.
   */
  private grantBuildHeal(healAmount: number): void {
    if (this.playerId === -1 || healAmount <= 0) return;
    Health.current[this.playerId] = Math.min(
      Health.max[this.playerId],
      Health.current[this.playerId] + healAmount
    );
    this.playerStats.currentHealth = Health.current[this.playerId];
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
      this.playerStats.attackSpeedMultiplier / Math.max(0.1, this.playerStats.cooldownMultiplier),
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

    // Amplify weapon-pair synergy bonuses by the weaponSynergy stat (Synergy
    // meta upgrade + Synergy Chain relic). Change-guarded, so a mid-run relic
    // pickup re-applies synergies and the per-frame call is otherwise a no-op.
    this.weaponManager.setSynergyBonus(this.playerStats.weaponSynergy);

    // Set overcharge stun duration for chain lightning
    this.weaponManager.setOverchargeStunDuration(this.playerStats.overchargeStunDuration);

    // Feed the dedicated chain-lightning jump count (chainLightningCount stat —
    // Chain Catalyst relic + chainCountLevel meta upgrade). Change-guarded, so a
    // mid-run relic pickup adds jumps immediately and the per-frame call is a no-op.
    this.weaponManager.setChainLightningBonusCount(this.playerStats.chainLightningCount);

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

        // Zigzag Runner gets a brighter orange engine wash; other fast enemies stay red.
        if (EnemyAI.aiType[enemyId] === EnemyAIType.Zigzag) {
          this.trailManager.addTrailPoint(enemyId, ex, ey, 0xff8833, 7);
        } else {
          this.trailManager.addTrailPoint(enemyId, ex, ey, 0xff6666, 5);
        }
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
      // The ternaries keep a disabled barrier from drawing charges it could not spend.
      // Barrier Capacity now enables the barrier at run start, so a paid barrier is
      // meant to draw from frame one — that is the fix, not a premature render.
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

      // Fast movers (e.g. darting Zigzags) disturb the field a touch more.
      const evx = Velocity.x[enemyId];
      const evy = Velocity.y[enemyId];
      if (evx * evx + evy * evy > 14400) { // speed > 120
        weight *= 1.3;
      }

      // Reuse pooled object in-place
      const entry = this.gridEnemyDataPool[i];
      entry.x = Transform.x[enemyId];
      entry.y = Transform.y[enemyId];
      entry.weight = weight;
    }

    // Pass slice view of pool (only active entries)
    this.gridBackground.setGravityPoints(playerPos, this.gridEnemyDataPool, this.gridEnemyDataLength);

    // Dynamic grid intensity — scales with combat state. Gauntlet bosses
    // never set bossSpawned (that flag belongs to the stage schedule), so the
    // live boss-fight cue rides on activeBossType there.
    const maxEnemies = 100;
    const enemyRatio = this.enemyCount / maxEnemies;
    const bossFightLive = this.bossFightDirector.hasSpawned() || this.bossFightDirector.isBossActive();
    const bossActive = bossFightLive ? 0.3 : 0;
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
      if (bossFightLive) {
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
      this.bloomPipeline.setBloomStrength(this.comboBloomStrength());
    }
  }

  /**
   * Combo-tier bloom strength, scaled down on reduced quality. create() sets
   * medium quality up for subtler bloom (0.2 vs high's 0.35), but the
   * per-frame combo escalation used to overwrite that with the full-strength
   * tier value — at inferno (0.5) exactly when object count tanks the FPS and
   * auto-quality drops, so the harsh glow appeared to come from the quality
   * change itself.
   */
  private comboBloomStrength(): number {
    const base = COMBO_TIER_BLOOM_STRENGTH[getComboTier()] ?? 0.25;
    return this.visualQuality === 'high' ? base : base * 0.55;
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
      // Update parallax background quality
      if (this.parallaxBackground) this.parallaxBackground.setQuality(newQuality);
      // Update death ripple quality
      if (this.deathRippleManager) {
        this.deathRippleManager.setQuality(newQuality);
      }
      // Update status effect visual quality
      if (this.statusEffectVisualManager) {
        this.statusEffectVisualManager.setQuality(newQuality);
      }
      // Update elite affix visual quality
      if (this.eliteAffixVisualManager) {
        this.eliteAffixVisualManager.setQuality(newQuality);
      }
      // Update attack telegraph quality
      if (this.telegraphManager) {
        this.telegraphManager.setQuality(newQuality);
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
      // Which of the two dark-region paths is in force is a function of the quality setting,
      // so the region has to be re-applied when it changes. applyStageVisuals is idempotent
      // by contract and re-applies the SAME stage, so nothing else moves.
      this.applyStageVisuals(this.activeStageId);
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
    setEnemyAIFieldRect(this.worldMode.fieldRect());

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

    // Parallax field is sized at construction; recreate to pick up new dimensions
    if (this.parallaxBackground) {
      this.parallaxBackground.destroy();
      this.parallaxBackground = new ParallaxBackground(this);
      this.parallaxBackground.setQuality(this.visualQuality);
    }

    // Delegate all HUD repositioning to the HUD manager
    this.hudManager.handleResize(w, h);
  }

  /**
   * Clean up event listeners and resources when scene shuts down.
   * Critical for preventing input conflicts and memory leaks on restart.
   */
  shutdown(): void {
    // Detach the run-context delivery closure — a dead scene must not receive
    // unlocks (mirrors CardsScene / ShopScene). create() re-wires it each run.
    getAchievementManager().setAchievementUnlockCallback(null);

    // Unbind the shared JuiceManager so stale scene references don't leak
    // into the menu session or future runs. Covers both create paths
    // (fresh and save-restore) — each binds, only this releases.
    getJuiceManager().setScene(null);

    // Remove resize listener
    this.scale.off('resize', this.handleResize, this);

    // Tear down intro overlays + their listeners if the scene exits before the
    // player finished dismissing them. These teardowns do NOT fire the
    // start-game callback — the run is ending, not starting.
    if (this.coachMarksCleanup) {
      this.coachMarksCleanup();
      this.coachMarksCleanup = null;
    }
    if (this.modifierBannerCleanup) {
      this.modifierBannerCleanup();
      this.modifierBannerCleanup = null;
    }
    this.introOverlayActive = false;

    // Remove ESC key to prevent it persisting across restarts
    if (this.escKey) {
      this.escKey.destroy();
      this.escKey = null;
    }

    if (this.recallRing) {
      this.recallRing.destroy();
      this.recallRing = null;
    }
    this.recallChannelRemaining = 0;
    this.recallChannelTarget = null;
    this.recallChannelIsSortie = false;
    this.sortieAnchor = null;

    if (this.phaseBleedRenderer) {
      this.phaseBleedRenderer.destroy();
      this.phaseBleedRenderer = null;
    }
    phaseBleedTiles.length = 0;
    phaseBleedSeenTileKeys.clear();

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

    if (this.practiceSpawnKeyHandler) {
      this.input.keyboard?.off('keydown-B', this.practiceSpawnKeyHandler);
      this.practiceSpawnKeyHandler = null;
    }
    if (this.practiceUltimateKeyHandler) {
      this.input.keyboard?.off('keydown-U', this.practiceUltimateKeyHandler);
      this.practiceUltimateKeyHandler = null;
    }
    if (this.practiceDock) {
      this.practiceDock.destroy();
      this.practiceDock = null;
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

    // Remove ultimate request handler
    if (this.ultimateRequestHandler) {
      this.events.off('input-ultimate-requested', this.ultimateRequestHandler);
      this.ultimateRequestHandler = null;
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

    // Remove world-map request handler
    if (this.mapRequestHandler) {
      this.events.off('input-map-requested', this.mapRequestHandler);
      this.mapRequestHandler = null;
    }
    // A restart while the map is open would leave the overlay scene running over the new run.
    if (this.mapOverlayActive) {
      this.scene.stop('MapScene');
      this.mapOverlayActive = false;
    }

    // Clean up input controller (joystick, focus handlers, shift key)
    if (this.inputController) {
      this.inputController.destroy();
    }

    // Remove page-lifecycle save handlers for game state persistence
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      window.removeEventListener('pagehide', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.visibilitySaveHandler) {
      document.removeEventListener('visibilitychange', this.visibilitySaveHandler);
      this.visibilitySaveHandler = null;
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
    this.bossFightDirector.clearActiveBoss();

    // Clean up post-processing and lighting
    if (this.lightingSystem) {
      this.lightingSystem.destroy();
      this.lightingSystem = null;
    }
    this.distortionPipeline = null;
    if (this.renderer.type === Phaser.WEBGL && this.cameras?.main) {
      this.cameras.main.removePostPipeline('DistortionPipeline');
    }

    // A scene restart reuses this camera, so expedition's follow, bounds and deadzone
    // would otherwise leak into the next arena run.
    if (this.cameras?.main) {
      const camera = this.cameras.main;
      camera.stopFollow();
      camera.removeBounds();
      camera.setDeadzone();
      camera.setScroll(0, 0);
    }

    // The adapter owns Phaser objects of its own (the world geometry layer), and a scene
    // restart reuses the scene but never the adapter.
    if (this.worldMode) {
      this.worldMode.destroy();
    }

    // Clean up grid background and trail manager
    if (this.gridBackground) {
      this.gridBackground.destroy();
    }
    if (this.trailManager) {
      this.trailManager.destroy();
    }
    if (this.parallaxBackground) {
      this.parallaxBackground.destroy();
    }
    if (this.deathRippleManager) {
      this.deathRippleManager.destroy();
    }
    if (this.statusEffectVisualManager) {
      this.statusEffectVisualManager.destroy();
      this.eliteAffixVisualManager.destroy();
      this.telegraphManager.destroy();
      setTelegraphManager(null);
      setNavigationContext(null);
      setBarrierEventSink(null);
      this.events.off('expedition:sector-entered', this.sectorEnteredHandler);
      getDiscoveryManager().onDiscovery(null);
    }
    if (this.offScreenIndicatorManager) {
      this.offScreenIndicatorManager.destroy();
    }
    if (this.minimapManager) {
      this.minimapManager.destroy();
    }
    // Field shrine + chest + bounty cleanup (plain Phaser objects).
    this.shrineManager.clear();
    this.activeChests.forEach(chest => chest.graphics.destroy());
    this.activeChests = [];
    this.poiSlotObjects.clear();
    this.abilityVaultManager.clear();
    this.secretCacheManager.clear();
    this.questBoardManager.clear();
    this.clearAmbushNests();
    this.clearNemesisLairs();
    this.clearWardenThrone();
    this.wardenThroneSectorKey = null;
    this.clearQuestCargoDrop();
    this.questCargoDropSectorKey = null;
    this.bountyText?.destroy();
    this.bountyText = null;
    this.sectorBannerText = null;
    // Restore music to the user's volume (clears any combat-intensity lift).
    resetMusicIntensityDriver();

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

    this.enemyProjectileManager.destroy();

    // Clean up effects manager
    if (this.effectsManager) {
      this.effectsManager.destroy();
    }

  }
}
