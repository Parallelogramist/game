import type { PlayerStats } from './Upgrades';

/**
 * Pre-run Pacts — optional player-chosen curses that make a run harder in
 * exchange for greater rewards. Chosen on PactSelectScene before a run starts.
 *
 * Pacts apply purely through existing PlayerStats fields (like RunModifiers), so
 * no spawn-director or enemy-stat surgery is needed:
 *  - curseMultiplier already scales enemy health, damage and XP.
 *  - goldMultiplier / xpMultiplier already scale end-of-run rewards.
 *  - maxHealth / healingBoost / iframeDuration tune player fragility.
 */
export interface Pact {
  readonly id: string;
  readonly name: string;
  readonly description: string;  // the downside
  readonly reward: string;       // the upside (display)
  readonly color: number;
  readonly apply: (stats: PlayerStats) => void;
}

export const PACTS: readonly Pact[] = [
  {
    id: 'cursed_horde',
    name: 'Cursed Horde',
    description: 'Enemies are tougher and hit harder.',
    reward: '+15% gold · +10% XP',
    color: 0xff5577,
    apply: (stats) => {
      stats.curseMultiplier += 0.4;
      stats.goldMultiplier *= 1.15;
      stats.xpMultiplier += 0.1;
    },
  },
  {
    id: 'glass_cannon',
    name: 'Glass Cannon',
    description: 'Max health halved.',
    reward: '+15% gold',
    color: 0x66ccff,
    apply: (stats) => {
      stats.maxHealth = Math.max(1, Math.floor(stats.maxHealth * 0.5));
      stats.currentHealth = Math.min(stats.currentHealth, stats.maxHealth);
      stats.goldMultiplier *= 1.15;
    },
  },
  {
    id: 'famine',
    name: 'Famine',
    description: 'Healing is far less effective.',
    reward: '+12% gold · +10% XP',
    color: 0xffaa44,
    apply: (stats) => {
      stats.healingBoost *= 0.4;
      stats.goldMultiplier *= 1.12;
      stats.xpMultiplier += 0.1;
    },
  },
  {
    id: 'exposed',
    name: 'Exposed',
    description: 'Shorter invulnerability after a hit.',
    reward: '+10% gold',
    color: 0xbb88ff,
    apply: (stats) => {
      stats.iframeDuration *= 0.6;
      stats.goldMultiplier *= 1.1;
    },
  },
  {
    id: 'overwhelming',
    name: 'Overwhelming Odds',
    description: 'Enemies are drastically stronger.',
    reward: '+25% gold · +15% XP',
    color: 0xff3344,
    apply: (stats) => {
      stats.curseMultiplier += 0.7;
      stats.goldMultiplier *= 1.25;
      stats.xpMultiplier += 0.15;
    },
  },
];

/** Maximum pacts a player can stack in one run. */
export const MAX_PACTS = 3;

export function getPactById(id: string): Pact | undefined {
  return PACTS.find((pact) => pact.id === id);
}
