/**
 * EnemyAI system barrel export.
 * Re-exports the public API so existing imports work unchanged.
 */
export {
  // State management
  updateAIGameTime,
  setEnemyAIBounds,
  resetEnemyAISystem,
  // Spawn callbacks
  setEnemyProjectileCallback,
  setMinionSpawnCallback,
  setXPGemCallbacks,
  setBossCallbacks,
  resetBossCallbacks,
  // Death tracking
  recordEnemyDeath,
  // Twin management
  linkTwins,
  unlinkTwin,
  getLinkedTwin,
  getAllTwinLinks,
} from './state';

// Shared constants + injected per-frame context
export { PI_HALF, PI_TWO, telegraphManager, setTelegraphManager, setAIWorld, isDestructible } from './common';

// Regular enemy behaviors (aiType < 50), one module per handler
export { updateChaseAI } from './chase';
export { updateZigzagAI } from './zigzag';
export { updateDashAI } from './dash';
export { updateCircleAI } from './circle';
export { updateSwarmAI } from './swarm';
export { updateTankAI } from './tank';
export { updateExploderAI } from './exploder';
export { updateShooterAI } from './shooter';
export { updateSniperAI } from './sniper';
export { updateHealerAI } from './healer';
export { updateShieldedAI } from './shielded';
export { updateTeleporterAI } from './teleporter';
export { updateGiantAI } from './giant';
export { updateSplitterAI, updateSplitterMiniAI } from './splitter';
export { updateGhostAI } from './ghost';
export { updateLurkerAI } from './lurker';
export { updateWardenAI } from './warden';
export { updateWraithAI } from './wraith';
export { updateRallierAI } from './rallier';

// Miniboss behaviors, one module per handler
export { updateGluttonAI } from './glutton';
export { updateSwarmMotherAI } from './swarm-mother';
export { updateChargerAI } from './charger';
export { updateNecromancerAI } from './necromancer';
export { updateTwinAI } from './twin';

// Boss behaviors + shared boss-phase tracking
export { updateHordeKingAI } from './horde-king';
export { updateVoidWyrmAI } from './void-wyrm';
export { updateTheMachineAI } from './the-machine';
export { checkBossPhaseTransition, resetBossPhaseTracking } from './boss-phase';

// Elite proximity auras (Tank / Rallier / Warden)
export { applyEliteAuras, isNearTankAura, getWardenSlowMultiplier } from './elite-auras';

// The main system function (dispatcher + LOD only) stays in the original file.
export { enemyAISystem } from '../EnemyAISystem';
