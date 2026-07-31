import { describe, test, expect } from 'vitest';
import { generateWorld } from './generateWorld';
import { PoiKind } from './worldTypes';
import type { WorldMap } from './worldTypes';
import { STAGES } from '../data/Stages';
import {
  PUZZLE_GLYPHS, PUZZLE_RING_RADIUS, buildSecretPuzzle, describePuzzleSequence,
} from './secretPuzzles';
import type { SecretPuzzle } from './secretPuzzles';

const INPUTS = {
  abilityGateOrder: ['blink_drive', 'breach_charges', 'magno_tether',
    'phase_cloak', 'thermal_ward', 'signal_decryptor'],
  availableBiomeIds: STAGES.map(stage => stage.id),
  hiddenSectorCount: 3,
};
const WORLDS = [12345, 20264, 28183, 36102, 44021].map(seed => generateWorld(seed, INPUTS));

function secretsOf(world: WorldMap): { secretId: string; depth: number }[] {
  const found: { secretId: string; depth: number }[] = [];
  for (const sector of world.sectors.values()) {
    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret) found.push({ secretId: slot.id, depth: sector.depth });
    }
  }
  return found;
}

function puzzlesOf(world: WorldMap): SecretPuzzle[] {
  return secretsOf(world)
    .map(entry => buildSecretPuzzle({
      worldSeed: world.seed, secretId: entry.secretId, depth: entry.depth,
    }))
    .filter((puzzle): puzzle is SecretPuzzle => puzzle !== null);
}

describe('secretPuzzles', () => {
  test('the same world and the same cache always build the same ring', () => {
    for (const world of WORLDS) {
      for (const entry of secretsOf(world)) {
        const input = {
          worldSeed: world.seed, secretId: entry.secretId, depth: entry.depth,
        };
        expect(buildSecretPuzzle(input)).toEqual(buildSecretPuzzle(input));
      }
    }
  });

  test('some caches seal and most stay walk-in', () => {
    const total = WORLDS.reduce((count, world) => count + secretsOf(world).length, 0);
    const sealed = WORLDS.reduce((count, world) => count + puzzlesOf(world).length, 0);
    expect(total).toBeGreaterThan(0);
    expect(sealed).toBeGreaterThan(0);
    expect(sealed).toBeLessThan(total);
  });

  test('every sequence is a permutation of the sigils on its own ring', () => {
    for (const world of WORLDS) {
      for (const puzzle of puzzlesOf(world)) {
        expect(puzzle.nodes.length === 3 || puzzle.nodes.length === 4).toBe(true);
        expect(puzzle.sequence.length).toBe(puzzle.nodes.length);
        const onRing = [...puzzle.nodes.map(node => node.glyphId)].sort();
        expect([...puzzle.sequence].sort()).toEqual(onRing);
        expect(new Set(puzzle.sequence).size).toBe(puzzle.sequence.length);
      }
    }
  });

  test('every pylon sits one radius out and no two share a spot', () => {
    for (const world of WORLDS) {
      for (const puzzle of puzzlesOf(world)) {
        const seen = new Set<string>();
        for (const node of puzzle.nodes) {
          expect(Math.hypot(node.offsetX, node.offsetY)).toBeCloseTo(PUZZLE_RING_RADIUS, 6);
          expect(node.sides).toBe(
            PUZZLE_GLYPHS.find(glyph => glyph.id === node.glyphId)?.sides);
          const spot = `${node.offsetX.toFixed(3)},${node.offsetY.toFixed(3)}`;
          expect(seen.has(spot)).toBe(false);
          seen.add(spot);
        }
      }
    }
  });

  test('the riddle names exactly the sigils the ring carries, in order', () => {
    for (const world of WORLDS) {
      for (const puzzle of puzzlesOf(world)) {
        const clause = describePuzzleSequence(puzzle);
        expect(clause.endsWith('.')).toBe(true);
        const onRing = new Set(puzzle.nodes.map(node => node.glyphId));
        for (const glyph of PUZZLE_GLYPHS) {
          if (!onRing.has(glyph.id)) expect(clause).not.toContain(glyph.label);
        }
        const positions = puzzle.sequence.map(glyphId =>
          clause.indexOf(PUZZLE_GLYPHS.find(glyph => glyph.id === glyphId)!.label));
        for (const position of positions) expect(position).toBeGreaterThan(0);
        for (let i = 1; i < positions.length; i++) {
          expect(positions[i]).toBeGreaterThan(positions[i - 1]);
        }
      }
    }
  });
});
