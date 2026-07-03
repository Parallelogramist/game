import { Transform, Velocity, EnemyAI } from '../../components';

/**
 * Exploder — chases with an acceleration ramp (1x → 2.5x over time); the
 * explosion itself happens on contact/death outside this system.
 */

/**
 * Exploder - chase with acceleration ramp. Gets faster as it closes in.
 * Uses phase as accumulator: speed ramps from 1x to 2.5x over time.
 */
export function updateExploderAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
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
