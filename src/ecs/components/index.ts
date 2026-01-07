import { defineComponent, Types } from 'bitecs';

// Transform component - position and rotation
export const Transform = defineComponent({
  x: Types.f32,
  y: Types.f32,
  rotation: Types.f32,
});

// Velocity component - movement vector and speed
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
  speed: Types.f32,
});

// Health component - current and max HP
export const Health = defineComponent({
  current: Types.f32,
  max: Types.f32,
});

// Tag components - identify entity types
export const PlayerTag = defineComponent();
export const EnemyTag = defineComponent();
export const ProjectileTag = defineComponent();
export const XPGemTag = defineComponent();
export const HealthPickupTag = defineComponent();
export const MagnetPickupTag = defineComponent();

// Health pickup component
export const HealthPickup = defineComponent({
  healAmount: Types.f32,
  magnetized: Types.ui8,
});

// Magnet pickup component - attracts all XP gems when collected
export const MagnetPickup = defineComponent({
  magnetized: Types.ui8,
});

// Weapon component - player's weapon stats
export const Weapon = defineComponent({
  damage: Types.f32,
  cooldown: Types.f32,
  lastFired: Types.f32,
  range: Types.f32,
  projectileCount: Types.ui8,  // Number of projectiles per shot
  piercing: Types.ui8,         // How many enemies projectiles can pass through
  projectileSpeed: Types.f32,  // Speed of projectiles
});

// Projectile component - projectile-specific data
export const Projectile = defineComponent({
  damage: Types.f32,
  piercing: Types.i8,
  lifetime: Types.f32,
  ownerId: Types.ui32,
});

// XP Gem component
export const XPGem = defineComponent({
  value: Types.ui32,
  magnetized: Types.ui8,
});

// Sprite reference - links ECS entity to Phaser sprite
export const SpriteRef = defineComponent({
  id: Types.ui32,
});

// Enemy AI component - handles behavior state
export const EnemyAI = defineComponent({
  aiType: Types.ui8,     // EnemyAIType enum value
  state: Types.ui8,      // Current behavior state
  timer: Types.f32,      // State timer
  targetX: Types.f32,    // Target position X (for various behaviors)
  targetY: Types.f32,    // Target position Y
  shootTimer: Types.f32, // Shooting cooldown timer
  specialTimer: Types.f32, // Special ability timer (heal, teleport, etc.)
  phase: Types.f32,      // Phase for patterns (zigzag, circle, etc.)
});

// Enemy type component - stores type info for special handling
export const EnemyType = defineComponent({
  typeId: Types.ui8,        // Index into enemy type array
  baseHealth: Types.f32,    // Original health (for scaling)
  baseDamage: Types.f32,    // Original damage
  xpValue: Types.ui16,      // XP dropped on death (ui16 supports boss values up to 65535)
  size: Types.f32,          // Visual size multiplier (0.5-6.0) for grid warping weight
  // Shield properties
  shieldCurrent: Types.f32, // Current shield HP (0 if no shield)
  shieldMax: Types.f32,     // Max shield HP
  shieldRegenTimer: Types.f32, // Time until shield starts regenerating
  // Special flags encoded as bits
  flags: Types.ui8,         // Bit flags for special abilities
});

// Enemy flags (bit positions)
export const EnemyFlags = {
  EXPLODES_ON_DEATH: 1 << 0,
  SPLITS_ON_DEATH: 1 << 1,
  CAN_SHOOT: 1 << 2,
  HEALS_ALLIES: 1 << 3,
  HAS_SHIELD: 1 << 4,
  NO_TRAIL: 1 << 5,
} as const;

// Knockback component - for pushback effect on hit
export const Knockback = defineComponent({
  velocityX: Types.f32,  // Current knockback velocity X
  velocityY: Types.f32,  // Current knockback velocity Y
  decay: Types.f32,      // How fast knockback decays (0.001 = fast)
});

// Status effects component - tracks elemental status effects on enemies
export const StatusEffect = defineComponent({
  // Burn effect - damage over time
  burnDamage: Types.f32,       // Damage per tick
  burnDuration: Types.f32,     // Remaining duration in ms
  burnTickTimer: Types.f32,    // Time until next tick
  // Freeze effect - slows movement
  freezeMultiplier: Types.f32, // Speed multiplier (0.5 = 50% slow)
  freezeDuration: Types.f32,   // Remaining duration in ms
  // Poison effect - stacking damage over time
  poisonStacks: Types.i8,      // Number of poison stacks (max 10)
  poisonDuration: Types.f32,   // Remaining duration in ms
  poisonTickTimer: Types.f32,  // Time until next poison tick
  // Chain lightning marker - prevents re-chaining to same target
  chainImmunity: Types.f32,    // Duration of chain immunity
});
