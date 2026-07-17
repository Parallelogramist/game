/**
 * AccountMilestone — what the shop's ACCOUNT LV chip is counting toward.
 *
 * The chip used to chase upgrade unlock tiers only, and the top tier (50) sits
 * below every ascension threshold (50 + 15·level) — so past the first ascension
 * it rendered "ALL UNLOCKED" and a full bar while the player was still short of
 * the next ascension. The milestone is resolved here, pure and tested, because
 * the branch it gets wrong is the one no test could reach through Phaser.
 */

export type AccountMilestoneKind = 'unlock' | 'ready' | 'ascension' | 'complete';

export interface AccountMilestone {
  kind: AccountMilestoneKind;
  /** Account level the bar fills toward; null when nothing is left to chase. */
  target: number | null;
  /** Bar fill, 0..1. */
  progress: number;
  /** Right-aligned chip text. '\n' splits to two lines, matching the chip's layout. */
  label: string;
}

export interface AccountMilestoneInput {
  accountLevel: number;
  /** Smallest upgrade unlockLevel strictly above accountLevel; null when all unlocked. */
  nextUnlockTier: number | null;
  /** Highest upgrade unlockLevel at or below accountLevel; 0 when none. */
  prevUnlockTier: number;
  /** AscensionManager.getAscensionThreshold(). */
  ascensionThreshold: number;
  /** AscensionManager.canAscend(accountLevel). */
  canAscend: boolean;
  /** PermanentUpgrades.MAX_ACCOUNT_LEVEL. */
  maxAccountLevel: number;
}

function fillFraction(value: number, from: number, to: number): number {
  const span = Math.max(1, to - from);
  return Math.min(1, Math.max(0, (value - from) / span));
}

/**
 * Resolve the next milestone. Order is the order the player meets them:
 * unlock tiers first, then the ascension that sits beyond the last tier.
 * A threshold past maxAccountLevel is unreachable forever — 'complete', never
 * a target the player would chase and never arrive at.
 */
export function getAccountMilestone(input: AccountMilestoneInput): AccountMilestone {
  const {
    accountLevel,
    nextUnlockTier,
    prevUnlockTier,
    ascensionThreshold,
    canAscend,
    maxAccountLevel,
  } = input;

  if (nextUnlockTier !== null) {
    return {
      kind: 'unlock',
      target: nextUnlockTier,
      progress: fillFraction(accountLevel, prevUnlockTier, nextUnlockTier),
      label: `▶ Lv.${nextUnlockTier}`,
    };
  }

  if (canAscend) {
    return { kind: 'ready', target: null, progress: 1, label: 'ASCEND\nREADY' };
  }

  if (ascensionThreshold <= maxAccountLevel) {
    return {
      kind: 'ascension',
      target: ascensionThreshold,
      progress: fillFraction(accountLevel, prevUnlockTier, ascensionThreshold),
      label: `✦ Lv.${ascensionThreshold}`,
    };
  }

  return { kind: 'complete', target: null, progress: 1, label: 'ALL\nUNLOCKED' };
}
