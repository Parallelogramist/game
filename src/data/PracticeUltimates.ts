import { SHIP_ULTIMATES, type ShipUltimateId } from './ShipUltimates';

/**
 * PRACTICE ultimate override. Practice always starts ship_default (PracticeScene's
 * startRun), so Overdrive is the only one of the 11 ultimates the sandbox could
 * otherwise ever fire. `null` = fly the ship's own.
 */
export type PracticeUltimateChoice = ShipUltimateId | null;

/** Choices the ULT button steps through. Derived from the registry so it cannot drift. */
export const PRACTICE_ULTIMATE_CYCLE: readonly PracticeUltimateChoice[] = [
  null,
  ...SHIP_ULTIMATES.map((ultimate) => ultimate.id),
];

export function practiceUltimateLabel(choice: PracticeUltimateChoice): string {
  if (choice === null) return 'SHIP';
  const found = SHIP_ULTIMATES.find((ultimate) => ultimate.id === choice);
  return (found?.name ?? choice).toUpperCase();
}

/** An unknown choice restarts the cycle at SHIP (indexOf → -1 → index 0). */
export function nextPracticeUltimate(current: PracticeUltimateChoice): PracticeUltimateChoice {
  const index = PRACTICE_ULTIMATE_CYCLE.indexOf(current);
  return PRACTICE_ULTIMATE_CYCLE[(index + 1) % PRACTICE_ULTIMATE_CYCLE.length];
}
