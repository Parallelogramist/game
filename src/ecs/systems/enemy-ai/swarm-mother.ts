import { Transform, Velocity, EnemyAI } from '../../components';
import { minionSpawnCallback } from './state';
import { PI_TWO } from './common';

/**
 * Swarm Mother (miniboss) — drifts slowly toward the player, holding at
 * medium range while birthing swarm minions every 3 seconds.
 */

/**
 * Swarm Mother - Continuously spawns small swarm enemies.
 * Moves slowly toward player while spawning.
 */
export function updateSwarmMotherAI(
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

  // Move slowly toward player
  if (distance > 100) {
    Velocity.x[enemyId] = (dx / distance) * speed;
    Velocity.y[enemyId] = (dy / distance) * speed;
  } else {
    // Stay at medium range
    Velocity.x[enemyId] *= 0.9;
    Velocity.y[enemyId] *= 0.9;
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Spawn minions periodically
  EnemyAI.specialTimer[enemyId] -= deltaTime;
  if (EnemyAI.specialTimer[enemyId] <= 0 && minionSpawnCallback) {
    // Spawn a swarm enemy near self
    const spawnAngle = Math.random() * PI_TWO;
    const spawnDist = 30 + Math.random() * 20;
    const spawnX = enemyX + Math.cos(spawnAngle) * spawnDist;
    const spawnY = enemyY + Math.sin(spawnAngle) * spawnDist;

    minionSpawnCallback(spawnX, spawnY, 'swarm');
    EnemyAI.specialTimer[enemyId] = 3.0; // Spawn every 3 seconds
  }
}
