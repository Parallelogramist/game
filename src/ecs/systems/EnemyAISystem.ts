import { defineQuery, IWorld, hasComponent } from 'bitecs';
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
} from './enemy-ai/state';

// Re-export public API from state module for backwards compatibility
export {
  setEnemyAIBounds, setEnemyProjectileCallback, setMinionSpawnCallback,
  setXPGemCallbacks, setBossCallbacks, resetBossCallbacks,
  recordEnemyDeath, linkTwins, unlinkTwin, getLinkedTwin, getAllTwinLinks,
  resetEnemyAISystem, updateAIGameTime,
} from './enemy-ai/state';

// ── Elite aura tracking ─────────────────────────────────────────────────────
// Tracks which enemies are currently buffed by Tank damage reduction aura.
// Rebuilt every frame by applyEliteAuras(). Consumed by WeaponManager.
const tankAuraProtectedEnemies = new Set<number>();

// Tracks cumulative Warden slow multiplier for the player, rebuilt each frame.
let wardenSlowMultiplier = 1.0;

// OPTIMIZATION: Pre-computed Math constants to avoid repeated calculations
const PI_HALF = Math.PI / 2;
const PI_TWO = Math.PI * 2;

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
    if (aiType < 50) { // regular enemies only
      const enemyX = Transform.x[enemyId];
      const enemyY = Transform.y[enemyId];
      const distanceSq = (playerX - enemyX) * (playerX - enemyX) + (playerY - enemyY) * (playerY - enemyY);

      if (distanceSq > 640000) { // > 800px: update every 6th frame
        if ((enemyId + aiLodFrame) % 6 !== 0) {
          EnemyAI.timer[enemyId] += deltaTime; // still advance timers
          continue;
        }
      } else if (distanceSq > 160000) { // > 400px: update every 3rd frame
        if ((enemyId + aiLodFrame) % 3 !== 0) {
          EnemyAI.timer[enemyId] += deltaTime;
          continue;
        }
      }
    }

    // Update timers
    EnemyAI.timer[enemyId] += deltaTime;

    switch (aiType) {
      case EnemyAIType.Chase:
        updateChaseAI(enemyId, playerX, playerY);
        break;
      case EnemyAIType.Zigzag:
        updateZigzagAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Dash:
        updateDashAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Circle:
        updateCircleAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Swarm:
        updateSwarmAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Tank:
        updateTankAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Exploder:
        updateExploderAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Splitter:
        updateSplitterAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Shooter:
        updateShooterAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Sniper:
        updateSniperAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Healer:
        updateHealerAI(world, enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Shielded:
        updateShieldedAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Teleporter:
        updateTeleporterAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Giant:
        updateGiantAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Lurker:
        updateLurkerAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Warden:
        updateWardenAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Wraith:
        updateWraithAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Rallier:
        updateRallierAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Ghost:
        updateGhostAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.SplitterMini:
        updateSplitterMiniAI(enemyId, playerX, playerY, deltaTime);
        break;
      // Minibosses
      case EnemyAIType.Glutton:
        updateGluttonAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.SwarmMother:
        updateSwarmMotherAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Charger:
        updateChargerAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.Necromancer:
        updateNecromancerAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.TwinA:
      case EnemyAIType.TwinB:
        updateTwinAI(enemyId, playerX, playerY, deltaTime);
        break;
      // Bosses
      case EnemyAIType.HordeKing:
        updateHordeKingAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.VoidWyrm:
        updateVoidWyrmAI(enemyId, playerX, playerY, deltaTime);
        break;
      case EnemyAIType.TheMachine:
        updateTheMachineAI(enemyId, playerX, playerY, deltaTime);
        break;
      default:
        updateChaseAI(enemyId, playerX, playerY);
    }

    // Apply freeze slow if enemy has StatusEffect component and is frozen
    if (hasComponent(world, StatusEffect, enemyId)) {
      const freezeDuration = StatusEffect.freezeDuration[enemyId];
      if (freezeDuration > 0) {
        const freezeMultiplier = StatusEffect.freezeMultiplier[enemyId];
        if (freezeMultiplier > 0 && freezeMultiplier < 1) {
          Velocity.x[enemyId] *= freezeMultiplier;
          Velocity.y[enemyId] *= freezeMultiplier;
        }
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
        if (nearbyId !== eliteId) {
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
        if (nearbyId !== eliteId) {
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

/**
 * Basic chase - move directly toward player
 */
function updateChaseAI(enemyId: number, playerX: number, playerY: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    const speed = Velocity.speed[enemyId];
    // Distance-aware speed: amble at range, lunge when close
    const distanceScale = distance > 300 ? 0.9 : distance < 150 ? 1.1 : 1.0;
    Velocity.x[enemyId] = (dx / distance) * speed * distanceScale;
    Velocity.y[enemyId] = (dy / distance) * speed * distanceScale;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
  } else {
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
  }
}

/**
 * Zigzag - moves toward player but oscillates side to side
 */
function updateZigzagAI(
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

  if (distance > 1) {
    const speed = Velocity.speed[enemyId];
    const phase = EnemyAI.phase[enemyId];

    // Variable phase speed: oscillates between 3-7 rad/s instead of constant 6
    EnemyAI.phase[enemyId] += deltaTime * (5 + Math.sin(phase * 0.7) * 2);

    // Calculate perpendicular vector
    const perpX = -dy / distance;
    const perpY = dx / distance;

    // Layered oscillation — irrational ratio means it never exactly repeats
    const rawZigzag = Math.sin(phase) * 0.5 + Math.sin(phase * 2.3) * 0.35;
    // Distance-sensitive amplitude: full zigzag at range, tightens at close range
    const amplitudeScale = 0.4 + Math.min(distance / 300, 1.0) * 0.6;
    const zigzagAmount = rawZigzag * amplitudeScale;

    // Combine forward movement with zigzag
    const moveX = (dx / distance) + perpX * zigzagAmount;
    const moveY = (dy / distance) + perpY * zigzagAmount;
    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

    Velocity.x[enemyId] = (moveX / moveMag) * speed;
    Velocity.y[enemyId] = (moveY / moveMag) * speed;
    // Add π/2 so triangle tip leads (triangle points UP at rotation 0)
    Transform.rotation[enemyId] = Math.atan2(Velocity.y[enemyId], Velocity.x[enemyId]) + PI_HALF;
  }
}

/**
 * Dash - pause, then rapidly dash toward player
 */
function updateDashAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  _deltaTime: number
): void {
  const state = EnemyAI.state[enemyId];
  const timer = EnemyAI.timer[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];

  // States: 0 = pause, 1 = dash
  if (state === 0) {
    // Pausing - slow movement
    Velocity.x[enemyId] *= 0.9;
    Velocity.y[enemyId] *= 0.9;

    // Shake telegraph in final 0.5s before dash
    if (timer > 1.0) {
      Transform.x[enemyId] += (Math.random() - 0.5) * 3;
    }

    if (timer > 1.5) {
      // Start dash - store target
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Dashing toward stored target
    const dx = EnemyAI.targetX[enemyId] - enemyX;
    const dy = EnemyAI.targetY[enemyId] - enemyY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 20 && timer < 0.5) {
      const dashSpeed = Velocity.speed[enemyId] * 4; // 4x speed during dash
      Velocity.x[enemyId] = (dx / distance) * dashSpeed;
      Velocity.y[enemyId] = (dy / distance) * dashSpeed;
      Transform.rotation[enemyId] = Math.atan2(dy, dx);
    } else {
      // End dash
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
    }
  }
}

/**
 * Circle - strafe around player at a fixed distance
 */
function updateCircleAI(
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

  // Breathing orbit: oscillates between 120-180px
  const preferredDistance = 150 + Math.sin(EnemyAI.phase[enemyId] * 0.5) * 30;

  if (distance > 1) {
    // Calculate tangent direction (perpendicular to radius)
    const tangentX = -dy / distance;
    const tangentY = dx / distance;

    // Radial component - move toward/away from preferred distance
    let radialFactor = 0;
    if (distance < preferredDistance - 20) {
      radialFactor = -0.5; // Move away
    } else if (distance > preferredDistance + 20) {
      radialFactor = 0.5; // Move closer
    }

    // Update orbit phase
    EnemyAI.phase[enemyId] += deltaTime * 2;

    // Combine tangent (orbit) with radial (approach/retreat)
    const moveX = tangentX * 0.8 + (dx / distance) * radialFactor;
    const moveY = tangentY * 0.8 + (dy / distance) * radialFactor;
    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

    Velocity.x[enemyId] = (moveX / moveMag) * speed;
    Velocity.y[enemyId] = (moveY / moveMag) * speed;
    Transform.rotation[enemyId] = Math.atan2(dy, dx); // Face player
  }
}

/**
 * Swarm - boids-inspired flocking toward player.
 * Chase (60%) + Separation (25%) + Cohesion (15%) with nearby swarm neighbors.
 */
function updateSwarmAI(enemyId: number, playerX: number, playerY: number, _deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance <= 1) {
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    return;
  }

  const speed = Velocity.speed[enemyId];

  // Chase vector (normalized toward player)
  let chaseX = dx / distance;
  let chaseY = dy / distance;

  // Query nearby entities via spatial hash
  let separationX = 0, separationY = 0;
  let cohesionX = 0, cohesionY = 0;
  let neighborCount = 0;

  const spatialHash = getEnemySpatialHash();
  const nearby = spatialHash.query(enemyX, enemyY, 60);

  for (let i = 0; i < nearby.length; i++) {
    const neighbor = nearby[i];
    if (neighbor.id === enemyId) continue;
    // Only flock with other Swarm enemies
    if (EnemyAI.aiType[neighbor.id] !== EnemyAIType.Swarm) continue;

    const ox = neighbor.x;
    const oy = neighbor.y;
    const ndx = enemyX - ox;
    const ndy = enemyY - oy;
    const neighborDist = Math.sqrt(ndx * ndx + ndy * ndy);

    if (neighborDist < 1) continue;

    // Separation: push away from neighbors within 25px
    if (neighborDist < 25) {
      separationX += ndx / neighborDist;
      separationY += ndy / neighborDist;
    }

    // Cohesion: accumulate positions for average
    cohesionX += ox;
    cohesionY += oy;
    neighborCount++;
  }

  let moveX = chaseX * 0.6;
  let moveY = chaseY * 0.6;

  // Apply separation (25% weight)
  const sepMag = Math.sqrt(separationX * separationX + separationY * separationY);
  if (sepMag > 0) {
    moveX += (separationX / sepMag) * 0.25;
    moveY += (separationY / sepMag) * 0.25;
  }

  // Apply cohesion (15% weight) — steer toward average neighbor position
  if (neighborCount > 0) {
    const avgX = cohesionX / neighborCount;
    const avgY = cohesionY / neighborCount;
    const cohDx = avgX - enemyX;
    const cohDy = avgY - enemyY;
    const cohDist = Math.sqrt(cohDx * cohDx + cohDy * cohDy);
    if (cohDist > 1) {
      moveX += (cohDx / cohDist) * 0.15;
      moveY += (cohDy / cohDist) * 0.15;
    }
  }

  // Normalize and apply speed
  const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);
  if (moveMag > 0) {
    Velocity.x[enemyId] = (moveX / moveMag) * speed;
    Velocity.y[enemyId] = (moveY / moveMag) * speed;
    Transform.rotation[enemyId] = Math.atan2(moveY, moveX);
  }
}

/**
 * Tank - slow march with periodic speed surges
 * State 0: March at base speed, timer counts up to surge
 * State 1: Surge at double speed for 0.8s
 */
function updateTankAI(enemyId: number, playerX: number, playerY: number, _deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance <= 1) {
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    return;
  }

  const baseSpeed = Velocity.speed[enemyId];

  if (state === 0) {
    // March — chase at base speed
    Velocity.x[enemyId] = (dx / distance) * baseSpeed;
    Velocity.y[enemyId] = (dy / distance) * baseSpeed;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    // Transition to surge after 3.0-4.0s
    if (EnemyAI.timer[enemyId] > 3.0 + EnemyAI.phase[enemyId]) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
      // Store a random offset for next surge timing
      EnemyAI.phase[enemyId] = Math.random();
    }
  } else {
    // Surge — double speed for 0.8s
    const surgeSpeed = baseSpeed * 2;
    Velocity.x[enemyId] = (dx / distance) * surgeSpeed;
    Velocity.y[enemyId] = (dy / distance) * surgeSpeed;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    if (EnemyAI.timer[enemyId] > 0.8) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
    }
  }
}

/**
 * Exploder - chase with acceleration ramp. Gets faster as it closes in.
 * Uses phase as accumulator: speed ramps from 1x to 2.5x over time.
 */
function updateExploderAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    // Accumulate acceleration over time
    EnemyAI.phase[enemyId] = Math.min(EnemyAI.phase[enemyId] + deltaTime * 0.5, 1.5);
    const speedMultiplier = 1.0 + EnemyAI.phase[enemyId]; // 1x → 2.5x

    const baseSpeed = Velocity.speed[enemyId];
    const currentSpeed = baseSpeed * speedMultiplier;
    Velocity.x[enemyId] = (dx / distance) * currentSpeed;
    Velocity.y[enemyId] = (dy / distance) * currentSpeed;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
  } else {
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
  }
}

/**
 * Shooter - maintain distance and shoot projectiles at player
 */
function updateShooterAI(
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

  const preferredDistance = 200;

  // Move to preferred distance
  if (distance < preferredDistance - 30) {
    // Too close - retreat
    Velocity.x[enemyId] = -(dx / distance) * speed;
    Velocity.y[enemyId] = -(dy / distance) * speed;
  } else if (distance > preferredDistance + 50) {
    // Too far - approach
    Velocity.x[enemyId] = (dx / distance) * speed * 0.7;
    Velocity.y[enemyId] = (dy / distance) * speed * 0.7;
  } else {
    // In sweet spot - strafe with direction reversal
    const perpX = -dy / distance;
    const perpY = dx / distance;
    EnemyAI.phase[enemyId] += deltaTime;
    const strafeDirection = Math.sin(EnemyAI.phase[enemyId] * 2.5) > 0 ? 1 : -1;
    Velocity.x[enemyId] = perpX * speed * 0.5 * strafeDirection;
    Velocity.y[enemyId] = perpY * speed * 0.5 * strafeDirection;
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Shooting logic
  EnemyAI.shootTimer[enemyId] -= deltaTime;
  if (EnemyAI.shootTimer[enemyId] <= 0 && projectileSpawnCallback) {
    const angle = Math.atan2(dy, dx);
    projectileSpawnCallback(enemyX, enemyY, angle, 200, 12);
    EnemyAI.shootTimer[enemyId] = 2.0; // Reset cooldown
  }
}

/**
 * Sniper - stay at screen edge, shoot accurate fast projectiles
 */
function updateSniperAI(
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
  const state = EnemyAI.state[enemyId];

  // Stay at long range
  const preferredDistance = 350;

  if (distance < 1) {
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    return;
  }

  if (state === 1) {
    // Post-shot scoot: strafe at 1.5x speed for 0.5s
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const scootDirection = EnemyAI.phase[enemyId] > 0.5 ? 1 : -1;
    Velocity.x[enemyId] = perpX * speed * 1.5 * scootDirection;
    Velocity.y[enemyId] = perpY * speed * 1.5 * scootDirection;

    if (EnemyAI.timer[enemyId] > 0.5) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (distance < preferredDistance - 50) {
    // Too close - retreat
    Velocity.x[enemyId] = -(dx / distance) * speed * 1.5;
    Velocity.y[enemyId] = -(dy / distance) * speed * 1.5;
  } else {
    // Strafe slowly
    const perpX = -dy / distance;
    const perpY = dx / distance;
    Velocity.x[enemyId] = perpX * speed * 0.5;
    Velocity.y[enemyId] = perpY * speed * 0.5;
  }

  // Add π/2 so triangle tip leads (triangle points UP at rotation 0)
  Transform.rotation[enemyId] = Math.atan2(dy, dx) + PI_HALF;

  // Shooting - slower but more accurate
  EnemyAI.shootTimer[enemyId] -= deltaTime;
  if (EnemyAI.shootTimer[enemyId] <= 0 && projectileSpawnCallback && state === 0) {
    const angle = Math.atan2(dy, dx);
    projectileSpawnCallback(enemyX, enemyY, angle, 400, 20);
    EnemyAI.shootTimer[enemyId] = 3.0;
    // Enter scoot state after firing
    EnemyAI.state[enemyId] = 1;
    EnemyAI.timer[enemyId] = 0;
  }
}

/**
 * Healer - avoid player, heal nearby enemies
 */
function updateHealerAI(
  _world: IWorld,
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

  // Always flee from player
  if (distance < 300) {
    Velocity.x[enemyId] = -(dx / distance) * speed;
    Velocity.y[enemyId] = -(dy / distance) * speed;
  } else {
    // Wander randomly
    if (Math.random() < 0.02) {
      const wanderAngle = Math.random() * PI_TWO;
      EnemyAI.targetX[enemyId] = enemyX + Math.cos(wanderAngle) * 100;
      EnemyAI.targetY[enemyId] = enemyY + Math.sin(wanderAngle) * 100;
    }
    const tdx = EnemyAI.targetX[enemyId] - enemyX;
    const tdy = EnemyAI.targetY[enemyId] - enemyY;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tdist > 10) {
      Velocity.x[enemyId] = (tdx / tdist) * speed * 0.5;
      Velocity.y[enemyId] = (tdy / tdist) * speed * 0.5;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(-dy, -dx); // Face away from player

  // Healing logic
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0) {
    // Heal nearby enemies using spatial hash for O(nearby) instead of O(all)
    const spatialHash = getEnemySpatialHash();
    const nearbyEnemies = spatialHash.query(enemyX, enemyY, 100);
    for (const nearby of nearbyEnemies) {
      if (nearby.id === enemyId) continue;
      Health.current[nearby.id] = Math.min(
        Health.current[nearby.id] + 5,
        Health.max[nearby.id]
      );
    }
    EnemyAI.specialTimer[enemyId] = 1.0; // Heal every second
  }
}

/**
 * Shielded - normal chase but with shield mechanic (handled in damage)
 */
function updateShieldedAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (state === 0) {
    // Advance — chase at 0.8x speed (heavier than Shambler)
    if (distance > 1) {
      const speed = Velocity.speed[enemyId] * 0.8;
      Velocity.x[enemyId] = (dx / distance) * speed;
      Velocity.y[enemyId] = (dy / distance) * speed;
      Transform.rotation[enemyId] = Math.atan2(dy, dx);
    }

    // Transition to brace after 2.5-3.5s
    if (EnemyAI.timer[enemyId] > 2.5 + EnemyAI.phase[enemyId]) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Brace — stop and regenerate shield faster
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    if (EnemyAI.timer[enemyId] > 0.7) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random(); // Randomize next brace timing
    }
  }

  // Shield regeneration logic (3x faster during brace)
  const shieldMax = EnemyType.shieldMax[enemyId];
  if (shieldMax > 0 && EnemyType.shieldCurrent[enemyId] < shieldMax) {
    EnemyType.shieldRegenTimer[enemyId] -= deltaTime;
    if (EnemyType.shieldRegenTimer[enemyId] <= 0) {
      const regenRate = state === 1 ? 15 : 5;
      EnemyType.shieldCurrent[enemyId] = Math.min(
        EnemyType.shieldCurrent[enemyId] + regenRate * deltaTime,
        shieldMax
      );
    }
  }
}

/**
 * Teleporter - blink around near player
 */
function updateTeleporterAI(
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

  // Post-teleport pause (state 1)
  if (EnemyAI.state[enemyId] === 1) {
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    if (EnemyAI.timer[enemyId] > 0.2) {
      EnemyAI.state[enemyId] = 0;
    }
  } else if (distance > 200) {
    // Far — approach at 0.6x speed
    Velocity.x[enemyId] = (dx / distance) * speed * 0.6;
    Velocity.y[enemyId] = (dy / distance) * speed * 0.6;
  } else if (distance > 80) {
    // Mid range — strafe (tangent movement)
    const tangentX = -dy / distance;
    const tangentY = dx / distance;
    Velocity.x[enemyId] = tangentX * speed;
    Velocity.y[enemyId] = tangentY * speed;
  } else {
    // Too close — back away
    Velocity.x[enemyId] = -(dx / distance) * speed * 0.8;
    Velocity.y[enemyId] = -(dy / distance) * speed * 0.8;
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Teleport logic
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0) {
    // Teleport to random position near player
    const teleportDist = 80 + Math.random() * 120;
    const teleportAngle = Math.random() * PI_TWO;

    Transform.x[enemyId] = playerX + Math.cos(teleportAngle) * teleportDist;
    Transform.y[enemyId] = playerY + Math.sin(teleportAngle) * teleportDist;

    // Keep on screen
    Transform.x[enemyId] = Math.max(20, Math.min(gameBoundsWidth - 20, Transform.x[enemyId]));
    Transform.y[enemyId] = Math.max(20, Math.min(gameBoundsHeight - 20, Transform.y[enemyId]));

    EnemyAI.specialTimer[enemyId] = 2.0 + Math.random() * 1.5;
    // Brief pause after materializing
    EnemyAI.state[enemyId] = 1;
    EnemyAI.timer[enemyId] = 0;
  }
}

/**
 * Giant - slow approach with periodic seismic stomp.
 * State 0: Lumber toward player
 * State 1: Windup — stop and shake for 1.0s
 * State 2: Stomp — deal AOE damage via groundSlamCallback, return to state 0
 */
function updateGiantAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (state === 0) {
    // Lumber — chase at base speed
    if (distance > 1) {
      const speed = Velocity.speed[enemyId];
      Velocity.x[enemyId] = (dx / distance) * speed;
      Velocity.y[enemyId] = (dy / distance) * speed;
      Transform.rotation[enemyId] = Math.atan2(dy, dx);
    }

    // Start stomp windup after 4.0-6.0s
    if (EnemyAI.timer[enemyId] > 4.0 + EnemyAI.phase[enemyId] * 2.0) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Windup — stop and shake for 1.0s (same pattern as Charger)
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    Transform.x[enemyId] += (Math.random() - 0.5) * 4;

    if (EnemyAI.timer[enemyId] > 1.0) {
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Stomp — deal AOE damage
    if (EnemyAI.timer[enemyId] < deltaTime * 2 && groundSlamCallback) {
      const stompDamage = EnemyType.baseDamage[enemyId] * 0.5;
      groundSlamCallback(enemyX, enemyY, 80, stompDamage);
    }

    // Return to lumber
    EnemyAI.state[enemyId] = 0;
    EnemyAI.timer[enemyId] = 0;
    EnemyAI.phase[enemyId] = Math.random(); // Randomize next stomp timing
  }
}

/**
 * Splitter - wobbling chase that pulses in speed.
 * Gelatinous feel that hints at splitting mechanic.
 */
function updateSplitterAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    EnemyAI.phase[enemyId] += deltaTime;
    const phase = EnemyAI.phase[enemyId];
    const speed = Velocity.speed[enemyId];

    // Pulsing speed: 0.6x to 1.2x
    const speedMultiplier = 0.9 + Math.sin(phase * 3) * 0.3;

    // Slight perpendicular drift for wobble
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const wobble = Math.sin(phase * 1.7) * 0.15;

    const moveX = (dx / distance) + perpX * wobble;
    const moveY = (dy / distance) + perpY * wobble;
    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

    Velocity.x[enemyId] = (moveX / moveMag) * speed * speedMultiplier;
    Velocity.y[enemyId] = (moveY / moveMag) * speed * speedMultiplier;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
  }
}

/**
 * Ghost - drifting wave chase with sinusoidal sweep.
 * Ethereal and wavy, clearly distinct from basic chasers.
 */
function updateGhostAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    EnemyAI.phase[enemyId] += deltaTime * 2;
    const phase = EnemyAI.phase[enemyId];
    const speed = Velocity.speed[enemyId];

    // Speed oscillates: faster on approach arcs, slower on drift-away
    const speedMultiplier = 1.0 + Math.cos(phase) * 0.3;

    // Large perpendicular sweep for ghostly drift
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const sweep = Math.sin(phase) * 0.4;

    const moveX = (dx / distance) + perpX * sweep;
    const moveY = (dy / distance) + perpY * sweep;
    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

    Velocity.x[enemyId] = (moveX / moveMag) * speed * speedMultiplier;
    Velocity.y[enemyId] = (moveY / moveMag) * speed * speedMultiplier;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
  }
}

/**
 * Splitter Mini - scatter burst then frantic chase.
 * State 0: Scatter outward for 0.5s in random direction
 * State 1: Chase with half-amplitude zigzag
 */
function updateSplitterMiniAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const speed = Velocity.speed[enemyId];

  if (state === 0) {
    // Scatter — burst outward in direction set by phase at spawn
    const scatterAngle = EnemyAI.phase[enemyId];
    Velocity.x[enemyId] = Math.cos(scatterAngle) * speed * 1.5;
    Velocity.y[enemyId] = Math.sin(scatterAngle) * speed * 1.5;
    Transform.rotation[enemyId] = scatterAngle;

    if (EnemyAI.timer[enemyId] > 0.5) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Frantic chase with half-amplitude zigzag
    const dx = playerX - enemyX;
    const dy = playerY - enemyY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 1) {
      EnemyAI.phase[enemyId] += deltaTime * 5;
      const phase = EnemyAI.phase[enemyId];

      const perpX = -dy / distance;
      const perpY = dx / distance;
      const zigzag = Math.sin(phase) * 0.25; // Half amplitude

      const moveX = (dx / distance) + perpX * zigzag;
      const moveY = (dy / distance) + perpY * zigzag;
      const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

      Velocity.x[enemyId] = (moveX / moveMag) * speed;
      Velocity.y[enemyId] = (moveY / moveMag) * speed;
      Transform.rotation[enemyId] = Math.atan2(moveY, moveX);
    }
  }
}

/**
 * Lurker - hit-and-run: cautious approach, quick lunge, retreat.
 * State 0: Approach at 0.7x speed
 * State 1: Lunge toward stored target at 3.5x speed
 * State 2: Retreat away from player at 1.3x speed with lateral drift
 */
function updateLurkerAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  if (state === 0) {
    // Approach cautiously
    if (distance > 1) {
      Velocity.x[enemyId] = (dx / distance) * speed * 0.7;
      Velocity.y[enemyId] = (dy / distance) * speed * 0.7;
      Transform.rotation[enemyId] = Math.atan2(dy, dx) + PI_HALF;
    }

    // Transition to lunge when close or after timeout
    if (distance < 120 || EnemyAI.timer[enemyId] > 4.0) {
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Lunge toward stored target
    const lungeTargetDx = EnemyAI.targetX[enemyId] - enemyX;
    const lungeTargetDy = EnemyAI.targetY[enemyId] - enemyY;
    const lungeDistance = Math.sqrt(lungeTargetDx * lungeTargetDx + lungeTargetDy * lungeTargetDy);

    if (lungeDistance > 10 && EnemyAI.timer[enemyId] < 0.4) {
      const lungeSpeed = speed * 3.5;
      Velocity.x[enemyId] = (lungeTargetDx / lungeDistance) * lungeSpeed;
      Velocity.y[enemyId] = (lungeTargetDy / lungeDistance) * lungeSpeed;
      Transform.rotation[enemyId] = Math.atan2(lungeTargetDy, lungeTargetDx) + PI_HALF;
    } else {
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Retreat with lateral drift
    if (distance > 1) {
      EnemyAI.phase[enemyId] += deltaTime * 3;
      const lateralDrift = Math.sin(EnemyAI.phase[enemyId]) * 0.3;
      const perpX = -dy / distance;
      const perpY = dx / distance;

      const retreatX = -(dx / distance) + perpX * lateralDrift;
      const retreatY = -(dy / distance) + perpY * lateralDrift;
      const retreatMag = Math.sqrt(retreatX * retreatX + retreatY * retreatY);

      Velocity.x[enemyId] = (retreatX / retreatMag) * speed * 1.3;
      Velocity.y[enemyId] = (retreatY / retreatMag) * speed * 1.3;
      Transform.rotation[enemyId] = Math.atan2(-dy, -dx) + PI_HALF;
    }

    if (EnemyAI.timer[enemyId] > 1.5) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
    }
  }
}

/**
 * Warden - zone control: patrol near player, plant AOE hazards.
 * State 0: Patrol toward offset point ~200px from player
 * State 1: Plant — shake windup then fire ground slam AOE
 * State 2: Reposition to opposite side of player
 */
function updateWardenAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  EnemyAI.specialTimer[enemyId] -= deltaTime;

  if (state === 0) {
    // Patrol — move toward offset point
    const targetDx = EnemyAI.targetX[enemyId] - enemyX;
    const targetDy = EnemyAI.targetY[enemyId] - enemyY;
    const targetDist = Math.sqrt(targetDx * targetDx + targetDy * targetDy);

    if (targetDist > 20) {
      Velocity.x[enemyId] = (targetDx / targetDist) * speed;
      Velocity.y[enemyId] = (targetDy / targetDist) * speed;
    } else {
      Velocity.x[enemyId] = 0;
      Velocity.y[enemyId] = 0;
    }
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    // Recalculate patrol target every 3.5-4.5s
    if (EnemyAI.timer[enemyId] > 3.5 + EnemyAI.phase[enemyId]) {
      const offsetAngle = Math.random() * PI_TWO;
      EnemyAI.targetX[enemyId] = playerX + Math.cos(offsetAngle) * 200;
      EnemyAI.targetY[enemyId] = playerY + Math.sin(offsetAngle) * 200;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random();

      // Transition to plant if slam is ready
      if (EnemyAI.specialTimer[enemyId] <= 0) {
        EnemyAI.state[enemyId] = 1;
        EnemyAI.timer[enemyId] = 0;
      }
    }
  } else if (state === 1) {
    // Plant — shake windup then AOE
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    Transform.x[enemyId] += (Math.random() - 0.5) * 3;

    if (EnemyAI.timer[enemyId] > 0.8) {
      // Fire ground slam at own position
      if (groundSlamCallback) {
        groundSlamCallback(enemyX, enemyY, 50, EnemyType.baseDamage[enemyId]);
      }
      EnemyAI.specialTimer[enemyId] = 5.0;
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Reposition — move to opposite side of player
    if (distance > 1) {
      const awayX = -(dx / distance);
      const awayY = -(dy / distance);
      Velocity.x[enemyId] = awayX * speed * 1.2;
      Velocity.y[enemyId] = awayY * speed * 1.2;
    }
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    if (EnemyAI.timer[enemyId] > 2.0) {
      // Set new patrol target
      const offsetAngle = Math.random() * PI_TWO;
      EnemyAI.targetX[enemyId] = playerX + Math.cos(offsetAngle) * 200;
      EnemyAI.targetY[enemyId] = playerY + Math.sin(offsetAngle) * 200;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random();
    }
  }
}

/**
 * Wraith - phasing: alternates between corporeal and phased states.
 * State 0: Corporeal — chase at full speed, deals contact damage
 * State 1: Phased — chase at 0.5x speed, no contact damage (handled in GameScene)
 */
function updateWraithAI(enemyId: number, playerX: number, playerY: number, _deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  if (distance > 1) {
    const speedMultiplier = state === 0 ? 1.0 : 0.5;
    Velocity.x[enemyId] = (dx / distance) * speed * speedMultiplier;
    Velocity.y[enemyId] = (dy / distance) * speed * speedMultiplier;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
  }

  if (state === 0) {
    // Corporeal — after 3-4s, phase out
    if (EnemyAI.timer[enemyId] > 3.0 + EnemyAI.phase[enemyId]) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random() * 0.5; // 1.5-2.0s phased
    }
  } else {
    // Phased — after 1.5-2.0s, become corporeal
    if (EnemyAI.timer[enemyId] > 1.5 + EnemyAI.phase[enemyId]) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random(); // 3-4s corporeal
    }
  }
}

/**
 * Rallier - offensive buff aura: maintains distance, speeds up nearby enemies.
 * Stays ~180px from player, strafes when in range.
 * Every 2s, boosts speed of nearby enemies by +15 (capped at 200).
 */
function updateRallierAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  const preferredDistance = 180;

  if (distance < preferredDistance - 30) {
    // Too close — retreat
    Velocity.x[enemyId] = -(dx / distance) * speed;
    Velocity.y[enemyId] = -(dy / distance) * speed;
  } else if (distance > preferredDistance + 40) {
    // Too far — approach
    Velocity.x[enemyId] = (dx / distance) * speed * 0.7;
    Velocity.y[enemyId] = (dy / distance) * speed * 0.7;
  } else {
    // In range — strafe
    const perpX = -dy / distance;
    const perpY = dx / distance;
    Velocity.x[enemyId] = perpX * speed * 0.5;
    Velocity.y[enemyId] = perpY * speed * 0.5;
  }

  // Add π/2 so triangle tip leads
  Transform.rotation[enemyId] = Math.atan2(dy, dx) + PI_HALF;

  // Buff aura — speed boost nearby enemies every 2s
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0) {
    const spatialHash = getEnemySpatialHash();
    const nearby = spatialHash.query(enemyX, enemyY, 80);

    for (let i = 0; i < nearby.length; i++) {
      const neighborId = nearby[i].id;
      if (neighborId === enemyId) continue;
      // Cap speed at 200 to prevent runaway stacking
      const currentSpeed = Velocity.speed[neighborId];
      if (currentSpeed < 200) {
        Velocity.speed[neighborId] = Math.min(currentSpeed + 15, 200);
      }
    }

    EnemyAI.specialTimer[enemyId] = 2.0;
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

  // Determine phase based on health
  const healthPercent = Health.current[enemyId] / Health.max[enemyId];
  const phase = healthPercent > 0.66 ? 1 : healthPercent > 0.33 ? 2 : 3;

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
      } else {
        EnemyAI.state[enemyId] = 3; // Fire ring
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
      // Fire ring of projectiles
      const projectileCount = 12;
      for (let i = 0; i < projectileCount; i++) {
        const angle = (i / projectileCount) * PI_TWO;
        projectileSpawnCallback(enemyX, enemyY, angle, 150, 15);
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
      EnemyAI.specialTimer[enemyId] = 5.0;
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
