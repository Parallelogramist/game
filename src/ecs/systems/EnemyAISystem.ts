import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity, PlayerTag, EnemyTag, EnemyAI, EnemyType, Health, StatusEffect } from '../components';
import { EnemyAIType } from '../../enemies/EnemyTypes';
import { getEnemySpatialHash } from '../../utils/SpatialHash';
import {
  gameBoundsWidth, gameBoundsHeight,
  projectileSpawnCallback, minionSpawnCallback,
  xpGemPositionsCallback, consumeXPGemCallback,
  groundSlamCallback, laserBeamCallback,
  deadEnemyPositions, deadPositionsReadPointer, advanceDeadPositionsPointer,
  getLinkedTwin,
  bossPhaseTransitionCallback,
} from './enemy-ai/state';
import {
  chargerChargeTelegraph, hordeKingSlamTelegraph,
  voidWyrmSweepTelegraph, voidWyrmRingTelegraph, theMachineLaserTelegraphs,
  spawnTelegraph,
} from './enemy-ai/telegraphs';
// Shared constants + per-frame context (telegraph manager, world ref) live in
// enemy-ai/common so behavior modules can use them without importing this file.
import { PI_HALF, PI_TWO, telegraphManager, setAIWorld, isDestructible } from './enemy-ai/common';
// Regular enemy behaviors (aiType < 50), one module per handler.
// Miniboss and boss handlers remain below until later refactor phases.
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

// Re-export public API from state/common modules for backwards compatibility
export {
  setEnemyAIBounds, setEnemyProjectileCallback, setMinionSpawnCallback,
  setXPGemCallbacks, setBossCallbacks, resetBossCallbacks,
  recordEnemyDeath, linkTwins, unlinkTwin, getLinkedTwin, getAllTwinLinks,
  resetEnemyAISystem, updateAIGameTime,
  setBossPhaseTransitionCallback,
} from './enemy-ai/state';
export { setTelegraphManager } from './enemy-ai/common';

/**
 * Boss phase tracker — stored externally from EnemyAI.phase because some
 * bosses (e.g. Void Wyrm) repurpose the `phase` field as a serpentine timer.
 * Cleared on enemy despawn via resetBossPhaseTracking (called in reset flow).
 */
const bossPhaseByEntity = new Map<number, number>();

/**
 * Checks whether the boss just crossed a phase boundary (66% / 33% HP).
 * Fires the transition callback on change. Returns the current phase (1-3).
 */
function checkBossPhaseTransition(bossId: number): number {
  const healthPercent = Health.current[bossId] / Math.max(1, Health.max[bossId]);
  const currentPhase = healthPercent > 0.66 ? 1 : healthPercent > 0.33 ? 2 : 3;
  const storedPhase = bossPhaseByEntity.get(bossId) ?? 1;
  if (currentPhase > storedPhase) {
    bossPhaseByEntity.set(bossId, currentPhase);
    if (bossPhaseTransitionCallback) {
      bossPhaseTransitionCallback(bossId, currentPhase);
    }
  } else if (!bossPhaseByEntity.has(bossId)) {
    bossPhaseByEntity.set(bossId, currentPhase);
  }
  return currentPhase;
}

export function resetBossPhaseTracking(): void {
  bossPhaseByEntity.clear();
}

// ── Elite aura tracking ─────────────────────────────────────────────────────
// Tracks which enemies are currently buffed by Tank damage reduction aura.
// Rebuilt every frame by applyEliteAuras(). Consumed by WeaponManager.
const tankAuraProtectedEnemies = new Set<number>();

// Tracks cumulative Warden slow multiplier for the player, rebuilt each frame.
let wardenSlowMultiplier = 1.0;

// Queries
const enemyQuery = defineQuery([Transform, Velocity, EnemyTag, EnemyAI]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// LOD frame counter for distance-based AI throttling
let aiLodFrame = 0;

/**
 * EnemyAISystem handles different enemy behaviors based on their AI type.
 * Uses distance-based LOD: far enemies update less frequently to support 2000+ count.
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

// ── Elite Aura Public API ─────────────────────────────────────────────────

/**
 * Returns true if the given enemy is within a Tank's damage reduction aura.
 * Called by WeaponManager to reduce incoming damage by 25%.
 */
export function isNearTankAura(enemyId: number): boolean {
  return tankAuraProtectedEnemies.has(enemyId);
}

/**
 * Returns the cumulative Warden slow multiplier for the player.
 * 1.0 = no slow, values < 1.0 mean the player is near one or more Wardens.
 * Called by GameScene to scale player velocity after InputSystem runs.
 */
export function getWardenSlowMultiplier(): number {
  return wardenSlowMultiplier;
}

/**
 * Apply elite enemy proximity auras each frame.
 *
 * - Tank (aiType 5): Damage reduction aura — enemies within 120px are flagged
 *   so WeaponManager can apply 25% damage reduction.
 * - Rallier (aiType 17): Speed boost aura — enemies within 150px get +30%
 *   velocity this frame (applied on top of whatever the AI already set).
 * - Warden (aiType 15): Player slow aura — if the player is within 200px of
 *   any Warden, the player's move speed is reduced by 15% (stacks multiplicatively).
 */
function applyEliteAuras(
  enemies: number[],
  playerX: number,
  playerY: number
): void {
  // Reset per-frame aura state
  tankAuraProtectedEnemies.clear();
  wardenSlowMultiplier = 1.0;

  const spatialHash = getEnemySpatialHash();

  for (let i = 0; i < enemies.length; i++) {
    const eliteId = enemies[i];
    const aiType = EnemyAI.aiType[eliteId];

    // ── Tank damage reduction aura (120px) ──
    if (aiType === EnemyAIType.Tank) {
      const tankX = Transform.x[eliteId];
      const tankY = Transform.y[eliteId];
      const nearbyEnemies = spatialHash.query(tankX, tankY, 120);

      for (let j = 0; j < nearbyEnemies.length; j++) {
        const nearbyId = nearbyEnemies[j].id;
        if (nearbyId !== eliteId && !isDestructible(nearbyId)) {
          tankAuraProtectedEnemies.add(nearbyId);
        }
      }
    }

    // ── Rallier speed boost aura (150px, +30% velocity) ──
    if (aiType === EnemyAIType.Rallier) {
      const rallierX = Transform.x[eliteId];
      const rallierY = Transform.y[eliteId];
      const nearbyEnemies = spatialHash.query(rallierX, rallierY, 150);

      for (let j = 0; j < nearbyEnemies.length; j++) {
        const nearbyId = nearbyEnemies[j].id;
        if (nearbyId !== eliteId && !isDestructible(nearbyId)) {
          Velocity.x[nearbyId] *= 1.3;
          Velocity.y[nearbyId] *= 1.3;
        }
      }
    }

    // ── Warden player slow aura (200px, -15% per Warden) ──
    if (aiType === EnemyAIType.Warden) {
      const wardenX = Transform.x[eliteId];
      const wardenY = Transform.y[eliteId];
      const distanceToPlayerX = playerX - wardenX;
      const distanceToPlayerY = playerY - wardenY;
      const distanceSquared = distanceToPlayerX * distanceToPlayerX + distanceToPlayerY * distanceToPlayerY;

      if (distanceSquared <= 40000) { // 200px radius: 200*200 = 40000
        wardenSlowMultiplier *= 0.85;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MINIBOSS AI FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Glutton - Seeks out XP gems, grows larger and stronger when eating them.
 * States: 0 = seeking gems, 1 = chasing player (no gems nearby)
 */
function updateGluttonAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const speed = Velocity.speed[enemyId];

  // Try to find XP gems
  let targetGem: { x: number; y: number; entityId: number } | null = null;
  let nearestGemDist = Infinity;

  if (xpGemPositionsCallback) {
    const gems = xpGemPositionsCallback();
    for (const gem of gems) {
      const dist = Math.sqrt((gem.x - enemyX) ** 2 + (gem.y - enemyY) ** 2);
      if (dist < nearestGemDist && dist < 400) {
        nearestGemDist = dist;
        targetGem = gem;
      }
    }
  }

  if (targetGem && nearestGemDist > 15) {
    // Move toward gem
    const dx = targetGem.x - enemyX;
    const dy = targetGem.y - enemyY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    Velocity.x[enemyId] = (dx / dist) * speed * 1.2; // Move faster toward gems
    Velocity.y[enemyId] = (dy / dist) * speed * 1.2;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
    EnemyAI.state[enemyId] = 0;
  } else if (targetGem && nearestGemDist <= 15 && consumeXPGemCallback) {
    // Eat the gem!
    consumeXPGemCallback(targetGem.entityId);

    // Grow larger and stronger
    const currentDamage = EnemyType.baseDamage[enemyId];
    EnemyType.baseDamage[enemyId] = currentDamage + 3;
    Health.max[enemyId] += 20;
    Health.current[enemyId] = Math.min(Health.current[enemyId] + 20, Health.max[enemyId]);

    // Increase speed slightly
    Velocity.speed[enemyId] = Math.min(Velocity.speed[enemyId] + 2, 150);
  } else {
    // No gems nearby - chase player
    updateChaseAI(enemyId, playerX, playerY);
    EnemyAI.state[enemyId] = 1;
  }

  // Update special timer for periodic size pulse effect (visual cue)
  EnemyAI.specialTimer[enemyId] += deltaTime;
}

/**
 * Swarm Mother - Continuously spawns small swarm enemies.
 * Moves slowly toward player while spawning.
 */
function updateSwarmMotherAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  // Move slowly toward player
  if (distance > 100) {
    Velocity.x[enemyId] = (dx / distance) * speed;
    Velocity.y[enemyId] = (dy / distance) * speed;
  } else {
    // Stay at medium range
    Velocity.x[enemyId] *= 0.9;
    Velocity.y[enemyId] *= 0.9;
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Spawn minions periodically
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0 && minionSpawnCallback) {
    // Spawn a swarm enemy near self
    const spawnAngle = Math.random() * PI_TWO;
    const spawnDist = 30 + Math.random() * 20;
    const spawnX = enemyX + Math.cos(spawnAngle) * spawnDist;
    const spawnY = enemyY + Math.sin(spawnAngle) * spawnDist;

    minionSpawnCallback(spawnX, spawnY, 'swarm');
    EnemyAI.specialTimer[enemyId] = 3.0; // Spawn every 3 seconds
  }
}

/**
 * The Charger - Pauses, then charges at high speed across the screen.
 * States: 0 = walking toward player, 1 = preparing charge (stops), 2 = charging
 */
function updateChargerAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  _deltaTime: number
): void {
  const state = EnemyAI.state[enemyId];
  const timer = EnemyAI.timer[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const baseSpeed = Velocity.speed[enemyId];

  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (state === 0) {
    // Walking toward player
    if (distance > 1) {
      Velocity.x[enemyId] = (dx / distance) * baseSpeed * 0.6;
      Velocity.y[enemyId] = (dy / distance) * baseSpeed * 0.6;
      // Add π/2 so triangle tip leads (triangle points UP at rotation 0)
      Transform.rotation[enemyId] = Math.atan2(dy, dx) + PI_HALF;
    }

    // Start charge preparation after 2-4 seconds or when close enough
    if (timer > 2.0 + Math.random() * 2.0 || distance < 200) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Preparing to charge - slow down and lock target
    Velocity.x[enemyId] *= 0.8;
    Velocity.y[enemyId] *= 0.8;

    // Store target direction
    if (timer < 0.1) {
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
      // Telegraph the charge lane across the screen during the 0.8s windup.
      spawnTelegraph(telegraphManager, enemyX, enemyY, chargerChargeTelegraph(Math.atan2(playerY - enemyY, playerX - enemyX)));
    }

    // Visual cue: shake slightly
    Transform.x[enemyId] += (Math.random() - 0.5) * 4;

    if (timer > 0.8) {
      // Start charging!
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 2) {
    // CHARGING!
    const targetDx = EnemyAI.targetX[enemyId] - enemyX;
    const targetDy = EnemyAI.targetY[enemyId] - enemyY;
    const angle = Math.atan2(targetDy, targetDx);

    const chargeSpeed = baseSpeed * 6; // Very fast!
    Velocity.x[enemyId] = Math.cos(angle) * chargeSpeed;
    Velocity.y[enemyId] = Math.sin(angle) * chargeSpeed;
    // Add π/2 so triangle tip leads (triangle points UP at rotation 0)
    Transform.rotation[enemyId] = angle + PI_HALF;

    // End charge after 1 second or if hitting edge
    if (timer > 1.0 || enemyX < 30 || enemyX > gameBoundsWidth - 30 || enemyY < 30 || enemyY > gameBoundsHeight - 30) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
    }
  }
}

/**
 * Necromancer - Keeps distance, shoots projectiles, and revives dead enemies as ghosts.
 */
function updateNecromancerAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  // Stay at medium-long range
  const preferredDistance = 250;

  if (distance < preferredDistance - 30) {
    // Too close - retreat
    Velocity.x[enemyId] = -(dx / distance) * speed;
    Velocity.y[enemyId] = -(dy / distance) * speed;
  } else if (distance > preferredDistance + 50) {
    // Too far - approach slowly
    Velocity.x[enemyId] = (dx / distance) * speed * 0.5;
    Velocity.y[enemyId] = (dy / distance) * speed * 0.5;
  } else {
    // In range - circle around
    const perpX = -dy / distance;
    const perpY = dx / distance;
    Velocity.x[enemyId] = perpX * speed * 0.4;
    Velocity.y[enemyId] = perpY * speed * 0.4;
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Shoot projectiles
  EnemyAI.shootTimer[enemyId] -= deltaTime;
  if (EnemyAI.shootTimer[enemyId] <= 0 && projectileSpawnCallback) {
    const angle = Math.atan2(dy, dx);
    // Fire 3 projectiles in a spread
    projectileSpawnCallback(enemyX, enemyY, angle - 0.2, 150, 15);
    projectileSpawnCallback(enemyX, enemyY, angle, 150, 15);
    projectileSpawnCallback(enemyX, enemyY, angle + 0.2, 150, 15);
    EnemyAI.shootTimer[enemyId] = 2.5;
  }

  // Revive dead enemies as ghosts
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  const availableDeadCount = deadEnemyPositions.length - deadPositionsReadPointer;
  if (EnemyAI.specialTimer[enemyId] <= 0 && minionSpawnCallback && availableDeadCount > 0) {
    // Revive up to 2 dead enemies (consume from read pointer forward)
    const reviveCount = Math.min(2, availableDeadCount);
    for (let i = 0; i < reviveCount; i++) {
      const deadPos = deadEnemyPositions[deadPositionsReadPointer];
      advanceDeadPositionsPointer();
      if (deadPos) {
        minionSpawnCallback(deadPos.x, deadPos.y, 'ghost');
      }
    }
    EnemyAI.specialTimer[enemyId] = 5.0; // Revive every 5 seconds
  }
}

/**
 * The Twins - Two linked enemies that move together and buff each other.
 * When one is damaged, the other gets enraged (faster, stronger).
 */
function updateTwinAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  let speed = Velocity.speed[enemyId];

  // Check if linked twin exists
  const linkedTwin = getLinkedTwin(enemyId);

  if (linkedTwin !== undefined) {
    // Get twin position
    const twinX = Transform.x[linkedTwin];
    const twinY = Transform.y[linkedTwin];

    // Stay near twin - maintain formation
    const twinDx = twinX - enemyX;
    const twinDy = twinY - enemyY;
    const twinDist = Math.sqrt(twinDx * twinDx + twinDy * twinDy);

    // If twin is hurt, get enraged (speed boost)
    const twinHealth = Health.current[linkedTwin];
    const twinMaxHealth = Health.max[linkedTwin];
    if (twinHealth < twinMaxHealth * 0.5) {
      speed *= 1.5; // Enraged!
    }

    // Movement: combine player chase with staying near twin
    let moveX = 0;
    let moveY = 0;

    // Chase player
    if (distance > 1) {
      moveX += (dx / distance) * 0.7;
      moveY += (dy / distance) * 0.7;
    }

    // Pull toward twin if too far apart
    if (twinDist > 150) {
      moveX += (twinDx / twinDist) * 0.5;
      moveY += (twinDy / twinDist) * 0.5;
    } else if (twinDist < 50) {
      // Push away if too close
      moveX -= (twinDx / twinDist) * 0.3;
      moveY -= (twinDy / twinDist) * 0.3;
    }

    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);
    if (moveMag > 0.1) {
      Velocity.x[enemyId] = (moveX / moveMag) * speed;
      Velocity.y[enemyId] = (moveY / moveMag) * speed;
    }
  } else {
    // Twin is dead - enrage and chase aggressively!
    speed *= 2.0;
    EnemyType.baseDamage[enemyId] = EnemyType.baseDamage[enemyId] * 1.5;

    if (distance > 1) {
      Velocity.x[enemyId] = (dx / distance) * speed;
      Velocity.y[enemyId] = (dy / distance) * speed;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Periodic phase sync for visual effects
  EnemyAI.phase[enemyId] += deltaTime * 4;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOSS AI FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Horde King - Summons enemy waves, ground slam attack, 3 phases.
 * States: 0 = approaching, 1 = summoning, 2 = ground slam windup, 3 = ground slam
 * Phase changes at 66% and 33% health
 */
function updateHordeKingAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  // Determine phase (and fire transition callback on boundary crossings)
  const phase = checkBossPhaseTransition(enemyId);

  // Phase modifies behavior intensity
  const phaseSpeedMult = 1 + (3 - phase) * 0.2; // Faster in later phases
  const phaseSummonCooldown = 6 - (3 - phase) * 1.5; // More frequent summons

  if (state === 0) {
    // Approaching player
    if (distance > 100) {
      Velocity.x[enemyId] = (dx / distance) * baseSpeed * phaseSpeedMult;
      Velocity.y[enemyId] = (dy / distance) * baseSpeed * phaseSpeedMult;
    } else {
      Velocity.x[enemyId] *= 0.9;
      Velocity.y[enemyId] *= 0.9;
    }

    // Check for summon or slam
    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      // Alternate between summoning and ground slam
      if (Math.random() < 0.5) {
        EnemyAI.state[enemyId] = 1; // Summon
      } else {
        EnemyAI.state[enemyId] = 2; // Ground slam windup
        // Telegraph the phase-scaled slam footprint during the 1.0s windup.
        spawnTelegraph(telegraphManager, enemyX, enemyY, hordeKingSlamTelegraph(phase));
      }
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Summoning enemies
    Velocity.x[enemyId] *= 0.95;
    Velocity.y[enemyId] *= 0.95;

    const timer = EnemyAI.timer[enemyId];
    if (timer > 0.5 && timer < 0.6 && minionSpawnCallback) {
      // Spawn enemies in a ring around the boss
      const summonCount = 2 + phase; // More enemies in later phases
      for (let i = 0; i < summonCount; i++) {
        const angle = (i / summonCount) * PI_TWO;
        const spawnX = enemyX + Math.cos(angle) * 80;
        const spawnY = enemyY + Math.sin(angle) * 80;
        minionSpawnCallback(spawnX, spawnY, 'basic');
      }
    }

    if (timer > 1.0) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = phaseSummonCooldown;
    }
  } else if (state === 2) {
    // Ground slam windup - stop and telegraph
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;

    // Visual telegraph: shake
    Transform.x[enemyId] += (Math.random() - 0.5) * 6;

    const timer = EnemyAI.timer[enemyId];
    if (timer > 1.0) {
      EnemyAI.state[enemyId] = 3;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 3) {
    // Ground slam execute
    const timer = EnemyAI.timer[enemyId];
    if (timer < 0.1 && groundSlamCallback) {
      // Execute slam
      const slamRadius = 150 + phase * 30; // Bigger in later phases
      const slamDamage = 30 + phase * 10;
      groundSlamCallback(enemyX, enemyY, slamRadius, slamDamage);
    }

    if (timer > 0.5) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = phaseSummonCooldown;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);
}

/**
 * Void Wyrm - Serpentine boss that sweeps across screen, fires projectile rings.
 * States: 0 = circling, 1 = preparing sweep, 2 = sweeping, 3 = firing ring
 */
function updateVoidWyrmAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  // Detect HP-based phase transitions (serpentine timer uses EnemyAI.phase,
  // so we track boss phases in a side-map instead).
  const voidWyrmPhase = checkBossPhaseTransition(enemyId);

  if (state === 0) {
    // Circling around player at distance
    const preferredDist = 200;

    // Calculate tangent direction
    const tangentX = -dy / (distance || 1);
    const tangentY = dx / (distance || 1);

    let radialFactor = 0;
    if (distance < preferredDist - 30) radialFactor = -0.4;
    else if (distance > preferredDist + 30) radialFactor = 0.4;

    const moveX = tangentX * 0.8 + (dx / (distance || 1)) * radialFactor;
    const moveY = tangentY * 0.8 + (dy / (distance || 1)) * radialFactor;
    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

    Velocity.x[enemyId] = (moveX / moveMag) * baseSpeed;
    Velocity.y[enemyId] = (moveY / moveMag) * baseSpeed;

    // Phase for serpentine movement
    EnemyAI.phase[enemyId] += deltaTime * 4;
    const serpentineOffset = Math.sin(EnemyAI.phase[enemyId]) * 50;
    Velocity.x[enemyId] += tangentX * serpentineOffset * 2;
    Velocity.y[enemyId] += tangentY * serpentineOffset * 2;

    // Check for special attacks
    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      if (Math.random() < 0.4) {
        EnemyAI.state[enemyId] = 1; // Prepare sweep
        // Telegraph the sweep lane during the 0.8s prepare. The actual target
        // is stored one frame into state 1; the player moves negligibly by then.
        spawnTelegraph(telegraphManager, enemyX, enemyY, voidWyrmSweepTelegraph(enemyX, enemyY, playerX, playerY));
      } else {
        EnemyAI.state[enemyId] = 3; // Fire ring
        // Telegraph the projectile burst before it fires at t=0.3.
        spawnTelegraph(telegraphManager, enemyX, enemyY, voidWyrmRingTelegraph());
      }
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Preparing to sweep - move to edge
    Velocity.x[enemyId] *= 0.95;
    Velocity.y[enemyId] *= 0.95;

    // Store sweep target (player position)
    if (EnemyAI.timer[enemyId] < 0.1) {
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
    }

    if (EnemyAI.timer[enemyId] > 0.8) {
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 2) {
    // Sweeping across screen toward target
    const targetDx = EnemyAI.targetX[enemyId] - enemyX;
    const targetDy = EnemyAI.targetY[enemyId] - enemyY;
    const targetDist = Math.sqrt(targetDx * targetDx + targetDy * targetDy);

    if (targetDist > 30 && EnemyAI.timer[enemyId] < 1.5) {
      const sweepSpeed = baseSpeed * 3;
      Velocity.x[enemyId] = (targetDx / targetDist) * sweepSpeed;
      Velocity.y[enemyId] = (targetDy / targetDist) * sweepSpeed;
    } else {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 3.0;
    }
  } else if (state === 3) {
    // Firing projectile ring
    Velocity.x[enemyId] *= 0.9;
    Velocity.y[enemyId] *= 0.9;

    const timer = EnemyAI.timer[enemyId];
    if (timer > 0.3 && timer < 0.4 && projectileSpawnCallback) {
      // Fire ring of projectiles — phase 2 adds an offset second ring,
      // phase 3 fires three interleaved rings for dense bullet-hell pressure.
      const ringCount = voidWyrmPhase === 3 ? 3 : voidWyrmPhase === 2 ? 2 : 1;
      const projectileCount = 12;
      for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
        const ringAngleOffset = (ringIndex / ringCount) * (PI_TWO / projectileCount);
        for (let projectileIndex = 0; projectileIndex < projectileCount; projectileIndex++) {
          const angle = (projectileIndex / projectileCount) * PI_TWO + ringAngleOffset;
          projectileSpawnCallback(enemyX, enemyY, angle, 150, 15);
        }
      }
    }

    if (timer > 1.0) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 4.0;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(Velocity.y[enemyId], Velocity.x[enemyId]);
}

/**
 * The Machine - Mechanical boss that spawns turrets and fires laser grids.
 * States: 0 = moving/shooting, 1 = spawning turret, 2 = charging laser, 3 = firing laser
 */
function updateTheMachineAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  // Detect HP phase transitions. Phase 3 shortens special cooldowns and widens
  // the laser fan for a more desperate final-stand feel.
  const machinePhase = checkBossPhaseTransition(enemyId);
  const specialCooldownForPhase = machinePhase === 3 ? 3.0 : machinePhase === 2 ? 4.0 : 5.0;

  if (state === 0) {
    // Move toward center-ish position, fire constantly
    const targetX = gameBoundsWidth / 2;
    const targetY = gameBoundsHeight / 2;
    const toDx = targetX - enemyX;
    const toDy = targetY - enemyY;
    const toDist = Math.sqrt(toDx * toDx + toDy * toDy);

    if (toDist > 100) {
      Velocity.x[enemyId] = (toDx / toDist) * baseSpeed;
      Velocity.y[enemyId] = (toDy / toDist) * baseSpeed;
    } else {
      Velocity.x[enemyId] *= 0.95;
      Velocity.y[enemyId] *= 0.95;
    }

    // Constant shooting at player
    EnemyAI.shootTimer[enemyId] -= deltaTime;
    if (EnemyAI.shootTimer[enemyId] <= 0 && projectileSpawnCallback) {
      const angle = Math.atan2(dy, dx);
      projectileSpawnCallback(enemyX, enemyY, angle, 250, 15);
      // Also fire at angles
      projectileSpawnCallback(enemyX, enemyY, angle - 0.3, 250, 12);
      projectileSpawnCallback(enemyX, enemyY, angle + 0.3, 250, 12);
      EnemyAI.shootTimer[enemyId] = 0.8;
    }

    // Check for special attacks
    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      if (Math.random() < 0.5) {
        EnemyAI.state[enemyId] = 1; // Spawn turret
      } else {
        EnemyAI.state[enemyId] = 2; // Charge laser
        // Telegraph the laser grid (main + cross beams) for the 1.5s charge.
        // The actual target is stored one frame into state 2; the boss is
        // stationary while charging so the beam origins hold.
        for (const beamSpec of theMachineLaserTelegraphs(enemyX, enemyY, playerX, playerY)) {
          spawnTelegraph(telegraphManager, enemyX, enemyY, beamSpec);
        }
      }
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Spawning turret
    Velocity.x[enemyId] *= 0.95;
    Velocity.y[enemyId] *= 0.95;

    const timer = EnemyAI.timer[enemyId];
    if (timer > 0.5 && timer < 0.6 && minionSpawnCallback) {
      // Spawn turret at random position
      const spawnAngle = Math.random() * PI_TWO;
      const spawnDist = 150 + Math.random() * 100;
      const spawnX = Math.min(gameBoundsWidth - 80, Math.max(80, enemyX + Math.cos(spawnAngle) * spawnDist));
      const spawnY = Math.min(gameBoundsHeight - 80, Math.max(80, enemyY + Math.sin(spawnAngle) * spawnDist));
      minionSpawnCallback(spawnX, spawnY, 'turret');
    }

    if (timer > 1.0) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = specialCooldownForPhase;
    }
  } else if (state === 2) {
    // Charging laser
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;

    // Telegraph: shake
    Transform.x[enemyId] += (Math.random() - 0.5) * 4;

    // Store laser target
    if (EnemyAI.timer[enemyId] < 0.1) {
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
    }

    if (EnemyAI.timer[enemyId] > 1.5) {
      EnemyAI.state[enemyId] = 3;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 3) {
    // Firing laser
    const timer = EnemyAI.timer[enemyId];

    if (timer < 0.5 && laserBeamCallback) {
      // Fire laser in multiple directions
      const laserAngle = Math.atan2(EnemyAI.targetY[enemyId] - enemyY, EnemyAI.targetX[enemyId] - enemyX);
      const laserLength = 800;

      // Main laser toward target
      laserBeamCallback(
        enemyX,
        enemyY,
        enemyX + Math.cos(laserAngle) * laserLength,
        enemyY + Math.sin(laserAngle) * laserLength,
        25
      );

      // Cross lasers
      if (timer > 0.2) {
        laserBeamCallback(
          enemyX,
          enemyY,
          enemyX + Math.cos(laserAngle + PI_HALF) * laserLength,
          enemyY + Math.sin(laserAngle + PI_HALF) * laserLength,
          20
        );
        laserBeamCallback(
          enemyX,
          enemyY,
          enemyX + Math.cos(laserAngle - PI_HALF) * laserLength,
          enemyY + Math.sin(laserAngle - PI_HALF) * laserLength,
          20
        );
      }
    }

    if (timer > 0.8) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 6.0;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);
}

// Export the simple version for backwards compatibility
export { enemyAISystem as default };
