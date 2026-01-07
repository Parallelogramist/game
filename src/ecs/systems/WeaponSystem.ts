import { defineQuery, addEntity, addComponent, removeComponent, IWorld } from 'bitecs';
import {
  Transform,
  Velocity,
  Weapon,
  PlayerTag,
  EnemyTag,
  ProjectileTag,
  Projectile,
  SpriteRef,
} from '../components';
import { registerSprite, getSprite } from './SpriteSystem';

// Queries
const playerQuery = defineQuery([Transform, Weapon, PlayerTag]);
const enemyQuery = defineQuery([Transform, EnemyTag]);

// Reference to Phaser scene for creating projectile sprites
let sceneReference: Phaser.Scene | null = null;

// Projectile pooling to prevent unbounded entity growth
const projectilePool: number[] = [];
const MAX_POOL_SIZE = 200;

/**
 * Sets the Phaser scene reference for creating projectile visuals.
 * Must be called before weaponSystem runs.
 */
export function setWeaponSystemScene(scene: Phaser.Scene): void {
  sceneReference = scene;
}

/**
 * Returns a projectile to the pool for reuse.
 * Called instead of removeEntity when a projectile expires or hits.
 */
export function recycleProjectile(world: IWorld, entityId: number): void {
  // Remove ProjectileTag so it won't be queried anymore
  removeComponent(world, ProjectileTag, entityId);

  // Hide the sprite instead of destroying it
  const sprite = getSprite(entityId);
  if (sprite) {
    sprite.setVisible(false);
    sprite.setPosition(-1000, -1000); // Move off-screen
  }

  // Add to pool if not full
  if (projectilePool.length < MAX_POOL_SIZE) {
    projectilePool.push(entityId);
  }
}

/**
 * WeaponSystem handles automatic weapon firing.
 * Players auto-attack the nearest enemy within range.
 * Supports multishot (multiple projectiles with spread).
 */
export function weaponSystem(world: IWorld, gameTime: number): IWorld {
  if (!sceneReference) return world;

  const players = playerQuery(world);
  const enemies = enemyQuery(world);

  // No enemies to shoot at
  if (enemies.length === 0) return world;

  for (let i = 0; i < players.length; i++) {
    const playerId = players[i];

    const playerX = Transform.x[playerId];
    const playerY = Transform.y[playerId];
    const weaponRange = Weapon.range[playerId];
    const weaponCooldown = Weapon.cooldown[playerId];
    const lastFired = Weapon.lastFired[playerId];
    const projectileCount = Weapon.projectileCount[playerId] || 1;
    const piercing = Weapon.piercing[playerId] || 0;
    const projectileSpeed = Weapon.projectileSpeed[playerId] || 400;
    const damage = Weapon.damage[playerId];

    // Check if weapon is ready to fire
    if (gameTime - lastFired < weaponCooldown) continue;

    // Find nearest enemy within range
    let nearestEnemyId = -1;
    let nearestDistance = Infinity;

    for (let j = 0; j < enemies.length; j++) {
      const enemyId = enemies[j];
      const enemyX = Transform.x[enemyId];
      const enemyY = Transform.y[enemyId];

      const distanceX = enemyX - playerX;
      const distanceY = enemyY - playerY;
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

      if (distance < nearestDistance && distance <= weaponRange) {
        nearestDistance = distance;
        nearestEnemyId = enemyId;
      }
    }

    // No enemy in range
    if (nearestEnemyId === -1) continue;

    // Calculate base angle to target
    const targetX = Transform.x[nearestEnemyId];
    const targetY = Transform.y[nearestEnemyId];
    const baseAngle = Math.atan2(targetY - playerY, targetX - playerX);

    // Fire projectiles with spread
    const spreadAngle = Math.PI / 12; // 15 degrees spread between projectiles

    for (let p = 0; p < projectileCount; p++) {
      // Calculate spread offset
      let angleOffset = 0;
      if (projectileCount > 1) {
        // Center the spread around the target
        const totalSpread = spreadAngle * (projectileCount - 1);
        angleOffset = -totalSpread / 2 + spreadAngle * p;
      }

      const finalAngle = baseAngle + angleOffset;

      createProjectile(
        world,
        playerX,
        playerY,
        finalAngle,
        damage,
        projectileSpeed,
        piercing,
        playerId
      );
    }

    // Update last fired time
    Weapon.lastFired[playerId] = gameTime;
  }

  return world;
}

/**
 * Creates a projectile entity traveling in a given direction.
 * Uses object pooling to reuse entity IDs and sprites.
 */
function createProjectile(
  world: IWorld,
  originX: number,
  originY: number,
  angle: number,
  damage: number,
  speed: number,
  piercing: number,
  ownerId: number
): number {
  let projectileId: number;
  let isRecycled = false;

  // Try to reuse from pool first
  if (projectilePool.length > 0) {
    projectileId = projectilePool.pop()!;
    isRecycled = true;
    // Re-add ProjectileTag so it will be queried again
    addComponent(world, ProjectileTag, projectileId);
  } else {
    // Create new entity if pool is empty
    projectileId = addEntity(world);

    // Add components (only needed for new entities)
    addComponent(world, Transform, projectileId);
    addComponent(world, Velocity, projectileId);
    addComponent(world, ProjectileTag, projectileId);
    addComponent(world, Projectile, projectileId);
    addComponent(world, SpriteRef, projectileId);
  }

  // Calculate direction from angle
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);

  // Set transform
  Transform.x[projectileId] = originX;
  Transform.y[projectileId] = originY;
  Transform.rotation[projectileId] = angle;

  // Set velocity
  Velocity.x[projectileId] = directionX * speed;
  Velocity.y[projectileId] = directionY * speed;
  Velocity.speed[projectileId] = speed;

  // Set projectile data
  Projectile.damage[projectileId] = damage;
  Projectile.piercing[projectileId] = piercing;
  Projectile.lifetime[projectileId] = 2.0; // 2 seconds lifetime
  Projectile.ownerId[projectileId] = ownerId;

  // Handle sprite
  if (sceneReference) {
    const size = 6 + piercing * 2;
    const existingSprite = getSprite(projectileId);
    if (isRecycled && existingSprite) {
      // Reuse existing sprite - update size based on current piercing
      existingSprite.setPosition(originX, originY);
      existingSprite.setVisible(true);
      (existingSprite as Phaser.GameObjects.Arc).setRadius(size);
    } else {
      // Create new sprite
      const sprite = sceneReference.add.circle(originX, originY, size, 0xffff00);
      sprite.setStrokeStyle(1, 0xffffaa);
      registerSprite(projectileId, sprite);
    }
  }

  return projectileId;
}

/**
 * Resets all module-level state in WeaponSystem.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetWeaponSystem(): void {
  projectilePool.length = 0;
  sceneReference = null;
}
