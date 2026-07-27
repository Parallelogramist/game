import { TUNING } from '../data/GameTuning';
import { SecureStorage } from '../storage';
import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';

/**
 * BossRotationManager — which of the twelve bosses the next run fields.
 *
 * The rotation used to be a module-static index that died with the page, so
 * every fresh load fought the first boss again and eleven bosses were
 * effectively unreachable. It is persisted here instead, read-through and
 * sanitize-on-read (mirroring PaceGhostManager): a corrupt or tampered index
 * degrades to the head of the order rather than indexing off the end.
 */

const STORAGE_KEY = 'survivor-boss-rotation';

/** The 10-minute boss cycle, in the order a player meets it. */
export const BOSS_ROTATION: readonly string[] = TUNING.bosses.order;

function sanitizeRotationIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value) % BOSS_ROTATION.length;
}

/** Boss type id at a rotation position. Wraps, so a cursor may run past the end. */
export function bossIdAtRotation(rotationIndex: number): string {
  return BOSS_ROTATION[sanitizeRotationIndex(rotationIndex)];
}

/** Where the persisted rotation sits. Absent or corrupt reads as the head. */
export function getBossRotationIndex(): number {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY);
    if (!stored) return 0;
    return sanitizeRotationIndex(JSON.parse(stored) as unknown);
  } catch {
    return 0;
  }
}

/** The boss the next rotation-fed run will field. */
export function getUpcomingBossId(): string {
  return bossIdAtRotation(getBossRotationIndex());
}

/**
 * Moves the rotation on by one. Called when a rotation-fed boss actually
 * spawns — never at run start, or a run that died at 3:00 would burn a boss the
 * player never met.
 */
export function advanceBossRotation(): void {
  try {
    const next = (getBossRotationIndex() + 1) % BOSS_ROTATION.length;
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal: the rotation repeats a boss instead of losing the run.
  }
}

/**
 * Rotation position a daily/weekly challenge fields, derived from the challenge
 * date so the same challenge is the same fight on every device and never spends
 * the local rotation. Seeded from its own key rather than the challenge rng, so
 * the day's modifier / ship / weapon picks stay exactly what they were before
 * bosses were seeded.
 */
export function challengeBossRotationIndex(dateString: string): number {
  const rng = mulberry32(hashStringToSeed(`boss:${dateString}`));
  return Math.floor(rng() * BOSS_ROTATION.length);
}
