/**
 * The pure half of enemy fire: one projectile's TTL, motion and hit tests, with no Phaser and no
 * scene. `EnemyProjectileManager` beside this file owns the sprite and reacts to the outcome.
 */

export interface EnemyProjectileState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  lifetime: number;
}

export interface EnemyProjectileStepWorld {
  despawnRect: { minX: number; minY: number; maxX: number; maxY: number };
  isBlocked: (x: number, y: number) => boolean;
  playerPosition: { x: number; y: number } | null;
  escortDronePosition: { x: number; y: number } | null;
}

export type EnemyProjectileStepOutcome =
  | 'alive'
  | 'expired'
  | 'despawned'
  | 'blocked'
  | 'hitPlayer'
  | 'hitEscortDrone';

export const ENEMY_PROJECTILE_PLAYER_HIT_RADIUS = 20;

/** The player's own projectile hit radius, borrowed so a shot lands on the escort drone the way
 *  it lands on you (FEAT-DECOY-RANGED-INTEREST). */
export const ENEMY_PROJECTILE_ESCORT_DRONE_HIT_RADIUS = 20;

const PLAYER_HIT_RADIUS_SQUARED =
  ENEMY_PROJECTILE_PLAYER_HIT_RADIUS * ENEMY_PROJECTILE_PLAYER_HIT_RADIUS;
const ESCORT_DRONE_HIT_RADIUS_SQUARED =
  ENEMY_PROJECTILE_ESCORT_DRONE_HIT_RADIUS * ENEMY_PROJECTILE_ESCORT_DRONE_HIT_RADIUS;

/**
 * Advances `projectile` in place by one frame and reports what became of it. The order is the one
 * GameScene has always used and it is load-bearing: the TTL is spent before the move, so an
 * expiring shot never travels a last step; the despawn rect is tested before the world, so a shot
 * leaving the view costs no tile read; and the player is tested before the escort drone, so a shot
 * overlapping both hits you.
 */
export function stepEnemyProjectile(
  projectile: EnemyProjectileState,
  deltaTime: number,
  world: EnemyProjectileStepWorld
): EnemyProjectileStepOutcome {
  projectile.lifetime -= deltaTime;
  if (projectile.lifetime <= 0) return 'expired';

  projectile.x += projectile.vx * deltaTime;
  projectile.y += projectile.vy * deltaTime;

  const { despawnRect } = world;
  if (projectile.x < despawnRect.minX || projectile.x > despawnRect.maxX ||
      projectile.y < despawnRect.minY || projectile.y > despawnRect.maxY) {
    return 'despawned';
  }

  if (world.isBlocked(projectile.x, projectile.y)) return 'blocked';

  const player = world.playerPosition;
  if (player) {
    const playerDx = player.x - projectile.x;
    const playerDy = player.y - projectile.y;
    if (playerDx * playerDx + playerDy * playerDy < PLAYER_HIT_RADIUS_SQUARED) return 'hitPlayer';
  }

  const escortDrone = world.escortDronePosition;
  if (escortDrone) {
    const droneDx = escortDrone.x - projectile.x;
    const droneDy = escortDrone.y - projectile.y;
    if (droneDx * droneDx + droneDy * droneDy < ESCORT_DRONE_HIT_RADIUS_SQUARED) {
      return 'hitEscortDrone';
    }
  }

  return 'alive';
}
