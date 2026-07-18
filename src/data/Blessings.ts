import type { PlayerStats } from './Upgrades';

/**
 * Blessings — pure-upside run-start gifts granted by the `blessingLevel` shop
 * upgrade ("Random bonus each run"). N distinct blessings are rolled per run,
 * where N is the purchased level.
 *
 * Unlike RunModifiers (tradeoffs) and Pacts (player-chosen curses bought for a
 * reward), a blessing has no downside term — it is a gift you paid gold for, so
 * every entry is strictly non-harmful. Blessings apply purely through existing
 * PlayerStats fields, so no combat-system surgery is needed.
 */
export interface Blessing {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly color: number;
  readonly apply: (stats: PlayerStats) => void;
}

export const BLESSINGS: readonly Blessing[] = [
  {
    id: 'blessed_might',
    name: 'Might',
    description: '+20% damage',
    icon: 'sword',
    color: 0xff6644,
    apply: (stats) => {
      stats.damageMultiplier *= 1.2;
    },
  },
  {
    id: 'blessed_haste',
    name: 'Haste',
    description: '+20% attack speed',
    icon: 'lightning',
    color: 0xffdd44,
    apply: (stats) => {
      stats.attackSpeedMultiplier *= 1.2;
    },
  },
  {
    id: 'blessed_vigor',
    name: 'Vigor',
    description: '+25% max health',
    icon: 'heart',
    color: 0xff5577,
    apply: (stats) => {
      stats.maxHealth = Math.round(stats.maxHealth * 1.25);
      stats.currentHealth = stats.maxHealth;
    },
  },
  {
    id: 'blessed_aegis',
    name: 'Aegis',
    description: '+3 armor, +1 HP/s regen',
    icon: 'shield',
    color: 0x44aaff,
    apply: (stats) => {
      stats.armor += 3;
      stats.regenPerSecond += 1;
    },
  },
  {
    id: 'blessed_swiftness',
    name: 'Swiftness',
    description: '+15% move speed',
    icon: 'boot',
    color: 0x66ffcc,
    apply: (stats) => {
      stats.moveSpeed *= 1.15;
    },
  },
  {
    id: 'blessed_fortune',
    name: 'Fortune',
    description: '+40% gold',
    icon: 'coins',
    color: 0xffcc22,
    apply: (stats) => {
      stats.goldMultiplier *= 1.4;
    },
  },
  {
    id: 'blessed_wisdom',
    name: 'Wisdom',
    description: '+30% XP',
    icon: 'book',
    color: 0x88ff88,
    apply: (stats) => {
      stats.xpMultiplier *= 1.3;
    },
  },
  {
    id: 'blessed_precision',
    name: 'Precision',
    description: '+15% crit chance',
    icon: 'target',
    color: 0xff8844,
    apply: (stats) => {
      stats.critChance += 0.15;
    },
  },
  {
    id: 'blessed_focus',
    name: 'Focus',
    description: '-15% cooldowns',
    icon: 'timer',
    color: 0xaa88ff,
    apply: (stats) => {
      stats.cooldownMultiplier *= 0.85;
    },
  },
  {
    id: 'blessed_reach',
    name: 'Reach',
    description: '+25% area of effect',
    icon: 'aura',
    color: 0x44ddff,
    apply: (stats) => {
      stats.rangeMultiplier *= 1.25;
    },
  },
  {
    id: 'blessed_magnetism',
    name: 'Magnetism',
    description: '+50 pickup range',
    icon: 'magnet',
    color: 0x66ccff,
    apply: (stats) => {
      stats.pickupRange += 50;
    },
  },
  {
    id: 'blessed_resolve',
    name: 'Resolve',
    description: '+1 revival',
    icon: 'revive',
    color: 0xffffff,
    apply: (stats) => {
      stats.revivals += 1;
    },
  },
  {
    id: 'blessed_communion',
    name: 'Communion',
    description: '+4% life steal',
    icon: 'vampire',
    color: 0xcc44aa,
    apply: (stats) => {
      stats.lifeStealPercent += 0.04;
    },
  },
  {
    id: 'blessed_providence',
    name: 'Providence',
    description: '+15% luck',
    icon: 'clover',
    color: 0x88ff44,
    apply: (stats) => {
      stats.luck += 0.15;
    },
  },
];

/**
 * Roll `count` distinct blessings. Returns [] for count <= 0 — the guard is
 * load-bearing, not defensive: an unbought profile asks for 0, and `slice(0, -n)`
 * would otherwise return nearly the whole pool.
 */
export function selectBlessings(count: number): Blessing[] {
  if (count <= 0) return [];
  const shuffled = [...BLESSINGS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, BLESSINGS.length));
}

/** Extra candidates offered on top of the pick count so drafting is a real choice. */
export const BLESSING_DRAFT_EXTRA = 3;

/**
 * Rolls `pickCount + BLESSING_DRAFT_EXTRA` DISTINCT blessing candidates for the
 * pre-run blessing draft (FEAT-BLESSING-DRAFT), so picking `pickCount` of them is a
 * real choice from a wider set. Caps at the pool size. Returns [] for pickCount <= 0
 * (an unbought profile drafts nothing). Applies nothing — the draft scene forwards
 * the chosen ids to GameScene, which applies them (same contract as rollModifierChoices).
 */
export function rollBlessingChoices(pickCount: number): Blessing[] {
  if (pickCount <= 0) return [];
  const candidateCount = Math.min(pickCount + BLESSING_DRAFT_EXTRA, BLESSINGS.length);
  const shuffled = [...BLESSINGS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, candidateCount);
}

/** Look up a blessing by ID. Returns undefined if not found. */
export function getBlessingById(blessingId: string): Blessing | undefined {
  return BLESSINGS.find(blessing => blessing.id === blessingId);
}
