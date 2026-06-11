import type { Upgrade } from './Upgrades';

/**
 * Limit Break / Overflow upgrades.
 *
 * Late game, once every normal stat upgrade is maxed and no weapon level-ups
 * remain, the level-up modal would otherwise have nothing to offer. These
 * repeatable, gate-free overflow upgrades fill that gap so a level-up is never
 * dead. Each gives ~half of a normal level's bonus and stacks without limit.
 *
 * They live inside the run's main upgrade array (so the existing apply path in
 * GameScene works unchanged) but `isOverflow` keeps them out of normal
 * selection — `getRandomCombinedUpgrades` only surfaces them as a fallback.
 */

export const OVERFLOW_PREFIX = 'overflow_';

/** True if an upgrade id belongs to the Limit Break pool. */
export function isOverflowId(id: string): boolean {
  return id.startsWith(OVERFLOW_PREFIX);
}

/** Per-level overflow bonuses (roughly half of a normal level). */
const OVERFLOW_BONUS = {
  damage: 0.1,     // +10% damage (normal Might +20%)
  health: 12,      // +12 max HP (normal Vitality +20)
  moveSpeed: 12,   // +12 move speed (normal Swiftness +25)
  xp: 0.05,        // +5% XP (normal XP upgrades larger)
  pickup: 20,      // +20 pickup range (normal Magnetism +30)
} as const;

/**
 * Creates a fresh set of Limit Break overflow upgrades (called once per run,
 * folded into the main upgrade list by createUpgrades()).
 */
export function createLimitBreakUpgrades(): Upgrade[] {
  return [
    {
      id: `${OVERFLOW_PREFIX}might`,
      name: 'Overcharge',
      description: 'Limit Break — unlimited damage stacking',
      icon: 'sword',
      maxLevel: 999,
      currentLevel: 0,
      isStatUpgrade: false,
      rarity: 'common',
      isOverflow: true,
      apply: (stats) => { stats.damageMultiplier += OVERFLOW_BONUS.damage; },
      getDescription: (level) => `+${Math.round((level + 1) * OVERFLOW_BONUS.damage * 100)}% damage  ·  LIMIT BREAK`,
    },
    {
      id: `${OVERFLOW_PREFIX}vitality`,
      name: 'Fortify',
      description: 'Limit Break — unlimited health stacking',
      icon: 'heart',
      maxLevel: 999,
      currentLevel: 0,
      isStatUpgrade: false,
      rarity: 'common',
      isOverflow: true,
      apply: (stats) => {
        stats.maxHealth += OVERFLOW_BONUS.health;
        stats.currentHealth += OVERFLOW_BONUS.health;
      },
      getDescription: (level) => `+${(level + 1) * OVERFLOW_BONUS.health} max HP  ·  LIMIT BREAK`,
    },
    {
      id: `${OVERFLOW_PREFIX}swiftness`,
      name: 'Momentum',
      description: 'Limit Break — unlimited speed stacking',
      icon: 'boot',
      maxLevel: 999,
      currentLevel: 0,
      isStatUpgrade: false,
      rarity: 'common',
      isOverflow: true,
      apply: (stats) => { stats.moveSpeed += OVERFLOW_BONUS.moveSpeed; },
      getDescription: (level) => `+${(level + 1) * OVERFLOW_BONUS.moveSpeed} move speed  ·  LIMIT BREAK`,
    },
    {
      id: `${OVERFLOW_PREFIX}insight`,
      name: 'Insight',
      description: 'Limit Break — unlimited XP stacking',
      icon: 'star',
      maxLevel: 999,
      currentLevel: 0,
      isStatUpgrade: false,
      rarity: 'common',
      isOverflow: true,
      apply: (stats) => { stats.xpMultiplier += OVERFLOW_BONUS.xp; },
      getDescription: (level) => `+${Math.round((level + 1) * OVERFLOW_BONUS.xp * 100)}% XP gain  ·  LIMIT BREAK`,
    },
    {
      id: `${OVERFLOW_PREFIX}allure`,
      name: 'Allure',
      description: 'Limit Break — unlimited pickup range',
      icon: 'magnet',
      maxLevel: 999,
      currentLevel: 0,
      isStatUpgrade: false,
      rarity: 'common',
      isOverflow: true,
      apply: (stats) => { stats.pickupRange += OVERFLOW_BONUS.pickup; },
      getDescription: (level) => `+${(level + 1) * OVERFLOW_BONUS.pickup} pickup range  ·  LIMIT BREAK`,
    },
  ];
}
