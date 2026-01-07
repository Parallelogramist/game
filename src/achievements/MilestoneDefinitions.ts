/**
 * MilestoneDefinitions.ts
 *
 * In-run milestone definitions. These reset each run and provide
 * immediate rewards when completed during gameplay.
 */

import { MilestoneDefinition } from './AchievementTypes';

export const MILESTONES: MilestoneDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // COMBAT MILESTONES
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'kills_100',
    name: 'Warm Up',
    description: 'Kill 100 enemies',
    icon: 'skull',
    category: 'combat',
    targetValue: 100,
    trackingType: 'kills',
    reward: {
      type: 'xp_bonus',
      value: 50,
      description: '+50 XP',
    },
    tier: 1,
    nextTierId: 'kills_500',
  },
  {
    id: 'kills_500',
    name: 'Slaughter',
    description: 'Kill 500 enemies',
    icon: 'skull',
    category: 'combat',
    targetValue: 500,
    trackingType: 'kills',
    reward: {
      type: 'temp_buff',
      value: 0.1,
      description: '+10% damage for 60s',
      buffType: 'damage',
      buffDuration: 60000,
    },
    tier: 2,
    nextTierId: 'kills_1000',
  },
  {
    id: 'kills_1000',
    name: 'Massacre',
    description: 'Kill 1000 enemies',
    icon: 'skull',
    category: 'combat',
    targetValue: 1000,
    trackingType: 'kills',
    reward: {
      type: 'reroll_token',
      value: 2,
      description: '+2 rerolls',
    },
    tier: 3,
  },
  {
    id: 'first_miniboss',
    name: 'Big Game Hunter',
    description: 'Kill a miniboss',
    icon: 'crowned-skull',
    category: 'combat',
    targetValue: 1,
    trackingType: 'minibosses_killed',
    reward: {
      type: 'xp_bonus',
      value: 100,
      description: '+100 XP',
    },
  },
  {
    id: 'minibosses_3',
    name: 'Miniboss Slayer',
    description: 'Kill 3 minibosses',
    icon: 'crowned-skull',
    category: 'combat',
    targetValue: 3,
    trackingType: 'minibosses_killed',
    reward: {
      type: 'reroll_token',
      value: 1,
      description: '+1 reroll',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SURVIVAL MILESTONES
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'survive_3min',
    name: 'Getting Started',
    description: 'Survive 3 minutes',
    icon: 'stopwatch',
    category: 'survival',
    targetValue: 180,
    trackingType: 'time_survived',
    reward: {
      type: 'xp_bonus',
      value: 30,
      description: '+30 XP',
    },
    tier: 1,
    nextTierId: 'survive_5min',
  },
  {
    id: 'survive_5min',
    name: 'Survivor',
    description: 'Survive 5 minutes',
    icon: 'stopwatch',
    category: 'survival',
    targetValue: 300,
    trackingType: 'time_survived',
    reward: {
      type: 'temp_buff',
      value: 0.15,
      description: '+15% speed for 60s',
      buffType: 'speed',
      buffDuration: 60000,
    },
    tier: 2,
    nextTierId: 'survive_8min',
  },
  {
    id: 'survive_8min',
    name: 'Endurance',
    description: 'Survive 8 minutes',
    icon: 'stopwatch',
    category: 'survival',
    targetValue: 480,
    trackingType: 'time_survived',
    reward: {
      type: 'reroll_token',
      value: 1,
      description: '+1 reroll',
    },
    tier: 3,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRESSION MILESTONES
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'level_5',
    name: 'Growing Strong',
    description: 'Reach level 5',
    icon: 'upgrade',
    category: 'progression',
    targetValue: 5,
    trackingType: 'level',
    reward: {
      type: 'xp_bonus',
      value: 25,
      description: '+25 XP',
    },
    tier: 1,
    nextTierId: 'level_10',
  },
  {
    id: 'level_10',
    name: 'Experienced',
    description: 'Reach level 10',
    icon: 'upgrade',
    category: 'progression',
    targetValue: 10,
    trackingType: 'level',
    reward: {
      type: 'reroll_token',
      value: 1,
      description: '+1 reroll',
    },
    tier: 2,
    nextTierId: 'level_20',
  },
  {
    id: 'level_20',
    name: 'Veteran',
    description: 'Reach level 20',
    icon: 'upgrade',
    category: 'progression',
    targetValue: 20,
    trackingType: 'level',
    reward: {
      type: 'temp_buff',
      value: 0.2,
      description: '+20% all stats for 60s',
      buffType: 'all_stats',
      buffDuration: 60000,
    },
    tier: 3,
  },
  {
    id: 'weapons_3',
    name: 'Arsenal',
    description: 'Acquire 3 weapons',
    icon: 'crossed-swords',
    category: 'progression',
    targetValue: 3,
    trackingType: 'weapons_acquired',
    reward: {
      type: 'xp_bonus',
      value: 75,
      description: '+75 XP',
    },
  },
  {
    id: 'upgrades_10',
    name: 'Powered Up',
    description: 'Acquire 10 upgrades',
    icon: 'level-four',
    category: 'progression',
    targetValue: 10,
    trackingType: 'upgrades_acquired',
    reward: {
      type: 'reroll_token',
      value: 1,
      description: '+1 reroll',
    },
  },
];

/**
 * Get a milestone definition by ID.
 */
export function getMilestoneById(id: string): MilestoneDefinition | undefined {
  return MILESTONES.find((m) => m.id === id);
}

/**
 * Get all milestones for a specific category.
 */
export function getMilestonesByCategory(category: string): MilestoneDefinition[] {
  return MILESTONES.filter((m) => m.category === category);
}

/**
 * Get all tier-1 milestones (starting milestones for tiered series).
 */
export function getStartingMilestones(): MilestoneDefinition[] {
  return MILESTONES.filter((m) => !m.tier || m.tier === 1);
}
