import { sanitizeLoadout, type LastLoadout } from './LastLoadout';

// A shareable build code is the version-tagged base64 of a loadout's JSON. The
// tag lets a decoder reject anything that isn't one of our codes before it even
// tries to parse. Codes are copied/pasted (clipboard), never stored — so there
// is no new storage key and no save-format concern.
const LOADOUT_CODE_PREFIX = 'PPS1-';

// Reject pathologically long pastes before decoding. A real code is a couple
// hundred chars; anything past this is not one of ours.
const MAX_LOADOUT_CODE_LENGTH = 4096;

export function encodeLoadoutCode(loadout: LastLoadout): string {
  return LOADOUT_CODE_PREFIX + btoa(JSON.stringify(loadout));
}

/**
 * Decode a pasted build code back into a sanitised loadout, or null if it is not
 * a well-formed code (wrong tag, corrupt base64, non-JSON, or not a valid
 * loadout shape). Reuses sanitizeLoadout so a decoded code is validated exactly
 * like a stored last-loadout/preset before it can launch a run.
 */
export function decodeLoadoutCode(code: string): LastLoadout | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOADOUT_CODE_LENGTH) return null;
  if (!trimmed.startsWith(LOADOUT_CODE_PREFIX)) return null;
  try {
    const json = atob(trimmed.slice(LOADOUT_CODE_PREFIX.length));
    return sanitizeLoadout(JSON.parse(json));
  } catch {
    return null;
  }
}
