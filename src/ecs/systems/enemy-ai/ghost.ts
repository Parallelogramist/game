import { Transform, Velocity, EnemyAI } from '../../components';

/**
 * Ghost — ethereal drifting chase: large sinusoidal perpendicular sweep with
 * speed that oscillates between approach arcs and drift-away.
 */

/**
 * Ghost - drifting wave chase with sinusoidal sweep.
 * Ethereal and wavy, clearly distinct from basic chasers.
 */
export function updateGhostAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
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
