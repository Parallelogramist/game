import { Transform, Velocity, EnemyAI } from '../../components';
import { PI_HALF } from './common';
import { projectileSpawnCallback } from './state';

/**
 * Sniper — holds ~350px range firing slow-cadence, high-damage accurate
 * shots, then scoots laterally at 1.5x speed for 0.5s after each shot.
 */

/**
 * Sniper - stay at screen edge, shoot accurate fast projectiles
 */
export function updateSniperAI(
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
