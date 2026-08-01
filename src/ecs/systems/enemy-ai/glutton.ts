import { Transform, Velocity, EnemyAI, EnemyType, Health } from '../../components';
import { xpGemPositionsCallback, consumeXPGemCallback } from './state';
import { updateChaseAI } from './chase';
import { navigationContext } from './common';

/**
 * The Glutton (miniboss) — hunts XP gems within 400px and eats them to grow
 * larger and stronger; falls back to chasing the player when no gems are near.
 */

/**
 * The Glutton - Seeks out XP gems, grows larger and stronger when eating them.
 * States: 0 = seeking gems, 1 = chasing player (no gems nearby)
 */
export function updateGluttonAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const speed = Velocity.speed[enemyId];

  // Try to find XP gems
  let targetGem: { x: number; y: number; entityId: number } | null = null;
  let nearestGemDist = Infinity;

  if (xpGemPositionsCallback) {
    const gems = xpGemPositionsCallback();
    for (const gem of gems) {
      const dist = Math.sqrt((gem.x - enemyX) ** 2 + (gem.y - enemyY) ** 2);
      if (dist < nearestGemDist && dist < 400) {
        nearestGemDist = dist;
        targetGem = gem;
      }
    }
  }

  // A gem behind rock is a trap: there is no flow route to anything but the player, so the
  // Glutton presses into the wall between them until the gem despawns. Dropping the target hands
  // the frame to the chase fallback below, which navigates. Under 15px the gem is being eaten and
  // a ray would be trivially clear, so the gate does not run.
  const context = navigationContext;
  if (targetGem && nearestGemDist > 15 && context !== null
    && !context.hasLineOfSight(enemyX, enemyY, targetGem.x, targetGem.y)) {
    targetGem = null;
  }

  if (targetGem && nearestGemDist > 15) {
    // Move toward gem
    const dx = targetGem.x - enemyX;
    const dy = targetGem.y - enemyY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    Velocity.x[enemyId] = (dx / dist) * speed * 1.2; // Move faster toward gems
    Velocity.y[enemyId] = (dy / dist) * speed * 1.2;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
    EnemyAI.state[enemyId] = 0;
  } else if (targetGem && nearestGemDist <= 15 && consumeXPGemCallback) {
    // Eat the gem!
    consumeXPGemCallback(targetGem.entityId);

    // Grow larger and stronger
    const currentDamage = EnemyType.baseDamage[enemyId];
    EnemyType.baseDamage[enemyId] = currentDamage + 3;
    Health.max[enemyId] += 20;
    Health.current[enemyId] = Math.min(Health.current[enemyId] + 20, Health.max[enemyId]);

    // Increase speed slightly
    Velocity.speed[enemyId] = Math.min(Velocity.speed[enemyId] + 2, 150);
  } else {
    // No gems nearby - chase player
    updateChaseAI(enemyId, playerX, playerY);
    EnemyAI.state[enemyId] = 1;
  }

  // Update special timer for periodic size pulse effect (visual cue)
  EnemyAI.specialTimer[enemyId] += deltaTime;
}
