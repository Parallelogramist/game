/**
 * DiscoveryManager: the single write path for expedition discovery flags.
 *
 * A singleton like CodexManager because discovery is profile memory, not run state: it must
 * survive a death, a scene restart and a reload. bindWorld is what re-reads it for the world
 * actually being played, so a scene restart re-binds rather than resetting.
 */

import { SecureStorage } from '../storage';
import type { WorldMap } from '../world/worldTypes';
import { PoiFlags, SecretFlags, SectorFlags, emptyChanges, hasChanges } from './DiscoveryTypes';
import type { DiscoveryChanges, DiscoveryState } from './DiscoveryTypes';
import {
  buildIdUniverse,
  emptyDiscoveryState,
  emptyIdUniverse,
  revealOnEdgeTraversal,
  revealOnPoiCollected,
  revealOnScanPulse,
  revealOnSecretFound,
  revealOnSecretHinted,
  revealOnSectorEntry,
  revealOnVaultGuardCleared,
  sanitizeDiscoveryState,
} from './discoveryRules';
import type { WorldIdUniverse } from './discoveryRules';

const STORAGE_KEY_DISCOVERY = 'survivor-expedition-discovery';

export class DiscoveryManager {
  private map: WorldMap | null = null;
  private universe: WorldIdUniverse = emptyIdUniverse();
  private state: DiscoveryState = emptyDiscoveryState(0, 0);
  private revision = 0;
  private discoveryCallback: ((changes: DiscoveryChanges) => void) | null = null;

  /** Binds to one generated world and reloads the profile's memory of it. The universe is
   *  built first because the sanitizer rebuilds the state from exactly those ids. */
  bindWorld(map: WorldMap): void {
    this.map = map;
    this.universe = buildIdUniverse(map);
    this.state = this.loadState(map.seed, map.worldGenVersion);
    this.revision++;
  }

  getSectorFlags(sectorKey: string): number {
    return this.state.sectors[sectorKey] ?? 0;
  }

  getEdgeFlags(edgeId: string): number {
    return this.state.edges[edgeId] ?? 0;
  }

  getPoiFlags(poiId: string): number {
    return this.state.pois[poiId] ?? 0;
  }

  getSecretFlags(secretId: string): number {
    return this.state.secrets[secretId] ?? 0;
  }

  markSectorEntered(sectorKey: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(revealOnSectorEntry(this.state, this.map, this.universe, sectorKey));
  }

  markEdgeTraversed(edgeId: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(revealOnEdgeTraversal(this.state, this.universe, edgeId));
  }

  /** The only write path for a spent POI slot (README section 3.7's rule, applied to POIs).
   *  Map memory, not the vault respawn gate: ability ownership is what decides that. */
  markPoiCollected(poiId: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(revealOnPoiCollected(this.state, this.universe, poiId));
  }

  /** The only write path for a cleared vault guard (README section 3.7's rule). Permanent per
   *  world: the pack is the price of the key, and a price is paid once, not once per death. */
  markVaultGuardCleared(poiId: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(revealOnVaultGuardCleared(this.state, this.universe, poiId));
  }

  isVaultGuardCleared(poiId: string): boolean {
    return (this.getPoiFlags(poiId) & PoiFlags.GUARD_CLEARED) !== 0;
  }

  /** The only write path for a found secret (README section 3.7). Permanent per world: the
   *  found flag is what stops the cache respawning, so there is no second spawned-ids list. */
  markSecretFound(secretId: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(revealOnSecretFound(this.state, this.universe, secretId));
  }

  /** Hint tier 2's only write path. Marks a secret worth flying to without claiming it has
   *  been reached, so the chart may point at it and the completion percent does not move. */
  markSecretHinted(secretId: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(revealOnSecretHinted(this.state, this.universe, secretId));
  }

  /** Hint tier 3's only write path (README section 3.7): the decryptor's sweep. Charts outlines
   *  and points at this room's secrets, and grants neither VISITED nor FOUND, so a sweep can
   *  never move the completion percent. */
  applyScanPulse(originSectorKey: string, graphRadius: number): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(
      revealOnScanPulse(this.state, this.map, this.universe, originSectorKey, graphRadius),
    );
  }

  /** Secrets this profile has already been pointed at or has already found. */
  getKnownSecretIds(): Set<string> {
    const known = new Set<string>();
    for (const [secretId, flags] of Object.entries(this.state.secrets)) {
      if (flags !== 0) known.add(secretId);
    }
    return known;
  }

  getVisitedSectorKeys(): Set<string> {
    const visited = new Set<string>();
    for (const [sectorKey, flags] of Object.entries(this.state.sectors)) {
      if ((flags & SectorFlags.VISITED) !== 0) visited.add(sectorKey);
    }
    return visited;
  }

  /** Open leads: pointed at and not yet found. */
  getHintedSecretIds(): string[] {
    const hinted: string[] = [];
    for (const [secretId, flags] of Object.entries(this.state.secrets)) {
      if ((flags & SecretFlags.HINTED) !== 0 && (flags & SecretFlags.FOUND) === 0) {
        hinted.push(secretId);
      }
    }
    return hinted;
  }

  getDiscoveredSectorCount(): number {
    return this.countSectors(SectorFlags.DISCOVERED);
  }

  getVisitedSectorCount(): number {
    return this.countSectors(SectorFlags.VISITED);
  }

  getFoundSecretCount(): number {
    let count = 0;
    for (const flags of Object.values(this.state.secrets)) {
      if ((flags & SecretFlags.FOUND) !== 0) count++;
    }
    return count;
  }

  /** Sectors a profile is allowed to know exist right now. A hidden sector joins the
   *  denominator on the frame it is entered, at the same time as it joins the numerator, so
   *  finding one can raise the percentage and can never lower it. */
  getKnowableSectorCount(): number {
    let count = this.universe.sectorKeys.size;
    for (const key of this.universe.hiddenSectorKeys) {
      if ((this.getSectorFlags(key) & SectorFlags.VISITED) === 0) count--;
    }
    return count;
  }

  /** Visited sectors plus found secrets over everything a profile can reach in this world.
   *  Secrets joined the weighting the session something could actually find one. */
  getCompletionPercent(): number {
    const total = this.getKnowableSectorCount() + this.universe.secretIds.size;
    if (total === 0) return 0;
    const found = this.getVisitedSectorCount() + this.getFoundSecretCount();
    return Math.round((found / total) * 100);
  }

  /** Bumped by bindWorld as well as by every real change, so a renderer that caches
   *  geometry against it cannot survive a world swap holding the old world's cells. */
  getRevision(): number {
    return this.revision;
  }

  /** One slot, not a list: GameScene re-registers on every scene restart, and an
   *  append-only list would keep firing the dead scene's handler for the session. */
  onDiscovery(callback: ((changes: DiscoveryChanges) => void) | null): void {
    this.discoveryCallback = callback;
  }

  private countSectors(flag: number): number {
    let count = 0;
    for (const flags of Object.values(this.state.sectors)) {
      if ((flags & flag) !== 0) count++;
    }
    return count;
  }

  private commit(changes: DiscoveryChanges): DiscoveryChanges {
    if (!hasChanges(changes)) return changes;
    this.revision++;
    this.saveState();
    this.discoveryCallback?.(changes);
    return changes;
  }

  private loadState(worldSeed: number, worldGenVersion: number): DiscoveryState {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_DISCOVERY);
      if (stored) {
        return sanitizeDiscoveryState(
          JSON.parse(stored), worldSeed, worldGenVersion, this.universe,
        );
      }
    } catch {
      console.warn('Could not load expedition discovery from storage');
    }
    return emptyDiscoveryState(worldSeed, worldGenVersion);
  }

  private saveState(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_DISCOVERY, JSON.stringify(this.state));
    } catch {
      console.warn('Could not save expedition discovery to storage');
    }
  }
}

let discoveryManagerInstance: DiscoveryManager | null = null;

export function getDiscoveryManager(): DiscoveryManager {
  if (!discoveryManagerInstance) discoveryManagerInstance = new DiscoveryManager();
  return discoveryManagerInstance;
}
