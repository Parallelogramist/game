/**
 * poiGlyphs: what each kind of placed point of interest looks like on the world map.
 *
 * Shape carries the meaning, never colour alone, exactly as gateGlyphs does for borders.
 * PoiKind is the closed union the generator emits, so the coverage test beside this file is
 * what stops a new slot kind from silently rendering as nothing.
 *
 * The colours deliberately repeat the border palette: a vault is the ability door's violet
 * because it is what opens one, and a found secret is the breakable wall's amber because
 * that is the colour every secret surface in the game already speaks. Colour groups the
 * family, shape names the thing. Hex literals rather than an import of WORLD_GEOMETRY_COLORS:
 * src/expedition/ stays free of src/visual/, and the dependency already runs the other way.
 */

import { PoiKind } from '../world/worldTypes';

export type PoiGlyphShape = 'none' | 'star' | 'chest' | 'altar' | 'ring' | 'board' | 'hive';

export interface PoiGlyph {
  shape: PoiGlyphShape;
  /** Legend text. Kept beside the shape so the two cannot drift. */
  label: string;
  color: number;
}

export const POI_GLYPHS: Record<PoiKind, PoiGlyph> = {
  [PoiKind.AbilityPowerUp]: { shape: 'star',  label: 'Ability vault', color: 0xaa44ff },
  [PoiKind.QuestGiver]:     { shape: 'board', label: 'Quest board',   color: 0x66ddff },
  [PoiKind.Secret]:         { shape: 'ring',  label: 'Found secret',  color: 0xcc8833 },
  [PoiKind.Treasure]:       { shape: 'chest', label: 'Cache',         color: 0xffcc44 },
  [PoiKind.Shrine]:         { shape: 'altar', label: 'Altar',         color: 0x44ffaa },
};

/** A kind from tampered or future data draws nothing: an unknown slot must not invent a promise.
 *  Its own constant rather than a real entry, since every PoiKind now draws something. */
const UNKNOWN_POI_GLYPH: PoiGlyph = { shape: 'none', label: 'Unknown site', color: 0x8898b0 };

/** A Treasure slot the profile has learned is a permanent hive. Deliberately not a
 *  POI_GLYPHS entry: the generator emits Treasure for a chest and a hive alike, so only
 *  discovery state can tell them apart. The hazard orange is the colour the world-space
 *  hive and its radar contact already read in, so the chart and the room agree. */
export const HAZARD_NEST_GLYPH: PoiGlyph = {
  shape: 'hive', label: 'Ambush nest', color: 0xff6622,
};

export function poiGlyphFor(kind: PoiKind): PoiGlyph {
  return POI_GLYPHS[kind] ?? UNKNOWN_POI_GLYPH;
}
