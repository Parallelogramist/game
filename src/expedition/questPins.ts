/**
 * questPins: which charted sector each active place-naming objective points at.
 *
 * Pure and Phaser-free like the rest of src/expedition/. ONE pin per objective, the nearest
 * charted sector carrying its tag: a biome region is 1 to 20 of 48 sectors at the shipped
 * seeds, and twenty pins is noise rather than a plan. An uncharted destination resolves to
 * null and never to its real key, the same leak rule SectorMapRenderer and sectorDetail obey:
 * a pin hanging over unknown space would answer the question exploring exists to ask.
 */

import { sectorMatchesTag } from '../world/sectorTags';
import { PoiFlags } from './DiscoveryTypes';
import type { SectorTag } from '../world/sectorTags';
import type { WorldMap } from '../world/worldTypes';
import type { QuestHazardObjective, QuestMarker } from '../systems/QuestProgress';

export interface QuestPin {
  questId: string;
  label: string;
  /** Null when no charted sector carries this objective's tag yet. */
  sectorKey: string | null;
}

export interface QuestPinInputs {
  map: WorldMap;
  markers: readonly QuestMarker[];
  sectorFlagsOf: (sectorKey: string) => number;
  shipCell: { col: number; row: number };
}

export function buildQuestPins(inputs: QuestPinInputs): QuestPin[] {
  return inputs.markers.map((marker) => ({
    questId: marker.questId,
    label: marker.label,
    sectorKey: nearestChartedSector(inputs, marker.sectorTag, marker.countedSectorKeys),
  }));
}

function nearestChartedSector(
  inputs: QuestPinInputs,
  tag: SectorTag,
  countedSectorKeys: readonly string[] | undefined,
): string | null {
  let bestKey: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sector of inputs.map.sectors.values()) {
    if (inputs.sectorFlagsOf(sector.key) === 0) continue;
    if (countedSectorKeys?.includes(sector.key)) continue;
    if (!sectorMatchesTag(sector, tag)) continue;
    const distance = Math.max(
      Math.abs(sector.sx - inputs.shipCell.col),
      Math.abs(sector.sy - inputs.shipCell.row),
    );
    // Ties break on the key so two equidistant sectors cannot pin differently between opens.
    const better = distance < bestDistance
      || (distance === bestDistance && bestKey !== null && sector.key < bestKey);
    if (!better) continue;
    bestDistance = distance;
    bestKey = sector.key;
  }
  return bestKey;
}

export interface HazardPinInputs {
  map: WorldMap;
  objectives: readonly QuestHazardObjective[];
  /** Non-zero discovery flags mean charted. */
  sectorFlagsOf: (sectorKey: string) => number;
  poiFlagsOf: (poiId: string) => number;
  /** Rooms whose permanent hive was already taken THIS run. Pinning one points at a broken
   *  chest: a slot is stocked once per run, so a cleared hive does not re-arm until the next
   *  expedition. */
  spentNestSectorKeys: ReadonlySet<string>;
  shipCell: { col: number; row: number };
}

/**
 * Where a hive-clearing objective points: the nearest charted room holding a REMEMBERED hive
 * this run has not already emptied. ONE pin, the same rule buildQuestPins obeys, and every
 * hazard objective shares it because none of them names a different place.
 *
 * An objective with nothing to point at emits NO pin rather than a null one. A null would
 * reach the OBJECTIVES panel as "NOT YET CHARTED", which claims a place exists and is merely
 * unmapped; the truth is that no hive has been found yet.
 */
export function buildHazardPins(inputs: HazardPinInputs): QuestPin[] {
  if (inputs.objectives.length === 0) return [];
  const sectorKey = nearestRememberedNestSector(inputs);
  if (sectorKey === null) return [];
  return inputs.objectives.map((objective) => ({
    questId: objective.questId,
    label: objective.label,
    sectorKey,
  }));
}

function nearestRememberedNestSector(inputs: HazardPinInputs): string | null {
  let bestKey: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sector of inputs.map.sectors.values()) {
    if (inputs.sectorFlagsOf(sector.key) === 0) continue;
    if (inputs.spentNestSectorKeys.has(sector.key)) continue;
    const holdsRememberedNest = sector.poiSlots.some(
      (slot) => (inputs.poiFlagsOf(slot.id) & PoiFlags.HAZARD_NEST) !== 0,
    );
    if (!holdsRememberedNest) continue;
    const distance = Math.max(
      Math.abs(sector.sx - inputs.shipCell.col),
      Math.abs(sector.sy - inputs.shipCell.row),
    );
    // Ties break on the key so two equidistant hives cannot pin differently between opens.
    const better = distance < bestDistance
      || (distance === bestDistance && bestKey !== null && sector.key < bestKey);
    if (!better) continue;
    bestDistance = distance;
    bestKey = sector.key;
  }
  return bestKey;
}
