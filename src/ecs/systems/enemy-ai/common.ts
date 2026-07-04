import { IWorld, hasComponent } from 'bitecs';
import { Destructible } from '../../components';
import type { TelegraphManager } from '../../../effects/TelegraphManager';

/**
 * Constants and per-frame context shared between the enemy AI behavior
 * modules and the dispatcher/miniboss/boss code still in EnemyAISystem.ts.
 * Lives here rather than in EnemyAISystem.ts because the dispatcher imports
 * the behavior modules — exporting from there back into them would cycle.
 */

// OPTIMIZATION: Pre-computed Math constants to avoid repeated calculations
export const PI_HALF = Math.PI / 2;
export const PI_TWO = Math.PI * 2;

// Attack telegraph manager (injected by GameScene). Draws windup indicators
// before dangerous enemy attacks (dash / charge / ground slam / boss AOEs).
// Geometry + timing live in ./telegraphs (pure, unit-tested). Pure
// readability — never affects damage or timing. Read it via the live import
// binding — GameScene injects it after module load.
export let telegraphManager: TelegraphManager | null = null;
export function setTelegraphManager(manager: TelegraphManager | null): void {
  telegraphManager = manager;
}

// Current world ref for the frame, set at the top of enemyAISystem() so AI
// sub-functions (healer, auras) can test for Destructible (crates share the
// EnemyTag spatial hash but must be excluded from heals/auras).
let aiWorld: IWorld | null = null;

export function setAIWorld(world: IWorld): void {
  aiWorld = world;
}

export function isDestructible(entityId: number): boolean {
  return aiWorld !== null && hasComponent(aiWorld, Destructible, entityId);
}
