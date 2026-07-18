import { describe, it, expect } from 'vitest';
import { getEnemyType } from '../enemies/EnemyTypes';
import { TUNING } from './GameTuning';
import { EnemyAffixType } from './Affixes';
import {
  PRACTICE_TARGET_IDS,
  PRACTICE_BOSS_IDS,
  isPracticeMinibossTarget,
  scheduledSpawnTime,
  paragonOptionsFor,
  nextParagonAffix,
} from './PracticeTargets';

describe('practice targets', () => {
  it('every target id resolves to a real enemy type', () => {
    expect(PRACTICE_TARGET_IDS.length).toBe(14);
    for (const id of PRACTICE_TARGET_IDS) {
      expect(getEnemyType(id), id).toBeDefined();
    }
  });

  it('classifies bosses and minibosses apart', () => {
    for (const id of PRACTICE_BOSS_IDS) expect(isPracticeMinibossTarget(id)).toBe(false);
    expect(isPracticeMinibossTarget('glutton')).toBe(true);
  });

  it('scales bosses at the boss hour and minibosses at their own schedule', () => {
    expect(scheduledSpawnTime('horde_king')).toBe(TUNING.bosses.spawnTime);
    expect(scheduledSpawnTime('glutton')).toBe(150);
    // twin_b has no schedule row of its own — it must field with its pair, not at the boss hour.
    expect(scheduledSpawnTime('twin_b')).toBe(scheduledSpawnTime('twin_a'));
  });
});

describe('paragon second affix', () => {
  it('never offers a duplicate or the barred TITAN+VAMPIRIC pair', () => {
    expect(paragonOptionsFor(EnemyAffixType.TITAN)).not.toContain(EnemyAffixType.TITAN);
    expect(paragonOptionsFor(EnemyAffixType.TITAN)).not.toContain(EnemyAffixType.VAMPIRIC);
    expect(paragonOptionsFor(EnemyAffixType.VAMPIRIC)).not.toContain(EnemyAffixType.TITAN);
  });

  it('offers nothing but NONE when there is no first affix', () => {
    expect(paragonOptionsFor(EnemyAffixType.NONE)).toEqual([EnemyAffixType.NONE]);
    expect(nextParagonAffix(EnemyAffixType.NONE, EnemyAffixType.NONE)).toBe(EnemyAffixType.NONE);
  });

  it('cycles through the legal options and wraps back to NONE', () => {
    const options = paragonOptionsFor(EnemyAffixType.SWIFT);
    let affix = EnemyAffixType.NONE;
    const seen: EnemyAffixType[] = [];
    for (let step = 0; step < options.length; step++) {
      affix = nextParagonAffix(EnemyAffixType.SWIFT, affix);
      seen.push(affix);
    }
    expect(new Set(seen).size).toBe(options.length);
    expect(affix).toBe(EnemyAffixType.NONE);
  });
});
