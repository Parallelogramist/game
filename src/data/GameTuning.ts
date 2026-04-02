/**
 * Centralized game tuning constants.
 * Values that a designer would tweak to balance the game live here.
 * Per-enemy-type base stats stay in EnemyTypes.ts; per-weapon mastery values stay in weapon classes.
 */
export const TUNING = {
  /** Enemy spawn rate curve and limits */
  spawn: {
    baseInterval: 1.0,
    minInterval: 0.15,
    maxEnemies: 2000,
    /** Multi-phase spawn rate curve — each phase linearly/quadratically ramps interval down */
    phases: [
      { endTime: 120, startInterval: 1.0, endInterval: 0.5 },   // 0-2min: gentle ramp
      { endTime: 360, startInterval: 0.5, endInterval: 0.25 },   // 2-6min: accelerating
      { endTime: 600, startInterval: 0.25, endInterval: 0.15 },  // 6-10min: intense
    ] as const,
    /** Late-game batch spawn thresholds */
    batchThresholds: [
      { time: 300, extraChance: 0.3, maxExtra: 2 },
      { time: 480, extraChance: 1.0, maxExtra: 3 },
    ] as const,
  },

  /** Boss spawn timing and cycling */
  bosses: {
    spawnTime: 600,
    warningPhases: [-120, -60, -30] as const,
    order: ['horde_king', 'void_wyrm', 'the_machine'] as const,
  },

  /** Miniboss schedule — typeIds are shuffled each run */
  minibosses: {
    schedule: [
      { typeId: 'glutton', time: 150 },
      { typeId: 'swarm_mother', time: 210 },
      { typeId: 'charger', time: 300 },
      { typeId: 'necromancer', time: 390 },
      { typeId: 'twin_a', time: 480 },
    ] as const,
  },

  /** Enemy stat scaling over run duration (polynomial: gentle early, steep late) */
  scaling: {
    runDuration: 600,
    health: { linear: 0.008, quadratic: 5 },
    damage: { linear: 0.003, quadratic: 2 },
    speed: { linear: 0.001, power: 1.5, quadratic: 0.8 },
  },

  /** XP level-up formula coefficients: base * level^exponent */
  xp: {
    levelFormula: { base: 10, exponent: 1.5 },
  },

  /** Weapon per-level scaling */
  weapons: {
    levelDamageBonus: 0.2,
    levelSizeBonus: 0.1,
    levelCooldownReduction: 0.9,
  },

  /** Pickup spawn timing */
  pickups: {
    magnetSpawnInterval: 60,
    healthDropChance: 0.08,
    healthDropMinibossMultiplier: 3,
  },

  /** Player combat constants */
  player: {
    damageInvincibility: 0.5,
    dashDuration: 0.15,
    dashSpeedMultiplier: 3.5,
  },

  /** Endless mode (post-victory) intervals */
  endless: {
    minibossInterval: 60,
    bossInterval: 600,
  },
} as const;

/** Storage key for auto-buy preference (shared between GameScene and HUDManager) */
export const STORAGE_KEY_AUTO_BUY = 'game_autoBuyEnabled';
