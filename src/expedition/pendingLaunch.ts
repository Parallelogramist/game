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
