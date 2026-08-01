/**
 * sectorMarks: the marks the PLAYER writes onto the chart, as opposed to everything else on it.
 *
 * Shape carries the meaning here exactly as it does in poiGlyphs and gateGlyphs, but the colour
 * rule is inverted on purpose and lives in SectorMapRenderer rather than here: every mark the
 * WORLD makes has a hue of its own, and everything the PLAYER writes is white, so a glance
 * separates what was found from what was decided. Pure and Phaser-free like the rest of
 * src/expedition/, and free of any src/visual/ import for the same reason poiGlyphs is.
 */

export type SectorMarkKind = 'return' | 'danger' | 'question';

export type SectorMarkShape = 'chevron' | 'cross' | 'triangle';

export interface SectorMarkGlyph {
  shape: SectorMarkShape;
  /** Legend text and the detail bar's clause. Kept beside the shape so the two cannot drift. */
  label: string;
}

export const SECTOR_MARKS: Record<SectorMarkKind, SectorMarkGlyph> = {
  return: { shape: 'chevron', label: 'Come back here' },
  danger: { shape: 'cross', label: 'Danger' },
  question: { shape: 'triangle', label: 'Unsolved' },
};

/** The order one press walks. A fourth press clears the mark, so the same button both
 *  places and removes and the screen needs no second binding. */
export const SECTOR_MARK_CYCLE: readonly SectorMarkKind[] = ['return', 'danger', 'question'];

export function nextSectorMarkKind(current: SectorMarkKind | null): SectorMarkKind | null {
  if (current === null) return SECTOR_MARK_CYCLE[0];
  const index = SECTOR_MARK_CYCLE.indexOf(current);
  if (index < 0) return SECTOR_MARK_CYCLE[0];
  return index + 1 < SECTOR_MARK_CYCLE.length ? SECTOR_MARK_CYCLE[index + 1] : null;
}

export const SECTOR_MARK_ID_PATTERN = /^mark:(-?\d+,-?\d+):(return|danger|question)$/;

export function sectorMarkId(sectorKey: string, kind: SectorMarkKind): string {
  return `mark:${sectorKey}:${kind}`;
}

export function parseSectorMarkId(
  id: string,
): { sectorKey: string; kind: SectorMarkKind } | null {
  const match = SECTOR_MARK_ID_PATTERN.exec(id);
  if (!match) return null;
  return { sectorKey: match[1], kind: match[2] as SectorMarkKind };
}

/** A note is read back on the detail bar's one headline, so it is short by design and single-line
 *  by construction: every control character and every whitespace run collapses to one space. */
export const MAX_SECTOR_NOTE_LENGTH = 60;

export function sanitizeSectorNote(raw: string): string | null {
  let stripped = '';
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    stripped += code < 0x20 || code === 0x7f ? ' ' : character;
  }
  const characters = Array.from(stripped.replace(/\s+/g, ' ').trim());
  const capped = characters.slice(0, MAX_SECTOR_NOTE_LENGTH).join('').trim();
  return capped.length > 0 ? capped : null;
}
