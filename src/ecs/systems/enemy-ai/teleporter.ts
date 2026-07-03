import { Transform, Velocity, EnemyAI } from '../../components';
import { PI_TWO } from './common';
import { gameBoundsWidth, gameBoundsHeight } from './state';

/**
 * Teleporter — maintains mid-range with strafing, then periodically blinks to
 * a random point near the player (clamped to game bounds) with a brief
 * post-teleport pause.
 */

/**
 * Teleporter - blink around near player
 */
export function updateTeleporterAI(
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
