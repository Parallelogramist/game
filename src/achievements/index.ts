/**
 * Achievements Module
 *
 * Exports all achievement-related types, definitions, and the manager singleton.
 */

// Types
export * from './AchievementTypes';

// Milestone definitions and helpers
export {
  MILESTONES,
  getMilestoneById,
  getMilestonesByCategory,
  getStartingMilestones,
} from './MilestoneDefinitions';

// Achievement definitions and helpers
export {
  ACHIEVEMENTS,
  getAchievementById,
  getAchievementsByCategory,
  getVisibleAchievements,
  getUnlockedSecrets,
} from './AchievementDefinitions';

// Manager singleton
export { AchievementManager, getAchievementManager } from './AchievementManager';
