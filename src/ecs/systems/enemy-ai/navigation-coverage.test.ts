/**
 * FEAT-ENEMY-NAV-COVERAGE routes pursuit around walls but deliberately leaves retreat, strafe and
 * orbit phases on the raw vector. Both halves fail silently: a band converted by mistake still
 * produces plausible motion, it just stops kiting.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { Transform, Velocity, EnemyAI } from '../../components';
import { setNavigationContext } from './common';
import type { NavigationContext } from './common';
import { updateShooterAI } from './shooter';

const world = createWorld();

/** Never any line of sight, and a flow route that always steps one tile north. */
function routedNorth(): NavigationContext {
  return {
    hasLineOfSight: () => false,
    flowStep: (_x, y, out) => { out.x = _x; out.y = y - 40; return true; },
    isSolidAt: () => false,
    freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
  };
}

function makeEnemy(x: number, y: number, speed: number): number {
  const entityId = addEntity(world);
  addComponent(world, Transform, entityId);
  addComponent(world, Velocity, entityId);
  addComponent(world, EnemyAI, entityId);
  Transform.x[entityId] = x;
  Transform.y[entityId] = y;
  Velocity.speed[entityId] = speed;
  EnemyAI.phase[entityId] = 0;
  EnemyAI.shootTimer[entityId] = 99;
  return entityId;
}

afterEach(() => setNavigationContext(null));

describe('shooter', () => {
  it('walks the flow route when it is too far away to shoot', () => {
    setNavigationContext(routedNorth());
    const shooter = makeEnemy(0, 0, 100);

    updateShooterAI(shooter, 500, 0, 0.016);

    expect(Velocity.x[shooter]).toBeCloseTo(0);
    expect(Velocity.y[shooter]).toBeCloseTo(-70);
  });

  it('keeps its straight retreat, so cornering a kiter still works', () => {
    setNavigationContext(routedNorth());
    const shooter = makeEnemy(0, 0, 100);

    updateShooterAI(shooter, 100, 0, 0.016);

    expect(Velocity.x[shooter]).toBeCloseTo(-100);
    expect(Velocity.y[shooter]).toBeCloseTo(0);
  });

  it('keeps its straight strafe in the sweet spot', () => {
    setNavigationContext(routedNorth());
    const shooter = makeEnemy(0, 0, 100);

    updateShooterAI(shooter, 220, 0, 0.016);

    expect(Velocity.x[shooter]).toBeCloseTo(0);
    expect(Math.abs(Velocity.y[shooter])).toBeCloseTo(50);
  });

  it('is unchanged in arena, where there is no navigation context', () => {
    const shooter = makeEnemy(0, 0, 100);

    updateShooterAI(shooter, 500, 0, 0.016);

    expect(Velocity.x[shooter]).toBeCloseTo(70);
    expect(Velocity.y[shooter]).toBeCloseTo(0);
  });
});
