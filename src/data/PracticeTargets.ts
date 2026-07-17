import { TUNING } from './GameTuning';
import { EnemyAffixType, AFFIX_META } from './Affixes';

/** The 5 scheduled bosses, in cycle order. */
export const PRACTICE_BOSS_IDS: readonly string[] = [...TUNING.bosses.order];

/** The 5 scheduled minibosses. `twin_a` fields the twin pair. */
export const PRACTICE_MINIBOSS_IDS: readonly string[] = TUNING.minibosses.schedule.map((entry) => entry.typeId);

/** Every practice-spawnable target: bosses first, then minibosses. */
export const PRACTICE_TARGET_IDS: readonly string[] = [...PRACTICE_BOSS_IDS, ...PRACTICE_MINIBOSS_IDS];

export function isPracticeMinibossTarget(typeId: string): boolean {
  return PRACTICE_MINIBOSS_IDS.includes(typeId);
}

/**
 * The run time a target would normally be met at. Practice spawns at ~t=0, and
 * enemy stats scale off the clock, so scaling a practice spawn at gameTime would
 * field a much weaker enemy than the one being judged.
 */
export function scheduledSpawnTime(typeId: string): number {
  const scheduleId = typeId === 'twin_b' ? 'twin_a' : typeId;
  const scheduled = TUNING.minibosses.schedule.find((entry) => entry.typeId === scheduleId);
  return scheduled ? scheduled.time : TUNING.bosses.spawnTime;
}

/** Affixes a boss-tier spawn can carry, NONE first. Mirrors BOSS_ROLLABLE_AFFIXES (BLESSED excluded). */
export const PRACTICE_AFFIX_CYCLE: readonly EnemyAffixType[] = [
  EnemyAffixType.NONE,
  EnemyAffixType.SWIFT,
  EnemyAffixType.VOLATILE,
  EnemyAffixType.VAMPIRIC,
  EnemyAffixType.TITAN,
];

/** TITAN+VAMPIRIC is degenerate — Affixes.ts bars the pair from rolling; a hand-picked pair must obey it too. */
const PARAGON_EXCLUDED_PARTNER: Partial<Record<EnemyAffixType, EnemyAffixType>> = {
  [EnemyAffixType.TITAN]: EnemyAffixType.VAMPIRIC,
  [EnemyAffixType.VAMPIRIC]: EnemyAffixType.TITAN,
};

/** Second-affix options legal alongside `first`: NONE, minus `first`, minus its barred partner. */
export function paragonOptionsFor(first: EnemyAffixType): EnemyAffixType[] {
  if (first === EnemyAffixType.NONE) return [EnemyAffixType.NONE];
  return PRACTICE_AFFIX_CYCLE.filter(
    (affix) => affix !== first && affix !== PARAGON_EXCLUDED_PARTNER[first],
  );
}

/** Next legal second affix after `current`, wrapping. Returns NONE when `first` is NONE. */
export function nextParagonAffix(first: EnemyAffixType, current: EnemyAffixType): EnemyAffixType {
  const options = paragonOptionsFor(first);
  const index = options.indexOf(current);
  return options[(index + 1) % options.length];
}

/** Button label for an affix slot. */
export function affixLabel(affix: EnemyAffixType): string {
  return affix === EnemyAffixType.NONE ? 'NONE' : AFFIX_META[affix].label;
}
