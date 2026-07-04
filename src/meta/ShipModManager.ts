/**
 * ShipModManager — persistent per-ship mod-track levels across runs
 * (spec: docs/superpowers/specs/2026-07-03-ship-mod-tracks-design.md).
 *
 * Purchase flow (HANGAR tab in ShopScene): purchase() spends NOTHING itself —
 * the caller spends the track's gold cost via MetaProgressionManager first
 * and only calls purchase() on success, mirroring CardCollectionManager.scan().
 * It returns false (no state change, nothing persisted) at the level cap or
 * for unknown ship/track ids, so a stale UI card can never corrupt state.
 *
 * Uses SecureStorage (anti-cheat) — key registered in StorageBootstrap.
 */

import {
  SHIP_MOD_TRACKS,
  ShipModEffect,
  aggregateShipModBonuses,
  getShipModTracks,
} from '../data/ShipMods';
import { SecureStorage } from '../storage';

const STORAGE_KEY_SHIP_MODS = 'survivor-meta-ship-mods';

export class ShipModManager {
  /** shipId → (trackId → level). Only levels > 0 are stored. */
  private levels: Map<string, Map<string, number>>;

  constructor() {
    this.levels = new Map();
    this.load();
  }

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────

  /** Current level of a track (0 when unpurchased or ids are unknown). */
  getLevel(shipId: string, trackId: string): number {
    return this.levels.get(shipId)?.get(trackId) ?? 0;
  }

  /**
   * Increment a track level if below its cap, then persist. The CALLER has
   * already spent the gold (getShipModCost via MetaProgressionManager) —
   * this only records the level. Returns false with no state change at the
   * cap or for ship/track ids that aren't in the catalog.
   */
  purchase(shipId: string, trackId: string): boolean {
    const track = getShipModTracks(shipId).find((candidate) => candidate.id === trackId);
    if (!track) return false;

    const current = this.getLevel(shipId, trackId);
    if (current >= track.maxLevel) return false;

    let shipLevels = this.levels.get(shipId);
    if (!shipLevels) {
      shipLevels = new Map();
      this.levels.set(shipId, shipLevels);
    }
    shipLevels.set(trackId, current + 1);
    this.save();
    return true;
  }

  /** Aggregate stat block of a ship's purchased mods (run-start meta block). */
  getAggregatedBonuses(shipId: string): Required<ShipModEffect> {
    return aggregateShipModBonuses(shipId, this.levelsRecord(shipId));
  }

  /** Sum of purchased levels across a ship's tracks (the "3" in "3/9 MODS"). */
  getTotalLevels(shipId: string): number {
    let total = 0;
    for (const track of getShipModTracks(shipId)) {
      total += this.getLevel(shipId, track.id);
    }
    return total;
  }

  /** Sum of level caps across a ship's tracks (the "9" in "3/9 MODS"). */
  getMaxTotalLevels(shipId: string): number {
    let total = 0;
    for (const track of getShipModTracks(shipId)) {
      total += track.maxLevel;
    }
    return total;
  }

  /**
   * Ships whose every track is at cap — feeds the ship-mastery achievements.
   * Counted against the CURRENT catalog, so a ship with no tracks (unknown
   * id) never counts as "fully modded".
   */
  getFullyModdedShipCount(): number {
    let count = 0;
    for (const shipId of Object.keys(SHIP_MOD_TRACKS)) {
      const max = this.getMaxTotalLevels(shipId);
      if (max > 0 && this.getTotalLevels(shipId) >= max) count++;
    }
    return count;
  }

  private levelsRecord(shipId: string): Record<string, number> {
    const record: Record<string, number> = {};
    const shipLevels = this.levels.get(shipId);
    if (shipLevels) {
      for (const [trackId, level] of shipLevels) record[trackId] = level;
    }
    return record;
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence (SecureStorage)
  // ─────────────────────────────────────────────────────────────

  /**
   * Corruption-hardened loader. SecureStorage is the anti-cheat layer, so a
   * tampered/corrupt payload is the threat model (same class as
   * CardCollectionManager.load): rebuild state from KNOWN ship/track ids only
   * (walking the catalog, not the payload, so junk keys can't smuggle
   * entries in), coerce levels to integers clamped [0, maxLevel] rejecting
   * non-finite values, and tolerate non-object ship blocks. Any parse
   * failure or non-object payload falls back to the fresh-profile defaults.
   */
  private load(): void {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_SHIP_MODS);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const record = parsed as Record<string, unknown>;

      for (const shipId of Object.keys(record)) {
        const tracks = getShipModTracks(shipId);
        if (tracks.length === 0) continue; // unknown/stale ship id — drop

        const shipBlock = record[shipId];
        if (!shipBlock || typeof shipBlock !== 'object' || Array.isArray(shipBlock)) continue;
        const shipRecord = shipBlock as Record<string, unknown>;

        for (const track of tracks) {
          const raw = shipRecord[track.id];
          if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
          const level = Math.max(0, Math.min(track.maxLevel, Math.floor(raw)));
          if (level === 0) continue;

          let shipLevels = this.levels.get(shipId);
          if (!shipLevels) {
            shipLevels = new Map();
            this.levels.set(shipId, shipLevels);
          }
          shipLevels.set(track.id, level);
        }
      }
    } catch {
      console.warn('Could not load ship mods from storage');
    }
  }

  private save(): void {
    try {
      const payload: Record<string, Record<string, number>> = {};
      for (const [shipId, shipLevels] of this.levels) {
        if (shipLevels.size === 0) continue;
        payload[shipId] = Object.fromEntries(shipLevels);
      }
      SecureStorage.setItem(STORAGE_KEY_SHIP_MODS, JSON.stringify(payload));
    } catch {
      console.warn('Could not save ship mods to storage');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────

let shipModInstance: ShipModManager | null = null;

/**
 * Get the singleton ShipModManager instance.
 */
export function getShipModManager(): ShipModManager {
  if (!shipModInstance) {
    shipModInstance = new ShipModManager();
  }
  return shipModInstance;
}

/**
 * Drop the singleton so the next getShipModManager() re-reads storage.
 * TEST-ONLY escape hatch — production code must never re-create the manager
 * (state would silently fork from any captured references).
 */
export function resetShipModManagerForTests(): void {
  shipModInstance = null;
}
