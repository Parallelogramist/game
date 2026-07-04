import { Transform, Velocity, EnemyAI, EnemyType, Health } from '../../components';
import { getLinkedTwin } from './state';

/**
 * The Twins (miniboss pair, TwinA/TwinB) — linked enemies that chase in
 * formation, enrage (+50% speed) when the partner drops below half health,
 * and go berserk (2x speed, +50% damage) when the partner dies.
 */

/**
 * The Twins - Two linked enemies that move together and buff each other.
 * When one is damaged, the other gets enraged (faster, stronger).
 */
export function updateTwinAI(
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
  let speed = Velocity.speed[enemyId];

  // Check if linked twin exists
  const linkedTwin = getLinkedTwin(enemyId);

  if (linkedTwin !== undefined) {
    // Get twin position
    const twinX = Transform.x[linkedTwin];
    const twinY = Transform.y[linkedTwin];

    // Stay near twin - maintain formation
    const twinDx = twinX - enemyX;
    const twinDy = twinY - enemyY;
    const twinDist = Math.sqrt(twinDx * twinDx + twinDy * twinDy);

    // If twin is hurt, get enraged (speed boost)
    const twinHealth = Health.current[linkedTwin];
    const twinMaxHealth = Health.max[linkedTwin];
    if (twinHealth < twinMaxHealth * 0.5) {
      speed *= 1.5; // Enraged!
    }

    // Movement: combine player chase with staying near twin
    let moveX = 0;
    let moveY = 0;

    // Chase player
    if (distance > 1) {
      moveX += (dx / distance) * 0.7;
      moveY += (dy / distance) * 0.7;
    }

    // Pull toward twin if too far apart
    if (twinDist > 150) {
      moveX += (twinDx / twinDist) * 0.5;
      moveY += (twinDy / twinDist) * 0.5;
    } else if (twinDist < 50) {
      // Push away if too close
      moveX -= (twinDx / twinDist) * 0.3;
      moveY -= (twinDy / twinDist) * 0.3;
    }

    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);
    if (moveMag > 0.1) {
      Velocity.x[enemyId] = (moveX / moveMag) * speed;
      Velocity.y[enemyId] = (moveY / moveMag) * speed;
    }
  } else {
    // Twin is dead - enrage and chase aggressively!
    speed *= 2.0;
    EnemyType.baseDamage[enemyId] = EnemyType.baseDamage[enemyId] * 1.5;

    if (distance > 1) {
      Velocity.x[enemyId] = (dx / distance) * speed;
      Velocity.y[enemyId] = (dy / distance) * speed;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);

  // Periodic phase sync for visual effects
  EnemyAI.phase[enemyId] += deltaTime * 4;
}
