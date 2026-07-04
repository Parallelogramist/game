import { Transform, Velocity, EnemyAI } from '../../components';
import { EnemyAIType } from '../../../enemies/EnemyTypes';
import { getEnemySpatialHash } from '../../../utils/SpatialHash';
import { isDestructible } from './common';

/**
 * Elite proximity auras — Tank damage reduction, Rallier speed boost, and the
 * Warden player slow. applyEliteAuras() rebuilds the per-frame aura state
 * after all AI has set velocities; WeaponManager reads isNearTankAura() and
 * GameScene reads getWardenSlowMultiplier().
 */

// ── Elite aura tracking ─────────────────────────────────────────────────────
// Tracks which enemies are currently buffed by Tank damage reduction aura.
// Rebuilt every frame by applyEliteAuras(). Consumed by WeaponManager.
const tankAuraProtectedEnemies = new Set<number>();

// Tracks cumulative Warden slow multiplier for the player, rebuilt each frame.
let wardenSlowMultiplier = 1.0;

/**
 * Returns true if the given enemy is within a Tank's damage reduction aura.
 * Called by WeaponManager to reduce incoming damage by 25%.
 */
export function isNearTankAura(enemyId: number): boolean {
  return tankAuraProtectedEnemies.has(enemyId);
}

/**
 * Returns the cumulative Warden slow multiplier for the player.
 * 1.0 = no slow, values < 1.0 mean the player is near one or more Wardens.
 * Called by GameScene to scale player velocity after InputSystem runs.
 */
export function getWardenSlowMultiplier(): number {
  return wardenSlowMultiplier;
}

/**
 * Apply elite enemy proximity auras each frame.
 *
 * - Tank (aiType 5): Damage reduction aura — enemies within 120px are flagged
 *   so WeaponManager can apply 25% damage reduction.
 * - Rallier (aiType 17): Speed boost aura — enemies within 150px get +30%
 *   velocity this frame (applied on top of whatever the AI already set).
 * - Warden (aiType 15): Player slow aura — if the player is within 200px of
 *   any Warden, the player's move speed is reduced by 15% (stacks multiplicatively).
 */
export function applyEliteAuras(
  enemies: number[],
  playerX: number,
  playerY: number
): void {
  // Reset per-frame aura state
  tankAuraProtectedEnemies.clear();
  wardenSlowMultiplier = 1.0;

  const spatialHash = getEnemySpatialHash();

  for (let i = 0; i < enemies.length; i++) {
    const eliteId = enemies[i];
    const aiType = EnemyAI.aiType[eliteId];

    // ── Tank damage reduction aura (120px) ──
    if (aiType === EnemyAIType.Tank) {
      const tankX = Transform.x[eliteId];
      const tankY = Transform.y[eliteId];
      const nearbyEnemies = spatialHash.query(tankX, tankY, 120);

      for (let j = 0; j < nearbyEnemies.length; j++) {
        const nearbyId = nearbyEnemies[j].id;
        if (nearbyId !== eliteId && !isDestructible(nearbyId)) {
          tankAuraProtectedEnemies.add(nearbyId);
        }
      }
    }

    // ── Rallier speed boost aura (150px, +30% velocity) ──
    if (aiType === EnemyAIType.Rallier) {
      const rallierX = Transform.x[eliteId];
      const rallierY = Transform.y[eliteId];
      const nearbyEnemies = spatialHash.query(rallierX, rallierY, 150);

      for (let j = 0; j < nearbyEnemies.length; j++) {
        const nearbyId = nearbyEnemies[j].id;
        if (nearbyId !== eliteId && !isDestructible(nearbyId)) {
          Velocity.x[nearbyId] *= 1.3;
          Velocity.y[nearbyId] *= 1.3;
        }
      }
    }

    // ── Warden player slow aura (200px, -15% per Warden) ──
    if (aiType === EnemyAIType.Warden) {
      const wardenX = Transform.x[eliteId];
      const wardenY = Transform.y[eliteId];
      const distanceToPlayerX = playerX - wardenX;
      const distanceToPlayerY = playerY - wardenY;
      const distanceSquared = distanceToPlayerX * distanceToPlayerX + distanceToPlayerY * distanceToPlayerY;

      if (distanceSquared <= 40000) { // 200px radius: 200*200 = 40000
        wardenSlowMultiplier *= 0.85;
      }
    }
  }
}
