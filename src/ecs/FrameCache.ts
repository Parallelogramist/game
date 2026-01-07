import { defineQuery, IWorld } from 'bitecs';
import { Transform, Health, EnemyTag } from './components';
import { getEnemySpatialHash, SpatialEntity } from '../utils/SpatialHash';

/**
 * FrameCache provides centralized per-frame caching for expensive queries.
 *
 * PROBLEM: Each weapon/system independently queries enemies, creating
 * redundant bitECS queries and array allocations (5-15 queries per frame).
 *
 * SOLUTION: Query once at frame start, cache results, all systems use cache.
 *
 * Usage:
 * 1. Call `updateFrameCache(world)` at the START of each game update
 * 2. Use `getEnemyIds()`, `getEnemyPositions()`, etc. throughout the frame
 * 3. Cache is automatically cleared on next `updateFrameCache()` call
 */

// Define the enemy query once (bitECS queries are already efficient when defined once)
const enemyQuery = defineQuery([Transform, Health, EnemyTag]);

// Cached data for current frame
let cachedEnemyIds: number[] = [];
let cachedEnemyCount: number = 0;
let cacheValid: boolean = false;

// Pre-allocated arrays to avoid GC pressure
const enemyPositionsArray: { id: number; x: number; y: number }[] = [];

/**
 * Update the frame cache with current enemy data.
 * Call this ONCE at the start of each game update loop.
 *
 * This function:
 * 1. Queries all enemies from ECS
 * 2. Populates the global enemy spatial hash
 * 3. Caches enemy IDs and positions for reuse
 */
export function updateFrameCache(world: IWorld): void {
  // Query enemies from ECS (this is the ONLY place we query per frame)
  cachedEnemyIds = enemyQuery(world);
  cachedEnemyCount = cachedEnemyIds.length;

  // Clear and rebuild spatial hash
  const spatialHash = getEnemySpatialHash();
  spatialHash.clear();

  // Reuse position array to avoid allocation
  enemyPositionsArray.length = 0;

  // Populate spatial hash and position cache
  for (let i = 0; i < cachedEnemyCount; i++) {
    const entityId = cachedEnemyIds[i];
    const x = Transform.x[entityId];
    const y = Transform.y[entityId];

    // Add to spatial hash for O(1) proximity queries
    spatialHash.insert(entityId, x, y);

    // Cache position data
    enemyPositionsArray.push({ id: entityId, x, y });
  }

  cacheValid = true;
}

/**
 * Get all enemy entity IDs.
 * Returns the cached array - do NOT modify this array!
 */
export function getEnemyIds(): readonly number[] {
  if (!cacheValid) {
    console.warn('FrameCache: getEnemyIds called before updateFrameCache');
    return [];
  }
  return cachedEnemyIds;
}

/**
 * Get the number of active enemies.
 */
export function getEnemyCount(): number {
  return cachedEnemyCount;
}

/**
 * Get all enemy positions.
 * Returns the cached array - do NOT modify this array!
 */
export function getEnemyPositions(): readonly { id: number; x: number; y: number }[] {
  if (!cacheValid) {
    console.warn('FrameCache: getEnemyPositions called before updateFrameCache');
    return [];
  }
  return enemyPositionsArray;
}

/**
 * Check if the cache is valid (updateFrameCache was called this frame).
 */
export function isCacheValid(): boolean {
  return cacheValid;
}

/**
 * Invalidate the cache (called when enemies are added/removed mid-frame).
 * Forces a rebuild on next access.
 */
export function invalidateFrameCache(): void {
  cacheValid = false;
}

/**
 * Reset the frame cache (call when starting a new game).
 */
export function resetFrameCache(): void {
  cachedEnemyIds = [];
  cachedEnemyCount = 0;
  enemyPositionsArray.length = 0;
  cacheValid = false;
}

/**
 * Get enemy position by ID.
 * Uses direct Transform component access (O(1)).
 */
export function getEnemyPosition(entityId: number): { x: number; y: number } | null {
  // Direct component access is O(1), no need to search cache
  const x = Transform.x[entityId];
  const y = Transform.y[entityId];

  // Check if entity exists (undefined means entity doesn't exist)
  if (x === undefined || y === undefined) {
    return null;
  }

  return { x, y };
}

/**
 * Check if an entity is an active enemy.
 * Uses the cached ID list for quick lookup.
 */
export function isActiveEnemy(entityId: number): boolean {
  if (!cacheValid) return false;
  return cachedEnemyIds.includes(entityId);
}

/**
 * Get enemies within radius of a point using the spatial hash.
 * Much faster than iterating all enemies for proximity checks.
 */
export function getEnemiesInRadius(x: number, y: number, radius: number): SpatialEntity[] {
  const spatialHash = getEnemySpatialHash();
  return spatialHash.query(x, y, radius);
}

/**
 * Get the nearest enemy to a point within a maximum radius.
 * Returns null if no enemy found within radius.
 */
export function getNearestEnemy(
  x: number,
  y: number,
  maxRadius: number,
  excludeId?: number
): SpatialEntity | null {
  const spatialHash = getEnemySpatialHash();
  return spatialHash.findNearest(x, y, maxRadius, excludeId);
}

/**
 * Get the N nearest enemies to a point within a maximum radius.
 */
export function getNearestEnemies(
  x: number,
  y: number,
  maxRadius: number,
  count: number,
  excludeIds?: Set<number>
): SpatialEntity[] {
  const spatialHash = getEnemySpatialHash();
  return spatialHash.findNearestN(x, y, maxRadius, count, excludeIds);
}
