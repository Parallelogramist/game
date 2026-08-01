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
import type { SectorTag } from '../world/sectorTags';
import type { WorldMap } from '../world/worldTypes';
import type { QuestMarker } from '../systems/QuestProgress';

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
    sectorKey: nearestChartedSector(inputs, marker.sectorTag),
  }));
}

function nearestChartedSector(inputs: QuestPinInputs, tag: SectorTag): string | null {
  let bestKey: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sector of inputs.map.sectors.values()) {
    if (inputs.sectorFlagsOf(sector.key) === 0) continue;
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
