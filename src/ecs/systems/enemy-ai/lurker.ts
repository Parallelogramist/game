import { Transform, Velocity, EnemyAI } from '../../components';
import { PI_HALF } from './common';

/**
 * Lurker — hit-and-run: cautious approach, quick 3.5x lunge at a stored
 * target, then a laterally drifting retreat before repeating the cycle.
 */

/**
 * Lurker - hit-and-run: cautious approach, quick lunge, retreat.
 * State 0: Approach at 0.7x speed
 * State 1: Lunge toward stored target at 3.5x speed
 * State 2: Retreat away from player at 1.3x speed with lateral drift
 */
export function updateLurkerAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  if (state === 0) {
    // Approach cautiously
    if (distance > 1) {
      Velocity.x[enemyId] = (dx / distance) * speed * 0.7;
      Velocity.y[enemyId] = (dy / distance) * speed * 0.7;
      Transform.rotation[enemyId] = Math.atan2(dy, dx) + PI_HALF;
    }

    // Transition to lunge when close or after timeout
    if (distance < 120 || EnemyAI.timer[enemyId] > 4.0) {
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Lunge toward stored target
    const lungeTargetDx = EnemyAI.targetX[enemyId] - enemyX;
    const lungeTargetDy = EnemyAI.targetY[enemyId] - enemyY;
    const lungeDistance = Math.sqrt(lungeTargetDx * lungeTargetDx + lungeTargetDy * lungeTargetDy);

    if (lungeDistance > 10 && EnemyAI.timer[enemyId] < 0.4) {
      const lungeSpeed = speed * 3.5;
      Velocity.x[enemyId] = (lungeTargetDx / lungeDistance) * lungeSpeed;
      Velocity.y[enemyId] = (lungeTargetDy / lungeDistance) * lungeSpeed;
      Transform.rotation[enemyId] = Math.atan2(lungeTargetDy, lungeTargetDx) + PI_HALF;
    } else {
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Retreat with lateral drift
    if (distance > 1) {
      EnemyAI.phase[enemyId] += deltaTime * 3;
      const lateralDrift = Math.sin(EnemyAI.phase[enemyId]) * 0.3;
      const perpX = -dy / distance;
      const perpY = dx / distance;

      const retreatX = -(dx / distance) + perpX * lateralDrift;
      const retreatY = -(dy / distance) + perpY * lateralDrift;
      const retreatMag = Math.sqrt(retreatX * retreatX + retreatY * retreatY);

      Velocity.x[enemyId] = (retreatX / retreatMag) * speed * 1.3;
      Velocity.y[enemyId] = (retreatY / retreatMag) * speed * 1.3;
      Transform.rotation[enemyId] = Math.atan2(-dy, -dx) + PI_HALF;
    }

    if (EnemyAI.timer[enemyId] > 1.5) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
    }
  }
}
