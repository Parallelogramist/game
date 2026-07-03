import { Transform, Velocity, EnemyAI } from '../../components';
import { telegraphManager } from './common';
import { spawnTelegraph, dasherDashTelegraph } from './telegraphs';

/**
 * Dasher — alternates between a shaking pause and a telegraphed 4x-speed dash
 * toward the player's stored position.
 */

/**
 * Dash - pause, then rapidly dash toward player
 */
export function updateDashAI(
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
      // Telegraph the dash trajectory.
      spawnTelegraph(telegraphManager, enemyX, enemyY, dasherDashTelegraph(Math.atan2(playerY - enemyY, playerX - enemyX)));
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
