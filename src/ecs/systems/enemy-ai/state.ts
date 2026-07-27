/**
 * Shared mutable state for the EnemyAI system.
 * Callbacks, twin links, dead enemy positions, and game time live here.
 * Behavior modules import from this file when they need callbacks or shared state.
 */

import { WorldRect } from '../../../world/worldSpace';

// ── Game time (set once per frame by updateAIGameTime) ──────────────────────
export let cachedGameTime = 0;

export function updateAIGameTime(gameTime: number): void {
  cachedGameTime = gameTime;
}

// ── Field rect (the legal playfield; arena = the screen rect) ───────────────
export const enemyAIFieldRect: WorldRect = { minX: 0, minY: 0, maxX: 1280, maxY: 720 };

/**
 * Copies by value on purpose: WorldModeAdapter hands back a rect instance it reuses
 * between frames, so storing the reference would alias this module to the adapter.
 */
export function setEnemyAIFieldRect(rect: WorldRect): void {
  enemyAIFieldRect.minX = rect.minX;
  enemyAIFieldRect.minY = rect.minY;
  enemyAIFieldRect.maxX = rect.maxX;
  enemyAIFieldRect.maxY = rect.maxY;
}

// ── Callbacks for spawning effects ──────────────────────────────────────────
export let projectileSpawnCallback: ((x: number, y: number, angle: number, speed: number, damage: number) => void) | null = null;
export let minionSpawnCallback: ((x: number, y: number, typeId: string) => void) | null = null;
export let xpGemPositionsCallback: (() => { x: number; y: number; entityId: number }[]) | null = null;
export let consumeXPGemCallback: ((entityId: number) => void) | null = null;
export let groundSlamCallback: ((x: number, y: number, radius: number, damage: number) => void) | null = null;
export let laserBeamCallback: ((x1: number, y1: number, x2: number, y2: number, damage: number) => void) | null = null;
export let bossPhaseTransitionCallback: ((bossId: number, newPhase: number) => void) | null = null;

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
  bossPhaseTransitionCallback = null;
}

export function setBossPhaseTransitionCallback(
  callback: (bossId: number, newPhase: number) => void
): void {
  bossPhaseTransitionCallback = callback;
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
