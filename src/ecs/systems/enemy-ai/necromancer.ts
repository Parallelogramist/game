import { Transform, Velocity, EnemyAI } from '../../components';
import {
  projectileSpawnCallback, minionSpawnCallback,
  deadEnemyPositions, deadPositionsReadPointer, advanceDeadPositionsPointer,
} from './state';

/**
 * Necromancer (miniboss) — kites at ~250px firing 3-projectile spreads, and
 * every 5s revives up to 2 recently-dead enemies as ghosts from the shared
 * dead-position ring buffer.
 */

/**
 * Necromancer - Keeps distance, shoots projectiles, and revives dead enemies as ghosts.
 */
export function updateNecromancerAI(
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

  // Stay at medium-long range
  const preferredDistance = 250;

  if (distance < preferredDistance - 30) {
    // Too close - retreat
    Velocity.x[enemyId] = -(dx / distance) * speed;
    Velocity.y[enemyId] = -(dy / distance) * speed;
  } else if (distance > preferredDistance + 50) {
    // Too far - approach slowly
    Velocity.x[enemyId] = (dx / distance) * speed * 0.5;
    Velocity.y[enemyId] = (dy / distance) * speed * 0.5;
  } else {
    // In range - circle around
    const perpX = -dy / distance;
    const perpY = dx / distance;
    Velocity.x[enemyId] = perpX * speed * 0.4;
    Velocity.y[enemyId] = perpY * speed * 0.4;
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Shoot projectiles
  EnemyAI.shootTimer[enemyId] -= deltaTime;
  if (EnemyAI.shootTimer[enemyId] <= 0 && projectileSpawnCallback) {
    const angle = Math.atan2(dy, dx);
    // Fire 3 projectiles in a spread
    projectileSpawnCallback(enemyX, enemyY, angle - 0.2, 150, 15);
    projectileSpawnCallback(enemyX, enemyY, angle, 150, 15);
    projectileSpawnCallback(enemyX, enemyY, angle + 0.2, 150, 15);
    EnemyAI.shootTimer[enemyId] = 2.5;
  }

  // Revive dead enemies as ghosts
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  const availableDeadCount = deadEnemyPositions.length - deadPositionsReadPointer;
  if (EnemyAI.specialTimer[enemyId] <= 0 && minionSpawnCallback && availableDeadCount > 0) {
    // Revive up to 2 dead enemies (consume from read pointer forward)
    const reviveCount = Math.min(2, availableDeadCount);
    for (let i = 0; i < reviveCount; i++) {
      const deadPos = deadEnemyPositions[deadPositionsReadPointer];
      advanceDeadPositionsPointer();
      if (deadPos) {
        minionSpawnCallback(deadPos.x, deadPos.y, 'ghost');
      }
    }
    EnemyAI.specialTimer[enemyId] = 5.0; // Revive every 5 seconds
  }
}
