/**
 * Generic object pool to eliminate GC pressure from frequent allocations.
 *
 * Usage:
 *   const pool = new ObjectPool(() => new Graphics(), 50);
 *   const obj = pool.acquire();   // Get from pool (or create if empty)
 *   pool.release(obj);            // Return to pool for reuse
 *
 * For Phaser GameObjects, pair with setVisible(false)/setActive(false) on release
 * and setVisible(true)/setActive(true) on acquire.
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private resetFn?: (item: T) => void;

  /**
   * @param factory - Creates a new instance when pool is empty
   * @param initialSize - Pre-allocate this many objects
   * @param resetFn - Optional reset function called on release (e.g., hide sprite)
   */
  constructor(factory: () => T, initialSize: number = 0, resetFn?: (item: T) => void) {
    this.factory = factory;
    this.resetFn = resetFn;

    // Pre-allocate
    for (let i = 0; i < initialSize; i++) {
      const item = factory();
      if (resetFn) resetFn(item);
      this.pool.push(item);
    }
  }

  /**
   * Get an object from the pool, or create a new one if empty.
   */
  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.factory();
  }

  /**
   * Return an object to the pool for reuse.
   */
  release(item: T): void {
    if (this.resetFn) {
      this.resetFn(item);
    }
    this.pool.push(item);
  }

  /**
   * Get current pool size (available objects).
   */
  get available(): number {
    return this.pool.length;
  }

  /**
   * Destroy all pooled objects using an optional destructor.
   */
  clear(destructor?: (item: T) => void): void {
    if (destructor) {
      for (const item of this.pool) {
        destructor(item);
      }
    }
    this.pool.length = 0;
  }
}
