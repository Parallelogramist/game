import { BASE_KEY_MATERIAL, arrayToBase64, base64ToArray } from './StorageEncryption';
import { SecureStorage } from './SecureStorage';
import { flushStorage } from './StorageBootstrap';
import {
  PROFILE_ENVELOPE_PREFIX, TRANSFERABLE_STORAGE_KEYS, ProfilePayload, ProfileValidation,
  packProfile, planProfileApply, validateProfilePayload,
} from './ProfileTransfer';

async function derivePortableKey(salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(BASE_KEY_MATERIAL), { name: 'PBKDF2' }, false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Encrypt a payload into the portable envelope string. */
export async function encodeProfileBlob(payload: ProfilePayload): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePortableKey(salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${PROFILE_ENVELOPE_PREFIX}${arrayToBase64(salt)}:${arrayToBase64(iv)}:${arrayToBase64(new Uint8Array(ciphertext))}`;
}

/** Decrypt + validate an envelope string. Never throws — returns ProfileValidation. */
export async function decodeProfileBlob(text: string): Promise<ProfileValidation> {
  const trimmed = text.trim().replace(/\s+/g, '');   // paste often wraps lines
  if (!trimmed.startsWith(PROFILE_ENVELOPE_PREFIX)) {
    return { ok: false, error: 'This is not a Pew Pew Survivor profile code.' };
  }
  const parts = trimmed.slice(PROFILE_ENVELOPE_PREFIX.length).split(':');
  if (parts.length !== 3) return { ok: false, error: 'This profile code is incomplete or corrupted.' };
  let json: string;
  try {
    const [saltB64, ivB64, ciphertextB64] = parts;
    const key = await derivePortableKey(base64ToArray(saltB64));
    const iv = base64ToArray(ivB64);
    const ciphertext = base64ToArray(ciphertextB64);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, ciphertext.buffer as ArrayBuffer,
    );
    json = new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM auth failure — a truncated paste lands here, which is the
    // single most likely real-world failure on iOS.
    return { ok: false, error: 'This profile code is incomplete or corrupted.' };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ok: false, error: 'This profile code is corrupted.' }; }
  return validateProfilePayload(parsed);
}

/** Snapshot every transferable key currently in SecureStorage. */
export function collectProfileKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const key of TRANSFERABLE_STORAGE_KEYS) {
    const value = SecureStorage.getItem(key);
    if (value !== null) keys[key] = value;
  }
  return keys;
}

export async function exportProfileBlob(exportedAt: number): Promise<string> {
  return encodeProfileBlob(packProfile(collectProfileKeys(), exportedAt));
}

/**
 * Atomic restore. Caller MUST pass a validated payload — every write happens in
 * one non-throwing loop after validation, so a rejected blob writes nothing.
 */
export async function applyProfilePayload(payload: ProfilePayload): Promise<void> {
  const plan = planProfileApply(payload);
  for (const [key, value] of Object.entries(plan.sets)) SecureStorage.setItem(key, value);
  for (const key of plan.removes) SecureStorage.removeItem(key);
  await flushStorage();
}
