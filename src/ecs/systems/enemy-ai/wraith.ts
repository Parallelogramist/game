import { Transform, Velocity, EnemyAI } from '../../components';

/**
 * Wraith — alternates on randomized timers between corporeal (full speed,
 * contact damage) and phased (half speed, no contact damage — the damage
 * exemption is handled in GameScene) states.
 */

/**
 * Wraith - phasing: alternates between corporeal and phased states.
 * State 0: Corporeal — chase at full speed, deals contact damage
 * State 1: Phased — chase at 0.5x speed, no contact damage (handled in GameScene)
 */
export function updateWraithAI(enemyId: number, playerX: number, playerY: number, _deltaTime: number): void {
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
