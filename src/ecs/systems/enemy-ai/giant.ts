import { Transform, Velocity, EnemyAI, EnemyType } from '../../components';
import { telegraphManager } from './common';
import { groundSlamCallback } from './state';
import { spawnTelegraph, giantStompTelegraph } from './telegraphs';

/**
 * Giant — slow lumber toward the player with a periodic telegraphed seismic
 * stomp that deals AOE damage through the ground-slam callback.
 */

/**
 * Giant - slow approach with periodic seismic stomp.
 * State 0: Lumber toward player
 * State 1: Windup — stop and shake for 1.0s
 * State 2: Stomp — deal AOE damage via groundSlamCallback, return to state 0
 */
export function updateGiantAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (state === 0) {
    // Lumber — chase at base speed
    if (distance > 1) {
      const speed = Velocity.speed[enemyId];
      Velocity.x[enemyId] = (dx / distance) * speed;
      Velocity.y[enemyId] = (dy / distance) * speed;
      Transform.rotation[enemyId] = Math.atan2(dy, dx);
    }

    // Start stomp windup after 4.0-6.0s
    if (EnemyAI.timer[enemyId] > 4.0 + EnemyAI.phase[enemyId] * 2.0) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
      // Telegraph the stomp footprint during the 1.0s shake windup.
      spawnTelegraph(telegraphManager, enemyX, enemyY, giantStompTelegraph());
    }
  } else if (state === 1) {
    // Windup — stop and shake for 1.0s (same pattern as Charger)
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    Transform.x[enemyId] += (Math.random() - 0.5) * 4;

    if (EnemyAI.timer[enemyId] > 1.0) {
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Stomp — deal AOE damage
    if (EnemyAI.timer[enemyId] < deltaTime * 2 && groundSlamCallback) {
      const stompDamage = EnemyType.baseDamage[enemyId] * 0.5;
      groundSlamCallback(enemyX, enemyY, 80, stompDamage);
    }

    // Return to lumber
    EnemyAI.state[enemyId] = 0;
    EnemyAI.timer[enemyId] = 0;
    EnemyAI.phase[enemyId] = Math.random(); // Randomize next stomp timing
  }
}
