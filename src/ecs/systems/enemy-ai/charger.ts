import { Transform, Velocity, EnemyAI } from '../../components';
import { gameBoundsWidth, gameBoundsHeight } from './state';
import { PI_HALF, telegraphManager } from './common';
import { spawnTelegraph, chargerChargeTelegraph } from './telegraphs';

/**
 * The Charger (miniboss) — walks at the player, locks a target with a
 * telegraphed 0.8s shake windup, then charges across the screen at 6x speed.
 */

/**
 * The Charger - Pauses, then charges at high speed across the screen.
 * States: 0 = walking toward player, 1 = preparing charge (stops), 2 = charging
 */
export function updateChargerAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  _deltaTime: number
): void {
  const state = EnemyAI.state[enemyId];
  const timer = EnemyAI.timer[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const baseSpeed = Velocity.speed[enemyId];

  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (state === 0) {
    // Walking toward player
    if (distance > 1) {
      Velocity.x[enemyId] = (dx / distance) * baseSpeed * 0.6;
      Velocity.y[enemyId] = (dy / distance) * baseSpeed * 0.6;
      // Add π/2 so triangle tip leads (triangle points UP at rotation 0)
      Transform.rotation[enemyId] = Math.atan2(dy, dx) + PI_HALF;
    }

    // Start charge preparation after 2-4 seconds or when close enough
    if (timer > 2.0 + Math.random() * 2.0 || distance < 200) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Preparing to charge - slow down and lock target
    Velocity.x[enemyId] *= 0.8;
    Velocity.y[enemyId] *= 0.8;

    // Store target direction
    if (timer < 0.1) {
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
      // Telegraph the charge lane across the screen during the 0.8s windup.
      spawnTelegraph(telegraphManager, enemyX, enemyY, chargerChargeTelegraph(Math.atan2(playerY - enemyY, playerX - enemyX)));
    }

    // Visual cue: shake slightly
    Transform.x[enemyId] += (Math.random() - 0.5) * 4;

    if (timer > 0.8) {
      // Start charging!
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 2) {
    // CHARGING!
    const targetDx = EnemyAI.targetX[enemyId] - enemyX;
    const targetDy = EnemyAI.targetY[enemyId] - enemyY;
    const angle = Math.atan2(targetDy, targetDx);

    const chargeSpeed = baseSpeed * 6; // Very fast!
    Velocity.x[enemyId] = Math.cos(angle) * chargeSpeed;
    Velocity.y[enemyId] = Math.sin(angle) * chargeSpeed;
    // Add π/2 so triangle tip leads (triangle points UP at rotation 0)
    Transform.rotation[enemyId] = angle + PI_HALF;

    // End charge after 1 second or if hitting edge
    if (timer > 1.0 || enemyX < 30 || enemyX > gameBoundsWidth - 30 || enemyY < 30 || enemyY > gameBoundsHeight - 30) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
    }
  }
}
