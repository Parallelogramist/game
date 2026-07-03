import { Transform, Velocity, EnemyAI } from '../../components';
import { projectileSpawnCallback } from './state';

/**
 * Shooter — kites at ~200px (retreat / approach / strafe bands) and fires a
 * projectile at the player every 2s via the injected projectile callback.
 */

/**
 * Shooter - maintain distance and shoot projectiles at player
 */
export function updateShooterAI(
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
