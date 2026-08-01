/**
 * lockouts: what the profile still cannot open, and what each missing thing would unlock.
 *
 * Doc 03 section 4.5 rule 4's "the map is now a to-do list", answered world-wide instead of
 * one door at a time. Pure and Phaser-free like the rest of src/expedition/: the caller
 * supplies what the profile knows through predicates, so this module obeys the same leak
 * rules SectorMapRenderer and sectorDetail do. An uncharted sector contributes nothing, an
 * unseen POI contributes nothing, and an un-hinted secret contributes nothing, because a
 * count with a nearest-distance beside it is a position by another route.
 */

import { EDGE_DIRECTIONS, EdgeKind, PoiKind, edgeIdFor } from '../world/worldTypes';
import type { SectorDef, WorldMap } from '../world/worldTypes';
import { EdgeFlags, PoiFlags, SecretFlags } from './DiscoveryTypes';
import { getTraversalAbility } from '../data/TraversalAbilities';
import { getQuestForKeyId } from '../data/ExpeditionQuests';
import { isGridFenceIntact } from '../world/securityGrids';

const MAGNO_TETHER_ABILITY_ID = 'ability_magno_tether';
const PHASE_CLOAK_ABILITY_ID = 'ability_phase_cloak';

export type LockoutKind = 'ability' | 'questKey';

export interface LockoutRow {
  /** Traversal ability id or quest key id. Stable across opens. */
  id: string;
  kind: LockoutKind;
  /** Ability name, or the name of the quest that grants the key. */
  name: string;
  /** KNOWN sector borders this would open. */
  doors: number;
  /** Charted reward sites this would reach. */
  sites: number;
  /** Chebyshev sector distance from the ship to the nearest counted place. */
  nearestDistance: number;
}

export interface LockoutInputs {
  map: WorldMap;
  sectorFlagsOf: (sectorKey: string) => number;
  edgeFlagsOf: (edgeId: string) => number;
  poiFlagsOf: (poiId: string) => number;
  secretFlagsOf: (secretId: string) => number;
  holdsAbility: (abilityId: string) => boolean;
  holdsQuestKey: (keyId: string) => boolean;
  shipCell: { col: number; row: number };
}

interface Accumulator {
  id: string;
  kind: LockoutKind;
  name: string;
  doors: number;
  sites: number;
  nearestDistance: number;
}

function sectorDistance(sector: SectorDef, ship: { col: number; row: number }): number {
  return Math.max(Math.abs(sector.sx - ship.col), Math.abs(sector.sy - ship.row));
}

export function buildLockoutRows(inputs: LockoutInputs): LockoutRow[] {
  const rows = new Map<string, Accumulator>();
  // Every border is reachable from both of its sectors, so an interior door would count twice.
  // Same dedup SectorMapRenderer.drawnEdges keeps, and for the same reason.
  const countedEdges = new Set<string>();

  const bump = (
    key: string, kind: LockoutKind, name: string,
    field: 'doors' | 'sites', distance: number,
  ): void => {
    const existing = rows.get(key);
    if (existing) {
      existing[field]++;
      existing.nearestDistance = Math.min(existing.nearestDistance, distance);
      return;
    }
    rows.set(key, {
      id: key.slice(key.indexOf(':') + 1),
      kind,
      name,
      doors: field === 'doors' ? 1 : 0,
      sites: field === 'sites' ? 1 : 0,
      nearestDistance: distance,
    });
  };

  for (const sector of inputs.map.sectors.values()) {
    if (inputs.sectorFlagsOf(sector.key) === 0) continue;
    const distance = sectorDistance(sector, inputs.shipCell);

    for (const direction of EDGE_DIRECTIONS) {
      const edge = sector.edges[direction];
      if (edge.kind !== EdgeKind.AbilityDoor && edge.kind !== EdgeKind.KeyDoor) continue;
      if (edge.requiredId === undefined) continue;
      const edgeId = edgeIdFor(sector.sx, sector.sy, direction);
      if (countedEdges.has(edgeId)) continue;
      if ((inputs.edgeFlagsOf(edgeId) & EdgeFlags.KNOWN) === 0) continue;
      countedEdges.add(edgeId);

      if (edge.kind === EdgeKind.AbilityDoor) {
        if (inputs.holdsAbility(edge.requiredId)) continue;
        const definition = getTraversalAbility(edge.requiredId);
        if (!definition) continue;
        bump(`ability:${definition.id}`, 'ability', definition.name, 'doors', distance);
        continue;
      }
      if (inputs.holdsQuestKey(edge.requiredId)) continue;
      const quest = getQuestForKeyId(edge.requiredId);
      if (!quest) continue;
      bump(`questKey:${edge.requiredId}`, 'questKey', quest.name, 'doors', distance);
    }

    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret) {
        if (slot.gapped !== true) continue;
        // A cache the profile has not been pointed at is the whole point of the room, so it
        // may not raise a count that carries a distance. HINTED is what the LEADS panel and
        // the chart badge already admit.
        const flags = inputs.secretFlagsOf(slot.id);
        if ((flags & SecretFlags.HINTED) === 0) continue;
        if ((flags & SecretFlags.FOUND) !== 0) continue;
        if (inputs.holdsAbility(MAGNO_TETHER_ABILITY_ID)) continue;
        const tether = getTraversalAbility(MAGNO_TETHER_ABILITY_ID);
        if (!tether) continue;
        bump(`ability:${tether.id}`, 'ability', tether.name, 'sites', distance);
        continue;
      }
      if (slot.kind !== PoiKind.Shrine) continue;
      if (!isGridFenceIntact(sector, slot)) continue;
      if ((inputs.poiFlagsOf(slot.id) & PoiFlags.SEEN) === 0) continue;
      if (inputs.holdsAbility(PHASE_CLOAK_ABILITY_ID)) continue;
      const cloak = getTraversalAbility(PHASE_CLOAK_ABILITY_ID);
      if (!cloak) continue;
      bump(`ability:${cloak.id}`, 'ability', cloak.name, 'sites', distance);
    }
  }

  return [...rows.values()].sort((a, b) =>
    (b.doors + b.sites) - (a.doors + a.sites)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
