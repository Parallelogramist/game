import { Transform, Velocity, EnemyAI } from '../../components';
import { EnemyAIType } from '../../../enemies/EnemyTypes';
import { chaseHeading } from './common';

/**
 * Wraith — alternates on randomized timers between corporeal (full speed,
 * contact damage) and phased (half speed, no contact damage — the damage
 * exemption is handled in GameScene) states.
 */

/**
 * Wraith - phasing: alternates between corporeal and phased states.
 * State 0: Corporeal — chase at full speed, deals contact damage
 * State 1: Phased — chase at 0.5x speed, no contact damage (handled in GameScene)
 */
export function updateWraithAI(enemyId: number, playerX: number, playerY: number, _deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  if (distance > 1) {
    const phased = state === 1;
    const directX = dx / distance;
    const directY = dy / distance;
    // A ghost does not path around a wall it is allowed to walk through: while phased it takes
    // the straight line, where chaseHeading would route it along the flow field the moment it
    // loses line of sight. Two locals rather than the returned object because chaseHeading hands
    // back a shared mutable heading and this path runs per wraith per AI tick.
    let headingX = directX;
    let headingY = directY;
    if (!phased) {
      const heading = chaseHeading(enemyX, enemyY, playerX, playerY, directX, directY);
      headingX = heading.x;
      headingY = heading.y;
    }
    const speedMultiplier = phased ? 0.5 : 1.0;
    Velocity.x[enemyId] = headingX * speed * speedMultiplier;
    Velocity.y[enemyId] = headingY * speed * speedMultiplier;
    Transform.rotation[enemyId] = Math.atan2(headingY, headingX);
  }

  if (state === 0) {
    // Corporeal — after 3-4s, phase out
    if (EnemyAI.timer[enemyId] > 3.0 + EnemyAI.phase[enemyId]) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random() * 0.5; // 1.5-2.0s phased
    }
  } else {
    // Phased — after 1.5-2.0s, become corporeal
    if (EnemyAI.timer[enemyId] > 1.5 + EnemyAI.phase[enemyId]) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random(); // 3-4s corporeal
    }
  }
}

/**
 * The one mover in the game that is allowed to be standing in rock. Lives here rather than at
 * either call site because the movement resolver and the knockback resolver must agree with the
 * AI about what "phased" means, and this module owns that vocabulary.
 */
export function isPhasedWraith(entityId: number): boolean {
  return EnemyAI.aiType[entityId] === EnemyAIType.Wraith && EnemyAI.state[entityId] === 1;
}
