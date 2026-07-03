import { Transform, Velocity, EnemyAI, EnemyType } from '../../components';

/**
 * Shielded — heavy chase that periodically braces in place; the shield
 * regenerates over time and 3x faster while braced (the damage-side shield
 * handling lives in WeaponManager).
 */

/**
 * Shielded - normal chase but with shield mechanic (handled in damage)
 */
export function updateShieldedAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (state === 0) {
    // Advance — chase at 0.8x speed (heavier than Shambler)
    if (distance > 1) {
      const speed = Velocity.speed[enemyId] * 0.8;
      Velocity.x[enemyId] = (dx / distance) * speed;
      Velocity.y[enemyId] = (dy / distance) * speed;
      Transform.rotation[enemyId] = Math.atan2(dy, dx);
    }

    // Transition to brace after 2.5-3.5s
    if (EnemyAI.timer[enemyId] > 2.5 + EnemyAI.phase[enemyId]) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Brace — stop and regenerate shield faster
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);

    if (EnemyAI.timer[enemyId] > 0.7) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.timer[enemyId] = 0;
      EnemyAI.phase[enemyId] = Math.random(); // Randomize next brace timing
    }
  }

  // Shield regeneration logic (3x faster during brace)
  const shieldMax = EnemyType.shieldMax[enemyId];
  if (shieldMax > 0 && EnemyType.shieldCurrent[enemyId] < shieldMax) {
    EnemyType.shieldRegenTimer[enemyId] -= deltaTime;
    if (EnemyType.shieldRegenTimer[enemyId] <= 0) {
      const regenRate = state === 1 ? 15 : 5;
      EnemyType.shieldCurrent[enemyId] = Math.min(
        EnemyType.shieldCurrent[enemyId] + regenRate * deltaTime,
        shieldMax
      );
    }
  }
}
