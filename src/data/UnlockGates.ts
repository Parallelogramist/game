/**
 * UnlockGates — shared parser for content unlock requirements.
 *
 * Single source of truth for the gate syntax used by ships
 * (`ShipCharacter.unlockRequirement`) and stages (`StageDefinition.unlockRequirement`),
 * consumed by WeaponSelectScene's availability filters.
 *
 * Supported syntax:
 * - undefined / ''        → always unlocked
 * - 'hidden:<conditionId>' → unlocked once HiddenUnlockManager has the condition
 * - 'worldLevel:<n>'       → unlocked at world level >= n
 * - 'account:<n>'          → unlocked at account level >= n (sum of permanent
 *                            upgrade levels; note: ascension resets it, so an
 *                            account-gated entry re-locks after prestige, same
 *                            as account-gated shop upgrades)
 * - anything else          → treated as unlocked (the data tests lock each
 *                            table to known syntax, so junk gates fail loudly
 *                            in CI instead of silently locking content)
 *
 * Malformed numbers coerce to 0 (`Number(...) || 0`) → unlocked, preserving
 * the legacy inline-filter behavior this module replaced.
 */

export interface UnlockGateContext {
  /** Condition ids already unlocked via HiddenUnlockManager. */
  unlockedConditionIds: readonly string[];
  /** Current world level from MetaProgressionManager. */
  worldLevel: number;
  /** Current account level from MetaProgressionManager. */
  accountLevel: number;
}

export function isUnlockRequirementMet(
  requirement: string | undefined,
  context: UnlockGateContext
): boolean {
  if (!requirement) return true;
  if (requirement.startsWith('hidden:')) {
    const conditionId = requirement.slice('hidden:'.length);
    return context.unlockedConditionIds.includes(conditionId);
  }
  if (requirement.startsWith('worldLevel:')) {
    const requiredLevel = Number(requirement.slice('worldLevel:'.length)) || 0;
    return context.worldLevel >= requiredLevel;
  }
  if (requirement.startsWith('account:')) {
    const requiredLevel = Number(requirement.slice('account:'.length)) || 0;
    return context.accountLevel >= requiredLevel;
  }
  return true;
}
