import { Transform } from '../ecs/components';
import { WeaponContext } from './BaseWeapon';

/**
 * Finds the nearest enemy to a given position.
 * Returns the enemy entity ID or -1 if none found.
 */
export function findNearestEnemy(
  ctx: WeaponContext,
  originX: number,
  originY: number,
  maxRange?: number
): number {
  const enemies = ctx.getEnemies();
  let nearestId = -1;
  let nearestDistSq = maxRange ? maxRange * maxRange : Infinity;

  for (let i = 0; i < enemies.length; i++) {
    const enemyId = enemies[i];
    const dx = Transform.x[enemyId] - originX;
    const dy = Transform.y[enemyId] - originY;
    const distSq = dx * dx + dy * dy;

    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestId = enemyId;
    }
  }

  return nearestId;
}

/**
 * Finds all enemy IDs within a radius of a position.
 * Returns a reusable array (caller should not store a reference across frames).
 */
const radiusResultBuffer: number[] = [];
export function findEnemiesInRadius(
  ctx: WeaponContext,
  centerX: number,
  centerY: number,
  radius: number
): readonly number[] {
  radiusResultBuffer.length = 0;
  const radiusSq = radius * radius;
  const enemies = ctx.getEnemies();

  for (let i = 0; i < enemies.length; i++) {
    const enemyId = enemies[i];
    const dx = Transform.x[enemyId] - centerX;
    const dy = Transform.y[enemyId] - centerY;
    if (dx * dx + dy * dy <= radiusSq) {
      radiusResultBuffer.push(enemyId);
    }
  }

  return radiusResultBuffer;
}

/**
 * Damages all enemies within a radius. Returns the number of enemies hit.
 * Does not apply additional effects (caller handles per-enemy effects).
 */
export function damageEnemiesInRadius(
  ctx: WeaponContext,
  centerX: number,
  centerY: number,
  radius: number,
  damage: number,
  knockback: number
): number {
  const radiusSq = radius * radius;
  const enemies = ctx.getEnemies();
  let hitCount = 0;

  for (let i = 0; i < enemies.length; i++) {
    const enemyId = enemies[i];
    const dx = Transform.x[enemyId] - centerX;
    const dy = Transform.y[enemyId] - centerY;
    if (dx * dx + dy * dy <= radiusSq) {
      ctx.damageEnemy(enemyId, damage, knockback);
      hitCount++;
    }
  }

  return hitCount;
}

/**
 * Tracks per-enemy hit cooldowns to prevent rapid re-hitting.
 * Used by continuous-damage weapons (Aura, Orbiting Blades, Flamethrower).
 */
export class HitCooldownTracker {
  private cooldowns = new Map<number, number>();

  /** Returns true if the enemy can be hit (no active cooldown). */
  canHit(enemyId: number, currentTime: number, cooldownDuration: number): boolean {
    const lastHit = this.cooldowns.get(enemyId) || 0;
    return currentTime - lastHit >= cooldownDuration;
  }

  /** Records a hit, starting the cooldown for this enemy. */
  recordHit(enemyId: number, currentTime: number): void {
    this.cooldowns.set(enemyId, currentTime);
  }

  /** Removes expired entries to prevent unbounded growth. */
  cleanup(currentTime: number, maxAge: number): void {
    for (const [enemyId, time] of this.cooldowns) {
      if (currentTime - time > maxAge) {
        this.cooldowns.delete(enemyId);
      }
    }
  }

  /** Clears all tracked cooldowns. */
  clear(): void {
    this.cooldowns.clear();
  }
}
