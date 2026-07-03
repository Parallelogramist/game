import { Transform, Velocity, EnemyAI } from '../../components';

/**
 * Tank — slow march with periodic double-speed surges. Its damage-reduction
 * aura is applied separately by applyEliteAuras in EnemyAISystem.
 */

/**
 * Tank - slow march with periodic speed surges
 * State 0: March at base speed, timer counts up to surge
 * State 1: Surge at double speed for 0.8s
 */
export function updateTankAI(enemyId: number, playerX: number, playerY: number, _deltaTime: number): void {
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
