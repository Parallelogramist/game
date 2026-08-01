import { Transform, Velocity, EnemyAI } from '../../components';
import { chaseHeading } from './common';

/**
 * Circler — strafes around the player on a breathing 120-180px orbit,
 * steering radially back toward the preferred distance.
 */

/**
 * Circle - strafe around player at a fixed distance
 */
export function updateCircleAI(
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

  // Breathing orbit: oscillates between 120-180px
  const preferredDistance = 150 + Math.sin(EnemyAI.phase[enemyId] * 0.5) * 30;

  if (distance > 1) {
    // Calculate tangent direction (perpendicular to radius)
    const tangentX = -dy / distance;
    const tangentY = dx / distance;

    // Radial component - move toward/away from preferred distance
    let radialFactor = 0;
    if (distance < preferredDistance - 20) {
      radialFactor = -0.5; // Move away
    } else if (distance > preferredDistance + 20) {
      radialFactor = 0.5; // Move closer
    }

    // Closing the orbit is a pursuit and routes around walls; opening it is deliberate kiting and
    // stays direct, because a routed heading multiplied by a negative factor points backwards
    // along the route rather than away from the player.
    let radialX = dx / distance;
    let radialY = dy / distance;
    if (radialFactor > 0) {
      const heading = chaseHeading(enemyX, enemyY, playerX, playerY, radialX, radialY);
      radialX = heading.x;
      radialY = heading.y;
    }

    // Update orbit phase
    EnemyAI.phase[enemyId] += deltaTime * 2;

    // Combine tangent (orbit) with radial (approach/retreat)
    const moveX = tangentX * 0.8 + radialX * radialFactor;
    const moveY = tangentY * 0.8 + radialY * radialFactor;
    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

    Velocity.x[enemyId] = (moveX / moveMag) * speed;
    Velocity.y[enemyId] = (moveY / moveMag) * speed;
    Transform.rotation[enemyId] = Math.atan2(dy, dx); // Face player
  }
}
