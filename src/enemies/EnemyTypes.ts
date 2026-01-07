/**
 * Enemy AI behavior types.
 */
export enum EnemyAIType {
  Chase = 0,        // Basic chase directly toward player
  Zigzag = 1,       // Chase with zigzag pattern
  Dash = 2,         // Pause then dash at player
  Circle = 3,       // Strafe around player at distance
  Swarm = 4,        // Very fast, simple chase (tiny enemies)
  Tank = 5,         // Slow, steady approach
  Exploder = 6,     // Fast chase, explodes on death
  Splitter = 7,     // Medium chase, splits on death
  Shooter = 8,      // Keep distance, shoot at player
  Sniper = 9,       // Stay at edge, accurate shots
  Healer = 10,      // Avoid player, heal nearby enemies
  Shielded = 11,    // Normal chase with shield mechanic
  Teleporter = 12,  // Blink around near player
  Giant = 13,       // Slow approach, area attacks
  // Minibosses
  Glutton = 50,     // Seek XP gems, grow stronger
  SwarmMother = 51, // Spawn small enemies
  Charger = 52,     // Charge across screen
  Necromancer = 53, // Revive dead enemies
  TwinA = 54,       // Twin A (linked)
  TwinB = 55,       // Twin B (linked)
  // Bosses
  HordeKing = 100,
  VoidWyrm = 101,
  TheMachine = 102,
}

/**
 * Enemy category for spawn timing and behavior.
 */
export enum EnemyCategory {
  Basic = 'basic',
  Elite = 'elite',
  Miniboss = 'miniboss',
  Boss = 'boss',
}

/**
 * Enemy type definition with all properties.
 */
export interface EnemyTypeDefinition {
  id: string;
  name: string;
  aiType: EnemyAIType;
  category: EnemyCategory;

  // Base stats (scaled with game time)
  baseHealth: number;
  baseSpeed: number;
  baseDamage: number;

  // Size and visuals
  size: number;           // Radius multiplier
  color: number;          // Primary color
  secondaryColor?: number; // Outline/secondary color
  shape: 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon';

  // XP reward
  xpValue: number;

  // Special properties
  canShoot?: boolean;
  shootCooldown?: number;
  projectileSpeed?: number;
  projectileDamage?: number;

  explodeOnDeath?: boolean;
  explosionRadius?: number;
  explosionDamage?: number;

  splitsOnDeath?: boolean;
  splitCount?: number;
  splitType?: string;

  hasShield?: boolean;
  shieldHealth?: number;
  shieldRegenDelay?: number;

  healsAllies?: boolean;
  healRadius?: number;
  healAmount?: number;

  // Spawn timing (game time in seconds when they start appearing)
  minSpawnTime: number;
  spawnWeight: number;    // Higher = more common
}

/**
 * All enemy type definitions.
 */
export const ENEMY_TYPES: Record<string, EnemyTypeDefinition> = {
  // Basic enemies (spawn from start)
  basic: {
    id: 'basic',
    name: 'Shambler',
    aiType: EnemyAIType.Chase,
    category: EnemyCategory.Basic,
    baseHealth: 15,
    baseSpeed: 70,
    baseDamage: 10,
    size: 1,
    color: 0xff6666,         // Weak - light red
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 1,
    minSpawnTime: 0,
    spawnWeight: 100,
  },

  zigzag: {
    id: 'zigzag',
    name: 'Zigzag Runner',
    aiType: EnemyAIType.Zigzag,
    category: EnemyCategory.Basic,
    baseHealth: 12,
    baseSpeed: 90,
    baseDamage: 8,
    size: 0.9,
    color: 0xff6666,         // Weak - light red
    secondaryColor: 0xffffff, // White outline
    shape: 'triangle',
    xpValue: 1,
    minSpawnTime: 30,
    spawnWeight: 60,
  },

  dasher: {
    id: 'dasher',
    name: 'Dasher',
    aiType: EnemyAIType.Dash,
    category: EnemyCategory.Basic,
    baseHealth: 18,
    baseSpeed: 50,  // Base speed (slow), but dashes are fast
    baseDamage: 15,
    size: 1.1,
    color: 0xff4444,         // Standard - medium red
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 2,
    minSpawnTime: 60,
    spawnWeight: 40,
  },

  circler: {
    id: 'circler',
    name: 'Circler',
    aiType: EnemyAIType.Circle,
    category: EnemyCategory.Basic,
    baseHealth: 14,
    baseSpeed: 100,
    baseDamage: 8,
    size: 0.85,
    color: 0xff4444,         // Standard - medium red
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 2,
    minSpawnTime: 90,
    spawnWeight: 35,
  },

  swarm: {
    id: 'swarm',
    name: 'Tiny Swarm',
    aiType: EnemyAIType.Swarm,
    category: EnemyCategory.Basic,
    baseHealth: 5,
    baseSpeed: 130,
    baseDamage: 5,
    size: 0.5,
    color: 0xff6666,         // Weak - light red
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 1,
    minSpawnTime: 45,
    spawnWeight: 80,
  },

  // Elite enemies
  tank: {
    id: 'tank',
    name: 'Tank',
    aiType: EnemyAIType.Tank,
    category: EnemyCategory.Elite,
    baseHealth: 80,
    baseSpeed: 35,
    baseDamage: 25,
    size: 2,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 5,
    minSpawnTime: 120,
    spawnWeight: 15,
  },

  exploder: {
    id: 'exploder',
    name: 'Exploder',
    aiType: EnemyAIType.Exploder,
    category: EnemyCategory.Basic,
    baseHealth: 10,
    baseSpeed: 110,
    baseDamage: 8,
    size: 0.9,
    color: 0xff4444,         // Standard - medium red
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 2,
    explodeOnDeath: true,
    explosionRadius: 60,
    explosionDamage: 20,
    minSpawnTime: 90,
    spawnWeight: 30,
  },

  splitter: {
    id: 'splitter',
    name: 'Splitter',
    aiType: EnemyAIType.Splitter,
    category: EnemyCategory.Elite,
    baseHealth: 40,
    baseSpeed: 60,
    baseDamage: 12,
    size: 1.4,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'hexagon',
    xpValue: 3,
    splitsOnDeath: true,
    splitCount: 2,
    splitType: 'splitter_mini',
    minSpawnTime: 150,
    spawnWeight: 20,
  },

  splitter_mini: {
    id: 'splitter_mini',
    name: 'Splitter Mini',
    aiType: EnemyAIType.Chase,
    category: EnemyCategory.Basic,
    baseHealth: 15,
    baseSpeed: 85,
    baseDamage: 8,
    size: 0.8,
    color: 0xff6666,         // Weak - light red
    secondaryColor: 0xffffff, // White outline
    shape: 'hexagon',
    xpValue: 1,
    minSpawnTime: 999, // Never spawns naturally
    spawnWeight: 0,
  },

  shooter: {
    id: 'shooter',
    name: 'Shooter',
    aiType: EnemyAIType.Shooter,
    category: EnemyCategory.Elite,
    baseHealth: 25,
    baseSpeed: 45,
    baseDamage: 5,
    size: 1.1,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 3,
    canShoot: true,
    shootCooldown: 2.0,
    projectileSpeed: 200,
    projectileDamage: 12,
    minSpawnTime: 180,
    spawnWeight: 18,
  },

  sniper: {
    id: 'sniper',
    name: 'Sniper',
    aiType: EnemyAIType.Sniper,
    category: EnemyCategory.Elite,
    baseHealth: 15,
    baseSpeed: 20,
    baseDamage: 5,
    size: 0.9,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'triangle',
    xpValue: 4,
    canShoot: true,
    shootCooldown: 3.0,
    projectileSpeed: 400,
    projectileDamage: 20,
    minSpawnTime: 240,
    spawnWeight: 12,
  },

  healer: {
    id: 'healer',
    name: 'Healer',
    aiType: EnemyAIType.Healer,
    category: EnemyCategory.Elite,
    baseHealth: 20,
    baseSpeed: 80,
    baseDamage: 5,
    size: 1,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 4,
    healsAllies: true,
    healRadius: 100,
    healAmount: 5,
    minSpawnTime: 210,
    spawnWeight: 10,
  },

  shielded: {
    id: 'shielded',
    name: 'Shielded',
    aiType: EnemyAIType.Shielded,
    category: EnemyCategory.Elite,
    baseHealth: 30,
    baseSpeed: 55,
    baseDamage: 15,
    size: 1.2,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 4,
    hasShield: true,
    shieldHealth: 30,
    shieldRegenDelay: 5.0,
    minSpawnTime: 180,
    spawnWeight: 15,
  },

  teleporter: {
    id: 'teleporter',
    name: 'Teleporter',
    aiType: EnemyAIType.Teleporter,
    category: EnemyCategory.Elite,
    baseHealth: 18,
    baseSpeed: 60,
    baseDamage: 12,
    size: 0.9,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 4,
    minSpawnTime: 240,
    spawnWeight: 12,
  },

  giant: {
    id: 'giant',
    name: 'Giant',
    aiType: EnemyAIType.Giant,
    category: EnemyCategory.Elite,
    baseHealth: 200,
    baseSpeed: 25,
    baseDamage: 40,
    size: 3,
    color: 0xdd2222,         // Elite - darker red
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 10,
    minSpawnTime: 300,
    spawnWeight: 5,
  },

  // ═══════════════════════════════════════════════════════════════
  // MINIBOSSES - Spawn periodically, much tougher than regular enemies
  // ═══════════════════════════════════════════════════════════════

  glutton: {
    id: 'glutton',
    name: 'The Glutton',
    aiType: EnemyAIType.Glutton,
    category: EnemyCategory.Miniboss,
    baseHealth: 500,
    baseSpeed: 80,
    baseDamage: 25,
    size: 2.5,
    color: 0xcc0000,         // Miniboss - deep red
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 300,
    minSpawnTime: 180,  // 3 minutes
    spawnWeight: 0,     // Controlled spawn, not random
  },

  swarm_mother: {
    id: 'swarm_mother',
    name: 'Swarm Mother',
    aiType: EnemyAIType.SwarmMother,
    category: EnemyCategory.Miniboss,
    baseHealth: 400,
    baseSpeed: 40,
    baseDamage: 15,
    size: 3,
    color: 0xcc0000,         // Miniboss - deep red
    secondaryColor: 0xffffff, // White outline
    shape: 'hexagon',
    xpValue: 300,
    minSpawnTime: 240,  // 4 minutes
    spawnWeight: 0,
  },

  charger: {
    id: 'charger',
    name: 'The Charger',
    aiType: EnemyAIType.Charger,
    category: EnemyCategory.Miniboss,
    baseHealth: 600,
    baseSpeed: 60,       // Base speed (charges are MUCH faster)
    baseDamage: 50,
    size: 3.5,
    color: 0xcc0000,         // Miniboss - deep red
    secondaryColor: 0xffffff, // White outline
    shape: 'triangle',
    xpValue: 300,
    minSpawnTime: 300,  // 5 minutes
    spawnWeight: 0,
  },

  necromancer: {
    id: 'necromancer',
    name: 'Necromancer',
    aiType: EnemyAIType.Necromancer,
    category: EnemyCategory.Miniboss,
    baseHealth: 350,
    baseSpeed: 50,
    baseDamage: 15,
    size: 2,
    color: 0xcc0000,         // Miniboss - deep red
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 300,
    canShoot: true,
    shootCooldown: 2.5,
    projectileSpeed: 150,
    projectileDamage: 15,
    minSpawnTime: 360,  // 6 minutes
    spawnWeight: 0,
  },

  twin_a: {
    id: 'twin_a',
    name: 'Twin Alpha',
    aiType: EnemyAIType.TwinA,
    category: EnemyCategory.Miniboss,
    baseHealth: 300,
    baseSpeed: 90,
    baseDamage: 20,
    size: 1.8,
    color: 0xcc0000,         // Miniboss - deep red
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 150,
    minSpawnTime: 420,  // 7 minutes
    spawnWeight: 0,
  },

  twin_b: {
    id: 'twin_b',
    name: 'Twin Beta',
    aiType: EnemyAIType.TwinB,
    category: EnemyCategory.Miniboss,
    baseHealth: 300,
    baseSpeed: 90,
    baseDamage: 20,
    size: 1.8,
    color: 0xcc0000,         // Miniboss - deep red
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 150,
    minSpawnTime: 999,  // Only spawns with Twin A
    spawnWeight: 0,
  },

  // Ghost enemy (spawned by Necromancer)
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    aiType: EnemyAIType.Chase,
    category: EnemyCategory.Basic,
    baseHealth: 20,
    baseSpeed: 100,
    baseDamage: 10,
    size: 0.8,
    color: 0xff6666,         // Weak - light red
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 1,
    minSpawnTime: 999,  // Never spawns naturally
    spawnWeight: 0,
  },

  // ═══════════════════════════════════════════════════════════════
  // BOSSES - Appear at 10 minutes, cycling through each run
  // ═══════════════════════════════════════════════════════════════

  horde_king: {
    id: 'horde_king',
    name: 'The Horde King',
    aiType: EnemyAIType.HordeKing,
    category: EnemyCategory.Boss,
    baseHealth: 5000,
    baseSpeed: 40,
    baseDamage: 40,
    size: 5,
    color: 0x990000,         // Boss - crimson
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 1000,
    minSpawnTime: 600,  // 10 minutes
    spawnWeight: 0,
  },

  void_wyrm: {
    id: 'void_wyrm',
    name: 'Void Wyrm',
    aiType: EnemyAIType.VoidWyrm,
    category: EnemyCategory.Boss,
    baseHealth: 4000,
    baseSpeed: 80,
    baseDamage: 35,
    size: 4,
    color: 0x990000,         // Boss - crimson
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 1000,
    minSpawnTime: 600,
    spawnWeight: 0,
  },

  the_machine: {
    id: 'the_machine',
    name: 'The Machine',
    aiType: EnemyAIType.TheMachine,
    category: EnemyCategory.Boss,
    baseHealth: 4500,
    baseSpeed: 30,
    baseDamage: 30,
    size: 6,
    color: 0x990000,         // Boss - crimson
    secondaryColor: 0xffffff, // White outline
    shape: 'hexagon',
    xpValue: 1000,
    canShoot: true,
    shootCooldown: 0.5,
    projectileSpeed: 250,
    projectileDamage: 15,
    minSpawnTime: 600,
    spawnWeight: 0,
  },

  // Machine Turret (spawned by The Machine)
  turret: {
    id: 'turret',
    name: 'Turret',
    aiType: EnemyAIType.Sniper,  // Stationary shooter
    category: EnemyCategory.Basic,
    baseHealth: 50,
    baseSpeed: 0,  // Stationary
    baseDamage: 5,
    size: 0.8,
    color: 0xff4444,         // Standard - medium red
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 3,
    canShoot: true,
    shootCooldown: 1.5,
    projectileSpeed: 200,
    projectileDamage: 10,
    minSpawnTime: 999,
    spawnWeight: 0,
  },
};

/**
 * Get weighted random enemy type based on game time.
 * @param gameTime - Current game time in seconds
 * @param spawnTimeReduction - Seconds to reduce minSpawnTime (for world level scaling)
 */
export function getRandomEnemyType(
  gameTime: number,
  spawnTimeReduction: number = 0
): EnemyTypeDefinition {
  // Apply spawn time reduction to make elites appear earlier at higher world levels
  const effectiveGameTime = gameTime + spawnTimeReduction;

  const availableTypes = Object.values(ENEMY_TYPES).filter(
    type => type.minSpawnTime <= effectiveGameTime &&
            type.spawnWeight > 0 &&
            type.category !== EnemyCategory.Miniboss &&
            type.category !== EnemyCategory.Boss
  );

  if (availableTypes.length === 0) {
    return ENEMY_TYPES.basic;
  }

  // Calculate total weight
  const totalWeight = availableTypes.reduce((sum, type) => sum + type.spawnWeight, 0);

  // Pick random based on weight
  let random = Math.random() * totalWeight;
  for (const type of availableTypes) {
    random -= type.spawnWeight;
    if (random <= 0) {
      return type;
    }
  }

  return availableTypes[availableTypes.length - 1];
}

/**
 * Get enemy type by ID.
 */
export function getEnemyType(id: string): EnemyTypeDefinition | undefined {
  return ENEMY_TYPES[id];
}

/**
 * Get the type ID string from an EnemyAIType enum value.
 * Used for serialization - maps the numeric aiType back to the string ID.
 * @param aiType - The EnemyAIType value to look up
 * @returns The type ID string, or 'basic' if not found
 */
export function getTypeIdFromAIType(aiType: EnemyAIType): string {
  for (const [id, type] of Object.entries(ENEMY_TYPES)) {
    if (type.aiType === aiType) {
      return id;
    }
  }
  return 'basic'; // Fallback
}

/**
 * Scale enemy stats based on game time and world level.
 * @param type - Enemy type definition
 * @param gameTime - Current game time in seconds
 * @param worldLevelHealthMult - World level health multiplier (default 1)
 * @param worldLevelDamageMult - World level damage multiplier (default 1)
 */
export function getScaledStats(
  type: EnemyTypeDefinition,
  gameTime: number,
  worldLevelHealthMult: number = 1,
  worldLevelDamageMult: number = 1
): { health: number; speed: number; damage: number } {
  const timeMultiplier = 1 + gameTime * 0.01; // 1% increase per second

  return {
    health: Math.floor(type.baseHealth * timeMultiplier * worldLevelHealthMult),
    speed: type.baseSpeed * (1 + gameTime * 0.002), // Speed scales slower (no world level scaling)
    damage: Math.floor(type.baseDamage * (1 + gameTime * 0.005) * worldLevelDamageMult),
  };
}
