import { describe, test, expect, vi, afterEach } from 'vitest';
import { EnemyAffixType, AFFIX_META, AFFIX_ROLL_CHANCE, rollAffix } from './Affixes';

// Numeric enum → the numeric members only (Object.values yields both names and values).
const ALL_AFFIX_TYPES = Object.values(EnemyAffixType).filter(
  (value): value is EnemyAffixType => typeof value === 'number'
);
const ROLLABLE_TYPES = ALL_AFFIX_TYPES.filter((type) => type !== EnemyAffixType.NONE);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AFFIX_META — table integrity', () => {
  test('every enum member has a meta entry whose type field matches its key', () => {
    for (const type of ALL_AFFIX_TYPES) {
      const meta = AFFIX_META[type];
      expect(meta, `missing meta for affix type ${type}`).toBeDefined();
      expect(meta.type).toBe(type);
    }
  });

  test('NONE is fully neutral (no stat change, never rolled)', () => {
    const none = AFFIX_META[EnemyAffixType.NONE];
    expect(none.healthScale).toBe(1);
    expect(none.xpScale).toBe(1);
    expect(none.speedScale).toBe(1);
    expect(none.bonusArmor).toBe(0);
    expect(none.weight).toBe(0);
  });

  test('every rollable affix makes the enemy tougher AND more rewarding', () => {
    for (const type of ROLLABLE_TYPES) {
      const meta = AFFIX_META[type];
      // Elites must always be worth engaging: more HP, more XP.
      expect(meta.healthScale, `${meta.label} healthScale`).toBeGreaterThanOrEqual(1.3);
      expect(meta.xpScale, `${meta.label} xpScale`).toBeGreaterThan(1);
      expect(Number.isFinite(meta.speedScale)).toBe(true);
      expect(meta.speedScale).toBeGreaterThan(0);
      expect(Number.isInteger(meta.bonusArmor)).toBe(true);
      expect(meta.bonusArmor).toBeGreaterThanOrEqual(0);
    }
  });

  test('every rollable affix has a visible label and a valid ring color', () => {
    for (const type of ROLLABLE_TYPES) {
      const meta = AFFIX_META[type];
      expect(meta.label.length, `affix ${type} label`).toBeGreaterThan(0);
      expect(meta.label).toBe(meta.label.toUpperCase());
      expect(Number.isInteger(meta.color)).toBe(true);
      expect(meta.color).toBeGreaterThanOrEqual(0x000000);
      expect(meta.color).toBeLessThanOrEqual(0xffffff);
    }
  });

  test('roll weights are the tuned ladder (rarest = BLESSED, commonest = SWIFT)', () => {
    // Deliberate balance lock — retuning elite distribution must be a conscious
    // change here too, not a silent side effect.
    expect(AFFIX_META[EnemyAffixType.SWIFT].weight).toBe(24);
    expect(AFFIX_META[EnemyAffixType.VOLATILE].weight).toBe(22);
    expect(AFFIX_META[EnemyAffixType.VAMPIRIC].weight).toBe(20);
    expect(AFFIX_META[EnemyAffixType.TITAN].weight).toBe(18);
    expect(AFFIX_META[EnemyAffixType.BLESSED].weight).toBe(12);
  });
});

describe('rollAffix — spawn chance gate', () => {
  test('base roll chance is the tuned 12%', () => {
    expect(AFFIX_ROLL_CHANCE).toBe(0.12);
  });

  test('returns NONE when the gate roll lands above the chance', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1201);
    expect(rollAffix()).toBe(EnemyAffixType.NONE);
    // Failed gate must not consume a second (weight) roll.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('gate boundary is inclusive: a roll exactly at the chance grants an affix', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(AFFIX_ROLL_CHANCE) // gate: 0.12 > 0.12 is false → pass
      .mockReturnValueOnce(0.1); // weight roll → SWIFT band
    expect(rollAffix()).toBe(EnemyAffixType.SWIFT);
  });

  test('chanceMultiplier scales the gate threshold linearly', () => {
    // ×2 → 24% threshold: 0.24 passes…
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.24).mockReturnValueOnce(0.1);
    expect(rollAffix(2)).toBe(EnemyAffixType.SWIFT);
    vi.restoreAllMocks();
    // …but 0.2401 fails.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.2401);
    expect(rollAffix(2)).toBe(EnemyAffixType.NONE);
    vi.restoreAllMocks();
    // ×0.5 → 6% threshold.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.0601);
    expect(rollAffix(0.5)).toBe(EnemyAffixType.NONE);
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.06).mockReturnValueOnce(0.1);
    expect(rollAffix(0.5)).toBe(EnemyAffixType.SWIFT);
  });

  test('chanceMultiplier 0 disables affixes', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5);
    expect(rollAffix(0)).toBe(EnemyAffixType.NONE);
  });

  test('the gate has no upper clamp: a huge multiplier guarantees an affix', () => {
    // Documents current behavior — pacts/events can push elite density to 100%.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.999).mockReturnValueOnce(0.1);
    expect(rollAffix(100)).toBe(EnemyAffixType.SWIFT);
  });

  test('default multiplier is 1 (bare call behaves like rollAffix(1))', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.119).mockReturnValueOnce(0.1);
    expect(rollAffix()).toBe(EnemyAffixType.SWIFT);
  });
});

describe('rollAffix — weighted distribution', () => {
  // Weights 24/22/20/18/12 over a total of 96 partition the unit interval into
  // bands (the walk subtracts each weight and stops at roll <= 0):
  //   SWIFT    (0,    0.25  ]
  //   VOLATILE (0.25, 46/96 ]
  //   VAMPIRIC (46/96, 66/96]
  //   TITAN    (66/96, 0.875]
  //   BLESSED  (0.875, 1    )
  // Probes are hardcoded so a weight retune fails here loudly.
  const probe = (weightRoll: number): EnemyAffixType => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(weightRoll);
    const result = rollAffix();
    vi.restoreAllMocks();
    return result;
  };

  test('mid-band probes hit each affix', () => {
    expect(probe(0.1)).toBe(EnemyAffixType.SWIFT);
    expect(probe(0.35)).toBe(EnemyAffixType.VOLATILE);
    expect(probe(0.55)).toBe(EnemyAffixType.VAMPIRIC);
    expect(probe(0.8)).toBe(EnemyAffixType.TITAN);
    expect(probe(0.95)).toBe(EnemyAffixType.BLESSED);
  });

  test('band boundaries are inclusive on the lower affix (roll <= 0 stops the walk)', () => {
    expect(probe(24 / 96)).toBe(EnemyAffixType.SWIFT);
    expect(probe(46 / 96)).toBe(EnemyAffixType.VOLATILE);
    expect(probe(66 / 96)).toBe(EnemyAffixType.VAMPIRIC);
    expect(probe(84 / 96)).toBe(EnemyAffixType.TITAN);
  });

  test('the extremes of the weight roll resolve to the first and last affix', () => {
    expect(probe(0)).toBe(EnemyAffixType.SWIFT); // roll 0 → first subtract lands at -24
    expect(probe(0.999999)).toBe(EnemyAffixType.BLESSED);
  });

  test('a passed gate consumes exactly two random rolls', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    rollAffix();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
