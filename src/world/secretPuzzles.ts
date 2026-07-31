/**
 * secretPuzzles: taxonomy row 3 from doc 04 section 5.
 *
 * Some of a world's cache slots are sealed behind a ring of sigil pylons that wake in one
 * order. Pure: no Phaser, no manager, no storage. It returns ring OFFSETS, never world
 * positions: the caller owns the sector clamp and the rock nudge, the same split
 * GameScene.secretRewardSpot already uses for reward pickups.
 */

import { hashStringToSeed, mulberry32, shuffleWithRng } from '../utils/dailySeed';

export type PuzzleGlyphId = 'triangle' | 'diamond' | 'pentagon' | 'hexagon';

export interface PuzzleGlyphDefinition {
  id: PuzzleGlyphId;
  /** Corner count. Shape carries the meaning, never colour alone (the gateGlyphs.ts rule). */
  sides: number;
  /** The word the riddle uses. */
  label: string;
}

/** Order matters: a 3-node ring uses the first three, so the vocabulary grows with depth. */
export const PUZZLE_GLYPHS: readonly PuzzleGlyphDefinition[] = [
  { id: 'triangle', sides: 3, label: 'triangle' },
  { id: 'diamond', sides: 4, label: 'diamond' },
  { id: 'pentagon', sides: 5, label: 'pentagon' },
  { id: 'hexagon', sides: 6, label: 'hexagon' },
];

export interface PuzzleNode {
  glyphId: PuzzleGlyphId;
  sides: number;
  /** World-pixel offset from the ring centre. */
  offsetX: number;
  offsetY: number;
}

export interface SecretPuzzle {
  secretId: string;
  /** Ring positions, clockwise from north. */
  nodes: readonly PuzzleNode[];
  /** Glyph ids in the order they must be woken. A permutation of the ring's glyphs. */
  sequence: readonly PuzzleGlyphId[];
}

export interface SecretPuzzleInput {
  /** WorldMap.seed. No run salt: a sealed cache is solved once and never respawns, so a
   *  per-run roll would only make the order unrepeatable, never varied. */
  worldSeed: number;
  /** PoiSlot.id of the cache this ring seals. */
  secretId: string;
  /** SectorDef.depth, graph distance from the hangar. */
  depth: number;
}

/** One ring radius, in world pixels. A sector is 1280x720, so a ring this size fits any
 *  interior once the caller shifts its centre (see the inset arithmetic in GameScene). */
export const PUZZLE_RING_RADIUS = 150;

/** Share of cache slots that seal. Low enough that a walk-in cache stays the common case. */
const PUZZLE_SHARE_PERCENT = 30;

/** The fourth pylon only appears out past the third ring: 24 permutations is a long
 *  brute-force for a player who has not earned the lead yet. */
const PUZZLE_FOUR_NODE_DEPTH = 5;

/**
 * The ring sealing this cache, or null when the cache is an ordinary walk-in.
 * Deterministic per (world seed, secret id): re-running it never moves a pylon or reorders a
 * sequence, which is what lets the lead quote the order before the player ever arrives.
 */
export function buildSecretPuzzle(input: SecretPuzzleInput): SecretPuzzle | null {
  const rng = mulberry32(hashStringToSeed(`secretPuzzle:${input.worldSeed}:${input.secretId}`));
  if (rng() * 100 >= PUZZLE_SHARE_PERCENT) return null;

  const nodeCount = input.depth >= PUZZLE_FOUR_NODE_DEPTH ? 4 : 3;
  const glyphs = PUZZLE_GLYPHS.slice(0, nodeCount);
  const placement = shuffleWithRng([...glyphs], rng);

  const nodes: PuzzleNode[] = placement.map((glyph, index) => {
    const angle = (Math.PI * 2 * index) / nodeCount - Math.PI / 2;
    return {
      glyphId: glyph.id,
      sides: glyph.sides,
      offsetX: Math.cos(angle) * PUZZLE_RING_RADIUS,
      offsetY: Math.sin(angle) * PUZZLE_RING_RADIUS,
    };
  });

  return {
    secretId: input.secretId,
    nodes,
    sequence: shuffleWithRng(glyphs.map(glyph => glyph.id), rng),
  };
}

/** The order clause a lore fragment carries. Read off the ring itself, so it cannot name a
 *  sigil the room lacks, the same integrity rule describeSecretLocation follows. */
export function describePuzzleSequence(puzzle: SecretPuzzle): string {
  const words = puzzle.sequence.map(glyphId =>
    PUZZLE_GLYPHS.find(glyph => glyph.id === glyphId)?.label ?? glyphId);
  return `Sigils wake in order: ${words.join(', then ')}.`;
}
