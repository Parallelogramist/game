import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash, type SpatialEntity } from '../utils/SpatialHash';
import { beamReachFraction } from '../world/weaponWallBehavior';
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

/** How many nearest candidates a visibility scan will raycast before it gives up. */
const DEFAULT_VISIBILITY_PROBES = 8;

/** How many random draws a spread-fire weapon makes looking for a target it can reach. */
const DEFAULT_RANDOM_TRIES = 4;

const probeIds: number[] = [];
const probeDistancesSquared: number[] = [];
const hashQueryBuffer: SpatialEntity[] = [];

function hasLineOfSight(
  ctx: WeaponContext, fromX: number, fromY: number, toX: number, toY: number,
): boolean {
  return beamReachFraction(ctx.worldMap, fromX, fromY, toX, toY) >= 1;
}

function resetProbes(): void {
  probeIds.length = 0;
  probeDistancesSquared.length = 0;
}

/** Ties keep the earlier candidate, which is the first-encountered-wins that
 *  findNearestEnemy's strict < already gives every caller. */
function offerProbe(enemyId: number, distanceSquared: number, maxProbes: number): void {
  let slot = probeIds.length;
  if (slot >= maxProbes) {
    if (distanceSquared >= probeDistancesSquared[maxProbes - 1]) return;
    slot = maxProbes - 1;
  } else {
    probeIds.length = slot + 1;
    probeDistancesSquared.length = slot + 1;
  }
  while (slot > 0 && probeDistancesSquared[slot - 1] > distanceSquared) {
    probeIds[slot] = probeIds[slot - 1];
    probeDistancesSquared[slot] = probeDistancesSquared[slot - 1];
    slot--;
  }
  probeIds[slot] = enemyId;
  probeDistancesSquared[slot] = distanceSquared;
}

function firstVisibleProbe(ctx: WeaponContext, originX: number, originY: number): number {
  for (let i = 0; i < probeIds.length; i++) {
    const enemyId = probeIds[i];
    if (hasLineOfSight(ctx, originX, originY, Transform.x[enemyId], Transform.y[enemyId])) {
      return enemyId;
    }
  }
  return -1;
}

/**
 * Nearest enemy with an unobstructed line from the origin, or -1 when the nearest
 * maxProbes candidates are all behind rock. A mode with no geometry collapses the scan to
 * one candidate and casts nothing, so arena gets the same answer findNearestEnemy gives.
 */
export function findNearestVisibleEnemy(
  ctx: WeaponContext,
  originX: number,
  originY: number,
  maxRange?: number,
  maxProbes: number = DEFAULT_VISIBILITY_PROBES,
): number {
  const enemies = ctx.getEnemies();
  const limitSquared = maxRange ? maxRange * maxRange : Infinity;
  const probeLimit = ctx.worldMap === null ? 1 : maxProbes;
  resetProbes();
  for (let i = 0; i < enemies.length; i++) {
    const enemyId = enemies[i];
    if (Health.current[enemyId] <= 0) continue;
    const dx = Transform.x[enemyId] - originX;
    const dy = Transform.y[enemyId] - originY;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < limitSquared) offerProbe(enemyId, distanceSquared, probeLimit);
  }
  return firstVisibleProbe(ctx, originX, originY);
}

/**
 * A random candidate the origin can actually see, or -1 after `tries` unlucky draws.
 * For spread-fire weapons whose identity is picking a scattered target rather than the
 * nearest one, so a miss is a re-roll rather than a scan.
 */
export function pickVisibleRandomEnemy(
  ctx: WeaponContext,
  originX: number,
  originY: number,
  candidateIds: readonly number[],
  tries: number = DEFAULT_RANDOM_TRIES,
): number {
  if (candidateIds.length === 0) return -1;
  for (let attempt = 0; attempt < tries; attempt++) {
    const enemyId = candidateIds[Math.floor(Math.random() * candidateIds.length)];
    if (Health.current[enemyId] <= 0) continue;
    if (hasLineOfSight(ctx, originX, originY, Transform.x[enemyId], Transform.y[enemyId])) {
      return enemyId;
    }
  }
  return -1;
}

/**
 * The same scan against the enemy spatial hash, for weapons that acquire from a turret or a
 * projectile rather than from the ship. Distances come from the hash's frame-start snapshot,
 * exactly as SpatialHash.findNearest does, but the visibility cast uses the live Transform,
 * which is the position the caller will actually aim at.
 */
export function findNearestVisibleInHash(
  ctx: WeaponContext,
  originX: number,
  originY: number,
  maxRange: number,
  maxProbes: number = DEFAULT_VISIBILITY_PROBES,
  excludeIds?: ReadonlySet<number>,
): number {
  hashQueryBuffer.length = 0;
  getEnemySpatialHash().queryInto(originX, originY, maxRange, hashQueryBuffer);
  const limitSquared = maxRange * maxRange;
  const probeLimit = ctx.worldMap === null ? 1 : maxProbes;
  resetProbes();
  for (let i = 0; i < hashQueryBuffer.length; i++) {
    const candidate = hashQueryBuffer[i];
    if (excludeIds && excludeIds.has(candidate.id)) continue;
    if (Health.current[candidate.id] <= 0) continue;
    const dx = candidate.x - originX;
    const dy = candidate.y - originY;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < limitSquared) offerProbe(candidate.id, distanceSquared, probeLimit);
  }
  return firstVisibleProbe(ctx, originX, originY);
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
