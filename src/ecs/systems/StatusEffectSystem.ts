import { defineQuery, IWorld, hasComponent, addComponent } from 'bitecs';
import { EnemyTag, Health, StatusEffect, Transform } from '../components';
import { EffectsManager } from '../../effects/EffectsManager';

// Query for enemies with status effects
const statusEffectQuery = defineQuery([EnemyTag, Health, StatusEffect]);

// Scene reference for effects
let effectsManager: EffectsManager | null = null;

// Callback for enemy death
let onEnemyDeath: ((entityId: number, x: number, y: number) => void) | null = null;

// Constants
const BURN_TICK_INTERVAL = 500;   // ms between burn damage ticks
const POISON_TICK_INTERVAL = 400; // ms between poison damage ticks
const POISON_DAMAGE_PER_STACK = 3; // Damage per poison stack per tick

// Color constants for damage numbers
const BURN_COLOR = 0xff6622;   // Orange
const POISON_COLOR = 0x66ff66; // Green

/**
 * Sets the effects manager for visual feedback.
 */
export function setStatusEffectSystemEffectsManager(manager: EffectsManager): void {
  effectsManager = manager;
}

/**
 * Sets the callback for when an enemy dies from status effects.
 */
export function setStatusEffectSystemDeathCallback(
  callback: (entityId: number, x: number, y: number) => void
): void {
  onEnemyDeath = callback;
}

/**
 * Applies burn status to an enemy.
 * @param world - The ECS world
 * @param entityId - The enemy entity ID
 * @param damage - Damage per tick
 * @param duration - Total duration in ms
 * @param damageMultiplier - Multiplier from burn damage upgrade
 */
export function applyBurn(
  world: IWorld,
  entityId: number,
  damage: number,
  duration: number,
  damageMultiplier: number = 1.0
): void {
  // Ensure entity has StatusEffect component
  if (!hasComponent(world, StatusEffect, entityId)) {
    addComponent(world, StatusEffect, entityId);
  }

  // Apply or refresh burn - use highest damage, refresh duration
  const newDamage = damage * damageMultiplier;
  if (newDamage > StatusEffect.burnDamage[entityId]) {
    StatusEffect.burnDamage[entityId] = newDamage;
  }
  StatusEffect.burnDuration[entityId] = duration;
  // Reset tick timer if not already burning
  if (StatusEffect.burnTickTimer[entityId] <= 0) {
    StatusEffect.burnTickTimer[entityId] = BURN_TICK_INTERVAL;
  }
}

/**
 * Applies freeze status to an enemy.
 * @param world - The ECS world
 * @param entityId - The enemy entity ID
 * @param slowMultiplier - Speed multiplier (e.g., 0.5 = 50% slow)
 * @param duration - Duration in ms
 * @param durationMultiplier - Multiplier from freeze duration upgrade
 */
export function applyFreeze(
  world: IWorld,
  entityId: number,
  slowMultiplier: number,
  duration: number,
  durationMultiplier: number = 1.0
): void {
  // Ensure entity has StatusEffect component
  if (!hasComponent(world, StatusEffect, entityId)) {
    addComponent(world, StatusEffect, entityId);
  }

  // Apply or refresh freeze - use stronger slow, refresh duration
  const currentMultiplier = StatusEffect.freezeMultiplier[entityId];
  if (currentMultiplier === 0 || slowMultiplier < currentMultiplier) {
    StatusEffect.freezeMultiplier[entityId] = slowMultiplier;
  }
  StatusEffect.freezeDuration[entityId] = duration * durationMultiplier;
}

/**
 * Applies poison status to an enemy.
 * @param world - The ECS world
 * @param entityId - The enemy entity ID
 * @param stacks - Number of stacks to add
 * @param duration - Duration in ms
 * @param maxStacks - Maximum allowed stacks
 */
export function applyPoison(
  world: IWorld,
  entityId: number,
  stacks: number,
  duration: number,
  maxStacks: number = 10
): void {
  // Ensure entity has StatusEffect component
  if (!hasComponent(world, StatusEffect, entityId)) {
    addComponent(world, StatusEffect, entityId);
  }

  // Add stacks up to max
  const currentStacks = StatusEffect.poisonStacks[entityId];
  StatusEffect.poisonStacks[entityId] = Math.min(currentStacks + stacks, maxStacks);
  StatusEffect.poisonDuration[entityId] = duration;
  // Reset tick timer if not already poisoned
  if (StatusEffect.poisonTickTimer[entityId] <= 0) {
    StatusEffect.poisonTickTimer[entityId] = POISON_TICK_INTERVAL;
  }
}

/**
 * Sets chain lightning immunity on an enemy.
 * @param world - The ECS world
 * @param entityId - The enemy entity ID
 * @param duration - Immunity duration in ms
 */
export function setChainImmunity(
  world: IWorld,
  entityId: number,
  duration: number
): void {
  // Ensure entity has StatusEffect component
  if (!hasComponent(world, StatusEffect, entityId)) {
    addComponent(world, StatusEffect, entityId);
  }
  StatusEffect.chainImmunity[entityId] = duration;
}

/**
 * Checks if an enemy can be chained to.
 */
export function canChainTo(world: IWorld, entityId: number): boolean {
  if (!hasComponent(world, StatusEffect, entityId)) {
    return true;
  }
  return StatusEffect.chainImmunity[entityId] <= 0;
}

/**
 * Gets the freeze slow multiplier for an enemy.
 * Returns 1.0 if not frozen.
 */
export function getFreezeMultiplier(world: IWorld, entityId: number): number {
  if (!hasComponent(world, StatusEffect, entityId)) {
    return 1.0;
  }
  const multiplier = StatusEffect.freezeMultiplier[entityId];
  return multiplier > 0 ? multiplier : 1.0;
}

/**
 * StatusEffectSystem processes status effects on enemies each frame.
 * - Burns deal damage over time
 * - Freezes slow movement (handled in EnemyAISystem)
 * - Poisons deal stacking damage over time
 */
export function statusEffectSystem(world: IWorld, deltaMs: number): IWorld {
  const entities = statusEffectQuery(world);
  const enemiesToKill: number[] = [];

  for (let i = 0; i < entities.length; i++) {
    const entityId = entities[i];
    const x = Transform.x[entityId];
    const y = Transform.y[entityId];

    // Process burn effect
    if (StatusEffect.burnDuration[entityId] > 0) {
      StatusEffect.burnDuration[entityId] -= deltaMs;
      StatusEffect.burnTickTimer[entityId] -= deltaMs;

      // Apply burn damage on tick
      if (StatusEffect.burnTickTimer[entityId] <= 0) {
        const burnDamage = StatusEffect.burnDamage[entityId];
        Health.current[entityId] -= burnDamage;
        StatusEffect.burnTickTimer[entityId] = BURN_TICK_INTERVAL;

        // Show damage number
        if (effectsManager) {
          effectsManager.showDamageNumber(x, y - 20, Math.round(burnDamage), BURN_COLOR);
        }
      }

      // Clear burn when expired
      if (StatusEffect.burnDuration[entityId] <= 0) {
        StatusEffect.burnDamage[entityId] = 0;
        StatusEffect.burnTickTimer[entityId] = 0;
      }
    }

    // Process freeze effect (just duration - actual slow applied in EnemyAISystem)
    if (StatusEffect.freezeDuration[entityId] > 0) {
      StatusEffect.freezeDuration[entityId] -= deltaMs;

      // Clear freeze when expired
      if (StatusEffect.freezeDuration[entityId] <= 0) {
        StatusEffect.freezeMultiplier[entityId] = 0;
      }
    }

    // Process poison effect
    if (StatusEffect.poisonStacks[entityId] > 0 && StatusEffect.poisonDuration[entityId] > 0) {
      StatusEffect.poisonDuration[entityId] -= deltaMs;
      StatusEffect.poisonTickTimer[entityId] -= deltaMs;

      // Apply poison damage on tick
      if (StatusEffect.poisonTickTimer[entityId] <= 0) {
        const stacks = StatusEffect.poisonStacks[entityId];
        const poisonDamage = stacks * POISON_DAMAGE_PER_STACK;
        Health.current[entityId] -= poisonDamage;
        StatusEffect.poisonTickTimer[entityId] = POISON_TICK_INTERVAL;

        // Show damage number
        if (effectsManager) {
          effectsManager.showDamageNumber(x, y - 20, Math.round(poisonDamage), POISON_COLOR);
        }
      }

      // Clear poison when expired
      if (StatusEffect.poisonDuration[entityId] <= 0) {
        StatusEffect.poisonStacks[entityId] = 0;
        StatusEffect.poisonTickTimer[entityId] = 0;
      }
    }

    // Process chain immunity countdown
    if (StatusEffect.chainImmunity[entityId] > 0) {
      StatusEffect.chainImmunity[entityId] -= deltaMs;
    }

    // Check if enemy died from status effects
    if (Health.current[entityId] <= 0) {
      enemiesToKill.push(entityId);
    }
  }

  // Process deaths
  for (const entityId of enemiesToKill) {
    if (onEnemyDeath) {
      const x = Transform.x[entityId];
      const y = Transform.y[entityId];
      onEnemyDeath(entityId, x, y);
    }
  }

  return world;
}
