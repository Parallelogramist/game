import { IWorld } from 'bitecs';
import { Transform, Velocity, EnemyAI, Health } from '../../components';
import { getEnemySpatialHash } from '../../../utils/SpatialHash';
import { PI_TWO, isDestructible } from './common';

/**
 * Healer — flees the player inside 300px and wanders otherwise; every second
 * heals nearby enemies through the spatial hash (crates excluded via
 * isDestructible).
 */

/**
 * Healer - avoid player, heal nearby enemies
 */
export function updateHealerAI(
  _world: IWorld,
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

  // Always flee from player
  if (distance < 300) {
    Velocity.x[enemyId] = -(dx / distance) * speed;
    Velocity.y[enemyId] = -(dy / distance) * speed;
  } else {
    // Wander randomly
    if (Math.random() < 0.02) {
      const wanderAngle = Math.random() * PI_TWO;
      EnemyAI.targetX[enemyId] = enemyX + Math.cos(wanderAngle) * 100;
      EnemyAI.targetY[enemyId] = enemyY + Math.sin(wanderAngle) * 100;
    }
    const tdx = EnemyAI.targetX[enemyId] - enemyX;
    const tdy = EnemyAI.targetY[enemyId] - enemyY;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tdist > 10) {
      Velocity.x[enemyId] = (tdx / tdist) * speed * 0.5;
      Velocity.y[enemyId] = (tdy / tdist) * speed * 0.5;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(-dy, -dx); // Face away from player

  // Healing logic
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0) {
    // Heal nearby enemies using spatial hash for O(nearby) instead of O(all)
    const spatialHash = getEnemySpatialHash();
    const nearbyEnemies = spatialHash.query(enemyX, enemyY, 100);
    for (const nearby of nearbyEnemies) {
      if (nearby.id === enemyId || isDestructible(nearby.id)) continue;
      Health.current[nearby.id] = Math.min(
        Health.current[nearby.id] + 5,
        Health.max[nearby.id]
      );
    }
    EnemyAI.specialTimer[enemyId] = 1.0; // Heal every second
  }
}
