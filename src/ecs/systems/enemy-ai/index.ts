/**
 * EnemyAI system barrel export.
 * Re-exports the public API so existing imports work unchanged.
 */
export {
  // State management
  updateAIGameTime,
  setEnemyAIBounds,
  resetEnemyAISystem,
  // Spawn callbacks
  setEnemyProjectileCallback,
  setMinionSpawnCallback,
  setXPGemCallbacks,
  setBossCallbacks,
  resetBossCallbacks,
  // Death tracking
  recordEnemyDeath,
  // Twin management
  linkTwins,
  unlinkTwin,
  getLinkedTwin,
  getAllTwinLinks,
} from './state';

// The main system function stays in the original file for now.
// Behavior functions will be extracted into category files incrementally.
export { enemyAISystem } from '../EnemyAISystem';
