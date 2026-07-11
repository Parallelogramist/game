/**
 * Endless-cycle mutators.
 *
 * Each endless boss-wave cycle (cycle 1+) rolls one named, cycle-wide mutator
 * announced on the cycle banner and pinned in the HUD top-center slot. Effects
 * are roll-time / spawn-time multipliers only (no per-frame system):
 *  - SWIFT SWARM   : trash spawns move faster
 *  - VOLATILE AIR  : trash elite-affix chance doubled
 *  - GOLD RUSH     : gold cache payloads are bigger
 *  - XP SURGE      : trash spawns drop more XP
 *  - IRON HORDE    : trash spawns gain flat armor
 */
export enum EndlessMutatorType {
  NONE = 0,
  SWIFT_SWARM = 1,
  VOLATILE_AIR = 2,
  GOLD_RUSH = 3,
  XP_SURGE = 4,
  IRON_HORDE = 5,
}

export interface EndlessMutatorMeta {
  type: EndlessMutatorType;
  name: string;                  // banner/HUD display name
  description: string;           // banner second line
  trashSpeedScale: number;       // multiplies Velocity.speed at spawn (xpValue < 30)
  affixChanceMultiplier: number; // multiplies AFFIX_ROLL_CHANCE for trash rolls
  goldDropScale: number;         // multiplies gold-cache consumable payload
  trashXpScale: number;          // multiplies xpValue at spawn (xpValue < 30)
  trashArmorBonus: number;       // flat armor added at spawn (xpValue < 30)
}

export const ENDLESS_MUTATOR_META: Record<EndlessMutatorType, EndlessMutatorMeta> = {
  [EndlessMutatorType.NONE]: {
    type: EndlessMutatorType.NONE, name: '', description: '',
    trashSpeedScale: 1, affixChanceMultiplier: 1, goldDropScale: 1, trashXpScale: 1, trashArmorBonus: 0,
  },
  [EndlessMutatorType.SWIFT_SWARM]: {
    type: EndlessMutatorType.SWIFT_SWARM, name: 'SWIFT SWARM', description: '+15% ENEMY SPEED',
    trashSpeedScale: 1.15, affixChanceMultiplier: 1, goldDropScale: 1, trashXpScale: 1, trashArmorBonus: 0,
  },
  [EndlessMutatorType.VOLATILE_AIR]: {
    type: EndlessMutatorType.VOLATILE_AIR, name: 'VOLATILE AIR', description: 'ELITE SPAWN CHANCE ×2',
    trashSpeedScale: 1, affixChanceMultiplier: 2, goldDropScale: 1, trashXpScale: 1, trashArmorBonus: 0,
  },
  [EndlessMutatorType.GOLD_RUSH]: {
    type: EndlessMutatorType.GOLD_RUSH, name: 'GOLD RUSH', description: '+50% GOLD DROPS',
    trashSpeedScale: 1, affixChanceMultiplier: 1, goldDropScale: 1.5, trashXpScale: 1, trashArmorBonus: 0,
  },
  [EndlessMutatorType.XP_SURGE]: {
    type: EndlessMutatorType.XP_SURGE, name: 'XP SURGE', description: '+25% XP DROPS',
    trashSpeedScale: 1, affixChanceMultiplier: 1, goldDropScale: 1, trashXpScale: 1.25, trashArmorBonus: 0,
  },
  [EndlessMutatorType.IRON_HORDE]: {
    type: EndlessMutatorType.IRON_HORDE, name: 'IRON HORDE', description: 'ENEMIES +2 ARMOR',
    trashSpeedScale: 1, affixChanceMultiplier: 1, goldDropScale: 1, trashXpScale: 1, trashArmorBonus: 2,
  },
};

const ROLLABLE_MUTATORS: EndlessMutatorType[] = [
  EndlessMutatorType.SWIFT_SWARM,
  EndlessMutatorType.VOLATILE_AIR,
  EndlessMutatorType.GOLD_RUSH,
  EndlessMutatorType.XP_SURGE,
  EndlessMutatorType.IRON_HORDE,
];

/**
 * Rolls the mutator for a new endless cycle: uniform over the pool excluding the
 * previous cycle's mutator, so consecutive cycles always feel different.
 */
export function rollEndlessMutator(previousMutator: EndlessMutatorType): EndlessMutatorType {
  const pool = ROLLABLE_MUTATORS.filter((type) => type !== previousMutator);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Save-restore guard: anything but a known rollable mutator id falls back to NONE. */
export function sanitizeEndlessMutator(value: unknown): EndlessMutatorType {
  if (typeof value === 'number' && ROLLABLE_MUTATORS.includes(value)) {
    return value as EndlessMutatorType;
  }
  return EndlessMutatorType.NONE;
}
