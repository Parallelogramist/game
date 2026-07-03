import { Transform, Velocity, EnemyAI } from '../../components';
import { EnemyAIType } from '../../../enemies/EnemyTypes';
import { getEnemySpatialHash } from '../../../utils/SpatialHash';

/**
 * Swarm — boids-inspired flocking: chase blended with separation and cohesion
 * against nearby Swarm neighbors pulled from the enemy spatial hash.
 */

/**
 * Swarm - boids-inspired flocking toward player.
 * Chase (60%) + Separation (25%) + Cohesion (15%) with nearby swarm neighbors.
 */
export function updateSwarmAI(enemyId: number, playerX: number, playerY: number, _deltaTime: number): void {
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

  const speed = Velocity.speed[enemyId];

  // Chase vector (normalized toward player)
  let chaseX = dx / distance;
  let chaseY = dy / distance;

  // Query nearby entities via spatial hash
  let separationX = 0, separationY = 0;
  let cohesionX = 0, cohesionY = 0;
  let neighborCount = 0;

  const spatialHash = getEnemySpatialHash();
  const nearby = spatialHash.query(enemyX, enemyY, 60);

  for (let i = 0; i < nearby.length; i++) {
    const neighbor = nearby[i];
    if (neighbor.id === enemyId) continue;
    // Only flock with other Swarm enemies
    if (EnemyAI.aiType[neighbor.id] !== EnemyAIType.Swarm) continue;

    const ox = neighbor.x;
    const oy = neighbor.y;
    const ndx = enemyX - ox;
    const ndy = enemyY - oy;
    const neighborDist = Math.sqrt(ndx * ndx + ndy * ndy);

    if (neighborDist < 1) continue;

    // Separation: push away from neighbors within 25px
    if (neighborDist < 25) {
      separationX += ndx / neighborDist;
      separationY += ndy / neighborDist;
    }

    // Cohesion: accumulate positions for average
    cohesionX += ox;
    cohesionY += oy;
    neighborCount++;
  }

  let moveX = chaseX * 0.6;
  let moveY = chaseY * 0.6;

  // Apply separation (25% weight)
  const sepMag = Math.sqrt(separationX * separationX + separationY * separationY);
  if (sepMag > 0) {
    moveX += (separationX / sepMag) * 0.25;
    moveY += (separationY / sepMag) * 0.25;
  }

  // Apply cohesion (15% weight) — steer toward average neighbor position
  if (neighborCount > 0) {
    const avgX = cohesionX / neighborCount;
    const avgY = cohesionY / neighborCount;
    const cohDx = avgX - enemyX;
    const cohDy = avgY - enemyY;
    const cohDist = Math.sqrt(cohDx * cohDx + cohDy * cohDy);
    if (cohDist > 1) {
      moveX += (cohDx / cohDist) * 0.15;
      moveY += (cohDy / cohDist) * 0.15;
    }
  }

  // Normalize and apply speed
  const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);
  if (moveMag > 0) {
    Velocity.x[enemyId] = (moveX / moveMag) * speed;
    Velocity.y[enemyId] = (moveY / moveMag) * speed;
    Transform.rotation[enemyId] = Math.atan2(moveY, moveX);
  }
}
