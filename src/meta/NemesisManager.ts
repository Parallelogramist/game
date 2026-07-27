import { EnemyCategory, getEnemyType } from '../enemies/EnemyTypes';
import { SecureStorage } from '../storage';

/**
 * NemesisManager — the enemy that last killed you, and how personal it has got.
 *
 * Read-through with sanitize-on-read (mirroring PaceGhostManager /
 * BossRotationManager): a corrupt, tampered or partially-written payload
 * degrades to "no nemesis" rather than spawning a garbage setpiece into a run.
 */

const STORAGE_KEY = 'survivor-nemesis';

/** Grudge stops escalating here — past x9 health the fight stops being winnable. */
export const NEMESIS_MAX_GRUDGE = 5;

/** Seconds into a run when the hunter arrives: after miniboss 1 (2:00), before miniboss 2 (3:30). */
export const NEMESIS_SPAWN_TIME_SECONDS = 150;

/** Cosmetic sprite/size bump so a nemesis Shambler doesn't look like a Shambler. */
export const NEMESIS_SPRITE_SCALE = 1.35;

/**
 * Types that can never be your nemesis. Bosses are excluded by category (they
 * own the rotation + rematch systems); these are excluded by id because they
 * are not standalone spawns — the minions are created by other enemies, the
 * twins are a linked pair (`linkTwins`), and the Legion is a rebuilt group.
 */
export const NEMESIS_INELIGIBLE_TYPE_IDS: readonly string[] = [
  'ghost', 'splitter_mini', 'turret', 'twin_a', 'twin_b', 'the_legion',
];

export interface NemesisRecord {
  /** ENEMY_TYPES id of the killer. */
  typeId: string;
  /** How many times this type has killed you in a row, 1..NEMESIS_MAX_GRUDGE. */
  grudge: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A killer becomes a nemesis only if it is a real, still-existing, standalone
 * non-boss type. Validated on write AND on read, so a type id retired by a
 * future content pass can never resurrect as a spawn.
 */
export function isNemesisEligible(typeId: string | null | undefined): typeId is string {
  if (typeof typeId !== 'string' || typeId.length === 0) return false;
  if (NEMESIS_INELIGIBLE_TYPE_IDS.includes(typeId)) return false;
  const enemyType = getEnemyType(typeId);
  if (!enemyType) return false;
  return enemyType.category !== EnemyCategory.Boss;
}

function sanitizeRecord(value: unknown): NemesisRecord | null {
  if (!isPlainObject(value)) return null;
  const { typeId, grudge } = value;
  if (!isNemesisEligible(typeof typeId === 'string' ? typeId : null)) return null;
  if (typeof grudge !== 'number' || !Number.isFinite(grudge) || grudge < 1) return null;
  return { typeId: typeId as string, grudge: Math.min(NEMESIS_MAX_GRUDGE, Math.floor(grudge)) };
}

/** The hunter the next run fields, or null when nothing qualifies. */
export function getNemesis(): NemesisRecord | null {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return sanitizeRecord(JSON.parse(stored) as unknown);
  } catch {
    return null;
  }
}

/** Drops the grudge. Called when the player kills their nemesis. */
export function clearNemesis(): void {
  try {
    SecureStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal — worst case the same hunter returns once more.
  }
}

/**
 * Records who killed the player. Same killer as the standing record → the
 * grudge escalates; a different one → it replaces the record at grudge 1; an
 * ineligible killer (boss, minion, twin, attacker-less damage) → the standing
 * record is left exactly as it was.
 *
 * Returns what is actually persisted, so the death screen can never announce a
 * nemesis that was not stored (same contract as `savePaceGhost`'s boolean).
 */
export function recordNemesisKill(typeId: string | null | undefined): NemesisRecord | null {
  if (!isNemesisEligible(typeId)) return getNemesis();
  const previous = getNemesis();
  const grudge = previous && previous.typeId === typeId
    ? Math.min(NEMESIS_MAX_GRUDGE, previous.grudge + 1)
    : 1;
  const record: NemesisRecord = { typeId, grudge };
  try {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    return previous;
  }
  return record;
}

/**
 * Multipliers applied on top of an already-spawned enemy of the base type
 * (so time scaling, world level and curse are all already baked in).
 * Speed does not scale with grudge on purpose — an outrun-proof hunter is a
 * different, worse game.
 */
export function nemesisScaling(grudge: number): {
  health: number; damage: number; speed: number; xp: number;
} {
  const tier = Math.min(NEMESIS_MAX_GRUDGE, Math.max(1, Math.floor(grudge)));
  return {
    health: 1.5 + 1.5 * tier,
    damage: 1 + 0.08 * tier,
    speed: 1.08,
    xp: 4,
  };
}

/** Gold paid out for putting the hunter down. */
export function nemesisGoldReward(grudge: number): number {
  const tier = Math.min(NEMESIS_MAX_GRUDGE, Math.max(1, Math.floor(grudge)));
  return 120 + 60 * tier;
}

const GRUDGE_NUMERALS: readonly string[] = ['', '', ' II', ' III', ' IV', ' V'];

/** Health-bar / banner label, e.g. `NEMESIS · Tank III`. Casing is the caller's. */
export function nemesisLabel(enemyName: string, grudge: number): string {
  const tier = Math.min(NEMESIS_MAX_GRUDGE, Math.max(1, Math.floor(grudge)));
  return `NEMESIS · ${enemyName}${GRUDGE_NUMERALS[tier] ?? ''}`;
}
