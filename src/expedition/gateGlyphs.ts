/**
 * gateGlyphs: what each kind of sector border looks like on the world map.
 *
 * Shape carries the meaning, never colour alone: the map has to be readable under every
 * colourblind pipeline this game ships. EdgeKind is the closed union the generator emits,
 * so the coverage test beside this file is what stops a new border kind from silently
 * rendering as nothing.
 */

import { EdgeKind } from '../world/worldTypes';

export type GateGlyphShape = 'none' | 'gap' | 'diamond' | 'key' | 'crack' | 'chevron';

export interface GateGlyph {
  shape: GateGlyphShape;
  /** Legend text. Consumed by FEAT-MAPUI-DOORS-05; kept beside the shape so they cannot drift. */
  label: string;
  color: number;
}

export const GATE_GLYPHS: Record<EdgeKind, GateGlyph> = {
  [EdgeKind.Wall]:        { shape: 'none',    label: 'Solid wall',        color: 0x33445c },
  [EdgeKind.Open]:        { shape: 'gap',     label: 'Open passage',      color: 0x66ddff },
  [EdgeKind.AbilityDoor]: { shape: 'diamond', label: 'Ability door',      color: 0xaa44ff },
  [EdgeKind.KeyDoor]:     { shape: 'key',     label: 'Key door',          color: 0xffcc44 },
  [EdgeKind.Breakable]:   { shape: 'crack',   label: 'Breakable wall',    color: 0xcc8833 },
  [EdgeKind.OneWay]:      { shape: 'chevron', label: 'One-way membrane',  color: 0x44ffaa },
};

/** A kind from tampered or future data falls back to the wall glyph, which draws nothing. */
export function gateGlyphFor(kind: EdgeKind): GateGlyph {
  return GATE_GLYPHS[kind] ?? GATE_GLYPHS[EdgeKind.Wall];
}
