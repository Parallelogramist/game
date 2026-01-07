import { defineQuery, removeEntity, IWorld, hasComponent } from 'bitecs';
import {
  Transform,
  Health,
  EnemyTag,
  ProjectileTag,
  Projectile,
  Knockback,
} from '../components';
import { getSprite, unregisterSprite } from './SpriteSystem';
import { EffectsManager } from '../../effects/EffectsManager';
import { SoundManager } from '../../audio/SoundManager';
import { recycleProjectile } from './WeaponSystem';
import { applyBurn, applyFreeze, applyPoison, getFreezeMultiplier } from './StatusEffectSystem';
import { getEnemySpatialHash } from '../../utils/SpatialHash';

/**
 * Combat stats from player that affect collision/damage.
 */
export interface CombatStats {
  critChance: number;
  critDamage: number;
  burnChance: number;
  burnDamageMultiplier: number;
  freezeChance: number;
  freezeDurationMultiplier: number;
  poisonChance: number;
  poisonMaxStacks: number;
  chainLightningChance: number;
  lifeStealPercent: number;
  // Advanced mechanics
  executionBonus: number;      // Extra damage to enemies below 25% HP
  overkillSplash: number;      // Percent of overkill damage splashed to nearby
  armorPenetration: number;    // Ignore enemy armor percentage
  knockbackMultiplier: number; // Knockback force multiplier
  shatterBonus: number;        // Bonus damage to frozen enemies
}

// Queries
const projectileQuery = defineQuery([Transform, ProjectileTag, Projectile]);
// Note: enemyQuery removed - now using spatial hash populated by FrameCache

// Collision radius for entities
const PROJECTILE_RADIUS = 6;
const ENEMY_RADIUS = 12;

// Knockback settings
const KNOCKBACK_MAGNITUDE = 150; // Initial velocity in pixels/second

// Callback for when an enemy dies (to spawn XP, update count, etc.)
type EnemyDeathCallback = (
  entityId: number,
  positionX: number,
  positionY: number
) => void;

let onEnemyDeathCallback: EnemyDeathCallback | null = null;

// Effects and sound managers (set from GameScene)
let effectsManager: EffectsManager | null = null;
let soundManager: SoundManager | null = null;

// Scene reference for Phaser timers (prevents setTimeout callback accumulation)
let sceneReference: Phaser.Scene | null = null;

// Combat stats from player (elemental chances, crit, etc.)
let combatStats: CombatStats | null = null;

// Callback for life steal healing
let lifeStealCallback: ((amount: number) => void) | null = null;

/**
 * Register a callback to be called when an enemy dies.
 */
export function setEnemyDeathCallback(callback: EnemyDeathCallback): void {
  onEnemyDeathCallback = callback;
}

/**
 * Set the effects manager for visual feedback.
 */
export function setEffectsManager(manager: EffectsManager): void {
  effectsManager = manager;
}

/**
 * Set the sound manager for audio feedback.
 */
export function setSoundManager(manager: SoundManager): void {
  soundManager = manager;
}

/**
 * Set the Phaser scene reference for timers.
 */
export function setCollisionSystemScene(scene: Phaser.Scene): void {
  sceneReference = scene;
}

/**
 * Set combat stats (crit, elemental chances) from player.
 */
export function setCombatStats(stats: CombatStats): void {
  combatStats = stats;
}

/**
 * Get the current combat stats (for use by WeaponManager).
 */
export function getCombatStats(): CombatStats | null {
  return combatStats;
}

/**
 * Set callback for life steal healing.
 */
export function setLifeStealCallback(callback: (amount: number) => void): void {
  lifeStealCallback = callback;
}

/**
 * CollisionSystem handles projectile-enemy collisions.
 * Applies damage and removes dead entities.
 *
 * PERFORMANCE: Uses spatial hashing for O(n) collision detection instead of O(n²).
 * The spatial hash is populated once per frame in GameScene.
 */
export function collisionSystem(world: IWorld, deltaTime: number): IWorld {
  const projectiles = projectileQuery(world);
  const spatialHash = getEnemySpatialHash();

  // Track projectiles and enemies to remove (avoid modifying during iteration)
  // Using Sets for O(1) lookup instead of arrays with O(n) .includes()
  const projectilesToRemove = new Set<number>();
  const enemiesToRemove = new Set<number>();

  // Collision radius for spatial query (projectile + enemy + small buffer)
  const queryRadius = PROJECTILE_RADIUS + ENEMY_RADIUS + 5;

  // Check each projectile against nearby enemies only (spatial hash query)
  for (let i = 0; i < projectiles.length; i++) {
    const projectileId = projectiles[i];

    // Update projectile lifetime
    Projectile.lifetime[projectileId] -= deltaTime;

    // Remove expired projectiles
    if (Projectile.lifetime[projectileId] <= 0) {
      projectilesToRemove.add(projectileId);
      continue;
    }

    const projectileX = Transform.x[projectileId];
    const projectileY = Transform.y[projectileId];
    const projectileDamage = Projectile.damage[projectileId];
    const piercing = Projectile.piercing[projectileId];

    let hitCount = 0;

    // Query spatial hash for nearby enemies instead of checking all enemies
    const nearbyEnemies = spatialHash.queryPotential(projectileX, projectileY, queryRadius);

    for (let j = 0; j < nearbyEnemies.length; j++) {
      const enemyId = nearbyEnemies[j].id;

      // Skip if enemy is already marked for removal (O(1) Set lookup)
      if (enemiesToRemove.has(enemyId)) continue;

      const enemyX = Transform.x[enemyId];
      const enemyY = Transform.y[enemyId];

      // Simple circle collision
      const distanceX = projectileX - enemyX;
      const distanceY = projectileY - enemyY;
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;
      const collisionDistance = PROJECTILE_RADIUS + ENEMY_RADIUS;

      if (distanceSquared < collisionDistance * collisionDistance) {
        // Calculate actual damage (with crit and variance)
        let actualDamage = projectileDamage;
        let isCrit = false;
        let isPerfectCrit = false;
        if (combatStats && combatStats.critChance > 0 && Math.random() < combatStats.critChance) {
          // Crit with 80-100% variance (±20% of crit damage)
          const critVariance = 0.8 + Math.random() * 0.2;
          actualDamage *= combatStats.critDamage * critVariance;
          isCrit = true;
          // Perfect crit: top 1% of damage roll (variance >= 0.99)
          isPerfectCrit = critVariance >= 0.99;
        }

        // ═══ EXECUTION BONUS (extra damage to low HP enemies) ═══
        if (combatStats && combatStats.executionBonus > 0) {
          const enemyHPPercent = Health.current[enemyId] / Health.max[enemyId];
          if (enemyHPPercent < 0.25) {
            actualDamage *= (1 + combatStats.executionBonus);
          }
        }

        // ═══ SHATTER BONUS (extra damage to frozen enemies) ═══
        if (combatStats && combatStats.shatterBonus > 0) {
          const freezeMult = getFreezeMultiplier(world, enemyId);
          // freezeMult < 1 means enemy is frozen (slowed)
          if (freezeMult < 1) {
            actualDamage *= (1 + combatStats.shatterBonus);
          }
        }

        // Store HP before damage for overkill calculation
        const hpBeforeDamage = Health.current[enemyId];

        // Apply damage
        Health.current[enemyId] -= actualDamage;
        hitCount++;

        // Calculate hit direction (from projectile to enemy)
        const distance = Math.sqrt(distanceSquared);
        const dirX = distance > 0 ? (enemyX - projectileX) / distance : 0;
        const dirY = distance > 0 ? (enemyY - projectileY) / distance : 1;

        // Apply knockback (push enemy away from projectile) with multiplier
        if (hasComponent(world, Knockback, enemyId)) {
          const knockbackMult = combatStats?.knockbackMultiplier ?? 1;
          Knockback.velocityX[enemyId] += dirX * KNOCKBACK_MAGNITUDE * knockbackMult;
          Knockback.velocityY[enemyId] += dirY * KNOCKBACK_MAGNITUDE * knockbackMult;
        }

        // Apply elemental status effects based on player's chances
        if (combatStats) {
          // Burn effect
          if (combatStats.burnChance > 0 && Math.random() < combatStats.burnChance) {
            applyBurn(world, enemyId, actualDamage * 0.2, 3000, combatStats.burnDamageMultiplier);
          }
          // Freeze effect
          if (combatStats.freezeChance > 0 && Math.random() < combatStats.freezeChance) {
            applyFreeze(world, enemyId, 0.5, 2000, combatStats.freezeDurationMultiplier);
          }
          // Poison effect
          if (combatStats.poisonChance > 0 && Math.random() < combatStats.poisonChance) {
            applyPoison(world, enemyId, 1, 4000, combatStats.poisonMaxStacks);
          }
          // Life steal
          if (combatStats.lifeStealPercent > 0 && lifeStealCallback) {
            lifeStealCallback(actualDamage * combatStats.lifeStealPercent);
          }
        }

        // Show damage number (gold for perfect crit, yellow for crit, white for normal)
        if (effectsManager) {
          const damageColor = isPerfectCrit ? 0xffd700 : (isCrit ? 0xffff00 : 0xffffff);
          effectsManager.showDamageNumber(enemyX, enemyY - 10, actualDamage, damageColor, isCrit, isPerfectCrit);
          // Play hit sparks (opposite direction - sparks fly back toward projectile)
          const sparkAngle = Math.atan2(-dirY, -dirX);
          effectsManager.playHitSparks(enemyX, enemyY, sparkAngle);
        }

        // Play hit sound
        if (soundManager) {
          soundManager.playHit();
        }

        // Flash enemy white briefly (visual feedback)
        const enemySprite = getSprite(enemyId);
        if (enemySprite && 'setFillStyle' in enemySprite && sceneReference) {
          const rectangle = enemySprite as Phaser.GameObjects.Rectangle;
          rectangle.setFillStyle(0xffffff); // Flash white
          // Reset color after short delay (using Phaser timer to avoid callback accumulation)
          sceneReference.time.delayedCall(50, () => {
            if (hasComponent(world, EnemyTag, enemyId)) {
              rectangle.setFillStyle(0xff4444);
            }
          });
        }

        // Check if enemy died
        if (Health.current[enemyId] <= 0) {
          enemiesToRemove.add(enemyId);

          // ═══ OVERKILL SPLASH DAMAGE ═══
          if (combatStats && combatStats.overkillSplash > 0) {
            const overkillDamage = actualDamage - hpBeforeDamage;
            if (overkillDamage > 0) {
              const splashDamage = overkillDamage * combatStats.overkillSplash;
              const splashRadius = 80; // Splash radius in pixels

              // Use spatial hash to find nearby enemies (O(1) instead of O(n))
              const splashTargets = spatialHash.query(enemyX, enemyY, splashRadius);

              for (const target of splashTargets) {
                const nearbyId = target.id;
                if (nearbyId === enemyId || enemiesToRemove.has(nearbyId)) continue;

                const nearbyX = Transform.x[nearbyId];
                const nearbyY = Transform.y[nearbyId];

                Health.current[nearbyId] -= splashDamage;

                // Show splash damage number
                if (effectsManager) {
                  effectsManager.showDamageNumber(nearbyX, nearbyY - 10, splashDamage, 0xff8800);
                }

                // Check if splash killed the enemy
                if (Health.current[nearbyId] <= 0) {
                  enemiesToRemove.add(nearbyId);
                  if (effectsManager) {
                    effectsManager.playDeathBurst(nearbyX, nearbyY);
                  }
                  if (onEnemyDeathCallback) {
                    onEnemyDeathCallback(nearbyId, nearbyX, nearbyY);
                  }
                }
              }
            }
          }

          // Play death burst particles
          if (effectsManager) {
            effectsManager.playDeathBurst(enemyX, enemyY);
          }

          // Trigger death callback
          if (onEnemyDeathCallback) {
            onEnemyDeathCallback(enemyId, enemyX, enemyY);
          }
        }

        // Non-piercing projectiles are removed on first hit
        if (piercing <= 0) {
          projectilesToRemove.add(projectileId);
          break;
        }

        // Piercing projectiles can hit multiple enemies
        if (hitCount > piercing) {
          projectilesToRemove.add(projectileId);
          break;
        }
      }
    }
  }

  // Remove dead enemies
  for (const enemyId of enemiesToRemove) {
    removeEntityWithSprite(world, enemyId);
  }

  // Recycle spent projectiles (pooled for reuse)
  for (const projectileId of projectilesToRemove) {
    recycleProjectile(world, projectileId);
  }

  return world;
}

/**
 * Removes an entity and its associated sprite.
 */
function removeEntityWithSprite(world: IWorld, entityId: number): void {
  // Destroy the Phaser sprite
  const sprite = getSprite(entityId);
  if (sprite) {
    sprite.destroy();
    unregisterSprite(entityId);
  }

  // Remove from ECS world
  removeEntity(world, entityId);
}

/**
 * Checks if projectile is off-screen and should be removed.
 */
export function cleanupOffscreenProjectiles(
  world: IWorld,
  screenWidth: number,
  screenHeight: number,
  margin: number = 50
): void {
  const projectiles = projectileQuery(world);

  for (const projectileId of projectiles) {
    const positionX = Transform.x[projectileId];
    const positionY = Transform.y[projectileId];

    if (
      positionX < -margin ||
      positionX > screenWidth + margin ||
      positionY < -margin ||
      positionY > screenHeight + margin
    ) {
      recycleProjectile(world, projectileId);
    }
  }
}

/**
 * Resets all module-level state in CollisionSystem.
 * Must be called when starting a new game to clear state from previous runs.
 */
export function resetCollisionSystem(): void {
  onEnemyDeathCallback = null;
  effectsManager = null;
  soundManager = null;
  sceneReference = null;
}
