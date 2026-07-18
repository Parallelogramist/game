import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity, PlayerTag, EnemyTag, EnemyAI, StatusEffect } from '../components';
import { EnemyAIType } from '../../enemies/EnemyTypes';
// Shared constants + per-frame context (telegraph manager, world ref) live in
// enemy-ai/common so behavior modules can use them without importing this file.
import { setAIWorld } from './enemy-ai/common';
// Enemy behaviors, one module per handler:
// regular enemies (aiType < 50)
import { updateChaseAI } from './enemy-ai/chase';
import { updateZigzagAI } from './enemy-ai/zigzag';
import { updateDashAI } from './enemy-ai/dash';
import { updateCircleAI } from './enemy-ai/circle';
import { updateSwarmAI } from './enemy-ai/swarm';
import { updateTankAI } from './enemy-ai/tank';
import { updateExploderAI } from './enemy-ai/exploder';
import { updateShooterAI } from './enemy-ai/shooter';
import { updateSniperAI } from './enemy-ai/sniper';
import { updateHealerAI } from './enemy-ai/healer';
import { updateShieldedAI } from './enemy-ai/shielded';
import { updateTeleporterAI } from './enemy-ai/teleporter';
import { updateGiantAI } from './enemy-ai/giant';
import { updateSplitterAI, updateSplitterMiniAI } from './enemy-ai/splitter';
import { updateGhostAI } from './enemy-ai/ghost';
import { updateLurkerAI } from './enemy-ai/lurker';
import { updateWardenAI } from './enemy-ai/warden';
import { updateWraithAI } from './enemy-ai/wraith';
import { updateRallierAI } from './enemy-ai/rallier';
// minibosses
import { updateGluttonAI } from './enemy-ai/glutton';
import { updateSwarmMotherAI } from './enemy-ai/swarm-mother';
import { updateChargerAI } from './enemy-ai/charger';
import { updateNecromancerAI } from './enemy-ai/necromancer';
import { updateTwinAI } from './enemy-ai/twin';
import { updateBombardAI } from './enemy-ai/bombard';
// bosses
import { updateHordeKingAI } from './enemy-ai/horde-king';
import { updateVoidWyrmAI } from './enemy-ai/void-wyrm';
import { updateTheMachineAI } from './enemy-ai/the-machine';
import { updateBastionAI } from './enemy-ai/bastion';
import { updatePulsarAI } from './enemy-ai/pulsar';
import { updateObeliskAI } from './enemy-ai/obelisk';
import { updateLegionAI, updateLegionFragmentAI } from './enemy-ai/legion';
// Elite proximity auras (Tank / Rallier / Warden), applied after all AI runs
import { applyEliteAuras } from './enemy-ai/elite-auras';

// Re-export public API from the enemy-ai modules for backwards compatibility
export {
  setEnemyAIBounds, setEnemyProjectileCallback, setMinionSpawnCallback,
  setXPGemCallbacks, setBossCallbacks, resetBossCallbacks,
  recordEnemyDeath, linkTwins, unlinkTwin, getLinkedTwin, getAllTwinLinks,
  resetEnemyAISystem, updateAIGameTime,
  setBossPhaseTransitionCallback,
} from './enemy-ai/state';
export { setTelegraphManager } from './enemy-ai/common';
export { resetBossPhaseTracking } from './enemy-ai/boss-phase';
export { resetBastionStrikes } from './enemy-ai/bastion';
export { resetPulsarStrikes } from './enemy-ai/pulsar';
export { resetObeliskStrikes } from './enemy-ai/obelisk';
export { resetBombardStrikes } from './enemy-ai/bombard';
export {
  resetLegionSystem,
  registerLegionRoot,
  registerLegionChild,
  onLegionMemberDeath,
  registerRestoredLegionMembers,
  forEachLegionGroup,
  legionPotentialMultiplier,
  legionPoolFromMember,
  legionChildSpawnOffsets,
  legionGenerationForType,
  isLegionTypeId,
} from './enemy-ai/legion-split';
export { isNearTankAura, getWardenSlowMultiplier } from './enemy-ai/elite-auras';

// Queries
const enemyQuery = defineQuery([Transform, Velocity, EnemyTag, EnemyAI]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// LOD frame counter for distance-based AI throttling
let aiLodFrame = 0;

/**
 * EnemyAISystem — the per-frame AI dispatcher. All behavior handlers (regular,
 * miniboss, boss) live in ./enemy-ai/, one module per handler; this file only
 * routes each enemy to its handler by aiType and applies distance-based LOD:
 * far enemies update less frequently to support 2000+ count.
 */
export function enemyAISystem(world: IWorld, deltaTime: number = 0.016): IWorld {
  setAIWorld(world);
  const enemies = enemyQuery(world);
  const players = playerQuery(world);

  if (players.length === 0) return world;

  const playerId = players[0];
  const playerX = Transform.x[playerId];
  const playerY = Transform.y[playerId];

  aiLodFrame++;

  for (let i = 0; i < enemies.length; i++) {
    const enemyId = enemies[i];
    const aiType = EnemyAI.aiType[enemyId];

    // LOD: distance-based AI throttling — far enemies update less often
    // Bosses and minibosses always get full updates
    let lodDeltaTime = deltaTime;
    if (aiType < 50) { // regular enemies only
      const enemyX = Transform.x[enemyId];
      const enemyY = Transform.y[enemyId];
      const distanceSq = (playerX - enemyX) * (playerX - enemyX) + (playerY - enemyY) * (playerY - enemyY);

      if (distanceSq > 640000) { // > 800px: update every 6th frame
        if ((enemyId + aiLodFrame) % 6 !== 0) continue;
        lodDeltaTime = deltaTime * 6; // Compensate for skipped frames
      } else if (distanceSq > 160000) { // > 400px: update every 3rd frame
        if ((enemyId + aiLodFrame) % 3 !== 0) continue;
        lodDeltaTime = deltaTime * 3;
      }
    }

    // Update timers (only on frames where AI actually runs)
    EnemyAI.timer[enemyId] += lodDeltaTime;

    switch (aiType) {
      case EnemyAIType.Chase:
        updateChaseAI(enemyId, playerX, playerY);
        break;
      case EnemyAIType.Zigzag:
        updateZigzagAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Dash:
        updateDashAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Circle:
        updateCircleAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Swarm:
        updateSwarmAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Tank:
        updateTankAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Exploder:
        updateExploderAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Splitter:
        updateSplitterAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Shooter:
        updateShooterAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Sniper:
        updateSniperAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Healer:
        updateHealerAI(world, enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Shielded:
        updateShieldedAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Teleporter:
        updateTeleporterAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Giant:
        updateGiantAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Lurker:
        updateLurkerAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Warden:
        updateWardenAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Wraith:
        updateWraithAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Rallier:
        updateRallierAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Ghost:
        updateGhostAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.SplitterMini:
        updateSplitterMiniAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      // Minibosses
      case EnemyAIType.Glutton:
        updateGluttonAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.SwarmMother:
        updateSwarmMotherAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Charger:
        updateChargerAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Necromancer:
        updateNecromancerAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.TwinA:
      case EnemyAIType.TwinB:
        updateTwinAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Bombard:
        updateBombardAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      // Bosses
      case EnemyAIType.HordeKing:
        updateHordeKingAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.VoidWyrm:
        updateVoidWyrmAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.TheMachine:
        updateTheMachineAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Bastion:
        updateBastionAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Pulsar:
        updatePulsarAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Obelisk:
        updateObeliskAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.Legion:
        updateLegionAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      case EnemyAIType.LegionFragment:
      case EnemyAIType.LegionMote:
        updateLegionFragmentAI(enemyId, playerX, playerY, lodDeltaTime);
        break;
      default:
        updateChaseAI(enemyId, playerX, playerY);
    }

    // Apply freeze slow if enemy is frozen
    const freezeDuration = StatusEffect.freezeDuration[enemyId];
    if (freezeDuration > 0) {
      const freezeMultiplier = StatusEffect.freezeMultiplier[enemyId];
      if (freezeMultiplier > 0 && freezeMultiplier < 1) {
        Velocity.x[enemyId] *= freezeMultiplier;
        Velocity.y[enemyId] *= freezeMultiplier;
      }
    }
  }

  // Apply elite auras after all AI has set velocities
  applyEliteAuras(enemies, playerX, playerY);

  return world;
}

// Export the simple version for backwards compatibility
export { enemyAISystem as default };
