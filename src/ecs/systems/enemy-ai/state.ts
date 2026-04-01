/**
 * Shared mutable state for the EnemyAI system.
 * Callbacks, twin links, dead enemy positions, and game time live here.
 * Behavior modules import from this file when they need callbacks or shared state.
 */

// ── Game time (set once per frame by updateAIGameTime) ──────────────────────
export let cachedGameTime = 0;

export function updateAIGameTime(gameTime: number): void {
  cachedGameTime = gameTime;
}

// ── Game bounds ─────────────────────────────────────────────────────────────
export let gameBoundsWidth = 1280;
export let gameBoundsHeight = 720;

export function setEnemyAIBounds(w: number, h: number): void {
  gameBoundsWidth = w;
  gameBoundsHeight = h;
}

// ── Callbacks for spawning effects ──────────────────────────────────────────
export let projectileSpawnCallback: ((x: number, y: number, angle: number, speed: number, damage: number) => void) | null = null;
export let minionSpawnCallback: ((x: number, y: number, typeId: string) => void) | null = null;
export let xpGemPositionsCallback: (() => { x: number; y: number; entityId: number }[]) | null = null;
export let consumeXPGemCallback: ((entityId: number) => void) | null = null;
export let groundSlamCallback: ((x: number, y: number, radius: number, damage: number) => void) | null = null;
export let laserBeamCallback: ((x1: number, y1: number, x2: number, y2: number, damage: number) => void) | null = null;

export function setEnemyProjectileCallback(
  callback: (x: number, y: number, angle: number, speed: number, damage: number) => void
): void {
  projectileSpawnCallback = callback;
}

export function setMinionSpawnCallback(
  callback: (x: number, y: number, typeId: string) => void
): void {
  minionSpawnCallback = callback;
}

export function setXPGemCallbacks(
  getPositions: () => { x: number; y: number; entityId: number }[],
  consumeGem: (entityId: number) => void
): void {
  xpGemPositionsCallback = getPositions;
  consumeXPGemCallback = consumeGem;
}

export function setBossCallbacks(
  groundSlam: (x: number, y: number, radius: number, damage: number) => void,
  laserBeam: (x1: number, y1: number, x2: number, y2: number, damage: number) => void
): void {
  groundSlamCallback = groundSlam;
  laserBeamCallback = laserBeam;
}

export function resetBossCallbacks(): void {
  groundSlamCallback = null;
  laserBeamCallback = null;
}

// ── Dead enemy positions (for Necromancer revive) ───────────────────────────
export const deadEnemyPositions: { x: number; y: number; time: number }[] = [];
export let deadPositionsReadPointer = 0;

export function recordEnemyDeath(x: number, y: number): void {
  deadEnemyPositions.push({ x, y, time: cachedGameTime });
  // Advance read pointer past expired entries (>10 seconds old)
  while (deadPositionsReadPointer < deadEnemyPositions.length &&
         cachedGameTime - deadEnemyPositions[deadPositionsReadPointer].time > 10) {
    deadPositionsReadPointer++;
  }
  // Compact when pointer drifts far to avoid unbounded growth
  if (deadPositionsReadPointer > 100) {
    deadEnemyPositions.splice(0, deadPositionsReadPointer);
    deadPositionsReadPointer = 0;
  }
}

// We need a setter since `let` exports are read-only from importers
export function advanceDeadPositionsPointer(): void {
  deadPositionsReadPointer++;
}

// ── Twin linking ────────────────────────────────────────────────────────────
export const twinLinks = new Map<number, number>();

export function linkTwins(twinA: number, twinB: number): void {
  twinLinks.set(twinA, twinB);
  twinLinks.set(twinB, twinA);
}

export function unlinkTwin(twinId: number): void {
  const linkedId = twinLinks.get(twinId);
  if (linkedId !== undefined) {
    twinLinks.delete(linkedId);
  }
  twinLinks.delete(twinId);
}

export function getLinkedTwin(twinId: number): number | undefined {
  return twinLinks.get(twinId);
}

export function getAllTwinLinks(): [number, number][] {
  const pairs: [number, number][] = [];
  const seen = new Set<number>();
  for (const [twinA, twinB] of twinLinks) {
    if (!seen.has(twinA) && !seen.has(twinB)) {
      pairs.push([twinA, twinB]);
      seen.add(twinA);
      seen.add(twinB);
    }
  }
  return pairs;
}

// ── Full system reset ───────────────────────────────────────────────────────
export function resetEnemyAISystem(): void {
  deadEnemyPositions.length = 0;
  deadPositionsReadPointer = 0;
  cachedGameTime = 0;
  twinLinks.clear();
  projectileSpawnCallback = null;
  minionSpawnCallback = null;
  xpGemPositionsCallback = null;
  consumeXPGemCallback = null;
  groundSlamCallback = null;
  laserBeamCallback = null;
}
