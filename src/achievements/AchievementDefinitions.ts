/**
 * AchievementDefinitions.ts
 *
 * Persistent achievement definitions. These track progress across all runs
 * and reward gold, stat bonuses, or unlocks when completed.
 */

import { AchievementDefinition } from './AchievementTypes';

export const ACHIEVEMENTS: AchievementDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // COMBAT ACHIEVEMENTS (Lifetime Kill Tracking)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'lifetime_kills_100',
    name: 'First Blood',
    description: 'Kill 100 total enemies',
    icon: 'sword',
    category: 'combat',
    targetValue: 100,
    trackingType: 'kills',
    reward: { type: 'gold', value: 150, description: '+150 gold' },
    tier: 1,
    nextTierId: 'lifetime_kills_500',
  },
  {
    id: 'lifetime_kills_500',
    name: 'Combatant',
    description: 'Kill 500 total enemies',
    icon: 'sword',
    category: 'combat',
    targetValue: 500,
    trackingType: 'kills',
    reward: { type: 'gold', value: 250, description: '+250 gold' },
    tier: 2,
    nextTierId: 'lifetime_kills_1000',
  },
  {
    id: 'lifetime_kills_1000',
    name: 'Soldier',
    description: 'Kill 1,000 total enemies',
    icon: 'sword',
    category: 'combat',
    targetValue: 1000,
    trackingType: 'kills',
    reward: { type: 'gold', value: 400, description: '+400 gold' },
    tier: 3,
    nextTierId: 'lifetime_kills_10000',
  },
  {
    id: 'lifetime_kills_10000',
    name: 'Warrior',
    description: 'Kill 10,000 total enemies',
    icon: 'sword',
    category: 'combat',
    targetValue: 10000,
    trackingType: 'kills',
    reward: { type: 'gold', value: 750, description: '+750 gold' },
    bonusReward: { type: 'stat_bonus', value: 3, description: '+3% damage', statBonusId: 'damage' },
    tier: 4,
    nextTierId: 'lifetime_kills_100000',
  },
  {
    id: 'lifetime_kills_100000',
    name: 'Legendary Slayer',
    description: 'Kill 100,000 total enemies',
    icon: 'sword',
    category: 'combat',
    targetValue: 100000,
    trackingType: 'kills',
    reward: { type: 'gold', value: 2000, description: '+2,000 gold' },
    bonusReward: { type: 'stat_bonus', value: 5, description: '+5% damage', statBonusId: 'damage' },
    tier: 5,
  },
  {
    id: 'bosses_10',
    name: 'Boss Hunter',
    description: 'Defeat 10 bosses',
    icon: 'crowned-skull',
    category: 'combat',
    targetValue: 10,
    trackingType: 'bosses_killed',
    reward: { type: 'gold', value: 600, description: '+600 gold' },
    tier: 1,
    nextTierId: 'bosses_50',
  },
  {
    id: 'bosses_50',
    name: 'Boss Slayer',
    description: 'Defeat 50 bosses',
    icon: 'crowned-skull',
    category: 'combat',
    targetValue: 50,
    trackingType: 'bosses_killed',
    reward: { type: 'gold', value: 1500, description: '+1,500 gold' },
    bonusReward: { type: 'stat_bonus', value: 3, description: '+3% crit chance', statBonusId: 'critChance' },
    tier: 2,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SURVIVAL ACHIEVEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'playtime_15m',
    name: 'Newcomer',
    description: 'Play for 15 minutes total',
    icon: 'stopwatch',
    category: 'survival',
    targetValue: 900,
    trackingType: 'time_survived',
    reward: { type: 'gold', value: 100, description: '+100 gold' },
    tier: 1,
    nextTierId: 'playtime_1h',
  },
  {
    id: 'playtime_1h',
    name: 'Dedicated',
    description: 'Play for 1 hour total',
    icon: 'stopwatch',
    category: 'survival',
    targetValue: 3600,
    trackingType: 'time_survived',
    reward: { type: 'gold', value: 400, description: '+400 gold' },
    tier: 2,
    nextTierId: 'playtime_10h',
  },
  {
    id: 'playtime_10h',
    name: 'Veteran Player',
    description: 'Play for 10 hours total',
    icon: 'stopwatch',
    category: 'survival',
    targetValue: 36000,
    trackingType: 'time_survived',
    reward: { type: 'gold', value: 1000, description: '+1,000 gold' },
    bonusReward: { type: 'stat_bonus', value: 15, description: '+15 max HP', statBonusId: 'health' },
    tier: 3,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRESSION ACHIEVEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'first_run',
    name: 'First Steps',
    description: 'Complete your first run',
    icon: 'cycle',
    category: 'progression',
    targetValue: 1,
    trackingType: 'runs_completed',
    reward: { type: 'gold', value: 100, description: '+100 gold' },
  },
  {
    id: 'first_victory',
    name: 'Victor',
    description: 'Win your first run',
    icon: 'trophy',
    category: 'progression',
    targetValue: 1,
    trackingType: 'victories',
    reward: { type: 'gold', value: 500, description: '+500 gold' },
  },
  {
    id: 'victories_10',
    name: 'Champion',
    description: 'Win 10 runs',
    icon: 'trophy',
    category: 'progression',
    targetValue: 10,
    trackingType: 'victories',
    reward: { type: 'gold', value: 1000, description: '+1,000 gold' },
    tier: 1,
    nextTierId: 'victories_50',
  },
  {
    id: 'victories_50',
    name: 'Master',
    description: 'Win 50 runs',
    icon: 'trophy',
    category: 'progression',
    targetValue: 50,
    trackingType: 'victories',
    reward: { type: 'gold', value: 2000, description: '+2,000 gold' },
    bonusReward: { type: 'stat_bonus', value: 5, description: '+5% XP', statBonusId: 'xp' },
    tier: 2,
    nextTierId: 'victories_100',
  },
  {
    id: 'victories_100',
    name: 'Grandmaster',
    description: 'Win 100 runs',
    icon: 'trophy',
    category: 'progression',
    targetValue: 100,
    trackingType: 'victories',
    reward: { type: 'gold', value: 5000, description: '+5,000 gold' },
    bonusReward: { type: 'stat_bonus', value: 3, description: '+3% all stats', statBonusId: 'allStats' },
    tier: 3,
  },
  {
    id: 'world_5',
    name: 'Rising Star',
    description: 'Reach World Level 5',
    icon: 'globe',
    category: 'progression',
    targetValue: 5,
    trackingType: 'world_level',
    reward: { type: 'gold', value: 600, description: '+600 gold' },
    tier: 1,
    nextTierId: 'world_10',
  },
  {
    id: 'world_10',
    name: 'World Conqueror',
    description: 'Reach World Level 10',
    icon: 'globe',
    category: 'progression',
    targetValue: 10,
    trackingType: 'world_level',
    reward: { type: 'gold', value: 1000, description: '+1,000 gold' },
    bonusReward: { type: 'stat_bonus', value: 5, description: '+5% gold', statBonusId: 'gold' },
    tier: 2,
    nextTierId: 'world_20',
  },
  {
    id: 'world_20',
    name: 'Dimensional Master',
    description: 'Reach World Level 20',
    icon: 'globe',
    category: 'progression',
    targetValue: 20,
    trackingType: 'world_level',
    reward: { type: 'gold', value: 3000, description: '+3,000 gold' },
    bonusReward: { type: 'stat_bonus', value: 1, description: '+1 starting level', statBonusId: 'startingLevel' },
    tier: 3,
  },
  {
    id: 'level_30_run',
    name: 'Power Spike',
    description: 'Reach level 30 in a single run',
    icon: 'upgrade',
    category: 'progression',
    targetValue: 30,
    trackingType: 'level',
    reward: { type: 'gold', value: 500, description: '+500 gold' },
  },
  {
    id: 'account_level_25',
    name: 'Investor',
    description: 'Reach Account Level 25',
    icon: 'gem',
    category: 'progression',
    targetValue: 25,
    trackingType: 'account_level',
    reward: { type: 'gold', value: 500, description: '+500 gold' },
    tier: 1,
    nextTierId: 'account_level_50',
  },
  {
    id: 'account_level_50',
    name: 'Tycoon',
    description: 'Reach Account Level 50',
    icon: 'gem',
    category: 'progression',
    targetValue: 50,
    trackingType: 'account_level',
    reward: { type: 'gold', value: 750, description: '+750 gold' },
    bonusReward: { type: 'stat_bonus', value: 5, description: '-5% cooldown', statBonusId: 'cooldown' },
    tier: 2,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHALLENGE ACHIEVEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'perfect_run',
    name: 'Untouchable',
    description: 'Win a run without taking damage',
    icon: 'shield',
    category: 'challenge',
    targetValue: 1,
    trackingType: 'perfect_run',
    reward: { type: 'gold', value: 1000, description: '+1,000 gold' },
    bonusReward: { type: 'stat_bonus', value: 5, description: '+5% dodge', statBonusId: 'dodge' },
    isSecret: true,
  },
  {
    id: 'speed_run',
    name: 'Speed Demon',
    description: 'Win a run in under 8 minutes',
    icon: 'lightning-bolt',
    category: 'challenge',
    targetValue: 1,
    trackingType: 'speed_run',
    reward: { type: 'gold', value: 750, description: '+750 gold' },
    bonusReward: { type: 'stat_bonus', value: 5, description: '+5% attack speed', statBonusId: 'attackSpeed' },
  },
  {
    id: 'runs_started_100',
    name: 'Persistent',
    description: 'Start 100 runs',
    icon: 'cycle',
    category: 'challenge',
    targetValue: 100,
    trackingType: 'runs_started',
    reward: { type: 'gold', value: 500, description: '+500 gold' },
  },
  {
    id: 'max_streak_5',
    name: 'Momentum',
    description: 'Reach a 5 win streak',
    icon: 'fire',
    category: 'challenge',
    targetValue: 5,
    trackingType: 'win_streak',
    reward: { type: 'gold', value: 400, description: '+400 gold' },
  },
];

/**
 * Get an achievement definition by ID.
 */
export function getAchievementById(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * Get all achievements for a specific category.
 */
export function getAchievementsByCategory(category: string): AchievementDefinition[] {
  return ACHIEVEMENTS.filter((a) => a.category === category);
}

/**
 * Get all non-secret achievements.
 */
export function getVisibleAchievements(): AchievementDefinition[] {
  return ACHIEVEMENTS.filter((a) => !a.isSecret);
}

/**
 * Get achievements that have been unlocked (for revealing secrets).
 */
export function getUnlockedSecrets(
  progress: Record<string, { isUnlocked: boolean }>
): AchievementDefinition[] {
  return ACHIEVEMENTS.filter((a) => a.isSecret && progress[a.id]?.isUnlocked);
}
