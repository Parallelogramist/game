/**
 * Elite affix system.
 *
 * Regular enemies have a small chance to spawn as an "elite" with a single
 * affix that modifies behaviour and grants better rewards. Affixed enemies are
 * tougher, worth more XP, and marked with a colored ring + floating HP bar +
 * label (see EliteAffixVisualManager). Behaviours are hooked in GameScene:
 *  - SWIFT     : faster (applied at spawn)
 *  - VOLATILE  : explodes on death (AOE to player + enemies)
 *  - VAMPIRIC  : heals itself when it damages the player
 *  - TITAN     : far tankier (HP + armor)
 *  - BLESSED   : guaranteed floor-consumable drop
 */
export enum EnemyAffixType {
  NONE = 0,
  SWIFT = 1,
  VOLATILE = 2,
  VAMPIRIC = 3,
  TITAN = 4,
  BLESSED = 5,
}

export interface AffixMeta {
  type: EnemyAffixType;
  label: string;
  color: number;        // neon ring/label color
  healthScale: number;  // multiplies max HP
  xpScale: number;      // multiplies XP value
  speedScale: number;   // multiplies move speed
  bonusArmor: number;   // flat armor added
  weight: number;       // relative roll weight
}

export const AFFIX_META: Record<EnemyAffixType, AffixMeta> = {
  [EnemyAffixType.NONE]: {
    type: EnemyAffixType.NONE, label: '', color: 0xffffff,
    healthScale: 1, xpScale: 1, speedScale: 1, bonusArmor: 0, weight: 0,
  },
  [EnemyAffixType.SWIFT]: {
    type: EnemyAffixType.SWIFT, label: 'SWIFT', color: 0xffe24a,
    healthScale: 1.3, xpScale: 1.4, speedScale: 1.6, bonusArmor: 0, weight: 24,
  },
  [EnemyAffixType.VOLATILE]: {
    type: EnemyAffixType.VOLATILE, label: 'VOLATILE', color: 0xffaa00,
    healthScale: 1.4, xpScale: 1.5, speedScale: 1, bonusArmor: 0, weight: 22,
  },
  [EnemyAffixType.VAMPIRIC]: {
    type: EnemyAffixType.VAMPIRIC, label: 'VAMPIRIC', color: 0xff4466,
    healthScale: 1.5, xpScale: 1.5, speedScale: 1.05, bonusArmor: 0, weight: 20,
  },
  [EnemyAffixType.TITAN]: {
    type: EnemyAffixType.TITAN, label: 'TITAN', color: 0x66ddff,
    healthScale: 2.4, xpScale: 1.8, speedScale: 0.85, bonusArmor: 4, weight: 18,
  },
  [EnemyAffixType.BLESSED]: {
    type: EnemyAffixType.BLESSED, label: 'BLESSED', color: 0xffd24a,
    healthScale: 1.4, xpScale: 1.6, speedScale: 1, bonusArmor: 0, weight: 12,
  },
};

/** Base chance a regular enemy spawns with an affix. */
export const AFFIX_ROLL_CHANCE = 0.12;

const ROLLABLE_AFFIXES: EnemyAffixType[] = [
  EnemyAffixType.SWIFT,
  EnemyAffixType.VOLATILE,
  EnemyAffixType.VAMPIRIC,
  EnemyAffixType.TITAN,
  EnemyAffixType.BLESSED,
];

const TOTAL_WEIGHT = ROLLABLE_AFFIXES.reduce((sum, type) => sum + AFFIX_META[type].weight, 0);

/**
 * Rolls an affix for a freshly-spawned regular enemy. Returns NONE most of the
 * time. `chanceMultiplier` lets pacts/events tune elite density.
 */
export function rollAffix(chanceMultiplier: number = 1): EnemyAffixType {
  if (Math.random() > AFFIX_ROLL_CHANCE * chanceMultiplier) return EnemyAffixType.NONE;
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const type of ROLLABLE_AFFIXES) {
    roll -= AFFIX_META[type].weight;
    if (roll <= 0) return type;
  }
  return EnemyAffixType.SWIFT;
}

/**
 * Chance an eligible boss (endless cycle 2+ / gauntlet wave 6+) or miniboss
 * (endless cycle 2+ / gauntlet wave 4+) spawns affixed.
 */
export const BOSS_AFFIX_CHANCE = 0.35;

/**
 * Bosses take affix stat multipliers at half strength: boss HP is already
 * doubled at spawn (a full TITAN 2.4× would drag the fight; a full SWIFT
 * 1.6× breaks chase feel). XP scale and flat armor stay full.
 */
export const BOSS_AFFIX_STAT_DAMPING = 0.5;

export function softenBossAffixScale(scale: number): number {
  return 1 + (scale - 1) * BOSS_AFFIX_STAT_DAMPING;
}

// BLESSED is excluded: bosses already guarantee a consumable + data-cache roll.
const BOSS_ROLLABLE_AFFIXES: EnemyAffixType[] = [
  EnemyAffixType.SWIFT,
  EnemyAffixType.VOLATILE,
  EnemyAffixType.VAMPIRIC,
  EnemyAffixType.TITAN,
];

const BOSS_TOTAL_WEIGHT = BOSS_ROLLABLE_AFFIXES.reduce((sum, type) => sum + AFFIX_META[type].weight, 0);

/** Rolls the affix for an eligible boss/miniboss spawn. Returns NONE most of the time. */
export function rollBossAffix(): EnemyAffixType {
  if (Math.random() > BOSS_AFFIX_CHANCE) return EnemyAffixType.NONE;
  let roll = Math.random() * BOSS_TOTAL_WEIGHT;
  for (const type of BOSS_ROLLABLE_AFFIXES) {
    roll -= AFFIX_META[type].weight;
    if (roll <= 0) return type;
  }
  return EnemyAffixType.SWIFT;
}

/**
 * VAMPIRIC contact-heal fraction by enemy tier. 20% of a boss's doubled pool
 * (or a miniboss's large pool) per hit would out-heal player DPS and
 * soft-lock the fight, so bigger enemies heal a smaller fraction.
 */
export function vampiricHealFraction(xpValue: number): number {
  if (xpValue >= 1000) return 0.05;
  if (xpValue >= 30) return 0.1;
  return 0.2;
}
