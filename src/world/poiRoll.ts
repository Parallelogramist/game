import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';
import { POI_CONTENTS, POI_DEPTH_BANDS } from '../data/PoiCatalog';
import type { PoiContentDefinition, PoiContentId } from '../data/PoiCatalog';
import { weightedPick } from './generateWorld';
import type { PoiSlot } from './worldTypes';

export interface PoiRollInput {
  /** WorldMap.seed, the profile's persistent world. */
  worldSeed: number;
  /** Run-scoped salt, so contents re-roll per run while the layout does not. */
  runSalt: number;
  /** SectorDef.depth, graph distance from the hangar. */
  depth: number;
  /** Slots to consider; callers pass only the ones not yet spawned this run. */
  slots: readonly PoiSlot[];
  /** False once a once-per-run content has already spawned somewhere in this world. */
  oncePerRunAvailable: boolean;
  /**
   * False unless the profile holds a nemesis that has not yet spawned this run and no lair
   * is already standing. Live meta state the caller owns, kept out of this module so the
   * roll stays pure and seeded, exactly as `oncePerRunAvailable` is.
   */
  nemesisAvailable: boolean;
}

export interface RolledPoi {
  slot: PoiSlot;
  contentId: PoiContentId;
}

/**
 * Fills each slot the catalog has an entry for. A slot kind with no entry (ability vault,
 * quest anchor, secret) yields nothing and is simply absent from the result, which is what
 * lets the caller leave it unspawned for the chunk that owns it.
 *
 * Seeded per slot id rather than per sector so the result does not depend on the order or
 * the number of slots the caller passed in: a sector half-spawned before a refresh rolls
 * the identical contents for its remaining slots afterwards.
 */
export function rollPoiContents(input: PoiRollInput): RolledPoi[] {
  const scale = depthBandScale(input.depth);
  let oncePerRunAvailable = input.oncePerRunAvailable;
  let nemesisAvailable = input.nemesisAvailable;
  const rolled: RolledPoi[] = [];

  for (const slot of input.slots) {
    const candidates = POI_CONTENTS.filter(content =>
      content.slotKind === slot.kind &&
      (oncePerRunAvailable || content.oncePerRun !== true) &&
      (nemesisAvailable || content.requiresNemesis !== true) &&
      effectiveWeight(content, scale) > 0);
    if (candidates.length === 0) continue;

    const rng = mulberry32(hashStringToSeed(
      `poi:${input.worldSeed}:${input.runSalt}:${slot.id}`));
    const picked = candidates[
      weightedPick(candidates.map(content => effectiveWeight(content, scale)), rng)];
    if (picked.oncePerRun === true) oncePerRunAvailable = false;
    if (picked.requiresNemesis === true) nemesisAvailable = false;
    rolled.push({ slot, contentId: picked.id });
  }

  return rolled;
}

function effectiveWeight(
  content: PoiContentDefinition, scale: Partial<Record<PoiContentId, number>>,
): number {
  return content.weight * (scale[content.id] ?? 1);
}

function depthBandScale(depth: number): Partial<Record<PoiContentId, number>> {
  let scale = POI_DEPTH_BANDS[0].weightScale;
  for (const band of POI_DEPTH_BANDS) {
    if (depth >= band.minDepth) scale = band.weightScale;
  }
  return scale;
}
