import { EndlessMutatorType, ENDLESS_MUTATOR_META } from './EndlessMutators';

/**
 * PRACTICE arena rungs. Practice scales a boss-tier spawn to its canonical time,
 * but the arena around it is still t=0: no trash density, no scaling, no endless
 * cycle. A rung fields the arena a real run would have at that depth.
 *
 * Times sit on the real curve's landmarks (see TUNING.spawn): 300 opens batch
 * spawning, 600 is boss time — where the spawn-interval curve and batch thresholds
 * both max out. Past 600 only the endless cycle escalates, so the clock stops there
 * and the last two rungs deepen the cycle instead.
 *
 * Cycle rungs sit on the gates that change arena behavior: cycle 2 is where a second
 * miniboss joins each cadence tick, cycle 5 is where the miniboss cadence hits its
 * 20s floor (both in checkEndlessModeSpawns).
 */
export interface PracticeArenaRung {
  /** Run clock the rung fields. */
  gameTime: number;
  /** Endless cycle the rung fields; 0 leaves endless mode off. */
  endlessCycle: number;
  label: string;
}

/** Rungs the ARENA button steps through, shallowest first. */
export const PRACTICE_ARENA_LADDER: readonly PracticeArenaRung[] = [
  { gameTime: 0, endlessCycle: 0, label: 'OFF' },
  { gameTime: 300, endlessCycle: 0, label: '5-MIN' },
  { gameTime: 600, endlessCycle: 0, label: '10-MIN' },
  { gameTime: 600, endlessCycle: 2, label: 'CYCLE 2' },
  { gameTime: 600, endlessCycle: 5, label: 'CYCLE 5' },
];

/**
 * Per-cycle escalation a real endless run compounds one cycle at a time (see
 * checkEndlessModeSpawns: worldLevelHealthMult *= 1.25 etc. per cycle). Mirrored
 * here by hand so a practice jump to cycle N fields the same numbers cycle N would.
 */
const ENDLESS_CYCLE_RAMP = { health: 1.25, damage: 1.15, xp: 1.1 } as const;

/** Multipliers to jump `fromCycle` → `toCycle` in one step. */
export function endlessCycleRampFactor(
  fromCycle: number,
  toCycle: number,
): { health: number; damage: number; xp: number } {
  const cycles = Math.max(0, toCycle - fromCycle);
  return {
    health: Math.pow(ENDLESS_CYCLE_RAMP.health, cycles),
    damage: Math.pow(ENDLESS_CYCLE_RAMP.damage, cycles),
    xp: Math.pow(ENDLESS_CYCLE_RAMP.xp, cycles),
  };
}

/** Mutators the MUTATOR button cycles through, NONE first. Mirrors ROLLABLE_MUTATORS. */
export const PRACTICE_MUTATOR_CYCLE: readonly EndlessMutatorType[] = [
  EndlessMutatorType.NONE,
  EndlessMutatorType.SWIFT_SWARM,
  EndlessMutatorType.VOLATILE_AIR,
  EndlessMutatorType.GOLD_RUSH,
  EndlessMutatorType.XP_SURGE,
  EndlessMutatorType.IRON_HORDE,
];

/** Button label for a mutator slot. */
export function practiceMutatorLabel(mutator: EndlessMutatorType): string {
  return mutator === EndlessMutatorType.NONE ? 'NONE' : ENDLESS_MUTATOR_META[mutator].name;
}
