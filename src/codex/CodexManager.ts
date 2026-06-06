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
// LOAD-TIME SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════
// SecureStorage is the anti-cheat layer, so a corrupt/tampered codex payload is
// the threat model. The old loadState spread `...parsed.weapons` (etc.) straight
// over defaults: junk ids inflated totals (skewing completion %), a truthy
// non-boolean faked a discovery (unlocking starting weapons in WeaponSelectScene),
// and a non-numeric/Infinity field surfaced "NaN" / garbage in CodexScene. The
// sanitizers below rebuild from the known ids/fields only and coerce every value.
// Mirrors the hardening applied to AchievementManager / MetaProgressionManager.

/** Degrade arrays / null / primitives to `{}` so junk payloads fall back to
 *  defaults instead of leaking string indices or unknown keys via spread. */
function asStoredRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

interface StoredNumberSpec {
  floor: boolean; // integer counters floor; fractional fields (seconds/damage) don't
  allowInfinity: boolean; // only fastestVictorySeconds keeps +Infinity as its "none yet" sentinel
}

/** Coerce a stored numeric field: a finite, non-negative number (optionally
 *  +Infinity) survives; anything else (string/object/NaN/-Infinity/negative)
 *  falls back. Floors when the field is an integer counter. */
function boundedStoredNumber(value: unknown, fallback: number, spec: StoredNumberSpec): number {
  if (typeof value !== 'number') return fallback;
  if (spec.allowInfinity && value === Infinity) return value;
  if (!Number.isFinite(value)) return fallback; // NaN, ±Infinity (when not allowed)
  if (value < 0) return fallback;
  return spec.floor ? Math.floor(value) : value;
}

const COUNT_SPEC: StoredNumberSpec = { floor: true, allowInfinity: false };
const FRACTION_SPEC: StoredNumberSpec = { floor: false, allowInfinity: false };

// Per-field rules. A `Record<keyof CodexStatistics, …>` makes the compiler force
// every field to be covered, so this can never silently drift from the type.
const CODEX_STAT_SPECS: Record<keyof CodexStatistics, StoredNumberSpec> = {
  totalRunsPlayed: COUNT_SPEC,
  totalPlayTimeSeconds: FRACTION_SPEC,
  totalKills: COUNT_SPEC,
  totalDamageDealt: FRACTION_SPEC,
  totalGoldEarned: COUNT_SPEC,
  totalVictories: COUNT_SPEC,
  fastestVictorySeconds: { floor: false, allowInfinity: true },
  highestWorldLevel: COUNT_SPEC,
  highestPlayerLevel: COUNT_SPEC,
};

/** Pull an optional `discoveredAt` timestamp only when it is a real finite,
 *  non-negative number; otherwise leave it absent (matches the default factory). */
function sanitizeDiscoveredAt(record: Record<string, unknown>): number | undefined {
  const at = record.discoveredAt;
  return typeof at === 'number' && Number.isFinite(at) && at >= 0 ? at : undefined;
}

/** Rebuild weapon entries from the known weapon ids only, coercing each field.
 *  Drops junk ids (so totals stay stable) and forces `discovered` to a real
 *  boolean (so a truthy tamper can't fake a starting-weapon unlock). */
function sanitizeWeapons(raw: unknown): Record<string, WeaponCodexEntry> {
  const record = asStoredRecord(raw);
  const result: Record<string, WeaponCodexEntry> = {};
  for (const id of getAllWeaponIds()) {
    const stored = asStoredRecord(record[id]);
    const entry: WeaponCodexEntry = {
      id,
      discovered: stored.discovered === true,
      timesUsed: boundedStoredNumber(stored.timesUsed, 0, COUNT_SPEC),
      totalDamageDealt: boundedStoredNumber(stored.totalDamageDealt, 0, FRACTION_SPEC),
      totalKills: boundedStoredNumber(stored.totalKills, 0, COUNT_SPEC),
    };
    const discoveredAt = sanitizeDiscoveredAt(stored);
    if (discoveredAt !== undefined) entry.discoveredAt = discoveredAt;
    result[id] = entry;
  }
  return result;
}

/** Rebuild enemy (bestiary) entries from the known enemy ids only. */
function sanitizeEnemies(raw: unknown): Record<string, EnemyCodexEntry> {
  const record = asStoredRecord(raw);
  const result: Record<string, EnemyCodexEntry> = {};
  for (const id of Object.keys(ENEMY_TYPES)) {
    const stored = asStoredRecord(record[id]);
    const entry: EnemyCodexEntry = {
      id,
      discovered: stored.discovered === true,
      timesKilled: boundedStoredNumber(stored.timesKilled, 0, COUNT_SPEC),
      timesEncountered: boundedStoredNumber(stored.timesEncountered, 0, COUNT_SPEC),
    };
    const discoveredAt = sanitizeDiscoveredAt(stored);
    if (discoveredAt !== undefined) entry.discoveredAt = discoveredAt;
    result[id] = entry;
  }
  return result;
}

/** Upgrades use dynamic ids (no fixed known set — populated as encountered), so
 *  keep every entry whose value is a real object (id taken from the map key, the
 *  authoritative source) and drop scalar/array junk. Each field still coerced. */
function sanitizeUpgrades(raw: unknown): Record<string, UpgradeCodexEntry> {
  const record = asStoredRecord(raw);
  const result: Record<string, UpgradeCodexEntry> = {};
  for (const id of Object.keys(record)) {
    const stored = record[id];
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) continue;
    const rec = stored as Record<string, unknown>;
    const entry: UpgradeCodexEntry = {
      id,
      discovered: rec.discovered === true,
      timesSelected: boundedStoredNumber(rec.timesSelected, 0, COUNT_SPEC),
    };
    const discoveredAt = sanitizeDiscoveredAt(rec);
    if (discoveredAt !== undefined) entry.discoveredAt = discoveredAt;
    result[id] = entry;
  }
  return result;
}

/** Rebuild statistics from the known fields only, coercing each value. Note the
 *  Infinity carve-out for `fastestVictorySeconds`: JSON.stringify(Infinity) is
 *  "null", so a saved default round-trips to null here and must restore to the
 *  Infinity sentinel — otherwise `null < Infinity` is true and CodexScene shows a
 *  garbage "fastest victory" instead of "--:--". */
function sanitizeStatistics(raw: unknown): CodexStatistics {
  const defaults = createDefaultStatistics();
  const record = asStoredRecord(raw);
  const result = createDefaultStatistics();
  for (const key of Object.keys(defaults) as (keyof CodexStatistics)[]) {
    result[key] = boundedStoredNumber(record[key], defaults[key], CODEX_STAT_SPECS[key]);
  }
  return result;
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
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_CODEX);
      if (stored) {
        // Sanitize, don't trust: rebuild weapons/enemies/statistics from the
        // known ids/fields only and coerce every value, so a corrupt/tampered
        // payload can't inflate totals, fake a discovery, or leak NaN/null into
        // the codex. New weapon/enemy ids added in an update still default in
        // (and dropped/junk ids drop out); dynamic upgrade ids are kept when
        // their entry is a real object.
        const parsed = asStoredRecord(JSON.parse(stored));
        return {
          version: CODEX_VERSION,
          weapons: sanitizeWeapons(parsed.weapons),
          enemies: sanitizeEnemies(parsed.enemies),
          upgrades: sanitizeUpgrades(parsed.upgrades),
          statistics: sanitizeStatistics(parsed.statistics),
        };
      }
    } catch {
      console.warn('Could not load codex state from storage');
    }
    return createDefaultCodexState();
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
