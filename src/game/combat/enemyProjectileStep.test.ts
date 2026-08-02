import { describe, expect, test } from 'vitest';
import {
  stepEnemyProjectile,
  type EnemyProjectileState,
  type EnemyProjectileStepWorld,
} from './enemyProjectileStep';

function projectileAt(x: number, y: number, vx = 0, vy = 0, lifetime = 4): EnemyProjectileState {
  return { x, y, vx, vy, damage: 5, lifetime };
}

function openWorld(overrides: Partial<EnemyProjectileStepWorld> = {}): EnemyProjectileStepWorld {
  return {
    despawnRect: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
    isBlocked: () => false,
    playerPosition: null,
    escortDronePosition: null,
    ...overrides,
  };
}

describe('stepEnemyProjectile', () => {
  test('spends the TTL before moving, so an expiring shot never travels a last step', () => {
    const projectile = projectileAt(0, 0, 600, 0, 0.05);

    expect(stepEnemyProjectile(projectile, 0.1, openWorld())).toBe('expired');
    expect(projectile.x).toBe(0);
  });

  test('leaving the despawn rect short-circuits the world query', () => {
    let tileReads = 0;
    const world = openWorld({
      despawnRect: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
      isBlocked: () => { tileReads++; return true; },
    });

    expect(stepEnemyProjectile(projectileAt(0, 0, 600, 0), 0.1, world)).toBe('despawned');
    expect(tileReads).toBe(0);
  });

  test('a shot overlapping both the player and the drone hits the player', () => {
    const world = openWorld({
      playerPosition: { x: 100, y: 0 },
      escortDronePosition: { x: 100, y: 0 },
    });

    expect(stepEnemyProjectile(projectileAt(90, 0, 100, 0), 0.1, world)).toBe('hitPlayer');
  });

  test('a live shot in the open advances by velocity * delta and stays alive', () => {
    const projectile = projectileAt(0, 0, 300, -150);

    expect(stepEnemyProjectile(projectile, 0.1, openWorld())).toBe('alive');
    expect(projectile.x).toBeCloseTo(30);
    expect(projectile.y).toBeCloseTo(-15);
    expect(projectile.lifetime).toBeCloseTo(3.9);
  });
});
