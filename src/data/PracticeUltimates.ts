import { SHIP_ULTIMATES, type ShipUltimateId } from './ShipUltimates';

/**
 * PRACTICE ultimate override. `null` = fly the ship's own — which, since
 * FEAT-PRACTICE-SHIP, means whichever of the 11 ships the PRACTICE menu picked.
 * The override still earns its keep: it swaps the ultimate without a restart, so
 * all 11 can be fired back-to-back inside one run.
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
