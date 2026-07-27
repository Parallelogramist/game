/**
 * dailySeed — the date-derived deterministic RNG shared by the daily challenge
 * and the daily quest board, so both resolve "today" and their seeded picks
 * identically.
 *
 * Extracted from DailyChallengeManager (which re-exports getCurrentDailyDate for
 * its existing consumers) so a caller can seed a daily pick without importing
 * that module's weapon/ship catalogs — those pull Phaser in, which a pure
 * unit-tested module must not do.
 */

export type SeededRng = () => number;

export function mulberry32(seed: number): SeededRng {
  let currentSeed = seed >>> 0;
  return function next(): number {
    currentSeed = (currentSeed + 0x6D2B79F5) >>> 0;
    let temp = currentSeed;
    temp = Math.imul(temp ^ (temp >>> 15), temp | 1);
    temp ^= temp + Math.imul(temp ^ (temp >>> 7), temp | 61);
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a string to a 32-bit seed using a simple FNV-1a hash.
 * Stable across runs for a given input.
 */
export function hashStringToSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Returns the current UTC date string in YYYY-MM-DD format. */
export function getCurrentDailyDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shuffleWithRng<T>(items: T[], rng: SeededRng): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
