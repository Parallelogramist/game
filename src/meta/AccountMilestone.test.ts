import { describe, it, expect } from 'vitest';
import { getAccountMilestone, AccountMilestoneInput } from './AccountMilestone';

const BASE: AccountMilestoneInput = {
  accountLevel: 0,
  nextUnlockTier: 10,
  prevUnlockTier: 0,
  ascensionThreshold: 50,
  canAscend: false,
  maxAccountLevel: 412,
};

const at = (overrides: Partial<AccountMilestoneInput>) =>
  getAccountMilestone({ ...BASE, ...overrides });

describe('getAccountMilestone', () => {
  it('chases the next unlock tier while any remain', () => {
    const milestone = at({ accountLevel: 5, nextUnlockTier: 10, prevUnlockTier: 0 });
    expect(milestone.kind).toBe('unlock');
    expect(milestone.target).toBe(10);
    expect(milestone.progress).toBeCloseTo(0.5);
    expect(milestone.label).toBe('▶ Lv.10');
  });

  it('fills the unlock bar from the previous tier, not from zero', () => {
    expect(at({ accountLevel: 30, nextUnlockTier: 50, prevUnlockTier: 30 }).progress).toBe(0);
    expect(at({ accountLevel: 40, nextUnlockTier: 50, prevUnlockTier: 30 }).progress).toBeCloseTo(0.5);
  });

  // An unlock tier outranks an ascension that is already available: the player
  // can press ASCEND from the button either way, but the bar should keep showing
  // the tier they have not reached yet.
  it('prefers an outstanding unlock tier over a ready ascension', () => {
    expect(at({ accountLevel: 55, nextUnlockTier: 60, canAscend: true }).kind).toBe('unlock');
  });

  it('reports ready when all tiers are unlocked and the threshold is met', () => {
    const milestone = at({ accountLevel: 50, nextUnlockTier: null, prevUnlockTier: 50, canAscend: true });
    expect(milestone.kind).toBe('ready');
    expect(milestone.target).toBeNull();
    expect(milestone.progress).toBe(1);
    expect(milestone.label).toBe('ASCEND\nREADY');
  });

  // The regression this file exists for: at ascension >= 1 the top unlock tier
  // (50) is below the threshold (65+), and the chip used to read ALL UNLOCKED.
  it('chases the next ascension once the unlock tiers run out', () => {
    const milestone = at({
      accountLevel: 50,
      nextUnlockTier: null,
      prevUnlockTier: 50,
      ascensionThreshold: 65,
    });
    expect(milestone.kind).toBe('ascension');
    expect(milestone.target).toBe(65);
    expect(milestone.progress).toBe(0);
    expect(milestone.label).toBe('✦ Lv.65');

    expect(
      at({ accountLevel: 60, nextUnlockTier: null, prevUnlockTier: 50, ascensionThreshold: 65 })
        .progress,
    ).toBeCloseTo(2 / 3);
  });

  it('is complete only when the threshold is past the reachable ceiling', () => {
    const reachable = at({
      accountLevel: 412,
      nextUnlockTier: null,
      prevUnlockTier: 50,
      ascensionThreshold: 410,
    });
    expect(reachable.kind).toBe('ascension');

    const unreachable = at({
      accountLevel: 412,
      nextUnlockTier: null,
      prevUnlockTier: 50,
      ascensionThreshold: 425,
    });
    expect(unreachable.kind).toBe('complete');
    expect(unreachable.target).toBeNull();
    expect(unreachable.progress).toBe(1);
    expect(unreachable.label).toBe('ALL\nUNLOCKED');
  });

  it('clamps progress into 0..1 for out-of-range account levels', () => {
    expect(at({ accountLevel: -5, nextUnlockTier: 10, prevUnlockTier: 0 }).progress).toBe(0);
    expect(at({ accountLevel: 999, nextUnlockTier: 10, prevUnlockTier: 0 }).progress).toBe(1);
  });
});
