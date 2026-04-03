/**
 * SpatialHash provides O(1) spatial queries for entity positions.
 *
 * Instead of checking every entity for collision/proximity (O(n²)),
 * entities are bucketed into grid cells. Queries only check entities
 * in nearby cells, reducing complexity to O(n) average case.
 *
 * Cell size should match typical query radius (80px for this game).
 *
 * PERF: Uses numeric cell keys (no string allocation per lookup),
 * loop-based array concat (no spread operator allocation), and
 * a callback-based queryPotentialForEach for zero-allocation iteration.
 */

export interface SpatialEntity {
  id: number;
  x: number;
  y: number;
}

// Large prime for hashing cell coordinates into a single numeric key.
// Must be larger than any expected cellY value to avoid collisions.
const CELL_KEY_PRIME = 100003;

export class SpatialHash {
  private cellSize: number;
  private cells: Map<number, SpatialEntity[]>;
  private entityCells: Map<number, number>;

  constructor(cellSize: number = 80) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entityCells = new Map();
  }

  private getCellKey(x: number, y: number): number {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return cellX * CELL_KEY_PRIME + cellY;
  }

  clear(): void {
    this.cells.clear();
    this.entityCells.clear();
  }

  insert(id: number, x: number, y: number): void {
    const key = this.getCellKey(x, y);

    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }

    cell.push({ id, x, y });
    this.entityCells.set(id, key);
  }

  insertMany(entities: SpatialEntity[]): void {
    for (const entity of entities) {
      this.insert(entity.id, entity.x, entity.y);
    }
  }

  query(x: number, y: number, radius: number): SpatialEntity[] {
    const results: SpatialEntity[] = [];
    const radiusSquared = radius * radius;

    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = cellX * CELL_KEY_PRIME + cellY;
        const cell = this.cells.get(key);

        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            const entity = cell[i];
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

  queryIds(x: number, y: number, radius: number): number[] {
    const results: number[] = [];
    const radiusSquared = radius * radius;

    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = cellX * CELL_KEY_PRIME + cellY;
        const cell = this.cells.get(key);

        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            const entity = cell[i];
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
        const key = cellX * CELL_KEY_PRIME + cellY;
        const cell = this.cells.get(key);

        if (cell) {
          // PERF: Loop push instead of spread to avoid intermediate array allocation
          for (let i = 0; i < cell.length; i++) {
            results.push(cell[i]);
          }
        }
      }
    }

    return results;
  }

  /**
   * Zero-allocation iteration over potential entities within radius.
   * Calls the callback for each entity; avoids allocating a results array.
   * Use this in hot paths (e.g., per-projectile collision checks).
   */
  queryPotentialForEach(x: number, y: number, radius: number, callback: (entity: SpatialEntity) => void): void {
    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = cellX * CELL_KEY_PRIME + cellY;
        const cell = this.cells.get(key);

        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            callback(cell[i]);
          }
        }
      }
    }
  }

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

  findNearestN(x: number, y: number, maxRadius: number, count: number, excludeIds?: Set<number>): SpatialEntity[] {
    const candidates = this.query(x, y, maxRadius);

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

  get size(): number {
    return this.entityCells.size;
  }

  get cellCount(): number {
    return this.cells.size;
  }
}

// Global spatial hash instance for enemies (updated each frame)
let globalEnemySpatialHash: SpatialHash | null = null;

export function getEnemySpatialHash(): SpatialHash {
  if (!globalEnemySpatialHash) {
    globalEnemySpatialHash = new SpatialHash(80);
  }
  return globalEnemySpatialHash;
}

export function resetEnemySpatialHash(): void {
  if (globalEnemySpatialHash) {
    globalEnemySpatialHash.clear();
  }
}
