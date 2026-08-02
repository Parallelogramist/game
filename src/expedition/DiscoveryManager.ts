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
  newlyPassableEdges,
  revealOnAmbushNestSighted,
  revealOnEdgeTraversal,
  revealOnMapFragment,
  revealOnPoiCollected,
  revealOnScanPulse,
  revealOnSecretFound,
  revealOnSecretHinted,
  revealOnSectorEntry,
  revealOnVaultGuardCleared,
  sanitizeDiscoveryState,
} from './discoveryRules';
import type { WorldIdUniverse } from './discoveryRules';
import { readArchivedWorld, writeArchivedWorld } from './worldArchive';

const STORAGE_KEY_DISCOVERY = 'survivor-expedition-discovery';

export class DiscoveryManager {
  private map: WorldMap | null = null;
  private universe: WorldIdUniverse = emptyIdUniverse();
  private state: DiscoveryState = emptyDiscoveryState(0, 0);
  private revision = 0;
  private discoveryCallback: ((changes: DiscoveryChanges) => void) | null = null;

  /** Run overlay, never persisted: the doors a just-gained ability or key opened, held until
   *  the map is next opened. saveState serializes `state` alone, and bindWorld clears this, so
   *  a scene restart or a world swap can never ring a door in a world the ship is not in. */
  private readonly newlyPassableEdgeIds = new Set<string>();

  /** Doc 03 section 7 moment 5: objectives whose pin moved since the chart was last opened.
   *  Run state with a per-world lifetime, exactly like newlyPassableEdgeIds: saveState
   *  serializes `state` alone and bindWorld clears this, so a scene restart or a season swap
   *  can never badge an objective in a world the ship is not in. */
  private readonly updatedObjectiveQuestIds = new Set<string>();

  /** Doc 03 section 7 moments 3 and 4: what changed on the chart while the ship was flying, so
   *  the next map open can replay it. Run overlays with a per-world lifetime, exactly like
   *  newlyPassableEdgeIds: saveState serializes `state` alone and bindWorld clears these, so a
   *  scene restart or a season swap can never replay a change in a world the ship is not in. */
  private readonly newlyFoundSecretIds = new Set<string>();
  private readonly newlyChartedSectorKeys = new Set<string>();

  /** Binds to one generated world and reloads the profile's memory of it. The universe is
   *  built first because the sanitizer rebuilds the state from exactly those ids. */
  bindWorld(map: WorldMap): void {
    this.map = map;
    this.universe = buildIdUniverse(map);
    this.state = this.loadState(map.seed, map.worldGenVersion);
    this.revision++;
    this.newlyPassableEdgeIds.clear();
    this.updatedObjectiveQuestIds.clear();
    this.newlyFoundSecretIds.clear();
    this.newlyChartedSectorKeys.clear();
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

  /** The only write path for a hive the ship has walked in on. Permanent per world because
   *  poiRoll draws hive-ness off the world seed alone, so the room really does hold one on
   *  every future expedition. */
  markAmbushNestSighted(poiId: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    return this.commit(revealOnAmbushNestSighted(this.state, this.universe, poiId));
  }

  /** The only write path for a found secret (README section 3.7). Permanent per world: the
   *  found flag is what stops the cache respawning, so there is no second spawned-ids list. */
  markSecretFound(secretId: string): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    const changes = this.commit(revealOnSecretFound(this.state, this.universe, secretId));
    // Off the changes, not the argument: re-claiming an already-found secret must bloom nothing.
    for (const foundId of changes.secretsFound) this.newlyFoundSecretIds.add(foundId);
    return changes;
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
    const changes = this.commit(
      revealOnScanPulse(this.state, this.map, this.universe, originSectorKey, graphRadius),
    );
    // Moment 4's second producer, on the fragment's rule: sectorsDiscovered, not the sweep's
    // footprint, so sweeping rooms already on the chart cascades nothing.
    for (const sectorKey of changes.sectorsDiscovered) this.newlyChartedSectorKeys.add(sectorKey);
    return changes;
  }

  /** The only write path for a recovered map fragment (README section 3.7): outlines for a
   *  slice of one region, never interiors, so the completion percent cannot move. */
  applyMapFragment(grantedSectorKeys: readonly string[]): DiscoveryChanges {
    if (!this.map) return emptyChanges();
    const changes = this.commit(
      revealOnMapFragment(this.state, this.map, this.universe, grantedSectorKeys),
    );
    // sectorsDiscovered, not the grant: a sector already on the chart cascades nothing.
    for (const sectorKey of changes.sectorsDiscovered) this.newlyChartedSectorKeys.add(sectorKey);
    return changes;
  }

  /** Doc 03 section 7 moment 6's only write path: records which KNOWN doors a permanent gain
   *  just opened and returns them, so the caller can say how many without a second query. */
  noteGainedPassKey(gainedId: string): string[] {
    if (!this.map) return [];
    const opened = newlyPassableEdges(this.state, this.map, this.universe, gainedId);
    for (const edgeId of opened) this.newlyPassableEdgeIds.add(edgeId);
    return opened;
  }

  getNewlyPassableEdgeIds(): ReadonlySet<string> {
    return this.newlyPassableEdgeIds;
  }

  /** "Until first viewed on the map" (doc 03 section 7 moment 6): the map screen snapshots the
   *  set and calls this, so the rings survive that whole open and no later one. */
  clearNewlyPassableEdges(): void {
    this.newlyPassableEdgeIds.clear();
  }

  /** The only writer of moment 5's overlay. Called by every site that changes WHERE an active
   *  objective points: a completed step, an activated chain successor, a fresh run's seeding,
   *  and a board accept. */
  noteObjectiveUpdated(questId: string): void {
    this.updatedObjectiveQuestIds.add(questId);
  }

  getUpdatedObjectiveQuestIds(): ReadonlySet<string> {
    return this.updatedObjectiveQuestIds;
  }

  clearUpdatedObjectives(): void {
    this.updatedObjectiveQuestIds.clear();
  }

  getNewlyFoundSecretIds(): ReadonlySet<string> {
    return this.newlyFoundSecretIds;
  }

  getNewlyChartedSectorKeys(): ReadonlySet<string> {
    return this.newlyChartedSectorKeys;
  }

  /** The same "until first viewed on the map" rule the newly-passable rings follow (doc 03
   *  section 7 moment 6): MapScene.create snapshots both sets and calls this, so the replay
   *  happens on exactly one open and on no later one. */
  clearMapOpenReveal(): void {
    this.newlyFoundSecretIds.clear();
    this.newlyChartedSectorKeys.clear();
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

  getDiscoveredSectorKeys(): Set<string> {
    const discovered = new Set<string>();
    for (const [sectorKey, flags] of Object.entries(this.state.sectors)) {
      if ((flags & SectorFlags.DISCOVERED) !== 0) discovered.add(sectorKey);
    }
    return discovered;
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
          readArchivedWorld(JSON.parse(stored), worldSeed, worldGenVersion),
          worldSeed, worldGenVersion, this.universe,
        );
      }
    } catch {
      console.warn('Could not load expedition discovery from storage');
    }
    return emptyDiscoveryState(worldSeed, worldGenVersion);
  }

  /** Re-reads the archive on every commit rather than caching it, on the WorldProfileStore
   *  precedent: two managers exist in tests and a cached archive would let one clobber the
   *  other's worlds. A commit is a sector entry or a find, never a per-frame path. */
  private saveState(): void {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_DISCOVERY);
      SecureStorage.setItem(STORAGE_KEY_DISCOVERY, JSON.stringify(
        writeArchivedWorld(stored ? JSON.parse(stored) : null, this.state),
      ));
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
