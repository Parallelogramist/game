import { SecureStorage } from '../storage';
import {
  TRAVERSAL_ABILITIES,
  TraversalAbilityDefinition,
  TraversalAbilityId,
  traversalAbilityIndex,
} from '../data/TraversalAbilities';

/**
 * Which traversal abilities this profile owns. Earned at ability vaults, permanent at
 * the moment of pickup, and never spent or lost — death keeps them (doc 04 section 7).
 *
 * Read-through with sanitize-on-read, mirroring PracticeBestTimes/ShipRecords: there is
 * no module-level cache, so there is nothing for a GameScene restart to reset and a
 * corrupt or tampered payload degrades to "owns nothing" instead of throwing.
 */

const STORAGE_KEY_TRAVERSAL_ABILITIES = 'survivor-traversal-abilities';

/**
 * Ownership is stored BY ID, never as a bit position: README section 3.6 expects a
 * WORLDGEN_VERSION bump to remap profile flags by id, and a positional mask would
 * silently hand a player different abilities the first time the catalog is reordered.
 */
export function sanitizeOwnedAbilityIds(value: unknown): TraversalAbilityId[] {
  if (!Array.isArray(value)) return [];
  const owned = new Set<TraversalAbilityId>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const index = traversalAbilityIndex(entry);
    if (index >= 0) owned.add(TRAVERSAL_ABILITIES[index].id);
  }
  return [...owned].sort((a, b) => traversalAbilityIndex(a) - traversalAbilityIndex(b));
}

function load(): TraversalAbilityId[] {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY_TRAVERSAL_ABILITIES);
    if (!stored) return [];
    return sanitizeOwnedAbilityIds(JSON.parse(stored) as unknown);
  } catch {
    return [];
  }
}

export function getOwnedTraversalAbilityIds(): TraversalAbilityId[] {
  return load();
}

export function getOwnedTraversalAbilities(): TraversalAbilityDefinition[] {
  return load().map((id) => TRAVERSAL_ABILITIES[traversalAbilityIndex(id)]);
}

export function hasTraversalAbility(id: string): boolean {
  return load().some((owned) => owned === id);
}

/**
 * Grants an ability permanently. Returns false for an unknown or already-owned id, so
 * a claim site can decide whether to fire its toast. The write rides SecureStorage's
 * practice-session block deliberately: a sandbox run must never bank a real ability,
 * which is the opposite of PracticeBestTimes' lift-the-block case.
 */
export function claimTraversalAbility(id: string): boolean {
  if (traversalAbilityIndex(id) < 0) return false;
  const owned = load();
  if (owned.some((existing) => existing === id)) return false;
  SecureStorage.setItem(
    STORAGE_KEY_TRAVERSAL_ABILITIES,
    JSON.stringify(sanitizeOwnedAbilityIds([...owned, id])),
  );
  return true;
}
