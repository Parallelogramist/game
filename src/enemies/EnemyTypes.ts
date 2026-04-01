import { TUNING } from '../data/GameTuning';

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
  Lurker = 14,      // Hit-and-run: approach, lunge, retreat
  Warden = 15,      // Zone control: patrol, plant AOE, reposition
  Wraith = 16,      // Phasing: corporeal/phased cycle
  Rallier = 17,     // Offensive buff aura: speed-boosts nearby enemies
  Ghost = 18,       // Drifting wave chase (spawned by Necromancer)
  SplitterMini = 19, // Scatter burst then frantic chase (spawned by Splitter)
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

  // World level gating (enemies only appear at this world level or higher)
  minWorldLevel?: number; // Default 1 — available from the start
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
    color: 0xff4444,         // Melee chaser - red
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 1,
    minSpawnTime: 0,
    spawnWeight: 80,
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
    color: 0xff8833,         // Fast/agile - orange
    secondaryColor: 0xffffff, // White outline
    shape: 'triangle',
    xpValue: 1,
    minSpawnTime: 15,
    spawnWeight: 70,
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
    color: 0xffaa44,         // Fast/agile - light orange
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 2,
    minSpawnTime: 45,
    spawnWeight: 45,
    minWorldLevel: 1, // Core dodge-timing mechanic
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
    color: 0xff9933,         // Fast/agile - orange
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 2,
    minSpawnTime: 60,
    spawnWeight: 40,
    minWorldLevel: 1, // Movement variety from the start
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
    color: 0xffaa44,         // Fast/agile - light orange
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 1,
    minSpawnTime: 25,
    spawnWeight: 70,
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
    color: 0xdd4400,         // Brute - deep orange
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 5,
    minSpawnTime: 90,
    spawnWeight: 15,
    minWorldLevel: 2, // DPS check
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
    color: 0xffaa00,         // Volatile - yellow-orange
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 2,
    explodeOnDeath: true,
    explosionRadius: 60,
    explosionDamage: 20,
    minSpawnTime: 75,
    spawnWeight: 35,
    minWorldLevel: 2, // Punishes melee-range play
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
    color: 0x44ddaa,         // Spawner - teal
    secondaryColor: 0xffffff, // White outline
    shape: 'hexagon',
    xpValue: 3,
    splitsOnDeath: true,
    splitCount: 2,
    splitType: 'splitter_mini',
    minSpawnTime: 135,
    spawnWeight: 20,
    minWorldLevel: 3, // Area control
  },

  splitter_mini: {
    id: 'splitter_mini',
    name: 'Splitter Mini',
    aiType: EnemyAIType.SplitterMini,
    category: EnemyCategory.Basic,
    baseHealth: 15,
    baseSpeed: 85,
    baseDamage: 8,
    size: 0.8,
    color: 0xff4444,         // Melee chaser - red
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
    color: 0xff44aa,         // Ranged - magenta
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 3,
    canShoot: true,
    shootCooldown: 2.0,
    projectileSpeed: 200,
    projectileDamage: 12,
    minSpawnTime: 165,
    spawnWeight: 18,
    minWorldLevel: 3, // First ranged threat
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
    color: 0xff66bb,         // Ranged - light magenta
    secondaryColor: 0xffffff, // White outline
    shape: 'triangle',
    xpValue: 4,
    canShoot: true,
    shootCooldown: 3.0,
    projectileSpeed: 400,
    projectileDamage: 20,
    minSpawnTime: 270,
    spawnWeight: 12,
    minWorldLevel: 5, // Long-range threat
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
    color: 0xaa44ff,         // Support - purple
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 4,
    healsAllies: true,
    healRadius: 100,
    healAmount: 5,
    minSpawnTime: 240,
    spawnWeight: 10,
    minWorldLevel: 4, // Priority targeting
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
    color: 0xcc66ff,         // Support - light purple
    secondaryColor: 0xffffff, // White outline
    shape: 'circle',
    xpValue: 4,
    hasShield: true,
    shieldHealth: 30,
    shieldRegenDelay: 5.0,
    minSpawnTime: 200,
    spawnWeight: 15,
    minWorldLevel: 4, // Burst damage check
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
    color: 0xbb55ff,         // Support - mid purple
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 4,
    minSpawnTime: 300,
    spawnWeight: 12,
    minWorldLevel: 6, // Unpredictable positioning
  },

  lurker: {
    id: 'lurker',
    name: 'Lurker',
    aiType: EnemyAIType.Lurker,
    category: EnemyCategory.Basic,
    baseHealth: 16,
    baseSpeed: 95,
    baseDamage: 14,
    size: 0.95,
    color: 0x44cc44,         // Green - hit-and-run
    secondaryColor: 0xffffff, // White outline
    shape: 'triangle',
    xpValue: 2,
    minSpawnTime: 105,
    spawnWeight: 35,
    minWorldLevel: 1, // Hit-and-run from the start
  },

  warden: {
    id: 'warden',
    name: 'Warden',
    aiType: EnemyAIType.Warden,
    category: EnemyCategory.Elite,
    baseHealth: 35,
    baseSpeed: 50,
    baseDamage: 8,
    size: 1.3,
    color: 0x33bb66,         // Dark green - zone control
    secondaryColor: 0xffffff, // White outline
    shape: 'hexagon',
    xpValue: 4,
    minSpawnTime: 330,
    spawnWeight: 12,
    minWorldLevel: 6, // Zone denial
  },

  wraith: {
    id: 'wraith',
    name: 'Wraith',
    aiType: EnemyAIType.Wraith,
    category: EnemyCategory.Elite,
    baseHealth: 22,
    baseSpeed: 75,
    baseDamage: 15,
    size: 1.0,
    color: 0x44eedd,         // Bright cyan - phasing
    secondaryColor: 0xffffff, // White outline
    shape: 'diamond',
    xpValue: 4,
    minSpawnTime: 360,
    spawnWeight: 10,
    minWorldLevel: 7, // Phasing — advanced timing windows
  },

  rallier: {
    id: 'rallier',
    name: 'Rallier',
    aiType: EnemyAIType.Rallier,
    category: EnemyCategory.Elite,
    baseHealth: 18,
    baseSpeed: 70,
    baseDamage: 6,
    size: 1.0,
    color: 0xffdd44,         // Bright yellow - buff aura
    secondaryColor: 0xffffff, // White outline
    shape: 'triangle',
    xpValue: 5,
    minSpawnTime: 420,
    spawnWeight: 8,
    minWorldLevel: 8, // Buff aura — advanced support threat
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
    color: 0xcc3300,         // Brute - dark orange
    secondaryColor: 0xffffff, // White outline
    shape: 'square',
    xpValue: 10,
    minSpawnTime: 270,
    spawnWeight: 10,
    minWorldLevel: 5, // Major DPS check
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
    color: 0x8800aa,         // Miniboss - dark purple (gluttony)
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
    color: 0x008888,         // Miniboss - dark teal (spawner)
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
    color: 0xcc4400,         // Miniboss - deep orange (aggressive)
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
    color: 0x6600aa,         // Miniboss - dark violet (undead magic)
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
    color: 0xaa0022,         // Miniboss - dark crimson (warm twin)
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
    color: 0x2200aa,         // Miniboss - dark blue (cool twin)
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
    aiType: EnemyAIType.Ghost,
    category: EnemyCategory.Basic,
    baseHealth: 20,
    baseSpeed: 100,
    baseDamage: 10,
    size: 0.8,
    color: 0x88dddd,         // Ghostly - pale cyan
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
    color: 0xaa0000,         // Boss - deep crimson
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
    color: 0x660088,         // Boss - deep purple (void)
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
    color: 0x4466aa,         // Boss - steel blue (mechanical)
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
    color: 0xff44aa,         // Ranged - magenta
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
 * Get weighted random enemy type based on game time and world level.
 * @param gameTime - Current game time in seconds
 * @param spawnTimeReduction - Seconds to reduce minSpawnTime (for world level scaling)
 * @param worldLevel - Current world level (default 1), gates enemy introductions
 */
export function getRandomEnemyType(
  gameTime: number,
  spawnTimeReduction: number = 0,
  worldLevel: number = 1
): EnemyTypeDefinition {
  // Apply spawn time reduction to make elites appear earlier at higher world levels
  const effectiveGameTime = gameTime + spawnTimeReduction;

  const availableTypes = Object.values(ENEMY_TYPES).filter(
    type => type.minSpawnTime <= effectiveGameTime &&
            type.spawnWeight > 0 &&
            type.category !== EnemyCategory.Miniboss &&
            type.category !== EnemyCategory.Boss &&
            (type.minWorldLevel ?? 1) <= worldLevel
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
  // Polynomial scaling: gentle early, accelerates in back half of run
  // to keep pace with multiplicative player power stacking
  const { scaling } = TUNING;
  const normalizedTime = gameTime / scaling.runDuration;

  const healthMultiplier = 1 + gameTime * scaling.health.linear + Math.pow(normalizedTime, 2) * scaling.health.quadratic;
  const damageMultiplier = 1 + gameTime * scaling.damage.linear + Math.pow(normalizedTime, 2) * scaling.damage.quadratic;
  const speedMultiplier = 1 + gameTime * scaling.speed.linear + Math.pow(normalizedTime, scaling.speed.power) * scaling.speed.quadratic;

  return {
    health: Math.floor(type.baseHealth * healthMultiplier * worldLevelHealthMult),
    speed: type.baseSpeed * speedMultiplier,
    damage: Math.floor(type.baseDamage * damageMultiplier * worldLevelDamageMult),
  };
}
