import { Transform, Velocity, EnemyAI } from '../../components';
import { projectileSpawnCallback } from './state';
import { PI_TWO, telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, voidWyrmSweepTelegraph, voidWyrmRingTelegraph } from './telegraphs';

/**
 * Void Wyrm (boss) — circles the player with serpentine motion, alternating
 * telegraphed cross-screen sweeps with projectile rings; later HP phases add
 * interleaved rings for bullet-hell pressure.
 */

/**
 * Void Wyrm - Serpentine boss that sweeps across screen, fires projectile rings.
 * States: 0 = circling, 1 = preparing sweep, 2 = sweeping, 3 = firing ring
 */
export function updateVoidWyrmAI(
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
