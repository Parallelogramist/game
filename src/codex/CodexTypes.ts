/**
 * CodexTypes.ts
 *
 * Type definitions for the Codex (collection/bestiary) system.
 * Tracks discovered weapons, enemies, and upgrades across all runs.
 */

/**
 * Entry for a discovered weapon in the codex.
 */
export interface WeaponCodexEntry {
  id: string;
  discovered: boolean;
  discoveredAt?: number; // Timestamp
  timesUsed: number;
  totalDamageDealt: number;
  totalKills: number;
}

/**
 * Entry for a discovered enemy in the codex (bestiary).
 */
export interface EnemyCodexEntry {
  id: string;
  discovered: boolean;
  discoveredAt?: number;
  timesKilled: number;
  timesEncountered: number;
}

/**
 * Entry for a discovered upgrade in the codex.
 */
export interface UpgradeCodexEntry {
  id: string;
  discovered: boolean;
  discoveredAt?: number;
  timesSelected: number;
}

/**
 * Global statistics tracked across all runs.
 */
export interface CodexStatistics {
  totalRunsPlayed: number;
  totalPlayTimeSeconds: number;
  totalKills: number;
  totalDamageDealt: number;
  totalGoldEarned: number;
  totalVictories: number;
  fastestVictorySeconds: number;
  highestWorldLevel: number;
  highestPlayerLevel: number;
}

/**
 * Full codex state stored in SecureStorage.
 */
export interface CodexState {
  version: number;
  weapons: Record<string, WeaponCodexEntry>;
  enemies: Record<string, EnemyCodexEntry>;
  upgrades: Record<string, UpgradeCodexEntry>;
  statistics: CodexStatistics;
}

/**
 * Codex categories for UI display.
 */
export type CodexCategory = 'weapons' | 'enemies' | 'upgrades' | 'statistics';

/**
 * Category metadata for tabs.
 */
export interface CodexCategoryInfo {
  id: CodexCategory;
  name: string;
  icon: string;
}

export const CODEX_CATEGORIES: CodexCategoryInfo[] = [
  { id: 'weapons', name: 'Weapons', icon: 'sword' },
  { id: 'enemies', name: 'Bestiary', icon: 'skull' },
  { id: 'upgrades', name: 'Upgrades', icon: 'star' },
  { id: 'statistics', name: 'Statistics', icon: 'chart' },
];
