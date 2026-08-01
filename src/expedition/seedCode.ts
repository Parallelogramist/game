/**
 * A shareable expedition world code. The world is a pure function of one integer
 * (generateExpeditionWorld), so the code IS that integer, base36 so it stays short enough to
 * write down. `PPW1-` is the sibling of the build code's `PPS1-`: same origin, different payload,
 * and a decoder can reject anything that is not one of ours before it tries to parse.
 */

import { isFlyableExpeditionSeed } from './ExpeditionSeasonStore';

const SEED_CODE_PREFIX = 'PPW1-';

/** MAX_EXPEDITION_WORLD_SEED needs 6 base36 digits; 8 bounds a paste without rejecting a code a
 *  future range could emit, and the flyable check is what actually decides. */
const SEED_CODE_BODY = /^[0-9A-Z]{1,8}$/;

/** The CHART dialog prints `SEED 20260727` beside the code, so a player who writes down the number
 *  instead of the code is pasting something we can honour. 10 digits covers the whole range. */
const BARE_SEED = /^[0-9]{1,10}$/;

export function encodeSeedCode(seed: number): string {
  return SEED_CODE_PREFIX + seed.toString(36).toUpperCase();
}

/**
 * The seed a pasted code names, or null if it names none. Never throws and never guesses: an
 * un-flyable seed is rejected rather than clamped, because a clamped seed would silently fly a
 * different world from the one the code was written for.
 */
export function decodeSeedCode(code: string): number | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim().toUpperCase();
  if (BARE_SEED.test(trimmed)) {
    const bare = Number(trimmed);
    return isFlyableExpeditionSeed(bare) ? bare : null;
  }
  if (!trimmed.startsWith(SEED_CODE_PREFIX)) return null;
  const body = trimmed.slice(SEED_CODE_PREFIX.length);
  // parseInt truncates at the first character it cannot read and returns the prefix it managed,
  // so the shape has to be proved before it is parsed rather than after.
  if (!SEED_CODE_BODY.test(body)) return null;
  const seed = parseInt(body, 36);
  return isFlyableExpeditionSeed(seed) ? seed : null;
}

export { MAX_EXPEDITION_WORLD_SEED } from './ExpeditionSeasonStore';
