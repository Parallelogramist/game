import { Transform, Velocity, EnemyAI, EnemyType } from '../../components';
import { PI_TWO, telegraphManager } from './common';
import { groundSlamCallback } from './state';
import { spawnTelegraph, wardenSlamTelegraph } from './telegraphs';

/**
 * Warden — zone control: patrols offset points near the player and
 * periodically plants a telegraphed ground-slam AOE before repositioning to
 * the opposite side. Its player-slow aura is applied by applyEliteAuras in
 * EnemyAISystem.
 */

/**
 * Warden - zone control: patrol near player, plant AOE hazards.
 * State 0: Patrol toward offset point ~200px from player
 * State 1: Plant — shake windup then fire ground slam AOE
 * State 2: Reposition to opposite side of player
 */
export function updateWardenAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];

  EnemyAI.specialTimer[enemyId] -= deltaTime;

  if (state === 0) {
    // Patrol — move toward offset point
    const targetDx = EnemyAI.targetX[enemyId] - enemyX;
    const targetDy = EnemyAI.targetY[enemyId] - enemyY;
    const targetDist = Math.sqrt(targetDx * targetDx + targetDy * targetDy);

    if (targetDist > 20) {
      Velocity.x[enemyId] = (targetDx / targetDist) * speed;
      Velocity.y[enemyId] = (targetDy / targetDist) * speed;
    } else {
      Velocity.x[enemyId] = 0;
      Velocity.y[enemyId] = 0;
    }
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    // Recalculate patrol target every 3.5-4.5s
    if (EnemyAI.timer[enemyId] > 3.5 + EnemyAI.phase[enemyId]) {
      const offsetAngle = Math.random() * PI_TWO;
      EnemyAI.targetX[enemyId] = playerX + Math.cos(offsetAngle) * 200;
      EnemyAI.targetY[enemyId] = playerY + Math.sin(offsetAngle) * 200;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random();

      // Transition to plant if slam is ready
      if (EnemyAI.specialTimer[enemyId] <= 0) {
        EnemyAI.state[enemyId] = 1;
        EnemyAI.timer[enemyId] = 0;
        // Telegraph the AOE footprint during the 0.8s plant windup.
        spawnTelegraph(telegraphManager, enemyX, enemyY, wardenSlamTelegraph());
      }
    }
  } else if (state === 1) {
    // Plant — shake windup then AOE
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    Transform.x[enemyId] += (Math.random() - 0.5) * 3;

    if (EnemyAI.timer[enemyId] > 0.8) {
      // Fire ground slam at own position
      if (groundSlamCallback) {
        groundSlamCallback(enemyX, enemyY, 50, EnemyType.baseDamage[enemyId]);
      }
      EnemyAI.specialTimer[enemyId] = 5.0;
      EnemyAI.state[enemyId] = 2;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Reposition — move to opposite side of player
    if (distance > 1) {
      const awayX = -(dx / distance);
      const awayY = -(dy / distance);
      Velocity.x[enemyId] = awayX * speed * 1.2;
      Velocity.y[enemyId] = awayY * speed * 1.2;
    }
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    if (EnemyAI.timer[enemyId] > 2.0) {
      // Set new patrol target
      const offsetAngle = Math.random() * PI_TWO;
      EnemyAI.targetX[enemyId] = playerX + Math.cos(offsetAngle) * 200;
      EnemyAI.targetY[enemyId] = playerY + Math.sin(offsetAngle) * 200;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random();
    }
  }
}
