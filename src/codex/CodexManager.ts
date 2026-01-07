/**
 * CodexManager.ts
 *
 * Singleton manager for tracking discovered weapons, enemies, and upgrades.
 * Uses SecureStorage for persistence following MetaProgressionManager patterns.
 */

import { SecureStorage } from '../storage';
import {
  CodexState,
  WeaponCodexEntry,
  EnemyCodexEntry,
  UpgradeCodexEntry,
  CodexStatistics,
} from './CodexTypes';
import { getAllWeaponIds } from '../weapons';
import { ENEMY_TYPES } from '../enemies/EnemyTypes';

// Storage key
const STORAGE_KEY_CODEX = 'survivor-codex';
const CODEX_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT STATE FACTORIES
// ═══════════════════════════════════════════════════════════════════════════

function createDefaultWeaponEntries(): Record<string, WeaponCodexEntry> {
  const entries: Record<string, WeaponCodexEntry> = {};
  for (const weaponId of getAllWeaponIds()) {
    entries[weaponId] = {
      id: weaponId,
      discovered: false,
      timesUsed: 0,
      totalDamageDealt: 0,
      totalKills: 0,
    };
  }
  return entries;
}

function createDefaultEnemyEntries(): Record<string, EnemyCodexEntry> {
  const entries: Record<string, EnemyCodexEntry> = {};
  for (const enemyId of Object.keys(ENEMY_TYPES)) {
    entries[enemyId] = {
      id: enemyId,
      discovered: false,
      timesKilled: 0,
      timesEncountered: 0,
    };
  }
  return entries;
}

function createDefaultUpgradeEntries(): Record<string, UpgradeCodexEntry> {
  // Upgrades will be populated dynamically as they're encountered
  return {};
}

function createDefaultStatistics(): CodexStatistics {
  return {
    totalRunsPlayed: 0,
    totalPlayTimeSeconds: 0,
    totalKills: 0,
    totalDamageDealt: 0,
    totalGoldEarned: 0,
    totalVictories: 0,
    fastestVictorySeconds: Infinity,
    highestWorldLevel: 1,
    highestPlayerLevel: 1,
  };
}

function createDefaultCodexState(): CodexState {
  return {
    version: CODEX_VERSION,
    weapons: createDefaultWeaponEntries(),
    enemies: createDefaultEnemyEntries(),
    upgrades: createDefaultUpgradeEntries(),
    statistics: createDefaultStatistics(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CODEX MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class CodexManager {
  private state: CodexState;

  // Callback for new discovery notifications
  private onNewDiscovery: ((type: 'weapon' | 'enemy' | 'upgrade', id: string, name: string) => void) | null = null;

  constructor() {
    this.state = this.loadState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEAPON DISCOVERY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record that a weapon was discovered (first time used in a run).
   * Returns true if this was a NEW discovery.
   */
  discoverWeapon(weaponId: string, weaponName: string): boolean {
    if (!this.state.weapons[weaponId]) {
      this.state.weapons[weaponId] = {
        id: weaponId,
        discovered: false,
        timesUsed: 0,
        totalDamageDealt: 0,
        totalKills: 0,
      };
    }

    const entry = this.state.weapons[weaponId];
    const isNewDiscovery = !entry.discovered;

    if (isNewDiscovery) {
      entry.discovered = true;
      entry.discoveredAt = Date.now();
      this.saveState();

      if (this.onNewDiscovery) {
        this.onNewDiscovery('weapon', weaponId, weaponName);
      }
    }

    return isNewDiscovery;
  }

  /**
   * Record weapon usage statistics.
   */
  recordWeaponUsage(weaponId: string, damageDealt: number, kills: number): void {
    const entry = this.state.weapons[weaponId];
    if (entry) {
      entry.timesUsed++;
      entry.totalDamageDealt += damageDealt;
      entry.totalKills += kills;
    }
    // Note: Don't save on every usage - save at end of run
  }

  /**
   * Check if a weapon has been discovered.
   */
  isWeaponDiscovered(weaponId: string): boolean {
    return this.state.weapons[weaponId]?.discovered ?? false;
  }

  /**
   * Get weapon codex entry.
   */
  getWeaponEntry(weaponId: string): WeaponCodexEntry | undefined {
    return this.state.weapons[weaponId];
  }

  /**
   * Get all weapon entries.
   */
  getAllWeaponEntries(): WeaponCodexEntry[] {
    return Object.values(this.state.weapons);
  }

  /**
   * Get discovered weapon count.
   */
  getDiscoveredWeaponCount(): number {
    return Object.values(this.state.weapons).filter((w) => w.discovered).length;
  }

  /**
   * Get total weapon count.
   */
  getTotalWeaponCount(): number {
    return Object.keys(this.state.weapons).length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENEMY DISCOVERY (BESTIARY)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record that an enemy was encountered (first spawn).
   * Returns true if this was a NEW discovery.
   */
  discoverEnemy(enemyId: string, enemyName: string): boolean {
    if (!this.state.enemies[enemyId]) {
      this.state.enemies[enemyId] = {
        id: enemyId,
        discovered: false,
        timesKilled: 0,
        timesEncountered: 0,
      };
    }

    const entry = this.state.enemies[enemyId];
    const isNewDiscovery = !entry.discovered;

    entry.timesEncountered++;

    if (isNewDiscovery) {
      entry.discovered = true;
      entry.discoveredAt = Date.now();
      this.saveState();

      if (this.onNewDiscovery) {
        this.onNewDiscovery('enemy', enemyId, enemyName);
      }
    }

    return isNewDiscovery;
  }

  /**
   * Record an enemy kill.
   */
  recordEnemyKill(enemyId: string): void {
    const entry = this.state.enemies[enemyId];
    if (entry) {
      entry.timesKilled++;
    }
    // Note: Don't save on every kill - save at end of run
  }

  /**
   * Check if an enemy has been discovered.
   */
  isEnemyDiscovered(enemyId: string): boolean {
    return this.state.enemies[enemyId]?.discovered ?? false;
  }

  /**
   * Get enemy codex entry.
   */
  getEnemyEntry(enemyId: string): EnemyCodexEntry | undefined {
    return this.state.enemies[enemyId];
  }

  /**
   * Get all enemy entries.
   */
  getAllEnemyEntries(): EnemyCodexEntry[] {
    return Object.values(this.state.enemies);
  }

  /**
   * Get discovered enemy count.
   */
  getDiscoveredEnemyCount(): number {
    return Object.values(this.state.enemies).filter((e) => e.discovered).length;
  }

  /**
   * Get total enemy count.
   */
  getTotalEnemyCount(): number {
    return Object.keys(this.state.enemies).length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPGRADE DISCOVERY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record that an upgrade was discovered (first time selected).
   * Returns true if this was a NEW discovery.
   */
  discoverUpgrade(upgradeId: string, upgradeName: string): boolean {
    if (!this.state.upgrades[upgradeId]) {
      this.state.upgrades[upgradeId] = {
        id: upgradeId,
        discovered: false,
        timesSelected: 0,
      };
    }

    const entry = this.state.upgrades[upgradeId];
    const isNewDiscovery = !entry.discovered;

    entry.timesSelected++;

    if (isNewDiscovery) {
      entry.discovered = true;
      entry.discoveredAt = Date.now();
      this.saveState();

      if (this.onNewDiscovery) {
        this.onNewDiscovery('upgrade', upgradeId, upgradeName);
      }
    }

    return isNewDiscovery;
  }

  /**
   * Check if an upgrade has been discovered.
   */
  isUpgradeDiscovered(upgradeId: string): boolean {
    return this.state.upgrades[upgradeId]?.discovered ?? false;
  }

  /**
   * Get upgrade codex entry.
   */
  getUpgradeEntry(upgradeId: string): UpgradeCodexEntry | undefined {
    return this.state.upgrades[upgradeId];
  }

  /**
   * Get all upgrade entries.
   */
  getAllUpgradeEntries(): UpgradeCodexEntry[] {
    return Object.values(this.state.upgrades);
  }

  /**
   * Get discovered upgrade count.
   */
  getDiscoveredUpgradeCount(): number {
    return Object.values(this.state.upgrades).filter((u) => u.discovered).length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record end of run statistics.
   */
  recordRunEnd(
    playTimeSeconds: number,
    kills: number,
    damageDealt: number,
    goldEarned: number,
    wasVictory: boolean,
    worldLevel: number,
    playerLevel: number
  ): void {
    const stats = this.state.statistics;

    stats.totalRunsPlayed++;
    stats.totalPlayTimeSeconds += playTimeSeconds;
    stats.totalKills += kills;
    stats.totalDamageDealt += damageDealt;
    stats.totalGoldEarned += goldEarned;

    if (wasVictory) {
      stats.totalVictories++;
      if (playTimeSeconds < stats.fastestVictorySeconds) {
        stats.fastestVictorySeconds = playTimeSeconds;
      }
    }

    if (worldLevel > stats.highestWorldLevel) {
      stats.highestWorldLevel = worldLevel;
    }

    if (playerLevel > stats.highestPlayerLevel) {
      stats.highestPlayerLevel = playerLevel;
    }

    this.saveState();
  }

  /**
   * Get statistics.
   */
  getStatistics(): CodexStatistics {
    return { ...this.state.statistics };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPLETION TRACKING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get overall codex completion percentage.
   */
  getCompletionPercent(): number {
    const weaponPercent = this.getDiscoveredWeaponCount() / this.getTotalWeaponCount();
    const enemyPercent = this.getDiscoveredEnemyCount() / this.getTotalEnemyCount();

    // Weight weapons and enemies equally for completion
    return Math.round(((weaponPercent + enemyPercent) / 2) * 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CALLBACKS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set callback for new discovery notifications.
   */
  setDiscoveryCallback(
    callback: (type: 'weapon' | 'enemy' | 'upgrade', id: string, name: string) => void
  ): void {
    this.onNewDiscovery = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────────────────────────

  private loadState(): CodexState {
    const defaultState = createDefaultCodexState();
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_CODEX);
      if (stored) {
        const parsed = JSON.parse(stored) as CodexState;
        // Merge with defaults to handle new entries added in updates
        return {
          version: CODEX_VERSION,
          weapons: { ...defaultState.weapons, ...parsed.weapons },
          enemies: { ...defaultState.enemies, ...parsed.enemies },
          upgrades: { ...defaultState.upgrades, ...parsed.upgrades },
          statistics: { ...defaultState.statistics, ...parsed.statistics },
        };
      }
    } catch {
      console.warn('Could not load codex state from storage');
    }
    return defaultState;
  }

  private saveState(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_CODEX, JSON.stringify(this.state));
    } catch {
      console.warn('Could not save codex state to storage');
    }
  }

  /**
   * Reset all codex progress (for debugging).
   */
  resetProgress(): void {
    this.state = createDefaultCodexState();
    this.saveState();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

let codexManagerInstance: CodexManager | null = null;

/**
 * Get the singleton CodexManager instance.
 */
export function getCodexManager(): CodexManager {
  if (!codexManagerInstance) {
    codexManagerInstance = new CodexManager();
  }
  return codexManagerInstance;
}
