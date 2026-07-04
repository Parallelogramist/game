import { Transform, Velocity, EnemyAI } from '../../components';
import { getEnemySpatialHash } from '../../../utils/SpatialHash';
import { PI_HALF } from './common';

/**
 * Rallier — support elite: keeps ~180px from the player and every 2s
 * permanently raises nearby enemies' base speed (capped at 200). Its
 * per-frame +30% velocity aura is applied by applyEliteAuras in
 * EnemyAISystem.
 */

/**
 * Rallier - offensive buff aura: maintains distance, speeds up nearby enemies.
 * Stays ~180px from player, strafes when in range.
 * Every 2s, boosts speed of nearby enemies by +15 (capped at 200).
 */
export function updateRallierAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  const preferredDistance = 180;

  if (distance < preferredDistance - 30) {
    // Too close — retreat
    Velocity.x[enemyId] = -(dx / distance) * speed;
    Velocity.y[enemyId] = -(dy / distance) * speed;
  } else if (distance > preferredDistance + 40) {
    // Too far — approach
    Velocity.x[enemyId] = (dx / distance) * speed * 0.7;
    Velocity.y[enemyId] = (dy / distance) * speed * 0.7;
  } else {
    // In range — strafe
    const perpX = -dy / distance;
    const perpY = dx / distance;
    Velocity.x[enemyId] = perpX * speed * 0.5;
    Velocity.y[enemyId] = perpY * speed * 0.5;
  }

  // Add π/2 so triangle tip leads
  Transform.rotation[enemyId] = Math.atan2(dy, dx) + PI_HALF;

  // Buff aura — speed boost nearby enemies every 2s
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0) {
    const spatialHash = getEnemySpatialHash();
    const nearby = spatialHash.query(enemyX, enemyY, 80);

    for (let i = 0; i < nearby.length; i++) {
      const neighborId = nearby[i].id;
      if (neighborId === enemyId) continue;
      // Cap speed at 200 to prevent runaway stacking
      const currentSpeed = Velocity.speed[neighborId];
      if (currentSpeed < 200) {
        Velocity.speed[neighborId] = Math.min(currentSpeed + 15, 200);
      }
    }

    EnemyAI.specialTimer[enemyId] = 2.0;
  }
}
