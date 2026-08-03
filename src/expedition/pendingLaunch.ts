// Module-level handoff for a run launched from the between-runs survey (MapScene in browse mode).
// The launch is routed back through BootScene to reuse its confirm-if-a-run-is-in-progress +
// clear-save + fade path, and deliberately does NOT ride on scene.start data, for the reason
// setPendingReplay records: Phaser retains a scene's last settings.data when start() is passed
// none, and BootScene's own flyExpeditionWorld ends in scene.restart(), which reuses it too, so a
// retained flag would auto-start a run the next time the player charted a new world. consume clears it.
let pendingExpeditionLaunch = false;

export function setPendingExpeditionLaunch(): void {
  pendingExpeditionLaunch = true;
}

export function consumePendingExpeditionLaunch(): boolean {
  const pending = pendingExpeditionLaunch;
  pendingExpeditionLaunch = false;
  return pending;
}

/** Where the between-runs survey pointed the fresh run's one seeded SORTIE. Stamped with the
 *  world it was planned in, because a player can chart a NEW world between pressing LAUNCH and
 *  the run binding, and a key like "3,2" exists in that world too. */
export interface PlannedSortie {
  worldSeed: number;
  worldGenVersion: number;
  sectorKey: string;
}

// A second value rather than a payload on the flag above: BootScene consumes the flag to start
// the run and GameScene consumes this to aim the jump, and one value cannot be consumed twice.
let plannedSortie: PlannedSortie | null = null;

export function setPlannedSortie(plan: PlannedSortie | null): void {
  plannedSortie = plan;
}

export function consumePlannedSortie(): PlannedSortie | null {
  const plan = plannedSortie;
  plannedSortie = null;
  return plan;
}
