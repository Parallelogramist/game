import { describe, it, expect } from 'vitest';
import { decodeSeedCode, encodeSeedCode } from './seedCode';
import {
  FIRST_EXPEDITION_WORLD_SEED,
  MAX_EXPEDITION_WORLD_SEED,
  rollNextExpeditionSeed,
} from './ExpeditionSeasonStore';

describe('expedition world codes', () => {
  it('round-trips every seed the chain can deal', () => {
    const seeds = [
      1,
      FIRST_EXPEDITION_WORLD_SEED,
      MAX_EXPEDITION_WORLD_SEED,
      MAX_EXPEDITION_WORLD_SEED + 1,
      rollNextExpeditionSeed(FIRST_EXPEDITION_WORLD_SEED, 1),
      rollNextExpeditionSeed(FIRST_EXPEDITION_WORLD_SEED, 2),
    ];
    for (const seed of seeds) {
      expect(decodeSeedCode(encodeSeedCode(seed))).toBe(seed);
    }
  });

  it('emits a tagged, uppercase code', () => {
    const code = encodeSeedCode(FIRST_EXPEDITION_WORLD_SEED);
    expect(code.startsWith('PPW1-')).toBe(true);
    expect(code.slice('PPW1-'.length)).toMatch(/^[0-9A-Z]+$/);
  });

  it('reads a code back through the mangling a paste survives', () => {
    const seed = rollNextExpeditionSeed(FIRST_EXPEDITION_WORLD_SEED, 3);
    const code = encodeSeedCode(seed);
    expect(decodeSeedCode(`  ${code}  `)).toBe(seed);
    expect(decodeSeedCode(code.toLowerCase())).toBe(seed);
    expect(decodeSeedCode(`\n${code}\n`)).toBe(seed);
  });

  it('honours a bare seed number, which is what the dialog prints beside the code', () => {
    expect(decodeSeedCode(String(FIRST_EXPEDITION_WORLD_SEED)))
      .toBe(FIRST_EXPEDITION_WORLD_SEED);
    expect(decodeSeedCode(` ${MAX_EXPEDITION_WORLD_SEED} `)).toBe(MAX_EXPEDITION_WORLD_SEED);
  });

  it('never lets parseInt truncate a malformed body into a real world', () => {
    // parseInt('C2 99Z', 36) is 436, a perfectly flyable seed for a code nobody wrote.
    for (const body of ['C2 99Z', 'C2-99Z', 'C2.99Z', 'C2/99Z', 'C299Z!']) {
      expect(decodeSeedCode(`PPW1-${body}`)).toBeNull();
    }
  });

  it('rejects anything that is not one of our codes', () => {
    const rejected = [
      '', '   ', 'PPW1-', 'PPW1-0', 'PPW1-ZZZZZZZZ', 'PPS1-abc',
      '0', '-5', '3.5', '20260727abc', 'null', String(MAX_EXPEDITION_WORLD_SEED + 2),
    ];
    for (const code of rejected) expect(decodeSeedCode(code)).toBeNull();
  });
});
