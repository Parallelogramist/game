/**
 * SpatialHash provides O(1) spatial queries for entity positions.
 *
 * Instead of checking every entity for collision/proximity (O(n²)),
 * entities are bucketed into grid cells. Queries only check entities
 * in nearby cells, reducing complexity to O(n) average case.
 *
 * Cell size should match typical query radius (80px for this game).
 */

export interface SpatialEntity {
  id: number;
  x: number;
  y: number;
}

export class SpatialHash {
  private cellSize: number;
  private cells: Map<string, SpatialEntity[]>;
  private entityCells: Map<number, string>; // Track which cell each entity is in

  constructor(cellSize: number = 80) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entityCells = new Map();
  }

  /**
   * Get the cell key for a position.
   */
  private getCellKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  /**
   * Clear all entities from the hash.
   * Call this at the start of each frame before re-inserting.
   */
  clear(): void {
    this.cells.clear();
    this.entityCells.clear();
  }

  /**
   * Insert an entity into the spatial hash.
   */
  insert(id: number, x: number, y: number): void {
    const key = this.getCellKey(x, y);

    if (!this.cells.has(key)) {
      this.cells.set(key, []);
    }

    this.cells.get(key)!.push({ id, x, y });
    this.entityCells.set(id, key);
  }

  /**
   * Insert multiple entities at once (more efficient than individual inserts).
   */
  insertMany(entities: SpatialEntity[]): void {
    for (const entity of entities) {
      this.insert(entity.id, entity.x, entity.y);
    }
  }

  /**
   * Query all entities within a radius of a point.
   * Returns entities that are within the radius (actual distance check).
   */
  query(x: number, y: number, radius: number): SpatialEntity[] {
    const results: SpatialEntity[] = [];
    const radiusSquared = radius * radius;

    // Calculate which cells to check based on radius
    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    // Check all cells that could contain entities within radius
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = `${cellX},${cellY}`;
        const cell = this.cells.get(key);

        if (cell) {
          for (const entity of cell) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            const distSquared = dx * dx + dy * dy;

            if (distSquared <= radiusSquared) {
              results.push(entity);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Query entities within radius, but only return their IDs.
   * More memory efficient when you don't need positions.
   */
  queryIds(x: number, y: number, radius: number): number[] {
    const results: number[] = [];
    const radiusSquared = radius * radius;

    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = `${cellX},${cellY}`;
        const cell = this.cells.get(key);

        if (cell) {
          for (const entity of cell) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            const distSquared = dx * dx + dy * dy;

            if (distSquared <= radiusSquared) {
              results.push(entity.id);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Query entities that could potentially be within radius (no distance check).
   * Faster but may include entities just outside radius.
   * Use when you'll do your own distance check anyway.
   */
  queryPotential(x: number, y: number, radius: number): SpatialEntity[] {
    const results: SpatialEntity[] = [];

    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = `${cellX},${cellY}`;
        const cell = this.cells.get(key);

        if (cell) {
          results.push(...cell);
        }
      }
    }

    return results;
  }

  /**
   * Find the nearest entity to a point within a maximum radius.
   * Returns null if no entity found within radius.
   */
  findNearest(x: number, y: number, maxRadius: number, excludeId?: number): SpatialEntity | null {
    const candidates = this.query(x, y, maxRadius);

    let nearest: SpatialEntity | null = null;
    let nearestDistSquared = maxRadius * maxRadius;

    for (const entity of candidates) {
      if (excludeId !== undefined && entity.id === excludeId) continue;

      const dx = entity.x - x;
      const dy = entity.y - y;
      const distSquared = dx * dx + dy * dy;

      if (distSquared < nearestDistSquared) {
        nearestDistSquared = distSquared;
        nearest = entity;
      }
    }

    return nearest;
  }

  /**
   * Find the N nearest entities to a point within a maximum radius.
   */
  findNearestN(x: number, y: number, maxRadius: number, count: number, excludeIds?: Set<number>): SpatialEntity[] {
    const candidates = this.query(x, y, maxRadius);

    // Calculate distances and sort
    const withDistances = candidates
      .filter(entity => !excludeIds || !excludeIds.has(entity.id))
      .map(entity => {
        const dx = entity.x - x;
        const dy = entity.y - y;
        return { entity, distSquared: dx * dx + dy * dy };
      })
      .sort((a, b) => a.distSquared - b.distSquared);

    return withDistances.slice(0, count).map(item => item.entity);
  }

  /**
   * Get the number of entities in the hash.
   */
  get size(): number {
    return this.entityCells.size;
  }

  /**
   * Get the number of non-empty cells.
   */
  get cellCount(): number {
    return this.cells.size;
  }
}

// Global spatial hash instance for enemies (updated each frame)
let globalEnemySpatialHash: SpatialHash | null = null;

/**
 * Get the global enemy spatial hash.
 * This is populated once per frame in GameScene.
 */
export function getEnemySpatialHash(): SpatialHash {
  if (!globalEnemySpatialHash) {
    globalEnemySpatialHash = new SpatialHash(80);
  }
  return globalEnemySpatialHash;
}

/**
 * Reset the global enemy spatial hash.
 * Call this when starting a new game.
 */
export function resetEnemySpatialHash(): void {
  if (globalEnemySpatialHash) {
    globalEnemySpatialHash.clear();
  }
}
