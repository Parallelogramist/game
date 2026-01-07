import { defineQuery, IWorld, hasComponent } from 'bitecs';
import { Transform, Velocity, PlayerTag, EnemyTag, EnemyAI, EnemyType, Health, StatusEffect } from '../components';
import { EnemyAIType } from '../../enemies/EnemyTypes';

// OPTIMIZATION: Pre-computed Math constants to avoid repeated calculations
const PI_HALF = Math.PI / 2;
const PI_TWO = Math.PI * 2;

// Queries
const enemyQuery = defineQuery([Transform, Velocity, EnemyTag, EnemyAI]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// Callback for spawning enemy projectiles
let projectileSpawnCallback: ((x: number, y: number, angle: number, speed: number, damage: number) => void) | null = null;

// Callback for spawning minion enemies (for SwarmMother, Necromancer)
let minionSpawnCallback: ((x: number, y: number, typeId: string) => void) | null = null;

// Callback to get XP gem positions (for Glutton)
let xpGemPositionsCallback: (() => { x: number; y: number; entityId: number }[]) | null = null;

// Callback to consume an XP gem (for Glutton)
let consumeXPGemCallback: ((entityId: number) => void) | null = null;

// Dead enemy positions for Necromancer to revive
const deadEnemyPositions: { x: number; y: number; time: number }[] = [];

// Twin linking - stores the entity ID of the linked twin
const twinLinks = new Map<number, number>();

export function setEnemyProjectileCallback(
  callback: (x: number, y: number, angle: number, speed: number, damage: number) => void
): void {
  projectileSpawnCallback = callback;
}

export function setMinionSpawnCallback(
  callback: (x: number, y: number, typeId: string) => void
): void {
  minionSpawnCallback = callback;
}

export function setXPGemCallbacks(
  getPositions: () => { x: number; y: number; entityId: number }[],
  consumeGem: (entityId: number) => void
): void {
  xpGemPositionsCallback = getPositions;
  consumeXPGemCallback = consumeGem;
}

export function recordEnemyDeath(x: number, y: number): void {
  deadEnemyPositions.push({ x, y, time: Date.now() });
  // Keep only recent deaths (last 10 seconds)
  const now = Date.now();
  while (deadEnemyPositions.length > 0 && now - deadEnemyPositions[0].time > 10000) {
    deadEnemyPositions.shift();
  }
}

export function linkTwins(twinA: number, twinB: number): void {
  twinLinks.set(twinA, twinB);
  twinLinks.set(twinB, twinA);
}

export function unlinkTwin(twinId: number): void {
  const linkedId = twinLinks.get(twinId);
  if (linkedId !== undefined) {
    twinLinks.delete(linkedId);
  }
  twinLinks.delete(twinId);
}

export function getLinkedTwin(twinId: number): number | undefined {
  return twinLinks.get(twinId);
}

/**
 * Get all twin links as pairs for serialization.
 * Returns unique pairs (avoids duplicates since links are bidirectional).
 */
export function getAllTwinLinks(): [number, number][] {
  const pairs: [number, number][] = [];
  const seen = new Set<number>();
  for (const [twinA, twinB] of twinLinks) {
    if (!seen.has(twinA) && !seen.has(twinB)) {
      pairs.push([twinA, twinB]);
      seen.add(twinA);
      seen.add(twinB);
    }
  }
  return pairs;
}

/**
 * Resets all module-level state in EnemyAISystem.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetEnemyAISystem(): void {
  deadEnemyPositions.length = 0;
  twinLinks.clear();
  // Clear all callbacks to prevent stale references
  projectileSpawnCallback = null;
  minionSpawnCallback = null;
  xpGemPositionsCallback = null;
  consumeXPGemCallback = null;
}

/**
 * EnemyAISystem handles different enemy behaviors based on their AI type.
 */
export function enemyAISystem(world: IWorld, deltaTime: number = 0.016): IWorld {
  const enemies = enemyQuery(world);
  const players = playerQuery(world);

  if (players.length === 0) return world;

  const playerId = players[0];
  const playerX = Transform.x[playerId];
  const playerY = Transform.y[playerId];

  for (let i = 0; i < enemies.length; i++) {
    const enemyId = enemies[i];
    const aiType = EnemyAI.aiType[enemyId];

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
        updateSwarmAI(enemyId, playerX, playerY);
        break;
      case EnemyAIType.Tank:
        updateTankAI(enemyId, playerX, playerY);
        break;
      case EnemyAIType.Exploder:
        updateExploderAI(enemyId, playerX, playerY);
        break;
      case EnemyAIType.Splitter:
        updateChaseAI(enemyId, playerX, playerY); // Same as chase
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
        updateGiantAI(enemyId, playerX, playerY);
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

  return world;
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
    Velocity.x[enemyId] = (dx / distance) * speed;
    Velocity.y[enemyId] = (dy / distance) * speed;
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

    // Update phase for zigzag pattern
    EnemyAI.phase[enemyId] += deltaTime * 6; // Oscillation speed

    // Calculate perpendicular vector
    const perpX = -dy / distance;
    const perpY = dx / distance;

    // Zigzag offset
    const zigzagAmount = Math.sin(EnemyAI.phase[enemyId]) * 0.7;

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

  const preferredDistance = 150; // Preferred orbit distance

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
 * Swarm - very simple, fast direct chase
 */
function updateSwarmAI(enemyId: number, playerX: number, playerY: number): void {
  updateChaseAI(enemyId, playerX, playerY);
  // Swarm enemies just chase faster (speed is set in type definition)
}

/**
 * Tank - slow, steady movement toward player
 */
function updateTankAI(enemyId: number, playerX: number, playerY: number): void {
  updateChaseAI(enemyId, playerX, playerY);
  // Tank AI is same as chase but with slower speed defined in type
}

/**
 * Exploder - fast chase, will explode on death (handled separately)
 */
function updateExploderAI(enemyId: number, playerX: number, playerY: number): void {
  // Chase quickly - the explosion is handled in death logic
  updateChaseAI(enemyId, playerX, playerY);
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
    // In sweet spot - strafe slowly
    const perpX = -dy / distance;
    const perpY = dx / distance;
    Velocity.x[enemyId] = perpX * speed * 0.3;
    Velocity.y[enemyId] = perpY * speed * 0.3;
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

  // Stay at long range
  const preferredDistance = 350;

  if (distance < preferredDistance - 50) {
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
  if (EnemyAI.shootTimer[enemyId] <= 0 && projectileSpawnCallback) {
    const angle = Math.atan2(dy, dx);
    projectileSpawnCallback(enemyX, enemyY, angle, 400, 20);
    EnemyAI.shootTimer[enemyId] = 3.0;
  }
}

/**
 * Healer - avoid player, heal nearby enemies
 */
function updateHealerAI(
  world: IWorld,
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
    // Heal nearby enemies
    const allEnemies = enemyQuery(world);
    for (const otherEnemyId of allEnemies) {
      if (otherEnemyId === enemyId) continue;

      const ox = Transform.x[otherEnemyId];
      const oy = Transform.y[otherEnemyId];
      const healDist = Math.sqrt((ox - enemyX) ** 2 + (oy - enemyY) ** 2);

      if (healDist < 100) {
        Health.current[otherEnemyId] = Math.min(
          Health.current[otherEnemyId] + 5,
          Health.max[otherEnemyId]
        );
      }
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
  updateChaseAI(enemyId, playerX, playerY);

  // Shield regeneration logic
  const shieldMax = EnemyType.shieldMax[enemyId];
  if (shieldMax > 0 && EnemyType.shieldCurrent[enemyId] < shieldMax) {
    EnemyType.shieldRegenTimer[enemyId] -= deltaTime;
    if (EnemyType.shieldRegenTimer[enemyId] <= 0) {
      EnemyType.shieldCurrent[enemyId] = Math.min(
        EnemyType.shieldCurrent[enemyId] + 5 * deltaTime,
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
  // Move toward player normally
  updateChaseAI(enemyId, playerX, playerY);

  // Teleport logic
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0) {
    // Teleport to random position near player
    const teleportDist = 80 + Math.random() * 120;
    const teleportAngle = Math.random() * PI_TWO;

    Transform.x[enemyId] = playerX + Math.cos(teleportAngle) * teleportDist;
    Transform.y[enemyId] = playerY + Math.sin(teleportAngle) * teleportDist;

    // Keep on screen
    Transform.x[enemyId] = Math.max(20, Math.min(1260, Transform.x[enemyId]));
    Transform.y[enemyId] = Math.max(20, Math.min(700, Transform.y[enemyId]));

    EnemyAI.specialTimer[enemyId] = 2.0 + Math.random() * 1.5; // Random cooldown
  }
}

/**
 * Giant - slow approach, area damage on attack
 */
function updateGiantAI(enemyId: number, playerX: number, playerY: number): void {
  // Same as chase but speed is very slow (defined in type)
  updateChaseAI(enemyId, playerX, playerY);
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
    const targetDx = EnemyAI.targetX[enemyId] - (enemyX - dx); // Original direction
    const targetDy = EnemyAI.targetY[enemyId] - (enemyY - dy);
    const angle = Math.atan2(targetDy, targetDx);

    const chargeSpeed = baseSpeed * 6; // Very fast!
    Velocity.x[enemyId] = Math.cos(angle) * chargeSpeed;
    Velocity.y[enemyId] = Math.sin(angle) * chargeSpeed;
    // Add π/2 so triangle tip leads (triangle points UP at rotation 0)
    Transform.rotation[enemyId] = angle + PI_HALF;

    // End charge after 1 second or if hitting edge
    if (timer > 1.0 || enemyX < 30 || enemyX > 1250 || enemyY < 30 || enemyY > 690) {
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
  if (EnemyAI.specialTimer[enemyId] <= 0 && minionSpawnCallback && deadEnemyPositions.length > 0) {
    // Revive up to 2 dead enemies
    const reviveCount = Math.min(2, deadEnemyPositions.length);
    for (let i = 0; i < reviveCount; i++) {
      const deadPos = deadEnemyPositions.shift();
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

// Callbacks for boss-specific effects
let groundSlamCallback: ((x: number, y: number, radius: number, damage: number) => void) | null = null;
let laserBeamCallback: ((x1: number, y1: number, x2: number, y2: number, damage: number) => void) | null = null;

export function setBossCallbacks(
  groundSlam: (x: number, y: number, radius: number, damage: number) => void,
  laserBeam: (x1: number, y1: number, x2: number, y2: number, damage: number) => void
): void {
  groundSlamCallback = groundSlam;
  laserBeamCallback = laserBeam;
}

/**
 * Resets boss-specific callbacks.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetBossCallbacks(): void {
  groundSlamCallback = null;
  laserBeamCallback = null;
}

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
    const targetX = 640; // Center of screen
    const targetY = 360;
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
      const spawnX = Math.min(1200, Math.max(80, enemyX + Math.cos(spawnAngle) * spawnDist));
      const spawnY = Math.min(640, Math.max(80, enemyY + Math.sin(spawnAngle) * spawnDist));
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
