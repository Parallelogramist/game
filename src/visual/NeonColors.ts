/**
 * Neon color system for Geometry Wars visual aesthetic.
 * Provides core/glow color pairs and utilities for automatic neon conversion.
 */

export interface NeonColorPair {
  core: number;   // Bright, saturated center color
  glow: number;   // Lighter, softer glow color
}

/**
 * Player neon colors - blue theme
 */
export const PLAYER_NEON: NeonColorPair = {
  core: 0x4488ff,  // Bright blue
  glow: 0x66aaff,  // Lighter blue glow
};

/**
 * Enemy color palette — behavior archetype encoding.
 * Colors indicate how an enemy behaves, not just its threat tier.
 *
 * Melee chasers: Red (0xff4444) — Shambler, Splitter Mini
 * Fast/agile: Orange (0xff8833–0xffaa44) — Zigzag, Dasher, Circler, Tiny Swarm
 * Ranged: Magenta (0xff44aa–0xff66bb) — Shooter, Sniper, Turret
 * Support/special: Purple (0xaa44ff–0xcc66ff) — Healer, Shielded, Teleporter
 * Brutes: Deep orange (0xdd4400–0xcc3300) — Tank, Giant
 * Volatile: Yellow-orange (0xffaa00) — Exploder
 * Spawner: Teal (0x44ddaa) — Splitter
 * Ghostly: Pale cyan (0x88dddd) — Ghost
 * Hit-and-run: Green (0x44cc44) — Lurker
 * Zone control: Dark green (0x33bb66) — Warden
 * Phasing: Bright cyan (0x44eedd) — Wraith
 * Buff aura: Bright yellow (0xffdd44) — Rallier
 * Minibosses: Deep red (0xcc0000)
 * Bosses: Crimson (0x990000)
 */
export const ENEMY_COLORS = {
  meleChaser: { core: 0xff4444, glow: 0xff7777 } as NeonColorPair,   // Red - basic melee
  fastAgile: { core: 0xff8833, glow: 0xffaa66 } as NeonColorPair,    // Orange - fast movers
  ranged: { core: 0xff44aa, glow: 0xff77cc } as NeonColorPair,       // Magenta - ranged attackers
  support: { core: 0xaa44ff, glow: 0xcc77ff } as NeonColorPair,      // Purple - support/special
  brute: { core: 0xdd4400, glow: 0xff6622 } as NeonColorPair,        // Deep orange - heavy hitters
  volatile: { core: 0xffaa00, glow: 0xffcc44 } as NeonColorPair,     // Yellow-orange - exploders
  spawner: { core: 0x44ddaa, glow: 0x77ffcc } as NeonColorPair,      // Teal - spawning enemies
  ghostly: { core: 0x88dddd, glow: 0xaaffff } as NeonColorPair,      // Pale cyan - ghostly
  hitAndRun: { core: 0x44cc44, glow: 0x77ee77 } as NeonColorPair,   // Green - hit-and-run (Lurker)
  zoneControl: { core: 0x33bb66, glow: 0x66dd88 } as NeonColorPair, // Dark green - zone control (Warden)
  phasing: { core: 0x44eedd, glow: 0x77ffee } as NeonColorPair,     // Bright cyan - phasing (Wraith)
  buffAura: { core: 0xffdd44, glow: 0xffee77 } as NeonColorPair,    // Bright yellow - buff aura (Rallier)
  miniboss: { core: 0xcc0000, glow: 0xff3333 } as NeonColorPair,     // Deep red - minibosses
  boss: { core: 0x990000, glow: 0xcc2222 } as NeonColorPair,         // Crimson - bosses
} as const;

/**
 * Player/weapon blue color palette
 */
export const PLAYER_COLORS = {
  player: { core: 0x4488ff, glow: 0x66aaff } as NeonColorPair,
  weaponLight: { core: 0x66ccff, glow: 0x88ddff } as NeonColorPair,
  weaponMedium: { core: 0x4488ff, glow: 0x66aaff } as NeonColorPair,
  weaponDark: { core: 0x2266dd, glow: 0x4488ff } as NeonColorPair,
  ice: { core: 0x88ccff, glow: 0xaaddff } as NeonColorPair,  // Frost weapons stay icy blue
} as const;

/**
 * Pickup colors (keep original colors, just for reference)
 */
export const PICKUP_COLORS = {
  xp: { core: 0x44ff44, glow: 0x88ff88 } as NeonColorPair,
  health: { core: 0xff6666, glow: 0xffaaaa } as NeonColorPair,
  magnet: { core: 0xdd00ff, glow: 0xff66ff } as NeonColorPair,
} as const;

/**
 * Grid background colors
 */
export const GRID_COLORS = {
  line: 0x0066aa,       // Bright blue grid lines (was 0x002244)
  pulse: 0x0099dd,      // Brighter pulse color (was 0x004488)
  warpHighlight: 0x00ccff,  // Bright cyan highlight near entities (was 0x0088cc)
};

/**
 * Projectile colors
 */
export const PROJECTILE_NEON = {
  player: { core: 0x66ccff, glow: 0x88ddff } as NeonColorPair,  // Light blue player projectiles
  enemy: { core: 0xff4444, glow: 0xff8888 } as NeonColorPair,   // Red enemy projectiles
};

/**
 * Effect colors for pickups and explosions
 */
export const EFFECT_NEON = {
  xp: { core: 0x00ff88, glow: 0x66ffaa } as NeonColorPair,
  health: { core: 0x44ff44, glow: 0x88ff88 } as NeonColorPair,
  explosion: { core: 0xffffff, glow: 0xffffcc } as NeonColorPair,
};

/**
 * Weapon-specific color constants.
 * Weapons should import these instead of hardcoding hex values.
 */
export const WEAPON_COLORS = {
  blade: PLAYER_COLORS.weaponMedium,
  bladeGlow: PLAYER_COLORS.weaponLight,
  projectile: PLAYER_COLORS.weaponLight,
  frost: PLAYER_COLORS.ice,
  fire: { core: 0xff6622, glow: 0xff8844 } as NeonColorPair,
  lightning: { core: 0x88ccff, glow: 0xaaddff } as NeonColorPair,
  spike: PLAYER_COLORS.weaponMedium,
  spikeCenter: PLAYER_COLORS.weaponLight,
  aura: { core: 0x88aaff, glow: 0xaaccff } as NeonColorPair,
  auraRing: PLAYER_COLORS.weaponMedium,
  orbit: PLAYER_COLORS.weaponMedium,
  orbitHit: PLAYER_COLORS.weaponMedium,
  meteor: { core: 0xff6622, glow: 0xff8844 } as NeonColorPair,
  shuriken: PLAYER_COLORS.weaponLight,
  drone: PLAYER_COLORS.weaponLight,
  ricochet: PLAYER_COLORS.weaponLight,
  homing: { core: 0xff6622, glow: 0xff8844 } as NeonColorPair,
  laser: { core: 0xff4444, glow: 0xff8888 } as NeonColorPair,
  chain: { core: 0x88ccff, glow: 0xaaddff } as NeonColorPair,
  flamethrower: { core: 0xff6622, glow: 0xff8844 } as NeonColorPair,
} as const;

/**
 * Convert any hex color to a neon core/glow pair.
 * The glow is created by increasing brightness and reducing saturation slightly.
 *
 * @param hexColor - The base color (e.g., 0xff4444)
 * @returns NeonColorPair with core and glow variants
 */
export function toNeonPair(hexColor: number): NeonColorPair {
  // Extract RGB components
  const r = (hexColor >> 16) & 0xff;
  const g = (hexColor >> 8) & 0xff;
  const b = hexColor & 0xff;

  // Core color: Boost saturation and ensure brightness
  const maxChannel = Math.max(r, g, b);

  // If the color is already bright and saturated, use it as-is
  // Otherwise, boost the dominant channel(s)
  let coreR = r;
  let coreG = g;
  let coreB = b;

  if (maxChannel < 200) {
    // Boost brightness while maintaining hue
    const boostFactor = 255 / Math.max(maxChannel, 1);
    coreR = Math.min(255, Math.floor(r * boostFactor * 0.9));
    coreG = Math.min(255, Math.floor(g * boostFactor * 0.9));
    coreB = Math.min(255, Math.floor(b * boostFactor * 0.9));
  }

  // Glow color: Blend toward white (higher brightness, lower saturation)
  const glowR = Math.min(255, Math.floor(coreR + (255 - coreR) * 0.5));
  const glowG = Math.min(255, Math.floor(coreG + (255 - coreG) * 0.5));
  const glowB = Math.min(255, Math.floor(coreB + (255 - coreB) * 0.5));

  return {
    core: (coreR << 16) | (coreG << 8) | coreB,
    glow: (glowR << 16) | (glowG << 8) | glowB,
  };
}

/**
 * Lighten a color by blending with white.
 * Useful for creating highlight effects.
 *
 * @param hexColor - The base color
 * @param amount - Blend amount (0 = original, 1 = white)
 */
export function lightenColor(hexColor: number, amount: number): number {
  const r = (hexColor >> 16) & 0xff;
  const g = (hexColor >> 8) & 0xff;
  const b = hexColor & 0xff;

  const newR = Math.min(255, Math.floor(r + (255 - r) * amount));
  const newG = Math.min(255, Math.floor(g + (255 - g) * amount));
  const newB = Math.min(255, Math.floor(b + (255 - b) * amount));

  return (newR << 16) | (newG << 8) | newB;
}

/**
 * Darken a color by reducing RGB values.
 * Useful for creating shadow/depth effects.
 *
 * @param hexColor - The base color
 * @param amount - Darken amount (0 = original, 1 = black)
 */
export function darkenColor(hexColor: number, amount: number): number {
  const r = (hexColor >> 16) & 0xff;
  const g = (hexColor >> 8) & 0xff;
  const b = hexColor & 0xff;

  const factor = 1 - amount;
  const newR = Math.floor(r * factor);
  const newG = Math.floor(g * factor);
  const newB = Math.floor(b * factor);

  return (newR << 16) | (newG << 8) | newB;
}

/**
 * Get the glow alpha values for each layer based on visual quality.
 * Returns array of alpha values from outermost to innermost layer.
 * More layers with gradual alpha increase creates smoother, tighter glow.
 */
export function getGlowAlphas(quality: 'high' | 'medium' | 'low'): number[] {
  switch (quality) {
    case 'high':
      // 15 layers - smooth gradient glow
      return [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20, 0.25, 0.30];
    case 'medium':
      // 10 layers
      return [0.03, 0.05, 0.07, 0.09, 0.11, 0.14, 0.17, 0.20, 0.24, 0.28];
    case 'low':
      // 5 layers
      return [0.06, 0.12, 0.18, 0.24, 0.32];
  }
}

/**
 * Get the glow radius multipliers for each layer based on visual quality.
 * Returns array of radius multipliers from outermost to innermost.
 * Tighter spread (half the previous distance) creates more focused neon glow.
 */
export function getGlowRadiusMultipliers(quality: 'high' | 'medium' | 'low'): number[] {
  switch (quality) {
    case 'high':
      // 15 layers - tight spread from 1.4x to 1.05x
      return [1.40, 1.375, 1.35, 1.325, 1.30, 1.275, 1.25, 1.225, 1.20, 1.175, 1.15, 1.125, 1.10, 1.075, 1.05];
    case 'medium':
      // 10 layers - from 1.3x to 1.03x
      return [1.30, 1.27, 1.24, 1.21, 1.18, 1.15, 1.12, 1.09, 1.06, 1.03];
    case 'low':
      // 5 layers - from 1.2x to 1.04x
      return [1.20, 1.16, 1.12, 1.08, 1.04];
  }
}
