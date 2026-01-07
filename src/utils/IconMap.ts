/**
 * Icon mapping from semantic icon keys to sprite atlas frame names.
 *
 * Icon keys are used in upgrade/weapon definitions for better readability.
 * Frame names correspond to the actual frames in the game-icons.png atlas.
 *
 * Icons sourced from game-icons.net (CC BY 3.0)
 */

/**
 * Maps semantic icon keys to atlas frame names.
 * Use these keys in upgrade definitions instead of emoji.
 */
export const ICON_MAP: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // OFFENSE / COMBAT
  // ═══════════════════════════════════════════════════════════════════════════
  sword: 'crossed-swords',
  lightning: 'lightning-frequency',
  target: 'on-target',
  multishot: 'arrow-cluster',
  pierce: 'pointy-sword',
  dice: 'perspective-dice-six',
  explosion: 'grenade',
  wind: 'wind-slap',
  aura: 'aura',
  timer: 'stopwatch',
  refresh: 'cycle',
  fist: 'fist',
  'skull-bones': 'skull-crossed-bones',
  skull: 'death-zone',
  'shield-crack': 'cracked-shield',

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFENSE / HEALTH
  // ═══════════════════════════════════════════════════════════════════════════
  heart: 'heart-inside',
  shield: 'shield',
  'heart-green': 'heart-inside', // Alias - tint green in code
  swirl: 'spiral-shell',
  vampire: 'vampire-dracula',
  star: 'star-swirl',
  thorns: 'thorn-helix',
  crystal: 'crystal-ball',
  sparkle: 'spark-spirit',
  warning: 'hazard-sign',
  cancel: 'cross-mark',
  revive: 'angel-wings',

  // ═══════════════════════════════════════════════════════════════════════════
  // MOVEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  boot: 'wingfoot',
  run: 'run',
  'ice-cube': 'ice-cube',
  ghost: 'ghost',

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOURCES
  // ═══════════════════════════════════════════════════════════════════════════
  book: 'book-cover',
  magnet: 'magnet',
  coins: 'coins',
  gem: 'cut-diamond',
  clover: 'clover',
  bandage: 'bandage-roll',
  sunbeam: 'sunbeams',
  gift: 'swap-bag',
  crown: 'crown',
  rocket: 'rocket',

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════════
  clipboard: 'notebook',
  skip: 'fast-forward-button',
  brain: 'brain',
  clock: 'clockwork',
  gear: 'clockwork', // Settings/auto-upgrade cog
  devil: 'daemon-skull',
  angel: 'angel-wings',

  // ═══════════════════════════════════════════════════════════════════════════
  // ELEMENTAL
  // ═══════════════════════════════════════════════════════════════════════════
  fire: 'fire',
  snowflake: 'snowflake-2',
  poison: 'poison-bottle',
  volcano: 'volcano',
  chain: 'linked-rings',
  flask: 'erlenmeyer',
  'broken-heart': 'broken-heart',
  virus: 'virus',

  // ═══════════════════════════════════════════════════════════════════════════
  // MASTERY
  // ═══════════════════════════════════════════════════════════════════════════
  gun: 'pistol-gun',
  robot: 'robot-golem',
  backpack: 'backpack',
  planet: 'ringed-planet',
  bomb: 'grenade',
  radar: 'radar-sweep',
  dna: 'dna1',
  handshake: 'thrown-daggers', // Using thrown-daggers as placeholder
  trophy: 'trophy',

  // ═══════════════════════════════════════════════════════════════════════════
  // WEAPONS
  // ═══════════════════════════════════════════════════════════════════════════
  katana: 'sword-slice',
  'orbiting-blades': 'spinning-blades',
  'holy-aura': 'spark-spirit',
  'chain-lightning': 'lightning-helix',
  'homing-missile': 'rocket',
  'frost-nova': 'snowflake-2',
  laser: 'laser-blast',
  meteor: 'meteor-impact',
  flamethrower: 'flamethrower',
  ricochet: 'ricochet-ball',
  spikes: 'spiked-fence',
  drone: 'delivery-drone',
  shuriken: 'shuriken',
  telescope: 'telescope',
  projectile: 'thrown-daggers',

  // ═══════════════════════════════════════════════════════════════════════════
  // UI CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════
  pause: 'cross-mark', // Using cross as pause alternative
  volume: 'speaker',
  mute: 'silence',
  music: 'musical-notes',
  forward: 'fast-forward-button',

  // ═══════════════════════════════════════════════════════════════════════════
  // MISC
  // ═══════════════════════════════════════════════════════════════════════════
  wrench: 'wrench',
  circle: 'aura', // Blue circle -> aura
};

/**
 * Get the atlas frame name for a semantic icon key.
 * Returns a fallback icon if the key is not found.
 */
export function getIconFrame(iconKey: string): string {
  const frame = ICON_MAP[iconKey];
  if (frame) {
    return frame;
  }

  // Check if the key is already a valid frame name
  if (isValidFrameName(iconKey)) {
    return iconKey;
  }

  console.warn(`Unknown icon key: "${iconKey}", using fallback`);
  return 'cross-mark'; // Fallback icon
}

/**
 * Check if a frame name exists in the atlas.
 * This is a simple check against known frame names.
 */
const VALID_FRAMES = new Set([
  'angel-wings',
  'arrow-cluster',
  'aura',
  'backpack',
  'bandage-roll',
  'book-cover',
  'brain',
  'broken-heart',
  'burning-meteor',
  'clockwork',
  'clover',
  'coins',
  'cracked-shield',
  'cross-mark',
  'crossed-swords',
  'crown',
  'crystal-ball',
  'cut-diamond',
  'cycle',
  'daemon-skull',
  'death-zone',
  'delivery-drone',
  'dna1',
  'erlenmeyer',
  'fast-forward-button',
  'fire',
  'fist',
  'flamethrower',
  'ghost',
  'grenade',
  'hazard-sign',
  'heart-inside',
  'ice-cube',
  'laser-blast',
  'lightning-frequency',
  'lightning-helix',
  'linked-rings',
  'magnet',
  'meteor-impact',
  'musical-notes',
  'notebook',
  'on-target',
  'perspective-dice-six',
  'pistol-gun',
  'pointy-sword',
  'poison-bottle',
  'radar-sweep',
  'ricochet-ball',
  'ringed-planet',
  'robot-golem',
  'rocket',
  'run',
  'shield',
  'shuriken',
  'silence',
  'skull-crossed-bones',
  'snowflake-2',
  'spark-spirit',
  'speaker',
  'spiked-fence',
  'spinning-blades',
  'spiral-shell',
  'star-swirl',
  'stopwatch',
  'sunbeams',
  'swap-bag',
  'sword-slice',
  'telescope',
  'thorn-helix',
  'thrown-daggers',
  'trophy',
  'vampire-dracula',
  'virus',
  'volcano',
  'wind-slap',
  'wingfoot',
  'wrench',
]);

export function isValidFrameName(name: string): boolean {
  return VALID_FRAMES.has(name);
}

/**
 * Get all available icon keys.
 */
export function getAvailableIconKeys(): string[] {
  return Object.keys(ICON_MAP);
}
