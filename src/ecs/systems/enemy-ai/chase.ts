import { Transform, Velocity } from '../../components';
import { chaseHeading } from './common';

/**
 * Chase — the baseline melee enemy: walks straight at the player with a
 * distance-aware speed scale (ambles at range, lunges when close). Also the
 * dispatcher's default fallback and the Glutton's no-gems-nearby mode, so
 * EnemyAISystem imports this handler directly.
 */

/**
 * Basic chase - move directly toward player
 */
export function updateChaseAI(enemyId: number, playerX: number, playerY: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    const speed = Velocity.speed[enemyId];
    // Distance-aware speed: amble at range, lunge when close
    const distanceScale = distance > 300 ? 0.9 : distance < 150 ? 1.1 : 1.0;
    const heading = chaseHeading(enemyX, enemyY, playerX, playerY, dx / distance, dy / distance);
    Velocity.x[enemyId] = heading.x * speed * distanceScale;
    Velocity.y[enemyId] = heading.y * speed * distanceScale;
    Transform.rotation[enemyId] = Math.atan2(heading.y, heading.x);
  } else {
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
  }
}
